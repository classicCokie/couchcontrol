# Voice-controlled Chromium

Browser runs a real headless Chrome/Chromium process on the backend machine.
Pages are top-level documents, not iframes: Google and sites with frame-blocking
headers can render normally. The frontend displays JPEG viewport frames about
twice per second. This is a live visual review surface, not video/audio streaming
or direct mouse/keyboard forwarding. Interaction happens through voice commands
and left-stick scrolling.

Hold R2, speak, release, and confirm to paste into an unchanged empty command
bar. Cross/A runs it. Square/X pastes; Left clears the draft; Circle/B cancels
a pending command or returns to the shelf. The existing shoulder controls still
tile/focus panes. Move the left stick up/down to scroll the displayed page; hold
it to keep scrolling. D-pad up/down also scrolls. Scrolling uses direct Chromium
control without a model call and pauses while a command is running.
Browser itself has no buttons.

Examples: “Open Google”, “Click the search field”, “Type Svelte documentation
and press Enter”, “Scroll down”, “Go back”, “Show phone width”. The model receives
IDs, roles and labels for up to 100 visible top-level controls, and can click
only those IDs. A command that navigates to a new page must finish before asking
to interact with its controls. Password entry is not supported. Controls inside
cross-origin child frames or closed shadow roots are not currently listed.

The model chooses up to four bounded actions: navigate, reload, back, forward,
viewport, click, type, press, scroll, shelf. There is no model-generated JavaScript,
shell access or arbitrary selector execution. URLs, page titles and labels are
untrusted data in the prompt. The backend validates plans before executing them;
runtime failures stop subsequent actions and report that earlier steps may have
completed. Cancellation stops remaining work; it cannot undo an action already
executed by a website. Text is inserted into the selected field; it is not
automatically cleared first. Explicit links targeting a new tab are followed in
the current page; JavaScript-created popup workflows are not yet represented.

Install Google Chrome or Chromium on the backend host. Discovery is automatic;
set `COUCHCONTROL_CHROME` to an executable path if necessary. No user browser
profile, existing login or cookies are read. Each mounted pane gets its own
temporary profile, removed on close/return to shelf. The last URL is saved with
the shelf; login, page history and form state reset when reopening. Up to eight
renderers may coexist. Abandoned renderers idle for 30 minutes are reclaimed on
the next session creation, and all renderers stop on backend shutdown.

**Localhost now means the backend machine**, where Chromium runs. Local files
must still be served over HTTP. Normal TLS checks remain enabled. Authentication,
CAPTCHAs and sites that restrict automated browsers may still require a different
workflow. A failed saved URL does not prevent issuing a new navigation command.

Architecture: `BrowserApp.svelte` is the view; `remote.js` owns session creation,
frame polling and disposal; `commands.js` owns the voice composer and submission
lifecycle. `backend/browser/engine.go` owns Chromium and real page history;
`handler.go` owns interpretation through GPT-4.1 nano with strict structured
output. The server injects the saved OpenAI key; no key reaches the frontend.
Command text, current URL and visible control labels go to OpenAI. Screenshots,
input values, cookies and browser storage are not sent to the model. Requests use
`store:false`; OpenAI's API data policies apply. The app does not log transcripts.

Routes under `/api/browser`: POST `/sessions`, DELETE `/sessions/{id}`,
GET `/sessions/{id}/frame`, POST `/sessions/{id}/scroll` with `direction` (`up` or
`down`), POST `/commands` with `sessionId` and `text`.
Session IDs are random capabilities; routes inherit the host's Host/Origin
checks and no-store headers. Chromium's debugging connection is private to the
backend. The command endpoint responds with the plan and actual page URL/title
after execution. Live frames also reflect redirects and in-page navigation.

Verify with `npm test && npm run build` in `frontend`, and
`go test -race ./... && go vet ./...` in `backend`. Run the actual Chrome regression
with `COUCHCONTROL_BROWSER_TEST=1 go test -race ./browser -run TestChromiumPages -v`.
It uses a temporary local site with `X-Frame-Options: DENY` and CSP frame restrictions,
and tests rendering, text entry, clicking, viewport width, scrolling, history and
cleanup without model calls or personal browser data.

References: [chromedp](https://pkg.go.dev/github.com/chromedp/chromedp),
[GPT-4.1 nano](https://developers.openai.com/api/docs/models/gpt-4.1-nano),
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
