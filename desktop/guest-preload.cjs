// No API is exposed to the page. Only controller state leaves this isolated world.
const { ipcRenderer } = require('electron')
setInterval(() => {
  if (!document.hasFocus() || document.hidden) return
  try {
    ipcRenderer.send('desktop:gamepads', Array.from(navigator.getGamepads(), pad => pad && ({ index: pad.index, id: pad.id, connected: pad.connected, mapping: pad.mapping, axes: Array.from(pad.axes), buttons: Array.from(pad.buttons, b => ({ pressed: b.pressed, value: b.value })) })))
  } catch { /* Unsupported controller. */ }
}, 32)
