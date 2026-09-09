// The shell sends geometry and bounded intent only; page execution stays in main.
export function createNativeBrowser({ bridge, id, initialUrl = '', changed, schedule = requestAnimationFrame, unschedule = cancelAnimationFrame }) {
  let stopped = false, opening, timer, unsubscribe, lastLayout = '', element, frame = null
  const invoke = (op, args = {}) => bridge.browser(op, { id, ...args })
  const report = error => { if (!stopped) changed({ frame, error: error.message }) }
  function open() {
    return opening ||= invoke('open', { url: initialUrl }).then(page => {
      if (stopped) return
      frame = page; changed({ frame, error: '' })
    })
  }
  async function layout() {
    if (stopped) return
    timer = schedule(layout)
    if (!element?.isConnected) return
    const rect = element.getBoundingClientRect()
    const moving = element.ownerDocument.getAnimations().some(animation => animation.playState === 'running' && animation.effect?.target?.contains(element))
    const next = { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, visible: !moving && rect.width > 0 && rect.height > 0 }
    const key = JSON.stringify(next)
    if (key === lastLayout) return
    lastLayout = key
    try { await open(); if (!stopped) await invoke('layout', next) } catch (error) { report(error) }
  }
  return {
    start(node) {
      element = node
      unsubscribe = bridge.subscribe(event => {
        if (event.type === 'page' && event.id === id) { frame = event.page; changed({ frame, error: event.error || '' }) }
        if (event.type === 'download') changed({ frame, error: event.message })
      })
      void open().catch(report)
      timer = schedule(layout)
    },
    async scroll(direction) { try { await open(); if (!stopped) await invoke('action', { action: 'scroll', value: direction }) } catch (error) { report(error) } },
    async action(action, value = '') { try { await open(); if (!stopped) await invoke('action', { action, value }) } catch (error) { report(error) } },
    async interpret(body, signal) {
      await open()
      if (stopped || signal.aborted) throw new DOMException('Canceled', 'AbortError')
      const cancel = () => { void invoke('cancel').catch(() => {}) }
      signal.addEventListener('abort', cancel, { once: true })
      try { return await invoke('command', { text: body.text }) } finally { signal.removeEventListener('abort', cancel) }
    },
    dispose() {
      stopped = true; unschedule(timer); unsubscribe?.()
      if (opening) void invoke('release').catch(() => {})
    },
  }
}
