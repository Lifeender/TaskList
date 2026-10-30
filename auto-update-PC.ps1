<#
.SYNOPSIS
  TaskList Extension — GitHub Auto-Updater for Windows PC
.DESCRIPTION
  1. Pulls the latest changes from GitHub (`git pull --ff-only`).
  2. Optionally registers a silent Windows Scheduled Task that checks GitHub every 15 minutes
     so your unpacked Chrome extension folder stays updated automatically whenever you push to GitHub.
  3. Can also run a lightweight localhost listener on port 49152 (-Serve) so clicking
     "Pull & Reload Now" inside the New Tab page triggers an instant `git pull`.
#>

param(
    [switch]$InstallScheduledTask,
    [switch]$UninstallScheduledTask,
    [switch]$Serve
)

$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoDir

function Invoke-GitPull {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Checking GitHub for TaskList updates..." -ForegroundColor Cyan
    $beforeSha = (git rev-parse HEAD 2>$null)
    $pullOutput = (git pull --ff-only 2>&1 | Out-String).Trim()
    $afterSha = (git rev-parse HEAD 2>$null)

    if ($beforeSha -ne $afterSha) {
        Write-Host "Updated from $beforeSha to $afterSha!" -ForegroundColor Green
        Write-Host $pullOutput
        return @{ updated = $true; output = $pullOutput }
    } else {
        Write-Host "Already up to date ($afterSha)." -ForegroundColor Gray
        return @{ updated = $false; output = $pullOutput }
    }
}

$TaskName = "TaskListChromeExtensionAutoUpdater"

if ($UninstallScheduledTask) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed Windows Scheduled Task '$TaskName'." -ForegroundColor Yellow
    exit 0
}

if ($InstallScheduledTask) {
    $Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    $Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)
    $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
    Write-Host "Installed background auto-updater! Windows will silently run 'git pull' every 15 minutes." -ForegroundColor Green
    Invoke-GitPull | Out-Null
    exit 0
}

if ($Serve) {
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://127.0.0.1:49152/")
    $listener.Start()
    Write-Host "Listening on http://127.0.0.1:49152/pull for instant New Tab 'Pull & Reload' requests (Ctrl+C to stop)..." -ForegroundColor Green

    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $response = $context.Response
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

        $resData = Invoke-GitPull
        $json = $resData | ConvertTo-Json -Compress
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
        $response.ContentType = "application/json"
        $response.ContentLength64 = $buffer.Length
        $response.OutputStream.Write($buffer, 0, $buffer.Length)
        $response.OutputStream.Close()
    }
    exit 0
}

# Default one-shot execution: pull latest changes from GitHub
Invoke-GitPull | Out-Null
