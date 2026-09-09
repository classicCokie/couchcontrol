# Electron browser implementation handoff

## Task and scope

The user chose Electron to replace CouchControl's screenshot-based browser pane with a real, locally rendered browser view that can still be controlled through natural-language/voice commands and a gamepad. Implement this in this worktree. The preparation turn only created the worktree and this document; no implementation has started.

**When the implementation and validation are complete, delete this handoff document.** Move any lasting setup or architecture information into the normal project documentation before deleting it. Do not leave this temporary task document in the finished change.

## Worktree isolation

- Worktree: `/home/hans/Project/couchcontrol-wt/couchcontrol-electron`
- Branch: `feat/electron-browser`
- Starting commit: `5eedd0d` on local `main` (no remote refresh was performed).
- The source worktree was clean at creation.
- The user will work on another task in another tab. Keep all implementation changes in this worktree. Do not switch, reset, clean, or edit the sibling `couchcontrol` or `couchtree-prod` worktrees.
- Use separate development ports and task-local data if running alongside another instance. Do not restart production services, deploy, or merge as part of this task.

## Current architecture to inspect

- `frontend/src/apps/browser/README.md`: current behavior, limits, endpoints, and browser checks.
- `frontend/src/apps/browser/BrowserApp.svelte`: command bar and JPEG display.
- `frontend/src/apps/browser/remote.js`: backend browser session creation, frame polling, scrolling, and disposal.
- `frontend/src/apps/browser/commands.js`: voice command composition and submission lifecycle.
- `backend/browser/engine.go`: headless Chromium controlled with Go `chromedp`/CDP, screenshots, temporary profiles, and page actions.
- `backend/browser/handler.go`: natural-language interpretation and bounded action execution.
- `frontend/src/`: inspect app layout, shelf, tiling, controller input, and shared voice behavior before integrating native views.
- `backend/codex/`, `backend/platform/`, and their READMEs: Go service startup, shared APIs, credential handling, and terminal integration.
- `frontend/package.json`: existing Svelte/Vite scripts; `backend/go.mod`: Go dependencies.

The existing implementation is chromedp-based, not Playwright. The UI polls JPEG frames after approximately 500 ms delays. Mounted browser panes currently own temporary backend browser profiles, and reopening preserves only the last URL. Controller polling currently depends on the app window being focused and visible. The existing command model accepts a bounded action vocabulary, with direct scrolling bypassing the model.

## Agreed direction

1. Add an Electron desktop shell around the existing Svelte interface and reuse the Go backend where appropriate.
2. Render website content in Electron `WebContentsView` instances managed by the main process. The desktop browser must display live web content rather than screenshot frames or iframe embedding.
3. Preserve the CouchControl shelf, browser panes, tiling, voice command bar, and gamepad-oriented interaction.
4. Give the agent/command interpreter control over the same web contents the user sees. Electron's `webContents.debugger` exposes CDP; a narrow application adapter can map existing commands to it. MCP is optional, not a mandated dependency or a substitute for native rendering. Establish reliable shared browser control first.
5. Keep direct actions such as scrolling immediate, without requiring an LLM round trip. Continue using natural-language commands for semantic interactions such as finding and clicking a labeled control.

## Implementation considerations

- Native view placement must follow pane bounds, resize, focus, tiling, shelf transitions, and visibility. Account for overlays and voice dialogs: native views are not ordinary Svelte DOM children, so DOM stacking alone is insufficient.
- Route controller input and voice activation reliably when the website view has focus. Verify this explicitly; retaining only the shell renderer's current polling may be insufficient.
- Keep shell/preload privileges separate from arbitrary websites. Use sandboxed website renderers, no Node integration for web content, context isolation, and narrowly scoped validated IPC. Do not expose unrestricted CDP, shell execution, backend credentials, or arbitrary privileged IPC to websites.
- Prefer persistent, app-owned browser sessions so logins survive reopening; do not silently import the user's personal Chrome profile. Define how browser cards map to live views and session storage.
- Provide coherent navigation/history and handling of new windows, popup flows, downloads, and website permissions. Document any deliberately deferred behavior. Make an early decision about whether popups become managed tabs or panes.
- Keep the existing command cancellation/error behavior and validate actions against the current page. Account for navigation making previously observed controls stale.
- Establish a practical development/startup path for Electron plus the Go service. Identify who owns the backend process and its shutdown. Keep existing terminal, mail, notes, and voice integrations working.
- Preserve the existing web entry point unless a concrete incompatibility requires a scoped change; the Electron browser should use its native adapter. Avoid unrelated web/production refactors.
- Localhost in the new browser means the desktop machine, which may differ from the Go backend host. Document this change.
- Electron embeds Chromium but does not automatically provide every Chrome browser feature. Do not promise personal Chrome extensions, password-manager integration, or DRM compatibility without verification.

## Suggested sequence

1. Inspect repository instructions and the current shell/browser contracts; choose the smallest maintainable native bridge.
2. Prove one live website view can render inside the shell and that one command targets that exact view.
3. Integrate layout, controller focus, voice overlays, navigation, and persistent sessions.
4. Complete lifecycle handling and practical setup documentation.
5. Validate the integrated experience, remove this document, and summarize the finished change and remaining limitations.

## Acceptance and validation

- A website is visibly rendered by a native Electron view, with smooth scrolling and live page updates independent of JPEG polling.
- Voice/natural-language commands act on the page being displayed; direct controller scrolling works while the page has focus.
- Browser panes behave correctly across resizing, tiling, switching apps, shelf transitions, and voice overlays.
- Navigation/history and the chosen popup behavior work, with app-owned login/session persistence across reopening.
- Arbitrary website content cannot invoke privileged shell APIs; browser and backend processes are cleaned up appropriately.
- Existing app workflows remain usable, and documented development commands work from this worktree.
- Run relevant existing frontend tests and build (`npm test`, `npm run build` in `frontend`), plus appropriate Go tests/vetting for backend changes (`go test ./...`, `go vet ./...` in `backend`; race checks where useful). Add meaningful tests for new bridge/lifecycle boundaries rather than tests that merely mirror implementation.
- Perform actual Electron UI smoke checks, including native focus and overlays. If the environment lacks a graphical display, report that limitation and distinguish automated checks from unverified manual behavior.
- Delete `ELECTRON_BROWSER_HANDOFF.md` after completion.

## Reference starting points

Verify current APIs when implementing:

- https://www.electronjs.org/docs/latest/api/web-contents-view
- https://www.electronjs.org/docs/latest/api/web-contents
- https://www.electronjs.org/docs/latest/api/debugger
- https://www.electronjs.org/docs/latest/tutorial/security

The user selected the Electron direction over a Chrome extension or an upgraded remote stream. Do not substitute one of those architectures without discussing a concrete blocker.
