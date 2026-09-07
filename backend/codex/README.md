# Codex webshell

The Go service for CouchControl's Codex and Claude terminal apps. It runs the host's installed
Codex CLI in a real PTY and streams terminal bytes over authenticated WebSockets.
The shared Go module is in `backend/go.mod`; app-wide settings and transcription
are isolated in `backend/platform`. The Svelte client lives in `frontend/src/apps/codex/`. No OpenAI API key is stored
by this service; Codex uses the host user's existing CLI login and configuration.

The same process also serves `/api/claude` with a separate database and CLI
manager. See [Claude setup and controls](../../frontend/src/apps/claude/README.md).

## Run locally

Requires macOS or Linux, Go 1.25+, a supported Node version (22.12+ or 24+), and
the Codex CLI installed and signed in on the host (`codex login`).

From the repository root, start the backend:

```sh
cd backend/codex
go run .
```

In a second terminal, from the repository root:

```sh
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

Open <http://127.0.0.1:5173>, choose **Add an app → Codex**, then open its card.
For a new session, choose its working folder in the shared folder picker, which
starts at the host’s home directory. The terminal then fills the app and starts automatically. Reopening a card reconnects its running session;
opening a card whose session ended starts a new one. The folder picker closes before the terminal starts.

Use the controller’s **right face button (B / Circle)** to return to the shelf.
The keyboard shortcut is **Ctrl+Shift+Backspace**. Terminal keyboard input
continues to work. **Square / X** reads the current system clipboard and pastes
its text into the Codex input without submitting. The global R2 voice overlay
copies a transcript and dismisses itself. When the Codex composer was empty on
opening the overlay and remains empty, it also pastes the transcript automatically.
Existing input is preserved. Cross / A sends Enter to submit.

The backend listens on `127.0.0.1:8787`. Vite proxies `/api/codex`, including
WebSocket upgrades, to it. Restart the Go process after backend edits; Vite
automatically reloads frontend edits.

## Configuration

Run `go run . -help` for all flags. Defaults assume the working directory is
`backend/codex`.

| Setting | Default | Purpose |
| --- | --- | --- |
| `-listen` | `127.0.0.1:8787` | HTTP address |
| `-db` | `data/codex.sqlite` | SQLite database |
| `-claude-db` | `claude.sqlite` beside `-db` | Separate Claude session database |
| `CLAUDE_WEB_BINARY` | `claude` on `PATH` | Installed Claude Code executable |
| `-cwd` | `../..` | Fallback working directory for API clients without a selected folder |
| `-static` | `../../frontend/dist` | Frontend build served by Go; empty disables |
| `-origins` | localhost / 127.0.0.1 on 8787, 5173, 4173 | Exact permitted browser origins and HTTP hosts |
| `CODEX_WEB_BINARY` | `codex` on `PATH` | Installed CLI executable; arguments cannot be supplied here |
| `CODEX_WEB_TOKEN` | Random token printed at startup | Optional stable access token, at least 32 characters |

For a single server, run `npm run build` in `frontend`, then start the Go service
and open <http://127.0.0.1:8787>. Run only one backend per database.

For another device, serve the built frontend through the Go service or a TLS
reverse proxy. Set `-listen` and `-origins` explicitly for the desired address,
for example `-listen 0.0.0.0:8787 -origins http://192.168.1.50:8787` on a trusted
LAN. For internet access, use HTTPS and proxy WebSocket upgrades while preserving
the browser's Host and Origin. Access to this app grants control of the host's
Codex account and workspace; the token is for the host operator, not a multiuser
permission system. A remote browser must first establish its authentication
cookie using `POST /api/codex/auth` with JSON `{"token":"<host access token>"}`
from an allowed origin. Local browsers establish their cookie automatically;
forwarded requests do not qualify for automatic authentication.

## Persistence and lifecycle

- SQLite stores session names, directories, timestamps, status, exit codes,
  terminal dimensions, and raw output bytes. Output is never interpreted as HTML.
- Sessions continue while the backend runs, even when the browser disconnects or
  the app closes. Reopening a session replays its history and reconnects input.
- Each card reconnects the running session with its title. Concurrent opens in
  the same browser share a pending launch. The shelf itself remains in memory;
  after a page refresh, adding the same Codex card reconnects its saved running
  session.
- **Square / X** on a selected shelf card opens a close confirmation. Confirming
  stops its CLI process group and removes that card’s sessions and saved output.
  Keyboard users can press Delete, then Enter or Escape. Closing one card does
  not shut down the shared Go service or other sessions.
- Session metadata and terminal history remain in SQLite until explicitly closed and are accessible
  through the existing authenticated API. The full-screen app has no history
  management UI. `POST /api/codex/sessions/{id}/close` stops and reaps the process
  before cascading deletion of its metadata and output; it is safe to retry. `DELETE /api/codex/sessions/{id}` removes a stopped session and
  its output. History has no automatic expiration.
- Backend shutdown stops and reaps its PTY children. A restart marks any stale
  running records as interrupted. Live OS processes cannot be restored from SQLite.
- After a backend restart, the app requests a folder for a fresh CLI session.
  Codex manages its own conversation state in its normal host data directory;
  the webshell’s SQLite terminal archive is separate from that state. The API
  still accepts `mode: "resume"` for operator-created sessions.
- At most four CLI processes per provider run at once. Codex uses `--no-alt-screen`,
  `--sandbox workspace-write`, and `--ask-for-approval on-request`.
- Authentication uses an HttpOnly, SameSite=Strict cookie scoped to `/api/codex`.
  Host validation and exact Origin checks protect API writes and WebSockets.
  Token-free cookie setup requires a loopback peer and loopback browser origin,
  with no forwarding headers. Remote clients still require a token.
  A generated token changes on each restart; a configured token stays stable.
  `CODEX_WEB_*` and `CLAUDE_WEB_*` environment variables are omitted from the CLI child environment.

## Verify

```sh
# backend (includes shared platform tests)
go test -race ./...
go vet ./...

# frontend
npm test
npm run build
```

Backend tests use an actual PTY with a fake CLI and exercise authentication,
origin and host rejection, input/output, Unicode, resizing, reconnect/replay,
process exit, stopping, deletion, invalid directories, and SQLite crash recovery.
They do not send prompts to OpenAI.

CLI behavior follows the [official Codex CLI reference](https://developers.openai.com/codex/cli/reference).
