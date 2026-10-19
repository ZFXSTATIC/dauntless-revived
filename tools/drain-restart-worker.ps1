# Run ON the NA host. Restarts the deploy server onto the staged build (app\UndauntedDeployServer\dist.new).
#
# Normal run (drain build already running): creates the drain file, waits for every hunt to finish, then
#   restarts. On timeout it removes the drain file and changes nothing.
# -FirstInstall (running server has no drain support): waits up to $MaxWaitMin for a lull of at most
#   $InterruptAtMost hunts, then restarts anyway. Those hunts end.
# -MaxHunts 0 leaves MAX_HUNTS alone.
# Germany: -Root C:\DauntlessWorker -AppDir C:\DauntlessWorker\UndauntedDeployServer -Task 'Dauntless Worker deploy'
param([int]$MaxHunts = 0, [int]$MaxWaitMin = 60, [switch]$FirstInstall, [int]$InterruptAtMost = 3,
  [string]$Root = 'C:\DauntlessUS', [string]$AppDir = '', [string]$Task = 'Dauntless US deploy')
$ErrorActionPreference = 'Stop'
$cfg = "$Root\config\deploy.env"
$flag = "$Root\config\drain.flag"
$app = if ($AppDir) { $AppDir } else { "$Root\app\UndauntedDeployServer" }
function Hunts { @(Get-CimInstance Win32_Process -Filter "Name='Dauntless-Win64-Shipping.exe'" | ? { $_.CommandLine -notmatch 'ramsgate_01_persistent' }).Count }
function DeployNode { Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -match 'deploy.env' } }

$node = @(DeployNode)
if ($node.Count -ne 1) { throw "expected 1 deploy server process, found $($node.Count)" }
if (-not (Test-Path "$app\dist.new\controllers\capacity.js")) { throw 'no staged build in dist.new' }
if (-not (Select-String "$app\dist.new\controllers\capacity.js" -Pattern 'HuntsDraining' -Quiet)) { throw 'staged build has no drain support' }
$drainReady = (Select-String "$app\dist\controllers\capacity.js" -Pattern 'HuntsDraining' -Quiet) -and
  (Select-String $cfg -Pattern "^DRAIN_FILE=$([regex]::Escape($flag))$" -Quiet) -and
  $node[0].CreationDate -gt (Get-Item "$app\dist\controllers\capacity.js").LastWriteTime -and $node[0].CreationDate -gt (Get-Item $cfg).LastWriteTime
if (-not $FirstInstall -and -not $drainReady) { throw 'the running deploy server cannot drain. Use -FirstInstall once (it ends the hunts still running).' }
if ($FirstInstall -and $drainReady) { throw 'drain already works here; run without -FirstInstall' }

Copy-Item $cfg "$cfg.bak-$(Get-Date -f yyyyMMdd-HHmmss)"
$end = (Get-Date).AddMinutes($MaxWaitMin)
if ($FirstInstall) {
  "waiting for a lull: $(Hunts) hunts running (restart at <= $InterruptAtMost, or after $MaxWaitMin min)"
  while ((Hunts) -gt $InterruptAtMost -and (Get-Date) -lt $end) { Start-Sleep 20 }
  "restarting with $(Hunts) hunts running; they will end"
} else {
  New-Item -ItemType File -Force $flag | Out-Null
  "draining: $(Hunts) hunts running"
  while ((Hunts) -gt 0 -and (Get-Date) -lt $end) { Start-Sleep 20 }
  if ((Hunts) -gt 0) { Remove-Item $flag -Force; "TIMEOUT: $(Hunts) hunts still running. Drain removed, nothing changed."; exit 1 }
}

# wrapper first, or it relaunches node within 5s
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | ? { $_.CommandLine -match 'Run-deploy' } | % { Stop-Process -Id $_.ProcessId -Force }
DeployNode | % { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep 3
if (Test-Path "$app\dist.prev") { Remove-Item "$app\dist.prev" -Recurse -Force }
Rename-Item "$app\dist" 'dist.prev'; Rename-Item "$app\dist.new" 'dist'
$t = @(Get-Content $cfg | ? { $_ -notmatch '^DRAIN_FILE=' -and -not ($MaxHunts -gt 0 -and $_ -match '^MAX_HUNTS=') })
$t += "DRAIN_FILE=$flag"
if ($MaxHunts -gt 0) { $t += "MAX_HUNTS=$MaxHunts" }
# Settings staged ahead of time in deploy.env.pending (KEY=value lines) are applied here, with the restart.
if (Test-Path "$cfg.pending") {
  $pending = @(Get-Content "$cfg.pending" | ? { $_ -match '^[A-Z0-9_]+=' })
  $keys = $pending | % { ($_ -split '=', 2)[0] }
  $t = @($t | ? { $k = ($_ -split '=', 2)[0]; $keys -notcontains $k }) + $pending
  Rename-Item "$cfg.pending" "deploy.env.applied-$(Get-Date -f yyyyMMdd-HHmmss)"
  "applied pending settings: $($keys -join ', ')"
}
Set-Content $cfg $t
if (Test-Path $flag) { Remove-Item $flag -Force }
schtasks /run /tn $Task | Out-Null; Start-Sleep 8
"deploy server processes: $(@(DeployNode).Count)   (rollback: stop it, swap dist.prev back to dist)"
