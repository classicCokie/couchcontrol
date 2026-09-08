<script>
  import { sessionTitle, folderTitle } from '../../lib/switcher.js'
  import AppIcon from '../../lib/AppIcon.svelte'
  import CodexApp from '../../apps/codex/CodexApp.svelte'
  import SettingsApp from '../../apps/settings/SettingsApp.svelte'
  import BrowserApp from '../../apps/browser/BrowserApp.svelte'
  import MailApp from '../../apps/mail/MailApp.svelte'
  import NotesApp from '../../apps/notes/NotesApp.svelte'
  export let app
  export let definition
  export let active = true
  export let tiled = false
  export let canPaste = () => true
  export let onback = () => {}
  export let onupdate = () => {}
  let codex, settings, browser, notes, mail, content, back
  export function focusNavigation() {
    if (codex) codex.focusInput()
    else if (settings) settings.focusNavigation()
    else if (browser) browser.focusNavigation()
    else if (notes) notes.focusNavigation()
    else if (mail) mail.focusNavigation()
    else back?.focus({ preventScroll: true })
  }
  export function control(action) { return codex?.control(action) || settings?.control(action) || browser?.control(action) || notes?.control(action) || mail?.control(action) }
  export function handleKeydown(event) { return codex?.handleKeydown(event) || settings?.handleKeydown(event) }
  export function pressEnter() { return codex?.pressEnter() || browser?.pressEnter() || mail?.pressEnter() }
  export function pasteClipboard() { return codex?.pasteClipboard() || browser?.pasteClipboard() || notes?.pasteClipboard() || mail?.pasteClipboard() }
  export function captureEmptyInput() { return mail ? mail.captureEmptyInput() : codex ? codex.captureEmptyInput() : notes ? notes.captureEmptyInput() : browser?.captureEmptyInput() }
  export function pasteIfEmpty(text, snapshot) { return mail ? mail.pasteIfEmpty(text, snapshot) : codex ? codex.pasteIfEmpty(text, snapshot) : notes ? notes.pasteIfEmpty(text, snapshot) : browser?.pasteIfEmpty(text, snapshot) }
  export function scroll(action) { content?.scrollBy({ top: action === 'up' ? -100 : 100, behavior: 'instant' }) }
</script>

<div class="pane-content" class:tiled bind:this={content} inert={!active}>
  {#if ['codex', 'claude'].includes(definition.id)}
    <CodexApp provider={definition.id} bind:this={codex} title={app.title} sessionKey={sessionTitle(app)} ontitle={path => onupdate({ defaultTitle: folderTitle(path) })} {active} {canPaste} oncancel={onback} />
  {:else if definition.id === 'browser'}
    <BrowserApp bind:this={browser} title={app.title} initialUrl={app.browserUrl || ''} onnavigate={browserUrl => onupdate({ browserUrl })} {active} {canPaste} {onback} />
  {:else if definition.id === 'mail'}
    <MailApp draftKey={String(app.id)} bind:this={mail} {active} {canPaste} {onback} />
  {:else if definition.id === 'write'}
    <NotesApp bind:this={notes} {active} {canPaste} />
  {:else}
    <span class="surface-mark" aria-hidden="true"><AppIcon type={definition.id} /></span>
    <button bind:this={back} class="back-button" onclick={onback}><span aria-hidden="true">←</span> Your apps <kbd>esc</kbd></button>
    {#if definition.id === 'settings'}
      <SettingsApp bind:this={settings} />
    {:else}
      <div class="agent-workspace">
        <p class="eyebrow">Your workspace</p>
        <h1>{app.title}</h1>
        <p class="welcome">{definition.tagline}</p>
        <div class="workspace-note"><span aria-hidden="true"><AppIcon type={definition.id} /></span><p>Your {definition.title} workspace is ready.<small>{definition.connection}</small></p></div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .pane-content { position: absolute; inset: 0; overflow: auto; container-type: inline-size; }
  .tiled :global(.agent-workspace) { left: 7%; width: 86%; }
  .tiled :global(h1) { font-size: clamp(30px, 9cqw, 72px); overflow-wrap: anywhere; }
  .tiled :global(.welcome) { font-size: clamp(16px, 4cqw, 24px); }
  .tiled :global(.back-button) { top: 22px; left: 7%; }
  .tiled :global(.workspace-note) { margin-top: 24px; }
</style>
