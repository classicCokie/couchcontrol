import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFolderQueue } from '../features/folders/queue.js'

test('two group members request folders in order without canceling each other', async () => {
  let current
  const queue = createFolderQueue(request => { current = request })
  const first = queue.choose({ title: 'Codex 1' }), second = queue.choose({ title: 'Codex 2' })
  assert.equal(current.title, 'Codex 1')
  queue.finish('/one')
  assert.equal(await first, '/one')
  assert.equal(current.title, 'Codex 2')
  queue.finish('/two')
  assert.equal(await second, '/two')
  assert.equal(current, null)
})

test('unmount aborts a queued member and cancellation releases every pending request', async () => {
  let current
  const queue = createFolderQueue(request => { current = request })
  const controller = new AbortController()
  const first = queue.choose({ title: 'first' })
  const second = queue.choose({ title: 'second', signal: controller.signal })
  controller.abort()
  assert.equal(await second, null)
  assert.equal(current.title, 'first')
  const third = queue.choose({ title: 'third' })
  queue.cancelAll()
  assert.deepEqual(await Promise.all([first, third]), [null, null])
  assert.equal(current, null)
  assert.equal(await queue.choose({ signal: controller.signal }), null)
})
