$ErrorActionPreference = "Stop"
. "$PSScriptRoot\env.ps1"

cargo build --release

$releaseDir = Join-Path $env:CARGO_TARGET_DIR "wasm32-gear\release"
$idl = Join-Path $releaseDir "agent_trust_layer.idl"
$wasm = Join-Path $releaseDir "agent_trust_layer.opt.wasm"
$artifactDir = Join-Path (Get-Location) "artifacts"

New-Item -ItemType Directory -Force $artifactDir | Out-Null
Copy-Item -LiteralPath $idl -Destination (Join-Path $artifactDir "agent_trust_layer.idl") -Force

Write-Host "WASM: $wasm"
Write-Host "IDL:  $idl"
Write-Host "Published IDL copy: $(Join-Path $artifactDir "agent_trust_layer.idl")"
