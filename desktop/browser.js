import { WebContentsView, session } from 'electron'
import { fileURLToPath } from 'node:url'
import { validURL, validID, bounds, validatePlan } from './policy.js'

const inspect = `(() => {
  globalThis.nodes = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]')].filter(e => {
    const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && r.bottom>0 && r.top<innerHeight && r.right>0 && r.left<innerWidth && getComputedStyle(e).visibility!=='hidden' && !e.disabled;
  }).slice(0,100);
  return nodes.map((e,i) => ({id:i+1,role:(e.getAttribute('role')||e.tagName.toLowerCase()).slice(0,80),label:(e.getAttribute('aria-label')||e.labels?.[0]?.innerText||e.getAttribute('placeholder')||e.innerText||e.getAttribute('title')||e.getAttribute('name')||e.getAttribute('type')||'').trim().slice(0,180)}));
})()`
const scrolls = { up: 'scrollBy(0,-100)', down: 'scrollBy(0,100)', top: 'scrollTo(0,0)', bottom: 'scrollTo(0,document.documentElement.scrollHeight)' }

export class Browsers {
  constructor(window, { origin, token, send, focused }) {
    this.window = window; this.origin = origin; this.token = token; this.send = send; this.focused = focused
    this.views = new Map(); this.blocked = false
    this.partition = session.fromPartition('persist:couchcontrol-websites')
    this.partition.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    this.partition.setPermissionCheckHandler(() => false)
    // Website traffic never receives the backend credential and cannot open the shell.
    this.partition.webRequest.onBeforeRequest((details, callback) => callback({ cancel: new URL(details.url).host === new URL(origin).host }))
    this.partition.on('will-download', (_event, item) => {
      // Electron's normal Save dialog chooses the destination; never auto-open files.
      item.once('done', (_event, state) => send({ type: 'download', message: `${item.getFilename()}: ${state}` }))
    })
  }
  page(entry) {
    const wc = entry.view.webContents
    return { url: wc.getURL(), title: wc.getTitle(), canBack: wc.navigationHistory.canGoBack(), canForward: wc.navigationHistory.canGoForward(), width: entry.width }
  }
  emit(entry, error = '') { this.send({ type: 'page', id: entry.id, page: this.page(entry), error }) }
  visible(entry) { entry.view.setVisible(!this.blocked && entry.visible && entry.rect?.width > 0 && entry.rect?.height > 0) }
  async open(id, url = '') {
    if (!validID(id) || (url && !validURL(url))) throw new Error('Invalid browser card or address.')
    if (this.views.has(id)) { const entry = this.views.get(id); this.emit(entry); return this.page(entry) }
    if (this.views.size >= 32) throw new Error('Close a browser card before opening another.')
    const view = new WebContentsView({ webPreferences: { session: this.partition, preload: fileURLToPath(new URL('./guest-preload.cjs', import.meta.url)), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false } })
    const entry = { id, view, visible: false, revision: 0, width: 'full', pending: null }
    this.views.set(id, entry); this.window.contentView.addChildView(view); view.setVisible(false)
    const wc = view.webContents
    wc.setWindowOpenHandler(({ url }) => {
      // One managed destination per card. No privileged or unmanaged popup windows.
      if (this.allowed(url)) { this.cancel(entry); void wc.loadURL(url).catch(error => this.emit(entry, error.message)) }
      return { action: 'deny' }
    })
    for (const event of ['will-navigate', 'will-redirect']) wc.on(event, (e, url) => { if (!this.allowed(url)) e.preventDefault() })
    wc.on('will-frame-navigate', e => { if (!this.allowed(e.url) && e.url !== 'about:blank') e.preventDefault() })
    wc.on('did-start-navigation', (_e, _url, _inPlace, main) => { if (main) entry.revision++ })
    for (const event of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-stop-loading']) wc.on(event, () => this.emit(entry))
    wc.on('did-fail-load', (_e, code, message, _url, main) => { if (main && code !== -3) this.emit(entry, message) })
    wc.on('render-process-gone', () => { this.cancel(entry); this.emit(entry, 'The page stopped. Reload it to reconnect.') })
    wc.on('focus', () => { this.focused(); this.send({ type: 'browser-focus', id }) })
    wc.on('before-input-event', (event, input) => {
      const action = input.key === 'Escape' ? 'back' : input.alt && input.key === 'ArrowLeft' ? 'tile-left' : input.alt && input.key === 'ArrowRight' ? 'tile-right' : null
      if (action && input.type === 'keyDown') { event.preventDefault(); this.send({ type: 'action', action }) }
    })
    if (url) void wc.loadURL(url).catch(error => this.emit(entry, error.message))
    else await wc.loadURL('about:blank')
    return this.page(entry)
  }
  allowed(url) { return validURL(url) && new URL(url).host !== new URL(this.origin).host }
  cancel(entry) { entry.pending?.abort(); entry.pending = null }
  async evaluate(entry, expression, contextId) {
    const wc = entry.view.webContents
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    const result = await wc.debugger.sendCommand('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error('The page changed. Please repeat the command.')
    return result.result.value
  }
  async world(entry) {
    const wc = entry.view.webContents
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    const { frameTree } = await wc.debugger.sendCommand('Page.getFrameTree')
    const { executionContextId } = await wc.debugger.sendCommand('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'couchcontrol-actions' })
    return executionContextId
  }
  async command(entry, text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw new Error('Use a command of up to 4,000 characters.')
    if (entry.pending) throw new Error('A browser command is already running.')
    const pending = new AbortController(); entry.pending = pending
    const revision = entry.revision
    try {
      const contextId = await this.world(entry)
      const elements = await this.evaluate(entry, inspect, contextId)
      const page = this.page(entry)
      const response = await fetch(`${this.origin}/api/browser/commands`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: this.origin, 'X-CouchControl-Desktop': this.token },
        body: JSON.stringify({ text, currentUrl: validURL(page.url) ? page.url : '', elements }), signal: AbortSignal.any([pending.signal, AbortSignal.timeout(25000)]),
      })
      const plan = await response.json()
      if (!response.ok) throw new Error(plan.error || 'Command interpretation failed.')
      validatePlan(plan, elements.length)
      for (const command of plan.commands) {
        if (pending.signal.aborted) throw new Error('Command canceled. Earlier actions may have completed.')
        if (entry.revision !== revision) throw new Error('The page navigated. Repeat the command on the current page; earlier actions may have completed.')
        await this.execute(entry, command, contextId)
      }
      this.emit(entry)
      return { ...plan, page: this.page(entry) }
    } finally { if (entry.pending === pending) entry.pending = null }
  }
  async execute(entry, { action, value }, contextId) {
    const wc = entry.view.webContents
    switch (action) {
      case 'navigate': if (!this.allowed(value)) throw new Error('This address cannot be opened in a website pane.'); await wc.loadURL(value); break
      case 'reload': wc.reload(); break
      case 'back': case 'forward': {
        const history = wc.navigationHistory
        if (!(action === 'back' ? history.canGoBack() : history.canGoForward())) throw new Error('No page in that history direction.')
        action === 'back' ? history.goBack() : history.goForward(); break
      }
      case 'viewport': entry.width = value; this.place(entry, entry.rect, entry.visible); break
      case 'scroll': await this.evaluate(entry, scrolls[value], contextId); break
      case 'click': {
        const point = await this.evaluate(entry, `(() => { const e=globalThis.nodes?.[${Number(value)-1}]; if(!e?.isConnected || e.disabled) return null; const r=e.getBoundingClientRect(), x=r.x+r.width/2,y=r.y+r.height/2; const hit=document.elementFromPoint(x,y); if(!hit || !(e===hit || e.contains(hit)) || r.width<=0 || r.height<=0) return null; return {x,y}; })()`, contextId)
        if (!point) throw new Error('The control changed or is covered. Repeat the command.')
        await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
        await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }); break
      }
      case 'type':
        if (!await this.evaluate(entry, `!!document.activeElement && (document.activeElement.matches('input:not([type=password]):not(:disabled):not([readonly]),textarea:not(:disabled):not([readonly])') || document.activeElement.isContentEditable)`, contextId)) throw new Error('Select a text field first. Voice password entry is disabled.')
        await wc.debugger.sendCommand('Input.insertText', { text: value }); break
      case 'press': {
        const code = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8 }[value]
        await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: value, windowsVirtualKeyCode: code, ...(value === 'Enter' ? { text: '\r' } : {}) })
        await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: value, windowsVirtualKeyCode: code }); break
      }
      case 'shelf': break
    }
  }
  place(entry, rect, visible) {
    entry.rect = rect; entry.visible = visible
    if (rect) {
      const fitted = bounds(rect, this.window.getContentSize())
      if (entry.width !== 'full' && fitted.width > +entry.width) { fitted.x += Math.floor((fitted.width - +entry.width) / 2); fitted.width = +entry.width }
      entry.view.setBounds(fitted)
    }
    this.visible(entry)
  }
  close(id) {
    const entry = this.views.get(id)
    if (!entry) return
    this.cancel(entry); this.views.delete(id)
    this.window.contentView.removeChildView(entry.view)
    entry.view.webContents.close({ waitForBeforeUnload: false })
  }
  closeAll() { for (const id of this.views.keys()) this.close(id) }
  async dispatch(op, args) {
    if (op === 'open') return this.open(args.id, args.url)
    if (op === 'visibility') {
      this.blocked = !!args.blocked
      for (const entry of this.views.values()) { this.visible(entry); if (this.blocked) this.cancel(entry) }
      if (this.blocked) this.window.webContents.focus()
      return
    }
    if (op === 'retain') {
      if (!Array.isArray(args.ids) || args.ids.length > 100 || !args.ids.every(validID)) throw new Error('Invalid browser cards.')
      for (const id of this.views.keys()) if (!args.ids.includes(id)) this.close(id)
      return
    }
    const entry = this.views.get(args.id)
    if (!entry) throw new Error('Browser closed. Reopen its card.')
    if (op === 'layout') { this.place(entry, bounds(args.rect, this.window.getContentSize()), !!args.visible); return }
    if (op === 'release') { this.cancel(entry); entry.visible = false; this.visible(entry); return }
    if (op === 'cancel') { this.cancel(entry); return }
    if (op === 'command') return this.command(entry, args.text)
    if (op === 'action') {
      validatePlan({ commands: [{ action: args.action, value: args.value ?? '' }], message: '' }, 0)
      if (!['navigate', 'back', 'forward', 'reload', 'scroll'].includes(args.action)) throw new Error('Unsupported direct action.')
      if (entry.pending && args.action === 'scroll') return
      this.cancel(entry)
      await this.execute(entry, { action: args.action, value: args.value ?? '' }, await this.world(entry))
      this.emit(entry); return this.page(entry)
    }
    throw new Error('Unknown browser operation.')
  }
}
