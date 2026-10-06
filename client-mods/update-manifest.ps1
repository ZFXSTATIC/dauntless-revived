# Rebuilds client-mods\manifest.json: every file of the UE4SS + mods bundle with its SHA-256 and size.
# The friend kit (friend-kit\setup.ps1) and the launcher (UndauntedLauncher, src\main\client-mods.ts) only
# install files that match this list, and check them again after copying - like the pinned server DLLs.
# Run it after changing any file in this folder, and commit manifest.json with the change.
#
#   powershell -ExecutionPolicy Bypass -File client-mods\update-manifest.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# Files a player may edit (mods switched on/off in the in-game menu, UE4SS settings):
# installed when missing, never overwritten.
$keep = @('ue4ss/Mods/mods.txt', 'ue4ss/UE4SS-settings.ini')
$skip = @('manifest.json', 'update-manifest.ps1', 'README.md', '.gitattributes')

$files = Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $skip -notcontains $_.Name } |
  Sort-Object FullName | ForEach-Object {
    $rel = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
    [ordered]@{
      path   = $rel
      sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower()
      size   = $_.Length
      keep   = [bool]($keep -contains $rel)
    }
  }
$json = [ordered]@{ version = 1; target = 'Archon/Binaries/Win64'; files = @($files) } | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText((Join-Path $root 'manifest.json'), $json.Replace("`r`n", "`n") + "`n", (New-Object Text.UTF8Encoding $false))
Write-Host "manifest.json: $(@($files).Count) files"
