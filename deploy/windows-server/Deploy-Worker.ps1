<#
.SYNOPSIS
    Builds the deploy server from a GitHub branch and swaps it in, keeping the previous build for a rollback.

.DESCRIPTION
    Clones (or fetches) the repository, checks out -Ref, builds UndauntedDeployServer there (so the live app
    folder never needs a compiler) and replaces <App>\dist with the result. The previous build stays in
    <App>\dist.prev. It does not restart anything and it never touches the env files or node_modules.

    The packages the server runs with (everything in package-lock.json that is not a dev tool) are compared
    with the repository's. If any differ the swap is refused unless -AllowDependencyChange is given, because
    the new build was compiled against the repository's packages.

.EXAMPLE
    .\Deploy-Worker.ps1 -App C:\DauntlessUS\app\UndauntedDeployServer -Src C:\DauntlessUS\src-clone -Ref server-worker-fixes
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$App,
    [Parameter(Mandatory)][string]$Src,
    [Parameter(Mandatory)][string]$Ref,
    [string]$Repo = 'https://github.com/ZFXSTATIC/dauntless-revived.git',
    [switch]$AllowDependencyChange,
    [switch]$Rollback
)
$ErrorActionPreference = 'Stop'
$node = 'C:\Program Files\nodejs'
$env:Path = "$node;$env:Path"

if ($Rollback) {
    if (-not (Test-Path "$App\dist.prev")) { throw "no $App\dist.prev to roll back to" }
    if (Test-Path "$App\dist.bad") { Remove-Item "$App\dist.bad" -Recurse -Force }
    Rename-Item "$App\dist" 'dist.bad'
    Rename-Item "$App\dist.prev" 'dist'
    'rolled back: dist.prev is dist again (the replaced build is in dist.bad)'
    return
}

# Not named Git: PowerShell command names are case-insensitive, so a function Git would call itself.
function Invoke-Git { & git.exe @args; if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed" } }
if (Test-Path "$Src\.git") { Invoke-Git -C $Src fetch --quiet --tags origin } else { Invoke-Git clone --quiet $Repo $Src }
& git.exe -C $Src checkout --quiet --force $Ref 2>$null
if ($LASTEXITCODE -ne 0) { Invoke-Git -C $Src checkout --quiet --force "origin/$Ref" }
$commit = (& git.exe -C $Src rev-parse --short HEAD)
"building $Ref ($commit)"

$build = Join-Path $Src 'UndauntedDeployServer'
# Only the packages the server runs with matter here (dev tools may differ without any effect on the swap).
$compare = "const fs=require('fs');const r=f=>{const p=JSON.parse(fs.readFileSync(f,'utf8')).packages||{};return Object.fromEntries(Object.entries(p).filter(([k,v])=>k.startsWith('node_modules/')&&!v.dev).map(([k,v])=>[k,v.version]))};const a=r(process.argv[1]),b=r(process.argv[2]);const d=[...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>a[k]!==b[k]);console.log(d.length)"
$changed = [int](& "$node\node.exe" -e $compare "$App\package-lock.json" "$build\package-lock.json")
if ($changed -gt 0) {
    if (-not $AllowDependencyChange) { throw "$changed runtime package(s) differ between the live package-lock.json and the repository's; refusing to swap (use -AllowDependencyChange to override)" }
    "warning: $changed runtime package(s) differ; only the built code is swapped, node_modules stays as it is"
} else { 'runtime packages match the live install' }

# npm prints warnings on stderr; run it through cmd so Windows PowerShell 5.1 does not turn them into errors.
Push-Location $build
try {
    & cmd.exe /c "`"$node\npm.cmd`" ci --no-audit --no-fund >nul 2>&1"
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    & cmd.exe /c "`"$node\npm.cmd`" run build >nul 2>&1"
    if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
} finally { Pop-Location }
if (-not (Test-Path "$build\dist\server.js")) { throw 'the build produced no dist\server.js' }

if (Test-Path "$App\dist.prev") { Remove-Item "$App\dist.prev" -Recurse -Force }
Rename-Item "$App\dist" 'dist.prev'
Copy-Item "$build\dist" "$App\dist" -Recurse
"swapped in: $((Get-ChildItem "$App\dist" -Recurse -File -Filter *.js).Count) files from $commit; previous build kept in $App\dist.prev"
'restart the deploy server to use it (Deploy-Worker.ps1 -Rollback undoes the swap)'
