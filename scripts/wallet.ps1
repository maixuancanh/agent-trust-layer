param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $WalletArgs
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\env.ps1"

& npx.cmd -y -p node@22 -p vara-wallet vara-wallet @WalletArgs
exit $LASTEXITCODE
