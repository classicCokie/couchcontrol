<script>
  import { onMount, setContext, tick } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { startGamepadControls } from './lib/gamepad.js'
  import { availableApps, addableApps, initialSwitcher, navigate, removeApp } from './lib/switcher.js'
  import AppIcon from './lib/AppIcon.svelte'
  import CodexApp from './apps/codex/CodexApp.svelte'
  import SettingsApp from './apps/settings/SettingsApp.svelte'
  import CloseAppDialog from './features/apps/CloseAppDialog.svelte'
  import { openAppSession } from './apps/codex/session.js'
  import VoiceOverlay from './features/voice/VoiceOverlay.svelte'
  import FolderPicker from './features/folders/FolderPicker.svelte'
  import { FOLDER_PICKER } from './features/folders/context.js'
  let voiceOverlay, settingsApp, codexApp
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
      if (app.type === 'codex') await openAppSession.close(app.title)
      state = removeApp(state, app.id)
      closeRequest = null
      await focusSelection()
      centerSelected()
    } catch (error) {
      closeError = error.message || 'Could not close this app. Try again.'
    } finally {
      closeBusy = false
    }
  }
  let folderRequest = null, folderPicker, voiceTarget
  setContext(FOLDER_PICKER, (options = {}) => new Promise(resolve => {
    finishFolder(null)
    if (options.signal?.aborted) { resolve(null); return }
    const abort = () => { if (folderRequest?.resolve === resolve) finishFolder(null) }
    options.signal?.addEventListener('abort', abort, { once: true })
    folderRequest = { ...options, resolve, cleanup: () => options.signal?.removeEventListener('abort', abort) }
  }))
  function finishFolder(path) {
    const request = folderRequest
    folderRequest = null
    request?.cleanup()
    request?.resolve(path)
  }
  async function voiceCopied(text) {
    const target = voiceTarget
    voiceTarget = null
    await tick()
    if (target && codexOpen && target.app === codexApp && !voiceOpen && !folderRequest && !closing) {
      codexApp.pasteIfEmpty(text, target.input)
    }
  }

  let state = initialSwitcher()
  let cardsViewport
  let appSurface
  let appContent
  let backButton
  let pickerStage
  let pickerBackButton
  let lastWheel = -Infinity
  let touchStartY = null
  let closing = false
  let surfaceAnimation
  let motionId = 0
  let controllerConnected = false
  let reducedMotion = false
  $: appCatalog = state.apps.some(app => app.type === 'settings') ? addableApps : availableApps
  $: appOpen = state.view === 'app'
  $: pickerOpen = state.view === 'picker'
  $: activeApp = state.apps[state.selected - 1]
  $: activeDefinition = availableApps.find(app => app.id === activeApp?.type)
  $: codexOpen = appOpen && activeDefinition?.id === 'codex'
  $: settingsOpen = appOpen && activeDefinition?.id === 'settings'

  const selectedCard = () => cardsViewport?.querySelectorAll('.card')[state.selected]
  const frame = (bounds, radius) => ({ left: bounds.left + 'px', top: bounds.top + 'px', width: bounds.width + 'px', height: bounds.height + 'px', borderRadius: radius })

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
    if (settingsOpen) settingsApp?.focusNavigation()
    else if (state.view === 'app') backButton?.focus({ preventScroll: true })
    else if (state.view === 'picker') pickerStage?.querySelectorAll('.picker-card')[state.pickerSelected]?.focus({ preventScroll: true })
    else selectedCard()?.focus({ preventScroll: true })
  }

  async function animateSurface(from, to, returnState) {
    const id = ++motionId
    surfaceAnimation?.cancel()
    surfaceAnimation = appSurface.animate([from, to], {
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
    if (action === 'record-start' && !voiceOpen) {
      voiceTarget = codexOpen && !folderRequest ? { app: codexApp, input: codexApp?.captureEmptyInput() } : null
    }
    if (voiceOverlay?.handleAction(action)) return
    if (folderRequest) { folderPicker?.handleAction(action); return }
    if (closeRequest) { closeDialog?.handleAction(action); return }
    if (closing) return
    if (codexOpen && action === 'confirm') {
      codexApp?.pressEnter()
      return
    }
    if (action === 'paste') {
      if (codexOpen) codexApp?.pasteClipboard()
      else if (state.view === 'menu' && activeApp) { closeError = ''; closeRequest = activeApp }
      return
    }
    if (settingsOpen && settingsApp?.control(action)) return
    if (state.view === 'app' && (action === 'up' || action === 'down')) {
      appContent?.scrollBy({ top: action === 'up' ? -100 : 100, behavior: 'instant' })
      return
    }
    const next = navigate(state, action, appCatalog)
    if (next === state) return
    if (state.view === 'app' && next.view === 'menu') {
      const from = frame(appSurface.getBoundingClientRect(), getComputedStyle(appSurface).borderRadius)
      closing = true
      centerSelected('instant')
      const card = selectedCard()
      animateSurface(from, frame(card.getBoundingClientRect(), getComputedStyle(card).borderRadius), next)
      return
    }
    if (next.view === 'app') {
      const card = selectedCard()
      const origin = frame(card.getBoundingClientRect(), getComputedStyle(card).borderRadius)
      cardsViewport.scrollTo({ left: cardsViewport.scrollLeft, behavior: 'instant' })
      state = next
      await focusSelection()
      animateSurface(origin, frame({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }, '0px'))
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
    if (state.view === 'menu' && event.key === 'Delete') {
      event.preventDefault()
      if (!event.repeat) act('paste')
      return
    }
    if (settingsOpen) {
      if (event.key === 'Escape') { event.preventDefault(); act('back') }
      else settingsApp?.handleKeydown(event)
      return
    }
    if (appOpen && activeDefinition?.id === 'codex') {
      if (event.ctrlKey && event.shiftKey && event.key === 'Backspace') {
        event.preventDefault()
        act('back')
      }
      return
    }
    if (event.key === 'Tab') {
      if (appOpen) { event.preventDefault(); backButton?.focus() }
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
    if ((appOpen || (pickerOpen && document.activeElement === pickerBackButton)) && action === 'confirm') act('back')
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
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotion = () => { reducedMotion = motion.matches }
    updateMotion()
    motion.addEventListener('change', updateMotion)
    centerSelected('instant')
    const observer = new ResizeObserver(() => {
      centerSelected('instant')
      surfaceAnimation?.finish()
    })
    observer.observe(cardsViewport)
    const stopGamepad = startGamepadControls({ onAction: act, onConnection: connected => { controllerConnected = connected } })
    return () => {
      finishFolder(null)
      stopGamepad()
      observer.disconnect()
      motion.removeEventListener('change', updateMotion)
      ++motionId
      surfaceAnimation?.cancel()
    }
  })
</script>

<svelte:window onkeydown={handleKeydown} onresize={() => surfaceAnimation?.finish()} />

<main class:picker-open={pickerOpen} inert={voiceOpen || !!folderRequest || !!closeRequest}>
  <section class="shelf" class:app-open={appOpen} class:returning={closing} inert={appOpen || pickerOpen} aria-label="App switcher">
    <div bind:this={cardsViewport} class="cards" role="toolbar" aria-label="Your apps" onscrollend={() => { if (!appOpen) centerSelected() }}>
      <button class="card add-card" class:chosen={state.selected === 0} tabindex={state.selected === 0 ? 0 : -1}
        aria-label="Add an app" aria-expanded={pickerOpen} aria-controls={pickerOpen ? 'app-picker' : undefined}
        onclick={() => clickTile(0)}>
        <span class="plus" aria-hidden="true">+</span>
      </button>
      {#each state.apps as app, index (app.id)}
        {@const definition = availableApps.find(entry => entry.id === app.type)}
        <button class="card app-card" style:--app-glow={definition.glow} style:--app-base={definition.base} style:--app-ink={definition.ink} class:chosen={state.selected === index + 1} tabindex={state.selected === index + 1 ? 0 : -1} aria-label={'Switch to ' + app.title} onclick={() => clickTile(index + 1)}>
          <span class="app-mark" aria-hidden="true"><AppIcon type={definition.id} /></span>
          <span class="card-caption"><strong>{app.title}</strong><small>Your workspace</small></span>
        </button>
      {/each}
    </div>
  </section>

  {#if pickerOpen}
    <div bind:this={pickerStage} id="app-picker" class="picker-stage" role="dialog" aria-modal="true" aria-label="Choose an app to add" tabindex="-1"
      transition:fly={{ y: 80, duration: reducedMotion ? 0 : 600, easing: cubicOut }}>
      <button bind:this={pickerBackButton} class="back-button picker-back" onclick={() => act('back')}><span aria-hidden="true">←</span> Your apps <kbd>esc</kbd></button>
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
  {/if}

  {#if appOpen}
    <div bind:this={appSurface} class="app-surface" style:--app-glow={activeDefinition.glow} style:--app-base={activeDefinition.base} style:--app-ink={activeDefinition.ink} class:closing role="dialog" aria-modal="true" aria-label={codexOpen ? 'Codex terminal' : undefined} aria-labelledby={codexOpen ? undefined : 'app-title'} tabindex="-1">
      {#if !codexOpen}<span class="surface-mark" aria-hidden="true"><AppIcon type={activeDefinition.id} /></span>{/if}
      <div bind:this={appContent} class="app-content">
        {#if activeDefinition.id === 'codex'}
          <CodexApp bind:this={codexApp} title={activeApp.title} canPaste={() => codexOpen && !voiceOpen && !folderRequest && !closing} oncancel={() => act('back')} />
        {:else}
        <button bind:this={backButton} class="back-button" onclick={() => act('back')}><span aria-hidden="true">←</span> Your apps <kbd>esc</kbd></button>
        {#if settingsOpen}
          <SettingsApp bind:this={settingsApp} />
        {:else}
        <div class="agent-workspace">
          <p class="eyebrow">Your workspace</p>
          <h1 id="app-title">{activeApp.title}</h1>
          <p class="welcome">{activeDefinition.tagline}</p>
          <div class="workspace-note"><span aria-hidden="true"><AppIcon type={activeDefinition.id} /></span><p>Your {activeDefinition.title} workspace is ready.<small>{activeDefinition.connection}</small></p></div>
        </div>
        {/if}
        {/if}
      </div>
    </div>
  {/if}

  {#if !codexOpen}
  <div class="input-hint" aria-live="polite">
    {#if controllerConnected}
      <span class="controller-indicator" aria-hidden="true"></span>
      <span>{pickerOpen ? '↑ ↓ Choose' : appOpen ? activeApp.title : '← → Browse'}</span>
      {#if !appOpen}<span>Bottom button · {pickerOpen ? 'Add' : 'Open'}</span>{/if}
      {#if appOpen || pickerOpen}<span>Right button · Back</span>{/if}
      {#if state.view === 'menu' && activeApp}<span>□ · Close app</span>{/if}
    {:else}
      <span>{pickerOpen ? '↑ ↓ Choose' : appOpen ? activeApp.title : '← → Browse'}</span>
      {#if !appOpen}<span><kbd>enter</kbd> {pickerOpen ? 'Add' : 'Open'}</span>{/if}
      {#if state.view === 'menu' && activeApp}<span><kbd>delete</kbd> Close app</span>{/if}
      {#if pickerOpen || (appOpen && activeDefinition.id !== 'codex')}<span><kbd>esc</kbd> Back</span>{/if}
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
<VoiceOverlay bind:this={voiceOverlay} bind:opened={voiceOpen} oncopied={voiceCopied} />
