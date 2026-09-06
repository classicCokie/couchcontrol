// xterm sends these replies through onData too. They describe the terminal,
// not edits to the prompt (notably focus-out when Quick Commands takes focus).
export function isTerminalReport(data) {
  return /^(?:\x1b\[(?:[IO]|\??\d+;\d+R|[?>][\d;]*c|0n|[468];\d+;\d+t|\??\d+;\d+\$y)|\x1b\](?:10|11|12);[^\x07\x1b]*(?:\x07|\x1b\\))+$/.test(data)
}

// Ctrl+C is Codex's native whole-draft clear. It must never be repeated into an
// empty prompt, where it can interrupt a task or exit the CLI instead.
export function createInputClearer({ target, composer, send, revision = () => 0 }) {
  let pendingTarget = null
  return {
    edited() { pendingTarget = null },
    clear(snapshot) {
      const destination = target()
      if (!destination) return 'Wait for Codex to connect before clearing input.'
      if (snapshot && (snapshot.socket !== destination || snapshot.revision !== revision())) return 'The Codex prompt changed. Reopen Commands before clearing input.'
      const state = composer()
      if (state === 'empty') { pendingTarget = null; return '' }
      if (state !== 'draft') return 'Return to the Codex prompt before clearing input.'
      if (pendingTarget === destination) return ''
      pendingTarget = destination
      send('\x03')
      return ''
    },
  }
}
