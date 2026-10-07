# STORM MULTIMEDIA - Setup automatic background startup for Windows
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbsPath = Join-Path $scriptPath "storm-service.vbs"
$startupDir = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs\Startup")
$shortcutPath = Join-Path $startupDir "STORM MULTIMEDIA Server.lnk"

if (Test-Path $vbsPath) {
    # 1. Register in Windows Startup folder
    $wshShell = New-Object -ComObject WScript.Shell
    $shortcut = $wshShell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = "wscript.exe"
    $shortcut.Arguments = "`"$vbsPath`""
    $shortcut.WorkingDirectory = $scriptPath
    $shortcut.Description = "STORM MULTIMEDIA Background Server with Watchdog"
    $shortcut.WindowStyle = 7
    $shortcut.Save()

    # 2. Register in Windows Task Scheduler
    $taskRegistered = $false
    try {
        $action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbsPath`"" -WorkingDirectory $scriptPath
        $trigger = New-ScheduledTaskTrigger -AtLogOn
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName "StormMultimediaServer" -Action $action -Trigger $trigger -Settings $settings -Description "STORM MULTIMEDIA Background Server with Watchdog" -Force -ErrorAction SilentlyContinue | Out-Null
        $taskRegistered = $true
    } catch {
        $taskRegistered = $false
    }

    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "[OK] STORM MULTIMEDIA autostart configured successfully!" -ForegroundColor Green
    Write-Host "Startup shortcut: $shortcutPath" -ForegroundColor White
    if ($taskRegistered) {
        Write-Host "Task Scheduler: StormMultimediaServer registered." -ForegroundColor Green
    }
    Write-Host "Server will automatically start in background with watchdog." -ForegroundColor White
    Write-Host "==========================================================" -ForegroundColor Cyan
} else {
    Write-Error "File $vbsPath not found!"
}
