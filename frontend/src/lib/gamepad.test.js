import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGamepadReader, startGamepadControls } from './gamepad.js'

function gamepad() {
  return { index: 0, id: 'Test controller', connected: true, mapping: 'standard',
    axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }
}

test('D-pad responds immediately, delays repeat, and reverses immediately', () => {
  const read = createGamepadReader(), pad = gamepad()
  pad.buttons[15].pressed = true
  assert.deepEqual(read(pad, 0), ['right'])
  assert.deepEqual(read(pad, 399), [])
  assert.deepEqual(read(pad, 400), ['right'])
  assert.deepEqual(read(pad, 579), [])
  assert.deepEqual(read(pad, 580), ['right'])
  pad.buttons[15].pressed = false
  pad.buttons[14].pressed = true
  assert.deepEqual(read(pad, 581), ['left'])
})

test('stick ignores drift and uses its dominant axis', () => {
  const read = createGamepadReader(), pad = gamepad()
  pad.axes = [0.2, -0.3]
  assert.deepEqual(read(pad, 0), [])
  pad.axes = [-0.8, 0.6]
  assert.deepEqual(read(pad, 1), ['left'])
  pad.axes = [0.6, 0.9]
  assert.deepEqual(read(pad, 2), ['down'])
})

test('face buttons fire only on a new press; Back wins simultaneous presses', () => {
  const read = createGamepadReader(), pad = gamepad()
  pad.buttons[0].pressed = true
  assert.deepEqual(read(pad, 0), ['confirm'])
  assert.deepEqual(read(pad, 1000), [])
  pad.buttons[0].pressed = false
  read(pad, 1001)
  pad.buttons[0].pressed = true
  pad.buttons[1].pressed = true
  assert.deepEqual(read(pad, 1002), ['back'])
  assert.deepEqual(read(pad, 2000), [])
})

function harness() {
  let pending, cancelled = false
  const state = { pads: [], focused: true, hidden: false, actions: [], connections: [] }
  const stop = startGamepadControls({
    onAction: action => state.actions.push(action),
    onConnection: connected => state.connections.push(connected),
    win: { requestAnimationFrame(callback) { pending = callback; return 1 }, cancelAnimationFrame() { cancelled = true } },
    doc: { get hidden() { return state.hidden }, hasFocus: () => state.focused },
    nav: { getGamepads: () => state.pads },
  })
  return { state, stop, step: (now = 0) => { if (!cancelled) pending(now) } }
}

test('connects in sparse slots, requires release, disconnects and cleans up', () => {
  const { state, step, stop } = harness(), pad = gamepad()
  pad.buttons[0].pressed = true
  state.pads = [null, pad]
  step()
  assert.deepEqual(state.connections, [true])
  assert.deepEqual(state.actions, [])
  pad.buttons[0].pressed = false
  step()
  pad.buttons[0].pressed = true
  step()
  step(1000)
  assert.deepEqual(state.actions, ['confirm'])
  state.pads = []
  step()
  assert.deepEqual(state.connections, [true, false])
  stop()
  state.pads = [pad]
  step()
  assert.deepEqual(state.connections, [true, false])
})

test('ignores unsupported mappings', () => {
  const { state, step } = harness(), pad = gamepad()
  pad.mapping = ''
  state.pads = [pad]
  step()
  pad.buttons[0].pressed = true
  step()
  assert.deepEqual(state.actions, [])
  assert.deepEqual(state.connections, [])
})

test('ignores background input and requires release on return', () => {
  const { state, step } = harness(), pad = gamepad()
  state.pads = [pad]
  step()
  state.focused = false
  pad.buttons[0].pressed = true
  step()
  state.focused = true
  step()
  assert.deepEqual(state.actions, [])
  pad.buttons[0].pressed = false
  step()
  pad.buttons[0].pressed = true
  step()
  assert.deepEqual(state.actions, ['confirm'])
  state.hidden = true
  pad.buttons[1].pressed = true
  step()
  assert.deepEqual(state.actions, ['confirm'])
})

test('unavailable or blocked APIs do not break the app', () => {
  const options = { onAction() { assert.fail('Unexpected input') }, onConnection() {}, win: {}, doc: {}, nav: {} }
  assert.doesNotThrow(() => startGamepadControls(options)())
  options.nav.getGamepads = () => { throw new Error('SecurityError') }
  options.win.requestAnimationFrame = callback => { callback(0); return 1 }
  options.win.cancelAnimationFrame = () => {}
  assert.doesNotThrow(() => startGamepadControls(options)())
})

test('R2 emits one press and release with analog hysteresis', () => {
  const read = createGamepadReader(), pad = gamepad()
  pad.buttons[7].value = 0.8
  assert.deepEqual(read(pad, 0), ['record-start'])
  assert.deepEqual(read(pad, 9999), [])
  pad.buttons[7].value = 0.3
  assert.deepEqual(read(pad, 10000), [])
  pad.buttons[7].value = 0.1
  assert.deepEqual(read(pad, 10001), ['record-end'])
  assert.deepEqual(read(pad, 10002), [])
})

test('Circle cancels before R2 release in the same frame', () => {
  const read = createGamepadReader(), pad = gamepad()
  pad.buttons[7].pressed = true
  assert.deepEqual(read(pad, 0), ['record-start'])
  pad.buttons[7].pressed = false
  pad.buttons[1].pressed = true
  assert.deepEqual(read(pad, 1), ['back', 'record-end'])
})

test('simultaneous R2 and Circle cancel the overlay instead of navigating the app', () => {
  const read = createGamepadReader(), pad = gamepad()
  pad.buttons[7].pressed = true
  pad.buttons[1].pressed = true
  assert.deepEqual(read(pad, 0), ['record-start', 'back'])
  assert.deepEqual(read(pad, 1), [])
})

test('controller disconnection and loss of focus cancel a held recording instead of submitting', () => {
  for (const interrupt of ['disconnect', 'blur', 'hide']) {
    const { state, step } = harness(), pad = gamepad()
    state.pads = [pad]; step()
    pad.buttons[7].pressed = true; step()
    assert.deepEqual(state.actions, ['record-start'])
    if (interrupt === 'disconnect') state.pads = []
    if (interrupt === 'blur') state.focused = false
    if (interrupt === 'hide') state.hidden = true
    step()
    assert.deepEqual(state.actions, ['record-start', 'record-cancel'])
    state.pads = [pad]; state.focused = true; state.hidden = false
    step()
    pad.buttons[7].pressed = false; step()
    assert.deepEqual(state.actions, ['record-start', 'record-cancel'])
  }
})

test('Square emits paste once per press, with Circle taking priority', () => {
  const read = createGamepadReader(), pad = gamepad()
  pad.buttons[2].pressed = true
  assert.deepEqual(read(pad, 0), ['paste'])
  assert.deepEqual(read(pad, 1000), [])
  pad.buttons[2].pressed = false; read(pad, 1001)
  pad.buttons[2].pressed = true
  assert.deepEqual(read(pad, 1002), ['paste'])
  pad.buttons[2].pressed = false; read(pad, 1003)
  pad.buttons[2].pressed = true; pad.buttons[1].pressed = true
  assert.deepEqual(read(pad, 1004), ['back'])
})
