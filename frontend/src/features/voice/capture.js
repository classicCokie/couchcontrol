// Own one hold gesture across microphone permission, recording, upload and copy.
// A generation token makes late permission/API responses harmless after cancel.
export function createVoiceCapture({ configured, record, transcribe, copy, changed, copied = () => {} }) {
  let state = { phase: 'idle', text: '', error: '', stream: null }
  let generation = 0, held = false, recording, upload
  const emit = patch => { state = { ...state, ...patch }; changed(state) }
  function cancel() {
    generation++
    held = false
    recording?.cancel()
    recording = undefined
    upload?.abort()
    upload = undefined
    emit({ phase: 'idle', stream: null, text: '', error: '' })
  }
  async function press() {
    if (held || ['preparing', 'recording', 'transcribing'].includes(state.phase)) return
    cancel()
    held = true
    const id = generation
    emit({ phase: 'preparing' })
    try {
      if (!await configured()) throw new Error('Add your Whisper API key in Settings to enable transcription.')
      if (id !== generation || !held) return
      const next = await record(error => {
        if (id !== generation) return
        cancel()
        emit({ phase: 'error', error: error.message })
      })
      if (id !== generation || !held) { next.cancel(); return }
      recording = next
      emit({ phase: 'recording', stream: next.stream })
    } catch (error) {
      if (id !== generation) return
      held = false
      emit({ phase: 'error', error: error.message, stream: null })
    }
  }
  async function release() {
    if (!held) return
    held = false
    if (!recording) { cancel(); return }
    const id = generation, current = recording
    emit({ phase: 'transcribing', stream: null })
    try {
      const audio = await current.stop()
      if (id !== generation) return
      recording = undefined
      if (!audio.size) throw new Error('No audio was captured. Hold R2 and try again.')
      upload = new AbortController()
      const result = await transcribe(audio, upload.signal)
      if (id !== generation) return
      upload = undefined
      emit({ phase: 'ready', text: result.text.trim(), error: '' })
    } catch (error) {
      if (id !== generation) return
      recording = undefined
      emit({ phase: 'error', error: error.message })
    }
  }
  async function confirm() {
    if (state.phase !== 'ready' || !state.text) return
    const id = generation, text = state.text
    emit({ phase: 'copying', error: '' })
    try {
      await copy(text)
    } catch {
      if (id === generation) emit({ phase: 'ready', error: 'Clipboard access was blocked. Use the Copy button to allow it.' })
      return
    }
    if (id !== generation) return
    cancel()
    copied(text)
  }
  return { press, release, cancel, confirm, get state() { return state } }
}
