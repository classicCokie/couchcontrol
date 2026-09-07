package browser

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func request(h *Handler, body string) *httptest.ResponseRecorder {
	mux := http.NewServeMux()
	h.Register(mux)
	r := httptest.NewRequest("POST", "/api/browser/commands", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}
func TestInterpreter(t *testing.T) {
	h := New(func() (string, error) { return "test-key", nil }, &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != "https://api.openai.com/v1/responses" || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatal("incorrect provider request")
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if body["store"] != false || body["model"] != "gpt-4.1-nano-2025-04-14" {
			t.Fatal("incorrect model or storage")
		}
		format := body["text"].(map[string]any)["format"].(map[string]any)
		if format["strict"] != true || format["type"] != "json_schema" {
			t.Fatal("missing strict schema")
		}
		if !strings.Contains(body["input"].(string), "open localhost") {
			t.Fatal("missing command")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"{\"commands\":[{\"action\":\"navigate\",\"value\":\"http://localhost:3000/\"}],\"message\":\"Opening local app\"}"}]}]}`))}, nil
	})})
	w := request(h, `{"text":"open localhost port 3000","currentUrl":"","canBack":false,"canForward":false}`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "http://localhost:3000/") || strings.Contains(w.Body.String(), "test-key") {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
}
func TestRejectInputAndMissingKey(t *testing.T) {
	h := New(func() (string, error) { return "", nil }, nil)
	for _, body := range []string{`{}`, `{"text":""}`, `{"text":"ok","unknown":true}`, `{"text":"ok","currentUrl":"file:///tmp/a"}`, `{"text":"ok"}{}`} {
		if w := request(h, body); w.Code != 400 {
			t.Fatalf("%s: %d", body, w.Code)
		}
	}
	if w := request(h, `{"text":"reload"}`); w.Code != 412 {
		t.Fatal(w.Code)
	}
}
func TestInvalidProviderResponses(t *testing.T) {
	for _, body := range []string{
		`{"status":"incomplete","output":[]}`,
		`{"status":"completed","output":[{"type":"message","content":[{"type":"refusal"}]}]}`,
		`{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"{\"commands\":[{\"action\":\"eval\",\"value\":\"alert(1)\"}],\"message\":\"ok\"}"}]}]}`,
		`{"status":"completed","output":[]}`,
	} {
		h := New(func() (string, error) { return "secret", nil }, &http.Client{Transport: transport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
		})})
		w := request(h, `{"text":"reload"}`)
		if w.Code < 400 || strings.Contains(w.Body.String(), "secret") {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
	}
}
func TestPlanValidation(t *testing.T) {
	for _, c := range []Command{{"navigate", "javascript:alert(1)"}, {"navigate", "https://user:pass@example.com"}, {"viewport", "100000"}, {"reload", "unexpected"}, {"execute", ""}} {
		if validPlan(Plan{Commands: []Command{c}, Message: "ok"}) {
			t.Fatal(c)
		}
	}
	if !validPlan(Plan{Commands: []Command{}, Message: "Which address?"}) {
		t.Fatal("clarification rejected")
	}
}
