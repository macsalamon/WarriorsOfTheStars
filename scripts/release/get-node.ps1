# Downloads the official Node.js for Windows from nodejs.org into the "node" folder next to this script (used by start.bat when Node.js is missing).
# The download is checked against the checksum nodejs.org publishes before it is unpacked.
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Arch = 'x64'
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$base = "https://nodejs.org/dist/v$Version"
$zip = "node-v$Version-win-$Arch.zip"
$dest = Join-Path $PSScriptRoot 'node'
$tmp = Join-Path $env:TEMP ('wots-node-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Write-Host "Downloading $zip ..."
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$zip" -OutFile (Join-Path $tmp $zip)
  Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt" -OutFile (Join-Path $tmp 'SHASUMS256.txt')
  $line = Get-Content (Join-Path $tmp 'SHASUMS256.txt') | Where-Object { $_ -match ([regex]::Escape($zip) + '$') } | Select-Object -First 1
  if (-not $line) { throw 'The checksum of the download was not found.' }
  $want = ($line -split '\s+')[0].ToLower()
  # .NET directly (no module has to be loaded)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $got = ([System.BitConverter]::ToString($sha.ComputeHash([System.IO.File]::ReadAllBytes((Join-Path $tmp $zip)))) -replace '-', '').ToLower()
  if ($want -ne $got) { throw 'The download is damaged (the checksum does not match).' }
  Write-Host 'Unpacking ...'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $tmp $zip), $tmp)
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  Move-Item -Path (Join-Path $tmp "node-v$Version-win-$Arch") -Destination $dest
  Write-Host 'Node.js is ready.'
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
