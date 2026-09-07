# CouchControl

A Svelte app switcher with keyboard and gamepad controls.

To install CouchControl with its own icon and window, open the running app in
Chrome or Edge and choose **Install CouchControl** from the address bar or browser
menu. In Safari on macOS, use **File → Add to Dock**; on iPhone or iPad, use
**Share → Add to Home Screen**. Use HTTPS or localhost for installation.
The installed app still needs the CouchControl server running: no service worker,
offline mode, or additional caching is included.

The **Browser** app has a single natural-language command bar. Hold R2, speak,
release, and press Cross/A to paste the transcript into an empty command bar.
Press Cross/A again to run it. Try “Open localhost on port three thousand”,
“Show it at phone width”, “Reload”, or “Go back”. Square/X pastes clipboard text;
D-pad/left-stick Left clears the draft so you can record a replacement.
The saved OpenAI key powers both transcription and the small command model.
Each card remembers its last URL. A separate Chrome/Chromium process on the
backend renders the page and sends a live view to Browser, including sites that
block iframe embedding. Say “Click the search field”, “Type hello”, “Press Enter”,
or “Scroll down” to interact. Chrome must be installed on the backend host;
`COUCHCONTROL_CHROME` can specify its executable. Localhost now refers to that
backend machine. See the [Browser app notes](frontend/src/apps/browser/README.md)
for session lifetime and current interaction limits.

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

Open **Settings → API keys** and save your OpenAI API key under **OpenAI API key**
to enable voice transcription. In any app:

- Hold **R2** to record from the computer microphone and see a live waveform.
- Release **R2** to send the recording to Whisper and display its transcript.
- Once transcription finishes, hold and release **R2** again to append more
  words to the same transcript. Earlier text remains visible while recording
  and transcribing. An empty or failed additional take preserves your draft.
- Press **Circle / B** to dismiss. While recording, this discards the audio.
- Press **Cross / A** to copy the complete transcript and dismiss the modal. If Codex’s
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

**App groups** put two workspaces side by side:

- With an app open, press **L1 / LB** to tile it left or **R1 / RB** to tile it
  right. The app moves smoothly into place and the empty half receives focus.
  Split and merge animations use native transform interpolation, measuring the
  pane only before and after the layout change. Focus changes do not restart
  them. Reduced-motion preferences skip the animation.
- Press **Cross / A** (the bottom face button) or **Enter** in the empty half to
  open the same vertical card picker as Add an app. Choose with **↑ / ↓**, then
  confirm to open a new app on that side. **Circle / B** or **Escape** cancels
  the picker and keeps the empty half available.
- With the empty half selected, press **Triangle / Y** or keyboard **Delete**
  to close that half and restore the remaining app to full screen. This also
  works inside its add picker and preserves the running app and its shelf card.
- Once grouped, **L1 / R1** focuses the left or right app. Keyboard users can
  use **Alt + Left / Right** to tile or switch focus; mouse users can use the
  tile buttons and each pane's title bar. The focused pane has a light border.
  Terminal confirm, paste, and voice paste go to the focused app.
- Return to the shelf with **Circle / B** (or the app's usual keyboard back
  shortcut). The group appears as a merged card with both app colors, icons,
  and names. Reopening restores the layout and focus. The shelf and groups are
  saved in this browser, including across reloads when local storage is available.
- **Square / X** or **Delete** on a group card opens a confirmation to close
  both apps, including cleanup of any Codex sessions. Returning to the shelf
  alone keeps the group.

These tiles contain CouchControl workspaces inside the browser; they do not
move native operating-system windows.

With an occupied pane focused in an app group, **Triangle / Y** opens a
confirmation to close just that app. **Cross / A** confirms and **Circle / B**
cancels. After successful cleanup, the other app expands to full screen and
keeps its session. Keyboard users can use **Alt + Delete**. Triangle on an
empty half continues to close it immediately.

Inside **Codex**, push the **right stick down** to open **Quick commands**, or
click **Commands** / press **Alt + Down**. Use either stick vertically or the
D-pad to browse; **Cross / A** selects and **Circle / B** cancels. The menu
includes `/clear`, `/model`, `/compact`, `/status`, and other common commands.
**All Codex commands** opens the installed CLI's complete slash-command list.
**Clear input** erases the entire draft, including multiple lines, while keeping
the current conversation. From the Codex prompt, **D-pad Left** or **left stick
left** performs the same action. In native Codex pickers, left retains its normal
navigation behavior. `/clear` remains a separate command that starts a fresh chat.
For native pickers such as model selection, use **↑ / ↓** and **Cross / A**;
**Circle / B** backs out of the picker. Commands require an empty Codex prompt
except **Clear input**, and are never inserted over an existing draft or sent to
a replacement session. Terminal focus notifications do not count as prompt edits.
The quick menu is specific to Codex and does not open in other apps.

The command names and descriptions follow the
[official Codex CLI command reference](https://learn.chatgpt.com/docs/developer-commands#built-in-slash-commands).
