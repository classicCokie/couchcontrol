import { members, sessionTitle, removeApp, removeGroupApp } from './switcher.js'

// Keep the view and its cards intact until the requested sessions are closed.
export async function closeAppRequest(state, request, closeSession) {
  for (const app of members(request)) {
    if (['codex', 'claude'].includes(app.type)) await closeSession(sessionTitle(app), app.type)
  }
  return request.groupId !== undefined
    ? removeGroupApp(state, request.groupId, request.id)
    : removeApp(state, request.id)
}
