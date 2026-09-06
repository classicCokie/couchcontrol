package platform

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func setup(t *testing.T, upstream transport) (*Handler, http.Handler, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "settings.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err = Init(db); err != nil {
		t.Fatal(err)
	}
	if upstream == nil {
		upstream = func(*http.Request) (*http.Response, error) { t.Fatal("unexpected Whisper request"); return nil, nil }
	}
	h := New(db, &http.Client{Transport: upstream})
	mux := http.NewServeMux()
	h.Register(mux)
	return h, mux, path
}
func settingsRequest(mux http.Handler, method, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://localhost/api/settings", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}
func audioRequest(data []byte, format string) *http.Request {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", `form-data; name="file"; filename="voice.webm"`)
	header.Set("Content-Type", format)
	file, _ := writer.CreatePart(header)
	file.Write(data)
	writer.Close()
	r := httptest.NewRequest("POST", "http://localhost/api/transcriptions", &body)
	r.Header.Set("Content-Type", writer.FormDataContentType())
	return r
}
func TestSettingsPersistWithoutDisclosingKey(t *testing.T) {
	h, mux, path := setup(t, nil)
	const key = "sk-test-private-value"
	w := settingsRequest(mux, "PUT", `{"whisperApiKey":"`+key+`"}`)
	if w.Code != 200 || strings.Contains(w.Body.String(), key) {
		t.Fatal(w.Body)
	}
	w = settingsRequest(mux, "GET", "")
	if w.Code != 200 || w.Body.String() != "{\"whisperConfigured\":true}\n" {
		t.Fatal(w.Body)
	}
	h.DB.Close()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h.DB = db
	if value, err := h.key(); err != nil || value != key {
		t.Fatal("saved key did not survive restart")
	}
	w = settingsRequest(mux, "PUT", `{"whisperApiKey":""}`)
	if w.Code != 200 || strings.Contains(w.Body.String(), "true") {
		t.Fatal("remove failed")
	}
}
func TestWhisperUploadUsesSavedKeyAndReturnsOnlyTranscript(t *testing.T) {
	_, mux, _ := setup(t, func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != "https://api.openai.com/v1/audio/transcriptions" || r.Header.Get("Authorization") != "Bearer sk-test" {
			t.Fatal("invalid Whisper request")
		}
		if err := r.ParseMultipartForm(1024); err != nil {
			t.Fatal(err)
		}
		if r.FormValue("model") != "whisper-1" || r.FormValue("response_format") != "json" {
			t.Fatal("wrong model or response format")
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()
		data, _ := io.ReadAll(file)
		if string(data) != "recorded bytes" || header.Filename != "recording.webm" || header.Header.Get("Content-Type") != "audio/webm" {
			t.Fatal("audio changed")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"text":"Hello from Whisper.","private":"ignore"}`)), Header: make(http.Header)}, nil
	})
	settingsRequest(mux, "PUT", `{"whisperApiKey":"sk-test"}`)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, audioRequest([]byte("recorded bytes"), "audio/webm;codecs=opus"))
	if w.Code != 200 || w.Body.String() != "{\"text\":\"Hello from Whisper.\"}\n" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}
func TestInvalidAudioAndMissingKeyNeverReachWhisper(t *testing.T) {
	_, mux, _ := setup(t, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, audioRequest([]byte("audio"), "audio/webm"))
	if w.Code != 412 {
		t.Fatal("missing key accepted")
	}
	settingsRequest(mux, "PUT", `{"whisperApiKey":"sk-test"}`)
	for _, tc := range []struct {
		data   []byte
		format string
		status int
	}{
		{nil, "audio/webm", 400}, {[]byte("file"), "text/plain", 415}, {make([]byte, MaxAudioBytes+1), "audio/webm", 413},
	} {
		w = httptest.NewRecorder()
		mux.ServeHTTP(w, audioRequest(tc.data, tc.format))
		if w.Code != tc.status {
			t.Fatalf("want %d got %d", tc.status, w.Code)
		}
	}
}
func TestUpstreamErrorsDoNotExposeKeyOrProviderBody(t *testing.T) {
	_, mux, _ := setup(t, func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 401, Body: io.NopCloser(strings.NewReader(`{"error":"secret-sk-test"}`)), Header: make(http.Header)}, nil
	})
	settingsRequest(mux, "PUT", `{"whisperApiKey":"secret-sk-test"}`)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, audioRequest([]byte("audio"), "audio/webm"))
	if w.Code != 422 || strings.Contains(w.Body.String(), "secret-sk-test") {
		t.Fatal(w.Body)
	}
	var body map[string]string
	if json.Unmarshal(w.Body.Bytes(), &body) != nil || !strings.Contains(body["error"], "Settings") {
		t.Fatal(w.Body)
	}
}
func TestCancelPropagatesToWhisperRequest(t *testing.T) {
	started := make(chan struct{})
	finished := make(chan struct{})
	_, mux, _ := setup(t, func(r *http.Request) (*http.Response, error) {
		close(started)
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	settingsRequest(mux, "PUT", `{"whisperApiKey":"sk-test"}`)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request := audioRequest([]byte("audio"), "audio/webm").WithContext(ctx)
	go func() { defer close(finished); mux.ServeHTTP(httptest.NewRecorder(), request) }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("upload did not start")
	}
	cancel()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("cancel did not reach upstream")
	}
}
func TestNetworkFailureIsActionable(t *testing.T) {
	_, mux, _ := setup(t, func(*http.Request) (*http.Response, error) { return nil, errors.New("network unavailable") })
	settingsRequest(mux, "PUT", `{"whisperApiKey":"sk-test"}`)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, audioRequest([]byte("audio"), "audio/mp4"))
	if w.Code != 502 || !strings.Contains(w.Body.String(), "try again") {
		t.Fatal(w.Body)
	}
}
