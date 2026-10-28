<#
.SYNOPSIS
    Posts a maintenance countdown to the Discord webhook: a first notice, reminders 10 and 2 minutes before, and returns at the start time.
.DESCRIPTION
    The webhook URL is read from a private file on the box (default <root>\data\keys\discord-status.key, first line, https URL).
    It is never printed or put in git. Use -WebhookFile for a file that points at the announcements channel instead.
    Run it, wait until it returns, then start the restart. -WhatIf prints the two messages and sends nothing.
.EXAMPLE
    C:\DauntlessRevived\src-clone\deploy\windows-server\Announce-Maintenance.ps1 -Minutes 20
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Root = 'C:\DauntlessRevived',
    [string]$WebhookFile,
    [ValidateRange(3, 60)][int]$Minutes = 20,
    [string]$Reason = 'a short update with fixes and new creator codes'
)
$ErrorActionPreference = 'Stop'
if (-not $WebhookFile) { $WebhookFile = Join-Path $Root 'data\keys\discord-status.key' }
$Start = (Get-Date).AddMinutes($Minutes)
$At = $Start.ToUniversalTime().ToString('HH:mm') + ' UTC'
$First = "Server maintenance in $Minutes minutes ($At) for $Reason. Servers will be down for about 5 minutes. Please finish your current hunt and return to Ramsgate or the menu before then."
$Mid = "Reminder: the servers restart in 10 minutes ($At). Please finish your current hunt."
$Second = "Reminder: the servers restart in 2 minutes ($At). Finish or leave your hunt now. We will post when we are back."
function Send([string]$Text) {
    if (-not $PSCmdlet.ShouldProcess('announcement webhook', $Text)) { Write-Host "[dry run] $Text"; return }
    $url = (Get-Content -LiteralPath $WebhookFile -TotalCount 1).Trim()
    if ($url -notmatch '^https://') { throw 'The webhook file does not start with an https URL.' }
    $body = @{ content = $Text } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri $url -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
    Write-Host "$(Get-Date -Format 'HH:mm:ss') sent: $Text"
}
Send $First
if ($WhatIfPreference) { Send $Mid; Send $Second; return }
foreach ($step in @(@(10, $Mid), @(2, $Second))) {
    if ($Minutes -le $step[0]) { continue }
    $wait = ($Start.AddMinutes(-$step[0]) - (Get-Date)).TotalSeconds
    if ($wait -gt 0) { Start-Sleep -Seconds ([int]$wait) }
    Send $step[1]
}
$wait = ($Start - (Get-Date)).TotalSeconds
if ($wait -gt 0) { Start-Sleep -Seconds ([int]$wait) }
Write-Host "$(Get-Date -Format 'HH:mm:ss') countdown finished: start the restart now"
