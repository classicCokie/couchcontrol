<script>
  import { onMount, setContext, tick } from 'svelte'
  import { fly } from 'svelte/transition'
  import { createLayoutMotion, rectTransform } from './lib/layout-motion.js'
  import { cubicOut } from 'svelte/easing'
  import { startGamepadControls } from './lib/gamepad.js'
  import { availableApps, addableApps, initialSwitcher, navigate, members, allApps, restoreSwitcher, saveSwitcher } from './lib/switcher.js'
  import AppIcon from './lib/AppIcon.svelte'
  import AppPane from './features/apps/AppPane.svelte'
  import CloseAppDialog from './features/apps/CloseAppDialog.svelte'
  import { closeAppRequest } from './lib/close-app.js'
  import { sessionFor } from './apps/codex/session.js'
  import VoiceOverlay from './features/voice/VoiceOverlay.svelte'
  import FolderPicker from './features/folders/FolderPicker.svelte'
  import { FOLDER_PICKER } from './features/folders/context.js'
  import { createFolderQueue } from './features/folders/queue.js'
  let voiceOverlay
  let panes = {}
  let paneElements = {}
  const layoutMotion = createLayoutMotion()
  let emptyButton
  let storageReady = false
  let shelfStorage
  let voiceOpen = false
  let closeRequest = null, closeDialog, closeBusy = false, closeError = ''
  function cancelClose() {
    if (closeBusy) return
    closeRequest = null
    closeError = ''
    focusSelection()
  }
  async function confirmClose() {
    if (!closeRequest || closeBusy || voiceOpen) return
    const app = closeRequest
    closeBusy = true
    closeError = ''
    try {
      const next = await closeAppRequest(state, app, (title, provider) => sessionFor(provider).close(title))
      const survivor = app.groupId !== undefined ? visibleApps.find(member => member.id !== app.id) : null
      const play = survivor ? layoutMotion.capture(paneElements[survivor.id], reducedMotion) : null
      state = next
      closeRequest = null
      await tick()
      play?.()
      await focusSelection()
      centerSelected()
    } catch (error) {
      closeError = error.message || 'Could not close this app. Try again.'
    } finally {
      closeBusy = false
    }
  }
  let folderRequest = null, folderPicker, voiceTarget
  const folderQueue = createFolderQueue(request => { folderRequest = request })
  setContext(FOLDER_PICKER, folderQueue.choose)
  function finishFolder(path) {
    if (path) folderQueue.finish(path)
    else folderQueue.cancelAll()
    if (!folderRequest) focusSelection()
  }
  async function voiceCopied(text) {
    const target = voiceTarget
    voiceTarget = null
    await tick()
    if (target && (terminalOpen || browserOpen || notesOpen) && target.app === activePane && !voiceOpen && !folderRequest && !closeRequest && !closing) {
      activePane.pasteIfEmpty(text, target.input)
    }
  }

  let state = initialSwitcher()
  let cardsViewport
  let appSurface
  let pickerStage
  let pickerBackButton
  let lastWheel = -Infinity
  let touchStartY = null
  let closing = false
  let surfaceAnimation
  let motionId = 0
  let controllerConnected = false
  let controllerStatus = ''
  const controllerHints = {
    insecure: 'Controller access needs HTTPS or localhost.',
    unavailable: 'This browser does not expose controller input.',
    blocked: 'Browser blocked controller access. Check site permissions.',
    unsupported: 'Controller detected without a supported button mapping.',
    waiting: 'Controller: press a button to connect.',
    unfocused: 'Click or tap this window to enable controller input.',
    release: 'Release controller buttons and center both sticks.',
  }
  let reducedMotion = false
  $: appCatalog = allApps(state).some(app => app.type === 'settings') ? addableApps : availableApps
  $: if (storageReady) saveSwitcher(state, shelfStorage)
  $: appOpen = state.view === 'app'
  $: pickerOpen = state.view === 'picker' || !!state.groupPicker
  $: activeEntry = state.apps[state.selected - 1]
  $: grouped = activeEntry?.type === 'group'
  $: visibleApps = members(activeEntry)
  $: activeApp = grouped ? activeEntry.apps[activeEntry.focused] : activeEntry
  $: activePane = panes[activeApp?.id]
  $: terminalApp = activePane
  $: settingsApp = activePane
  $: activeDefinition = availableApps.find(app => app.id === activeApp?.type)
  $: terminalOpen = appOpen && !pickerOpen && ['codex', 'claude'].includes(activeDefinition?.id)
  $: settingsOpen = appOpen && !pickerOpen && activeDefinition?.id === 'settings'
  $: notesOpen = appOpen && !pickerOpen && activeDefinition?.id === 'write'
  $: browserOpen = appOpen && !pickerOpen && activeDefinition?.id === 'browser'

  function updateApp(id, changes) {
    const update = app => app?.id === id ? { ...app, ...changes } : app
    state = { ...state, apps: state.apps.map(entry => entry.type === 'group' ? { ...entry, apps: entry.apps.map(update) } : update(entry)) }
  }

  const selectedCard = () => cardsViewport?.querySelectorAll('.card')[state.selected]

  function centerSelected(behavior = 'smooth') {
    const card = selectedCard()
    if (!card) return
    const bounds = card.getBoundingClientRect()
    const viewport = cardsViewport.getBoundingClientRect()
    cardsViewport.scrollTo({
      left: cardsViewport.scrollLeft + bounds.left + bounds.width / 2 - viewport.left - cardsViewport.clientWidth / 2,
      behavior: reducedMotion ? 'instant' : behavior,
    })
  }

  async function focusSelection() {
    await tick()
    if (pickerOpen) pickerStage?.querySelectorAll('.picker-card')[state.pickerSelected]?.focus({ preventScroll: true })
    else if (appOpen && activeApp) activePane?.focusNavigation()
    else if (appOpen) emptyButton?.focus({ preventScroll: true })
    else selectedCard()?.focus({ preventScroll: true })
  }

  async function animateSurface(from, to, returnState) {
    const id = ++motionId
    surfaceAnimation?.cancel()
    const viewport = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    surfaceAnimation = appSurface.animate([{ transform: rectTransform(from, viewport) }, { transform: rectTransform(to, viewport) }], {
      duration: reducedMotion ? 0 : returnState ? 180 : 240,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both',
    })
    try { await surfaceAnimation.finished } catch { return }
    if (id !== motionId) return
    if (returnState) {
      state = returnState
      closing = false
      await focusSelection()
      centerSelected()
    }
    surfaceAnimation?.cancel()
    surfaceAnimation = undefined
  }

  async function act(action) {
    // Trigger releases must reach Notes even while another overlay owns input.
    if (action === 'mark-end' || action === 'mark-cancel') { activePane?.control(action); return }
    if (action === 'record-start' && !voiceOpen) {
      voiceTarget = (terminalOpen || browserOpen || notesOpen) && !folderRequest ? { app: activePane, input: activePane?.captureEmptyInput() } : null
    }
    if (voiceOverlay?.handleAction(action)) return
    if (folderRequest) { folderPicker?.handleAction(action); return }
    if (closeRequest) { closeDialog?.handleAction(action); return }
    if (closing) return
    if (terminalOpen && terminalApp?.control(action)) return
    if (appOpen && grouped && activeApp && action === 'close-empty') {
      closeError = ''
      closeRequest = { ...activeApp, groupId: activeEntry.id }
      return
    }
    if (appOpen && (action === 'close-empty' || (!pickerOpen && (action === 'tile-left' || action === 'tile-right')))) {
      const next = navigate(state, action, appCatalog)
      if (next === state) return
      const layoutChanged = grouped !== (next.apps[next.selected - 1]?.type === 'group')
      if (layoutChanged) surfaceAnimation?.finish()
      const play = layoutChanged ? layoutMotion.capture(paneElements[visibleApps[0]?.id], reducedMotion) : null
      state = next
      await tick()
      play?.()
      await focusSelection()
      return
    }
    if (terminalOpen && action === 'confirm') {
      terminalApp?.pressEnter()
      return
    }
    if (action === 'paste') {
      if (terminalOpen || browserOpen || notesOpen) activePane?.pasteClipboard()
      else if (state.view === 'menu' && activeEntry) { closeError = ''; closeRequest = activeEntry }
      return
    }
    if (settingsOpen && settingsApp?.control(action)) return
    if ((browserOpen || notesOpen) && activePane?.control(action)) return
    if (appOpen && !pickerOpen && (action === 'up' || action === 'down')) {
      activePane?.scroll(action)
      return
    }
    const next = navigate(state, action, appCatalog)
    if (next === state) return
    if (state.view === 'app' && next.view === 'menu') {
      layoutMotion.cancel()
      const from = appSurface.getBoundingClientRect()
      closing = true
      centerSelected('instant')
      const card = selectedCard()
      animateSurface(from, card.getBoundingClientRect(), next)
      return
    }
    if (next.view === 'app' && state.view !== 'app') {
      const card = selectedCard()
      const origin = card.getBoundingClientRect()
      cardsViewport.scrollTo({ left: cardsViewport.scrollLeft, behavior: 'instant' })
      state = next
      await focusSelection()
      animateSurface(origin, { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight })
      return
    }
    state = next
    await focusSelection()
    centerSelected()
  }

  async function clickTile(index) {
    if (appOpen) return
    state = { ...state, selected: index, view: 'menu' }
    await tick()
    centerSelected()
    act('confirm')
  }

  function handleKeydown(event) {
    if (voiceOpen) return
    if (folderRequest) { folderPicker?.handleKeydown(event); return }
    if (closeRequest) { closeDialog?.handleKeydown(event); return }
    if (terminalOpen && terminalApp?.handleKeydown(event)) return
    if (appOpen && grouped && event.key === 'Delete' && (!activeApp || event.altKey)) {
      event.preventDefault()
      if (!event.repeat) act('close-empty')
      return
    }
    if (state.view === 'menu' && event.key === 'Delete') {
      event.preventDefault()
      if (!event.repeat) act('paste')
      return
    }
    if (appOpen && event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      if (!event.repeat) act(event.key === 'ArrowLeft' ? 'tile-left' : 'tile-right')
      return
    }
    if (browserOpen) {
      if (event.key === 'Escape') { event.preventDefault(); act('back') }
      return
    }
    if (settingsOpen) {
      if (event.key === 'Escape') { event.preventDefault(); act('back') }
      else settingsApp?.handleKeydown(event)
      return
    }
    if (terminalOpen) {
      if (event.ctrlKey && event.shiftKey && event.key === 'Backspace') {
        event.preventDefault()
        act('back')
      }
      return
    }
    if (event.key === 'Tab') {
      if (appOpen && !pickerOpen && !activeApp) { event.preventDefault(); emptyButton?.focus() }
      if (pickerOpen) {
        event.preventDefault()
        if (document.activeElement === pickerBackButton) focusSelection()
        else pickerBackButton?.focus({ preventScroll: true })
      }
      return
    }
    const action = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'confirm', ' ': 'confirm', Escape: 'back' }[event.key]
    if (!action) return
    event.preventDefault()
    if (event.repeat && (action === 'confirm' || action === 'back')) return
    if (appOpen && !pickerOpen && action === 'confirm' && event.target?.tagName === 'BUTTON') {
      event.target.click()
    }
    else if (pickerOpen && document.activeElement === pickerBackButton && action === 'confirm') act('back')
    else act(action)
  }

  function handleWheel(event) {
    if (!pickerOpen || Math.abs(event.deltaY) < 8) return
    if (event.timeStamp - lastWheel < 280) return
    lastWheel = event.timeStamp
    act(event.deltaY > 0 ? 'down' : 'up')
  }

  function handleTouchEnd(event) {
    if (touchStartY === null) return
    const distance = touchStartY - event.changedTouches[0].clientY
    touchStartY = null
    if (Math.abs(distance) > 35) act(distance > 0 ? 'down' : 'up')
  }

  onMount(() => {
    try { shelfStorage = window.localStorage; state = restoreSwitcher(shelfStorage) } catch { state = initialSwitcher() }
    storageReady = true
    focusSelection()
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotion = () => { reducedMotion = motion.matches; if (reducedMotion) { layoutMotion.cancel(); surfaceAnimation?.finish() } }
    updateMotion()
    motion.addEventListener('change', updateMotion)
    centerSelected('instant')
    const observer = new ResizeObserver(() => {
      centerSelected('instant')
      surfaceAnimation?.finish()
    })
    observer.observe(cardsViewport)
    const stopGamepad = startGamepadControls({ onAction: act, onConnection: connected => { controllerConnected = connected }, onStatus: status => { controllerStatus = status } })
    return () => {
      finishFolder(null)
      stopGamepad()
      observer.disconnect()
      motion.removeEventListener('change', updateMotion)
      layoutMotion.cancel()
      ++motionId
      surfaceAnimation?.cancel()
    }
  })
</script>

<svelte:window onkeydown={handleKeydown} onresize={() => { layoutMotion.cancel(); surfaceAnimation?.finish() }} />

<main class:picker-open={pickerOpen && !appOpen} inert={voiceOpen || !!folderRequest || !!closeRequest}>
  <section class="shelf" class:app-open={appOpen} class:returning={closing} inert={appOpen || pickerOpen} aria-label="App switcher">
    <div bind:this={cardsViewport} class="cards" role="toolbar" aria-label="Your apps" onscrollend={() => { if (!appOpen) centerSelected() }}>
      <button class="card add-card" class:chosen={state.selected === 0} tabindex={state.selected === 0 ? 0 : -1}
        aria-label="Add an app" aria-expanded={pickerOpen} aria-controls={pickerOpen ? 'app-picker' : undefined}
        onclick={() => clickTile(0)}>
        <span class="plus" aria-hidden="true">+</span>
      </button>
      {#each state.apps as app, index (app.id)}
        {@const definition = availableApps.find(entry => entry.id === members(app)[0].type)}
        <button class="card app-card" class:group-card={app.type === 'group'} style:--app-glow={definition.glow} style:--app-base={definition.base} style:--app-ink={definition.ink} class:chosen={state.selected === index + 1} tabindex={state.selected === index + 1 ? 0 : -1} aria-label={'Switch to ' + app.title} onclick={() => clickTile(index + 1)}>
          {#if app.type === 'group'}
            <span class="group-halves">
              {#each app.apps as member}
                {@const theme = availableApps.find(def => def.id === member?.type)}
                <span class="group-half" style:--app-glow={theme?.glow || '#293b43'} style:--app-base={theme?.base || '#17232c'} style:--app-ink={theme?.ink || '#cde3da'}>
                  <span class="group-icon" aria-hidden="true">{#if member}<AppIcon type={member.type} />{:else}+{/if}</span>
                  <strong>{member?.title || 'Add an app'}</strong>
                </span>
              {/each}
            </span>
            <span class="group-label">App group</span>
          {:else}
            <span class="app-mark" aria-hidden="true"><AppIcon type={definition.id} /></span>
            <span class="card-caption"><strong>{app.title}</strong><small>Your workspace</small></span>
          {/if}
        </button>
      {/each}
    </div>
  </section>

  {#snippet picker()}
    <div bind:this={pickerStage} id="app-picker" class="picker-stage" class:group-picker={appOpen} role="dialog" aria-modal="true" aria-label="Choose an app to add" tabindex="-1"
      transition:fly={{ y: 80, duration: reducedMotion ? 0 : 600, easing: cubicOut }}>
      <button bind:this={pickerBackButton} class="back-button picker-back" onclick={() => act('back')}><span aria-hidden="true">←</span> {appOpen ? 'App group' : 'Your apps'} <kbd>esc</kbd></button>
      <div class="vertical-viewport" role="toolbar" tabindex="-1" aria-label="Available apps" aria-orientation="vertical" onwheel={handleWheel}
        ontouchstart={event => { touchStartY = event.touches[0].clientY }} ontouchend={handleTouchEnd} ontouchcancel={() => { touchStartY = null }}>
        <div class="vertical-track" style:--selected={state.pickerSelected}>
          {#each appCatalog as app, index (app.id)}
            <button class="card app-card picker-card" style:--app-glow={app.glow} style:--app-base={app.base} style:--app-ink={app.ink} class:chosen={state.pickerSelected === index} tabindex={state.pickerSelected === index ? 0 : -1}
              aria-label={'Add a new ' + app.title} onclick={() => { state = { ...state, pickerSelected: index }; act('confirm') }}>
              <span class="app-mark" aria-hidden="true"><AppIcon type={app.id} /></span>
              <span class="card-caption"><strong>{app.title}</strong><small>Start a new workspace</small></span>
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/snippet}

  {#if pickerOpen && !appOpen}{@render picker()}{/if}

  {#if appOpen}
    <div bind:this={appSurface} class="app-surface" class:closing role="dialog" aria-modal="true" aria-label={grouped ? 'App group: ' + activeEntry.title : activeEntry.title} tabindex="-1">
      <div class="app-content" class:split-layout={grouped}>
        {#each visibleApps as app (app.id)}
          {@const definition = availableApps.find(def => def.id === app.type)}
          {@const side = grouped ? activeEntry.apps.indexOf(app) : 0}
          <section class="app-pane" bind:this={paneElements[app.id]} class:focused={activeApp?.id === app.id && !pickerOpen} style:grid-column={side + 1} style:--app-glow={definition.glow} style:--app-base={definition.base} style:--app-ink={definition.ink} aria-label={app.title}>
            {#if grouped}<button class="pane-heading" aria-pressed={activeApp?.id === app.id && !pickerOpen} disabled={pickerOpen} onclick={() => act(side === 0 ? 'tile-left' : 'tile-right')}><kbd>{side === 0 ? 'L1' : 'R1'}</kbd><span>{app.title}</span><small>{activeApp?.id === app.id && !pickerOpen ? 'Focused' : 'Switch focus'}</small></button>{/if}
            <div class="pane-body">
              <AppPane bind:this={panes[app.id]} {app} {definition} tiled={grouped} active={activeApp?.id === app.id && !pickerOpen} canPaste={() => appOpen && activeApp?.id === app.id && !pickerOpen && !voiceOpen && !folderRequest && !closeRequest && !closing} onupdate={changes => updateApp(app.id, changes)} onback={() => act('back')} />
            </div>
          </section>
        {/each}
        {#if grouped && activeEntry.apps.includes(null)}
          {@const side = activeEntry.apps.indexOf(null)}
          <section class="empty-pane" in:fly={{ x: side === 0 ? -28 : 28, delay: reducedMotion ? 0 : 90, duration: reducedMotion ? 0 : 330, easing: cubicOut }} class:focused={!activeApp} style:grid-column={side + 1} aria-label="Empty side">
            {#if state.groupPicker}
              {@render picker()}
            {:else}
              <button class="pane-heading" aria-pressed={!activeApp} onclick={() => act(side === 0 ? 'tile-left' : 'tile-right')}><kbd>{side === 0 ? 'L1' : 'R1'}</kbd><span>App group</span></button>
              <button bind:this={emptyButton} class="empty-add" onclick={async () => { await act(side === 0 ? 'tile-left' : 'tile-right'); act('confirm') }}>
                <span class="empty-plus" aria-hidden="true">+</span><strong>Add an app</strong><span>Choose a workspace for this side</span><small>× / A / Enter · Choose</small>
              </button>
              <button class="empty-close" onclick={async () => { await act(side === 0 ? 'tile-left' : 'tile-right'); act('close-empty') }}><span aria-hidden="true">△</span> Close empty side <kbd>delete</kbd></button>
            {/if}
          </section>
        {/if}
      </div>
      {#if !grouped && !browserOpen && !notesOpen}<div class="tiling-controls"><button onclick={() => act('tile-left')}><kbd>L1</kbd> Tile left</button><button onclick={() => act('tile-right')}>Tile right <kbd>R1</kbd></button></div>{/if}
    </div>
  {/if}

  {#if (!terminalOpen || grouped) && !notesOpen}
  <div class="input-hint" aria-live="polite">
    {#if appOpen && grouped}<span><kbd>L1</kbd> Left · <kbd>R1</kbd> Right</span><span>Alt + ← / →</span>{/if}
    {#if appOpen && grouped}<span>△ / Y · {activeApp ? 'Close focused app' : 'Close empty side'}</span>{/if}
    {#if controllerHints[controllerStatus]}<span>{controllerHints[controllerStatus]}</span>{/if}
    {#if controllerConnected}
      <span class="controller-indicator" aria-hidden="true"></span>
      <span>{pickerOpen ? '↑ ↓ Choose' : appOpen ? (activeApp?.title || 'Add an app') : '← → Browse'}</span>
      {#if !appOpen || pickerOpen || !activeApp}<span>Bottom button · {pickerOpen ? 'Add' : 'Open'}</span>{/if}
      {#if appOpen || pickerOpen}<span>Right button · Back</span>{/if}
      {#if state.view === 'menu' && activeEntry}<span>□ · {grouped ? 'Close group' : 'Close app'}</span>{/if}
    {:else}
      <span>{pickerOpen ? '↑ ↓ Choose' : appOpen ? (activeApp?.title || 'Add an app') : '← → Browse'}</span>
      {#if !appOpen || pickerOpen || !activeApp}<span><kbd>enter</kbd> {pickerOpen ? 'Add' : 'Open'}</span>{/if}
      {#if state.view === 'menu' && activeEntry}<span><kbd>delete</kbd> {grouped ? 'Close group' : 'Close app'}</span>{/if}
      {#if pickerOpen || (appOpen && !['codex', 'claude'].includes(activeDefinition?.id))}<span><kbd>esc</kbd> Back</span>{/if}
    {/if}
  </div>
  {/if}
</main>

{#if folderRequest}
  {#key folderRequest}
  <div inert={voiceOpen}>
    <FolderPicker bind:this={folderPicker} initialPath={folderRequest.initialPath || ''} title={folderRequest.title || 'Choose a folder'} onselect={finishFolder} oncancel={() => finishFolder(null)} />
  </div>
  {/key}
{/if}
{#if closeRequest}
  <div inert={voiceOpen}>
    <CloseAppDialog bind:this={closeDialog} app={closeRequest} busy={closeBusy} error={closeError} {reducedMotion} onconfirm={confirmClose} oncancel={cancelClose} />
  </div>
{/if}
<VoiceOverlay bind:this={voiceOverlay} bind:opened={voiceOpen} directToNote={notesOpen && !!voiceTarget?.input} oncopied={voiceCopied} />
