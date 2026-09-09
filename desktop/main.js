import { app, BrowserWindow, ipcMain, dialog, webContents } from 'electron'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Browsers } from './browser.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const smoke = process.argv.includes('--smoke-test')
if (process.env.COUCHCONTROL_DESKTOP_DATA) app.setPath('userData', process.env.COUCHCONTROL_DESKTOP_DATA)
if (!app.requestSingleInstanceLock()) app.quit()
else {
  let win, browsers, backend, stopping = false, stopped = false
  const token = randomBytes(32).toString('hex')
  const port = Number(process.env.COUCHCONTROL_DESKTOP_PORT || 18787)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid desktop port.')
  const origin = `http://127.0.0.1:${port}`
  const send = event => { if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('desktop:event', event) }
  const focused = () => send({ type: 'focus', focused: win.isFocused(), native: webContents.getFocusedWebContents() !== win.webContents })
  app.on('second-instance', () => { win?.show(); win?.focus() })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', event => {
    if (stopped) return
    event.preventDefault()
    if (stopping) return
    stopping = true
    browsers?.closeAll()
    const done = () => { stopped = true; app.quit() }
    if (!backend || backend.exitCode !== null) { done(); return }
    const timer = setTimeout(() => backend.kill('SIGKILL'), 7000)
    backend.once('exit', () => { clearTimeout(timer); done() })
    backend.kill('SIGTERM')
  })
  await app.whenReady()
  try {
    const data = app.getPath('userData')
    const workspace = process.env.COUCHCONTROL_DESKTOP_WORKSPACE || join(data, 'workspace')
    mkdirSync(data, { recursive: true }); mkdirSync(workspace, { recursive: true })
    const resources = app.isPackaged ? process.resourcesPath : root
    const binary = join(resources, app.isPackaged ? 'bin' : 'desktop/bin', `couchcontrol-backend${process.platform === 'win32' ? '.exe' : ''}`)
    backend = spawn(binary, ['-listen', `127.0.0.1:${port}`, '-db', join(data, 'codex.sqlite'), '-cwd', workspace, '-static', join(resources, app.isPackaged ? 'frontend' : 'frontend/dist'), '-origins', origin], {
      env: { ...process.env, COUCHCONTROL_DESKTOP_TOKEN: token }, stdio: ['ignore', 'ignore', 'pipe'],
    })
    let startupError
    backend.on('error', error => { startupError = error })
    backend.stderr.on('data', chunk => process.stderr.write(chunk))
    backend.on('exit', code => {
      if (!stopping) { startupError = new Error(`Desktop backend exited (${code}). Check the desktop port and build.`); if (win) { dialog.showErrorBox('CouchControl backend stopped', startupError.message); app.quit() } }
    })
    let ready = false
    for (let attempt = 0; attempt < 100; attempt++) {
      if (startupError) throw startupError
      try {
        const response = await fetch(`${origin}/api/settings`, { headers: { 'X-CouchControl-Desktop': token }, signal: AbortSignal.timeout(500) })
        if (response.ok) { ready = true; break }
      } catch { /* Wait for the owned service, never attach to an existing one. */ }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!ready) throw new Error('Desktop backend did not start. Run npm run build and check COUCHCONTROL_DESKTOP_PORT is unused.')
    win = new BrowserWindow({ width: 1440, height: 960, minWidth: 640, minHeight: 480, backgroundColor: '#0b1015', autoHideMenuBar: true,
      webPreferences: { partition: 'persist:couchcontrol-shell', preload: join(root, 'desktop/preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false },
    })
    win.setMenu(null)
    const shell = win.webContents
    shell.session.webRequest.onBeforeSendHeaders((details, callback) => {
      const url = new URL(details.url)
      const own = ['http:', 'ws:'].includes(url.protocol) && url.host === new URL(origin).host
      const headers = { ...details.requestHeaders }
      // Drop any renderer-supplied copy. Only the trusted shell gets the real token.
      for (const key of Object.keys(headers)) if (key.toLowerCase() === 'x-couchcontrol-desktop') delete headers[key]
      if (own && details.webContentsId === shell.id) headers['X-CouchControl-Desktop'] = token
      callback({ requestHeaders: headers })
    })
    shell.session.webRequest.onHeadersReceived((details, callback) => {
      const headers = { ...details.responseHeaders }
      if (new URL(details.url).origin === origin) headers['Content-Security-Policy'] = ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws://127.0.0.1:" + port + "; object-src 'none'; frame-src 'none'; base-uri 'none'"]
      callback({ responseHeaders: headers })
    })
    shell.session.setPermissionCheckHandler((wc, permission) => wc === shell && ['media', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission))
    shell.session.setPermissionRequestHandler((wc, permission, callback, details) => callback(wc === shell && (permission === 'media' ? details.mediaTypes?.every(type => type === 'audio') === true : ['clipboard-read', 'clipboard-sanitized-write'].includes(permission))))
    shell.on('will-navigate', (event, url) => { if (url !== `${origin}/`) event.preventDefault() })
    shell.on('will-redirect', event => event.preventDefault())
    shell.setWindowOpenHandler(() => ({ action: 'deny' }))
    shell.on('will-attach-webview', event => event.preventDefault())
    shell.on('did-start-navigation', (_e, _url, _inPlace, main) => { if (main) browsers?.closeAll() })
    shell.on('render-process-gone', () => app.quit())
    browsers = new Browsers(win, { origin, token, send, focused })
    ipcMain.handle('desktop:browser', (event, op, args) => {
      if (event.sender !== shell || event.senderFrame !== shell.mainFrame || new URL(event.senderFrame.url).origin !== origin) throw new Error('Untrusted IPC sender.')
      if (typeof op !== 'string' || !args || typeof args !== 'object') throw new Error('Invalid browser request.')
      return browsers.dispatch(op, args)
    })
    ipcMain.on('desktop:gamepads', (event, pads) => {
      if (!win.isFocused() || event.sender !== webContents.getFocusedWebContents() || event.senderFrame !== event.sender.mainFrame || ![...browsers.views.values()].some(entry => entry.view.webContents === event.sender)) return
      if (!Array.isArray(pads) || pads.length > 16) return
      // Forward only a small finite controller schema from our isolated guest preload.
      const clean = pads.map(pad => pad && typeof pad.id === 'string' && Array.isArray(pad.axes) && Array.isArray(pad.buttons) ? {
        id: pad.id.slice(0, 200), index: Number.isInteger(pad.index) ? pad.index : 0, connected: !!pad.connected, mapping: pad.mapping === 'standard' ? 'standard' : '',
        axes: pad.axes.slice(0, 8).map(v => Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0),
        buttons: pad.buttons.slice(0, 32).map(b => ({ pressed: !!b?.pressed, value: Number.isFinite(b?.value) ? Math.max(0, Math.min(1, b.value)) : 0 })),
      } : null)
      send({ type: 'gamepads', pads: clean })
    })
    win.on('focus', focused); win.on('blur', focused); shell.on('focus', focused)
    await win.loadURL(origin)
    focused()
    if (smoke) {
      const { runSmoke } = await import('./smoke.js')
      await runSmoke({ win, browsers, origin, token })
      console.log('Electron smoke checks passed.')
      app.quit()
    }
  } catch (error) {
    console.error(error)
    if (!smoke) dialog.showErrorBox('Could not start CouchControl', error.message)
    process.exitCode = 1
    app.quit()
  }
}
