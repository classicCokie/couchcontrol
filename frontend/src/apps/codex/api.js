export async function request(path, method = 'GET', body) {
  const response = await fetch(`/api/codex${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || 'Codex backend is unavailable. Start the Go server and try again.')
    error.status = response.status
    throw error
  }
  return data
}

export function terminalURL(id) {
  const url = new URL(`/api/codex/sessions/${encodeURIComponent(id)}/terminal`, window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url
}
