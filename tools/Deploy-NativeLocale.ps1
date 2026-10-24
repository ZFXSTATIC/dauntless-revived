param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$expected='BEB17A8F962B93AF482C6935FB781ABA65ED299CC972813DB8F662C35EDA3C28'
$rootPath=[IO.Path]::GetFullPath($Root)
if($rootPath -notin @('C:\DauntlessRevived','C:\DauntlessUS','C:\DauntlessGermany','E:\DauntlessEU2')){throw 'Unexpected host root'}
$candidate=Join-Path $rootPath 'staging/Locale-Candidate.dll'
$target=Join-Path $rootPath 'game/Dauntless/Archon/Binaries/Win64/UndauntedInternalServer.dll'
if((Get-FileHash -LiteralPath $candidate).Hash -ne $expected){throw 'Candidate hash mismatch'}
$before=(Get-FileHash -LiteralPath $target).Hash
if($before -ne $expected -and $before -ne '87AECD7BEBA33F479F6EF3F335E90E20DCD32FDDD31EBD3A23D6BD542B1156A0'){throw 'Unexpected live DLL; preserve other developer changes'}; if($before -eq $expected){'Candidate already installed';exit 0}
$backup=Join-Path $rootPath ('backups/native-locale-'+(Get-Date -Format yyyyMMdd-HHmmss))
New-Item -ItemType Directory -Path $backup -ErrorAction Stop|Out-Null
Copy-Item -LiteralPath $target -Destination "$backup/UndauntedInternalServer.dll"
if((Get-FileHash -LiteralPath "$backup/UndauntedInternalServer.dll").Hash -ne $before){throw 'Backup hash mismatch'}
foreach($pair in @(@('config','config'),@('data/config','data-config'))){$source=Join-Path $rootPath $pair[0];if(Test-Path -LiteralPath $source){Copy-Item -LiteralPath $source -Destination (Join-Path $backup $pair[1]) -Recurse}}
$incoming="$target.incoming"
Copy-Item -LiteralPath $candidate -Destination $incoming -Force
# Replace the file for new workers; existing loaded images and hunts are retained.
# If Windows denies replacement of a mapped image, abort rather than killing hunts.
[IO.File]::Replace($incoming,$target,"$backup/replaced-image.dll")
if((Get-FileHash -LiteralPath $target).Hash -ne $expected){throw 'Installed hash mismatch; restore verified backup before admitting new hunts'}
[pscustomobject]@{Installed=$true;Hash=$expected;Previous=$before;Backup=$backup;RestartedProcesses=0}|ConvertTo-Json -Compress

