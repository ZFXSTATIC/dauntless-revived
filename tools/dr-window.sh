#!/bin/bash
# One coordinated DR restart window, run from the PC in Git Bash:  tools/dr-window.sh <preflight|prepare|activate|check|rollback>
#   preflight  read-only: disk, hunts, rollback files per box
#   prepare    stage everything on every worker (build, env edits, backups); nothing is stopped; plus MAIN's two files
#   activate   swap and restart all three workers IN PARALLEL with timestamps; MAIN steps are printed (run them at the same moment)
#   check      go/no-go checks on the workers
#   rollback   put the previous deploy server, env and DLL back on all three workers in parallel
# Needs the PC's ssh keys (dr_na_new, rr_sg, dr_ger_new). Branch dr-stage-restart-sg.
set -u
REF=dr-stage-restart-sg
G=/srv/dauntless/BaseGame144/Dauntless
GW=$G/Archon/Binaries/Win64
SD=/opt/dr-src/deploy/linux-server
WORKERS=("canada ubuntu@54.39.111.49 dr_na_new 16" "singapore root@147.79.18.103 rr_sg 10" "london ubuntu@57.129.185.14 dr_ger_new 16")
SSH="ssh -o BatchMode=yes -o ConnectTimeout=15 -o LogLevel=ERROR"

stamp() { date -u +%H:%M:%S; }
each() {  # each <remote command template using @LIMIT@>; runs on all workers in parallel, prefixes output
  local cmd=$1 pids=() w
  for w in "${WORKERS[@]}"; do
    set -- $w
    ( c=${cmd//@LIMIT@/$4}; $SSH -i ~/.ssh/$3 "$2" "$c" 2>&1 | sed "s/^/[$(stamp) $1] /" ) &
    pids+=($!)
  done
  local rc=0; for p in "${pids[@]}"; do wait "$p" || rc=1; done; return $rc
}

case "${1:-}" in
preflight)
  each 'df -h / | tail -1; echo -n "games: "; pgrep -fc Dauntless-Win64-Shipping; ls -d /opt/dr-worker/UndauntedDeployServer.prev 2>&1; sudo grep -E "^(MAX_HUNTS|HUNT_EMPTY|HUNT_STARTUP)" /etc/dr-worker/deploy.env' ;;
prepare)
  echo "[$(stamp)] preparing workers (nothing stopped)"
  each "set -e; sudo cp -p /etc/dr-worker/deploy.env /etc/dr-worker/deploy.env.bak-pre-stage-20261027; \
sudo cp -p $GW/UndauntedInternalServer.dll $GW/UndauntedInternalServer.dll.prev-6f2433ab; \
sudo sed -i 's/^HUNT_EMPTY_MINUTES=2\$/HUNT_EMPTY_MINUTES=6/;s/^MAX_HUNTS=.*/MAX_HUNTS=@LIMIT@/' /etc/dr-worker/deploy.env; \
grep -q '^HUNT_STARTUP_GRACE_MINUTES=' /etc/dr-worker/deploy.env || echo HUNT_STARTUP_GRACE_MINUTES=3 | sudo tee -a /etc/dr-worker/deploy.env >/dev/null; \
sudo git -c safe.directory=/opt/dr-src -C /opt/dr-src fetch -q origin; sudo git -c safe.directory=/opt/dr-src -C /opt/dr-src checkout -q -f origin/$REF; \
sudo $SD/deploy-worker.sh --ref $REF --prepare-only; \
sudo grep -E '^(HUNT_EMPTY|HUNT_STARTUP|MAX_HUNTS)' /etc/dr-worker/deploy.env"
  echo "MAIN prepare (run in PowerShell on MAIN, under the owner's instruction):"
  echo '  Invoke-WebRequest https://raw.githubusercontent.com/ZFXSTATIC/dauntless-revived/'$REF'/UndauntedLauncher/assets/UndauntedInternalServer.dll -OutFile C:\DauntlessRevived\downloads\UndauntedInternalServer.new.dll; (Get-FileHash C:\DauntlessRevived\downloads\UndauntedInternalServer.new.dll).Hash  # must start B4CF38D1'
  echo '  Copy-Item C:\DauntlessRevived\src-clone\deploy\windows-server\Stack.ps1 C:\DauntlessRevived\bin\Stack.ps1.new; (Get-FileHash C:\DauntlessRevived\bin\Stack.ps1.new).Hash  # must start C19AC6F9' ;;
activate)
  echo "[$(stamp)] ACTIVATE: start MAIN steps now in parallel (see runbook)"
  each "set -e; sudo $SD/deploy-worker.sh --ref $REF --activate-only --force; sudo $SD/prepare-game.sh --game-dir $G; echo ACTIVATED" ;;
check)
  each 'for u in dr-worker-deploy dr-worker-tunnel dr-worker-allowlist; do echo -n "$u "; systemctl is-active $u; done; curl -s -m 5 http://127.0.0.1:61001/gameservers | head -c 200; echo; echo -n "dll "; sha256sum '$GW'/UndauntedInternalServer.dll | cut -c1-8; sudo journalctl -u dr-worker-deploy -n 15 --no-pager | grep -i -E "error|fail" | tail -3' ;;
rollback)
  each "sudo systemctl stop dr-worker-deploy; sudo rm -rf /opt/dr-worker/UndauntedDeployServer; sudo mv /opt/dr-worker/UndauntedDeployServer.prev /opt/dr-worker/UndauntedDeployServer; \
sudo cp -p /etc/dr-worker/deploy.env.bak-pre-stage-20261027 /etc/dr-worker/deploy.env; sudo cp -p $GW/UndauntedInternalServer.dll.prev-6f2433ab $GW/UndauntedInternalServer.dll; sudo systemctl start dr-worker-deploy; sleep 5; systemctl is-active dr-worker-deploy" ;;
*) echo "usage: $0 preflight|prepare|activate|check|rollback" >&2; exit 2 ;;
esac
