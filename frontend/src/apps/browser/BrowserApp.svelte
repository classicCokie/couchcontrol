<script>
  import { onMount, onDestroy } from 'svelte'
  import { platformRequest } from '../../lib/platform-api.js'
  import { createCommandSession } from './commands.js'
  import { createRemoteBrowser } from './remote.js'
  import { createNativeBrowser } from './native.js'

  export let title = 'Browser'
  export let cardId
  const desktop = window.couchDesktop
  let viewport, address = ''
  export let initialUrl = ''
  export let active = true
  export let canPaste = () => true
  export let onnavigate = () => {}
  export let onback = () => {}
  let input, state, live = null, connectionError = '', lastUrl = initialUrl
  const remote = (desktop ? createNativeBrowser : createRemoteBrowser)({ bridge: desktop, id: String(cardId), request: platformRequest, initialUrl, changed: ({ frame, error }) => {
    live = frame; connectionError = error
    if (frame?.url && frame.url !== 'about:blank') address = frame.url
    if (frame?.url && /^https?:\/\//i.test(frame.url) && frame.url !== lastUrl) { lastUrl = frame.url; onnavigate(frame.url) }
  } })
  const session = createCommandSession({
    initialUrl, enabled: () => active && canPaste(), changed: next => { state = next },
    interpret: (body, signal) => remote.interpret(body, signal),
    navigate: url => onnavigate(url), leave: () => onback(), readClipboard: () => navigator.clipboard.readText(),
  })
  state = session.state
  $: if (!active) session.cancel()
  $: if (state.busy && !canPaste()) session.cancel()
  onMount(() => { remote.start(viewport) })
  onDestroy(() => { session.dispose(); remote.dispose() })
  export function focusNavigation() { input?.focus({ preventScroll: true }) }
  export function captureEmptyInput() { return session.captureEmptyInput() }
  export function pasteIfEmpty(text, snapshot) { return session.pasteIfEmpty(text, snapshot) }
  export function pasteClipboard() { return session.pasteClipboard() }
  export function pressEnter() { return session.submit() }
  export function control(action) {
    if (action === 'back') {
      if (state.busy) { session.cancel(); return true }
      return false
    }
    if (action === 'confirm') { session.submit(); return true }
    if (action === 'up' || action === 'down') {
      if (active && !state.busy) void remote.scroll(action)
      return true
    }
    if (action === 'left') { if (!state.busy) session.edit(''); return true }
    if (action === 'right') return true
    return false
  }
</script>

<section class="browser-app" aria-label={title}>
  <form onsubmit={event => { event.preventDefault(); session.submit() }} aria-busy={state.busy}>
    <span class:thinking={state.busy} aria-hidden="true">✳</span>
    <input bind:this={input} value={state.draft} oninput={event => session.edit(event.currentTarget.value)}
      aria-label="Browser command" placeholder={state.busy ? 'Understanding your command…' : 'Tell your browser what to do…'}
      readonly={state.busy} autocomplete="off" spellcheck="false" maxlength="4000" />
  </form>
  <div class="feedback" aria-live="polite">
    {#if state.error}<p class="error" role="alert">{state.error}</p>
    {:else if connectionError}<p class="error" role="alert">{connectionError}</p>
    {:else if state.busy}<p>Understanding your command…</p>
    {:else if state.message}<p>{state.message}</p>{/if}
    <p class="hint">Left stick ↑↓ · Scroll　 R2 · Record　 × / A · Run　 □ / X · Paste　 ← · Clear　 ○ / B · Back</p>
  </div>
  {#if desktop}
    <form class="navigation" onsubmit={event => { event.preventDefault(); let url = address.trim(); if (!/^https?:\/\//i.test(url)) url = (/^(localhost|127\.|\[::1\])/.test(url) ? 'http://' : 'https://') + url; void remote.action('navigate', url) }}>
      <button type="button" aria-label="Go back" disabled={!live?.canBack || state.busy} onclick={() => remote.action('back')}>←</button>
      <button type="button" aria-label="Go forward" disabled={!live?.canForward || state.busy} onclick={() => remote.action('forward')}>→</button>
      <button type="button" aria-label="Reload page" disabled={state.busy} onclick={() => remote.action('reload')}>↻</button>
      <input aria-label="Page address" bind:value={address} placeholder="Enter a web address" disabled={state.busy} />
      <button type="button" onclick={onback}>Shelf</button>
    </form>
    <div class="native-viewport" bind:this={viewport} aria-label="Live website"></div>
  {:else if live?.image && live.url !== 'about:blank'}
    <div class="preview-area">
      <img src={'data:image/jpeg;base64,' + live.image} alt={'Live browser view: ' + (live.title || live.url)} width={live.width} height={live.height} />
    </div>
  {:else}
    <div class="welcome">
      <h1>Say where you want to go.</h1>
      <p>“Open localhost on port three thousand.”<br />“Show it at phone width.”<br />“Reload the page.”</p>
      {#if !live && !connectionError}<p role="status">Starting Chromium…</p>{/if}
      <small>Hold R2, speak, and release. Confirm the transcript to paste it here.<br />Press × / A again to run your command.</small>
    </div>
  {/if}
</section>

<style>
  .browser-app { height: 100%; display: flex; flex-direction: column; color: #f7e5cb; background: #211c16; padding-bottom: 60px; box-sizing: border-box; }
  form { display: flex; align-items: center; gap: 12px; margin: 18px 20px 0; padding: 4px 18px; border: 1px solid #ffffff30; border-radius: 16px; background: #100e0c; flex-shrink: 0; }
  form:focus-within { border-color: #f7d6a5; box-shadow: 0 0 0 2px #f7d6a520; }
  form span { font-size: 24px; color: #edc48e; }
  .thinking { opacity: .5; }
  input { width: 100%; min-width: 0; padding: 16px 0; border: 0; outline: 0; background: transparent; color: #fff5e8; font: inherit; font-size: 16px; }
  .feedback { flex-shrink: 0; padding: 10px 24px 14px; }
  .feedback p { margin: 0 0 5px; font-size: 13px; overflow-wrap: anywhere; }
  .feedback .hint { font-size: 11px; color: #aa9984; }
  .error { color: #ffb8a6; }
  .preview-area { flex: 1; min-height: 0; overflow: auto; display: flex; background: #12100e; border-block: 1px solid #ffffff20; }
  .navigation { margin: 0 20px 12px; padding: 0 8px; gap: 6px; }
  .navigation input { padding: 10px 4px; font-size: 13px; }
  .navigation button { border: 0; padding: 8px; color: inherit; background: transparent; cursor: pointer; }
  .navigation button:disabled { opacity: .35; cursor: default; }
  .native-viewport { flex: 1; min-height: 0; background: #fff; }
  img { display: block; max-width: 100%; width: auto; height: auto; max-height: 100%; object-fit: contain; object-position: top center; margin-inline: auto; background: white; }
  .welcome { margin: auto; padding: 24px; text-align: center; overflow: auto; }
  h1 { font-size: clamp(26px, 4cqw, 46px); font-weight: 500; margin: 16px 0; }
  .welcome p { color: #c4b39e; font-size: 18px; line-height: 1.9; }
  small { display: block; color: #aa9984; font-size: 12px; line-height: 1.7; }
</style>
