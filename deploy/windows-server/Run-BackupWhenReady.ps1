<# Waits until log compression is finished and enough disk is free, runs one backup and records the outcome.
   Removes nothing. Result file: <Root>\data\logs\backup-when-ready.result.txt
   Start detached:  Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-File','<this file>' #>
param([string]$Root = 'C:\DauntlessRevived', [int]$MinFreeGB = 70, [int]$MaxWaitHours = 6, [int]$AbortFreeGB = 8)
$ErrorActionPreference = 'Continue'
$logs = Join-Path $Root 'data\logs'
$result = Join-Path $logs 'backup-when-ready.result.txt'
function Note($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" | Add-Content -LiteralPath $result }
function FreeGB { [math]::Round((Get-PSDrive -Name C).Free / 1GB, 1) }
Note "WAITING free=$(FreeGB)GB need=$MinFreeGB"
$deadline = (Get-Date).AddHours($MaxWaitHours)
while ($true) {
    $c = Get-Content (Join-Path $logs 'compress-old-logs.log') -Tail 1 -ErrorAction SilentlyContinue
    $done = $c -match 'DONE|STOP'
    if ($done -and (FreeGB) -ge $MinFreeGB) { break }
    if ((Get-Date) -gt $deadline) { Note "TIMEOUT compression_line='$c' free=$(FreeGB)GB"; return }
    Start-Sleep -Seconds 120
}
if (Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'dr-db' }) { Note 'ABORT a dr-db process is still running'; return }
Note "START backup free=$(FreeGB)GB"
$sw = [Diagnostics.Stopwatch]::StartNew()
$bp = Start-Process powershell.exe -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Join-Path $Root 'bin\Backup-DauntlessServer.ps1'),'-Root',$Root
$aborted = $false
while (-not $bp.HasExited) {
    if ((FreeGB) -lt $AbortFreeGB) { $aborted = $true; Note "ABORT free space below ${AbortFreeGB}GB, stopping the backup (partial folder left in place, nothing removed)"; & taskkill.exe /PID $bp.Id /T /F | Out-Null; break }
    Start-Sleep -Seconds 15
}
$bp.WaitForExit()
Note "BACKUP EXIT code=$($bp.ExitCode) aborted=$aborted"
Note "BACKUP DONE minutes=$([math]::Round($sw.Elapsed.TotalMinutes,1)) free=$(FreeGB)GB"
Note ('backup.log tail: ' + ((Get-Content (Join-Path $logs 'backup.log') -Tail 3 -ErrorAction SilentlyContinue) -join ' | '))
$e = Join-Path $logs 'backup-db.err.log'
Note ('err.log: ' + $(if (Test-Path $e) { (Get-Content $e -Tail 3) -join ' | ' } else { 'none' }))
Note ('newest backups: ' + ((Get-ChildItem (Join-Path $Root 'backups') -Directory | Sort-Object Name -Descending | Select-Object -First 3 | ForEach-Object { $_.Name }) -join ', '))
Note 'FINISHED'
