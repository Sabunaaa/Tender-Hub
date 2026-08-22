# Register, update, or remove the Windows Scheduled Task for the tender scraper.
# Run from an elevated PowerShell if you want the task to run whether logged on or not.

param(
    [string]$TaskName = "TenderDashboardDailyScrape",
    [string]$Times = "06:00",
    [string]$Days = "Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday",
    [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Backend = Join-Path $Root "backend"
$LogDir = Join-Path $Root "data\logs"

if ($Unregister) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed scheduled task '$TaskName'"
    } else {
        Write-Host "Scheduled task '$TaskName' was not registered"
    }
    exit 0
}

if (-not (Test-Path $Python)) {
    throw "Python venv not found at $Python. Create it first."
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$dayNames = @($Days.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($dayNames.Count -eq 0) {
    throw "At least one weekday is required."
}

[DayOfWeek[]]$dayEnums = foreach ($name in $dayNames) {
    [DayOfWeek]$name
}

$allDays = @(
    [DayOfWeek]::Monday,
    [DayOfWeek]::Tuesday,
    [DayOfWeek]::Wednesday,
    [DayOfWeek]::Thursday,
    [DayOfWeek]::Friday,
    [DayOfWeek]::Saturday,
    [DayOfWeek]::Sunday
)
$isDaily = ($dayEnums.Count -eq 7) -and -not (@($allDays | Where-Object { $dayEnums -notcontains $_ }))

$timeList = @($Times.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($timeList.Count -eq 0) {
    throw "At least one time of day is required."
}

# Task Scheduler has no multi-time daily trigger, so each time gets its own.
if ($isDaily) {
    $Trigger = foreach ($t in $timeList) { New-ScheduledTaskTrigger -Daily -At $t }
    $cadence = "daily"
} else {
    $Trigger = foreach ($t in $timeList) {
        New-ScheduledTaskTrigger -Weekly -DaysOfWeek $dayEnums -At $t
    }
    $cadence = ($dayEnums | ForEach-Object { $_.ToString().Substring(0, 3) }) -join ", "
}
$timeLabel = $timeList -join ", "

$Arg = "-m tender_scraper.cli daily"
$Action = New-ScheduledTaskAction -Execute $Python -Argument $Arg -WorkingDirectory $Backend
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

# Prefer current user interactive run so no password prompt is required.
# Bare $env:USERNAME is rejected as UserId on some Windows installs; DOMAIN\user works.
$UserId = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { [string](whoami) }
$Principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "Scrape of Georgian SPA tenders for tracked CPV categories ($cadence at $timeLabel)" `
    -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName' ($cadence at $timeLabel)"
Write-Host "Python: $Python"
Write-Host "WorkingDirectory: $Backend"
