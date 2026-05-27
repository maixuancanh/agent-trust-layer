$ErrorActionPreference = "Stop"
. "$PSScriptRoot\env.ps1"

cargo fmt --all
cargo test
cargo test -p agent-trust-layer-app
