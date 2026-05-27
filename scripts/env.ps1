$ErrorActionPreference = "Stop"

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$msysBin = "C:\msys64\mingw64\bin"
$gearBin = Join-Path $env:USERPROFILE "AppData\Local\Programs\gear\bin"

foreach ($path in @($cargoBin, $msysBin, $gearBin)) {
    if ((Test-Path $path) -and (($env:PATH -split ";") -notcontains $path)) {
        $env:PATH = "$path;$env:PATH"
    }
}

if (-not $env:CARGO_TARGET_DIR) {
    $env:CARGO_TARGET_DIR = "C:\tmp\agent-trust-layer-target"
}

$skillsDir = Join-Path $env:USERPROFILE ".agents\skills\vara-agent-network-skills"

$env:ACCT = if ($env:ACCT) { $env:ACCT } else { "enzo95" }
$env:PARTICIPANT_HANDLE = if ($env:PARTICIPANT_HANDLE) { $env:PARTICIPANT_HANDLE } else { "enzo95" }
$env:DAPP_HANDLE = if ($env:DAPP_HANDLE) { $env:DAPP_HANDLE } else { "agent-trust-layer" }
$env:VARA_NETWORK = if ($env:VARA_NETWORK) { $env:VARA_NETWORK } else { "mainnet" }
$env:VARA_WS = if ($env:VARA_WS) { $env:VARA_WS } else { "wss://rpc.vara.network" }
$env:VARA_AGENT_NETWORK_SKILLS_DIR = if ($env:VARA_AGENT_NETWORK_SKILLS_DIR) { $env:VARA_AGENT_NETWORK_SKILLS_DIR } else { $skillsDir }
$env:VARA_AGENTS_PROGRAM_ID = if ($env:VARA_AGENTS_PROGRAM_ID) { $env:VARA_AGENTS_PROGRAM_ID } else { "0x19f27f4c906a5ac230be82d907850d44c7a7fff1b4c6903f62e78e09e0b353f3" }
$env:VOUCHER_URL = if ($env:VOUCHER_URL) { $env:VOUCHER_URL } else { "https://voucher-backend-agents.vara.network/voucher" }
$env:INDEXER_GRAPHQL_URL = if ($env:INDEXER_GRAPHQL_URL) { $env:INDEXER_GRAPHQL_URL } else { "https://agents-api.vara.network/graphql" }
$env:VAN_IDL = if ($env:VAN_IDL) { $env:VAN_IDL } else { Join-Path $env:VARA_AGENT_NETWORK_SKILLS_DIR "idl\agents_network_client.idl" }

if ($env:ATL_VERBOSE_ENV -eq "1") {
    Write-Host "PARTICIPANT_HANDLE=$env:PARTICIPANT_HANDLE"
    Write-Host "DAPP_HANDLE=$env:DAPP_HANDLE"
    Write-Host "VARA_NETWORK=$env:VARA_NETWORK"
    Write-Host "CARGO_TARGET_DIR=$env:CARGO_TARGET_DIR"
}
