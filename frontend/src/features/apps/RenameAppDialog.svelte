<script>
  import { onMount } from 'svelte'
  export let title
  export let onconfirm = () => {}
  export let oncancel = () => {}
  let value = title, input
  export function handleAction(action) {
    if (action === 'confirm' && value.trim()) onconfirm(value)
    if (action === 'back') oncancel()
  }
  export function handleKeydown(event) {
    if (event.isComposing) return
    if (['Enter', 'Escape', 'Tab'].includes(event.key)) {
      event.preventDefault()
      if (event.key === 'Tab') input?.focus()
      else if (!event.repeat) handleAction(event.key === 'Enter' ? 'confirm' : 'back')
    }
  }
  export function setTranscript(text) {
    if (text.trim()) value = text.replace(/\s+/g, ' ').trim()
    input?.focus({ preventScroll: true })
  }
  onMount(() => { input.focus({ preventScroll: true }); input.select() })
</script>

<div class="backdrop">
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Rename app or group" aria-describedby="rename-hint" tabindex="-1">
    <input bind:this={input} bind:value aria-label="Name" placeholder="Name your workspace" autocomplete="off" />
    <p id="rename-hint">Hold R2 to transcribe · × / A / Enter to save · ○ / Esc to cancel</p>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; padding: 24px; background: #030a11a6; backdrop-filter: blur(8px); }
  .dialog { width: min(960px, 100%); padding: clamp(28px, 6vw, 72px); border: 1px solid #b7d6c92b; border-radius: 24px; background: #172b28; box-shadow: 0 24px 80px #0006; }
  input { box-sizing: border-box; width: 100%; padding: 20px 0; border: 0; border-bottom: 2px solid #bee9ca; border-radius: 0; background: transparent; color: #eef9f1; font: inherit; font-size: clamp(28px, 5vw, 56px); outline: none; }
  input::placeholder { color: #aec8be; }
  p { margin: 24px 0 0; color: #aec8be; font-size: 14px; line-height: 1.6; }
</style>
