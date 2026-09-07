export function createTerminalAPI(provider = 'codex', label = 'Codex') {
  async function request(path, method = 'GET', body) {
    const response = await fetch(`/api/${provider}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(data.error || `${label} backend is unavailable. Start the Go server and try again.`)
      error.status = response.status
      throw error
    }
    return data
  }

  function terminalURL(id) {
    const url = new URL(`/api/${provider}/sessions/${encodeURIComponent(id)}/terminal`, window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url
  }

  return { request, terminalURL }
}

export const { request, terminalURL } = createTerminalAPI()
