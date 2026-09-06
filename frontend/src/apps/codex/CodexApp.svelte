<script>
  import { getContext } from 'svelte'
  import { FOLDER_PICKER } from '../../features/folders/context.js'
  import Terminal from './Terminal.svelte'
  import { openAppSession } from './session.js'

  export let title = 'Codex'
  export let canPaste = () => true
  export let oncancel = () => {}
  const chooseFolder = getContext(FOLDER_PICKER)
  let terminal
  export function pasteClipboard() { return terminal?.pasteClipboard() }
  export function captureEmptyInput() { return terminal?.captureEmptyInput() }
  export function pasteIfEmpty(text, snapshot) { return terminal?.pasteIfEmpty(text, snapshot) }
  export function pressEnter() { terminal?.pressEnter() }
</script>

<Terminal bind:this={terminal} {canPaste} {oncancel} openSession={signal => openAppSession(title, () => signal.aborted ? null : chooseFolder({ signal }))} />
