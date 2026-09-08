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

## Linux systemd automatic updates

`scripts/update-production.sh` supports a separate production worktree running as
`couchcontrol-prod.service`. The companion user timer in `scripts/systemd/` checks
once a minute. By default it follows **local main**, including unpushed commits.
Uncommitted development edits are excluded: builds use an archive of the commit.
Set `COUCHCONTROL_UPDATE_REF=refs/remotes/origin/main` to fetch and follow pushed
commits instead. Git authentication must already work without interaction.

Create `~/.config/couchcontrol/update.env` with absolute paths:

```ini
COUCHCONTROL_REPO=/path/to/development/couchcontrol
COUCHCONTROL_PROD=/path/to/couchtree-prod
COUCHCONTROL_UPDATE_REF=refs/heads/main
```

The existing production service must serve `.runtime/couchcontrol` and
`frontend/dist` from the production worktree. The updater requires Bash, Git,
flock, curl, Node/npm, Go, and a systemd user session. Adjust the unit's PATH for
local tool installations. Optional environment settings are
`COUCHCONTROL_SERVICE` and `COUCHCONTROL_HEALTH_URL` (defaults:
`couchcontrol-prod.service` and `http://127.0.0.1:8788/`).

Install and start:

```sh
mkdir -p ~/.config/systemd/user
cp scripts/systemd/couchcontrol-update.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now couchcontrol-update.timer
systemctl --user start couchcontrol-update.service
```

Frontend tests/build and Go race tests/vet/build run in an isolated temporary
source directory while production stays available. Only a successful build
fast-forwards the production branch and restarts the service. Restarts disconnect
active terminals. A failed startup restores the previous artifacts and checkout.
Runtime databases and credentials are preserved; database migrations are not
rolled back. A dirty or diverged production checkout blocks deployment. Failed
updates retry on the next tick; newer commits arriving during a build are picked
up on the following tick. `.runtime/deployed-revision` records the last successful
commit. Keep the updater script available in the development checkout.

```sh
journalctl --user -u couchcontrol-update.service -n 100
systemctl --user list-timers couchcontrol-update.timer
systemctl --user disable --now couchcontrol-update.timer
# Also stop an in-progress build/deployment when pausing updates:
systemctl --user stop couchcontrol-update.service
```

Exercise deployment and rollback with temporary Git worktrees and mock build and
service commands: `python3 scripts/test-update-production.py`.
