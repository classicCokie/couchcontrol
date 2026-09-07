package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestClaudeIsolationAndTerminal(t *testing.T) {
	t.Setenv("CODEX_WEB_TOKEN", "must-not-reach-child")
	t.Setenv("CLAUDE_WEB_TOKEN", "claude-secret")
	root, _ := testServer(t)
	claude, _ := testServer(t)
	claude.provider, claude.manager.provider = "claude", "claude"
	root.claude = claude
	handler := root.handler("")
	defer root.browser.Close()
	request := func(method, path, body, cookie, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://localhost:5173"+path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if cookie != "" {
			r.AddCookie(&http.Cookie{Name: cookie, Value: root.token})
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	origin := "http://localhost:5173"
	for _, cookie := range []string{"", "codex_access"} {
		if w := request("GET", "/api/claude/sessions", "", cookie, origin); w.Code != 401 {
			t.Fatalf("Claude accepted %q: %d", cookie, w.Code)
		}
	}
	if w := request("POST", "/api/claude/sessions", "{}", "claude_access", "https://evil.example"); w.Code != 403 {
		t.Fatal("accepted foreign origin")
	}
	if w := request("POST", "/api/claude/sessions", "{}", "claude_access", ""); w.Code != 403 {
		t.Fatal("accepted absent origin")
	}
	w := request("POST", "/api/claude/auth", `{"token":"`+root.token+`"}`, "", origin)
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	cookie := w.Result().Cookies()[0]
	if cookie.Name != "claude_access" || cookie.Path != "/api/claude" || !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("unsafe cookie: %+v", cookie)
	}
	codex, err := root.manager.start("Same title", "", "new", 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	w = request("POST", "/api/claude/sessions", `{"title":"Same title","mode":"resume"}`, "claude_access", origin)
	if w.Code != 201 {
		t.Fatal(w.Body)
	}
	var created session
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	w = request("GET", "/api/claude/sessions", "", "claude_access", origin)
	if strings.Contains(w.Body.String(), codex.ID) || !strings.Contains(w.Body.String(), created.ID) {
		t.Fatal("provider sessions mixed")
	}
	listener := httptest.NewUnstartedServer(handler)
	root.hosts[listener.Listener.Addr().String()] = true
	listener.Start()
	defer listener.Close()
	url := "ws" + strings.TrimPrefix(listener.URL, "http") + "/api/claude/sessions/" + created.ID + "/terminal"
	headers := http.Header{"Origin": []string{origin}, "Cookie": []string{"claude_access=" + root.token}}
	dial := func() *websocket.Conn {
		t.Helper()
		c, _, err := websocket.DefaultDialer.Dial(url, headers)
		if err != nil {
			t.Fatal(err)
		}
		c.SetReadDeadline(time.Now().Add(5 * time.Second))
		return c
	}
	readUntil := func(c *websocket.Conn, target string) string {
		t.Helper()
		output := ""
		for !strings.Contains(output, target) {
			kind, data, err := c.ReadMessage()
			if err != nil {
				t.Fatalf("waiting for %q, got %q: %v", target, output, err)
			}
			if kind == websocket.BinaryMessage {
				output += string(data)
			}
		}
		return output
	}
	c := dial()
	output := readUntil(c, "READY λ")
	if !strings.Contains(output, "ARGS:--permission-mode default --resume") || strings.Contains(output, "--sandbox") || strings.Contains(output, "must-not-reach-child") || strings.Contains(output, "claude-secret") {
		t.Fatalf("wrong Claude launch: %q", output)
	}
	c.WriteJSON(map[string]any{"type": "resize", "cols": 110, "rows": 35})
	c.WriteJSON(map[string]string{"type": "input", "data": "size\r"})
	readUntil(c, "35 110")
	c.WriteJSON(map[string]string{"type": "input", "data": "hello Claude 世界\r"})
	readUntil(c, "REPLY:hello Claude 世界")
	c.Close()
	c = dial()
	readUntil(c, "REPLY:hello Claude 世界")
	c.Close()
	w = request("POST", "/api/claude/sessions/"+created.ID+"/close", "{}", "claude_access", origin)
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	var count int
	claude.manager.db.QueryRow("SELECT count(*) FROM output WHERE session_id=?", created.ID).Scan(&count)
	if count != 0 {
		t.Fatal("Claude output not removed")
	}
	root.manager.db.QueryRow("SELECT count(*) FROM sessions WHERE id=? AND status='running'", codex.ID).Scan(&count)
	if count != 1 {
		t.Fatal("closing Claude affected Codex")
	}
}
