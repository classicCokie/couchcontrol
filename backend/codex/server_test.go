package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func testServer(t *testing.T) (*server, string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "state.sqlite")
	db, err := openStore(path)
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(dir, "fake-codex")
	// A real PTY subprocess: terminal dimensions, byte fidelity, input, and process exit are exercised without a model call.
	script := "#!/bin/sh\nstty -echo\nprintf 'ARGS:%s\\n' \"$*\"\nprintf 'TOKEN:%s\\n' \"$CODEX_WEB_TOKEN $CLAUDE_WEB_TOKEN\"\npwd\nstty size\nprintf 'READY λ\\n'\nwhile IFS= read -r line; do\n [ \"$line\" = quit ] && exit 0\n if [ \"$line\" = size ]; then stty size; else printf 'REPLY:%s\\n' \"$line\"; fi\ndone\n"
	if err := os.WriteFile(binary, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	m := &manager{db: db, binary: binary, cwd: dir, active: map[string]*process{}}
	s := &server{manager: m, token: strings.Repeat("a", 64), origins: map[string]bool{"http://localhost:5173": true}, hosts: map[string]bool{"localhost:5173": true}}
	t.Cleanup(func() { m.shutdown(); db.Close() })
	return s, path
}

func serveRequest(s *server, method, path, body, origin, token string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://localhost:5173"+path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	if token != "" {
		r.AddCookie(&http.Cookie{Name: "codex_access", Value: token})
	}
	w := httptest.NewRecorder()
	s.handler("").ServeHTTP(w, r)
	return w
}

func TestAuthenticationAndOriginBoundaries(t *testing.T) {
	s, _ := testServer(t)
	for _, tc := range []struct {
		name, method, path, body, origin, token string
		status                                  int
	}{
		{"unauthenticated", "GET", "/api/codex/sessions", "", "", "", 401},
		{"automatic connection", "POST", "/api/codex/auth", `{}`, "http://localhost:5173", "", 200},
		{"cross origin login", "POST", "/api/codex/auth", `{"token":"` + s.token + `"}`, "https://attacker.example", "", 403},
		{"missing origin", "POST", "/api/codex/sessions", `{}`, "", s.token, 403},
		{"cross origin read", "GET", "/api/codex/sessions", "", "https://attacker.example", s.token, 403},
		{"valid read", "GET", "/api/codex/sessions", "", "", s.token, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := serveRequest(s, tc.method, tc.path, tc.body, tc.origin, tc.token)
			if w.Code != tc.status {
				t.Fatalf("status %d: %s", w.Code, w.Body)
			}
		})
	}
	w := serveRequest(s, "POST", "/api/codex/auth", `{"token":"`+s.token+`"}`, "http://localhost:5173", "")
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	cookie := w.Result().Cookies()[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/api/codex" {
		t.Fatalf("unsafe cookie: %+v", cookie)
	}
	r := httptest.NewRequest("GET", "http://attacker.example/api/codex/auth", nil)
	w = httptest.NewRecorder()
	s.handler("").ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("untrusted Host accepted")
	}
}

func TestTerminalLifecycleAndReplay(t *testing.T) {
	t.Setenv("CODEX_WEB_TOKEN", "must-not-reach-child")
	s, _ := testServer(t)
	listener := httptest.NewUnstartedServer(s.handler(""))
	s.hosts[listener.Listener.Addr().String()] = true
	listener.Start()
	defer listener.Close()
	w := serveRequest(s, "POST", "/api/codex/sessions", `{"title":"Test","cols":90,"rows":25}`, "http://localhost:5173", s.token)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	var created session
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	wsURL := "ws" + strings.TrimPrefix(listener.URL, "http") + "/api/codex/sessions/" + created.ID + "/terminal"
	header := http.Header{"Origin": []string{"http://localhost:5173"}, "Cookie": []string{"codex_access=" + s.token}}
	for _, origin := range []string{"", "https://attacker.example"} {
		badHeaders := header.Clone()
		badHeaders.Set("Origin", origin)
		conn, response, err := websocket.DefaultDialer.Dial(wsURL, badHeaders)
		if err == nil {
			conn.Close()
			t.Fatal("untrusted websocket connected")
		}
		if response == nil || response.StatusCode != 403 {
			t.Fatalf("unexpected denial: %v", err)
		}
		response.Body.Close()
	}
	dial := func() *websocket.Conn {
		t.Helper()
		c, _, err := websocket.DefaultDialer.Dial(wsURL, header)
		if err != nil {
			t.Fatal(err)
		}
		c.SetReadDeadline(time.Now().Add(5 * time.Second))
		return c
	}
	c := dial()
	readUntil := func(c *websocket.Conn, target string) string {
		t.Helper()
		text := ""
		for !strings.Contains(text, target) {
			kind, data, err := c.ReadMessage()
			if err != nil {
				t.Fatalf("waiting for %q, got %q: %v", target, text, err)
			}
			if kind == websocket.BinaryMessage {
				text += string(data)
			}
		}
		return text
	}
	output := readUntil(c, "READY λ")
	if !strings.Contains(output, "25 90") || !strings.Contains(output, "--sandbox workspace-write --ask-for-approval on-request") || strings.Contains(output, "must-not-reach-child") {
		t.Fatalf("unexpected startup: %q", output)
	}
	if err := c.WriteJSON(map[string]any{"type": "resize", "cols": 110, "rows": 35}); err != nil {
		t.Fatal(err)
	}
	c.WriteJSON(map[string]string{"type": "input", "data": "size\r"})
	readUntil(c, "35 110")
	c.WriteJSON(map[string]string{"type": "input", "data": "hello 世界\r"})
	readUntil(c, "REPLY:hello 世界")
	c.Close()
	// Disconnecting a browser must not stop the host process; reconnect replays the database.
	c = dial()
	readUntil(c, "REPLY:hello 世界")
	w = serveRequest(s, "DELETE", "/api/codex/sessions/"+created.ID, "", "http://localhost:5173", s.token)
	if w.Code != 409 {
		t.Fatal("deleted a live session")
	}
	c.WriteJSON(map[string]string{"type": "input", "data": "quit\r"})
	for {
		kind, data, err := c.ReadMessage()
		if err != nil {
			t.Fatal(err)
		}
		if kind == websocket.TextMessage && strings.Contains(string(data), `"type":"exit"`) {
			break
		}
	}
	c.Close()
	saved, err := scanSession(s.manager.db.QueryRow("SELECT "+sessionColumns+" FROM sessions WHERE id=?", created.ID))
	if err != nil || saved.Status != "exited" || saved.ExitCode == nil || *saved.ExitCode != 0 {
		t.Fatalf("exit not saved: %+v %v", saved, err)
	}
	c = dial()
	readUntil(c, "REPLY:hello 世界")
	c.Close()
	w = serveRequest(s, "DELETE", "/api/codex/sessions/"+created.ID, "", "http://localhost:5173", s.token)
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	var count int
	s.manager.db.QueryRow("SELECT count(*) FROM output WHERE session_id=?", created.ID).Scan(&count)
	if count != 0 {
		t.Fatal("history did not cascade on delete")
	}
}

func TestRecoveryValidationAndStop(t *testing.T) {
	s, path := testServer(t)
	for _, body := range []string{`{"cwd":"relative"}`, `{"cwd":"/path-that-does-not-exist"}`, `{"mode":"shell"}`, `{"cols":900,"rows":25}`} {
		w := serveRequest(s, "POST", "/api/codex/sessions", body, "http://localhost:5173", s.token)
		if w.Code != 400 {
			t.Fatalf("accepted %s", body)
		}
	}
	created, err := s.manager.start("Stop me", "", "resume", 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	s.manager.stop(created.ID)
	s.manager.mu.Lock()
	count := len(s.manager.active)
	s.manager.mu.Unlock()
	if count != 0 {
		t.Fatal("process was not reaped")
	}
	_, err = s.manager.db.Exec("INSERT INTO sessions(id,title,cwd,status,cols,rows) VALUES('crashed','Recover',?,'running',80,24)", s.manager.cwd)
	if err != nil {
		t.Fatal(err)
	}
	s.manager.db.Exec("INSERT INTO output(session_id,data) VALUES('crashed',?)", []byte("saved output"))
	s.manager.db.Close()
	db, err := openStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var status string
	var output []byte
	if err := db.QueryRow("SELECT status FROM sessions WHERE id='crashed'").Scan(&status); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT data FROM output WHERE session_id='crashed'").Scan(&output); err != nil {
		t.Fatal(err)
	}
	if status != "interrupted" || string(output) != "saved output" {
		t.Fatal("restart lost persistent state")
	}
}

func TestBrowserAutomaticAuthentication(t *testing.T) {
	s, _ := testServer(t)
	for _, tc := range []struct {
		name, peer, origin, forwarded string
		status                        int
	}{
		{"local browser", "127.0.0.1:54321", "http://localhost:5173", "", 200},
		{"IPv6 browser", "[::1]:54321", "http://localhost:5173", "", 200},
		{"remote peer", "192.168.1.20:54321", "http://localhost:5173", "", 200},
		{"forwarded peer", "127.0.0.1:54321", "http://localhost:5173", "192.168.1.20", 200},
		{"cross origin", "127.0.0.1:54321", "https://attacker.example", "", 403},
		{"missing origin", "127.0.0.1:54321", "", "", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", "http://localhost:5173/api/codex/auth", strings.NewReader(`{}`))
			r.RemoteAddr = tc.peer
			r.Header.Set("Origin", tc.origin)
			r.Header.Set("Content-Type", "application/json")
			if tc.forwarded != "" {
				r.Header.Set("X-Forwarded-For", tc.forwarded)
			}
			w := httptest.NewRecorder()
			s.handler("").ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("status %d: %s", w.Code, w.Body)
			}
			if tc.status == 200 {
				cookies := w.Result().Cookies()
				if len(cookies) != 1 || !s.validToken(cookies[0].Value) || !cookies[0].HttpOnly {
					t.Fatal("missing authenticated cookie")
				}
			}
		})
	}
}

func TestGeneralRoutesAreIndependentOfCodexAuthentication(t *testing.T) {
	s, _ := testServer(t)
	w := serveRequest(s, "GET", "/api/settings", "", "", "")
	if w.Code != 200 {
		t.Fatalf("settings required Codex authentication: %d %s", w.Code, w.Body)
	}
	w = serveRequest(s, "PUT", "/api/settings", `{"whisperApiKey":"sk-test"}`, "http://localhost:5173", "")
	if w.Code != 200 {
		t.Fatalf("saving key required Codex authentication: %d", w.Code)
	}
	w = serveRequest(s, "POST", "/api/transcriptions", `{}`, "http://localhost:5173", "")
	if w.Code != 400 {
		t.Fatalf("transcription must validate audio without Codex auth: %d %s", w.Code, w.Body)
	}
	w = serveRequest(s, "GET", "/api/codex/sessions", "", "", "")
	if w.Code != 401 {
		t.Fatal("Codex terminal lost its authentication boundary")
	}
	w = serveRequest(s, "PUT", "/api/settings", `{"whisperApiKey":"sk-test"}`, "https://attacker.example", "")
	if w.Code != 403 {
		t.Fatal("cross-origin settings write accepted")
	}
}

func TestCloseSessionCleansOnlyItsProcessAndHistory(t *testing.T) {
	s, _ := testServer(t)
	first, err := s.manager.start("Codex 1", "", "", 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.manager.start("Codex 2", "", "", 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	s.manager.mu.Lock()
	process := s.manager.active[first.ID]
	s.manager.mu.Unlock()
	if _, err := s.manager.db.Exec("INSERT INTO output(session_id,data) VALUES(?,?)", first.ID, []byte("saved output")); err != nil {
		t.Fatal(err)
	}
	path := "/api/codex/sessions/" + first.ID + "/close"
	for _, tc := range []struct {
		origin, token string
		status        int
	}{
		{"http://localhost:5173", "", 401},
		{"https://attacker.example", s.token, 403},
		{"http://localhost:5173", s.token, 200},
		{"http://localhost:5173", s.token, 200},
	} {
		w := serveRequest(s, "POST", path, `{}`, tc.origin, tc.token)
		if w.Code != tc.status {
			t.Fatal(w.Code, w.Body)
		}
	}
	select {
	case <-process.done:
	default:
		t.Fatal("close returned before the process was reaped")
	}
	if err := syscall.Kill(process.cmd.Process.Pid, 0); err != syscall.ESRCH {
		t.Fatal("process still exists", err)
	}
	for _, table := range []string{"sessions", "output"} {
		field := "id"
		if table == "output" {
			field = "session_id"
		}
		var count int
		if err := s.manager.db.QueryRow("SELECT count(*) FROM "+table+" WHERE "+field+"=?", first.ID).Scan(&count); err != nil || count != 0 {
			t.Fatal(table, count, err)
		}
	}
	s.manager.mu.Lock()
	_, stillRunning := s.manager.active[other.ID]
	s.manager.mu.Unlock()
	if !stillRunning {
		t.Fatal("closing one app stopped another")
	}
}

func TestCloseKillsBackgroundChildIgnoringHangup(t *testing.T) {
	s, _ := testServer(t)
	script := `#!/bin/sh
trap 'exit 0' HUP
(trap '' HUP; exec sleep 30) >/dev/null 2>&1 &
echo $! > child.pid
while :; do sleep 1; done
`
	if err := os.WriteFile(s.manager.binary, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	created, err := s.manager.start("Children", "", "", 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	var child int
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		data, _ := os.ReadFile(filepath.Join(s.manager.cwd, "child.pid"))
		child, _ = strconv.Atoi(strings.TrimSpace(string(data)))
		if child > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if child == 0 {
		t.Fatal("child did not start")
	}
	defer syscall.Kill(child, syscall.SIGKILL)
	w := serveRequest(s, "POST", "/api/codex/sessions/"+created.ID+"/close", `{}`, "http://localhost:5173", s.token)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		status, err := exec.Command("ps", "-p", strconv.Itoa(child), "-o", "stat=").Output()
		// A killed orphan may briefly be waiting for init to reap it.
		if err != nil || strings.HasPrefix(strings.TrimSpace(string(status)), "Z") {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("background child survived closing its app")
}
