# Register a daily Windows Scheduled Task for the tender scraper.
# Run from an elevated PowerShell if you want the task to run whether logged on or not.
# Default: daily at 06:00 local time, catch up if missed.

param(
    [string]$TaskName = "TenderDashboardDailyScrape",
    [string]$Time = "06:00"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Backend = Join-Path $Root "backend"
$LogDir = Join-Path $Root "data\logs"

if (-not (Test-Path $Python)) {
    throw "Python venv not found at $Python. Create it first."
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$Arg = "-m tender_scraper.cli daily"
$Action = New-ScheduledTaskAction -Execute $Python -Argument $Arg -WorkingDirectory $Backend
$Trigger = New-ScheduledTaskTrigger -Daily -At $Time
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

# Prefer current user interactive run so no password prompt is required.
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "Daily scrape of Georgian SPA tenders for tracked CPV categories" `
    -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName' to run daily at $Time"
Write-Host "Python: $Python"
Write-Host "WorkingDirectory: $Backend"
Write-Host ""
Write-Host "Useful commands:"
Write-Host "  Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
