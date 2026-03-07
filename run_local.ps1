param(
    [ValidateSet("all", "backend", "frontend")]
    [string]$Mode = "all",
    [string]$OpenAIApiKey = "",
    [string]$ClerkPublishableKey = "",
    [string]$ClerkJwksUrl = "",
    [ValidateSet("clerk", "dev")]
    [string]$AuthMode = "clerk",
    [string]$DevUserId = "local-dev-user",
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
    $backendCmd += "`$env:AUTH_MODE='$AuthMode'"
    if ($AuthMode -eq "dev") {
        $backendCmd += "`$env:DEV_USER_ID='$DevUserId'"
    }
    if ($ClerkJwksUrl) {
        $backendCmd += "`$env:CLERK_JWKS_URL='$ClerkJwksUrl'"
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
    $frontendCmdParts = @(
        "Set-Location '$frontendDir'",
        "`$env:VITE_API_BASE_URL='http://localhost:$BackendPort'"
    )
    if ($ClerkPublishableKey) {
        $frontendCmdParts += "`$env:VITE_CLERK_PUBLISHABLE_KEY='$ClerkPublishableKey'"
    }
    $frontendCmdParts += "npm run dev -- --host 127.0.0.1 --port $FrontendPort"
    $frontendCmd = ($frontendCmdParts -join "; ")

    Invoke-Step "Starting frontend at http://localhost:$FrontendPort" {
        Start-Process powershell -ArgumentList @("-NoExit", "-Command", $frontendCmd) | Out-Null
    }
}

Write-Host ""
Write-Host "Started. Open http://localhost:$FrontendPort (frontend) and http://localhost:$BackendPort/docs (backend)." -ForegroundColor Green

if (-not $OpenAIApiKey) {
    $envFile = Join-Path $backendDir ".env"
    $hasKey = (Test-Path $envFile) -and (Get-Content $envFile | Where-Object { $_ -match "^OPENAI_API_KEY=\S" })
    if (-not $hasKey) {
        Write-Host "No OPENAI_API_KEY found. Add it to backend/.env or pass -OpenAIApiKey." -ForegroundColor Yellow
    }
}

if (-not $ClerkPublishableKey) {
    $frontendEnvFile = Join-Path $frontendDir ".env"
    $frontendEnvLocalFile = Join-Path $frontendDir ".env.local"
    $hasFrontendClerk = $false
    if (Test-Path $frontendEnvFile) {
        $hasFrontendClerk = $hasFrontendClerk -or [bool](Get-Content $frontendEnvFile | Where-Object { $_ -match "^VITE_CLERK_PUBLISHABLE_KEY=\S" })
    }
    if (Test-Path $frontendEnvLocalFile) {
        $hasFrontendClerk = $hasFrontendClerk -or [bool](Get-Content $frontendEnvLocalFile | Where-Object { $_ -match "^VITE_CLERK_PUBLISHABLE_KEY=\S" })
    }
    if (-not $hasFrontendClerk) {
        Write-Host "No VITE_CLERK_PUBLISHABLE_KEY found. Add it to frontend/.env(.local) or pass -ClerkPublishableKey." -ForegroundColor Yellow
    }
}

if ($AuthMode -eq "clerk" -and -not $ClerkJwksUrl) {
    $backendEnvFile = Join-Path $backendDir ".env"
    $hasClerkJwks = (Test-Path $backendEnvFile) -and (Get-Content $backendEnvFile | Where-Object { $_ -match "^CLERK_JWKS_URL=\S" })
    if (-not $hasClerkJwks) {
        Write-Host "No CLERK_JWKS_URL found. AUTH_MODE=clerk requires it (backend/.env or -ClerkJwksUrl)." -ForegroundColor Yellow
    }
}

if ($AuthMode -eq "dev") {
    Write-Host "AUTH_MODE=dev enabled. Backend will trust DEV_USER_ID='$DevUserId'. Do not use in production." -ForegroundColor Yellow
}
