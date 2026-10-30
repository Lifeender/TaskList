# ==============================================================================
# TaskList Extension — One-Step Windows PC Setup & Auto-Updater Installer
# ==============================================================================
$ErrorActionPreference = "Stop"
$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoDir

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  TaskList Chrome Extension — Windows PC Setup" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# Install the Windows Scheduled Task so the PC auto-pulls updates from GitHub every 15m
& "$RepoDir\auto-update-PC.ps1" -InstallScheduledTask

Write-Host ""
Write-Host "Background GitHub Auto-Updater is now active!" -ForegroundColor Green
Write-Host "Final step in Chrome (takes 10 seconds):" -ForegroundColor Yellow
Write-Host "   1. In Chrome, go to: chrome://extensions"
Write-Host "   2. Toggle 'Developer mode' ON (top-right)"
Write-Host "   3. Click 'Load unpacked' and select this folder:"
Write-Host "      $RepoDir" -ForegroundColor White
Write-Host "========================================================" -ForegroundColor Cyan

# Open Chrome convenience
Start-Process "chrome.exe" "http://extensions" -ErrorAction SilentlyContinue
