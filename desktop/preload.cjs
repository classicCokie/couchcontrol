const { contextBridge, ipcRenderer } = require('electron')
let focused = true, native = false, pads = [], sampled = 0
const listeners = new Set()
ipcRenderer.on('desktop:event', (_event, event) => {
  if (event.type === 'focus') { focused = event.focused; native = event.native; pads = []; sampled = 0 }
  if (event.type === 'gamepads') { pads = event.pads; sampled = Date.now() }
  for (const fn of listeners) fn(event)
})
contextBridge.exposeInMainWorld('couchDesktop', {
  browser: (op, args = {}) => ipcRenderer.invoke('desktop:browser', op, args),
  subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
  hasFocus: () => focused,
  getGamepads: () => native ? (Date.now() - sampled < 250 ? pads : []) : Array.from(navigator.getGamepads(), pad => pad && ({ index: pad.index, id: pad.id, connected: pad.connected, mapping: pad.mapping, axes: Array.from(pad.axes), buttons: Array.from(pad.buttons, b => ({pressed:b.pressed, value:b.value})) })),
})
