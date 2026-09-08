import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialSwitcher, navigate, updateApp, renameEntry, restoreSwitcher, saveSwitcher, sessionTitle, folderTitle } from './switcher.js'
import { closeAppRequest } from './close-app.js'

const add = (state, type) => navigate({ ...state, view: 'picker', pickerSelected: 0 }, 'confirm', [{ id: type, title: type === 'codex' ? 'Codex' : 'Claude' }])
const roundTrip = state => {
  let data
  const storage = { setItem: (_, value) => { data = value }, getItem: () => data }
  saveSwitcher(state, storage)
  return restoreSwitcher(storage)
}

for (const type of ['codex', 'claude']) {
  test(`${type} folder and custom titles survive reload without changing session identity`, async () => {
    let state = add(initialSwitcher(), type)
    const app = state.apps.at(-1), key = sessionTitle(app)
    state = updateApp(state, app.id, { defaultTitle: folderTitle('/home/hans/my-project/') })
    assert.equal(state.apps.at(-1).title, 'my-project')
    state = renameEntry(state, app.id, '  My workspace  ')
    state = updateApp(state, app.id, { defaultTitle: 'another-folder' })
    state = roundTrip(state)
    assert.equal(state.apps.at(-1).title, 'My workspace')
    assert.equal(sessionTitle(state.apps.at(-1)), key)
    const calls = []
    await closeAppRequest(state, state.apps.at(-1), async (...args) => calls.push(args))
    assert.deepEqual(calls, [[key, type]])
    state = add(state, type)
    assert.notEqual(sessionTitle(state.apps.at(-1)), key)
  })
}

test('legacy numbered terminal titles remain session keys while display titles migrate', () => {
  const apps = [{ id: 1, type: 'codex', title: 'Codex 2' }, { id: 2, type: 'browser', title: 'Browser 3', browserUrl: 'https://example.com' }]
  const state = restoreSwitcher({ getItem: () => JSON.stringify({ version: 1, apps }) })
  assert.equal(state.apps[0].title, 'Codex')
  assert.equal(sessionTitle(state.apps[0]), 'Codex 2')
  assert.equal(state.apps[1].title, 'Browser')
  assert.equal(state.apps[1].browserUrl, apps[1].browserUrl)
  const renamed = renameEntry({ ...initialSwitcher(), apps }, 1, 'Work')
  assert.equal(sessionTitle(renamed.apps[0]), 'Codex 2')
})

test('group titles follow member titles until named, including when filling an empty side', () => {
  let state = navigate(add(initialSwitcher(), 'codex'), 'confirm')
  state = navigate(state, 'tile-left')
  const group = state.apps.at(-1), app = group.apps[0]
  state = updateApp(state, app.id, { defaultTitle: 'project' })
  assert.equal(state.apps.at(-1).title, 'project')
  state = renameEntry(state, group.id, 'My team')
  state = navigate(navigate(state, 'confirm'), 'confirm')
  state = renameEntry(state, app.id, 'Terminal')
  state = roundTrip(state)
  assert.equal(state.apps.at(-1).title, 'My team')
  assert.equal(state.apps.at(-1).apps[0].title, 'Terminal')
  assert.equal(state.apps.at(-1).apps[1].title, 'Agent')
  assert.equal(renameEntry(state, group.id, '   '), state)
})

test('folder display names handle roots and path separators', () => {
  assert.equal(folderTitle('/'), '/')
  assert.equal(folderTitle('/home/my folder'), 'my folder')
  assert.equal(folderTitle('C:\\work\\project\\'), 'project')
})
