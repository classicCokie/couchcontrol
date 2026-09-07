import test from 'node:test'
import assert from 'node:assert/strict'
import { createRemoteBrowser } from './remote.js'

test('remote browser reuses its session for commands and closes on dispose', async () => {
  const calls = []; const frames = []
  const browser = createRemoteBrowser({ initialUrl: 'https://example.com', schedule: () => 1, unschedule: () => {}, changed: value => frames.push(value), request: async (path, options) => {
    calls.push({ path, options })
    if (path === '/browser/sessions') return { id: 'renderer' }
    if (path.endsWith('/frame')) return { url: 'https://example.com', image: 'jpeg' }
    return { commands: [], message: 'Ready', page: { url: 'https://example.com' } }
  } })
  await browser.start()
  await browser.interpret({ text: 'reload' }, new AbortController().signal)
  assert.equal(calls.filter(call => call.path === '/browser/sessions').length, 1)
  assert.equal(calls.at(-1).options.body.sessionId, 'renderer')
  assert.equal(frames[0].frame.image, 'jpeg')
  browser.dispose()
  assert.equal(calls.at(-1).options.method, 'DELETE')
})

test('renderer that finishes opening after disposal is cleaned up', async () => {
  let resolve; const pending = new Promise(done => { resolve = done }); const deleted = []
  const browser = createRemoteBrowser({ changed: () => assert.fail('disposed renderer updated the view'), request: (path, options) => {
    if (options?.method === 'DELETE') { deleted.push(path); return Promise.resolve({}) }
    return pending
  } })
  const starting = browser.start(); browser.dispose(); resolve({ id: 'late' }); await starting
  assert.deepEqual(deleted, ['/browser/sessions/late'])
})

test('stick scrolling targets the current renderer and drops pending repeats', async () => {
  const calls = []; let finishScroll
  const browser = createRemoteBrowser({ schedule: () => 1, unschedule: () => {}, changed: () => {}, request: async (path, options) => {
    calls.push({ path, options })
    if (path === '/browser/sessions') return { id: 'renderer' }
    if (path.endsWith('/scroll')) return new Promise(resolve => { finishScroll = resolve })
    return { image: 'jpeg' }
  } })
  await browser.scroll('down')
  assert.equal(calls.length, 0)
  await browser.start()
  const scrolling = browser.scroll('down')
  await browser.scroll('down')
  assert.equal(calls.filter(call => call.path.endsWith('/scroll')).length, 1)
  assert.deepEqual(calls.at(-1).options.body, { direction: 'down' })
  assert.equal(calls.at(-1).path, '/browser/sessions/renderer/scroll')
  finishScroll({}); await scrolling
  const reversing = browser.scroll('up')
  assert.deepEqual(calls.at(-1).options.body, { direction: 'up' })
  const signal = calls.at(-1).options.signal
  browser.dispose()
  assert.equal(signal.aborted, true)
  finishScroll({}); await reversing
  const count = calls.length
  await browser.scroll('down')
  assert.equal(calls.length, count)
})
