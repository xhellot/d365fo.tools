# D365FO Web App Setup Verification Script
# This script checks if all prerequisites are installed

Write-Host "D365FO Web Admin Tools - Setup Verification" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$hasErrors = $false

# Check 1: Node.js
Write-Host "Checking Node.js..." -ForegroundColor Yellow
$nodeVersion = & node --version 2>$null
if ($nodeVersion) {
    Write-Host "✓ Node.js installed: $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "✗ Node.js not found" -ForegroundColor Red
    Write-Host "  Download from: https://nodejs.org/" -ForegroundColor Gray
    $hasErrors = $true
}

# Check 2: npm
Write-Host "Checking npm..." -ForegroundColor Yellow
$npmVersion = & npm --version 2>$null
if ($npmVersion) {
    Write-Host "✓ npm installed: $npmVersion" -ForegroundColor Green
} else {
    Write-Host "✗ npm not found" -ForegroundColor Red
    $hasErrors = $true
}

# Check 3: PowerShell version
Write-Host "Checking PowerShell..." -ForegroundColor Yellow
$psVersion = $PSVersionTable.PSVersion.Major
if ($psVersion -ge 5) {
    Write-Host "✓ PowerShell $psVersion installed" -ForegroundColor Green
} else {
    Write-Host "⚠ PowerShell $psVersion found (5.0+ recommended)" -ForegroundColor Yellow
}

# Check 4: d365fo.tools module
Write-Host "Checking d365fo.tools module..." -ForegroundColor Yellow
$d365Module = Get-Module -ListAvailable d365fo.tools 2>$null
if ($d365Module) {
    Write-Host "✓ d365fo.tools installed: $($d365Module.Version)" -ForegroundColor Green
} else {
    Write-Host "✗ d365fo.tools not found" -ForegroundColor Red
    Write-Host "  Install with: Install-Module -Name d365fo.tools" -ForegroundColor Gray
    $hasErrors = $true
}

# Check 5: Admin privileges
Write-Host "Checking for Administrator privileges..." -ForegroundColor Yellow
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if ($isAdmin) {
    Write-Host "✓ Running as Administrator" -ForegroundColor Green
} else {
    Write-Host "⚠ Not running as Administrator (some features may not work)" -ForegroundColor Yellow
    Write-Host "  Right-click PowerShell and select 'Run as administrator'" -ForegroundColor Gray
}

# Check 6: Port 3000 availability
Write-Host "Checking if port 3000 is available..." -ForegroundColor Yellow
$portInUse = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Host "⚠ Port 3000 is already in use" -ForegroundColor Yellow
    Write-Host "  Change the port in server/index.js or stop the service using port 3000" -ForegroundColor Gray
} else {
    Write-Host "✓ Port 3000 is available" -ForegroundColor Green
}

# Summary
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
if ($hasErrors) {
    Write-Host "Setup verification completed with errors" -ForegroundColor Red
    Write-Host "Please fix the errors above and try again" -ForegroundColor Red
} else {
    Write-Host "Setup verification completed successfully!" -ForegroundColor Green
    Write-Host "You can now run: npm install && npm start" -ForegroundColor Green
}
Write-Host ""
