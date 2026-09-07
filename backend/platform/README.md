# Shared settings, folder selection, and voice transcription

These app-wide routes are registered by the host service in `backend/codex` and
use its exact Host/Origin checks and SQLite database. Settings and voice never
require a Codex access token, Codex login, or a running Codex session. Only the
saved OpenAI API key is used to authenticate the Whisper request. The Go module
lives at `backend/go.mod`. Frontend code is grouped in `src/features/voice` and
`src/apps/settings`, separately from the Codex terminal.

## Settings

Settings is installed on the app shelf by default. Its sidebar contains the
**API keys** category. Navigate with arrow keys or the joystick and select with
Cross/A or Enter. Left returns to categories; keyboard left/right inside the API
key field retain their editing behavior. Paste an OpenAI API key into **OpenAI API
key** and save. The same key also powers Browser command interpretation. The setting survives backend restarts in the SQLite `settings`
table. The existing database is owner-readable only. GET responses reveal only
whether a key is configured; they never return the key. An empty key removes it.

- `GET /api/settings` → `{ "whisperConfigured": true | false }`
- `PUT /api/settings` with JSON `{ "whisperApiKey": "..." }`
- No app access-token exchange is needed for these routes. Codex’s cookie and
  `/api/codex/auth` endpoint apply only to the terminal app.

## R2 recording

R2 is standard gamepad button 7; Cross/A and Circle/B are buttons 0 and 1. Trigger
press/release edges use analog hysteresis. Holding the trigger starts one capture;
release stops it and uploads only the finished audio. Circle cancels first if
Circle and release happen in the same poll. Controller disconnection, focus loss,
and page hiding cancel an active recording rather than submit it. Permission
responses received after cancellation have their microphone tracks stopped.

The slide-up modal uses a microphone analyser for its waveform. It blocks input
to the app below it, including terminal input, and restores focus when dismissed.
The transcript occupies its lower portion. Cross/A copies; Circle/B dismisses.
A successful copy immediately dismisses the modal and restores focus to the
previous app. A failed copy keeps the transcript visible so it can be retried.
There is also a Copy button for browsers requiring a direct click for clipboard
permission. Outside the modal, Square/X pastes the current system clipboard text
into Codex using the terminal’s paste handling; it does not submit the prompt.
Clipboard reads that finish after leaving the app or opening the modal are
discarded. If the browser denies clipboard reading, Codex shows an actionable
Paste button without changing terminal output.

On first use, approve the browser microphone prompt. If that prompt interrupted
the controller gesture, release R2 and hold it again. Browser recording requires
localhost or HTTPS. The backend never records from a different machine's mic.

## Whisper API

`POST /api/transcriptions` accepts multipart form data with a `file` field. It
forwards recorded audio to `https://api.openai.com/v1/audio/transcriptions`, using
`model=whisper-1`, `response_format=json`, and the stored API key. It returns only
`{ "text": "..." }`.

Audio is kept in memory and is not saved to SQLite or disk. Neither recordings
nor transcripts are logged or retained by CouchControl. Upstream data handling
is governed by the OpenAI API. Cancellation during capture sends no audio;
canceling an upload aborts its HTTP request and ignores late responses, but cannot
undo audio already received by the upstream service.

The browser chooses supported WebM/Opus, MP4, or Ogg audio recording. Both sides
limit audio to 24 MB (below Whisper's documented 25 MB limit). Oversized captures
are canceled, not automatically submitted. The backend permits two concurrent
transcription requests and applies a 120-second upstream timeout. Missing keys,
unsupported formats, empty recordings, key rejection, rate limits, and network
errors return actionable errors without disclosing keys or raw provider errors.

[Official speech-to-text documentation](https://developers.openai.com/api/docs/guides/speech-to-text)
and [transcription API reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create).

## Verification

From `backend`: `go test -race ./...` and `go vet ./...`.
From `frontend`: `npm test` and `npm run build`.

Tests cover trigger edges, cancellation races, late microphone permission,
recording finalization, request abortion, transcript copying, SQLite persistence,
independence from Codex authentication, upload validation, and Whisper multipart requests.
Provider responses are mocked; tests do not require a real key or incur API usage.

## Native folder picker

`GET /api/folders` starts at the host user's home directory. An optional absolute
`path` query parameter lists another directory. The response contains `path`,
`parent` (null at the filesystem root), `home`, and `folders: [{name, path}]`.
Only visible directories and visible symlinks to directories are included;
ordinary files and all dot-prefixed entries are excluded. Navigation is not restricted to Home. OS permissions still apply, and
the route uses the same Host/Origin checks as the other platform APIs without
requiring Codex authentication. Listings are read on demand and not persisted.

The native picker lives in `frontend/src/features/folders`, mounted and routed by
`App.svelte`. Any app can call `getContext(FOLDER_PICKER)({ initialPath, title })`,
importing the symbol from that feature's `context.js`. Both options are optional.
The promise resolves to an absolute directory path, or null on cancellation.
The current path and its subfolders appear immediately with an animated reveal.
Cross/A or Enter confirms the path. Down moves into the list; Up from the first
subfolder returns to the path. Cross/A or Enter makes the highlighted subfolder
the new current path before final confirmation. Square/X or Right Arrow also
browses deeper. Left/Circle returns focus to the path or goes to its parent;
Escape cancels.
There are no visible headings, toolbars, or action buttons.
Codex requests a folder only when starting a new process and persists the choice
with its session in SQLite. Returning to a running session reuses its directory.

Voice capture exposes a generic successful-copy callback. The main app routes
it to the active Codex terminal or Browser command bar only if its empty composer
has not changed since R2 opened. Clipboard success closes the modal before pasting;
pasting never submits. Other apps and existing drafts keep normal copy behavior.

The host also registers `POST /api/browser/commands` from the independent
`backend/browser` package, injecting `OpenAIKey` as a server-side credential
provider. This endpoint shares Host/Origin protection without requiring a Codex
session. See [Browser documentation](../../frontend/src/apps/browser/README.md).
