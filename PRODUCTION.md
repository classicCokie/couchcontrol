# Local production instance

The local production instance runs at <http://localhost:8788> from a sibling
`couchcontrol-production` worktree on the `production/local` branch.

A compiled Go executable serves the built frontend directly. Vite is not used.
The user LaunchAgent `local.couchcontrol.production` keeps the service running
and starts it at login. Runtime files are in the worktree's ignored `.runtime/`
directory: executable, SQLite database, and logs. Settings were copied at setup;
subsequent settings and terminal sessions are independent of development.

To edit the application using Codex in this instance, select the original
`couchcontrol` development checkout in the folder picker. Development remains
available at <http://127.0.0.1:5173>. Editing development files does not change the
production snapshot. Codex edits files in whichever workspace folder you choose.

Service status:

```sh
launchctl print gui/$(id -u)/local.couchcontrol.production
```

Restart (ends production Codex sessions):

```sh
launchctl kickstart -k gui/$(id -u)/local.couchcontrol.production
```

The machine-specific LaunchAgent configuration is local only. Production builds,
logs, databases, API keys, and other runtime credentials must not be committed.
