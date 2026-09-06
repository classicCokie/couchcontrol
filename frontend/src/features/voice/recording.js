const MAX_BYTES = 24_000_000

export async function startRecording(onError, { nav = navigator, Recorder = globalThis.MediaRecorder } = {}) {
  if (!nav.mediaDevices?.getUserMedia || !Recorder) throw new Error('Microphone recording needs a supported browser on localhost or HTTPS.')
  let stream
  try { stream = await nav.mediaDevices.getUserMedia({ audio: true }) } catch (error) {
    if (error.name === 'NotAllowedError') throw new Error('Microphone access was denied. Allow microphone access for this site and hold R2 again.')
    if (error.name === 'NotFoundError') throw new Error('No microphone was found. Connect a microphone and try again.')
    throw new Error('The microphone is unavailable. Check that another app is not using it.')
  }
  let recorder
  try {
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => Recorder.isTypeSupported(type))
    if (!mimeType) throw new Error('This browser does not support a compatible audio recording format.')
    recorder = new Recorder(stream, { mimeType, audioBitsPerSecond: 64000 })
  } catch (error) { stream.getTracks().forEach(track => track.stop()); throw error }
  const chunks = []
  let bytes = 0, discarded = false, finished = false, resolve
  const completion = new Promise(done => { resolve = done })
  const tracksOff = () => stream.getTracks().forEach(track => track.stop())
  const cancel = () => {
    discarded = true
    chunks.length = 0
    if (recorder.state !== 'inactive') recorder.stop()
    tracksOff()
  }
  recorder.ondataavailable = event => {
    if (discarded || !event.data.size) return
    bytes += event.data.size
    if (bytes > MAX_BYTES) { cancel(); onError(new Error('Recording exceeded 24 MB. Try a shorter recording.')); return }
    chunks.push(event.data)
  }
  recorder.onstop = () => {
    finished = true
    tracksOff()
    resolve(new Blob(discarded ? [] : chunks, { type: recorder.mimeType }))
    chunks.length = 0
  }
  recorder.onerror = () => { cancel(); onError(new Error('The microphone recording failed. Please try again.')) }
  for (const track of stream.getAudioTracks()) track.onended = () => {
    if (!finished && !discarded) { cancel(); onError(new Error('The microphone disconnected. Recording was canceled.')) }
  }
  try { recorder.start(250) } catch (error) { tracksOff(); throw error }
  return {
    stream, cancel,
    stop() { if (recorder.state !== 'inactive') recorder.stop(); tracksOff(); return completion },
  }
}
