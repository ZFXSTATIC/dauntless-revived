#!/bin/bash
# After dr-restart.sh has put au-region live on MAIN: check the AU tunnels from MAIN, put Australia into the
# two Discord status files (backup first, both are listed by hand), and print the DR-WATCH line.
#   tools/au-region/finish.sh        (Git Bash on the PC; needs ~/.ssh/zfx_main and ~/.dr-window.env)
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SSH="ssh -i $HOME/.ssh/zfx_main -o BatchMode=yes Administrator@82.153.118.176"
q() { grep -v -iE "quantum|store now|upgraded|openssh.com"; }
ps() { $SSH 'powershell -NoProfile -Command -' 2>&1 | q; }
echo '(Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 http://127.0.0.1:61071/gameservers).StatusCode' | ps | sed 's/^/AU deploy via tunnel from MAIN: /'
echo '(Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 http://127.0.0.1:61055/).StatusCode 2>&1' | ps | tail -1 | sed 's/^/AU allowlist helper via tunnel (404/401 = reachable): /'
put() { # put <local file> <remote path>
  local b; b=$(base64 -w0 "$1")
  printf '%s\n' "\$p='$2'; if (-not (Test-Path (\$p+'.before-au'))) { Copy-Item \$p (\$p+'.before-au') }" \
    "[IO.File]::WriteAllBytes(\$p, [Convert]::FromBase64String('$b'))" '"written " + $p' | ps
}
put "$HERE/worker.mjs"    'C:\DauntlessRevived\discord-status\worker.mjs'
put "$HERE/gamestats.mjs" 'C:\DauntlessRevived\discord-keys\gamestats.mjs'
# stopping the node processes makes the Run-Status.ps1 / Run.ps1 wrappers start them again with the new files
printf '%s\n' 'Get-CimInstance Win32_Process -Filter "name=''node.exe''" | Where-Object { $_.CommandLine -match ''discord-status.worker.mjs|discord-keys.gamestats.mjs'' } | ForEach-Object { "stopping " + $_.ProcessId; Stop-Process -Id $_.ProcessId -Force }' | ps
sleep 20
printf '%s\n' 'Get-CimInstance Win32_Process -Filter "name=''node.exe''" | Where-Object { $_.CommandLine -match ''discord-status.worker.mjs|discord-keys.gamestats.mjs'' } | ForEach-Object { "running " + $_.ProcessId + " " + $_.CommandLine.Substring($_.CommandLine.Length-40) }' | ps
bash "$(dirname "$HERE")/ops/dr-watch.sh" 2>/dev/null | grep -i australia || echo "(dr-watch.sh not in this branch: run the one from dr-ops-watch)"
