<script>
  import { getContext, tick } from 'svelte'
  import { FOLDER_PICKER } from '../../features/folders/context.js'
  import Terminal from './Terminal.svelte'
  import CommandMenu from './CommandMenu.svelte'
  import { terminalProfiles } from './profiles.js'
  export let provider = 'codex'
  $: profile = terminalProfiles[provider]

  export let title = 'Codex'
  export let active = true
  export let canPaste = () => true
  export let oncancel = () => {}
  const chooseFolder = getContext(FOLDER_PICKER)
  let terminal, commandMenu, menuOpen = false, menuError = '', snapshot, nativeMenu = false, inputError = ''
  function openCommands() {
    if (!active || !canPaste() || menuOpen) return
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
      ? (nativeMenu ? `Close the ${profile.label} dialog before clearing input.` : !snapshot ? `Reopen Commands once ${profile.label} is connected.` : terminal?.clearPrompt(snapshot) ?? `Wait for ${profile.label} to connect.`)
      : terminal?.runCommand(entry.command, snapshot) ?? `Wait for ${profile.label} to connect.`
    if (menuError) return
    nativeMenu = !!entry.menu
    await cancelCommands()
  }
  export function control(action) {
    if (!active) return false
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
    if (provider === 'claude' && !terminal?.isComposerReady() && ['up', 'down', 'right'].includes(action)) { terminal?.pressKey(action); return true }
    if (action === 'left') { inputError = terminal?.clearPrompt() ?? `Wait for ${profile.label} to connect.`; return true }
    if (action === 'right-stick-down') { openCommands(); return true }
    return false
  }
  export function handleKeydown(event) {
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
  export function focusInput() { terminal?.focusInput() }
  export function pressEnter() { terminal?.pressEnter() }
</script>

<div class="codex-terminal" inert={menuOpen}>
<Terminal bind:this={terminal} {profile} {active} canPaste={() => canPaste() && !menuOpen} canCommand={canPaste} {oncancel} openSession={signal => profile.openSession(title, () => signal.aborted ? null : chooseFolder({ signal, title: `Choose a folder for ${title}` }))} />

</div>
{#if menuOpen}
  <CommandMenu bind:this={commandMenu} commands={profile.commands} label={profile.label} error={menuError} onselect={selectCommand} oncancel={cancelCommands} />
{:else}
  <button class="commands-button" onclick={openCommands}>Commands <kbd>Right stick ↓</kbd></button>
  {#if inputError}<p class="input-error" role="status">{inputError}</p>{/if}
  {#if nativeMenu}<p class="native-hint">↑ ↓ Choose · × / A Select · ○ Back</p>{/if}
{/if}

<style>
  .codex-terminal { position: absolute; inset: 0; }
  .commands-button { position: absolute; bottom: 10px; right: 18px; z-index: 2; display: flex; align-items: center; gap: 10px; padding: 7px 10px; border: 1px solid #bde6cd45; border-radius: 14px; background: #17312bf0; font-size: 11px; }
  .input-error { position: absolute; bottom: 46px; left: 18px; right: 18px; padding: 10px; border-radius: 12px; background: #17312bf0; color: #ffccc3; font-size: 12px; }
  .native-hint { position: absolute; bottom: 46px; right: 18px; padding: 8px 12px; border-radius: 12px; background: #17312bf0; color: #c6efd4; font-size: 11px; pointer-events: none; }
</style>
