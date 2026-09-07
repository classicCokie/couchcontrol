# Claude app

Choose **Add an app → Claude**, open the card, and select a working folder.
CouchControl runs the host's `claude` CLI in a real terminal using its existing
login and configuration. Install and sign in to Claude Code on the host first.

Start the same backend as Codex (`cd backend/codex && go run .`) and the usual
frontend. No second server is needed. Restart the backend after this upgrade.
`CLAUDE_WEB_BINARY` optionally selects a different executable; it accepts a path,
not shell commands or arguments.

Claude supports the same shelf, split panes, folder picker, keyboard input,
clipboard paste (Square/X), voice overlay (R2), submit (Cross/A), and session
reconnect/replay as Codex. Circle/B returns to the shelf; Ctrl+Shift+Backspace
is the keyboard equivalent. Arrow controls navigate Claude's startup dialogs.
The CLI retains its own workspace trust and permission prompts. It launches
with `--permission-mode default`; API resume mode adds `--resume`.

Right stick down, Alt+Down, or **Commands** opens Claude-specific quick commands.
**All Claude commands** opens the installed CLI's full command list. Left clears
a recognized draft; voice auto-paste and commands require a recognized empty
composer. Detection supports Claude's bordered `❯` prompt and dim/gray suggestion
text, and refuses unfamiliar layouts or themes. Clipboard paste and keyboard
input remain available if prompt detection cannot identify an empty composer.

Claude sessions and terminal history use a separate SQLite database:
`claude.sqlite` beside the Codex database, configurable with `-claude-db`.
Each provider allows four live processes. Closing a card stops its process group
and deletes that card's terminal records; Codex sessions are unaffected. The
CLI's own saved conversations remain available through `/resume`. Backend
shutdown stops both providers; restarting marks old terminal sessions interrupted.

Authenticated endpoints mirror Codex under `/api/claude`, including `/auth`,
`/sessions`, and session `/terminal`, `/stop`, and `/close` routes. Claude connects
automatically through `/auth`, which sets its own HttpOnly cookie; there is no
token to copy or enter. The CLI uses the host's existing Claude Code login.
Host and Origin checks still apply. Any client that can reach the service and
use an allowed Host and Origin can connect to Claude's terminal, so deployment
must restrict access to trusted users (for example through a private network
or an authenticated reverse proxy). Claude's cookie is independent of the
Codex cookie and changes on backend restart; the app reconnects automatically.
Both `CODEX_WEB_*` and `CLAUDE_WEB_*` variables are stripped from CLI children.

CLI flags and commands follow the official
[CLI reference](https://code.claude.com/docs/en/cli-reference) and
[command reference](https://code.claude.com/docs/en/commands).
