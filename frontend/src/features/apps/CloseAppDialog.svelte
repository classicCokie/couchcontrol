<script>
  import { onMount } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'

  export let app
  export let busy = false
  export let error = ''
  export let reducedMotion = false
  export let onconfirm = () => {}
  export let oncancel = () => {}
  let dialog

  export function handleAction(action) {
    if (!busy && action === 'confirm') onconfirm()
    if (!busy && action === 'back') oncancel()
    return true
  }
  export function handleKeydown(event) {
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault()
      if (!event.repeat) {
        if (event.key === 'Enter' && event.target?.tagName === 'BUTTON') event.target.click()
        else handleAction(event.key === 'Escape' ? 'back' : 'confirm')
      }
    } else if (event.key === 'Tab') {
      event.preventDefault()
      const buttons = [...dialog.querySelectorAll('button:not(:disabled)')]
      const index = buttons.indexOf(document.activeElement)
      buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
    }
  }
  onMount(() => { dialog.focus({ preventScroll: true }) })
</script>

<div class="backdrop">
  <div bind:this={dialog} class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="close-app-title" aria-describedby="close-app-description" aria-busy={busy} tabindex="-1"
    transition:fly={{ y: 24, duration: reducedMotion ? 0 : 220, easing: cubicOut }}>
    <h2 id="close-app-title">Close {app.title}?</h2>
    <p id="close-app-description">{app.type === 'group' ? 'This will close both apps in this group, stop any running Codex processes, and remove their saved terminal sessions.' : app.type === 'codex' ? 'This will stop its running process and remove its saved terminal session.' : 'Are you sure you want to close this app?'}</p>
    {#if app.groupId !== undefined}<p class="scope-note">Only this app will close. Any app on the other side stays open.</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <footer>
      <button disabled={busy} onclick={oncancel}><span aria-hidden="true">○</span> Cancel <kbd>Esc</kbd></button>
      <button class="confirm" disabled={busy} onclick={onconfirm}><span aria-hidden="true">×</span> {busy ? 'Closing…' : app.type === 'group' ? 'Close group' : 'Close app'} <kbd>Enter</kbd></button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; padding: 24px; background: #030a11a6; backdrop-filter: blur(8px); }
  .dialog { width: min(540px, 100%); padding: clamp(24px, 4vw, 36px); border: 1px solid #b7d6c92b; border-radius: 22px; background: #172b28; box-shadow: 0 24px 80px #0006; outline: none; }
  h2 { margin: 0 0 16px; color: #e0ece7; font-size: 28px; font-weight: 500; }
  p { margin: 0; color: #aec8be; line-height: 1.6; }
  .error { color: #ffcbc2; margin-top: 16px; }
  .scope-note { margin-top: 12px; }
  footer { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 28px; }
  button { display: flex; align-items: center; justify-content: center; gap: 10px; flex: 1; white-space: nowrap; padding: 12px; border: 1px solid #ffffff25; border-radius: 10px; background: #ffffff08; font-size: 14px; }
  button span { font-size: 23px; line-height: 1; }
  button kbd { font-size: 10px; opacity: .7; }
  .confirm { background: #bee9ca; color: #142d24; border-color: transparent; }
  button:disabled { opacity: .45; cursor: wait; }
</style>
