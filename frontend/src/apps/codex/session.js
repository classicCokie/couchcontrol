import { request, createTerminalAPI } from './api.js'

// Share in-flight opens across mounts so leaving and returning during startup
// cannot create two processes for the same card.
export function createSessionOpener(api = request) {
  const pending = new Map()
  function open(title, chooseFolder) {
    if (pending.has(title)) return pending.get(title)
    const opening = (async () => {
      const { authenticated } = await api('/auth')
      if (!authenticated) await api('/auth', 'POST', {})
      const { sessions } = await api('/sessions')
      const running = sessions.find(session => session.title === title && session.status === 'running')
      if (running) return running
      const cwd = await chooseFolder()
      return cwd ? api('/sessions', 'POST', { title, cwd }) : null
    })()
    pending.set(title, opening)
    opening.finally(() => { pending.delete(title) }).catch(() => {})
    return opening
  }
  open.close = async title => {
    // An HTTP launch can finish after the terminal unmounts. Let it settle so
    // closing the card also finds and cleans up that process.
    try { await pending.get(title) } catch { /* A failed launch can still leave history. */ }
    const { authenticated } = await api('/auth')
    if (!authenticated) await api('/auth', 'POST', {})
    const { sessions } = await api('/sessions')
    for (const session of sessions.filter(session => session.title === title)) {
      await api('/sessions/' + encodeURIComponent(session.id) + '/close', 'POST', {})
    }
  }
  return open
}

export const openAppSession = createSessionOpener()

export const openClaudeSession = createSessionOpener(createTerminalAPI('claude', 'Claude').request)
export const sessionFor = provider => provider === 'claude' ? openClaudeSession : openAppSession
