import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVoiceCapture } from './capture.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function harness(overrides = {}) {
  const calls = { stops: 0, cancels: 0, uploads: [], copies: [] }
  const audio = new Blob(['audio'], { type: 'audio/webm' })
  const recorder = { stream: {}, stop: async () => { calls.stops++; return audio }, cancel: () => { calls.cancels++ } }
  const capture = createVoiceCapture({ configured: async () => true, record: async () => recorder,
    transcribe: async (audio, signal) => { calls.uploads.push({ audio, signal }); return { text: ' Hello world. ' } },
    copy: async text => { calls.copies.push(text) }, changed() {}, ...overrides })
  return { capture, calls, recorder, audio }
}

test('R2 records until release, then transcribes and copies the resulting text', async () => {
  const { capture, calls } = harness()
  await capture.press()
  assert.equal(capture.state.phase, 'recording')
  assert.equal(calls.uploads.length, 0)
  await capture.confirm()
  assert.equal(calls.copies.length, 0)
  await capture.release()
  assert.equal(calls.stops, 1)
  assert.equal(calls.uploads.length, 1)
  assert.equal(capture.state.text, 'Hello world.')
  assert.equal(capture.state.stream, null)
  await capture.confirm()
  assert.deepEqual(calls.copies, ['Hello world.'])
  assert.equal(capture.state.text, '')
  assert.equal(capture.state.phase, 'idle')
})

test('Circle while R2 is held discards recording; subsequent release never uploads', async () => {
  const { capture, calls } = harness()
  await capture.press()
  capture.cancel()
  await capture.release()
  assert.equal(calls.cancels, 1)
  assert.equal(calls.uploads.length, 0)
  assert.equal(capture.state.phase, 'idle')
})

test('release or cancel during permission request closes late microphone tracks without uploading', async () => {
  for (const action of ['release', 'cancel']) {
    const mic = deferred(), started = deferred()
    const { capture, calls, recorder } = harness({ record: () => { started.resolve(); return mic.promise } })
    const opening = capture.press()
    await started.promise
    await capture[action]()
    mic.resolve(recorder)
    await opening
    assert.equal(calls.cancels, 1)
    assert.equal(calls.uploads.length, 0)
    assert.equal(capture.state.phase, 'idle')
  }
})

test('cancel during recorder finalization discards audio before any network request', async () => {
  const stop = deferred()
  const { capture, calls, recorder, audio } = harness()
  recorder.stop = () => stop.promise
  await capture.press()
  const release = capture.release()
  capture.cancel()
  stop.resolve(audio)
  await release
  assert.equal(calls.uploads.length, 0)
  assert.equal(capture.state.phase, 'idle')
})

test('cancel aborts an upload and ignores a late transcription response', async () => {
  const upstream = deferred(), started = deferred()
  let signal
  const { capture } = harness({ transcribe: (_, abortSignal) => { signal = abortSignal; started.resolve(); return upstream.promise } })
  await capture.press()
  const release = capture.release()
  await started.promise
  capture.cancel()
  assert.equal(signal.aborted, true)
  upstream.resolve({ text: 'must not reappear' })
  await release
  assert.equal(capture.state.phase, 'idle')
  assert.equal(capture.state.text, '')
})

test('missing API key does not request microphone access', async () => {
  const { capture } = harness({ configured: async () => false, record: () => assert.fail('microphone requested') })
  await capture.press()
  assert.equal(capture.state.phase, 'error')
  assert.match(capture.state.error, /Settings/)
})

test('empty capture is not submitted and clipboard rejection preserves the transcript', async () => {
  const { capture, recorder, calls } = harness()
  recorder.stop = async () => new Blob([])
  await capture.press(); await capture.release()
  assert.equal(calls.uploads.length, 0)
  assert.equal(capture.state.phase, 'error')
  const other = harness({ copy: async () => { throw new Error('blocked') } }).capture
  await other.press(); await other.release(); await other.confirm()
  assert.equal(other.state.text, 'Hello world.')
  assert.match(other.state.error, /Clipboard/)
})


test('copy waits for clipboard success before dismissing and ignores duplicate confirms', async () => {
  const clipboard = deferred()
  let copies = 0
  const { capture } = harness({ copy: () => { copies++; return clipboard.promise } })
  await capture.press(); await capture.release()
  const copying = capture.confirm()
  assert.equal(capture.state.phase, 'copying')
  assert.equal(capture.state.text, 'Hello world.')
  await capture.confirm()
  assert.equal(copies, 1)
  clipboard.resolve()
  await copying
  assert.equal(capture.state.phase, 'idle')
})

test('an earlier copy finishing cannot dismiss a new recording', async () => {
  const clipboard = deferred()
  const { capture } = harness({ copy: () => clipboard.promise })
  await capture.press(); await capture.release()
  const copying = capture.confirm()
  capture.cancel()
  await capture.press()
  clipboard.resolve()
  await copying
  assert.equal(capture.state.phase, 'recording')
  capture.cancel()
})

test('copy callback receives the transcript only after success and dismissal', async () => {
  const events = []
  const { capture } = harness({ copied: text => events.push([text, capture.state.phase]) })
  await capture.press(); await capture.release(); await capture.confirm()
  assert.deepEqual(events, [['Hello world.', 'idle']])
})

test('failed or canceled copies never trigger automatic pasting', async () => {
  const blocked = harness({ copy: async () => { throw new Error('blocked') }, copied: () => assert.fail('copied') }).capture
  await blocked.press(); await blocked.release(); await blocked.confirm()
  const clipboard = deferred()
  const { capture } = harness({ copy: () => clipboard.promise, copied: () => assert.fail('copied') })
  await capture.press(); await capture.release()
  const copying = capture.confirm()
  capture.cancel()
  clipboard.resolve()
  await copying
})
