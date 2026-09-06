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

test('successive R2 takes append in order without dismissing or hiding the existing transcript', async () => {
  const changes = [], results = [' First sentence. ', ' Second sentence. ', 'Third sentence.']
  let index = 0
  const { capture, calls } = harness({ changed: state => changes.push(state), transcribe: async () => ({ text: results[index++] }) })
  await capture.press(); await capture.release()
  changes.length = 0
  await capture.press()
  assert.equal(capture.state.text, 'First sentence.')
  const release = capture.release()
  assert.equal(capture.state.text, 'First sentence.')
  await release
  assert.equal(capture.state.text, 'First sentence. Second sentence.')
  assert.equal(changes.some(state => state.phase === 'idle' || !state.text), false)
  await capture.press(); await capture.release(); await capture.confirm()
  assert.deepEqual(calls.copies, ['First sentence. Second sentence. Third sentence.'])
})

test('an empty additional transcript preserves earlier words without adding whitespace', async () => {
  let take = 0
  const { capture } = harness({ transcribe: async () => ({ text: take++ ? ' \n ' : 'Keep this.' }) })
  await capture.press(); await capture.release()
  await capture.press(); await capture.release()
  assert.equal(capture.state.text, 'Keep this.')
  assert.equal(capture.state.phase, 'ready')
  assert.match(capture.state.error, /No additional speech/)
})

test('a failed additional upload keeps the draft copyable and the next take can append', async () => {
  let take = 0
  const { capture, calls } = harness({ transcribe: async () => {
    if (++take === 2) throw new Error('Network unavailable')
    return { text: take === 1 ? 'Keep this.' : 'And this.' }
  } })
  await capture.press(); await capture.release()
  await capture.press(); await capture.release()
  assert.equal(capture.state.text, 'Keep this.')
  assert.equal(capture.state.phase, 'ready')
  assert.equal(capture.state.error, 'Network unavailable')
  await capture.press(); await capture.release(); await capture.confirm()
  assert.deepEqual(calls.copies, ['Keep this. And this.'])
})

test('additional microphone errors preserve the completed transcript', async () => {
  let onError
  const { capture, recorder } = harness({ record: async callback => { onError = callback; return recorder } })
  await capture.press(); await capture.release()
  await capture.press()
  onError(new Error('Microphone disconnected'))
  assert.equal(capture.state.text, 'Hello world.')
  assert.equal(capture.state.phase, 'ready')
  assert.equal(capture.state.stream, null)
  await capture.release()
  assert.equal(capture.state.text, 'Hello world.')
})

test('releasing R2 during additional microphone permission keeps the draft and stops late tracks', async () => {
  const mic = deferred(), started = deferred()
  let take = 0
  const { capture, recorder, calls } = harness({ record: () => {
    if (take++ === 0) return Promise.resolve(recorder)
    started.resolve(); return mic.promise
  } })
  await capture.press(); await capture.release()
  const opening = capture.press()
  await started.promise
  await capture.release()
  assert.equal(capture.state.phase, 'ready')
  assert.equal(capture.state.text, 'Hello world.')
  mic.resolve(recorder); await opening
  assert.equal(calls.cancels, 1)
  assert.equal(calls.uploads.length, 1)
})

test('R2 cannot start another take during upload or copying', async () => {
  const transcription = deferred(), uploading = deferred(), clipboard = deferred()
  let recordings = 0
  const { capture, recorder } = harness({
    record: async () => { recordings++; return recorder },
    transcribe: () => { uploading.resolve(); return transcription.promise },
    copy: () => clipboard.promise,
  })
  await capture.press()
  const release = capture.release()
  await uploading.promise
  await capture.press(); await capture.release()
  assert.equal(capture.state.phase, 'transcribing')
  transcription.resolve({ text: 'One take.' }); await release
  const copying = capture.confirm()
  await capture.press(); await capture.release()
  assert.equal(capture.state.phase, 'copying')
  assert.equal(recordings, 1)
  clipboard.resolve(); await copying
})

test('dismissal clears every take and an old additional upload cannot append into a new draft', async () => {
  const old = deferred(), uploading = deferred()
  let take = 0
  const { capture } = harness({ transcribe: () => {
    if (++take === 2) { uploading.resolve(); return old.promise }
    return Promise.resolve({ text: take === 1 ? 'Old draft.' : 'New draft.' })
  } })
  await capture.press(); await capture.release()
  await capture.press()
  const release = capture.release()
  await uploading.promise
  capture.cancel()
  await capture.press(); await capture.release()
  old.resolve({ text: 'Must not appear.' }); await release
  assert.equal(capture.state.text, 'New draft.')
})
