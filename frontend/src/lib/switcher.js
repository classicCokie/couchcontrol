export const availableApps = [
  { id: 'agent', title: 'Agent', icon: '✳', glow: '#527769', base: '#172e2a', ink: '#c6efbf', tagline: 'A little space for big ideas.', connection: 'An agent connection hasn’t been set up yet.' },
  { id: 'mail', title: 'Mail', icon: '✉', glow: '#4e719c', base: '#172a40', ink: '#bfdcff', tagline: 'A space for your conversations.', connection: 'A mail account hasn’t been connected yet.' },
  { id: 'chatbot', title: 'Chatbot', icon: '♧', glow: '#7c629a', base: '#2c203e', ink: '#e2c9ff', tagline: 'Every conversation starts somewhere.', connection: 'A chatbot connection hasn’t been set up yet.' },
  { id: 'browser', title: 'Browser', icon: '◎', glow: '#92734d', base: '#362a1c', ink: '#f7d6a5', tagline: 'Room to explore.', connection: 'A browsing session hasn’t been connected yet.' },
  { id: 'write', title: 'Write', icon: '✎', glow: '#926c6b', base: '#382426', ink: '#ffd1c7', tagline: 'Make room for your next sentence.', connection: 'A writing session hasn’t been connected yet.' },
  { id: 'codex', title: 'Codex', icon: '>_', glow: '#375c50', base: '#112820', ink: '#c0eccc', tagline: 'Your local Codex, from anywhere.', connection: 'Open a terminal on your machine.' },
  { id: 'settings', title: 'Settings', icon: '⚙', glow: '#526584', base: '#1b273b', ink: '#cedfff', tagline: 'Make yourself at home.', connection: 'General app preferences.' },
]
export const addableApps = availableApps.filter(app => app.id !== 'settings')
export const initialSwitcher = () => ({ apps: [{ id: 0, type: 'settings', title: 'Settings' }], selected: 0, view: 'menu', pickerSelected: 0, nextId: 1 })

export function navigate(state, action, catalog = addableApps) {
  if (state.view === 'app') return action === 'back' ? { ...state, view: 'menu' } : state
  if (action === 'back') return { ...state, view: 'menu' }
  if (state.view === 'picker') {
    if (action === 'up' || action === 'down') {
      return { ...state, pickerSelected: Math.max(0, Math.min(catalog.length - 1, state.pickerSelected + (action === 'up' ? -1 : 1))) }
    }
    if (action === 'confirm') {
      const app = catalog[state.pickerSelected]
      if (!app) return state
      const instanceNumber = Math.max(0, ...state.apps.filter(instance => instance.type === app.id).map(instance => Number(instance.title.slice(app.title.length + 1)) || 0)) + 1
      const apps = [...state.apps, { id: state.nextId, type: app.id, title: `${app.title} ${instanceNumber}` }]
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
