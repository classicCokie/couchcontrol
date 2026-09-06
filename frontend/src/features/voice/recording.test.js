import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startRecording } from './recording.js'

function microphone() {
  const track = { stopped: false, stop() { this.stopped = true } }
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
  const instances = []
  class Recorder {
    static isTypeSupported(type) { return type.includes('webm') }
    constructor(stream, { mimeType }) { this.mimeType = mimeType; this.state = 'inactive'; instances.push(this) }
    start() { this.state = 'recording' }
    stop() {
      this.state = 'inactive'
      queueMicrotask(() => {
        this.ondataavailable({ data: new Blob(['final chunk']) })
        this.onstop()
      })
    }
  }
  return { track, instances, options: { nav: { mediaDevices: { getUserMedia: async () => stream } }, Recorder } }
}

test('stopping includes the final audio chunk and closes microphone tracks', async () => {
  const { track, instances, options } = microphone()
  const recording = await startRecording(assert.fail, options)
  instances[0].ondataavailable({ data: new Blob(['first chunk ']) })
  const audio = await recording.stop()
  assert.equal(await audio.text(), 'first chunk final chunk')
  assert.equal(audio.type, 'audio/webm;codecs=opus')
  assert.equal(track.stopped, true)
})

test('canceling discards buffered and late audio', async () => {
  const { track, instances, options } = microphone()
  const recording = await startRecording(assert.fail, options)
  instances[0].ondataavailable({ data: new Blob(['private audio']) })
  recording.cancel()
  const audio = await recording.stop()
  assert.equal(audio.size, 0)
  assert.equal(track.stopped, true)
})

test('constructor failure releases the microphone', async () => {
  const { track, options } = microphone()
  options.Recorder = class { static isTypeSupported() { return true } constructor() { throw new Error('unsupported') } }
  await assert.rejects(startRecording(assert.fail, options), /unsupported/)
  assert.equal(track.stopped, true)
})

test('permission errors explain how to retry', async () => {
  const { options } = microphone()
  options.nav.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError') }
  await assert.rejects(startRecording(assert.fail, options), /Allow microphone access/)
})
