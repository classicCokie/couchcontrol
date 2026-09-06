import { test } from 'node:test'
import assert from 'node:assert/strict'
import { availableApps, addableApps, initialSwitcher, navigate, removeApp } from './switcher.js'
import { createGamepadReader } from './gamepad.js'

const perform = (state, ...actions) => actions.reduce((current, action) => navigate(current, action), state)

test('Settings is present by default and the add picker still opens and cancels', () => {
  const initial = initialSwitcher()
  assert.deepEqual(initial.apps, [{ id: 0, type: 'settings', title: 'Settings' }])
  assert.equal(addableApps.some(app => app.id === 'settings'), false)
  assert.equal(initial.selected, 0)
  const picker = navigate(initial, 'confirm')
  assert.equal(picker.view, 'picker')
  assert.equal(picker.pickerSelected, 0)
  const cancelled = navigate(picker, 'back')
  assert.equal(cancelled.view, 'menu')
  assert.deepEqual(cancelled.apps, initial.apps)
})

test('each add creates a distinct instance and selects the new tile', () => {
  let state = initialSwitcher()
  for (let id = 1; id <= 3; id++) {
    state = perform({ ...state, selected: 0 }, 'confirm', 'confirm')
    assert.equal(state.view, 'menu')
    assert.equal(state.apps.length, id + 1)
    assert.equal(state.selected, id + 1)
    assert.deepEqual(state.apps[id], { id, type: 'agent', title: `Agent ${id}` })
  }
  assert.equal(new Set(state.apps.map(app => app.id)).size, 4)
})

test('vertical navigation stays in the picker until Back or confirmation', () => {
  const state = perform(initialSwitcher(), 'confirm', 'up', 'down', 'left', 'right')
  assert.equal(state.view, 'picker')
  assert.equal(state.pickerSelected, 1)
  assert.equal(navigate(state, 'back').view, 'menu')
  assert.equal(navigate(state, 'confirm').apps.length, 2)
})

test('all apps including Codex can be added and opened as independent instances', () => {
  assert.deepEqual(availableApps.map(app => app.title), ['Agent', 'Mail', 'Chatbot', 'Browser', 'Write', 'Codex', 'Settings'])
  let state = initialSwitcher()
  for (let index = 0; index < addableApps.length; index++) {
    state = navigate({ ...state, selected: 0 }, 'confirm')
    for (let step = 0; step < index; step++) state = navigate(state, 'down')
    state = navigate(state, 'confirm')
    assert.equal(state.apps[index + 1].type, addableApps[index].id)
    assert.equal(state.apps[index + 1].title, addableApps[index].title + ' 1')
    state = navigate(state, 'confirm')
    assert.equal(state.view, 'app')
    assert.equal(state.selected, index + 2)
    state = navigate(state, 'back')
  }
  state = perform({ ...state, selected: 0 }, 'confirm', 'down', 'confirm')
  assert.equal(state.apps.at(-1).title, 'Mail 2')
  assert.equal(new Set(state.apps.map(app => app.id)).size, availableApps.length + 1)
})

test('vertical catalog navigation selects apps and stops at the first and last', () => {
  const catalog = [{ id: 'agent', title: 'Agent' }, { id: 'second', title: 'Second' }, { id: 'third', title: 'Third' }]
  let state = navigate(initialSwitcher(), 'confirm')
  state = navigate(state, 'up', catalog)
  assert.equal(state.pickerSelected, 0)
  for (let index = 0; index < 4; index++) state = navigate(state, 'down', catalog)
  assert.equal(state.pickerSelected, 2)
  state = navigate(state, 'up', catalog)
  assert.equal(state.pickerSelected, 1)
  state = navigate(state, 'confirm', catalog)
  assert.equal(state.apps.at(-1).title, 'Second 1')
  assert.equal(state.view, 'menu')
})

test('canceling picker preserves running instances and returns to plus', () => {
  const added = perform(initialSwitcher(), 'confirm', 'confirm')
  const state = perform({ ...added, selected: 0 }, 'confirm', 'back')
  assert.equal(state.apps.length, 2)
  assert.equal(state.selected, 0)
  assert.equal(state.view, 'menu')
})

test('switching and returning preserves all instances and the selected tile', () => {
  let state = perform(initialSwitcher(), 'confirm', 'confirm')
  state = perform({ ...state, selected: 0 }, 'confirm', 'confirm')
  state = perform(state, 'left', 'confirm')
  assert.equal(state.view, 'app')
  assert.equal(state.apps[state.selected - 1].title, 'Agent 1')
  assert.equal(navigate(state, 'right'), state)
  state = navigate(state, 'back')
  assert.equal(state.selected, 2)
  assert.equal(state.apps.length, 3)
  state = perform(state, 'right', 'confirm')
  assert.equal(state.apps[state.selected - 1].title, 'Agent 2')
})

test('horizontal navigation wraps across plus and app tiles', () => {
  let state = perform(initialSwitcher(), 'confirm', 'confirm')
  state = navigate(state, 'right')
  assert.equal(state.selected, 0)
  assert.equal(navigate(state, 'left').selected, 2)
})

test('gamepad can open picker, spawn, switch, return and spawn again', () => {
  const read = createGamepadReader()
  const pad = { axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }
  let state = initialSwitcher(), now = 0
  function press(index) {
    pad.buttons[index].pressed = true
    state = perform(state, ...read(pad, now++))
    assert.deepEqual(read(pad, now++), [])
    pad.buttons[index].pressed = false
    read(pad, now++)
  }
  press(0)
  press(0)
  press(0)
  assert.equal(state.view, 'app')
  press(1)
  press(14)
  press(14)
  press(0)
  press(0)
  assert.equal(state.apps.length, 3)
  assert.equal(state.selected, 3)
})

test('Settings opens immediately without adding an instance', () => {
  const state = perform(initialSwitcher(), 'right', 'confirm')
  assert.equal(state.view, 'app')
  assert.equal(state.apps[state.selected - 1].type, 'settings')
  assert.equal(state.apps.length, 1)
})

test('closing a middle app preserves the other cards and future names stay unique', () => {
  let state = initialSwitcher()
  for (let i = 0; i < 3; i++) state = perform({ ...state, selected: 0 }, 'confirm', 'confirm')
  const closed = state.apps[2].id
  state = removeApp({ ...state, selected: 3 }, closed)
  assert.deepEqual(state.apps.map(app => app.title), ['Settings', 'Agent 1', 'Agent 3'])
  assert.equal(state.selected, 3)
  state = perform({ ...state, selected: 0 }, 'confirm', 'confirm')
  assert.equal(state.apps.at(-1).title, 'Agent 4')
  state = removeApp(state, state.apps.at(-1).id)
  assert.equal(state.selected, state.apps.length)
})

test('closing Settings preserves a valid menu and allows adding it again', () => {
  const state = removeApp({ ...initialSwitcher(), selected: 1 }, 0)
  assert.equal(state.apps.length, 0)
  assert.equal(state.selected, 0)
  const picker = navigate(state, 'confirm', availableApps)
  const restored = navigate({ ...picker, pickerSelected: availableApps.length - 1 }, 'confirm', availableApps)
  assert.equal(restored.apps[0].type, 'settings')
})
