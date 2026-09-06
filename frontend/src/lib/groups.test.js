import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialSwitcher, navigate, members, allApps, availableApps, removeApp, restoreSwitcher, saveSwitcher } from './switcher.js'
const perform = (state, ...actions) => actions.reduce((current, action) => navigate(current, action), state)
const opened = () => perform(initialSwitcher(), 'confirm', 'confirm', 'confirm')

for (const [action, side] of [['tile-left', 0], ['tile-right', 1]]) {
  test(`${action} keeps the original instance and focuses the empty side`, () => {
    const start = opened(), original = start.apps.at(-1)
    const state = navigate(start, action), group = state.apps.at(-1)
    assert.equal(state.view, 'app')
    assert.equal(group.type, 'group')
    assert.equal(group.apps[side], original)
    assert.equal(group.apps[1 - side], null)
    assert.equal(group.focused, 1 - side)
    assert.equal(state.apps.length, start.apps.length)
    const picker = navigate(state, 'confirm')
    assert.equal(picker.groupPicker, true)
    const added = perform(picker, 'down', 'confirm')
    assert.equal(added.view, 'app')
    assert.equal(added.groupPicker, false)
    assert.equal(added.apps.at(-1).apps[1 - side].type, 'mail')
    assert.equal(added.apps.at(-1).apps[side], original)
    assert.equal(added.apps.at(-1).focused, 1 - side)
  })
}

test('L1 and R1 switch focus without creating more apps or swapping the panes', () => {
  let state = perform(opened(), 'tile-left', 'confirm', 'confirm')
  const apps = state.apps.at(-1).apps, nextId = state.nextId
  state = perform(state, 'tile-left', 'tile-left')
  assert.equal(state.apps.at(-1).focused, 0)
  state = navigate(state, 'tile-right')
  assert.equal(state.apps.at(-1).focused, 1)
  assert.equal(state.apps.at(-1).apps, apps)
  assert.equal(state.nextId, nextId)
  assert.equal(navigate(state, 'confirm'), state)
})

test('canceling the in-pane picker preserves the group; back and reopen restores the layout', () => {
  let state = perform(opened(), 'tile-right', 'confirm', 'down', 'back')
  assert.equal(state.groupPicker, false)
  assert.equal(state.view, 'app')
  const group = state.apps.at(-1)
  state = navigate(state, 'back')
  assert.equal(state.view, 'menu')
  state = navigate(state, 'confirm')
  assert.equal(state.apps.at(-1), group)
  state = perform(state, 'confirm', 'confirm', 'back', 'confirm')
  assert.equal(members(state.apps.at(-1)).length, 2)
})

test('picker owns navigation and shoulders while open and clamps selection', () => {
  let state = perform(opened(), 'tile-left', 'confirm', 'up', 'tile-left', 'tile-right')
  assert.equal(state.pickerSelected, 0)
  assert.equal(state.apps.at(-1).focused, 1)
  for (let i = 0; i < 30; i++) state = navigate(state, 'down')
  assert.equal(state.pickerSelected, 5)
  assert.equal(state.view, 'app')
})

test('instance names include group members and settings stays unique in the catalog', () => {
  let state = perform(opened(), 'tile-left', 'confirm', 'confirm', 'back')
  state = perform({ ...state, selected: 0 }, 'confirm', 'confirm')
  assert.deepEqual(allApps(state).map(app => app.title), ['Settings', 'Agent 1', 'Agent 2', 'Agent 3'])
  const settings = perform(initialSwitcher(), 'right', 'confirm', 'tile-right')
  assert.equal(allApps(settings).filter(app => app.type === 'settings').length, 1)
  assert.equal(availableApps.filter(def => def.id !== 'settings').length, 6)
})

test('closing a group removes its members while preserving other shelf cards', () => {
  let state = perform(opened(), 'tile-left', 'confirm', 'confirm', 'back')
  const group = state.apps.at(-1)
  state = removeApp(state, group.id)
  assert.deepEqual(state.apps, initialSwitcher().apps)
  assert.equal(state.selected, 1)
  assert.equal(allApps(state).length, 1)
})

function memory() {
  let data = null
  return { getItem: () => data, setItem: (_, value) => { data = value } }
}
test('completed and half-filled groups survive storage and reopen with their focused side', () => {
  for (const complete of [false, true]) {
    let state = perform(opened(), 'tile-right')
    if (complete) state = perform(state, 'confirm', 'confirm', 'tile-right')
    const storage = memory()
    saveSwitcher(state, storage)
    const restored = restoreSwitcher(storage)
    assert.equal(restored.view, 'menu')
    assert.deepEqual(restored.apps, state.apps)
    assert.equal(restored.selected, state.selected)
    const reopened = navigate(restored, 'confirm')
    assert.equal(reopened.view, 'app')
    assert.equal(reopened.apps.at(-1).focused, state.apps.at(-1).focused)
    assert.ok(restored.nextId > Math.max(...allApps(restored).map(app => app.id)))
  }
})

test('bad, incompatible, and unavailable storage safely fall back to the initial shelf', () => {
  for (const value of ['{', 'null', '{"version":2,"apps":[]}', JSON.stringify({ version: 1, apps: [{ id: 4, type: 'group', apps: [null, null], focused: 0 }] }), JSON.stringify({ version: 1, apps: [initialSwitcher().apps[0], initialSwitcher().apps[0]] })]) {
    assert.deepEqual(restoreSwitcher({ getItem: () => value }), initialSwitcher())
  }
  const blocked = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('full') } }
  assert.deepEqual(restoreSwitcher(blocked), initialSwitcher())
  assert.doesNotThrow(() => saveSwitcher(opened(), blocked))
})

for (const action of ['tile-left', 'tile-right']) {
  test(`Triangle closes the selected empty half after ${action} and preserves the original app`, () => {
    const start = opened(), original = start.apps.at(-1)
    const split = navigate(start, action)
    const collapsed = navigate(split, 'close-empty')
    assert.equal(collapsed.view, 'app')
    assert.equal(collapsed.apps.at(-1), original)
    assert.equal(collapsed.apps[0], start.apps[0])
    assert.equal(collapsed.selected, start.selected)
    assert.equal(collapsed.nextId, split.nextId)
    assert.equal(collapsed.groupPicker, false)
    const storage = memory()
    saveSwitcher(collapsed, storage)
    const restored = restoreSwitcher(storage)
    assert.deepEqual(restored.apps, start.apps)
    assert.equal(navigate(restored, 'confirm').apps.at(-1).type, original.type)
    assert.equal(navigate(collapsed, action).apps.at(-1).apps.includes(original), true)
  })
}

test('Triangle does not close occupied panes, full groups, standalone apps, or shelf cards', () => {
  const single = opened()
  const occupied = perform(single, 'tile-left', 'tile-left')
  const full = perform(single, 'tile-left', 'confirm', 'confirm')
  for (const state of [single, occupied, full, navigate(full, 'tile-left'), navigate(full, 'back')]) {
    assert.equal(navigate(state, 'close-empty'), state)
  }
})

test('Triangle can dismiss the empty half while its add picker is open', () => {
  const start = opened()
  const picker = perform(start, 'tile-right', 'confirm', 'down')
  const collapsed = navigate(picker, 'close-empty')
  assert.equal(collapsed.groupPicker, false)
  assert.equal(collapsed.view, 'app')
  assert.deepEqual(collapsed.apps, start.apps)
})
