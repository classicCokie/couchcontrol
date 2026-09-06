import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClipboardPaste } from './paste.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('Square reads the current clipboard each time and passes multiline Unicode to terminal paste', async () => {
  let clipboard = 'First line\nSecond line 世界'
  const pasted = [], errors = [], session = {}
  const paste = createClipboardPaste({ read: async () => clipboard, target: () => session, paste: text => pasted.push(text), report: error => errors.push(error) })
  await paste()
  clipboard = 'Copied in another application'
  await paste()
  assert.deepEqual(pasted, ['First line\nSecond line 世界', 'Copied in another application'])
  assert.deepEqual(errors, ['', ''])
})

test('late clipboard reads never paste after leaving the app, opening a modal, or replacing the connection', async () => {
  for (const replacement of [null, {}]) {
    const clipboard = deferred()
    let target = {}
    const paste = createClipboardPaste({ read: () => clipboard.promise, target: () => target, paste: () => assert.fail('stale paste'), report() {} })
    const pending = paste()
    target = replacement
    clipboard.resolve('private text')
    await pending
  }
})

test('permission prompts do not cause duplicate reads and failed reads can be retried', async () => {
  const clipboard = deferred(), session = {}, pasted = [], reports = []
  let reads = 0
  const paste = createClipboardPaste({ read: () => { reads++; return clipboard.promise }, target: () => session, paste: text => pasted.push(text), report: value => reports.push(value) })
  const pending = paste()
  await paste()
  assert.equal(reads, 1)
  clipboard.resolve('one paste'); await pending
  assert.deepEqual(pasted, ['one paste'])
  const rejected = createClipboardPaste({ read: async () => { throw new Error('permission denied') }, target: () => session, paste: () => assert.fail('pasted on denial'), report: value => reports.push(value) })
  await rejected()
  assert.match(reports.at(-1), /Clipboard access was blocked/)
})

test('an empty clipboard and a disconnected terminal do not send input', async () => {
  const reports = []
  const empty = createClipboardPaste({ read: async () => '', target: () => 'connected', paste: () => assert.fail('empty paste'), report: value => reports.push(value) })
  await empty()
  assert.match(reports.at(-1), /does not contain text/)
  const offline = createClipboardPaste({ read: () => assert.fail('read while offline'), target: () => null, paste: () => assert.fail('offline paste'), report() {} })
  await offline()
})
