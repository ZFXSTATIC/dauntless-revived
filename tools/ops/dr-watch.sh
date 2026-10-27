#!/bin/bash
# Read-only DR worker watch. Prints status lines (append them to the hourly status file):  tools/ops/dr-watch.sh >> ~/triage-status.txt
# Needs ~/.dr-window.env (see tools/dr-window.env.example). Per worker: hunts running/limit, hunt-lifetime stops in the last hour
# split by rule (empty/silent), engine crash dumps in the last 24 h, deploy-service state.
set -u
ENV_FILE="${DR_WINDOW_ENV:-$HOME/.dr-window.env}"
[ -f "$ENV_FILE" ] || { echo "DR-WATCH: missing $ENV_FILE"; exit 0; }
. "$ENV_FILE"
CRASHES=/var/lib/dauntless-revived-worker/wineprefix/drive_c/users/drworker/AppData/Local/Archon/Saved/Crashes
REMOTE='
s=$(systemctl is-active dr-worker-deploy)
g=$(curl -s -m 5 http://127.0.0.1:61001/gameservers | sed -n "s/.*\"running\":\([0-9]*\),\"pending\":\([0-9]*\),\"limit\":\([0-9]*\).*/\1\/\3/p" | head -1)
j=$(sudo journalctl -u dr-worker-deploy --since "1 hour ago" --no-pager 2>/dev/null | grep "Hunt lifetime limit")
e=$(printf "%s\n" "$j" | grep -c -i "empty"); k=$(printf "%s\n" "$j" | grep -c -i "silent")
d=$(sudo find '$CRASHES' -mindepth 1 -maxdepth 1 -mmin -1440 2>/dev/null | wc -l)
echo "deploy=$s hunts=${g:-?} stops1h(empty=$e silent=$k) dumps24h=$d"'
for w in "${WORKERS[@]}"; do
  set -- $w
  echo "DR-WATCH $1: $(ssh -i ~/.ssh/$3 -o BatchMode=yes -o ConnectTimeout=15 -o LogLevel=ERROR "$2" "$REMOTE" 2>&1 | tail -1)"
done
