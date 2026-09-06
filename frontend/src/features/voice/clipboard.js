export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return } catch { /* Try the focused document's copy command. */ }
  const previous = document.activeElement
  const field = document.createElement('textarea')
  field.value = text
  field.readOnly = true
  field.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none'
  // Keep the selection inside the active modal; the app underneath is inert.
  ;(document.querySelector('[data-voice-dialog]') || document.body).append(field)
  field.select()
  try {
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable')
  } finally { field.remove(); previous?.focus({ preventScroll: true }) }
}
