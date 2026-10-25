<#
.SYNOPSIS
    The one restart that puts the Singapore (sg) region live: switch to the build in app.new and
    change three settings. Rolls everything back if the server does not come up.

.DESCRIPTION
    Run it after app.new holds the sg-region build (Build-DRApp, as Update-DauntlessServer.ps1 does)
    and the Singapore worker's tunnel key is authorized and its entry is in data\config\workers.json.

    1. Backs up the database (the metagame migrates it when it starts) and stops the stack.
    2. gateway.env: adds the Singapore allowlist helper (loopback 61045) to ALLOWLIST_ADDITIONAL_URLS.
       metagame.env: SG_REGION=1 and the Singapore probe host and port.
       Every changed file is first copied to <name>.before-sg.
    3. app -> app.prev, app.new -> app. The kit scripts in bin are NOT refreshed.
    4. Starts the stack and checks the metagame and the gateway. If that fails within the timeout it
       puts the old build and the old settings back and starts them again.

    -WhatIf shows the plan and changes nothing.
.EXAMPLE
    C:\DauntlessRevived\bin\Swap-SgRegion.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Root = 'C:\DauntlessRevived',
    [string]$HelperUrl = 'http://127.0.0.1:61045',
    [string]$ProbeHost = '147.79.18.103',
    [int]$ProbePort = 22,
    [int]$HealthTimeoutSec = 600,
    [switch]$SkipBackup   # the newest backup is verified and recent: do not take another
)
$ErrorActionPreference = 'Stop'
. (Join-Path $Root 'bin\DauntlessServer.Common.ps1')
$P = Get-DRPaths $Root
$Cfg = Get-DRConfig $Root
$bin = Join-Path $Root 'bin'

function Invoke-Kit([string]$Name, [string[]]$Arguments) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $bin $Name) @Arguments 2>&1 | Out-String; $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
    foreach ($l in ($out -split "`r?`n")) { if ($l.Trim()) { Write-DRInfo $l } }
    return $code
}
# The kit's supervisor is relaunched by a scheduled task as soon as the stack stops, and it takes its own
# backup before starting the metagame, which can keep the metagame down past the health timeout.
# Pause that task while the stack is swapped, then let it run again.
$SupervisorTask = 'Dauntless Revived stack'
function Suspend-Supervisor { try { Disable-ScheduledTask -TaskName $SupervisorTask -ErrorAction Stop | Out-Null; Write-DRInfo "paused the '$SupervisorTask' task" } catch { Write-DRWarn "could not pause '$SupervisorTask' ($($_.Exception.Message))" } }
function Resume-Supervisor {
    try {
        Enable-ScheduledTask -TaskName $SupervisorTask -ErrorAction Stop | Out-Null
        if (-not (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'Stack\.ps1 supervise' -and $_.CommandLine -notmatch '-Only allowlist' })) { Start-ScheduledTask -TaskName $SupervisorTask }
        Write-DRInfo "'$SupervisorTask' task running again"
    } catch { Write-DRWarn "could not resume '$SupervisorTask' ($($_.Exception.Message))" }
}
function Test-Healthy {
    $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
    $metaUrl = 'http://{0}:{1}/dauntless-status' -f (Get-DRConfigValue $Cfg 'BindAddress' '127.0.0.1'), (Get-DRPort $Cfg 'metagame')
    $fp = [string](Get-DRConfigValue $Cfg 'CertFingerprint' '')
    $gwUrl = 'https://127.0.0.1:{0}/undaunted/api/ServerStatus' -f (Get-DRPort $Cfg 'gateway')
    $why = ''
    while ((Get-Date) -lt $deadline) {
        $m = Invoke-DRHttp -Url $metaUrl -TimeoutSec 5
        if ($m.Status -eq 200) {
            $g = Invoke-DRHttp -Url $gwUrl -Fingerprint $fp -TimeoutSec 5
            if ($g.Status -eq 200) { return '' }
            $why = "gateway: $(if ($g.Status) { "HTTP $($g.Status)" } else { $g.Error })"
        } else { $why = "metagame: $(if ($m.Status) { "HTTP $($m.Status)" } else { $m.Error })" }
        Start-Sleep -Seconds 5
    }
    return $why
}

$appNew = "$($P.App).new"
$appPrev = "$($P.App).prev"
$cfgDir = Join-Path $Root 'data\config'
$gatewayEnv = Join-Path $cfgDir 'gateway.env'
$metaEnv = Join-Path $cfgDir 'metagame.env'
$workers = Join-Path $cfgDir 'workers.json'

# --- checks before anything stops ---
if (-not (Test-Path -LiteralPath (Join-Path $appNew 'VERSION.json'))) { Stop-DR "$appNew has no VERSION.json: build it first." }
$ver = Get-Content -LiteralPath (Join-Path $appNew 'VERSION.json') -Raw | ConvertFrom-Json
if ($ver.ref -ne 'sg-region') { Stop-DR "app.new is '$($ver.ref)', not sg-region." }
foreach ($f in $gatewayEnv, $metaEnv, $workers) { if (-not (Test-Path -LiteralPath $f)) { Stop-DR "missing $f" } }
if ((Get-Content -LiteralPath $workers -Raw) -notmatch '"sg"') { Stop-DR 'workers.json has no "sg" entry.' }
$gw = Get-Content -LiteralPath $gatewayEnv
$line = $gw | Where-Object { $_ -match '^ALLOWLIST_ADDITIONAL_URLS=' } | Select-Object -First 1
if (-not $line) { Stop-DR 'gateway.env has no ALLOWLIST_ADDITIONAL_URLS line.' }
$urls = @(($line -replace '^ALLOWLIST_ADDITIONAL_URLS=', '').Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($urls -contains $HelperUrl) { Write-DRInfo "gateway.env already lists $HelperUrl" }
Write-DRInfo "new code: $($ver.commit) ($($ver.ref)); helpers now: $($urls -join ', ')"

if (-not $PSCmdlet.ShouldProcess($Root, "Switch to $($ver.commit), add $HelperUrl, enable SG_REGION, restart the stack")) { exit 0 }

# --- 1. backup + stop ---
Write-DRStep 'Backup and stop'
if ($SkipBackup) { Write-DRWarn 'skipping the backup: relying on the newest verified one' }
elseif ((Invoke-Kit 'Backup-DauntlessServer.ps1' @('-Root', $Root)) -ne 0) { Stop-DR 'The backup failed; nothing was stopped or changed.' }
Suspend-Supervisor
[void](Invoke-Kit 'Stack.ps1' @('stop', '-Root', $Root, '-NoBackup'))

# --- 2. settings ---
$stamp = 'before-sg'
function Save-Copy([string]$f) { if (-not (Test-Path -LiteralPath "$f.$stamp")) { Copy-Item -LiteralPath $f -Destination "$f.$stamp" } }
Save-Copy $gatewayEnv; Save-Copy $metaEnv
if ($urls -notcontains $HelperUrl) {
    $new = 'ALLOWLIST_ADDITIONAL_URLS=' + (($urls + $HelperUrl) -join ',')
    $gw = $gw | ForEach-Object { if ($_ -match '^ALLOWLIST_ADDITIONAL_URLS=') { $new } else { $_ } }
    Set-Content -LiteralPath $gatewayEnv -Value $gw -Encoding ascii
}
$meta = Get-Content -LiteralPath $metaEnv
foreach ($kv in @("SG_REGION=1", "REGION_SG_PROBE_HOST=$ProbeHost", "REGION_SG_PROBE_PORT=$ProbePort")) {
    $name = $kv.Split('=')[0]
    if ($meta -match "^$name=") { $meta = $meta | ForEach-Object { if ($_ -match "^$name=") { $kv } else { $_ } } } else { $meta += $kv }
}
Set-Content -LiteralPath $metaEnv -Value $meta -Encoding ascii
Write-DROk 'gateway.env and metagame.env updated'

# --- 3. switch the code ---
$prev = Get-DRConfigValue $Cfg 'Commit' 'unknown'
try { Switch-DRApp $P }
catch {
    if (-not (Test-Path -LiteralPath $P.App) -and (Test-Path -LiteralPath $appPrev)) { Rename-Item -LiteralPath $appPrev -NewName (Split-Path $P.App -Leaf) }
    Copy-Item -LiteralPath "$gatewayEnv.$stamp" -Destination $gatewayEnv -Force; Copy-Item -LiteralPath "$metaEnv.$stamp" -Destination $metaEnv -Force
    [void](Invoke-Kit 'Stack.ps1' @('start', '-Root', $Root, '-NoBackup'))
    Resume-Supervisor
    Stop-DR "Could not switch the code ($($_.Exception.Message)); the old build and settings are back."
}
Set-DRConfigValue $Cfg 'Commit' $ver.commit; Set-DRConfigValue $Cfg 'Ref' $ver.ref; Set-DRConfigValue $Cfg 'Source' $ver.source
Set-DRConfigValue $Cfg 'UpdatedAt' (Get-Date).ToString('o'); Save-DRConfig $Root $Cfg

# --- 4. start and check ---
Write-DRStep 'Start and check'
[void](Invoke-Kit 'Stack.ps1' @('start', '-Root', $Root, '-NoBackup'))
$why = Test-Healthy
if (-not $why) { Resume-Supervisor; Write-DROk "the server is up on $($ver.commit); the old build is in app.prev"; exit 0 }

Write-DRWarn "does not come up ($why): rolling back"
[void](Invoke-Kit 'Stack.ps1' @('stop', '-Root', $Root, '-NoBackup'))
$failed = "$($P.App).sg-failed"
if (Test-Path -LiteralPath $failed) { Remove-Item -LiteralPath $failed -Recurse -Force }
Rename-Item -LiteralPath $P.App -NewName (Split-Path $failed -Leaf)
Rename-Item -LiteralPath $appPrev -NewName (Split-Path $P.App -Leaf)
Copy-Item -LiteralPath "$gatewayEnv.$stamp" -Destination $gatewayEnv -Force
Copy-Item -LiteralPath "$metaEnv.$stamp" -Destination $metaEnv -Force
Set-DRConfigValue $Cfg 'Commit' $prev; Save-DRConfig $Root $Cfg
[void](Invoke-Kit 'Stack.ps1' @('start', '-Root', $Root, '-NoBackup'))
$why2 = Test-Healthy
Resume-Supervisor
if ($why2) { Stop-DR "The old build does not come up either ($why2). See $($P.Logs)." }
Stop-DR "Rolled back to $prev; the failed build is in $failed."
