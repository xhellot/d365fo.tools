<#
    .SYNOPSIS
        Sets up the D365FO web admin tools on a new machine, end to end.

    .DESCRIPTION
        Does everything needed to go from a bare Windows box to the web app
        running and starting automatically at boot:

          1. Elevates itself if needed (service setup requires Administrator).
          2. Checks for Node.js, installing it via winget when available.
          3. Installs the d365fo.tools PowerShell module for all users, which is
             the scope the SYSTEM account can load from.
          4. Gets the web-app files - from this clone if you are running it out
             of one, otherwise by downloading the repository.
          5. Runs npm install.
          6. Registers the boot-time scheduled task via setup-autostart.ps1.
          7. Verifies the app answers on its health endpoint.

        Safe to re-run: every step is idempotent.

    .PARAMETER InstallPath
        Where to place the app when it has to be downloaded. Ignored when run
        from an existing clone. Default C:\D365FO-WebApp.

    .PARAMETER Port
        Port for the web app. Default 3000.

    .PARAMETER Branch
        Branch to download when not running from a clone. Default master.

    .PARAMETER RepoUrl
        Repository to download from when not running from a clone.

    .PARAMETER SkipAutostart
        Install everything but do not register the boot-time task.

    .PARAMETER UpdateModule
        Reinstall d365fo.tools even if it is already present.

    .PARAMETER NoElevate
        Internal. Set on the relaunched elevated process to stop it elevating
        again in a loop.

    .EXAMPLE
        PS C:\> .\bootstrap.ps1

        Run from a clone of the repository. Sets everything up.

    .EXAMPLE
        PS C:\> .\bootstrap.ps1 -Port 8080 -InstallPath D:\Tools\D365FOWebApp

        Downloads to a chosen folder and serves on port 8080.
#>
[CmdletBinding()]
param (
    [string] $InstallPath = 'C:\D365FO-WebApp',
    [int]    $Port = 3000,
    [string] $Branch = 'master',
    [string] $RepoUrl = 'https://github.com/xhellot/d365fo.tools',
    [switch] $SkipAutostart,
    [switch] $UpdateModule,
    [switch] $NoElevate
)

$ErrorActionPreference = 'Stop'

$BootstrapUrl = "$($RepoUrl.TrimEnd('/'))/raw/$Branch/web-app/bootstrap.ps1"

function Write-Step {
    param ([int] $Number, [string] $Text)
    Write-Host ''
    Write-Host "[$Number/6] $Text" -ForegroundColor Cyan
}

function Test-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# GitHub and the PowerShell Gallery both refuse anything below TLS 1.2, and
# Windows PowerShell 5.1 does not negotiate it by default.
[Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# --- elevate ---------------------------------------------------------------
if (-not (Test-Elevated)) {
    if ($NoElevate) {
        throw 'Not elevated, and -NoElevate was specified. Run this from an Administrator PowerShell.'
    }

    Write-Host 'Not running as Administrator - relaunching elevated (expect a UAC prompt)...' -ForegroundColor Yellow

    $common = "-InstallPath '$InstallPath' -Port $Port -Branch '$Branch' -RepoUrl '$RepoUrl' -NoElevate"
    if ($SkipAutostart) { $common += ' -SkipAutostart' }
    if ($UpdateModule)  { $common += ' -UpdateModule' }

    if ($PSCommandPath) {
        $command = "& '$PSCommandPath' $common"
    }
    else {
        # Loaded straight from the web, so there is no file to point at: have the
        # elevated process fetch the same script again.
        $command = "& ([scriptblock]::Create((Invoke-RestMethod '$BootstrapUrl'))) $common"
    }

    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @(
        '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $command
    )

    Write-Host 'Continuing in the elevated window.' -ForegroundColor Yellow
    return
}

Write-Host ''
Write-Host '=== D365FO Web Admin Tools - machine setup ===' -ForegroundColor Green

# --- 1. Node.js ------------------------------------------------------------
Write-Step 1 'Checking Node.js'

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($node) {
    Write-Host "  Found $(node --version) at $node"
}
else {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host '  Not found. Installing via winget...'
        winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent

        # winget updates the machine PATH but not this already-running process.
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                    [Environment]::GetEnvironmentVariable('Path', 'User')
        $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    }

    if (-not $node) {
        Write-Host ''
        Write-Warning 'Node.js is required and could not be installed automatically.'
        Write-Host '  Install the LTS build from https://nodejs.org/ then re-run this script.' -ForegroundColor Yellow
        Write-Host '  (winget was unavailable or the install did not put node on PATH.)' -ForegroundColor Yellow
        exit 1
    }

    Write-Host "  Installed $(node --version)"
}

# --- 2. d365fo.tools -------------------------------------------------------
Write-Step 2 'Installing the d365fo.tools module (AllUsers)'

$existing = Get-Module -ListAvailable d365fo.tools |
    Sort-Object Version -Descending | Select-Object -First 1

if ($existing -and -not $UpdateModule) {
    Write-Host "  Already installed: $($existing.Version) at $($existing.ModuleBase)"
    if ($existing.ModuleBase -like "$env:USERPROFILE*") {
        Write-Warning '  It is in your user profile, where the SYSTEM account cannot load it.'
        Write-Host '  Re-run this script with -UpdateModule to install it for all users.' -ForegroundColor Yellow
    }
}
else {
    if (-not (Get-PackageProvider -Name NuGet -ErrorAction SilentlyContinue)) {
        Write-Host '  Bootstrapping the NuGet package provider...'
        Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force | Out-Null
    }

    Write-Host '  Installing from the PowerShell Gallery (this can take a minute)...'
    # -Force also suppresses the untrusted-repository prompt, which would
    # otherwise block a non-interactive run.
    Install-Module -Name d365fo.tools -Scope AllUsers -Force -AllowClobber

    $now = Get-Module -ListAvailable d365fo.tools |
        Sort-Object Version -Descending | Select-Object -First 1
    Write-Host "  Installed $($now.Version) at $($now.ModuleBase)"
}

# --- 3. web-app files ------------------------------------------------------
Write-Step 3 'Locating the web app'

$appDir = $null
if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot 'server\index.js'))) {
    $appDir = $PSScriptRoot
    Write-Host "  Using this clone: $appDir"
}
else {
    $zipUrl  = "$($RepoUrl.TrimEnd('/'))/archive/refs/heads/$Branch.zip"
    $zipPath = Join-Path $env:TEMP "d365fo-tools-$Branch.zip"
    $unzip   = Join-Path $env:TEMP "d365fo-tools-$Branch-extract"

    Write-Host "  Downloading $zipUrl"
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

    if (Test-Path $unzip) { Remove-Item $unzip -Recurse -Force }
    Expand-Archive -Path $zipPath -DestinationPath $unzip -Force

    $source = Get-ChildItem -Path $unzip -Directory |
        ForEach-Object { Join-Path $_.FullName 'web-app' } |
        Where-Object { Test-Path (Join-Path $_ 'server\index.js') } |
        Select-Object -First 1

    if (-not $source) {
        throw "The downloaded archive has no web-app folder with server\index.js. Wrong branch or repository?"
    }

    if (-not (Test-Path $InstallPath)) {
        New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
    }

    Write-Host "  Copying to $InstallPath"
    Copy-Item -Path (Join-Path $source '*') -Destination $InstallPath -Recurse -Force
    $appDir = $InstallPath

    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    Remove-Item $unzip -Recurse -Force -ErrorAction SilentlyContinue
}

# --- 4. npm install -------------------------------------------------------
Write-Step 4 'Installing npm dependencies'

Push-Location $appDir
try {
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }
}
finally {
    Pop-Location
}
Write-Host '  Dependencies installed.'

# --- 5. autostart ----------------------------------------------------------
Write-Step 5 'Registering automatic startup'

$setup = Join-Path $appDir 'setup-autostart.ps1'
if ($SkipAutostart) {
    Write-Host '  Skipped (-SkipAutostart).'
}
elseif (-not (Test-Path $setup)) {
    Write-Warning "  setup-autostart.ps1 not found in $appDir - skipping."
}
else {
    & $setup -Port $Port
}

# --- 6. verify ------------------------------------------------------------
Write-Step 6 'Verifying'

$health = $null
if (-not $SkipAutostart) {
    foreach ($attempt in 1..30) {
        Start-Sleep -Seconds 1
        try {
            $health = Invoke-RestMethod -Uri "http://localhost:$Port/api/health" -TimeoutSec 3
            break
        }
        catch { }
    }
}

Write-Host ''
if ($health) {
    Write-Host '=== Ready ===' -ForegroundColor Green
    Write-Host "  Open       : http://localhost:$Port"
    Write-Host "  Location   : $appDir"
    Write-Host "  Elevated   : $($health.elevated)   (must be True for Start/Stop Services)"
    Write-Host '  Starts automatically at boot.'
}
elseif ($SkipAutostart) {
    Write-Host '=== Installed (autostart skipped) ===' -ForegroundColor Green
    Write-Host "  Location   : $appDir"
    Write-Host "  Start it by hand with:  cd `"$appDir`"; npm start"
}
else {
    Write-Warning "The app did not answer on http://localhost:$Port within 30s."
    Write-Host "  Check the log: $(Join-Path $appDir 'server.log')" -ForegroundColor Yellow
}
Write-Host ''
