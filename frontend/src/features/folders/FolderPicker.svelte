<script>
  import { onMount, tick } from 'svelte'
  import { fly, slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { platformRequest } from '../../lib/platform-api.js'

  export let initialPath = ''
  export let title = 'Choose a folder'
  export let onselect = () => {}
  export let oncancel = () => {}
  let listing = null, busy = true, error = '', dialog, listbox, selected = 0, browsing = false
  let alive = true, sequence = 0, request, reducedMotion = false

  async function focusSelection() {
    await tick()
    if (!alive) return
    ;(browsing ? listbox : dialog)?.focus({ preventScroll: true })
    listbox?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'instant' : 'smooth' })
  }
  async function load(path = '', focusChildren = false) {
    const id = ++sequence
    request?.abort()
    request = new AbortController()
    busy = true; error = ''
    try {
      const result = await platformRequest('/folders' + (path ? '?path=' + encodeURIComponent(path) : ''), { signal: request.signal })
      if (!alive || id !== sequence) return
      listing = { ...result, folders: result.folders.filter(folder => !folder.name.startsWith('.')) }
      selected = 0
      browsing = focusChildren && listing.folders.length > 0
    } catch (cause) {
      if (alive && id === sequence) error = cause.message
    } finally {
      if (alive && id === sequence) { busy = false; focusSelection() }
    }
  }
  export function handleAction(action) {
    if (busy) {
      if (action === 'back') oncancel()
      return true
    }
    if (action === 'back' || action === 'left') {
      error = ''
      if (browsing) { browsing = false; focusSelection() }
      else if (listing?.parent) load(listing.parent)
      else oncancel()
    } else if (action === 'paste' || action === 'right') {
      if (!listing) load(initialPath, true)
      else if (!browsing && listing.folders.length) { browsing = true; focusSelection() }
      else if (listing.folders[selected]) load(listing.folders[selected].path, true)
    } else if (action === 'confirm') {
      if (!listing) load(initialPath)
      else if (!browsing) onselect(listing.path)
      else if (listing.folders[selected]) load(listing.folders[selected].path)
    } else if (listing?.folders.length && (action === 'up' || action === 'down')) {
      if (!browsing && action === 'down') { browsing = true; selected = 0 }
      else if (browsing && action === 'up' && selected === 0) browsing = false
      else if (browsing) selected = Math.max(0, Math.min(listing.folders.length - 1, selected + (action === 'up' ? -1 : 1)))
      focusSelection()
    }
    return true
  }
  export function handleKeydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); oncancel(); return }
    const action = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'confirm', ' ': 'confirm' }[event.key]
    if (event.key === 'Tab') { event.preventDefault(); focusSelection(); return }
    if (action) {
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat || action === 'up' || action === 'down') handleAction(action)
    }
  }
  onMount(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotion = () => { reducedMotion = motion.matches }
    updateMotion()
    motion.addEventListener('change', updateMotion)
    dialog.focus({ preventScroll: true })
    load(initialPath)
    return () => { alive = false; request?.abort(); motion.removeEventListener('change', updateMotion) }
  })
</script>

<div class="folder-backdrop">
  <div bind:this={dialog} class="folder-picker" role="dialog" aria-modal="true" aria-label={title} aria-describedby="folder-instructions" aria-busy={busy} tabindex="-1">
    <p id="folder-instructions" class="sr-only">Subfolders are shown automatically. Enter or Cross selects the current path. Down moves into the subfolder list; Up returns to the current path from the first subfolder. Enter makes the highlighted folder the current path; press Enter again to choose it. Square or Right browses deeper. Left or Circle returns to the current path or goes to its parent. Escape cancels.</p>
    {#key listing?.path}
      <p class="path" class:current={!browsing} class:loading={busy} aria-live="polite" in:fly={{ y: 12, duration: reducedMotion ? 0 : 260, easing: cubicOut }}>{listing?.path || initialPath || 'Home'}</p>
    {/key}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if listing}
      {#key listing.path}
        <div class="children" transition:slide={{ duration: reducedMotion ? 0 : 320, easing: cubicOut }}>
          <div bind:this={listbox} class="folder-list" role="listbox" aria-label="Subfolders" aria-activedescendant={browsing && listing.folders[selected] ? 'folder-option-' + selected : undefined} tabindex="0">
            {#each listing.folders as folder, index (folder.path)}
              <div id={'folder-option-' + index} class="folder-row" class:chosen={browsing && index === selected} role="option" aria-selected={browsing && index === selected} tabindex="-1"
                onclick={() => { if (!busy) load(folder.path) }} onkeydown={handleKeydown}>{folder.name}</div>
            {:else}<p class="empty" role="status">No subfolders</p>{/each}
          </div>
        </div>
      {/key}
    {/if}
    <footer class="shortcuts" aria-label="Folder shortcuts">
      {#if !busy}
        {#if listing?.folders.length}
          <span class="shortcut"><kbd>↑ ↓</kbd><span class="alternative">/ Joystick</span><span>Browse</span></span>
        {/if}
        {#if !browsing || listing?.folders.length}
          <span class="shortcut"><kbd aria-label="Cross">×</kbd><span class="alternative">/</span><kbd>Enter</kbd><span>{!listing ? 'Retry' : browsing ? 'Set current path' : 'Choose folder'}</span></span>
          {#if !listing || listing.folders.length}<span class="shortcut"><kbd aria-label="Square">□</kbd><span class="alternative">/</span><kbd>→</kbd><span>{browsing ? 'Go deeper' : 'Browse subfolders'}</span></span>{/if}
        {/if}
      {/if}
      <span class="shortcut"><kbd aria-label="Circle">○</kbd>{#if !busy}<span class="alternative">/</span><kbd>←</kbd>{/if}<span>{busy ? 'Cancel' : browsing ? 'Current path' : listing?.parent ? 'Parent folder' : 'Cancel'}</span></span>
      <span class="shortcut"><kbd>Esc</kbd><span>Cancel</span></span>
    </footer>
  </div>
</div>

<style>
  .folder-backdrop { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: clamp(24px, 6vw, 80px); background: #0c181a; }
  .folder-picker { width: min(900px, 100%); outline: none; }
  .path { color: #e0ece7; font: 400 clamp(22px, 3.6vw, 42px)/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: -.04em; overflow-wrap: anywhere; margin: 0; transition: opacity 180ms ease; }
  .path:not(.current) { opacity: .65; }
  .path.loading { opacity: .5; }
  .children { margin-top: 24px; }
  .folder-list { max-height: 48dvh; overflow-y: auto; padding: 5px 0 5px 20px; border-left: 1px solid #b7d6c92b; outline: none; scrollbar-width: thin; scrollbar-color: #8ebaa344 transparent; }
  .folder-row { color: #829d93; font: 400 clamp(18px, 2.3vw, 26px)/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 9px 16px; overflow-wrap: anywhere; border-radius: 8px; cursor: pointer; transition: color 180ms ease, background 180ms ease, transform 220ms cubic-bezier(.22, 1, .36, 1); }
  .folder-row.chosen { color: #e5f8ec; background: #b3e1c40d; transform: translateX(5px); }
  .folder-row:hover { color: #e5f8ec; }
  .empty { color: #829d93; padding: 9px 16px; margin: 0; }
  .error { color: #ffc9bc; line-height: 1.5; margin: 18px 0 0; }
  .shortcuts { display: flex; flex-wrap: wrap; gap: 16px 28px; margin-top: 36px; color: #a3b9af; font-size: 12px; line-height: 1.5; }
  .shortcut { display: inline-flex; align-items: center; gap: 7px; }
  .shortcut kbd { display: inline-grid; place-items: center; min-width: 24px; height: 25px; padding: 0 6px; border: 1px solid #b7d6c933; border-radius: 5px; background: #b3e1c406; color: #d2e4da; font: inherit; }
  .shortcut kbd[aria-label] { font-size: 19px; padding: 0 3px; }
  .alternative { color: #829d93; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
  @media (prefers-reduced-motion: reduce) { .path, .folder-row { transition: none; } }
</style>
