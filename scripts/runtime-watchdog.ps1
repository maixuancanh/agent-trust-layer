param(
    [int] $IntervalSeconds = 60
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Logs = Join-Path $Root "logs"
$RuntimeOut = Join-Path $Logs "agent-runtime-auto.out.log"
$RuntimeErr = Join-Path $Logs "agent-runtime-auto.err.log"
$WatchdogLog = Join-Path $Logs "runtime-watchdog.log"
$RuntimePid = Join-Path $Logs "agent-runtime.pid"

New-Item -ItemType Directory -Force -Path $Logs | Out-Null

function Write-WatchdogLog {
    param([string] $Message)
    $stamp = Get-Date -Format o
    Add-Content -Path $WatchdogLog -Value "[$stamp] $Message"
}

function Get-AgentRuntimeProcess {
    if (-not (Test-Path $RuntimePid)) {
        return $null
    }

    $pidText = (Get-Content $RuntimePid -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not $pidText) {
        return $null
    }

    $runtimeProcessId = 0
    if (-not [int]::TryParse($pidText, [ref] $runtimeProcessId)) {
        return $null
    }

    $proc = Get-Process -Id $runtimeProcessId -ErrorAction SilentlyContinue
    if ($null -eq $proc -or $proc.ProcessName -notlike "node*") {
        return $null
    }

    return $proc
}

function Start-AgentRuntime {
    $proc = Start-Process `
        -FilePath "node.exe" `
        -ArgumentList @(
            "scripts\agent-runtime.mjs",
            "loop",
            "--interval",
            "30",
            "--auto-reply",
            "--min-reply-seconds",
            "120",
            "--max-replies",
            "3"
        ) `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $RuntimeOut `
        -RedirectStandardError $RuntimeErr `
        -PassThru

    Set-Content -Path $RuntimePid -Value $proc.Id -Encoding Ascii
    Write-WatchdogLog "runtime started pid=$($proc.Id)"
}

Write-WatchdogLog "watchdog started"

while ($true) {
    try {
        $proc = Get-AgentRuntimeProcess
        if ($null -eq $proc) {
            Write-WatchdogLog "runtime missing; starting"
            Start-AgentRuntime
        }
    } catch {
        Write-WatchdogLog "watchdog error: $($_.Exception.Message)"
    }

    Start-Sleep -Seconds $IntervalSeconds
}
