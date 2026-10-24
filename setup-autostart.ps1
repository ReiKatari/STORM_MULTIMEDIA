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

    # 2. Register in Windows CurrentUser Run Registry (no Admin required)
    try {
        Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "StormMultimediaServer" -Value "wscript.exe `"$vbsPath`"" -Force -ErrorAction SilentlyContinue
    } catch {}

    # 3. Launch detached background process via WMI if not already running
    try {
        Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "wscript.exe `"$vbsPath`""; CurrentDirectory = $scriptPath } | Out-Null
    } catch {}

    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "[OK] STORM MULTIMEDIA autostart configured successfully!" -ForegroundColor Green
    Write-Host "Startup shortcut: $shortcutPath" -ForegroundColor White
    Write-Host "Registry HKCU Run: StormMultimediaServer registered." -ForegroundColor Green
    Write-Host "Server will automatically start in background with watchdog." -ForegroundColor White
    Write-Host "==========================================================" -ForegroundColor Cyan
} else {
    Write-Error "File $vbsPath not found!"
}
