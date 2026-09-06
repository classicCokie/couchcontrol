<script>
  import { onMount } from 'svelte'
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import '@xterm/xterm/css/xterm.css'
  import { terminalURL } from './api.js'
  import { isEmptyComposer } from './composer.js'
  import { createClipboardPaste } from './paste.js'

  export let oncancel = () => {}
  export let openSession
  export let canPaste = () => true
  let host, pasteError = ''
  let paste = () => {}
  let enter = () => {}
  let captureEmpty = () => null, pasteEmpty = () => false
  export function captureEmptyInput() { return captureEmpty() }
  export function pasteIfEmpty(text, snapshot) { return pasteEmpty(text, snapshot) }
  export function pasteClipboard() { return paste() }
  export function pressEnter() { enter() }

  onMount(() => {
    const opening = new AbortController()
    const term = new Terminal({
      cursorBlink: true, fontSize: 18, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      scrollback: 10000, allowProposedApi: false,
      theme: { background: '#0c1418', foreground: '#e0ece7', cursor: '#b5f4cd', selectionBackground: '#396c5980' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()
    term.focus()
    // Keep the app-switcher shortcut out of the CLI's input stream.
    term.attachCustomKeyEventHandler(event => !(event.ctrlKey && event.shiftKey && event.key === 'Backspace'))
    let session, socket, disposed = false, ready = false, ended = false, retry, liveStartup = false
    let inputRevision = 0
    const inputTarget = () => !disposed && !document.hidden && ready && socket?.readyState === WebSocket.OPEN && canPaste() ? socket : null
    captureEmpty = () => inputTarget() && isEmptyComposer(term.buffer.active) ? { socket, revision: inputRevision } : null
    pasteEmpty = (text, snapshot) => {
      if (!snapshot || !text || inputTarget() !== snapshot.socket || inputRevision !== snapshot.revision || !isEmptyComposer(term.buffer.active)) return false
      term.paste(text)
      term.focus()
      return true
    }
    paste = createClipboardPaste({
      read: () => navigator.clipboard.readText(),
      target: inputTarget,
      paste: text => { term.paste(text); term.focus() },
      report: message => { pasteError = message },
    })
    const send = message => {
      if ((ready || liveStartup) && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    }
    enter = () => {
      if (!inputTarget()) return
      inputRevision++
      send({ type: 'input', data: '\r' })
      term.focus()
    }
    const resize = () => {
      if (disposed || !host.clientWidth || !host.clientHeight) return
      // Preserve the recorded dimensions until terminal history finishes replaying.
      if (socket && !ready) return
      fit.fit()
      if (ready) send({ type: 'resize', cols: Math.max(20, Math.min(500, term.cols)), rows: Math.max(5, Math.min(200, term.rows)) })
    }
    const input = term.onData(data => {
      inputRevision++
      // Bound each frame without splitting Unicode surrogate pairs during a paste.
      let chunk = ''
      for (const character of data) {
        chunk += character
        if (chunk.length >= 1024) { send({ type: 'input', data: chunk }); chunk = '' }
      }
      if (chunk) send({ type: 'input', data: chunk })
    })
    function connect() {
      if (disposed) return
      clearTimeout(retry)
      socket?.close()
      ready = false
      liveStartup = false
      ended = false
      term.reset()
      const current = new WebSocket(terminalURL(session.id))
      socket = current
      current.binaryType = 'arraybuffer'
      current.onmessage = event => {
        if (disposed || current !== socket) return
        if (event.data instanceof ArrayBuffer) { term.write(new Uint8Array(event.data)); return }
        const message = JSON.parse(event.data)
        if (message.type === 'size') {
          // Answer startup queries, while suppressing stale replies on reconnect.
          liveStartup = message.liveStartup
          term.resize(message.cols, message.rows)
        }
        if (message.type === 'ready') {
          term.write('', () => {
            if (disposed || current !== socket || current.readyState !== WebSocket.OPEN) return
            ready = true
            resize()
            term.focus()
          })
        }
        if (message.type === 'exit') {
          ended = true
          ready = false
          liveStartup = false
        }
      }
      current.onclose = () => {
        if (disposed || current !== socket || ended) return
        ready = false
        liveStartup = false
        // Reauthenticate and look up the live session after backend restarts too.
        retry = setTimeout(initialize, 3000)
      }
    }
    async function initialize() {
      if (disposed) return
      try {
        session = await openSession(opening.signal)
        if (disposed) return
        if (!session) { oncancel(); return }
        connect()
      } catch (error) {
        if (disposed) return
        // Startup failures are terminal output, not another screen to navigate.
        term.reset()
        term.writeln(String(error.message).replace(/[\x00-\x1f\x7f]/g, ' '))
        retry = setTimeout(initialize, 3000)
      }
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    initialize()
    return () => { disposed = true; opening.abort(); clearTimeout(retry); observer.disconnect(); input.dispose(); socket?.close(); term.dispose() }
  })
</script>

<div class="terminal-host" bind:this={host}></div>
{#if pasteError}
  <div class="paste-notice" role="status"><span>{pasteError}</span><button onclick={pasteClipboard}>Paste</button><button onclick={() => { pasteError = '' }}>Dismiss</button></div>
{/if}

<style>
  .terminal-host { position: absolute; inset: 0; padding: 8px; overflow: hidden; background: #0c1418; }
  .terminal-host :global(.xterm) { height: 100%; }
  .paste-notice { position: absolute; bottom: 18px; left: 18px; right: 18px; display: flex; align-items: center; gap: 12px; padding: 14px; border: 1px solid #b8d6c94d; border-radius: 12px; background: #213a32; font-size: 13px; }
  .paste-notice span { flex: 1; }
  .paste-notice button { background: #ffffff15; border: 1px solid #ffffff30; border-radius: 8px; padding: 8px 12px; }
</style>
