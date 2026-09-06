import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { isTerminalReport, createInputClearer } from './input.js'
import { createCommandSender } from './commands.js'
import { isEmptyComposer, composerState } from './composer.js'
const { Terminal } = createRequire(import.meta.url)('@xterm/xterm')
const write = (term, text) => new Promise(resolve => term.write(text, resolve))

test('focus changes and terminal queries do not invalidate a command on an empty xterm prompt', async () => {
  const term = new Terminal({ cols: 80, rows: 24 })
  let revision = 0
  const socket = {}, forwarded = [], commands = []
  const subscription = term.onData(data => { if (!isTerminalReport(data)) revision++; forwarded.push(data) })
  try {
    await write(term, '› \x1b[2mAsk Codex to do anything\x1b[0m\x1b[1;3H')
    const snapshot = { socket, revision }
    // Opening the web menu blurs xterm. Its focus report shares onData with keys.
    term.input('\x1b[O', false)
    await write(term, '\x1b[6n')
    term.input('\x1b[I', false)
    assert.equal(revision, snapshot.revision)
    assert.ok(forwarded.includes('\x1b[O'))
    assert.ok(forwarded.includes('\x1b[1;3R'))
    const send = createCommandSender({ target: () => socket, revision: () => revision, empty: () => isEmptyComposer(term.buffer.active), send: data => commands.push(data) })
    assert.equal(send('/model', snapshot), '')
    assert.deepEqual(commands, ['/model\r'])
    term.input('real edit', true)
    assert.notEqual(send('/clear', snapshot), '')
  } finally { subscription.dispose(); term.dispose() }
})

test('terminal report filtering preserves real text, arrows, control keys, and bracketed pastes', () => {
  for (const report of ['\x1b[I', '\x1b[O', '\x1b[22;3R', '\x1b[?1;2c', '\x1b[>0;276;0c', '\x1b]11;rgb:0000/0000/0000\x1b\\']) assert.equal(isTerminalReport(report), true)
  for (const text of ['hello', '/', '\r', '\x03', '\x1b[D', '\x1b[200~\x1b[O\x1b[201~', '\x1b[Oreal text']) assert.equal(isTerminalReport(text), false)
})

test('real terminal buffers distinguish empty, single-line, hard multiline, and wrapped drafts', async () => {
  const term = new Terminal({ cols: 24, rows: 10 })
  try {
    await write(term, '› \x1b[2mAsk Codex\x1b[0m\x1b[1;3H')
    assert.equal(composerState(term.buffer.active), 'empty')
    await write(term, '\x1b[2J\x1b[H› first line\r\n  second line')
    assert.equal(composerState(term.buffer.active), 'draft')
    await write(term, '\x1b[2J\x1b[H› this draft is long enough to wrap across several rows')
    assert.equal(composerState(term.buffer.active), 'draft')
    await write(term, '\x1b[2J\x1b[HTrust this folder?')
    assert.equal(composerState(term.buffer.active), 'unknown')
  } finally { term.dispose() }
})

function clearHarness() {
  const state = { socket: {}, composer: 'draft', sent: [], revision: 1 }
  const clearer = createInputClearer({ target: () => state.socket, composer: () => state.composer, revision: () => state.revision,
    send: data => { state.sent.push(data); state.revision++ },
  })
  return { state, clearer }
}

test('holding left clears a draft once and never sends Ctrl+C again after the prompt is empty', () => {
  const { state, clearer } = clearHarness()
  assert.equal(clearer.clear(), '')
  clearer.clear(); clearer.clear()
  assert.deepEqual(state.sent, ['\x03'])
  state.composer = 'empty'
  clearer.clear(); clearer.clear()
  assert.deepEqual(state.sent, ['\x03'])
  state.composer = 'draft'; clearer.edited()
  clearer.clear()
  assert.deepEqual(state.sent, ['\x03', '\x03'])
})

test('clear input rejects disconnected sessions, unknown screens, and stale menu snapshots', () => {
  for (const update of [state => { state.socket = null }, state => { state.composer = 'unknown' }, state => { state.socket = {} }, state => { state.revision++ }]) {
    const { state, clearer } = clearHarness()
    const snapshot = { socket: state.socket, revision: state.revision }
    update(state)
    assert.notEqual(clearer.clear(snapshot), '')
    assert.deepEqual(state.sent, [])
  }
})
