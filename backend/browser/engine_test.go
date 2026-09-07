package browser

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/chromedp/chromedp"
)

// Opt-in real-engine regression: no model calls, credentials, or personal profiles.
func TestChromiumPages(t *testing.T) {
	if os.Getenv("COUCHCONTROL_BROWSER_TEST") != "1" {
		t.Skip("set COUCHCONTROL_BROWSER_TEST=1 to run real Chromium")
	}
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "frame-ancestors 'none'")
		if r.URL.Path == "/next" {
			w.Write([]byte(`<title>Second page</title><h1>Second page</h1>`))
			return
		}
		w.Write([]byte(`<title>Blocked from frames</title><body style="height:3000px"><label>Search<input id="search"></label><button onclick="document.title=document.querySelector('input').value">Apply</button><a href="/next">Next</a></body>`))
	}))
	defer site.Close()
	engine := NewEngine()
	defer engine.Close()
	mux := http.NewServeMux()
	engine.Register(mux)
	r := httptest.NewRequest("POST", "/api/browser/sessions", strings.NewReader(`{"url":"`+site.URL+`"}`))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var result struct {
		ID string `json:"id"`
	}
	json.Unmarshal(w.Body.Bytes(), &result)
	s, err := engine.get(result.ID)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var scrollPositions []float64
	for _, direction := range []string{"down", "down", "up", "up", "up"} {
		w = httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("POST", "/api/browser/sessions/"+result.ID+"/scroll", strings.NewReader(`{"direction":"`+direction+`"}`)))
		if w.Code != 200 {
			t.Fatalf("controller scroll: %d %s", w.Code, w.Body.String())
		}
		var position float64
		s.mu.Lock()
		err = s.run(ctx, chromedp.Evaluate("window.scrollY", &position))
		s.mu.Unlock()
		if err != nil {
			t.Fatal(err)
		}
		// Check each step below, including clamping at the top of the page.
		scrollPositions = append(scrollPositions, position)
	}
	for i, want := range []float64{100, 200, 100, 0, 0} {
		if scrollPositions[i] != want {
			t.Fatalf("scroll step %d: got %v, want %v", i, scrollPositions[i], want)
		}
	}
	current, elements, err := s.inspect(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if current.Title != "Blocked from frames" || len(elements) != 3 {
		t.Fatalf("unexpected page: %+v %+v", current, elements)
	}
	_, err = s.execute(ctx, Plan{Commands: []Command{{"click", "1"}, {"type", "Voice search"}, {"click", "2"}}}, elements)
	if err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	snapshot, err := s.snapshot(ctx, true)
	s.mu.Unlock()
	if err != nil || snapshot.Title != "Voice search" || len(snapshot.Image) < 100 {
		t.Fatalf("snapshot: %+v %v", snapshot.Title, err)
	}
	_, err = s.execute(ctx, Plan{Commands: []Command{{"viewport", "390"}, {"scroll", "bottom"}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	var scroll float64
	s.mu.Lock()
	err = s.run(ctx, chromedp.Evaluate("window.scrollY", &scroll))
	s.mu.Unlock()
	if err != nil || scroll <= 0 {
		t.Fatal("scroll did not execute", err)
	}
	_, err = s.execute(ctx, Plan{Commands: []Command{{"navigate", site.URL + "/next"}, {"back", ""}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	snapshot, err = s.snapshot(ctx, false)
	s.mu.Unlock()
	if err != nil || snapshot.URL != site.URL+"/" || snapshot.Width != 390 {
		t.Fatalf("history/viewport: %+v %v", snapshot, err)
	}
	// Removing a pane stops its renderer; other sessions are not touched.
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("DELETE", "/api/browser/sessions/"+result.ID, nil))
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	if _, err = engine.get(result.ID); err == nil {
		t.Fatal("session survived removal")
	}
}

func TestControllerScrollValidation(t *testing.T) {
	engine := NewEngine()
	defer engine.Close()
	mux := http.NewServeMux()
	engine.Register(mux)
	for _, body := range []string{`{}`, `{"direction":"left"}`, `{"direction":"down","script":"alert(1)"}`, `{"direction":"up"}{}`, `null`} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("POST", "/api/browser/sessions/missing/scroll", strings.NewReader(body)))
		if w.Code != 400 {
			t.Fatalf("body %s: got %d", body, w.Code)
		}
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("POST", "/api/browser/sessions/missing/scroll", strings.NewReader(`{"direction":"down"}`)))
	if w.Code != 404 {
		t.Fatalf("missing session: got %d", w.Code)
	}
}
