import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composerState, isEmptyComposer } from './composer.js'
import { commands } from './commands.js'
import { createCommandSender, commandSelection } from '../codex/commands.js'
import { createTerminalAPI } from '../codex/api.js'
import { terminalProfiles } from '../codex/profiles.js'

function buffer(text = '❯\u00a0Try a question', { dim = true, cursorX = 2, lines, cursorY = 1 } = {}) {
  const texts = lines || ['──────────────', text, '──────────────']
  return { baseY: 0, cursorX, cursorY, length: texts.length, getLine: y => texts[y] === undefined ? undefined : {
    isWrapped: false, length: texts[y].length, translateToString: () => texts[y],
    getCell: x => ({ getChars: () => texts[y][x], isDim: () => dim && y === 1 && x >= 2 }),
  } }
}
test('Claude recognizes empty bordered prompts and preserves drafts, including multiline input', () => {
  assert.equal(isEmptyComposer(buffer()), true)
  assert.equal(isEmptyComposer(buffer('❯ ')), true)
  assert.equal(composerState(buffer('❯ existing input', { dim: false })), 'draft')
  assert.equal(composerState(buffer('', { dim: false, lines: ['──────────────', '❯ first', '  second', '──────────────'], cursorY: 2, cursorX: 8 })), 'draft')
  assert.equal(isEmptyComposer(buffer('', { lines: ['──────────────', ' ❯ Yes, trust this folder', '  No, exit'] })), false)
  assert.equal(isEmptyComposer(buffer('', { lines: ['❯ permission', '  Yes', '  No'] })), false)
  assert.equal(isEmptyComposer(buffer('❯ typed', { dim: false, cursorX: 2 })), false)
  assert.equal(isEmptyComposer(null), false)
})
test('Claude command sender uses its own catalog and rejects stale or occupied prompts', () => {
  const socket = {}, sent = []
  let empty = true, revision = 0
  const send = createCommandSender({ entries: commands, label: 'Claude', target: () => socket, revision: () => revision, empty: () => empty, send: data => sent.push(data) })
  const snapshot = { socket, revision }
  assert.equal(send('/cost', snapshot), '')
  assert.deepEqual(sent, ['/cost\r'])
  assert.notEqual(send('/diff', snapshot), '')
  empty = false
  assert.match(send('/model', snapshot), /Claude dialog/)
  empty = true
  revision++
  assert.match(send('/model', snapshot), /prompt changed/)
  assert.equal(commandSelection(commands.length - 1, 'down', commands), commands.length - 1)
})
test('providers have independent session openers and Claude requests use Claude routes', async () => {
  assert.notEqual(terminalProfiles.codex.openSession, terminalProfiles.claude.openSession)
  const original = globalThis.fetch, calls = []
  globalThis.fetch = async (path, options) => { calls.push([path, options.method]); return { ok: true, json: async () => ({ sessions: [] }) } }
  try {
    await createTerminalAPI('claude', 'Claude').request('/sessions')
    assert.deepEqual(calls, [['/api/claude/sessions', 'GET']])
  } finally { globalThis.fetch = original }
})
