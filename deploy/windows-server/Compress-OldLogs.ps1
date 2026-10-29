<#
.SYNOPSIS
  Gzips closed *.log files in <Root>\data\logs\old that are older than -Days days.
.DESCRIPTION
  One file at a time at idle priority. Each .gz is read back and compared (length and SHA-256 of the
  decompressed stream against the original) before the original is deleted. Files that are locked are
  skipped. The run stops when the system drive has less than -MinFreeGB free. Progress goes to
  <Root>\data\logs\compress-old-logs.log. Use -WhatIf to list what would be done.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Root = 'C:\DauntlessRevived',
    [int]$Days = 7,
    [int]$MinFreeGB = 15
)
$ErrorActionPreference = 'Stop'
$logs = Join-Path $Root 'data\logs'
$old = Join-Path $logs 'old'
$log = Join-Path $logs 'compress-old-logs.log'
function Log([string]$Text) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text
    if (-not $WhatIfPreference) { Add-Content -LiteralPath $log -Value $line -Encoding UTF8 }
    Write-Output $line
}
function FreeGB { [math]::Round((New-Object System.IO.DriveInfo((Split-Path -Qualifier (Resolve-Path -LiteralPath $old).Path))).AvailableFreeSpace / 1GB, 2) }

function Get-StreamHash([System.IO.Stream]$Stream) {
    $h = [System.Security.Cryptography.IncrementalHash]::CreateHash([System.Security.Cryptography.HashAlgorithmName]::SHA256)
    $buf = New-Object byte[] (1MB); $len = 0L
    try { while (($n = $Stream.Read($buf, 0, $buf.Length)) -gt 0) { $h.AppendData($buf, 0, $n); $len += $n } } finally { $Stream.Dispose() }
    $hash = [BitConverter]::ToString($h.GetHashAndReset()); $h.Dispose()
    [pscustomobject]@{ Length = $len; Hash = $hash }
}
if (-not (Test-Path -LiteralPath $old)) { Write-Output "no folder $old"; return }
try { (Get-Process -Id $PID).PriorityClass = 'Idle' } catch { }

Log ("START free={0}GB days={1}" -f (FreeGB), $Days)
$cutoff = (Get-Date).AddDays(-$Days)
$files = Get-ChildItem -LiteralPath $old -Filter '*.log' -File | Where-Object { $_.LastWriteTime -lt $cutoff } | Sort-Object Length -Descending
$done = 0; $skipped = 0
foreach ($f in $files) {
    if ((FreeGB) -lt $MinFreeGB) { Log "STOP free space below ${MinFreeGB}GB"; break }
    $gz = "$($f.FullName).gz"
    if (-not $PSCmdlet.ShouldProcess($f.FullName, 'gzip and remove original')) { continue }
    $tmp = "$gz.tmp"
    Log ("BEGIN {0}  {1:N0} bytes" -f $f.Name, $f.Length)
    try {
        # Open exclusively: a locked or still-written file is skipped.
        $in = [System.IO.File]::Open($f.FullName, 'Open', 'Read', 'None')
        try {
            $out = [System.IO.File]::Create($tmp)
            try {
                $z = New-Object System.IO.Compression.GZipStream($out, [System.IO.Compression.CompressionLevel]::Fastest)
                try { $in.CopyTo($z, 1MB) } finally { $z.Dispose() }
            } finally { $out.Dispose() }
        } finally { $in.Dispose() }

        # Read back: decompressed length and hash must equal the original's.
        $orig = Get-StreamHash ([System.IO.File]::OpenRead($f.FullName))
        $back = Get-StreamHash (New-Object System.IO.Compression.GZipStream([System.IO.File]::OpenRead($tmp), [System.IO.Compression.CompressionMode]::Decompress))
        $len = $back.Length; $origHash = $orig.Hash; $backHash = $back.Hash
        if ($len -ne $orig.Length -or $backHash -ne $origHash) { throw "verify failed (length $len vs $($f.Length))" }

        Move-Item -LiteralPath $tmp -Destination $gz -Force
        Remove-Item -LiteralPath $f.FullName -Force
        $done++
        Log ("OK   {0}  {1:N0} -> {2:N0} bytes" -f $f.Name, $f.Length, (Get-Item -LiteralPath $gz).Length)
    } catch {
        $skipped++
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        Log "SKIP $($f.Name): $($_.Exception.Message)"
    }
}
Log ("DONE compressed={0} skipped={1} free={2}GB" -f $done, $skipped, (FreeGB))
