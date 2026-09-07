import { normalizeAddress } from './address.js'

export function applyPlan(state, plan) {
  if (!plan || !Array.isArray(plan.commands) || plan.commands.length > 4 || typeof plan.message !== 'string') throw new Error('Invalid command response. Nothing was changed.')
  const next = { ...state, history: [...state.history], leave: false }
  for (const [index, command] of plan.commands.entries()) {
    if (!command || typeof command.value !== 'string') throw new Error('Invalid browser command.')
    const { action, value } = command
    if (!['navigate', 'viewport'].includes(action) && value !== '') throw new Error('Invalid command arguments.')
    switch (action) {
      case 'navigate': {
        if (!/^https?:\/\//i.test(value)) throw new Error('The model returned an invalid web address.')
        const url = normalizeAddress(value)
        next.history = [...next.history.slice(0, next.index + 1), url].slice(-100)
        next.index = next.history.length - 1; next.revision++; break
      }
      case 'reload':
        if (next.index < 0) throw new Error('Open a page first.')
        next.revision++; break
      case 'back':
        if (next.index <= 0) throw new Error('No earlier commanded page in this session.')
        next.index--; next.revision++; break
      case 'forward':
        if (next.index >= next.history.length - 1) throw new Error('No later commanded page in this session.')
        next.index++; next.revision++; break
      case 'viewport':
        if (!['full', '390', '768'].includes(value)) throw new Error('Unsupported preview width.')
        next.width = value; break
      case 'shelf':
        if (index !== plan.commands.length - 1) throw new Error('Returning to the shelf must be the last command.')
        next.leave = true; break
      default: throw new Error('Unsupported browser command. Nothing was changed.')
    }
  }
  return next
}

export function createCommandSession({ initialUrl = '', interpret, enabled, changed, navigate, leave, readClipboard }) {
  let initial = ''
  try { if (initialUrl) initial = normalizeAddress(initialUrl) } catch { /* Ignore malformed saved addresses. */ }
  let state = { draft: '', busy: false, error: '', message: '', history: initial ? [initial] : [], index: initial ? 0 : -1, revision: 0, width: 'full' }
  let version = 0, request, disposed = false, pasting = false
  const emit = patch => { state = { ...state, ...patch }; changed(state) }
  const usable = () => !disposed && enabled()
  const edit = draft => { version++; emit({ draft, error: '', message: '' }) }
  function cancel() { version++; request?.abort(); request = undefined; emit({ busy: false }) }
  return {
    get state() { return state }, edit, cancel,
    dispose() { disposed = true; cancel() },
    captureEmptyInput() { return usable() && !state.busy && !state.draft ? version : null },
    pasteIfEmpty(text, snapshot) {
      if (snapshot === null || snapshot !== version || !usable() || state.busy || state.draft) return false
      edit(text); return true
    },
    async pasteClipboard() {
      if (!usable() || state.busy || pasting) return
      const snapshot = version; pasting = true
      try {
        const text = await readClipboard()
        if (usable() && version === snapshot && !state.busy && text) edit(state.draft ? state.draft + ' ' + text : text)
      } catch { if (usable() && version === snapshot) emit({ error: 'Clipboard access was blocked. Use R2 to record a command.' }) }
      finally { pasting = false }
    },
    async submit() {
      if (!usable() || state.busy || !state.draft.trim()) return
      if (state.draft.length > 4000) { emit({ error: 'Keep commands below 4,000 characters.' }); return }
      const snapshot = ++version
      const pending = new AbortController(); request = pending
      emit({ busy: true, error: '', message: '' })
      try {
        const plan = await interpret({ text: state.draft, currentUrl: state.history[state.index] || '', canBack: state.index > 0, canForward: state.index < state.history.length - 1 }, pending.signal)
        if (!usable() || snapshot !== version || pending.signal.aborted) return
        // Chromium has already executed the validated plan. Its real navigation
        // state replaces the old iframe's synthetic URL history.
        let next
        if (plan.page) {
          const url = /^https?:\/\//i.test(plan.page.url) ? normalizeAddress(plan.page.url) : ''
          next = { ...state, history: url ? [url] : [], index: url ? 0 : -1, leave: plan.commands.some(command => command.action === 'shelf') }
        } else next = applyPlan(state, plan)
        emit({ ...next, draft: plan.commands.length ? '' : state.draft, message: plan.message })
        const url = next.history[next.index] || ''
        if (plan.commands.length) navigate(url)
        if (next.leave) leave()
      } catch (error) {
        if (usable() && snapshot === version && !pending.signal.aborted) emit({ error: error.message || 'Could not process the command.' })
      } finally {
        if (request === pending) { request = undefined; emit({ busy: false }) }
      }
    },
  }
}
