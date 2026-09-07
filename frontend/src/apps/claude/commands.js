// https://code.claude.com/docs/en/commands
export const commands = [
  { command: 'clear-input', title: 'Clear input', detail: 'Erase the whole draft and keep this conversation.', action: 'clear-input' },
  { command: '/model', title: 'Change model', detail: 'Choose the Claude model.', menu: true },
  { command: '/clear', title: 'Clear and start fresh', detail: 'Start a new conversation.' },
  { command: '/compact', title: 'Compact conversation', detail: 'Summarize the conversation to free context.' },
  { command: '/status', title: 'Session status', detail: 'View the current session settings.', menu: true },
  { command: '/cost', title: 'Token usage', detail: 'Show session token usage and cost statistics.' },
  { command: '/resume', title: 'Resume conversation', detail: 'Choose a saved conversation.', menu: true },
  { command: '/permissions', title: 'Permissions', detail: 'View and manage tool permissions.', menu: true },
  { command: '/config', title: 'Settings', detail: 'Open Claude Code settings.', menu: true },
  { command: '/help', title: 'Help', detail: 'Show Claude Code help.', menu: true },
  { command: '/', title: 'All Claude commands', detail: 'Browse commands from the installed CLI.', menu: true },
]
