#!/bin/sh
# Update a Linux game worker from GitHub: clone or fetch, build the deploy server, swap it in, and roll back
# if it does not answer. Secrets and per-box settings (/etc/dr-worker/*.env) are never touched.
#
#   sudo ./deploy-worker.sh --repo https://github.com/ZFXSTATIC/dauntless-revived.git --ref server-worker-fixes
#
# Refuses to run while games are running unless --force (the swap restarts the deploy service and ends them).
set -eu

usage() {
  cat >&2 <<EOF
usage: $0 --ref <branch|tag|commit> [options]
  --repo <url>          default https://github.com/ZFXSTATIC/dauntless-revived.git
  --src <dir>           where the repository is cloned; default /opt/dr-src
  --app-dir <dir>       deploy server folder; default /opt/dr-worker/UndauntedDeployServer
  --install-root <dir>  Linux worker scripts and launcher assets; default /opt/dauntless-revived
  --service <unit>      default dr-worker-deploy
  --url <url>           health URL; default http://127.0.0.1:61001/gameservers
  --force               swap even if games are running
EOF
  exit 2
}

repo=https://github.com/ZFXSTATIC/dauntless-revived.git
src=/opt/dr-src
app_dir=/opt/dr-worker/UndauntedDeployServer
install_root=/opt/dauntless-revived
service=dr-worker-deploy
health=http://127.0.0.1:61001/gameservers
ref=
force=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) repo=$2; shift 2 ;;
    --ref) ref=$2; shift 2 ;;
    --src) src=$2; shift 2 ;;
    --app-dir) app_dir=$2; shift 2 ;;
    --install-root) install_root=$2; shift 2 ;;
    --service) service=$2; shift 2 ;;
    --url) health=$2; shift 2 ;;
    --force) force=1; shift ;;
    *) usage ;;
  esac
done
[ -n "$ref" ] || usage
for c in git node npm curl; do command -v "$c" >/dev/null 2>&1 || { echo "missing command: $c" >&2; exit 1; }; done

running() { curl -s -m 5 "$health" | sed -n 's/.*"running":\([0-9]*\).*/\1/p' | head -1; }
if [ "$force" -eq 0 ] && [ "$(running || true)" != "0" ] && [ -n "$(running || true)" ]; then
  echo "games are running ($(running)); drain first or pass --force" >&2
  exit 3
fi

if [ -d "$src/.git" ]; then git -C "$src" fetch --quiet --tags origin; else git clone --quiet "$repo" "$src"; fi
git -C "$src" checkout --quiet --force "$ref" 2>/dev/null || git -C "$src" checkout --quiet --force "origin/$ref"
commit=$(git -C "$src" rev-parse --short HEAD)
echo "building $ref ($commit)"

new="$app_dir.new"
rm -rf "$new"; mkdir -p "$new"
(cd "$src/UndauntedDeployServer" && npm ci --no-audit --no-fund >/dev/null && npm run build >/dev/null)
cp -r "$src/UndauntedDeployServer/dist" "$src/UndauntedDeployServer/package.json" "$src/UndauntedDeployServer/package-lock.json" "$new/"
(cd "$new" && npm ci --omit=dev --no-audit --no-fund >/dev/null)

# worker scripts and launcher assets (what install-worker.sh copies)
(cd "$src" && tar --exclude=.git --exclude="*/node_modules" --exclude="*/dist" --exclude="*/build" -cf - deploy UndauntedLauncher/assets) | (cd "$install_root" && tar -xf -)

systemctl stop "$service" 2>/dev/null || true
rm -rf "$app_dir.prev"; [ -d "$app_dir" ] && mv "$app_dir" "$app_dir.prev"
mv "$new" "$app_dir"
systemctl start "$service"
i=0
until curl -s -m 5 "$health" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 12 ]; then
    echo "the deploy server did not answer; rolling back" >&2
    systemctl stop "$service" 2>/dev/null || true
    rm -rf "$app_dir"; [ -d "$app_dir.prev" ] && mv "$app_dir.prev" "$app_dir"
    systemctl start "$service"
    exit 4
  fi
  sleep 5
done
echo "deployed $ref ($commit); previous build kept in $app_dir.prev"
