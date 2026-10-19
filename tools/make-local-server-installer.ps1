# Builds DauntlessRevived-LocalServer-Setup.exe: one exe that installs a loopback-only server on a
# player's own PC (local-server\README.txt). It embeds this PC's node.exe, the metagame, deploy server
# and content server built from HEAD (git archive, so uncommitted work never ships), the two pinned
# DLLs, the local-server\ scripts and a SOURCE.txt naming the commit (AGPL).
#   powershell -ExecutionPolicy Bypass -File tools\make-local-server-installer.ps1 [-Out C:\dr\dist] [-Dev]
# -Dev takes local-server\ from the working tree instead of HEAD (for testing the scripts; never share
# a -Dev build).
param([string]$Out = "C:\dr\dist", [switch]$Dev)
$ErrorActionPreference = "Stop"

$Repo = Split-Path $PSScriptRoot -Parent
$commit = (git -C $Repo rev-parse HEAD).Trim()
$short = $commit.Substring(0, 7)
$remote = (git -C $Repo remote get-url origin).Trim() -replace '\.git$', ''
if (-not $Dev -and (git -C $Repo status --porcelain -- local-server)) { throw "local-server\ has uncommitted changes. Commit and push first, so SOURCE.txt names real code (or use -Dev for a test build)." }

$node = (Get-Command node.exe).Source
$nodeVersion = (& $node -v).Trim()
$npm = (Get-Command npm.cmd).Source
$tarExe = Join-Path $env:WINDIR "System32\tar.exe"   # bsdtar; Git's GNU tar cannot write zips
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $csc)) { throw "csc.exe (.NET Framework 4) not found at $csc" }

$Work = Join-Path $Out "local-server-build"
if (Test-Path $Work) { Remove-Item -Recurse -Force $Work }
$Src = Join-Path $Work "src"; $Pay = Join-Path $Work "payload"
New-Item -ItemType Directory -Force $Src, $Pay | Out-Null

"exporting $short ..."
$paths = @("UndauntedMetagame", "UndauntedDeployServer", "UndauntedContent", "UndauntedInternalServer/dllmain.cpp",
           "UndauntedLauncher/assets/dxgi.dll", "UndauntedLauncher/assets/UndauntedInternalServer.dll", "UndauntedLauncher/assets/icon.ico",
           "deploy/windows-server/lib", "deploy/windows-server/DauntlessServer.Common.ps1", "LICENSE.txt")
if (-not $Dev) { $paths += "local-server" }
$tar = Join-Path $Work "src.tar"
git -C $Repo archive --format=tar -o $tar HEAD -- @paths
if ($LASTEXITCODE -ne 0) { throw "git archive failed (is local-server\ committed? use -Dev otherwise)" }
& $tarExe -xf $tar -C $Src
if ($LASTEXITCODE -ne 0) { throw "tar failed" }
if ($Dev) {
    Remove-Item -Recurse -Force (Join-Path $Src "local-server") -ErrorAction SilentlyContinue
    Copy-Item -Recurse (Join-Path $Repo "local-server") (Join-Path $Src "local-server")
}

# Pins: the same as the Windows server kit at this commit.
$common = Get-Content -Raw (Join-Path $Src "deploy\windows-server\DauntlessServer.Common.ps1")
function Get-Pin([string]$Name) { if ($common -notmatch "(?m)^\s*'?$([regex]::Escape($Name))'?\s*=\s*'([^']+)'") { throw "pin $Name not found" }; $Matches[1] }
$dlls = [ordered]@{}
foreach ($d in "dxgi.dll", "UndauntedInternalServer.dll") {
    $f = Join-Path $Src "UndauntedLauncher\assets\$d"
    $h = (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash
    if ($h -ne (Get-Pin $d)) { throw "$d does not match the kit's pinned hash" }
    $dlls[$d] = $h
}

$env:NODE_ENV = $null
foreach ($pkg in "UndauntedMetagame", "UndauntedDeployServer", "UndauntedContent") {
    $dir = Join-Path $Src $pkg
    "building $pkg ..."
    Push-Location $dir
    try {
        & $npm ci --no-audit --no-fund --loglevel=error; if ($LASTEXITCODE -ne 0) { throw "npm ci failed in $pkg" }
        & $npm run build --silent; if ($LASTEXITCODE -ne 0) { throw "build failed in $pkg" }
        & $npm prune --omit=dev --no-audit --no-fund --loglevel=error; if ($LASTEXITCODE -ne 0) { throw "npm prune failed in $pkg" }
    } finally { Pop-Location }
    if (-not (Test-Path (Join-Path $dir "dist\server.js"))) { throw "$pkg has no dist\server.js" }
    if ($pkg -ne "UndauntedContent" -and -not (Test-Path (Join-Path $dir "node_modules\better-sqlite3\build\Release\better_sqlite3.node"))) { throw "$pkg has no better-sqlite3 native module" }
    $dst = Join-Path $Pay "app\$pkg"
    # Top-level folders only: node_modules has its own build\ folders (better-sqlite3's native module).
    robocopy $dir $dst /E /XD (Join-Path $dir "test") (Join-Path $dir "build") (Join-Path $dir ".vite") /XF .env "*.db" "*.log" /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "copying $pkg failed" }
}

New-Item -ItemType Directory -Force (Join-Path $Pay "node"), (Join-Path $Pay "lib"), (Join-Path $Pay "dll") | Out-Null
Copy-Item -LiteralPath $node -Destination (Join-Path $Pay "node")
$nodeLicense = Join-Path (Split-Path $node) "LICENSE"
if (Test-Path $nodeLicense) { Copy-Item $nodeLicense (Join-Path $Pay "node\LICENSE") }
else { "Node.js $nodeVersion - MIT license and third-party notices: https://github.com/nodejs/node/blob/$nodeVersion/LICENSE" | Set-Content (Join-Path $Pay "node\LICENSE.txt") -Encoding ASCII }
foreach ($f in "dr-db.js", "dr-keys.js", "backup-policy.cjs") { Copy-Item (Join-Path $Src "deploy\windows-server\lib\$f") (Join-Path $Pay "lib") }
foreach ($d in $dlls.Keys) { Copy-Item (Join-Path $Src "UndauntedLauncher\assets\$d") (Join-Path $Pay "dll") }

# The endpoint table the client-mode DLL rewrites; game servers get the same list through Game.ini.
$re = '^\s*\{L"([A-Za-z0-9_]+)", L"http://" \+ Globals::MetagameAddress(?: \+ L"([^"]*)")?\},?'
$endpoints = foreach ($l in [IO.File]::ReadAllLines((Join-Path $Src "UndauntedInternalServer\dllmain.cpp"))) { if ($l -match $re) { "$($Matches[1])=$($Matches[2])" } }
if (@($endpoints).Count -lt 150) { throw "only $(@($endpoints).Count) endpoints found in dllmain.cpp" }
[IO.File]::WriteAllLines((Join-Path $Pay "lib\endpoints.txt"), [string[]]$endpoints, (New-Object System.Text.ASCIIEncoding))

Get-ChildItem (Join-Path $Src "local-server") -File | Copy-Item -Destination $Pay
Copy-Item (Join-Path $Src "LICENSE.txt") $Pay
$version = "$(Get-Date -Format 'yyyy.MM.dd')-$short$(if ($Dev) { '-dev' })"
[ordered]@{
    version     = $version
    commit      = $commit
    sourceUrl   = $remote
    nodeVersion = $nodeVersion
    exeSha256   = Get-Pin "ExeSha256"
    build       = Get-Pin "Build"
    changelist  = Get-Pin "Changelist"
    dlls        = $dlls
} | ConvertTo-Json | Set-Content (Join-Path $Pay "payload.json") -Encoding ASCII
@(
    "Dauntless Revived - source code (AGPL-3.0)",
    "",
    "Repository: $remote",
    "Version:    $commit$(if ($Dev) { ' (plus uncommitted local-server\ changes: test build)' })",
    "Browse it:  $remote/tree/$commit",
    "",
    "Based on Undaunted (https://github.com/SyST3MDeV/Undaunted), AGPL-3.0.",
    "Includes Node.js $nodeVersion (MIT, node\LICENSE) and the npm packages under app\*\node_modules (each with its own license)."
) | Set-Content (Join-Path $Pay "SOURCE.txt") -Encoding ASCII

# The exe unpacks to <root>\staging\ with a root of at most 40 characters.
$longest = (Get-ChildItem -LiteralPath $Pay -Recurse -File | ForEach-Object { $_.FullName.Length - $Pay.Length } | Measure-Object -Maximum).Maximum
if ($longest -gt 200) { throw "a payload path is $longest characters long; it would not fit under MAX_PATH" }

"packing ..."
$zip = Join-Path $Work "payload.zip"
Push-Location $Pay
try { & $tarExe -a -c -f $zip *; if ($LASTEXITCODE -ne 0) { throw "zip failed" } } finally { Pop-Location }

$exe = Join-Path $Out "DauntlessRevived-LocalServer-Setup-$short$(if ($Dev) { '-dev' }).exe"
& $csc /nologo /target:exe /optimize+ /platform:anycpu "/out:$exe" "/win32icon:$(Join-Path $Src 'UndauntedLauncher\assets\icon.ico')" `
    "/resource:$zip,payload.zip" /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll `
    (Join-Path $Src "local-server\installer\Setup.cs")
if ($LASTEXITCODE -ne 0) { throw "csc failed" }
"exe:    $exe ($([math]::Round((Get-Item $exe).Length / 1MB)) MB)"
"sha256: $((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash)"
