import { mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
mkdirSync('desktop/bin', { recursive: true })
const result = spawnSync('go', ['build', '-o', `../desktop/bin/couchcontrol-backend${process.platform === 'win32' ? '.exe' : ''}`, './codex'], { cwd: 'backend', stdio: 'inherit' })
process.exit(result.status ?? 1)
