<script>
  import { onMount, tick } from 'svelte'
  import { platformRequest } from '../../lib/platform-api.js'

  const sections = [{ id: 'api-keys', title: 'API keys', description: 'Connections to your AI services' }]
  let selected = 'api-keys', focused = 0
  let key = '', configured = false, busy = true, message = '', error = ''
  let panel, sidebar, content, alive = true

  async function run(action) {
    busy = true; error = ''; message = ''
    try { await action() } catch (cause) { if (alive) error = cause.message } finally { if (alive) busy = false }
  }
  async function save(value) {
    await run(async () => {
      const data = await platformRequest('/settings', { method: 'PUT', body: { whisperApiKey: value } })
      if (!alive) return
      configured = data.whisperConfigured
      key = ''
      message = configured ? 'API key saved. Hold R2 in any app to record.' : 'API key removed.'
    })
  }
  const fields = () => [...(content?.querySelectorAll('input, button:not(:disabled)') || [])]
  export function focusNavigation() {
    sidebar?.querySelectorAll('[role="tab"]')[focused]?.focus({ preventScroll: true })
  }
  async function selectSection(index) {
    focused = index
    selected = sections[index].id
    await tick()
    if (alive) fields()[0]?.focus({ preventScroll: true })
  }
  export function control(action) {
    const active = document.activeElement
    const inContent = content?.contains(active)
    const inSidebar = sidebar?.contains(active)
    if (action === 'back') {
      if (inContent) { focusNavigation(); return true }
      return false
    }
    if (action === 'left') { focusNavigation(); return true }
    if (action === 'right') { fields()[0]?.focus({ preventScroll: true }); return true }
    if (inSidebar || !panel?.contains(active)) {
      if (action === 'up' || action === 'down') {
        focused = Math.max(0, Math.min(sections.length - 1, focused + (action === 'up' ? -1 : 1)))
        focusNavigation()
      }
      if (action === 'confirm') selectSection(focused)
    } else {
      const items = fields()
      const index = items.indexOf(active)
      if (action === 'up' || action === 'down') {
        if (action === 'up' && index <= 0) focusNavigation()
        else items[Math.max(0, Math.min(items.length - 1, index + (action === 'up' ? -1 : 1)))]?.focus({ preventScroll: true })
      }
      if (action === 'confirm') {
        if (active?.tagName === 'BUTTON') active.click()
        else items[index + 1]?.focus({ preventScroll: true })
      }
    }
    return true
  }
  export function handleKeydown(event) {
    const active = event.target
    // Preserve text editing and native Enter/Space activation of form controls.
    if (active?.tagName === 'INPUT' && ['ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) return
    if (event.key === 'Enter' || event.key === ' ') {
      if (sidebar?.contains(active)) { event.preventDefault(); if (!event.repeat) control('confirm') }
      return
    }
    const action = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[event.key]
    if (action) { event.preventDefault(); control(action) }
  }
  onMount(() => {
    run(async () => {
      const data = await platformRequest('/settings')
      if (alive) configured = data.whisperConfigured
    })
    return () => { alive = false }
  })
</script>

<section bind:this={panel} class="settings-workspace">
  <header><p class="eyebrow">Make yourself at home</p><h1 id="app-title">Settings</h1></header>
  <div class="settings-layout">
    <aside>
      <p class="section-label">Preferences</p>
      <div bind:this={sidebar} class="settings-sections" role="tablist" aria-label="Settings categories" aria-orientation="vertical">
        {#each sections as section, index (section.id)}
          <button id={'settings-tab-' + section.id} class="section-tab" class:selected={selected === section.id} role="tab"
            aria-selected={selected === section.id} aria-controls={'settings-panel-' + section.id} tabindex={focused === index ? 0 : -1}
            onfocus={() => { focused = index }} onclick={() => selectSection(index)}>
            <span class="section-icon" aria-hidden="true">⌘</span><span><strong>{section.title}</strong><small>{section.description}</small></span><span class="chevron" aria-hidden="true">›</span>
          </button>
        {/each}
      </div>
      <p class="navigation-hint">↑ ↓ Choose a category<br />× / Enter Open · ← Categories</p>
    </aside>
    <div bind:this={content} class="settings-panel" id={'settings-panel-' + selected} role="tabpanel" aria-labelledby={'settings-tab-' + selected} tabindex="0">
      {#if selected === 'api-keys'}
        <h2>API keys</h2>
        <p class="section-intro">Manage the services connected to CouchControl.</p>
        <form onsubmit={event => { event.preventDefault(); if (!busy && key.trim()) save(key) }}>
          <div class="setting-heading"><h3>OpenAI · Whisper</h3><span class:enabled={configured}>{configured ? 'Enabled' : 'Not configured'}</span></div>
          <p>Hold R2 to record your voice in any app. Release it to transcribe with Whisper.</p>
          <label for="whisper-key">Whisper API key</label>
          <input id="whisper-key" type="password" bind:value={key} autocomplete="off" spellcheck="false" placeholder={configured ? 'Enter a new key to replace the saved key' : 'Paste your OpenAI API key'} maxlength="512" />
          <small>Your key is saved on this machine and is never sent back to the browser.</small>
          <div class="actions"><button class="save" disabled={busy || !key.trim()}>{busy && key ? 'Saving…' : 'Save key'}</button>{#if configured}<button type="button" disabled={busy} onclick={() => save('')}>Remove key</button>{/if}</div>
          {#if message}<p class="feedback" role="status">{message}</p>{/if}
          {#if error}<p class="error" role="alert">{error}</p>{/if}
        </form>
      {/if}
    </div>
  </div>
</section>

<style>
  .settings-workspace { position: absolute; inset: 120px clamp(24px, 6vw, 96px) 72px; display: flex; flex-direction: column; min-height: 0; }
  header { flex-shrink: 0; }
  h1 { font-size: clamp(40px, 5vw, 64px); margin: 10px 0 30px; }
  .settings-layout { display: grid; grid-template-columns: minmax(200px, 280px) minmax(0, 1fr); gap: clamp(24px, 4vw, 60px); min-height: 0; }
  aside { border-right: 1px solid #ffffff20; padding-right: 24px; }
  .section-label { text-transform: uppercase; letter-spacing: .16em; font-size: 10px; margin: 0 0 16px 12px; }
  .settings-sections { display: flex; flex-direction: column; gap: 8px; }
  .section-tab { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; border: 1px solid transparent; border-radius: 14px; padding: 16px 12px; background: transparent; }
  .section-tab.selected { border-color: #bcd6ff45; background: #c7dafa12; }
  .section-tab:focus-visible { outline: 3px solid #c6ddff; outline-offset: 3px; }
  .section-tab strong { display: block; font-size: 16px; font-weight: 500; }
  .section-tab small { font-size: 11px; line-height: 1.5; margin-top: 4px; }
  .section-icon { font-size: 24px; color: #c5dcff; }
  .chevron { margin-left: auto; font-size: 22px; color: #bbd0ed; }
  .navigation-hint { font-size: 11px; line-height: 1.9; margin: 24px 12px; }
  .settings-panel { min-height: 0; overflow-y: auto; padding: 4px 6px 8px; outline: none; }
  .settings-panel:focus-visible { outline: 2px solid #c6ddff; border-radius: 12px; }
  h2 { font-size: 28px; font-weight: 500; margin: 0; }
  .section-intro { margin: 8px 0 24px; }
  form { max-width: 760px; padding: clamp(20px, 3vw, 32px); border: 1px solid #ffffff20; border-radius: 20px; background: #0b101540; }
  .setting-heading { display: flex; align-items: center; gap: 16px; justify-content: space-between; }
  h3 { margin: 0; font-size: 20px; font-weight: 500; }
  .setting-heading span { font-size: 11px; color: #b9c3d2; padding: 6px 10px; border: 1px solid #ffffff25; border-radius: 20px; white-space: nowrap; }
  .setting-heading .enabled { color: #bceacb; }
  p, small { color: #bbc5d4; line-height: 1.6; }
  label { display: block; margin-top: 28px; margin-bottom: 10px; font-size: 14px; }
  input { width: 100%; font: inherit; color: #eef3ff; background: #0c1425; padding: 14px; border: 1px solid #ffffff30; border-radius: 10px; }
  input:focus { outline: 2px solid #bdd8ff; outline-offset: 3px; }
  small { display: block; font-size: 12px; margin-top: 10px; }
  .actions { display: flex; gap: 12px; margin-top: 24px; }
  button { padding: 12px 18px; border: 1px solid #ffffff30; border-radius: 10px; background: #ffffff08; }
  .save { background: #c7dafa; color: #13233b; border-color: transparent; }
  button:disabled { opacity: .45; cursor: default; }
  .feedback { color: #c2efd0; margin-bottom: 0; }
  .error { color: #ffcbc2; margin-bottom: 0; }
  @container (max-width: 760px) { .settings-workspace { inset-inline: 7%; } .settings-layout { grid-template-columns: 1fr; overflow-y: auto; gap: 24px; } aside { border: 0; padding-right: 0; } .settings-panel { overflow: visible; } .navigation-hint { display: none; } }
  @media (max-height: 650px) { .settings-workspace { inset-block: 90px 60px; } h1 { font-size: 36px; margin-bottom: 20px; } }
</style>
