package notes

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func setup(t *testing.T) (*Handler, *http.ServeMux) {
	t.Helper()
	h := New(t.TempDir(), func() (string, error) { return "test-key", nil })
	h.Client = &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"# A lovely note\n\n- First thought"}]}]}`))}, nil
	})}
	mux := http.NewServeMux()
	h.Register(mux)
	return h, mux
}
func edit(mux *http.ServeMux, id, rev string) *httptest.ResponseRecorder {
	body, _ := json.Marshal(map[string]string{"text": "Add my thought", "revision": rev})
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("POST", "/api/notes/"+id+"/edit", strings.NewReader(string(body))))
	return w
}
func TestPersistenceAndConflicts(t *testing.T) {
	h, mux := setup(t)
	w := edit(mux, "test-note", "")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	data, err := os.ReadFile(filepath.Join(h.Dir, "test-note.md"))
	if err != nil || string(data) != "# A lovely note\n\n- First thought\n" {
		t.Fatal(string(data), err)
	}
	// A second process can reconstruct the sidebar from Markdown alone.
	restored := New(h.Dir, h.Key)
	listMux := http.NewServeMux()
	restored.Register(listMux)
	listed := httptest.NewRecorder()
	listMux.ServeHTTP(listed, httptest.NewRequest("GET", "/api/notes", nil))
	if listed.Code != 200 || !strings.Contains(listed.Body.String(), "A lovely note") {
		t.Fatal(listed.Body.String())
	}
	if conflict := edit(mux, "test-note", ""); conflict.Code != 409 {
		t.Fatal("stale edit accepted", conflict.Code)
	}
	var note Note
	json.Unmarshal(w.Body.Bytes(), &note)
	if updated := edit(mux, "test-note", note.Revision); updated.Code != 200 {
		t.Fatal(updated.Code, updated.Body.String())
	}
}
func TestIncompleteResponsePreservesFile(t *testing.T) {
	h, mux := setup(t)
	w := edit(mux, "test", "")
	var note Note
	json.Unmarshal(w.Body.Bytes(), &note)
	h.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"status":"incomplete","output":[]}`))}, nil
	})
	if w = edit(mux, "test", note.Revision); w.Code != 502 {
		t.Fatal(w.Code)
	}
	saved, err := h.read("test")
	if err != nil || saved.Revision != note.Revision {
		t.Fatal("saved note changed", err)
	}
}
func TestInvalidIDAndSymlink(t *testing.T) {
	h, mux := setup(t)
	if w := edit(mux, "bad.name", ""); w.Code != 400 {
		t.Fatal(w.Code)
	}
	outside := filepath.Join(t.TempDir(), "outside.md")
	os.WriteFile(outside, []byte("private"), 0600)
	os.Symlink(outside, filepath.Join(h.Dir, "linked.md"))
	if w := edit(mux, "linked", ""); w.Code != 500 {
		t.Fatal(w.Code)
	}
}

func TestMarkedLinesAreOptionalAgentContext(t *testing.T) {
	for _, selected := range []bool{false, true} {
		h, mux := setup(t)
		previous := h.Client.Transport
		called := false
		h.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
			called = true
			var payload struct{ Input string }
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatal(err)
			}
			var input struct {
				Instruction string `json:"user_instruction"`
				Marked      []struct {
					Line int
					Text string
				} `json:"marked_lines"`
			}
			if err := json.Unmarshal([]byte(payload.Input), &input); err != nil {
				t.Fatal(err)
			}
			if input.Instruction != "Expand this thought" {
				t.Fatal(input.Instruction)
			}
			if selected {
				if len(input.Marked) != 2 || input.Marked[0].Text != "First thought" || input.Marked[1].Line != 3 {
					t.Fatalf("missing selection context: %+v", input.Marked)
				}
			} else if len(input.Marked) != 0 {
				t.Fatal("unexpected selection")
			}
			return previous.RoundTrip(r)
		})
		body := map[string]any{"text": "Expand this thought", "revision": ""}
		if selected {
			body["selectedLines"] = []map[string]any{{"line": 2, "text": "First thought"}, {"line": 3, "text": "Second thought"}}
		}
		data, _ := json.Marshal(body)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("POST", "/api/notes/test/edit", strings.NewReader(string(data))))
		if !called || w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
}

func TestPreviousVersionSurvivesRestartAndRevert(t *testing.T) {
	h, mux := setup(t)
	var expectedCurrent string
	var expectedPrevious *string
	output := "# Original"
	h.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		var payload struct {
			Input string
			Model string
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload.Model != "gpt-4.1-nano-2025-04-14" {
			t.Fatal(payload.Model)
		}
		var input map[string]json.RawMessage
		if err := json.Unmarshal([]byte(payload.Input), &input); err != nil {
			t.Fatal(err)
		}
		if _, ok := input["previous_note"]; !ok {
			t.Fatal("previous_note missing")
		}
		var current string
		var previous *string
		json.Unmarshal(input["current_note"], &current)
		json.Unmarshal(input["previous_note"], &previous)
		if current != expectedCurrent {
			t.Fatalf("current %q, expected %q", current, expectedCurrent)
		}
		if expectedPrevious == nil {
			if previous != nil {
				t.Fatal("invented history")
			}
		} else if previous == nil || *previous != *expectedPrevious {
			t.Fatalf("previous %v, expected %q", previous, *expectedPrevious)
		}
		data, _ := json.Marshal(map[string]any{"status": "completed", "output": []any{map[string]any{"type": "message", "content": []any{map[string]string{"type": "output_text", "text": output}}}}})
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(data)))}, nil
	})
	save := func(rev string) Note {
		t.Helper()
		w := edit(mux, "history-test", rev)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		var note Note
		json.Unmarshal(w.Body.Bytes(), &note)
		return note
	}
	first := save("")
	expectedCurrent = first.Markdown
	output = "# Revised"
	second := save(first.Revision)
	// The next request is handled by a new handler reading only persisted files.
	restored := New(h.Dir, h.Key)
	restored.Client = h.Client
	mux = http.NewServeMux()
	restored.Register(mux)
	expectedCurrent = second.Markdown
	expectedPrevious = &first.Markdown
	output = "# Revised" // No-op preserves the useful previous version.
	same := save(second.Revision)
	if same.Revision != second.Revision {
		t.Fatal("no-op changed revision")
	}
	output = first.Markdown // Simulate the agent following an undo instruction.
	reverted := save(same.Revision)
	if reverted.Markdown != first.Markdown {
		t.Fatal("revert did not restore original")
	}
	expectedCurrent = first.Markdown
	expectedPrevious = &second.Markdown
	output = "# Third"
	save(reverted.Revision)
}

func TestFailedSaveDoesNotAdvanceHistory(t *testing.T) {
	h, mux := setup(t)
	w := edit(mux, "test", "")
	var note Note
	json.Unmarshal(w.Body.Bytes(), &note)
	previous := "# Older version\n"
	history := h.historyPath("test", note.Revision)
	os.MkdirAll(filepath.Dir(history), 0700)
	if err := writeMarkdown(history, previous); err != nil {
		t.Fatal(err)
	}
	h.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		// Force the final atomic replacement to fail after the history write.
		if err := os.Remove(filepath.Join(h.Dir, "test.md")); err != nil {
			t.Fatal(err)
		}
		if err := os.Mkdir(filepath.Join(h.Dir, "test.md"), 0700); err != nil {
			t.Fatal(err)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"# New version"}]}]}`))}, nil
	})
	if w = edit(mux, "test", note.Revision); w.Code != 500 {
		t.Fatal(w.Code)
	}
	saved, err := h.previous("test", note.Revision)
	if err != nil || saved == nil || *saved != previous {
		t.Fatal("failed save advanced history", err)
	}
}

func TestUnreadableHistoryPreventsEdit(t *testing.T) {
	h, mux := setup(t)
	w := edit(mux, "test", "")
	var note Note
	json.Unmarshal(w.Body.Bytes(), &note)
	if err := os.MkdirAll(h.historyPath("test", note.Revision), 0700); err != nil {
		t.Fatal(err)
	}
	h.Client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		t.Fatal("model called with unreadable history")
		return nil, nil
	})
	if w = edit(mux, "test", note.Revision); w.Code != 500 {
		t.Fatal(w.Code)
	}
}

func TestDeleteNote(t *testing.T) {
	h, mux := setup(t)
	var note Note
	json.Unmarshal(edit(mux, "delete-me", "").Body.Bytes(), &note)
	edit(mux, "keep-me", "")
	history := h.historyPath(note.ID, note.Revision)
	if err := os.MkdirAll(filepath.Dir(history), 0700); err != nil {
		t.Fatal(err)
	}
	if err := writeMarkdown(history, "old text"); err != nil {
		t.Fatal(err)
	}
	remove := func(id, rev string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		body, _ := json.Marshal(map[string]string{"revision": rev})
		mux.ServeHTTP(w, httptest.NewRequest("DELETE", "/api/notes/"+id, strings.NewReader(string(body))))
		return w
	}
	for _, rev := range []string{"", "stale"} {
		w := remove(note.ID, rev)
		if w.Code != 400 && w.Code != 409 {
			t.Fatal(w.Code, w.Body.String())
		}
		if _, err := h.read(note.ID); err != nil {
			t.Fatal("rejected deletion removed note", err)
		}
		if _, err := os.Stat(history); err != nil {
			t.Fatal("rejected deletion removed history", err)
		}
	}
	h.mu.Lock()
	w := remove(note.ID, note.Revision)
	h.mu.Unlock()
	if w.Code != 409 {
		t.Fatal("delete accepted during edit", w.Code)
	}
	if w := remove("bad.name", note.Revision); w.Code != 400 {
		t.Fatal(w.Code)
	}
	if w := remove(note.ID, note.Revision); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if _, err := h.read(note.ID); !os.IsNotExist(err) {
		t.Fatal("note remains", err)
	}
	if _, err := os.Stat(filepath.Dir(history)); !os.IsNotExist(err) {
		t.Fatal("history remains", err)
	}
	if _, err := h.read("keep-me"); err != nil {
		t.Fatal("unselected note removed", err)
	}
	if w := remove(note.ID, note.Revision); w.Code != 404 {
		t.Fatal(w.Code)
	}
	if w := edit(mux, note.ID, note.Revision); w.Code != 409 {
		t.Fatal("stale edit recreated deleted note", w.Code)
	}
}
