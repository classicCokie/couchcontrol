<script>
  import { onMount, tick } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { platformRequest, transcribe } from '../../lib/platform-api.js'
  import { createVoiceCapture } from './capture.js'
  import { startRecording } from './recording.js'
  import { copyText } from './clipboard.js'
  import Waveform from './Waveform.svelte'

  export let opened = false
  export let directToNote = false
  export let directToName = false
  export let oncopied = () => {}
  let state = { phase: 'idle', text: '', error: '', stream: null }
  let dialog, transcript, previousFocus, reducedMotion = false
  const capture = createVoiceCapture({
    configured: async () => (await platformRequest('/settings')).whisperConfigured,
    record: startRecording, transcribe, copy: text => (directToNote || directToName) ? Promise.resolve() : copyText(text), copied: text => oncopied(text),
    changed(next) {
      const wasOpen = opened
      const previousText = state.text
      state = next
      opened = next.phase !== 'idle'
      if (!wasOpen && opened) {
        if (!dialog?.contains(document.activeElement)) previousFocus = document.activeElement
        tick().then(() => { if (opened) dialog?.focus({ preventScroll: true }) })
      } else if (wasOpen && !opened) {
        tick().then(() => { if (!opened && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) })
      }
      if (next.text && next.text !== previousText) {
        tick().then(() => { if (opened && transcript) transcript.scrollTop = transcript.scrollHeight })
      }
    },
  })
  export function handleAction(action) {
    if (action === 'record-start') { capture.press(); return true }
    if (action === 'record-end') { capture.release(); return true }
    if (action === 'record-cancel') {
      if (['preparing', 'recording'].includes(capture.state.phase)) capture.cancel()
      return true
    }
    if (capture.state.phase === 'idle') return false
    if (action === 'back') capture.cancel()
    if (action === 'confirm') capture.confirm()
    if (action === 'paste') capture.removeLast()
    if (action === 'up' || action === 'down') transcript?.scrollBy({ top: action === 'up' ? -100 : 100 })
    return true
  }
  onMount(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotion = () => { reducedMotion = motion.matches }
    updateMotion()
    motion.addEventListener('change', updateMotion)
    const keys = event => {
      if (!opened) return
      event.stopImmediatePropagation()
      if (event.key === 'Escape') { event.preventDefault(); capture.cancel() }
      else if (event.key === 'Enter' && event.target?.tagName !== 'BUTTON') { event.preventDefault(); capture.confirm() }
      else if (event.key === 'Tab') {
        event.preventDefault()
        const buttons = [...dialog.querySelectorAll('button:not(:disabled)')]
        const current = buttons.indexOf(document.activeElement)
        buttons[(current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
      }
    }
    const hidden = () => { if (document.hidden) handleAction('record-cancel') }
    window.addEventListener('keydown', keys, true)
    document.addEventListener('visibilitychange', hidden)
    return () => { capture.cancel(); window.removeEventListener('keydown', keys, true); document.removeEventListener('visibilitychange', hidden); motion.removeEventListener('change', updateMotion) }
  })
  $: heading = { preparing: 'Getting your microphone ready…', recording: 'Listening', transcribing: 'Transcribing…', ready: 'Your words', copying: directToName ? 'Updating name…' : directToNote ? 'Sending to note…' : 'Copying…', error: 'Unable to transcribe' }[state.phase]
</script>

{#if opened}
  <div class="voice-backdrop">
    <div bind:this={dialog} data-voice-dialog class="voice-dialog" role="dialog" aria-modal="true" aria-labelledby="voice-title" tabindex="-1"
      transition:fly={{ y: 280, duration: reducedMotion ? 0 : 260, easing: cubicOut }}>
      <div class="handle" aria-hidden="true"></div>
      <header><div><p class="eyebrow">Voice capture</p><h2 id="voice-title">{heading}</h2></div><span class:recording={state.phase === 'recording'} class="status-light" aria-hidden="true"></span></header>
      {#key state.stream}<Waveform stream={state.stream} />{/key}
      <div bind:this={transcript} class="transcript" aria-live="polite" role="status">
        {#if state.error}<p class="error">{state.error}</p>{/if}
        {#if state.text}<p class="words">{state.text}</p>
        {:else if state.phase === 'recording'}<p>Keep holding R2 while you speak. Release to transcribe.</p>
        {:else if state.phase === 'preparing'}<p>Allow microphone access if prompted, then keep holding R2.</p>
        {:else if state.phase === 'transcribing'}<p>Turning your recording into text…</p>
        {:else if state.phase === 'ready'}<p>No text yet. Hold R2 to record.</p>{/if}
      </div>
      {#if state.text}
        <p class="append-hint" role="status">{state.phase === 'recording' ? 'Keep holding R2. Release to add these words.' : state.phase === 'transcribing' ? 'Transcribing your next words…' : state.phase === 'preparing' ? 'Preparing the microphone. Your text is saved above.' : state.phase === 'copying' ? directToName ? 'Sending your name…' : directToNote ? 'Sending your complete transcript…' : 'Copying your complete transcript…' : directToName ? 'Hold R2 to add more · □ / X to remove last · × / A to use name' : directToNote ? 'Hold R2 to add more · □ / X to remove last · × / A to update note' : 'Hold R2 to add more · □ / X to remove last · × / A to copy all text'}</p>
      {/if}
      <footer>
        <button onclick={() => capture.cancel()}><span class="controller-key">○</span>{['preparing', 'recording'].includes(state.phase) ? 'Cancel recording' : 'Dismiss'}</button>
        <button onclick={() => capture.removeLast()} disabled={!state.text || state.phase !== 'ready'}><span class="controller-key">□</span>Remove last transcription</button>
        <button class="copy" onclick={() => capture.confirm()} disabled={!state.text || state.phase !== 'ready'}><span class="controller-key">×</span>{state.phase === 'copying' ? (directToName ? 'Sending…' : directToNote ? 'Sending…' : 'Copying…') : (directToName ? 'Use name' : directToNote ? 'Update note' : 'Copy all text')}</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .voice-backdrop { position: fixed; inset: 0; z-index: 100; display: flex; align-items: end; justify-content: center; background: #030a1180; backdrop-filter: blur(7px); }
  .voice-dialog { width: 100%; height: min(600px, 65dvh); min-height: min(370px, 100dvh); display: flex; flex-direction: column; padding: 12px clamp(24px, 8vw, 120px) 24px; border: 1px solid #ffffff25; border-bottom: none; border-radius: 28px 28px 0 0; background: linear-gradient(135deg, #213e37, #142a2b); box-shadow: 0 -20px 80px #0005; outline: none; }
  .handle { align-self: center; width: 44px; height: 4px; background: #bed6cc40; border-radius: 4px; flex-shrink: 0; margin-bottom: 20px; }
  header { display: flex; align-items: center; justify-content: space-between; }
  .eyebrow { margin: 0 0 8px; }
  h2 { font-size: clamp(23px, 3vw, 36px); font-weight: 500; margin: 0; letter-spacing: -.03em; }
  .status-light { width: 10px; height: 10px; background: #68877b; border-radius: 50%; }
  .status-light.recording { background: #c2f5d4; box-shadow: 0 0 20px #99e9b980; }
  .transcript { flex: 1; min-height: 70px; overflow-y: auto; border-top: 1px solid #ffffff20; padding: 18px 0; }
  p { color: #aec8be; line-height: 1.6; margin: 0; }
  .words { font-size: clamp(19px, 2.1vw, 28px); color: #eef9f1; white-space: pre-wrap; overflow-wrap: anywhere; }
  .error { color: #ffcbc2; margin-bottom: 8px; }
  .append-hint { flex-shrink: 0; font-size: 12px; color: #c5e4d5; }
  footer { display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between; margin-top: 12px; }
  button { display: flex; align-items: center; gap: 12px; background: #ffffff08; border: 1px solid #ffffff25; border-radius: 12px; padding: 12px 18px; font-size: 14px; }
  button:hover { background: #ffffff16; }
  .copy { background: #bee9ca; color: #142d24; border-color: transparent; }
  button:disabled { opacity: .3; cursor: default; }
  .controller-key { font-size: 24px; line-height: 1; }
  @media (max-height: 580px) { .voice-dialog { height: 90dvh; padding-bottom: 12px; } .handle { margin-bottom: 8px; } }
</style>
