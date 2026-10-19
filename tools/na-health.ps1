# Read-only NA health check, run from your PC:  powershell -File tools\na-health.ps1  [-Loop]
param([switch]$Loop, [string]$Hostname = '108.186.202.66', [string]$Key = "$env:USERPROFILE\.ssh\na_vps")
$remote = @'
$o=Get-CimInstance Win32_OperatingSystem
$g=@(Get-CimInstance Win32_Process -Filter "Name='Dauntless-Win64-Shipping.exe'")
$r=@($g|?{$_.CommandLine -match 'ramsgate_01_persistent'}).Count
$nodes=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'"|?{$_.CommandLine -match 'deploy.env'}).Count
$n=Get-NetAdapterStatistics|Select -First 1
$max=($env:X); $mx=0; 1..10|%{$sw=[Diagnostics.Stopwatch]::StartNew();Start-Sleep -Milliseconds 200;$d=$sw.Elapsed.TotalMilliseconds-200;if($d -gt $mx){$mx=$d}}
"cpu%        {0}" -f (Get-CimInstance Win32_Processor|Measure LoadPercentage -Average).Average
"sched lag   {0:N0} ms max (high = CPU starved)" -f $mx
"free RAM    {0:N0} MB" -f ($o.FreePhysicalMemory/1024)
"hunts       {0}   ramsgate {1}" -f ($g.Count-$r),$r
"deploy node {0}" -f $nodes
"nic discard in {0} / errors {1}" -f $n.ReceivedDiscardedPackets,$n.ReceivedPacketErrors
"MAX_HUNTS   {0}" -f ((Select-String C:\DauntlessUS\config\deploy.env -Pattern '^MAX_HUNTS'|%{$_.Line}) -join ',')
'@
function Probe($h, $p) { $ok = 0; $ms = 0
  1..20 | % { $t = [Diagnostics.Stopwatch]::StartNew(); $c = New-Object Net.Sockets.TcpClient
    try { if ($c.ConnectAsync($h, $p).Wait(2000)) { $ok++; $ms += $t.ElapsedMilliseconds } } catch {} ; $c.Close(); Start-Sleep -Milliseconds 200 }
  "link        {0}/20 connects ok, avg {1} ms" -f $ok, $(if ($ok) { [int]($ms / $ok) } else { '-' }) }
do {
  Get-Date -Format 's'
  Probe $Hostname 3389
  $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remote))
  ssh -i $Key -o ConnectTimeout=15 -o BatchMode=yes -o ServerAliveInterval=3 Administrator@$Hostname "powershell -NoProfile -EncodedCommand $enc" 2>&1 | ? { $_ -notmatch 'quantum|store now|upgraded' }
  ''
  if ($Loop) { Start-Sleep 30 }
} while ($Loop)
