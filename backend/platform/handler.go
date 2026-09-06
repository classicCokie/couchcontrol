// Package platform provides app-wide settings and speech transcription.
package platform

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"time"
)

const MaxAudioBytes = 24_000_000

func Init(db *sql.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
	return err
}

type Handler struct {
	DB     *sql.DB
	Client *http.Client
	slots  chan struct{}
}

func New(db *sql.DB, client *http.Client) *Handler {
	if client == nil {
		client = &http.Client{Timeout: 120 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	return &Handler{DB: db, Client: client, slots: make(chan struct{}, 2)}
}

func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/settings", h.settings)
	mux.HandleFunc("GET /api/folders", h.folders)
	mux.HandleFunc("PUT /api/settings", h.saveSettings)
	mux.HandleFunc("POST /api/transcriptions", h.transcribe)
}

func reply(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}
func fail(w http.ResponseWriter, status int, message string) {
	reply(w, status, map[string]string{"error": message})
}
func (h *Handler) key() (string, error) {
	var key string
	err := h.DB.QueryRow("SELECT value FROM settings WHERE key='whisper_api_key'").Scan(&key)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return key, err
}
func (h *Handler) settings(w http.ResponseWriter, r *http.Request) {
	key, err := h.key()
	if err != nil {
		fail(w, 500, "Could not load settings.")
		return
	}
	reply(w, 200, map[string]bool{"whisperConfigured": key != ""})
}
func (h *Handler) saveSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Key *string `json:"whisperApiKey"`
	}
	if r.Header.Get("Content-Type") != "application/json" || json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&body) != nil || body.Key == nil {
		fail(w, 400, "Enter a Whisper API key.")
		return
	}
	key := strings.TrimSpace(*body.Key)
	if len(key) > 512 || strings.ContainsAny(key, "\r\n\t ") {
		fail(w, 400, "Enter a valid API key without spaces.")
		return
	}
	_, err := h.DB.Exec("INSERT INTO settings(key,value) VALUES('whisper_api_key',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key)
	if err != nil {
		fail(w, 500, "Could not save settings.")
		return
	}
	reply(w, 200, map[string]bool{"whisperConfigured": key != ""})
}

func (h *Handler) transcribe(w http.ResponseWriter, r *http.Request) {
	key, err := h.key()
	if err != nil {
		fail(w, 500, "Could not load settings.")
		return
	}
	if key == "" {
		fail(w, 412, "Add your Whisper API key in Settings to enable transcription.")
		return
	}
	select {
	case h.slots <- struct{}{}:
		defer func() { <-h.slots }()
	default:
		fail(w, 429, "Another recording is being transcribed. Try again shortly.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, MaxAudioBytes+8192)
	reader, err := r.MultipartReader()
	if err != nil {
		fail(w, 400, "Send an audio recording.")
		return
	}
	part, err := reader.NextPart()
	if err != nil || part.FormName() != "file" {
		fail(w, 400, "Send an audio recording.")
		return
	}
	defer part.Close()
	mediaType, _, err := mime.ParseMediaType(part.Header.Get("Content-Type"))
	extensions := map[string]string{"audio/webm": "webm", "video/webm": "webm", "audio/mp4": "mp4", "video/mp4": "mp4", "audio/ogg": "ogg", "audio/wav": "wav", "audio/mpeg": "mp3"}
	extension, ok := extensions[mediaType]
	if err != nil || !ok {
		fail(w, 415, "This audio format is not supported.")
		return
	}
	audio, err := io.ReadAll(io.LimitReader(part, MaxAudioBytes+1))
	if err != nil || len(audio) > MaxAudioBytes {
		fail(w, 413, "Recording is too large. Keep it below 24 MB.")
		return
	}
	if len(audio) == 0 {
		fail(w, 400, "The recording was empty. Hold R2 and try again.")
		return
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", `form-data; name="file"; filename="recording.`+extension+`"`)
	header.Set("Content-Type", mediaType)
	file, _ := writer.CreatePart(header)
	file.Write(audio)
	writer.WriteField("model", "whisper-1")
	writer.WriteField("response_format", "json")
	writer.Close()
	request, err := http.NewRequestWithContext(r.Context(), "POST", "https://api.openai.com/v1/audio/transcriptions", &body)
	if err != nil {
		fail(w, 500, "Could not prepare transcription.")
		return
	}
	request.Header.Set("Authorization", "Bearer "+key)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := h.Client.Do(request)
	if err != nil {
		if r.Context().Err() == nil {
			fail(w, 502, "Could not reach Whisper. Please try again.")
		}
		return
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		switch response.StatusCode {
		case 401, 403:
			fail(w, 422, "Whisper rejected the API key. Update it in Settings.")
		case 429:
			fail(w, 429, "Whisper's usage or rate limit was reached. Check your API billing or try again later.")
		default:
			fail(w, 502, "Whisper could not transcribe this recording. Please try again.")
		}
		return
	}
	var result struct {
		Text string `json:"text"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 2*1024*1024)).Decode(&result) != nil {
		fail(w, 502, "Whisper returned an unreadable response.")
		return
	}
	reply(w, 200, result)
}
