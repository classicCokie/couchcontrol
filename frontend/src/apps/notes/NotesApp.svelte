<script>
  import { onMount, tick } from 'svelte'
  import { marked } from 'marked'
  import DOMPurify from 'dompurify'
  import { platformRequest } from '../../lib/platform-api.js'
  import { renderedLines, renderedLineText } from './lines.js'
  export let active = true
  export let canPaste = () => true
  let notes = [], current = blank(), busy = false, loading = true, error = '', pending = ''
  let sidebar, canvas, content
  let marking = false
  $: if (!active) marking = false
  let sidebarOpen = false, choice = 0, lines = [], cursor = -1, markedLines = []
  let reducedMotion = false, measuredWidth = 0, pendingSelection = []
  function blank() { return { id: crypto.randomUUID(), markdown: '', revision: '', title: 'Untitled note' } }
  $: preview = DOMPurify.sanitize(marked.parse(current.markdown), { FORBID_TAGS: ['img', 'style', 'input', 'form'], FORBID_ATTR: ['style'] })
  $: if (preview !== undefined) tick().then(measure)
  $: cursorLine = lines[cursor]
  $: selections = markedLines.map(index => lines[index]).filter(Boolean)
  function measure() {
    const width = content?.getBoundingClientRect().width || 0
    if (measuredWidth && width && Math.abs(width - measuredWidth) > 1) markedLines = []
    if (width) measuredWidth = width
    lines = renderedLines(content)
    cursor = Math.min(cursor, lines.length - 1)
    markedLines = markedLines.filter(index => index < lines.length)
  }
  async function refresh() {
    loading = true
    try {
      const result = await platformRequest('/notes')
      notes = result.notes
      const saved = notes.find(note => note.id === current.id)
      if (saved) { current = saved; cursor = -1; markedLines = [] }
      error = ''
    } catch (e) { error = e.message }
    finally { loading = false }
  }
  function closeSidebar() { sidebarOpen = false; focusNavigation() }
  function select(note) {
    if (busy || loading || pending) return
    marking = false
    current = note; error = ''; cursor = -1; markedLines = []
    if (canvas) canvas.scrollTop = 0
    closeSidebar()
  }
  function chooseNote() { select(choice === 0 ? blank() : notes[choice - 1]) }
  async function navigateNotes(direction) {
    if (busy || loading || pending) return
    if (!sidebarOpen) {
      choice = Math.max(0, notes.findIndex(note => note.id === current.id) + 1)
      if (choice === 0 && notes.length) choice = 1
      marking = false
      sidebarOpen = true
    } else choice = Math.max(0, Math.min(notes.length, choice + direction))
    await tick()
    const button = sidebar?.querySelectorAll('[data-choice]')[choice]
    button?.focus({ preventScroll: true })
    button?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'instant' : 'smooth' })
  }
  export function focusNavigation() { canvas?.focus({ preventScroll: true }) }
  export function captureEmptyInput() { marking = false; return !busy && !loading && !pending ? { id: current.id, revision: current.revision, selectedLines: markedLines.map(index => ({ line: index + 1, text: renderedLineText(content, lines[index]) })) } : null }
  export function pasteIfEmpty(text, snapshot) {
    if (!snapshot || snapshot.id !== current.id || snapshot.revision !== current.revision || busy || pending || !text.trim()) return false
    pending = text
    pendingSelection = snapshot.selectedLines || []
    compose()
    return true
  }
  export async function pasteClipboard() {
    const snapshot = captureEmptyInput()
    if (!snapshot || !canPaste()) return
    try {
      const text = await navigator.clipboard.readText()
      if (canPaste()) pasteIfEmpty(text, snapshot)
    } catch { error = 'Clipboard access was blocked. Use R2 to dictate your instruction.' }
  }
  async function retry() { await refresh(); if (pending && !error) compose() }
  async function compose() {
    if (busy || !pending) return
    closeSidebar()
    busy = true; error = ''
    try {
      const note = await platformRequest('/notes/' + current.id + '/edit', { method: 'POST', body: { text: pending, revision: current.revision, selectedLines: pendingSelection } })
      current = note
      notes = [note, ...notes.filter(item => item.id !== note.id)]
      pending = ''; cursor = -1; markedLines = []
    } catch (e) { error = e.message }
    finally { busy = false }
  }
  function moveCursor(direction) {
    if (!lines.length) return
    if (cursor < 0) {
      // Start at the first visible line, including after wheel/touch scrolling.
      const top = canvas.getBoundingClientRect().top - content.getBoundingClientRect().top
      cursor = Math.max(0, lines.findIndex(line => line.bottom >= top))
    } else cursor = Math.max(0, Math.min(lines.length - 1, cursor + direction))
    if (marking && !markedLines.includes(cursor)) markedLines = [...markedLines, cursor].sort((a, b) => a - b)
    const line = lines[cursor]
    const top = content.getBoundingClientRect().top - canvas.getBoundingClientRect().top + canvas.scrollTop + line.top
    const height = line.bottom - line.top
    const margin = Math.min(100, canvas.clientHeight / 4)
    if (top < canvas.scrollTop + margin) canvas.scrollTo({ top: Math.max(0, top - margin), behavior: reducedMotion ? 'instant' : 'smooth' })
    else if (top + height > canvas.scrollTop + canvas.clientHeight - margin) canvas.scrollTo({ top: top + height - canvas.clientHeight + margin, behavior: reducedMotion ? 'instant' : 'smooth' })
  }
  export function control(action) {
    if (action === 'mark-end' || action === 'mark-cancel') { marking = false; return true }
    if (action === 'mark-start') {
      if (!sidebarOpen && !busy && !loading && !pending && lines.length) {
        if (cursor < 0) moveCursor(1)
        markedLines = markedLines.includes(cursor) ? markedLines.filter(index => index !== cursor) : [...markedLines, cursor].sort((a, b) => a - b)
        marking = true
      }
      return true
    }
    if (action === 'new-note') { select(blank()); return true }
    if (action === 'back' && sidebarOpen) { closeSidebar(); return true }
    if (action === 'right-stick-up' || action === 'right-stick-down') {
      if (!sidebarOpen) moveCursor(action === 'right-stick-up' ? -1 : 1)
      return true
    }
    if (action === 'up' || action === 'down') { navigateNotes(action === 'up' ? -1 : 1); return true }
    if (action === 'confirm') {
      if (busy || loading) return true
      if (sidebarOpen) chooseNote()
      else if (error) retry()
      return true
    }
    return false
  }
  onMount(() => {
    refresh()
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotion = () => { reducedMotion = motion.matches }
    updateMotion(); motion.addEventListener('change', updateMotion)
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    document.fonts.ready.then(measure)
    return () => { observer.disconnect(); motion.removeEventListener('change', updateMotion) }
  })
</script>

<div class="notes-app">
  <aside bind:this={sidebar} class:open={sidebarOpen} inert={!sidebarOpen} aria-hidden={!sidebarOpen} aria-label="Notes">
    <div class="sidebar-heading"><span>Notes</span><span class="count">{notes.length}</span></div>
    <button data-choice class="new-note" class:highlighted={choice === 0} disabled={busy || loading || !!pending} onclick={() => select(blank())}>＋ New note <small>Start</small></button>
    <div class="history">
      {#each notes as note, index (note.id)}
        <button data-choice class="note-link" class:selected={note.id === current.id} class:highlighted={choice === index + 1} aria-current={note.id === current.id ? 'page' : undefined} disabled={busy || loading || !!pending} onclick={() => select(note)}>
          <span>{note.title}</span><small>{new Date(note.updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small>
        </button>
      {/each}
      {#if !notes.length}<p class="muted">{loading ? 'Loading notes…' : 'Your notes will appear here.'}</p>{/if}
    </div>
    <div class="controls">Left stick · Browse<br />× Open &nbsp; ○ Dismiss</div>
  </aside>
  <section bind:this={canvas} class="canvas" aria-label="Note preview" aria-busy={busy} tabindex="-1">
    <article class="markdown" class:composing={busy}>
      <div class="note-body"><div class="note-content" bind:this={content}>{@html preview}</div>
      {#each selections as selection}
        <div class="line-mark" style:top={selection.top + 'px'} style:left={selection.left + 'px'} style:width={selection.right - selection.left + 'px'} style:height={selection.bottom - selection.top + 'px'} aria-hidden="true"></div>
      {/each}
      {#if cursorLine && !sidebarOpen}
        <div class="line-cursor" class:marked={markedLines.includes(cursor)} style:top={cursorLine.top + 'px'} style:left={cursorLine.left - 24 + 'px'} style:height={cursorLine.bottom - cursorLine.top + 'px'} aria-hidden="true"><span>›</span></div>
      {/if}
      </div>
    </article>
  </section>
  {#if busy}
    <div class="agent-status" role="status"><span class="agent-light"></span>Shaping your thoughts…</div>
  {:else if error}
    <div class="error-panel" role="alert"><p>{error}</p><button disabled={loading} onclick={retry}>× Reload &amp; retry</button>{#if pending}<button onclick={() => { pending = ''; error = '' }}>Discard instruction</button>{/if}</div>
  {:else if !sidebarOpen}
    <div class="canvas-hint" aria-live="polite">{markedLines.length ? markedLines.length + ' lines marked · R2 to instruct · L2 to toggle' : cursor >= 0 ? 'Right stick · Move cursor   Hold L2 · Mark lines' : 'Left stick · Notes   Start · New note   R2 · Dictate'}</div>
  {/if}
</div>

<style>
  .notes-app { position: absolute; inset: 0; display: flex; background: #f6f3ec; color: #302e29; }
  aside { position: absolute; inset: 0 auto 0 0; z-index: 5; transform: translateX(-105%); visibility: hidden; transition: transform 320ms cubic-bezier(.22, 1, .36, 1), visibility 320ms; box-shadow: 18px 0 60px #302e2914; display: flex; flex-direction: column; width: clamp(180px, 24%, 280px); flex-shrink: 0; padding: 28px 18px 24px; background: #eae6dd; border-right: 1px solid #dcd6ca; gap: 12px; min-height: 0; }
  aside.open { transform: translateX(0); visibility: visible; }
  button { color: inherit; font: inherit; text-align: left; border: 0; border-radius: 9px; background: transparent; padding: 12px; cursor: pointer; }
  button:hover { background: #ded8cc; }
  button:focus-visible { outline: 2px solid #8b6750; outline-offset: -2px; }
  button:disabled { opacity: .45; cursor: default; }
  .sidebar-heading { display: flex; justify-content: space-between; align-items: center; padding: 0 10px; font-size: 24px; font-family: Georgia, serif; }
  .count { font: 12px system-ui; color: #80796c; }
  .new-note { border: 1px solid #cec6b7; margin: 7px 0; font-size: 14px; }
  .history { flex: 1; min-height: 0; overflow: auto; }
  .note-link { display: flex; flex-direction: column; width: 100%; gap: 8px; margin-bottom: 5px; }
  .note-link span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%; font-size: 14px; font-weight: 500; }
  .note-link small { font-size: 11px; color: #877e6f; }
  .selected { background: #faf8f2; box-shadow: 0 2px 7px #3c302008; }
  .muted, .controls { font-size: 12px; color: #827969; padding: 0 10px; line-height: 1.8; }
  .controls { font-size: 11px; }
  .canvas { outline: none; flex: 1; min-width: 0; overflow: auto; }
  .markdown { max-width: 820px; margin: 0 auto; padding: clamp(36px, 7vw, 100px) clamp(24px, 6vw, 88px) 120px; font: 18px/1.85 Georgia, serif; overflow-wrap: anywhere; }
  .markdown :global(h1) { font-size: clamp(32px, 4cqw, 48px) !important; line-height: 1.2; font-weight: 400; letter-spacing: -.035em; margin: 0 0 36px; color: #302e29; }
  .markdown :global(h2) { font-size: 28px; font-weight: 400; line-height: 1.35; margin: 42px 0 16px; }
  .markdown :global(h3) { font-size: 21px; margin-top: 30px; }
  .markdown :global(p) { margin: 0 0 20px; }
  .markdown :global(ul), .markdown :global(ol) { padding-left: 26px; }
  .markdown :global(li) { padding-left: 5px; margin: 7px 0; }
  .markdown :global(blockquote) { margin: 26px 0; padding: 3px 24px; border-left: 3px solid #b6a185; color: #7b6e5d; font-style: italic; }
  .markdown :global(a) { color: #806042; text-decoration: underline; }
  .markdown :global(pre) { overflow: auto; padding: 20px; background: #eae6dd; border-radius: 8px; font-size: 14px; }
  .markdown :global(code) { font-size: .85em; }
  .markdown :global(table) { display: block; overflow: auto; border-collapse: collapse; font: 14px/1.6 system-ui; margin: 24px 0; }
  .markdown :global(th), .markdown :global(td) { border-bottom: 1px solid #d8d0c2; padding: 12px; text-align: left; }
  .markdown :global(hr) { border: 0; border-top: 1px solid #d8d0c2; margin: 36px 0; }
  .highlighted { outline: 2px solid #8b6750; outline-offset: -2px; background: #faf8f2; }
  .new-note small { float: right; color: #827969; font-size: 11px; }
  .note-body { position: relative; }
  .note-content { display: flow-root; }
  .line-mark { position: absolute; pointer-events: none; border-radius: 3px; background: #bd96592b; box-shadow: 0 0 0 4px #bd96592b; }
  .line-cursor { position: absolute; display: flex; align-items: center; color: #a17b4c; pointer-events: none; width: 16px; transition: top 120ms ease; font: 26px/1 system-ui; }
  .line-cursor.marked { color: #705027; }
  .canvas-hint, .agent-status { position: absolute; bottom: 22px; left: 50%; transform: translateX(-50%); font: 11px/1.5 system-ui; letter-spacing: .02em; color: #8c8374; white-space: nowrap; padding: 8px 16px; border-radius: 24px; background: #f6f3ecee; pointer-events: none; }
  .agent-status { display: flex; align-items: center; gap: 10px; color: #796952; font-size: 13px; }
  .agent-light { width: 7px; height: 7px; border-radius: 50%; background: #aa8c61; animation: breathe 2.8s ease-in-out infinite; }
  .composing .note-content { animation: breathe 2.8s ease-in-out infinite; }
  @keyframes breathe { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
  .error-panel { position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); width: min(480px, 85%); padding: 16px 20px; background: #eee6d8; border: 1px solid #d4c3ab; border-radius: 14px; font: 13px/1.6 system-ui; box-shadow: 0 8px 40px #302e2914; }
  .error-panel p { margin: 0 0 8px; }
  @media (prefers-reduced-motion: reduce) { aside, .line-cursor { transition: none; } .composing .note-content, .agent-light { animation: none; } }
  @media (max-width: 600px) { aside { width: 155px; padding: 20px 8px; } .markdown { font-size: 16px; padding: 35px 20px; } }
</style>
