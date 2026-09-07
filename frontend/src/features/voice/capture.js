// Own one hold gesture across microphone permission, recording, upload and copy.
// A generation token makes late permission/API responses harmless after cancel.
export function createVoiceCapture({ configured, record, transcribe, copy, changed, copied = () => {} }) {
  let state = { phase: 'idle', text: '', error: '', stream: null }
  let generation = 0, held = false, recording, upload
  const takes = []
  const emit = patch => { state = { ...state, ...patch }; changed(state) }
  function stopWork() {
    generation++
    held = false
    recording?.cancel()
    recording = undefined
    upload?.abort()
    upload = undefined
  }
  function cancel() {
    stopWork()
    takes.length = 0
    emit({ phase: 'idle', stream: null, text: '', error: '' })
  }
  function removeLast() {
    if (state.phase !== 'ready' || !takes.length) return
    takes.pop()
    emit({ text: takes.join(' '), error: '' })
  }
  function fail(error) {
    stopWork()
    emit({ phase: state.text ? 'ready' : 'error', stream: null, error: error.message })
  }
  async function press() {
    if (held || ['preparing', 'recording', 'transcribing', 'copying'].includes(state.phase)) return
    // Start another take without dismissing the overlay or clearing its draft.
    stopWork()
    held = true
    const id = generation
    emit({ phase: 'preparing', stream: null, error: '' })
    try {
      if (!await configured()) throw new Error('Add your Whisper API key in Settings to enable transcription.')
      if (id !== generation || !held) return
      const next = await record(error => {
        if (id !== generation) return
        fail(error)
      })
      if (id !== generation || !held) { next.cancel(); return }
      recording = next
      emit({ phase: 'recording', stream: next.stream })
    } catch (error) {
      if (id !== generation) return
      fail(error)
    }
  }
  async function release() {
    if (!held) return
    held = false
    if (!recording) {
      stopWork()
      emit({ phase: state.text ? 'ready' : 'idle', stream: null, error: '' })
      return
    }
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
      const addition = result.text.trim()
      if (addition) takes.push(addition)
      emit({ phase: 'ready', text: takes.join(' '), error: !addition && state.text ? 'No additional speech was detected. Hold R2 to try again.' : '' })
    } catch (error) {
      if (id !== generation) return
      fail(error)
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
  return { press, release, cancel, confirm, removeLast, get state() { return state } }
}
