// Codex CLI commands: https://learn.chatgpt.com/docs/developer-commands#built-in-slash-commands
export const commands = [
  { command: 'clear-input', title: 'Clear input', detail: 'Erase the whole draft and keep this conversation.', action: 'clear-input' },
  { command: '/model', title: 'Change model', detail: 'Choose a model and reasoning effort.', menu: true },
  { command: '/clear', title: 'Clear and start fresh', detail: 'Clear the terminal and start a new chat.' },
  { command: '/compact', title: 'Compact conversation', detail: 'Summarize the conversation to free context.' },
  { command: '/status', title: 'Session status', detail: 'Show model, configuration, and token usage.' },
  { command: '/diff', title: 'View changes', detail: 'Inspect the workspace Git diff.' },
  { command: '/review', title: 'Review changes', detail: 'Choose what Codex should review.', menu: true },
  { command: '/new', title: 'New conversation', detail: 'Start a fresh chat in this terminal.' },
  { command: '/resume', title: 'Resume conversation', detail: 'Choose a saved chat to continue.', menu: true },
  { command: '/skills', title: 'Browse skills', detail: 'Choose a skill for your next request.', menu: true },
  { command: '/permissions', title: 'Permissions', detail: 'Open Codex’s permission settings.', menu: true },
  { command: '/theme', title: 'Change theme', detail: 'Choose a syntax-highlighting theme.', menu: true },
  { command: '/', title: 'All Codex commands', detail: 'Browse the CLI’s complete command list.', menu: true },
]

export function commandSelection(selected, action, entries = commands) {
  const change = { up: -1, 'right-stick-up': -1, down: 1, 'right-stick-down': 1 }[action] || 0
  return Math.max(0, Math.min(entries.length - 1, selected + change))
}

// Never mix a command into an existing draft, a native dialog, or a replacement
// connection. Send the command and Enter together, once, to the captured session.
export function createCommandSender({ target, revision, empty, send, entries = commands, label = 'Codex' }) {
  return (command, snapshot) => {
    if (!entries.some(entry => entry.command === command && !entry.action)) return 'This command is not available.'
    const destination = target()
    if (!destination) return `Wait for ${label} to connect, then reopen Commands.`
    if (!snapshot || snapshot.socket !== destination) return `${label} reconnected. Reopen Commands to use this session.`
    if (snapshot.revision !== revision()) return 'The prompt changed while Commands was open. Reopen Commands and try again.'
    if (!empty()) return `Clear the current input or close the ${label} dialog before running this command.`
    send(command === '/' ? '/' : command + '\r')
    return ''
  }
}
