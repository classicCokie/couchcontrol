import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commands, commandSelection, createCommandSender } from './commands.js'

function harness() {
  const state = { socket: {}, revision: 3, empty: true, sent: [] }
  const send = createCommandSender({ target: () => state.socket, revision: () => state.revision, empty: () => state.empty,
    send: data => { state.sent.push(data); state.revision++ },
  })
  return { state, send, snapshot: { socket: state.socket, revision: state.revision } }
}

test('the command picker includes clear and model and either stick navigates without wrapping', () => {
  assert.ok(commands.some(entry => entry.command === '/clear'))
  assert.ok(commands.some(entry => entry.command === '/model' && entry.menu))
  assert.equal(commandSelection(0, 'right-stick-up'), 0)
  assert.equal(commandSelection(0, 'right-stick-down'), 1)
  assert.equal(commandSelection(1, 'up'), 0)
  assert.equal(commandSelection(commands.length - 1, 'down'), commands.length - 1)
  assert.equal(commandSelection(2, 'back'), 2)
})

test('selection sends the exact slash command and Enter once to the captured session', () => {
  const { state, send, snapshot } = harness()
  assert.equal(send('/model', snapshot), '')
  assert.deepEqual(state.sent, ['/model\r'])
  assert.notEqual(send('/model', snapshot), '')
  assert.equal(state.sent.length, 1)
})

test('existing input, native dialogs, disconnected or replaced sessions, and stale revisions reject commands', () => {
  for (const change of [state => { state.empty = false }, state => { state.socket = null }, state => { state.socket = {} }, state => { state.revision++ }]) {
    const { state, send, snapshot } = harness()
    change(state)
    assert.notEqual(send('/clear', snapshot), '')
    assert.deepEqual(state.sent, [])
  }
  const { state, send } = harness()
  assert.notEqual(send('/clear', null), '')
  assert.deepEqual(state.sent, [])
})

test('commands outside the menu and injected newlines cannot be sent', () => {
  const { state, send, snapshot } = harness()
  assert.notEqual(send('/model\rdo something', snapshot), '')
  assert.notEqual(send('/unknown', snapshot), '')
  assert.deepEqual(state.sent, [])
})

test('All commands opens the installed CLI slash popup without submitting it', () => {
  const { state, send, snapshot } = harness()
  assert.equal(send('/', snapshot), '')
  assert.deepEqual(state.sent, ['/'])
})
