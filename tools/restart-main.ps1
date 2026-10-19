# Run ON main. Puts the staged hunt-fix files in place (originals kept as .bak-<stamp>), then restarts the
# metagame and the deploy server through the stack supervisor. Restarting the deploy server ends the hunts
# running on main.
$ErrorActionPreference = 'Stop'
$app = 'C:\DauntlessRevived\app'
$stamp = Get-Date -Format yyyyMMdd-HHmmss
$files = @("$app\UndauntedDeployServer\dist\controllers\capacity.js", "$app\UndauntedMetagame\dist\controllers\matchmaking.js")
foreach ($f in $files) { if (-not (Test-Path "$f.new")) { throw "missing staged file $f.new" } }
foreach ($f in $files) { Copy-Item $f "$f.bak-$stamp"; Move-Item "$f.new" $f -Force; "installed $f" }
& C:\DauntlessRevived\bin\Stack.ps1 restart -Only metagame
& C:\DauntlessRevived\bin\Stack.ps1 restart -Only deploy
Start-Sleep 10
& C:\DauntlessRevived\bin\Stack.ps1 status
"rollback: copy each *.bak-$stamp over its file, then Stack.ps1 restart -Only metagame / -Only deploy"
