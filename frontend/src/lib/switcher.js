export const availableApps = [
  { id: 'agent', title: 'Agent', icon: '✳', glow: '#527769', base: '#172e2a', ink: '#c6efbf', tagline: 'A little space for big ideas.', connection: 'An agent connection hasn’t been set up yet.' },
  { id: 'mail', title: 'Mail', icon: '✉', glow: '#4e719c', base: '#172a40', ink: '#bfdcff', tagline: 'A space for your conversations.', connection: 'A mail account hasn’t been connected yet.' },
  { id: 'chatbot', title: 'Chatbot', icon: '♧', glow: '#7c629a', base: '#2c203e', ink: '#e2c9ff', tagline: 'Every conversation starts somewhere.', connection: 'A chatbot connection hasn’t been set up yet.' },
  { id: 'browser', title: 'Browser', icon: '◎', glow: '#92734d', base: '#362a1c', ink: '#f7d6a5', tagline: 'Room to explore.', connection: 'A browsing session hasn’t been connected yet.' },
  { id: 'write', title: 'Notes', icon: '✎', glow: '#926c6b', base: '#382426', ink: '#ffd1c7', tagline: 'A quiet place for your thoughts.', connection: 'Dictate your thoughts into beautiful notes.' },
  { id: 'codex', title: 'Codex', icon: '>_', glow: '#375c50', base: '#112820', ink: '#c0eccc', tagline: 'Your local Codex, from anywhere.', connection: 'Open a terminal on your machine.' },
  { id: 'claude', title: 'Claude', icon: '>_', glow: '#a06e55', base: '#35251f', ink: '#f4d1b8', tagline: 'Your local Claude Code, from anywhere.', connection: 'Open Claude Code on your machine.' },
  { id: 'settings', title: 'Settings', icon: '⚙', glow: '#526584', base: '#1b273b', ink: '#cedfff', tagline: 'Make yourself at home.', connection: 'General app preferences.' },
]
export const addableApps = availableApps.filter(app => app.id !== 'settings')
export const initialSwitcher = () => ({ apps: [{ id: 0, type: 'settings', title: 'Settings' }], selected: 0, view: 'menu', pickerSelected: 0, nextId: 1 })

export const members = entry => entry?.type === 'group' ? entry.apps.filter(Boolean) : entry ? [entry] : []
export const allApps = state => state.apps.flatMap(members)
export const groupTitle = apps => apps.filter(Boolean).map(app => app.title).join(' + ')
const replaceSelected = (state, entry) => ({ ...state, apps: state.apps.map((app, index) => index === state.selected - 1 ? entry : app) })
function newInstance(state, definition) {
  return { id: state.nextId, type: definition.id, title: definition.title,
    ...(['codex', 'claude'].includes(definition.id) ? { sessionTitle: `couchcontrol:${definition.id}:${state.nextId}` } : {}) }
}

export function navigate(state, action, catalog = addableApps) {
  if (state.view === 'app') {
    const entry = state.apps[state.selected - 1]
    if (!entry) return { ...state, view: 'menu', groupPicker: false }
    if (action === 'close-empty') {
      if (entry.type !== 'group' || entry.apps[entry.focused]) return state
      return { ...replaceSelected(state, members(entry)[0]), groupPicker: false }
    }
    if (state.groupPicker) {
      if (action === 'back') return { ...state, groupPicker: false }
      if (action === 'up' || action === 'down') return { ...state, pickerSelected: Math.max(0, Math.min(catalog.length - 1, state.pickerSelected + (action === 'up' ? -1 : 1))) }
      if (action === 'confirm' && catalog[state.pickerSelected]) {
        const apps = entry.apps.map((app, side) => side === entry.focused ? newInstance(state, catalog[state.pickerSelected]) : app)
        return { ...replaceSelected(state, { ...entry, apps, title: entry.customTitle || groupTitle(apps) }), nextId: state.nextId + 1, groupPicker: false }
      }
      return state
    }
    if (action === 'tile-left' || action === 'tile-right') {
      const side = action === 'tile-left' ? 0 : 1
      if (entry.type === 'group') return replaceSelected(state, { ...entry, focused: side })
      const apps = side === 0 ? [entry, null] : [null, entry]
      return { ...replaceSelected(state, { id: state.nextId, type: 'group', title: groupTitle(apps), apps, focused: 1 - side }), nextId: state.nextId + 1 }
    }
    if (action === 'confirm' && entry.type === 'group' && !entry.apps[entry.focused]) return { ...state, groupPicker: true, pickerSelected: 0 }
    return action === 'back' ? { ...state, view: 'menu', groupPicker: false } : state
  }
  if (action === 'back') return { ...state, view: 'menu' }
  if (state.view === 'picker') {
    if (action === 'up' || action === 'down') {
      return { ...state, pickerSelected: Math.max(0, Math.min(catalog.length - 1, state.pickerSelected + (action === 'up' ? -1 : 1))) }
    }
    if (action === 'confirm') {
      const app = catalog[state.pickerSelected]
      if (!app) return state
      const apps = [...state.apps, newInstance(state, app)]
      return { ...state, apps, nextId: state.nextId + 1, selected: apps.length, view: 'menu' }
    }
    return state
  }
  if (action === 'left' || action === 'right') {
    const count = state.apps.length + 1
    return { ...state, selected: (state.selected + (action === 'left' ? -1 : 1) + count) % count }
  }
  if (action === 'confirm' || (action === 'down' && state.selected === 0)) {
    return { ...state, view: state.selected === 0 ? 'picker' : 'app', pickerSelected: 0 }
  }
  return state
}

export function removeApp(state, id) {
  const index = state.apps.findIndex(app => app.id === id)
  if (index < 0) return state
  const apps = state.apps.filter(app => app.id !== id)
  const selected = state.selected > index + 1 ? state.selected - 1 : Math.min(state.selected, apps.length)
  return { ...state, apps, selected, view: 'menu' }
}

export function removeGroupApp(state, groupId, appId) {
  const index = state.apps.findIndex(app => app.id === groupId && app.type === 'group')
  if (index < 0 || !members(state.apps[index]).some(app => app.id === appId)) return state
  const remaining = members(state.apps[index]).find(app => app.id !== appId)
  if (!remaining) return removeApp(state, groupId)
  return { ...state, apps: state.apps.map((app, i) => i === index ? remaining : app), groupPicker: false }
}


// Display names may change; terminal identities must remain stable.
export const sessionTitle = app => app.sessionTitle || app.title
export const folderTitle = path => typeof path === 'string' ? path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path : ''

export function updateApp(state, id, changes) {
  const update = app => {
    if (app?.id !== id) return app
    const next = { ...app, ...changes }
    if (['codex', 'claude'].includes(app.type)) next.sessionTitle = sessionTitle(app)
    next.title = next.customTitle || next.defaultTitle || next.title
    return next
  }
  return { ...state, apps: state.apps.map(entry => {
    if (entry.type !== 'group') return update(entry)
    const next = update(entry)
    const apps = next.apps.map(update)
    return { ...next, apps, title: next.customTitle || groupTitle(apps) }
  }) }
}

export function renameEntry(state, id, name) {
  const customTitle = name.trim()
  return customTitle ? updateApp(state, id, { customTitle }) : state
}

const STORAGE_KEY = 'couchcontrol.app-groups.v1'
export function restoreSwitcher(storage) {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY))
    if (saved?.version !== 1 || !Array.isArray(saved.apps)) return initialSwitcher()
    const ids = new Set()
    const validId = id => Number.isSafeInteger(id) && id >= 0 && !ids.has(id) && !!ids.add(id)
    const validApp = app => app && validId(app.id) && availableApps.some(def => def.id === app.type) && typeof app.title === 'string' && app.title.length > 0
    const valid = saved.apps.every(entry => entry?.type === 'group'
      ? validId(entry.id) && Array.isArray(entry.apps) && entry.apps.length === 2 && entry.apps.some(Boolean) && entry.apps.every(app => app === null || validApp(app)) && [0, 1].includes(entry.focused)
      : validApp(entry))
    if (!valid || allApps(saved).filter(app => app.type === 'settings').length > 1) return initialSwitcher()
    const restoreApp = app => {
      if (!app) return null
      const definition = availableApps.find(def => def.id === app.type)
      const customTitle = typeof app.customTitle === 'string' ? app.customTitle.trim() : ''
      const defaultTitle = typeof app.defaultTitle === 'string' && app.defaultTitle.trim() ? app.defaultTitle : definition.title
      return { ...app, ...(customTitle ? { customTitle } : {}), title: customTitle || defaultTitle,
        ...(['codex', 'claude'].includes(app.type) ? { sessionTitle: sessionTitle(app) } : {}) }
    }
    const apps = saved.apps.map(entry => {
      if (entry.type !== 'group') return restoreApp(entry)
      const apps = entry.apps.map(restoreApp)
      const customTitle = typeof entry.customTitle === 'string' ? entry.customTitle.trim() : ''
      return { ...entry, apps, ...(customTitle ? { customTitle } : {}), title: customTitle || groupTitle(apps) }
    })
    return { ...initialSwitcher(), apps, nextId: Math.max(-1, ...ids) + 1, selected: Number.isInteger(saved.selected) ? Math.max(0, Math.min(apps.length, saved.selected)) : 0 }
  } catch { return initialSwitcher() }
}
export function saveSwitcher(state, storage) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, apps: state.apps, selected: state.selected })) } catch { /* Storage may be unavailable; the current shelf still works. */ }
}
