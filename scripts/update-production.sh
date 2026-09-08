#!/usr/bin/env bash
# Run independently of the application so a service restart cannot kill the updater.
set -Eeuo pipefail
umask 077

repo=${COUCHCONTROL_REPO:-$(cd "$(dirname "$0")/.." && pwd)}
prod=${COUCHCONTROL_PROD:-$(dirname "$repo")/couchtree-prod}
ref=${COUCHCONTROL_UPDATE_REF:-refs/heads/main}
service=${COUCHCONTROL_SERVICE:-couchcontrol-prod.service}
health_url=${COUCHCONTROL_HEALTH_URL:-http://127.0.0.1:8788/}
runtime=$prod/.runtime
mkdir -p "$runtime"
exec 9>"$runtime/update.lock"
flock -n 9 || exit 0
log() { printf '%s\n' "$*"; }

if [[ "$ref" == refs/remotes/origin/main ]]; then
  GIT_TERMINAL_PROMPT=0 timeout 120 git -C "$repo" fetch origin refs/heads/main:refs/remotes/origin/main
fi
target=$(git -C "$repo" rev-parse --verify "$ref^{commit}")
if [[ -f "$runtime/deployed-revision" ]] && [[ $(cat "$runtime/deployed-revision") == "$target" ]]; then
  exit 0
fi
[[ "$(realpath "$repo")" != "$(realpath "$prod")" ]] || { log 'Production must be a separate worktree'; exit 1; }
[[ -z $(git -C "$prod" status --porcelain) ]] || { log 'Production worktree has local changes; refusing update'; exit 1; }
previous=$(git -C "$prod" rev-parse HEAD)
git -C "$prod" merge-base --is-ancestor "$previous" "$target" || { log 'Production cannot fast-forward to target'; exit 1; }
[[ -f "$runtime/couchcontrol" && -d "$prod/frontend/dist" ]] || { log 'Existing production installation required'; exit 1; }

stage=$(mktemp -d "$runtime/update.XXXXXXXX")
swapping=0
cleanup() {
  result=$?
  trap - EXIT INT TERM
  if (( swapping )); then
    log 'Deployment failed; restoring previous executable and frontend'
    systemctl --user stop "$service" || true
    cp -p "$stage/previous-binary" "$runtime/couchcontrol"
    rm -rf "$prod/frontend/dist"
    mv "$stage/previous-dist" "$prod/frontend/dist"
    # Only undo the fast-forward we performed; never discard concurrent edits.
    if [[ $(git -C "$prod" rev-parse HEAD) == "$target" ]]; then
      git -C "$prod" reset --keep "$previous" || true
    fi
    systemctl --user start "$service" || true
  fi
  rm -rf "$stage"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
log "Building production revision $target"
mkdir "$stage/source"
git -C "$repo" archive "$target" | tar -x -C "$stage/source"
(
  cd "$stage/source/frontend"
  npm ci --no-audit --no-fund
  npm test
  npm run build
  cd ../backend
  go test -race ./...
  go vet ./...
  go build -buildvcs=false -o "$stage/couchcontrol" ./codex
)
# Preserve this host's optional sign-in page.
if [[ -f "$prod/frontend/dist/login.html" && ! -f "$stage/source/frontend/dist/login.html" ]]; then
  cp "$prod/frontend/dist/login.html" "$stage/source/frontend/dist/login.html"
fi
[[ $(git -C "$prod" rev-parse HEAD) == "$previous" && -z $(git -C "$prod" status --porcelain) ]] || { log 'Production changed during build; refusing deployment'; exit 1; }
cp -p "$runtime/couchcontrol" "$stage/previous-binary"
cp -a "$prod/frontend/dist" "$stage/previous-dist"
swapping=1
systemctl --user stop "$service"
git -C "$prod" merge --ff-only "$target"
mv "$stage/couchcontrol" "$runtime/couchcontrol"
rm -rf "$prod/frontend/dist"
mv "$stage/source/frontend/dist" "$prod/frontend/dist"
systemctl --user start "$service"
healthy=0
for (( attempt=0; attempt<30; attempt++ )); do
  if systemctl --user is-active --quiet "$service" && curl --fail --silent --max-time 2 "$health_url" > /dev/null; then
    healthy=1
    break
  fi
  sleep 1
done
(( healthy )) || { log 'Production health check failed'; exit 1; }
printf '%s\n' "$target" > "$runtime/deployed-revision.next"
mv "$runtime/deployed-revision.next" "$runtime/deployed-revision"
swapping=0
log "Deployed $target"
