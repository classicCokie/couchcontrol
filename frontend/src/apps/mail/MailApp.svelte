<script>
  import { onMount, tick } from 'svelte'
  import DOMPurify from 'dompurify'
  import { platformRequest } from '../../lib/platform-api.js'
  export let draftKey = 'default'
  export let active = true
  export let canPaste = () => true
  export let onback = () => {}
  let root, account = null, settings = false, config = blankAccount(), busy = false, error = '', notice = ''
  let folders = [], folder = 'INBOX', messages = [], total = 0, offset = 0, validity = 0, current = null, destination = '', newFolder = ''
  let composing = false, draft = blankDraft(), draftLoaded = false
  function blankAccount() { return { email: '', name: '', imap: { host: '', port: 993, security: 'tls', username: '', password: '' }, smtp: { host: '', port: 587, security: 'starttls', username: '', password: '' }, sentFolder: '' } }
  function blankDraft() { return { to: '', cc: '', bcc: '', subject: '', body: '' } }
  const api = (path, method = 'GET', body) => platformRequest('/mail/' + path, { method, body })
  $: if (draftLoaded) { try { sessionStorage.setItem('couchcontrol.mail.draft.' + draftKey, JSON.stringify(draft)) } catch {} }
  // Only formatted text is allowed. No remote resources, links, forms, or active content.
  $: safeHTML = DOMPurify.sanitize(current?.html || '', { ALLOWED_TAGS: ['p','br','div','span','b','strong','i','em','u','blockquote','ul','ol','li','h1','h2','h3','h4','pre','code','table','thead','tbody','tr','td','th','hr'], ALLOWED_ATTR: [] })
  async function run(task) {
    if (busy) return
    busy = true; error = ''; notice = ''
    try { await task() } catch (e) { error = e.message } finally { busy = false }
  }
  async function loadFolders() { folders = (await api('folders')).folders.filter(f => f.selectable) }
  async function loadMessages() {
    current = null
    const result = await api(`messages?folder=${encodeURIComponent(folder)}&offset=${offset}`)
    messages = result.messages; total = result.total; validity = result.uidValidity
    if (offset > 0 && offset >= total) { offset = Math.max(0, Math.floor((total - 1) / 50) * 50); await loadMessages() }
  }
  function initialize() { return run(async () => { account = (await api('account')).account; settings = !account; if (account) { config = structuredClone(account); await loadFolders(); await loadMessages() } }) }
  onMount(() => {
    try { const saved = JSON.parse(sessionStorage.getItem('couchcontrol.mail.draft.' + draftKey)); if (saved && Object.keys(blankDraft()).every(k => typeof saved[k] === 'string')) draft = saved } catch {}
    draftLoaded = true
    initialize()
  })
  function messagePath(path, uid) { return `${path}?folder=${encodeURIComponent(folder)}&uid=${uid}&validity=${validity}` }
  function chooseFolder(name) { run(async () => { folder = name; offset = 0; current = null; await loadMessages() }) }
  function openMessage(message) { run(async () => { current = null; current = await api(messagePath('message', message.uid)); destination = ''; await api(messagePath('seen', message.uid), 'POST', {}); messages = messages.map(m => m.uid === message.uid ? { ...m, seen: true } : m) }) }
  function saveAccount(event) { event.preventDefault(); run(async () => { account = (await api('account', 'PUT', config)).account; config = structuredClone(account); settings = false; folder = 'INBOX'; offset = 0; current = null; await loadFolders(); await loadMessages(); notice = 'Account connected.' }) }
  function disconnect() { run(async () => { await api('account', 'DELETE'); account = null; config = blankAccount(); folders = []; messages = []; current = null; settings = true; composing = false; draft = blankDraft() }) }
  function refresh() { run(async () => { await loadFolders(); await loadMessages() }) }
  function page(delta) { run(async () => { offset = Math.max(0, offset + delta); current = null; await loadMessages() }) }
  function move() { if (!destination || !current) return; run(async () => { await api(messagePath('move', current.message.uid), 'POST', { destination }); current = null; await loadMessages(); notice = 'Message moved.' }) }
  function createFolder(event) { event.preventDefault(); run(async () => { await api('folders', 'POST', { name: newFolder }); newFolder = ''; await loadFolders(); notice = 'Folder created.' }) }
  async function compose(reply = false) {
    if (reply && Object.values(draft).some(Boolean)) notice = 'Your existing draft is open. Send or discard it before starting a reply.'
    if (reply && !Object.values(draft).some(Boolean) && current) draft = { ...blankDraft(), to: current.message.replyTo || current.message.from, subject: /^re:/i.test(current.message.subject) ? current.message.subject : 'Re: ' + current.message.subject }
    composing = true; await tick(); root?.querySelector('[name="to"]')?.focus()
  }
  function send(event) { event.preventDefault(); run(async () => { const result = await api('send', 'POST', draft); draft = blankDraft(); composing = false; notice = result.warning || 'Email sent.' }) }
  function date(value) { return value ? new Date(value).toLocaleString() : '' }
  export function focusNavigation() { root?.querySelector('button:not(:disabled), input')?.focus({ preventScroll: true }) }
  export function control(action) {
    if (active && action === 'confirm') { pressEnter(); return true }
    if (!active || !['up','down','left','right'].includes(action)) return false
    const selected = document.activeElement
    if (selected?.tagName === 'SELECT' && ['left', 'right'].includes(action)) { selected.selectedIndex = Math.max(0, Math.min(selected.options.length - 1, selected.selectedIndex + (action === 'left' ? -1 : 1))); selected.dispatchEvent(new Event('change', { bubbles: true })); return true }
    const elements = [...(root?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') || [])].filter(el => el.getClientRects().length)
    const index = elements.indexOf(document.activeElement), direction = ['up','left'].includes(action) ? -1 : 1
    elements[Math.max(0, Math.min(elements.length - 1, index + direction))]?.focus(); return true
  }
  export function pressEnter() { const el = document.activeElement; if (root?.contains(el) && el.tagName === 'BUTTON') { el.click(); return true } return false }
  export function captureEmptyInput() { const el = document.activeElement; return active && composing && !busy && root?.contains(el) && ['INPUT','TEXTAREA'].includes(el.tagName) && el.type !== 'password' && !el.value ? { name: el.name } : null }
  export function pasteIfEmpty(text, snapshot) { if (!active || !snapshot || !composing || busy || !Object.hasOwn(draft, snapshot.name) || draft[snapshot.name]) return false; draft = { ...draft, [snapshot.name]: text }; return true }
  export async function pasteClipboard() { const snapshot = captureEmptyInput(); if (!snapshot || !canPaste()) return; try { const text = await navigator.clipboard.readText(); if (canPaste()) pasteIfEmpty(text, snapshot) } catch { error = 'Clipboard access was blocked.' } }
</script>

<div class="mail-app" bind:this={root}>
  <header>
    <button onclick={onback}>← Your apps</button>
    <div class="heading"><strong>Mail</strong><span>{account?.email || 'Your conversations, together.'}</span></div>
    {#if account}<button disabled={busy} onclick={() => { config = structuredClone(account); settings = !settings }}>Account</button><button class="primary" disabled={busy} onclick={() => compose()}>Compose</button>{/if}
  </header>
  {#if error}<p class="feedback error" role="alert">{error} {#if !account && !settings}<button disabled={busy} onclick={initialize}>Retry</button>{/if}</p>{/if}
  {#if notice}<p class="feedback" role="status">{notice}</p>{/if}
  {#if busy}<p class="progress" role="status">Working…</p>{/if}
  {#if settings}
    <form class="account" onsubmit={saveAccount}>
      <h1>{account ? 'Account settings' : 'Connect your mail'}</h1>
      <p>Use your provider’s IMAP and SMTP settings. An app password may be required. Credentials are stored in the server’s local database and never returned to the browser.</p>
      <fieldset disabled={busy}>
        <div class="two"><label>Email address<input type="email" bind:value={config.email} required autocomplete="email" /></label><label>Display name<input bind:value={config.name} autocomplete="name" /></label></div>
        {#each ['imap', 'smtp'] as kind}
          <h2>{kind.toUpperCase()} · {kind === 'imap' ? 'Incoming mail' : 'Outgoing mail'}</h2>
          <div class="two"><label>Server<input bind:value={config[kind].host} placeholder={kind + '.example.com'} required /></label><label>Port<input type="number" min="1" max="65535" bind:value={config[kind].port} required /></label></div>
          <label>Connection security<select bind:value={config[kind].security}><option value="tls">TLS</option><option value="starttls">STARTTLS</option></select></label>
          <div class="two"><label>Username<input bind:value={config[kind].username} required autocomplete="username" /></label><label>Password / app password<input type="password" bind:value={config[kind].password} required={!account} placeholder={account ? 'Leave blank to keep saved password' : ''} autocomplete="new-password" /></label></div>
        {/each}
        <label>Save an extra Sent copy to (optional)<input bind:value={config.sentFolder} placeholder="e.g. Sent" list="sent-folders" /></label>
        <datalist id="sent-folders">{#each folders as f}<option value={f.name}></option>{/each}</datalist>
        <p class="hint">Leave this blank if your provider saves sent mail automatically. Otherwise enter the exact name of an existing IMAP folder.</p>
        <div class="actions"><button class="primary" type="submit">Test &amp; save connection</button>{#if account}<button type="button" onclick={() => settings = false}>Cancel</button><button type="button" onclick={disconnect}>Disconnect</button>{/if}</div>
      </fieldset>
    </form>
  {:else if account}
    <div class="workspace">
      <aside>
        <div class="section-title">Folders <button disabled={busy} onclick={refresh} aria-label="Refresh mail">↻</button></div>
        <nav aria-label="Mail folders">{#each folders as f}<button class:selected={folder === f.name} disabled={busy} onclick={() => chooseFolder(f.name)}>{f.name}</button>{/each}</nav>
        <form class="create-folder" onsubmit={createFolder}><label>New folder<input bind:value={newFolder} placeholder="Folder name" required disabled={busy} /></label><button disabled={busy || !newFolder.trim()}>Create folder</button></form>
      </aside>
      <section class="message-list" aria-label="Messages">
        <div class="section-title"><span>{folder}</span><small>{total} messages</small></div>
        {#if !messages.length}<p class="empty">{busy ? 'Loading mail…' : 'No messages in this folder.'}</p>{/if}
        {#each messages as m}<button class="message" class:selected={current?.message.uid === m.uid} class:unread={!m.seen} disabled={busy} onclick={() => openMessage(m)}><span class="sender">{m.from || 'Unknown sender'}</span><strong>{m.subject || '(No subject)'}</strong><time>{date(m.date)}</time></button>{/each}
        <div class="pagination"><button disabled={busy || offset === 0} onclick={() => page(-50)}>Newer</button><span>{total ? offset + 1 : 0}–{Math.min(offset + messages.length, total)}</span><button disabled={busy || offset + 50 >= total} onclick={() => page(50)}>Older</button></div>
      </section>
      <section class="reader" aria-label={composing ? 'Compose email' : 'Read email'}>
        {#if composing}
          <form class="composer" onsubmit={send}>
            <div class="section-title"><h1>New message</h1><button type="button" disabled={busy} onclick={() => composing = false}>Close draft</button></div>
            <fieldset disabled={busy}>
              <label>To<input name="to" bind:value={draft.to} placeholder="person@example.com, another@example.com" /></label>
              <div class="two"><label>Cc<input name="cc" bind:value={draft.cc} /></label><label>Bcc<input name="bcc" bind:value={draft.bcc} /></label></div>
              <label>Subject<input name="subject" bind:value={draft.subject} /></label>
              <label>Message<textarea name="body" bind:value={draft.body} required placeholder="Write your message…"></textarea></label>
              <div class="actions"><button type="submit" class="primary" disabled={!draft.body.trim() || !(draft.to.trim() || draft.cc.trim() || draft.bcc.trim())}>Send email</button><button type="button" onclick={() => { draft = blankDraft(); composing = false }}>Discard draft</button><span class="hint">Draft kept in this browser tab.</span></div>
            </fieldset>
          </form>
        {:else if current}
          <article>
            <h1>{current.message.subject || '(No subject)'}</h1>
            <dl><dt>From</dt><dd>{current.message.from}</dd><dt>To</dt><dd>{current.message.to}</dd><dt>Date</dt><dd>{date(current.message.date)}</dd></dl>
            <div class="actions"><button disabled={busy} onclick={() => compose(true)}>Reply</button><select aria-label="Move to folder" bind:value={destination} disabled={busy}><option value="">Move to folder…</option>{#each folders.filter(f => f.name !== folder) as f}<option value={f.name}>{f.name}</option>{/each}</select><button disabled={busy || !destination} onclick={move}>Move</button></div>
            {#if current.text}<div class="plain-body">{current.text}</div>{:else if safeHTML}<div class="html-body">{@html safeHTML}</div>{:else}<p>No readable text in this message.</p>{/if}
            {#if current.attachments.length}<div class="attachments"><strong>Attachments</strong>{#each current.attachments as name}<p>{name || 'Unnamed attachment'}</p>{/each}<small>Open your provider’s mail app to download attachments.</small></div>{/if}
          </article>
        {:else}<div class="empty reader-empty"><span aria-hidden="true">✉</span><h1>A little room for conversation.</h1><p>Select an email to read it, or compose a new message.</p></div>{/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .mail-app { min-height:100%; box-sizing:border-box; padding-bottom:60px; color:#e5edf8; background:linear-gradient(140deg,#17283c,#0e1725); font-size:15px; }
  header { display:flex; align-items:center; gap:12px; padding:24px; border-bottom:1px solid #ffffff18; flex-wrap:wrap; }
  .heading { flex:1; display:flex; flex-direction:column; gap:4px; min-width:120px; }.heading strong {font-size:25px}.heading span,.hint,small,time {color:#9bafc8;font-size:12px}
  button,input,select,textarea {font:inherit;color:inherit;border:1px solid #ffffff26;border-radius:9px;background:#ffffff08;padding:10px 13px;min-width:0}button{cursor:pointer}button:hover:not(:disabled){background:#ffffff16}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #8fc9ff;outline-offset:2px}.primary{background:#bbdaf7;color:#132338;font-weight:650}.primary:hover:not(:disabled){background:#d2e7fb}option{background:#18283d;color:#e5edf8}
  .feedback{margin:12px 24px;padding:12px;border-radius:8px;background:#214c46}.error{background:#572e39}.progress{margin:8px 24px;color:#b7cee8;font-size:13px}
  .account{max-width:760px;padding:32px;margin:auto}.account>p{line-height:1.6;color:#aebed2}h1{font-size:26px;font-weight:550;margin:0 0 18px}h2{font-size:17px;margin:24px 0 12px}fieldset{border:0;padding:0;margin:0;min-width:0}label{display:flex;flex-direction:column;gap:7px;margin-bottom:14px;font-size:13px;color:#b5c7dc}input,textarea{width:100%;box-sizing:border-box;color:#eef5ff}.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}.actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:16px 0}.hint{line-height:1.5}
  .workspace{display:grid;grid-template-columns:190px 310px minmax(0,1fr);min-height:calc(100vh - 130px)}aside{padding:20px 12px;border-right:1px solid #ffffff14}.section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 8px 16px;font-weight:600;overflow-wrap:anywhere}.section-title h1{margin:0}.section-title button{padding:6px 12px}nav{display:flex;flex-direction:column;gap:4px}nav button{text-align:left;overflow-wrap:anywhere;border-color:transparent}.selected{background:#83b6e322!important;border-color:#8fc9ff55!important}.create-folder{border-top:1px solid #ffffff18;margin-top:24px;padding:20px 4px}.create-folder button{width:100%;font-size:13px}.message-list{border-right:1px solid #ffffff14;padding:20px 10px}.message{width:100%;display:flex;flex-direction:column;align-items:flex-start;text-align:left;gap:8px;border-color:transparent;border-bottom:1px solid #ffffff0b;border-radius:6px;padding:16px 12px}.message strong,.sender{width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.message strong{font-weight:450}.unread strong{font-weight:700}.unread .sender::before{content:'• ';color:#99d0ff}.sender{font-size:13px;color:#b0c5dc}.pagination{display:flex;align-items:center;justify-content:space-between;margin-top:20px;font-size:12px}.pagination button{padding:8px}.reader{padding:30px;min-width:0}.empty{color:#9bafc8;line-height:1.6;padding:20px}.reader-empty{margin:12vh auto 0;max-width:340px;text-align:center}.reader-empty>span{font-size:50px;color:#bdd8f4}.reader-empty h1{color:#e5edf8;margin-top:20px}.composer textarea{min-height:320px;resize:vertical;line-height:1.6}dl{display:grid;grid-template-columns:auto 1fr;gap:8px 15px;font-size:13px;line-height:1.5}dt{color:#9bafc8}dd{margin:0;overflow-wrap:anywhere}article h1{overflow-wrap:anywhere}.plain-body{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;border-top:1px solid #ffffff18;padding-top:24px;margin-top:24px}.html-body{background:#f4f6fa;color:#17283c;border-radius:10px;padding:24px;margin-top:24px;overflow:auto;overflow-wrap:anywhere;line-height:1.6}.html-body :global(table){max-width:100%}.html-body :global(pre){white-space:pre-wrap}.attachments{border-top:1px solid #ffffff18;margin-top:30px;padding-top:20px;overflow-wrap:anywhere}
  @container (max-width:1050px){.workspace{grid-template-columns:150px 250px minmax(0,1fr)}.reader{padding:20px}.two{grid-template-columns:1fr;gap:0}}
  @container (max-width:760px){.workspace{display:flex;flex-direction:column}aside{border-right:0;border-bottom:1px solid #ffffff18}nav{flex-direction:row;overflow:auto}nav button{white-space:nowrap}.create-folder{display:flex;align-items:end;gap:10px;margin-top:10px;padding:10px 0}.create-folder label{flex:1;margin:0}.create-folder button{width:auto}.message-list{max-height:330px;overflow:auto;border-bottom:1px solid #ffffff18}.reader-empty{margin:20px auto}.account{padding:24px}header{padding:16px}.reader{padding:24px}}
</style>
