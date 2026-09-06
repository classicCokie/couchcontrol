async function read(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'The backend is unavailable. Please try again.')
  return data
}
export async function platformRequest(path, { method = 'GET', body, signal } = {}) {
  if (signal?.aborted) throw new DOMException('Canceled', 'AbortError')
  const form = body instanceof FormData
  return read(await fetch(`/api${path}`, {
    method, signal,
    headers: body && !form ? { 'Content-Type': 'application/json' } : {},
    body: body ? (form ? body : JSON.stringify(body)) : undefined,
  }))
}
export async function transcribe(audio, signal) {
  const form = new FormData()
  const extension = audio.type.includes('mp4') ? 'mp4' : audio.type.includes('ogg') ? 'ogg' : 'webm'
  form.append('file', audio, `recording.${extension}`)
  return platformRequest('/transcriptions', { method: 'POST', body: form, signal })
}
