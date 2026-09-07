// Keep URL policy independent of the shell and preview component.
export function normalizeAddress(value) {
  const input = value.trim()
  if (!input) throw new Error('Enter a local or remote web address.')
  if (/\s/.test(input)) throw new Error('Web addresses cannot contain spaces.')
  let candidate = input
  if (!/^https?:\/\//i.test(input)) {
    const host = input.split(/[/?#]/)[0]
    const local = /^(localhost|[\w-]+\.localhost|[\w-]+\.local|\[[\da-f:]+\]|\d{1,3}(?:\.\d{1,3}){3}|[\w-]+)(:\d+)?$/i.test(host)
    if (input.startsWith('/') || input.includes('\\') || (/^[a-z][\w+.-]*:/i.test(input) && !/^[\w.-]+:\d+(?:[/?#]|$)/.test(input))) {
      throw new Error('Use an HTTP or HTTPS address. Serve local files with a web server first.')
    }
    candidate = `${local ? 'http' : 'https'}://${input}`
  }
  let url
  try { url = new URL(candidate) } catch { throw new Error('Enter a valid web address, such as localhost:3000 or https://example.com.') }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('Use an HTTP or HTTPS address without embedded credentials.')
  }
  return url.href
}
