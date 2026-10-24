param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$rootPath=[IO.Path]::GetFullPath($Root).TrimEnd('\')
$tasks=@{'C:\DauntlessUS'='Dauntless US deploy';'E:\DauntlessEU2'='Dauntless EU2 deploy';'C:\DauntlessGermany'='Dauntless Germany deploy'}
if(-not $tasks.ContainsKey($rootPath)){throw 'Unexpected host root'}
$task=$tasks[$rootPath]
$stage=Join-Path $rootPath 'staging/cpu-resume-20261017'
$plan=Get-Content "$stage/plan.json" -Raw | ConvertFrom-Json
$config=[IO.Path]::GetFullPath((Join-Path $rootPath 'config/deploy.env'))
if((Get-FileHash $config).Hash -ne $plan.before){throw 'Configuration changed since staging'}
if((Get-FileHash "$stage/deploy.env.new").Hash -ne $plan.after){throw 'Staged hash mismatch'}
$replacement=[IO.File]::ReadAllText("$stage/deploy.env.new")
if($replacement -notmatch '(?m)^GAMESERVER_CPU_RESUME_PERCENT=79\s*$'){throw 'CPU setting missing'}
Copy-Item $config "$stage/deploy.env.before" -Force
$game=[IO.Path]::GetFullPath((Join-Path $rootPath 'game/Dauntless/Archon/Binaries/Win64/Dauntless-Win64-Shipping.exe'))
function Owned {
 @(Get-CimInstance Win32_Process | Where-Object {
  $exe=if($_.ExecutablePath){[regex]::Replace($_.ExecutablePath.Replace('/','\'),'\\{2,}','\')}else{''}
  if($exe -ieq $game){return $true}
  if($_.Name -eq 'node.exe' -and $_.CommandLine){
   $cmd=[regex]::Replace($_.CommandLine.Replace('/','\'),'\\{2,}','\')
   return $cmd.Contains($config)
  }
  return $false
 })
}
$changed=$false
try {
 Disable-ScheduledTask -TaskName $task | Out-Null
 Stop-ScheduledTask -TaskName $task
 foreach($p in (Owned)){Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue}
 Start-Sleep -Seconds 2
 if(@(Owned).Count){throw 'Worker processes remain'}
 if((Get-FileHash $config).Hash -ne $plan.before){throw 'Configuration changed during stop'}
 $changed=$true
 [IO.File]::WriteAllText($config,$replacement,[Text.UTF8Encoding]::new($false))
 "Applied CPU stop80/resume79"
} catch {
 if($changed){Copy-Item "$stage/deploy.env.before" $config -Force}
 throw
} finally {
 Enable-ScheduledTask -TaskName $task | Out-Null
 Start-ScheduledTask -TaskName $task
}


