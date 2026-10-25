<#
.SYNOPSIS
    Registers the daily full-database backup task ("Dauntless daily database backup").

.DESCRIPTION
    The save database is tens of GB: the copy takes minutes but the integrity check of the copy takes
    close to an hour, so a short run limit kills the task half way and leaves a folder with no secrets.
    The task runs Backup-DauntlessServer.ps1 once a day as SYSTEM through backup-hidden.vbs, with a
    6 hour run limit and no overlapping runs. Run in an elevated PowerShell. Safe to run again.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\Install-DailyBackupTask.ps1 -Root C:\DauntlessRevived -At 02:00
#>
param(
    [string]$Root = 'C:\DauntlessRevived',
    [string]$At = '02:00',
    [string]$TaskName = 'Dauntless daily database backup'
)
$ErrorActionPreference = 'Stop'
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\wscript.exe" -Argument "`"$Root\bin\backup-hidden.vbs`" `"$Root`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 6) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
"registered '$TaskName' daily at $At, 6 h run limit"
