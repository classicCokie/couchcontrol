import { createTerminalAPI } from './api.js'
import { sessionFor } from './session.js'
import * as codexComposer from './composer.js'
import * as claudeComposer from '../claude/composer.js'
import { commands as codexCommands } from './commands.js'
import { commands as claudeCommands } from '../claude/commands.js'

export const terminalProfiles = {
  codex: { label: 'Codex', commands: codexCommands, ...codexComposer, ...createTerminalAPI(), openSession: sessionFor('codex') },
  claude: { label: 'Claude', commands: claudeCommands, ...claudeComposer, ...createTerminalAPI('claude', 'Claude'), openSession: sessionFor('claude') },
}
