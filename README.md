# CouchControl

A Svelte app switcher with keyboard and gamepad controls.

The **Codex** app opens the local Codex CLI through a web terminal, backed by a
separate Go service and SQLite session history.

Start the backend in one terminal:

```sh
cd backend/codex
go run .
```

Start the frontend in another:

```sh
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

Open <http://127.0.0.1:5173> and add Codex. Opening a new session shows a folder picker starting at Home. Choose a folder to
start the full-screen terminal; returning to the card reconnects its running session.
The picker immediately shows the current path and its visible subfolders.
Cross/A or Enter chooses the current path. Down moves into the subfolder list;
↑/↓ or the joystick browses, and Up from the first subfolder returns to the path.
Cross/A or Enter makes the highlighted folder the current path, then a second
press chooses it. Its subfolders appear automatically. Square/X or Right Arrow
also browses deeper. Left/Circle returns focus to the path or goes to its parent;
Escape cancels. Files and dot-prefixed folders are omitted.
Use the controller’s right face button (B / Circle) to return to the shelf.
Codex must be installed and signed in on the host.

See [the Codex README](backend/codex/README.md) for requirements, configuration,
session persistence, hosting, and verification commands.

Open **Settings → API keys** and save your OpenAI API key under **Whisper API key**
to enable voice transcription. In any app:

- Hold **R2** to record from the computer microphone and see a live waveform.
- Release **R2** to send the recording to Whisper and display its transcript.
- Press **Circle / B** to dismiss. While recording, this discards the audio.
- Press **Cross / A** to copy the transcript and dismiss the modal. If Codex’s
  command line was empty when recording opened and is still empty, the transcript
  is also pasted automatically. Existing input stays untouched.
- Outside the modal, press **Square / X** in Codex to paste the current clipboard
  text into its input. Pasting does not press Enter.
- Press **Cross / A** in Codex to send Enter and submit the text.

The voice overlay captures controller input while open, then returns you to the
previous app. Settings categories support arrow keys or the joystick; press
**Cross / A** or **Enter** to select a category. Left returns to the sidebar
(with keyboard left/right preserved when editing the key). Allow the browser's microphone permission when prompted. Microphone
and clipboard access require localhost or HTTPS. Controller typing is unchanged.

See [shared voice/settings documentation](backend/platform/README.md) for API,
persistence, and testing details.

On the app shelf, select a card and press **Square / X** (keyboard **Delete**) to
open the close confirmation. **Cross / A** or **Enter** confirms; **Circle / B**
or **Escape** cancels. Closing Codex stops its CLI and PTY process group, waits
for cleanup, and deletes that card's saved session and terminal output from
SQLite before removing the card. Other app sessions and workspace files remain.
If cleanup fails, the dialog shows an error and allows retrying. Settings keys
are retained; if Settings is closed, it becomes available in Add an app again.
