package main

import (
	"couchcontrol/backend/browser"
	"couchcontrol/backend/notes"
	"couchcontrol/backend/platform"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type server struct {
	browser  *browser.Engine
	claude   *server
	provider string
	manager  *manager
	token    string
	origins  map[string]bool
	hosts    map[string]bool
}

func jsonResponse(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}
func apiError(w http.ResponseWriter, status int, message string) {
	jsonResponse(w, status, map[string]string{"error": message})
}
func decode(w http.ResponseWriter, r *http.Request, value any) error {
	if r.Header.Get("Content-Type") != "application/json" {
		return errors.New("expected application/json")
	}
	return json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(value)
}
func (s *server) authenticated(r *http.Request) bool {
	c, err := r.Cookie(s.appID() + "_access")
	return err == nil && s.validToken(c.Value)
}
func (s *server) validToken(token string) bool {
	a, b := sha256.Sum256([]byte(token)), sha256.Sum256([]byte(s.token))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

// Only a direct browser connection on this machine can skip token entry.
// Remote clients and forwarded requests must still present the access token.
func localBrowser(r *http.Request) bool {
	peer, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || !net.ParseIP(peer).IsLoopback() {
		return false
	}
	for _, header := range []string{"Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "X-Real-IP"} {
		if r.Header.Get(header) != "" {
			return false
		}
	}
	origin, err := url.Parse(r.Header.Get("Origin"))
	if err != nil {
		return false
	}
	host := origin.Hostname()
	return host == "localhost" || net.ParseIP(host).IsLoopback()
}

func (s *server) handler(staticDir string) http.Handler {
	mux := http.NewServeMux()
	shared := platform.New(s.manager.db, nil)
	shared.Register(mux)
	notes.New(filepath.Join(s.manager.cwd, ".couchcontrol", "notes"), shared.OpenAIKey).Register(mux)
	s.browser = browser.NewEngine()
	browserHandler := browser.New(shared.OpenAIKey, nil)
	browserHandler.Engine = s.browser
	browserHandler.Register(mux)
	s.registerTerminal(mux)
	if s.claude != nil {
		s.claude.registerTerminal(mux)
	}
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { apiError(w, 404, "Not found") })
	if staticDir != "" {
		mux.Handle("/", http.FileServer(http.Dir(staticDir)))
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if !s.hosts[r.Host] {
			apiError(w, 403, "Host is not allowed")
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
			origin := r.Header.Get("Origin")
			if (origin != "" && !s.origins[origin]) || ((r.Method != "GET" || websocket.IsWebSocketUpgrade(r)) && origin == "") {
				apiError(w, 403, "Origin is not allowed")
				return
			}
			for _, terminal := range []*server{s, s.claude} {
				if terminal == nil {
					continue
				}
				prefix := "/api/" + terminal.appID()
				if strings.HasPrefix(r.URL.Path, prefix+"/") && r.URL.Path != prefix+"/auth" && !terminal.authenticated(r) {
					apiError(w, 401, "Connect this browser with the host access token.")
					return
				}
			}
		}
		mux.ServeHTTP(w, r)
	})
}

func (s *server) appID() string {
	if s.provider == "claude" {
		return "claude"
	}
	return "codex"
}

func (s *server) registerTerminal(mux *http.ServeMux) {
	prefix := "/api/" + s.appID()
	{
		path := prefix + "/auth"
		mux.HandleFunc("GET "+path, func(w http.ResponseWriter, r *http.Request) {
			jsonResponse(w, 200, map[string]bool{"authenticated": s.authenticated(r)})
		})
		mux.HandleFunc("POST "+path, func(w http.ResponseWriter, r *http.Request) {
			var body struct {
				Token string `json:"token"`
			}
			if decode(w, r, &body) != nil || !(s.validToken(body.Token) || (body.Token == "" && localBrowser(r))) {
				apiError(w, 401, "Access token is incorrect.")
				return
			}
			http.SetCookie(w, &http.Cookie{Name: s.appID() + "_access", Value: s.token, Path: prefix, HttpOnly: true, Secure: r.TLS != nil || strings.HasPrefix(r.Header.Get("Origin"), "https://"), SameSite: http.SameSiteStrictMode, MaxAge: 43200})
			jsonResponse(w, 200, map[string]bool{"authenticated": true})
		})
	}
	mux.HandleFunc("GET "+prefix+"/sessions", s.list)
	mux.HandleFunc("POST "+prefix+"/sessions", s.create)
	mux.HandleFunc("POST "+prefix+"/sessions/{id}/stop", func(w http.ResponseWriter, r *http.Request) {
		s.manager.stop(r.PathValue("id"))
		jsonResponse(w, 200, map[string]bool{"stopped": true})
	})
	mux.HandleFunc("POST "+prefix+"/sessions/{id}/close", s.closeSession)
	mux.HandleFunc("DELETE "+prefix+"/sessions/{id}", s.remove)
	mux.HandleFunc("GET "+prefix+"/sessions/{id}/terminal", s.stream)
}

func (s *server) list(w http.ResponseWriter, r *http.Request) {
	rows, err := s.manager.db.Query("SELECT " + sessionColumns + " FROM sessions ORDER BY created_at DESC, id DESC")
	if err != nil {
		apiError(w, 500, "Could not load sessions")
		return
	}
	defer rows.Close()
	sessions := []session{}
	for rows.Next() {
		value, err := scanSession(rows)
		if err != nil {
			apiError(w, 500, "Could not load sessions")
			return
		}
		sessions = append(sessions, value)
	}
	if rows.Err() != nil {
		apiError(w, 500, "Could not load sessions")
		return
	}
	jsonResponse(w, 200, map[string]any{"sessions": sessions, "defaultCwd": s.manager.cwd})
}

func (s *server) create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title string `json:"title"`
		CWD   string `json:"cwd"`
		Mode  string `json:"mode"`
		Cols  int    `json:"cols"`
		Rows  int    `json:"rows"`
	}
	if err := decode(w, r, &body); err != nil {
		apiError(w, 400, "Invalid session request")
		return
	}
	if body.Cols == 0 && body.Rows == 0 {
		body.Cols, body.Rows = 100, 30
	}
	if !validSize(body.Cols, body.Rows) {
		apiError(w, 400, "Invalid terminal size")
		return
	}
	value, err := s.manager.start(body.Title, body.CWD, body.Mode, body.Cols, body.Rows)
	if err != nil {
		apiError(w, 400, err.Error())
		return
	}
	jsonResponse(w, 201, value)
}

// Closing is idempotent so a lost HTTP response can be retried safely.
func (s *server) closeSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.manager.stop(id)
	if _, err := s.manager.db.Exec("DELETE FROM sessions WHERE id=?", id); err != nil {
		apiError(w, 500, "The process stopped, but its session history could not be removed. Try again.")
		return
	}
	jsonResponse(w, 200, map[string]bool{"closed": true})
}

func (s *server) remove(w http.ResponseWriter, r *http.Request) {
	result, err := s.manager.db.Exec("DELETE FROM sessions WHERE id=? AND status!='running'", r.PathValue("id"))
	if err != nil {
		apiError(w, 500, "Could not delete session")
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		apiError(w, 409, "Stop the session before deleting it")
		return
	}
	jsonResponse(w, 200, map[string]bool{"deleted": true})
}

func (s *server) stream(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	value, err := scanSession(s.manager.db.QueryRow("SELECT "+sessionColumns+" FROM sessions WHERE id=?", id))
	if err != nil {
		apiError(w, 404, "Session not found")
		return
	}
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return s.origins[r.Header.Get("Origin")] }, ReadBufferSize: 4096, WriteBufferSize: 32768}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	done := make(chan struct{})
	conn.SetReadLimit(8192)
	conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(60 * time.Second)) })
	go func() {
		defer close(done)
		defer conn.Close()
		for {
			var message struct {
				Type string `json:"type"`
				Data string `json:"data"`
				Cols int    `json:"cols"`
				Rows int    `json:"rows"`
			}
			if conn.ReadJSON(&message) != nil {
				return
			}
			var err error
			switch message.Type {
			case "input":
				if message.Data == "" {
					continue
				}
				err = s.manager.input(id, message.Data, 0, 0)
			case "resize":
				err = s.manager.input(id, "", message.Cols, message.Rows)
			default:
				return
			}
			if err != nil {
				return
			}
		}
	}()
	write := func(kind int, data []byte) error {
		conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return conn.WriteMessage(kind, data)
	}
	writeJSON := func(data any) error { b, _ := json.Marshal(data); return write(websocket.TextMessage, b) }
	s.manager.mu.Lock()
	liveStartup := false
	if p := s.manager.active[id]; p != nil && !p.attached {
		liveStartup = true
		p.attached = true
	}
	s.manager.mu.Unlock()
	if writeJSON(map[string]any{"type": "size", "cols": value.Cols, "rows": value.Rows, "liveStartup": liveStartup}) != nil {
		return
	}
	var seq int64
	ready := false
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()
	ping := time.NewTicker(20 * time.Second)
	defer ping.Stop()
	for {
		// Read status first: an exit is only announced after all persisted output is sent.
		var status string
		if err := s.manager.db.QueryRow("SELECT status FROM sessions WHERE id=?", id).Scan(&status); err != nil {
			return
		}
		rows, err := s.manager.db.Query("SELECT seq,data FROM output WHERE session_id=? AND seq>? ORDER BY seq LIMIT 128", id, seq)
		if err != nil {
			return
		}
		type chunk struct {
			seq  int64
			data []byte
		}
		chunks := []chunk{}
		for rows.Next() {
			var c chunk
			if err = rows.Scan(&c.seq, &c.data); err != nil {
				break
			}
			chunks = append(chunks, c)
		}
		rowErr := rows.Err()
		rows.Close()
		if err != nil || rowErr != nil {
			return
		}
		for _, c := range chunks {
			if write(websocket.BinaryMessage, c.data) != nil {
				return
			}
			seq = c.seq
		}
		if len(chunks) == 128 {
			continue
		}
		if status != "running" {
			writeJSON(map[string]string{"type": "exit", "status": status})
			return
		}
		if !ready {
			if writeJSON(map[string]string{"type": "ready"}) != nil {
				return
			}
			ready = true
		}
		select {
		case <-done:
			return
		case <-r.Context().Done():
			return
		case <-tick.C:
		case <-ping.C:
			if write(websocket.PingMessage, nil) != nil {
				return
			}
		}
	}
}

func allowedAddresses(origins []string) (map[string]bool, map[string]bool, error) {
	allowed, hosts := map[string]bool{}, map[string]bool{}
	for _, origin := range origins {
		u, err := url.Parse(strings.TrimSpace(origin))
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
			return nil, nil, errors.New("origins must be exact http(s) origins without paths")
		}
		allowed[u.String()], hosts[u.Host] = true, true
	}
	return allowed, hosts, nil
}
