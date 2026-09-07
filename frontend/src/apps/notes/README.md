# Notes

Add **Notes** from the app picker. Each newly opened Notes pane begins with an empty canvas. Move the left stick up or down to slide the sidebar into view. Continue moving it to highlight a note; press Cross / A to open it and dismiss the sidebar. Circle / B dismisses the sidebar without changing notes. Start / Options (the small button to the right of the PlayStation touchpad) creates a blank note.

Hold R2 to record, release to transcribe, and confirm **Update note** in the voice overlay. The notes agent incorporates the instruction into the active document and saves the complete Markdown response. The canvas always displays a sanitized Markdown preview. The note gently pulses while the agent works, with a visible status even on an empty canvas. Reduced-motion preferences disable the pulse and slide animations. Square / X can also send clipboard text.

The right stick moves a cursor through actual rendered text lines and scrolls to keep it visible. L2 toggles the current line’s highlight. Hold L2 while moving the right stick to add each line you pass to the selection. Marked excerpts are captured when dictation starts (or clipboard text is pasted) and sent to the agent as optional context alongside the complete note. Instructions work with no lines marked. Marks clear after an edit, a note switch, or a width change that reflows the preview.

Uses the existing OpenAI key in Settings for transcription and composition. Documents live in `<backend workspace>/.couchcontrol/notes/<id>.md`, where the workspace is the backend's `-cwd` argument. The sidebar is reconstructed from these files; no note content is stored in browser storage.

Failed edits preserve the saved document and retain the instruction for **Reload & retry**. Revision checks reject stale edits between Notes panes. Reload & retry refreshes the document before applying the retained instruction. Markdown writes replace files atomically.

Every agent request includes the current note and its immediately previous saved version (or null if no history exists). Successful edits preserve the prior Markdown under `.history/<note-id>/<new-revision>.md`; this survives restarts and does not appear in the sidebar. No-op edits and failed edits leave the active undo version unchanged. Say “revert to the previous version” to let the agent restore that version. Older versions from before this feature cannot be reconstructed. The notes model is `gpt-4.1-nano-2025-04-14`.
