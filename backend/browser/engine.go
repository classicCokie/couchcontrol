package browser

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/chromedp/cdproto/input"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
	"github.com/chromedp/chromedp/kb"
)

// Each mounted app gets a separate temporary Chrome profile, never the user's profile.
type Engine struct {
	mu       sync.Mutex
	sessions map[string]*browserSession
	closed   bool
}
type browserSession struct {
	mu            sync.Mutex
	command       sync.Mutex
	ctx           context.Context
	cancel        context.CancelFunc
	width, height int64
	lastUsed      time.Time
}
type PageState struct {
	URL    string `json:"url"`
	Title  string `json:"title"`
	Image  []byte `json:"image,omitempty"`
	Width  int64  `json:"width"`
	Height int64  `json:"height"`
}

func NewEngine() *Engine { return &Engine{sessions: make(map[string]*browserSession)} }
func (e *Engine) Close() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.closed = true
	for id, s := range e.sessions {
		s.cancel()
		delete(e.sessions, id)
	}
}
func (e *Engine) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/browser/sessions", e.create)
	mux.HandleFunc("DELETE /api/browser/sessions/{id}", e.remove)
	mux.HandleFunc("GET /api/browser/sessions/{id}/frame", e.frame)
	mux.HandleFunc("POST /api/browser/sessions/{id}/scroll", e.scroll)
}

// Controller input bypasses command interpretation and only moves the page.
func (e *Engine) scroll(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Direction string `json:"direction"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
	d.DisallowUnknownFields()
	if d.Decode(&body) != nil || d.Decode(new(any)) != io.EOF || (body.Direction != "up" && body.Direction != "down") {
		failure(w, 400, "Use up or down to scroll.")
		return
	}
	s, err := e.get(r.PathValue("id"))
	if err != nil {
		failure(w, 404, err.Error())
		return
	}
	if !s.command.TryLock() {
		failure(w, 409, "A browser command is already running.")
		return
	}
	defer s.command.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	delta := 100
	if body.Direction == "up" {
		delta = -100
	}
	err = s.run(r.Context(), chromedp.Evaluate(fmt.Sprintf("window.scrollBy({top:%d,behavior:'instant'})", delta), nil))
	if err != nil {
		failure(w, 502, "Could not scroll the page. Reopen Browser to reconnect.")
		return
	}
	respond(w, 200, map[string]bool{"scrolled": true})
}
func (e *Engine) get(id string) (*browserSession, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	s := e.sessions[id]
	if s == nil {
		return nil, errors.New("Browser session ended. Reopen the Browser app.")
	}
	return s, nil
}
func (e *Engine) create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL string `json:"url"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&body) != nil || (body.URL != "" && !validURL(body.URL)) {
		failure(w, 400, "Use an HTTP or HTTPS page address.")
		return
	}
	e.mu.Lock()
	// Expire abandoned clients on subsequent opens, in addition to frontend cleanup.
	for id, s := range e.sessions {
		s.mu.Lock()
		expired := time.Since(s.lastUsed) > 30*time.Minute
		s.mu.Unlock()
		if expired {
			s.cancel()
			delete(e.sessions, id)
		}
	}
	if e.closed || len(e.sessions) >= 8 {
		e.mu.Unlock()
		failure(w, 429, "Close another Browser app before opening one.")
		return
	}
	options := append([]chromedp.ExecAllocatorOption{}, chromedp.DefaultExecAllocatorOptions[:]...)
	options = append(options, chromedp.WindowSize(1280, 800))
	if path := os.Getenv("COUCHCONTROL_CHROME"); path != "" {
		options = append(options, chromedp.ExecPath(path))
	}
	alloc, stopAlloc := chromedp.NewExecAllocator(context.Background(), options...)
	ctx, stopTab := chromedp.NewContext(alloc)
	s := &browserSession{ctx: ctx, cancel: func() { stopTab(); stopAlloc() }, width: 1280, height: 800, lastUsed: time.Now()}
	idBytes := make([]byte, 24)
	if _, err := rand.Read(idBytes); err != nil {
		e.mu.Unlock()
		s.cancel()
		failure(w, 500, "Could not start browser.")
		return
	}
	id := hex.EncodeToString(idBytes)
	e.sessions[id] = s
	e.mu.Unlock()
	s.mu.Lock()
	// Allocate on the session context: a short-lived first Run would make
	// Chrome inherit the request lifetime and exit after the create response.
	startupTimer := time.AfterFunc(30*time.Second, stopTab)
	stop := context.AfterFunc(r.Context(), stopTab)
	destination := body.URL
	if destination == "" {
		destination = "about:blank"
	}
	err := chromedp.Run(ctx, chromedp.EmulateViewport(s.width, s.height))
	stop()
	startupTimer.Stop()
	// A stale/unreachable saved URL must not prevent new voice commands.
	if err == nil && destination != "about:blank" {
		_ = s.run(r.Context(), chromedp.Navigate(destination))
	}
	s.mu.Unlock()
	if err != nil {
		e.mu.Lock()
		delete(e.sessions, id)
		e.mu.Unlock()
		s.cancel()
		failure(w, 502, "Could not open Chromium or load the page. Check Chrome is installed and the address is reachable.")
		return
	}
	respond(w, 200, map[string]string{"id": id})
}
func (e *Engine) remove(w http.ResponseWriter, r *http.Request) {
	e.mu.Lock()
	s := e.sessions[r.PathValue("id")]
	delete(e.sessions, r.PathValue("id"))
	e.mu.Unlock()
	if s != nil {
		s.cancel()
	}
	respond(w, 200, map[string]bool{"closed": true})
}
func (s *browserSession) run(ctx context.Context, actions ...chromedp.Action) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	run, cancel := context.WithTimeout(s.ctx, 25*time.Second)
	defer cancel()
	stop := context.AfterFunc(ctx, cancel)
	defer stop()
	s.lastUsed = time.Now()
	return chromedp.Run(run, actions...)
}
func (s *browserSession) snapshot(ctx context.Context, image bool) (PageState, error) {
	state := PageState{Width: s.width, Height: s.height}
	actions := []chromedp.Action{chromedp.Location(&state.URL), chromedp.Title(&state.Title)}
	if image {
		actions = append(actions, chromedp.ActionFunc(func(ctx context.Context) error {
			var err error
			state.Image, err = page.CaptureScreenshot().WithFormat(page.CaptureScreenshotFormatJpeg).WithQuality(75).WithCaptureBeyondViewport(false).Do(ctx)
			return err
		}))
	}
	err := s.run(ctx, actions...)
	return state, err
}
func (e *Engine) frame(w http.ResponseWriter, r *http.Request) {
	s, err := e.get(r.PathValue("id"))
	if err != nil {
		failure(w, 404, err.Error())
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.snapshot(r.Context(), true)
	if err != nil {
		failure(w, 502, "Chromium is not responding. Reopen the Browser app to reconnect.")
		return
	}
	respond(w, 200, state)
}

type Element struct {
	ID    int    `json:"id"`
	Role  string `json:"role"`
	Label string `json:"label"`
}

// Fixed application code, not generated JavaScript. Values/passwords are not read.
const inspectElements = `(() => {
 const nodes = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]')].filter(e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && r.bottom>0 && r.top<innerHeight && r.right>0 && r.left<innerWidth && getComputedStyle(e).visibility!=='hidden' && !e.disabled; }).slice(0,100);
 window.__couchcontrolNodes = nodes;
 return nodes.map((e,i) => ({id:i+1,role:e.getAttribute('role')||e.tagName.toLowerCase(),label:(e.getAttribute('aria-label')||e.labels?.[0]?.innerText||e.getAttribute('placeholder')||e.innerText||e.getAttribute('title')||e.getAttribute('name')||e.getAttribute('type')||'').trim().slice(0,180)}));
})()`

func (s *browserSession) inspect(ctx context.Context) (PageState, []Element, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.snapshot(ctx, false)
	if err != nil {
		return state, nil, err
	}
	var elements []Element
	err = s.run(ctx, chromedp.Evaluate(inspectElements, &elements))
	return state, elements, err
}
func (s *browserSession) execute(ctx context.Context, p Plan, elements []Element) (PageState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Validate every referenced element before taking any action.
	for _, c := range p.Commands {
		if c.Action == "click" {
			id, _ := strconv.Atoi(c.Value)
			if id < 1 || id > len(elements) {
				return PageState{}, errors.New("The requested control is no longer available. Try again.")
			}
		}
	}
	for _, c := range p.Commands {
		var action chromedp.Action
		switch c.Action {
		case "navigate":
			action = chromedp.Navigate(c.Value)
		case "reload":
			action = chromedp.Reload()
		case "back":
			action = historyStep(-1)
		case "forward":
			action = historyStep(1)
		case "viewport":
			width := int64(1280)
			if c.Value != "full" {
				width, _ = strconv.ParseInt(c.Value, 10, 64)
			}
			s.width = width
			action = chromedp.EmulateViewport(s.width, s.height)
		case "click":
			id, _ := strconv.Atoi(c.Value)
			// Resolve only a node observed in this command's snapshot; never accept selectors/code.
			var point struct {
				X  float64 `json:"x"`
				Y  float64 `json:"y"`
				OK bool    `json:"ok"`
			}
			script := fmt.Sprintf(`(() => { const e=window.__couchcontrolNodes?.[%d]; if(!e?.isConnected || e.disabled) return {ok:false}; const r=e.getBoundingClientRect(); if(r.width<=0||r.height<=0) return {ok:false}; if(e.tagName==='A') e.target='_self'; return {ok:true,x:r.x+r.width/2,y:r.y+r.height/2}; })()`, id-1)
			if err := s.run(ctx, chromedp.Evaluate(script, &point)); err != nil || !point.OK {
				return PageState{}, errors.New("The page changed. Please repeat the command.")
			}
			action = chromedp.MouseClickXY(point.X, point.Y)
		case "type":
			var editable bool
			if err := s.run(ctx, chromedp.Evaluate(`!!document.activeElement && (document.activeElement.matches('input:not([type=password]),textarea') || document.activeElement.isContentEditable)`, &editable)); err != nil || !editable {
				return PageState{}, errors.New("Select a text field before entering text. Password entry is not supported by voice.")
			}
			action = chromedp.ActionFunc(func(ctx context.Context) error { return input.InsertText(c.Value).Do(ctx) })
		case "press":
			keys := map[string]string{"Enter": kb.Enter, "Tab": kb.Tab, "Escape": kb.Escape, "Backspace": kb.Backspace}
			action = chromedp.KeyEvent(keys[c.Value])
		case "scroll":
			scripts := map[string]string{"down": "window.scrollBy(0,innerHeight*0.8)", "up": "window.scrollBy(0,-innerHeight*0.8)", "top": "window.scrollTo(0,0)", "bottom": "window.scrollTo(0,document.documentElement.scrollHeight)"}
			action = chromedp.Evaluate(scripts[c.Value], nil)
		case "shelf":
			continue
		}
		if action == nil {
			return PageState{}, errors.New("Unsupported browser command.")
		}
		if err := s.run(ctx, action); err != nil {
			return PageState{}, fmt.Errorf("Browser action %s failed: %w. Earlier actions may have completed; check the live view before retrying", c.Action, err)
		}
	}
	return s.snapshot(ctx, false)
}

// Back/forward cache restores do not emit a new network load event. Wait for
// the destination document instead of chromedp's network-navigation waiter.
func historyStep(delta int64) chromedp.Action {
	return chromedp.ActionFunc(func(ctx context.Context) error {
		current, entries, err := page.GetNavigationHistory().Do(ctx)
		if err != nil {
			return err
		}
		next := current + delta
		if next < 0 || next >= int64(len(entries)) {
			return errors.New("No page in that history direction.")
		}
		entry := entries[next]
		if err = page.NavigateToHistoryEntry(entry.ID).Do(ctx); err != nil {
			return err
		}
		destination, _ := json.Marshal(entry.URL)
		wait, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		ticker := time.NewTicker(50 * time.Millisecond)
		defer ticker.Stop()
		for {
			var ready bool
			// The execution context can disappear between navigation and BFCache restore.
			if err := chromedp.Evaluate("location.href === "+string(destination)+" && document.readyState !== 'loading'", &ready).Do(wait); err == nil && ready {
				return nil
			}
			select {
			case <-wait.Done():
				return wait.Err()
			case <-ticker.C:
			}
		}
	})
}
