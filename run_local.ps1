param(
    [ValidateSet("all", "backend", "frontend")]
    [string]$Mode = "all",
    [string]$OpenAIApiKey = "",
    [int]$BackendPort = 8010,
    [int]$FrontendPort = 5173,
    [switch]$UseReload,
    [switch]$SkipInstall,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Invoke-Step {
    param(
        [string]$Message,
        [scriptblock]$Action
    )
    Write-Host "==> $Message" -ForegroundColor Cyan
    if (-not $DryRun) {
        & $Action
    }
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"
$venvPython = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path $backendDir)) { throw "Missing backend directory: $backendDir" }
if (-not (Test-Path $frontendDir)) { throw "Missing frontend directory: $frontendDir" }

if (-not $SkipInstall) {
    if (-not (Test-Path $venvPython)) {
        Invoke-Step "Creating Python virtual environment" { python -m venv (Join-Path $root ".venv") }
    }

    Invoke-Step "Installing backend dependencies" {
        & $venvPython -m pip install --upgrade pip
        & $venvPython -m pip install -r (Join-Path $backendDir "requirements.txt")
    }

    if (($Mode -eq "all") -or ($Mode -eq "frontend")) {
        Invoke-Step "Installing frontend dependencies" {
            Push-Location $frontendDir
            try {
                npm install
            } finally {
                Pop-Location
            }
        }
    }
}

if (($Mode -eq "all") -or ($Mode -eq "backend")) {
    $backendCmd = @("Set-Location '$root'")
    if ($OpenAIApiKey) {
        $backendCmd += "`$env:OPENAI_API_KEY='$OpenAIApiKey'"
    }
    $reloadArg = ""
    if ($UseReload) { $reloadArg = "--reload" }
    $backendCmd += "& '$venvPython' -m uvicorn backend.app.main:app --host 127.0.0.1 --port $BackendPort $reloadArg"
    $backendCmdText = ($backendCmd -join "; ")

    Invoke-Step "Starting backend at http://localhost:$BackendPort" {
        Start-Process powershell -ArgumentList @("-NoExit", "-Command", $backendCmdText) | Out-Null
    }
}

if (($Mode -eq "all") -or ($Mode -eq "frontend")) {
    $frontendCmd = "`$env:VITE_API_BASE_URL='http://localhost:$BackendPort'; Set-Location '$frontendDir'; npm run dev -- --port $FrontendPort"
    Invoke-Step "Starting frontend at http://localhost:$FrontendPort" {
        Start-Process powershell -ArgumentList @("-NoExit", "-Command", $frontendCmd) | Out-Null
    }
}

Write-Host ""
Write-Host "Started. Open http://localhost:$FrontendPort (frontend) and http://localhost:$BackendPort/docs (backend)." -ForegroundColor Green
if (-not $OpenAIApiKey) {
    $envFile = Join-Path $root ".env"
    $hasKey = (Test-Path $envFile) -and (Get-Content $envFile | Where-Object { $_ -match "^OPENAI_API_KEY=\S" })
    if (-not $hasKey) {
        Write-Host "No OPENAI_API_KEY found. Add it to .env or pass -OpenAIApiKey." -ForegroundColor Yellow
    }
}
