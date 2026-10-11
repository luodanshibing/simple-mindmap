# Deploy simple-mindmap to a vault plugin folder. ASCII-only.
param([string]$Vault = 'E:\Dnotes')
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$dst = Join-Path $Vault '.obsidian\plugins\simple-mindmap'
New-Item -ItemType Directory -Force -Path (Join-Path $dst 'vendor') | Out-Null
foreach ($f in @('main.js', 'manifest.json', 'styles.css', 'versions.json')) {
  Copy-Item (Join-Path $repo $f) (Join-Path $dst $f) -Force
}
Get-ChildItem (Join-Path $repo 'vendor') -File | ForEach-Object { Copy-Item $_.FullName (Join-Path $dst ('vendor\' + $_.Name)) -Force }
node --check (Join-Path $dst 'main.js')
Write-Host ('deployed to ' + $dst)
Get-ChildItem $dst -Recurse -File | ForEach-Object { '  {0,-34} {1,10:N0} B' -f $_.FullName.Replace($dst + '\',''), $_.Length }
