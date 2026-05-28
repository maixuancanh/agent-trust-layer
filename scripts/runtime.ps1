param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $RuntimeArgs
)

$ErrorActionPreference = "Stop"
node "$PSScriptRoot\agent-runtime.mjs" @RuntimeArgs
exit $LASTEXITCODE
