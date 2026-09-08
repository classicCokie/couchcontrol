import { test } from 'node:test'
import assert from 'node:assert/strict'
import { closeAppRequest } from './close-app.js'
import { initialSwitcher, navigate, availableApps, members, sessionTitle, restoreSwitcher, saveSwitcher } from './switcher.js'

function group(second = 'codex') {
  let state = { ...initialSwitcher(), view: 'picker', pickerSelected: availableApps.findIndex(app => app.id === 'codex') }
  state = navigate(state, 'confirm', availableApps)
  state = navigate(state, 'confirm')
  state = navigate(state, 'tile-left')
  state = navigate(state, 'confirm')
  state = navigate({ ...state, pickerSelected: availableApps.findIndex(app => app.id === second) }, 'confirm', availableApps)
  return state
}

for (const side of [0, 1]) {
  test(`confirming closure of pane ${side} cleans up only its session and keeps the other app open`, async () => {
    const state = group(), entry = state.apps.at(-1), calls = []
    const closed = await closeAppRequest(state, { ...entry.apps[side], groupId: entry.id }, async title => calls.push(title))
    assert.deepEqual(calls, [sessionTitle(entry.apps[side])])
    assert.equal(closed.view, 'app')
    assert.equal(closed.selected, state.selected)
    assert.equal(closed.apps.at(-1), entry.apps[1 - side])
    assert.equal(closed.apps[0], state.apps[0])
    assert.equal(members(state.apps.at(-1)).length, 2)
    let saved
    saveSwitcher(closed, { setItem: (_, value) => { saved = value } })
    assert.deepEqual(restoreSwitcher({ getItem: () => saved }).apps, closed.apps)
  })
}

test('cleanup failure leaves the original split intact and can be retried', async () => {
  const state = group(), entry = state.apps.at(-1), request = { ...entry.apps[0], groupId: entry.id }
  await assert.rejects(closeAppRequest(state, request, async () => { throw new Error('cleanup failed') }), /cleanup failed/)
  assert.equal(state.view, 'app')
  assert.equal(state.apps.at(-1), entry)
  const retried = await closeAppRequest(state, request, async () => {})
  assert.equal(retried.apps.at(-1), entry.apps[1])
})

test('closing a placeholder app never closes the neighboring Codex process', async () => {
  const state = group('mail'), entry = state.apps.at(-1)
  const closed = await closeAppRequest(state, { ...entry.apps[1], groupId: entry.id }, () => assert.fail('unexpected session cleanup'))
  assert.equal(closed.apps.at(-1), entry.apps[0])
})

test('closing the only occupied pane returns to the shelf with no empty group', async () => {
  const state = group(), entry = state.apps.at(-1)
  const half = { ...state, apps: state.apps.map(app => app === entry ? { ...entry, apps: [entry.apps[0], null], focused: 0 } : app) }
  const closed = await closeAppRequest(half, { ...entry.apps[0], groupId: entry.id }, async () => {})
  assert.equal(closed.view, 'menu')
  assert.equal(closed.apps.some(app => app.type === 'group'), false)
  assert.equal(closed.apps[0].type, 'settings')
})

test('a mixed Codex and Claude group closes each provider independently', async () => {
  const state = group('claude'), entry = state.apps.at(-1), calls = []
  const closed = await closeAppRequest(state, entry, async (title, provider) => calls.push([title, provider]))
  assert.deepEqual(calls, entry.apps.map(app => [sessionTitle(app), app.type]))
  assert.equal(closed.apps.some(app => app.id === entry.id), false)
  let saved
  saveSwitcher(state, { setItem: (_, value) => { saved = value } })
  assert.deepEqual(restoreSwitcher({ getItem: () => saved }).apps, state.apps)
})
