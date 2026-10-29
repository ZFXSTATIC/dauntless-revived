<# One detached run: gzip rotated logs older than -Days days, then run one backup when there is room.
   Meant to be started by a one-time scheduled task (SYSTEM) so it outlives the ssh session.
   Results: data\logs\compress-old-logs.log (ends DONE or STOP) and data\logs\backup-when-ready.result.txt (ends FINISHED). #>
param([string]$Root = 'C:\DauntlessRevived', [int]$Days = 2, [int]$MaxWaitHours = 9)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $here 'Compress-OldLogs.ps1') -Root $Root -Days $Days
& (Join-Path $here 'Run-BackupWhenReady.ps1') -Root $Root -MaxWaitHours $MaxWaitHours
