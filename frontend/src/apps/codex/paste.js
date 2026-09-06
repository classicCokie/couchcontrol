// Read the actual system clipboard on every press. A pending browser permission
// must not paste into a replaced session, another app, or the voice overlay.
export function createClipboardPaste({ read, target, paste, report }) {
  let pending = false
  return async () => {
    const destination = target()
    if (!destination || pending) return
    pending = true
    report('')
    try {
      const text = await read()
      if (target() !== destination) return
      if (!text) { report('The clipboard does not contain text.'); return }
      paste(text)
    } catch {
      if (target() === destination) report('Clipboard access was blocked. Select Paste to allow access, then use Square.')
    } finally { pending = false }
  }
}
