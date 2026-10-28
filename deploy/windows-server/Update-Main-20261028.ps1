<#
.SYNOPSIS
    MAIN update of 2026-10-28: gateway names the failing allowlist helper (DR-8) + creator codes TheFool/ZFXSTATIC/ZEDFXSTATIC (DR-14).
.DESCRIPTION
    Wraps Update-DauntlessServer.ps1, which already builds the branch next to the running server, takes a backup,
    stops, swaps (old build kept as app.prev), starts and health-checks, and switches back by itself if the check fails.
    Run as Administrator on MAIN from the src-clone (git -C C:\DauntlessRevived\src-clone fetch; checkout the branch first,
    so this very script is the one that runs).
      -Check     read-only: newest backup age, free disk, stack status, current app build. Run this first.
      (no switch) update. Run Announce-Maintenance.ps1 first and wait for it to return.
      -Verify    after the restart: stack status, metagame and gateway answer, creator codes reject without a token (401).
      -Revert    put the previous build back (app.prev) and start it.
    Branch: dr-main-update-20261028 = origin/sg-region + 4480bee (gateway log) + the creator codes commit.
    Previous build for the record: origin/sg-region 4647f4f (code on MAIN before this update).
#>
[CmdletBinding()]
param(
    [string]$Root = 'C:\DauntlessRevived',
    [string]$Ref = 'dr-main-update-20261028',
    [switch]$Check, [switch]$Verify, [switch]$Revert
)
$ErrorActionPreference = 'Stop'
$Kit = $PSScriptRoot
$Stack = Join-Path $Root 'bin\Stack.ps1'
function Say([string]$m) { Write-Host "$(Get-Date -Format 'HH:mm:ss') $m" }

if ($Check) {
    $b = Get-ChildItem -LiteralPath (Join-Path $Root 'backups') -Directory | Sort-Object Name -Descending | Select-Object -First 1
    if ($b) { Say "newest backup: $($b.Name) (age $([int]((Get-Date) - $b.CreationTime).TotalMinutes) min)" } else { Say 'NO BACKUP FOLDER: stop here' }
    Say "free on $($Root.Substring(0,2)): $([int]((Get-PSDrive $Root.Substring(0,1)).Free / 1GB)) GB"
    & $Stack status
    if (Test-Path (Join-Path $Root 'app.prev')) { Say 'app.prev exists (rollback copy of an earlier update)' }
    return
}
if ($Verify) {
    & $Stack status
    $cfg = Get-Content -Raw -LiteralPath (Join-Path $Root 'server.json') -ErrorAction SilentlyContinue
    Say 'status shown above: every component must read running. Then check by hand: gateway log has no "socket hang up" without a port, and an unauthenticated creator POST gives 401 not 500.'
    return
}
if ($Revert) {
    & (Join-Path $Kit 'Update-DauntlessServer.ps1') -Root $Root -Rollback
    return
}
$b = Get-ChildItem -LiteralPath (Join-Path $Root 'backups') -Directory | Sort-Object Name -Descending | Select-Object -First 1
if (-not $b) { throw 'No backup folder: take a backup first.' }
Say "newest backup before the update: $($b.Name)"
Say "updating to $Ref (previous: sg-region 4647f4f)"
& (Join-Path $Kit 'Update-DauntlessServer.ps1') -Root $Root -Ref $Ref
Say 'update script finished: run this script with -Verify'
