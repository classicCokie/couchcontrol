// Owns the renderer lifecycle, independently of the command composer and shell.
export function createRemoteBrowser({ request, changed, initialUrl = '', schedule = setTimeout, unschedule = clearTimeout }) {
  let id, opening, stopped = false, timer, polling, scrolling, frame = null
  async function close(value) {
    try { await request(`/browser/sessions/${value}`, { method: 'DELETE' }) } catch { /* Abandoned sessions expire server-side. */ }
  }
  async function open() {
    if (id) return id
    if (stopped) throw new Error('Browser closed.')
    if (!opening) opening = request('/browser/sessions', { method: 'POST', body: { url: initialUrl } }).then(async result => {
      if (stopped) { await close(result.id); throw new Error('Browser closed.') }
      id = result.id; return id
    }).finally(() => { opening = undefined })
    return opening
  }
  async function poll() {
    if (stopped) return
    try {
      const sessionId = await open()
      if (stopped) return
      polling = new AbortController()
      frame = await request(`/browser/sessions/${sessionId}/frame`, { signal: polling.signal })
      if (!stopped) changed({ frame, error: '' })
    } catch (error) {
      if (!stopped) changed({ frame, error: error.message })
    } finally {
      polling = undefined
      if (!stopped) timer = schedule(poll, 500)
    }
  }
  return {
    start: poll,
    async scroll(direction) {
      // Drop repeats while a request is pending so held input cannot build a backlog.
      if (stopped || !id || scrolling || !['up', 'down'].includes(direction)) return
      scrolling = new AbortController()
      try {
        await request(`/browser/sessions/${id}/scroll`, { method: 'POST', body: { direction }, signal: scrolling.signal })
      } catch (error) {
        if (!stopped) changed({ frame, error: error.message })
      } finally {
        scrolling = undefined
      }
    },
    async interpret(body, signal) {
      const sessionId = await open()
      if (stopped || signal.aborted) throw new DOMException('Canceled', 'AbortError')
      return request('/browser/commands', { method: 'POST', body: { ...body, sessionId }, signal })
    },
    dispose() { stopped = true; unschedule(timer); polling?.abort(); scrolling?.abort(); if (id) void close(id) },
  }
}
