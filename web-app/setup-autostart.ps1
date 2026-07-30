<#
    .SYNOPSIS
        Registers the D365FO web app to start automatically at boot.

    .DESCRIPTION
        Creates a scheduled task that runs the web app as the SYSTEM account at
        system startup. SYSTEM is always elevated, which is required: without
        elevation the D365 service cmdlets cannot start or stop services.

        No login is needed - the app is running before anyone signs in, and it
        keeps running after they sign out.

        Run this once from an elevated PowerShell window. Registering a task that
        runs as SYSTEM requires Administrator rights.

    .PARAMETER Port
        Port to listen on. Default 3000.

    .PARAMETER BindAddress
        Address to bind. Leave unset (the default) and the app binds both loopback
        addresses, 127.0.0.1 and ::1, so it is reachable only from this machine.
        Only set this if you accept that the API has no authentication and can
        stop services and overwrite databases.

    .PARAMETER Remove
        Stops the app and unregisters the task.

    .EXAMPLE
        PS C:\> .\setup-autostart.ps1

        Installs the task, starts it, and verifies the app responds.

    .EXAMPLE
        PS C:\> .\setup-autostart.ps1 -Remove

        Stops the app and removes the task.
#>
[CmdletBinding()]
param (
    [int] $Port = 3000,

    # Not named -Host: $Host is a read-only PowerShell automatic variable.
    # Empty means "don't set HOST", letting the app bind both loopback families.
    # Pinning a single IPv4 address here would leave ::1 unserved, and clients
    # that resolve localhost to ::1 without falling back could not connect.
    [string] $BindAddress = '',

    [switch] $Remove
)

$ErrorActionPreference = 'Stop'

$TaskName = 'D365FO Web Admin Tools'
$appDir   = $PSScriptRoot
$launcher = Join-Path $appDir 'start-server.cmd'
$logPath  = Join-Path $appDir 'server.log'

function Test-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Stop-PortListener {
    param ([int] $OnPort)
    Get-NetTCPConnection -LocalPort $OnPort -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

if (-not (Test-Elevated)) {
    Write-Host ''
    Write-Warning 'This script must run elevated.'
    Write-Host '  Right-click PowerShell -> Run as Administrator, then run it again.' -ForegroundColor Yellow
    Write-Host ''
    exit 1
}

# --- removal ---------------------------------------------------------------
if ($Remove) {
    if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
        Write-Host "Task '$TaskName' is not registered - nothing to remove."
        exit 0
    }

    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false

    # Stopping the task does not always reap the node process it started.
    Stop-PortListener -OnPort $Port

    Write-Host "Removed '$TaskName'. The app will no longer start automatically." -ForegroundColor Green
    exit 0
}

# --- preflight -------------------------------------------------------------
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node.exe was not found on PATH. Install Node.js first.' }

$entry = Join-Path $appDir 'server\index.js'
if (-not (Test-Path $entry)) {
    throw "Cannot find $entry. Run this script from inside the web-app folder."
}

if (-not (Test-Path (Join-Path $appDir 'node_modules'))) {
    throw "Dependencies are missing. Run 'npm install' in $appDir first."
}

$module = Get-Module -ListAvailable d365fo.tools | Select-Object -First 1
if (-not $module) {
    Write-Warning 'd365fo.tools was not found. Install it for all users so SYSTEM can load it:'
    Write-Host '    Install-Module d365fo.tools -Scope AllUsers' -ForegroundColor Yellow
}
elseif ($module.ModuleBase -like "$env:USERPROFILE*") {
    # SYSTEM has a different profile and cannot see modules under this user's.
    Write-Warning 'd365fo.tools is installed inside your user profile:'
    Write-Host "    $($module.ModuleBase)" -ForegroundColor Yellow
    Write-Host '  SYSTEM cannot load it from there. Reinstall it for all users:' -ForegroundColor Yellow
    Write-Host '    Install-Module d365fo.tools -Scope AllUsers -Force' -ForegroundColor Yellow
}

# Something already holding the port would make the task fail quietly at boot.
$inUse = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($inUse) {
    $owner = Get-Process -Id $inUse[0].OwningProcess -ErrorAction SilentlyContinue
    Write-Warning "Port $Port is already in use by PID $($inUse[0].OwningProcess) ($($owner.ProcessName))."
    Write-Host '  Stop that process first, or pass a different -Port.' -ForegroundColor Yellow
    exit 1
}

# --- launcher --------------------------------------------------------------
# A .cmd file rather than a quoted "cmd /c ..." task argument: nesting quotes
# around paths containing spaces inside a task argument is easy to get wrong,
# and this is also editable and runnable by hand for troubleshooting.
$hostLine = if ($BindAddress) {
    "set HOST=$BindAddress"
}
else {
    'REM HOST intentionally unset: the app then binds 127.0.0.1 and ::1 only.'
}

$launcherBody = @"
@echo off
REM Generated by setup-autostart.ps1 - edit that script and re-run to regenerate.
cd /d "%~dp0"
set PORT=$Port
$hostLine

REM Keep one previous log so a restart does not erase why the last run died.
if exist "server.log" move /y "server.log" "server.prev.log" >nul 2>&1

"$node" "server\index.js" >> "server.log" 2>&1
"@

Set-Content -Path $launcher -Value $launcherBody -Encoding ascii
Write-Host "Wrote launcher: $launcher"

# --- register --------------------------------------------------------------
$action    = New-ScheduledTaskAction -Execute $launcher -WorkingDirectory $appDir
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

# A long-running server must never be killed for exceeding a time limit.
$settings.ExecutionTimeLimit = 'PT0S'

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "Replacing the existing '$TaskName' task..."
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description 'Runs the D365FO web admin tools so it is available without being started by hand.' |
    Out-Null

Write-Host "Registered '$TaskName'." -ForegroundColor Green

# --- start and verify ------------------------------------------------------
Write-Host 'Starting it now...'
Start-ScheduledTask -TaskName $TaskName

$health = $null
foreach ($attempt in 1..30) {
    Start-Sleep -Seconds 1
    try {
        $health = Invoke-RestMethod -Uri "http://localhost:$Port/api/health" -TimeoutSec 3
        break
    }
    catch { }
}

Write-Host ''
if ($health) {
    Write-Host "The app is running: http://localhost:$Port" -ForegroundColor Green
    Write-Host "  elevated : $($health.elevated)   (must be True for Start/Stop Services)"
    if ($BindAddress) {
        Write-Host "  bound to : $BindAddress"
    }
    else {
        Write-Host '  bound to : 127.0.0.1 and ::1 (this machine only)'
    }
    Write-Host "  log file : $logPath"
    if (-not $health.elevated) {
        Write-Warning 'The app reports it is NOT elevated, which is unexpected under SYSTEM.'
    }
}
else {
    Write-Warning "The app did not answer on http://localhost:$Port within 30s."
    Write-Host "  Check the log : $logPath" -ForegroundColor Yellow
    Write-Host "  Check the task: Get-ScheduledTaskInfo -TaskName '$TaskName'" -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'It will start automatically at boot from now on. Useful commands:'
Write-Host "  Get-ScheduledTaskInfo -TaskName '$TaskName'"
Write-Host "  Stop-ScheduledTask    -TaskName '$TaskName'"
Write-Host "  Start-ScheduledTask   -TaskName '$TaskName'"
Write-Host '  .\setup-autostart.ps1 -Remove     # undo everything above'
Write-Host ''
