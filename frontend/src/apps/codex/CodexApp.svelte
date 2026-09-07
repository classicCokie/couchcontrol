<script>
  import { getContext, tick } from 'svelte'
  import { FOLDER_PICKER } from '../../features/folders/context.js'
  import Terminal from './Terminal.svelte'
  import CommandMenu from './CommandMenu.svelte'
  import { openAppSession } from './session.js'
  import { request } from './api.js'

  export let title = 'Codex'
  export let active = true
  export let canPaste = () => true
  export let oncancel = () => {}
  const chooseFolder = getContext(FOLDER_PICKER)
  let terminal, commandMenu, menuOpen = false, menuError = '', snapshot, nativeMenu = false, inputError = ''
  let needsToken = false, token = '', tokenError = '', signingIn = false, tokenInput, tokenForm
  $: tokenId = `codex-access-token-${encodeURIComponent(title)}`
  async function requireToken() {
    needsToken = true
    menuOpen = false
    nativeMenu = false
    inputError = ''
    await tick()
    if (active) tokenInput?.focus()
  }
  async function signIn(event) {
    event.preventDefault()
    if (signingIn || !token.trim()) return
    signingIn = true
    tokenError = ''
    try {
      await request('/auth', 'POST', { token: token.trim() })
      token = ''
      needsToken = false
    } catch (error) {
      tokenError = error.status === 401 ? 'Access token is incorrect. Please try again.' : error.message
      await tick()
      if (active) { tokenInput?.focus(); tokenInput?.select() }
    } finally {
      signingIn = false
    }
  }
  function openCommands() {
    if (!active || needsToken || !canPaste() || menuOpen) return
    snapshot = terminal?.captureCommandInput()
    menuError = ''
    menuOpen = true
  }
  async function cancelCommands() {
    menuOpen = false
    snapshot = null
    await tick()
    terminal?.focusInput()
  }
  async function selectCommand(entry) {
    if (!menuOpen) return
    menuError = entry.action === 'clear-input'
      ? (nativeMenu ? 'Close the Codex dialog before clearing input.' : !snapshot ? 'Reopen Commands once Codex is connected.' : terminal?.clearPrompt(snapshot) ?? 'Wait for Codex to connect.')
      : terminal?.runCommand(entry.command, snapshot) ?? 'Wait for Codex to connect.'
    if (menuError) return
    nativeMenu = !!entry.menu
    await cancelCommands()
  }
  export function control(action) {
    if (!active) return false
    if (needsToken) return false
    if (menuOpen) { commandMenu?.control(action); return true }
    if (nativeMenu && terminal?.isComposerReady()) nativeMenu = false
    if (nativeMenu) {
      const direction = { 'right-stick-down': 'down', 'right-stick-up': 'up' }[action] || action
      if (['up', 'down', 'left', 'right', 'back'].includes(direction)) {
        terminal?.pressKey(direction)
        if (direction === 'back') nativeMenu = false
        return true
      }
    }
    if (action === 'left') { inputError = terminal?.clearPrompt() ?? 'Wait for Codex to connect.'; return true }
    if (action === 'right-stick-down') { openCommands(); return true }
    return false
  }
  export function handleKeydown(event) {
    if (needsToken) return false
    if (menuOpen) return commandMenu?.handleKeydown(event) ?? true
    if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault()
      if (!event.repeat) openCommands()
      return true
    }
    return false
  }

  export function pasteClipboard() { return terminal?.pasteClipboard() }
  export function captureEmptyInput() { return terminal?.captureEmptyInput() }
  export function pasteIfEmpty(text, snapshot) { return terminal?.pasteIfEmpty(text, snapshot) }
  export function focusInput() { if (needsToken) tokenInput?.focus(); else terminal?.focusInput() }
  export function pressEnter() { if (needsToken) tokenForm?.requestSubmit(); else terminal?.pressEnter() }
</script>

{#if needsToken}
  <div class="token-screen">
    <form class="token-form" bind:this={tokenForm} onsubmit={signIn} aria-busy={signingIn}>
      <label for={tokenId}>Enter your Codex access token</label>
      <input id={tokenId} bind:this={tokenInput} bind:value={token} type="password" autocomplete="off" spellcheck="false" placeholder="Access token" required aria-invalid={!!tokenError} aria-describedby={tokenError ? `${tokenId}-error` : undefined} />
      {#if tokenError}<p id={`${tokenId}-error`} class="token-error" role="alert">{tokenError}</p>{/if}
      <button type="submit" disabled={signingIn || !token.trim()}>{signingIn ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </div>
{:else}
<div class="codex-terminal" inert={menuOpen}>
<Terminal bind:this={terminal} {active} canPaste={() => canPaste() && !menuOpen} canCommand={canPaste} {oncancel} onauthrequired={requireToken} openSession={signal => openAppSession(title, () => signal.aborted ? null : chooseFolder({ signal, title: `Choose a folder for ${title}` }))} />

</div>
{#if menuOpen}
  <CommandMenu bind:this={commandMenu} error={menuError} onselect={selectCommand} oncancel={cancelCommands} />
{:else}
  <button class="commands-button" onclick={openCommands}>Commands <kbd>Right stick ↓</kbd></button>
  {#if inputError}<p class="input-error" role="status">{inputError}</p>{/if}
  {#if nativeMenu}<p class="native-hint">↑ ↓ Choose · × / A Select · ○ Back</p>{/if}
{/if}
{/if}

<style>
  .token-screen { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; overflow: auto; background: #0c1418; }
  .token-form { display: grid; gap: 16px; width: min(100%, 380px); }
  .token-form label { font-size: 18px; color: #e0ece7; }
  .token-form input { width: 100%; box-sizing: border-box; padding: 14px; border: 1px solid #b8d6c94d; border-radius: 12px; background: #17312b; color: #e0ece7; font: inherit; }
  .token-form input:focus-visible { outline: 2px solid #b5f4cd; outline-offset: 2px; }
  .token-form button { padding: 12px; border: 1px solid #bde6cd45; border-radius: 12px; background: #17312b; color: #e0ece7; }
  .token-form button:disabled { opacity: 0.5; }
  .token-error { margin: 0; color: #ffccc3; font-size: 14px; }
  .codex-terminal { position: absolute; inset: 0; }
  .commands-button { position: absolute; bottom: 10px; right: 18px; z-index: 2; display: flex; align-items: center; gap: 10px; padding: 7px 10px; border: 1px solid #bde6cd45; border-radius: 14px; background: #17312bf0; font-size: 11px; }
  .input-error { position: absolute; bottom: 46px; left: 18px; right: 18px; padding: 10px; border-radius: 12px; background: #17312bf0; color: #ffccc3; font-size: 12px; }
  .native-hint { position: absolute; bottom: 46px; right: 18px; padding: 8px 12px; border-radius: 12px; background: #17312bf0; color: #c6efd4; font-size: 11px; pointer-events: none; }
</style>
