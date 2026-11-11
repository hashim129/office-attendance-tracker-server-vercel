@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Office Attendance Tracker - Windows Auto-Start App Installer
color 0B

set "APP_DIR=%LOCALAPPDATA%\OfficeAttendanceLauncher"
set "REG_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
set "REG_NAME=OfficeAttendancePortalLauncher"
set "SELF_BAT=%~f0"

:MENU
cls
echo ============================================================================
echo   Office Attendance Tracker - Windows Auto-Start Attendance Software
echo ============================================================================
echo   Portal URL : https://office-attendance-tracker-server-ve.vercel.app
echo   Punch Mode : Manual Selection by Employee ID & PIN (Startup Auto-Open)
echo ============================================================================
echo.
echo     [1] Install Auto-Start on Windows Startup + Desktop Shortcut + Launch Now
echo     [2] Launch Attendance Tracker Window Now
echo     [3] Uninstall Auto-Start from This PC
echo     [4] Exit
echo.
set /p CHOICE="Enter choice [1-4] (Default 1): "
if "%CHOICE%"=="" set "CHOICE=1"

if "%CHOICE%"=="1" goto INSTALL
if "%CHOICE%"=="2" goto RUN_NOW
if "%CHOICE%"=="3" goto UNINSTALL
if "%CHOICE%"=="4" exit /b 0
goto MENU

:INSTALL
if not exist "%APP_DIR%" mkdir "%APP_DIR%"
set "TARGET_PS=%APP_DIR%\launch_portal.ps1"
set "PORTAL_URL=https://office-attendance-tracker-server-ve.vercel.app"
set "SHORTCUT_NAME=Office Attendance Tracker.url"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$raw=[System.IO.File]::ReadAllText($env:SELF_BAT); $parts=$raw -split '::##PS_START##\r?\n',2; if($parts.Length -eq 2){ $script=$parts[1].Replace('__PORTAL_URL__',$env:PORTAL_URL); [System.IO.File]::WriteAllText($env:TARGET_PS, $script, (New-Object System.Text.UTF8Encoding($false))) }"

(
  echo Set objShell = CreateObject^("WScript.Shell"^)
  echo psPath = objShell.ExpandEnvironmentStrings^("%LOCALAPPDATA%\OfficeAttendanceLauncher\launch_portal.ps1"^)
  echo cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ ^& psPath ^& """"
  echo objShell.Run cmd, 0, False
) > "%APP_DIR%\launch_hidden.vbs"

echo Registering Windows Startup auto-launch (no admin required)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$q=[char]34; Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name $env:REG_NAME -Value ('wscript.exe ' + $q + $env:APP_DIR + '\launch_hidden.vbs' + $q); Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'OfficeAttendanceAutoStart' -ErrorAction SilentlyContinue"

echo Creating Desktop shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); if(-not $d){$d=Join-Path $env:USERPROFILE 'Desktop'}; $p=Join-Path $d $env:SHORTCUT_NAME; $c=@('[InternetShortcut]',('URL='+$env:PORTAL_URL),'IconFile=%SystemRoot%\System32\SHELL32.dll','IconIndex=20') -join [Environment]::NewLine; [System.IO.File]::WriteAllText($p,$c,(New-Object System.Text.UTF8Encoding($false)))"

echo.
echo ============================================================================
echo   SUCCESS! Attendance Tracker will auto-start at every Windows login.
echo ============================================================================
echo   - Punches stay manual: select your Employee ID & PIN when the window opens.
echo   - Desktop shortcut created: "%SHORTCUT_NAME%"
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%\launch_portal.ps1"
pause
exit /b 0

:RUN_NOW
if exist "%APP_DIR%\launch_portal.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%\launch_portal.ps1"
) else (
  start "" "https://office-attendance-tracker-server-ve.vercel.app"
)
exit /b 0

:UNINSTALL
reg delete "%REG_KEY%" /v "%REG_NAME%" /f >nul 2>&1
if exist "%APP_DIR%" rmdir /s /q "%APP_DIR%"
set "SHORTCUT_NAME=Office Attendance Tracker.url"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); if($d){Remove-Item (Join-Path $d $env:SHORTCUT_NAME) -Force -ErrorAction SilentlyContinue}"
del "%USERPROFILE%\Desktop\Office Attendance Tracker.url" >nul 2>&1
echo Auto-launch uninstalled from this PC.
pause
exit /b 0

::##PS_START##
$url = '__PORTAL_URL__'
$hostName = ([System.Uri]$url).Host
for ($i = 1; $i -le 30; $i++) {
  try {
    $dnsCheck = [System.Net.Dns]::GetHostAddresses($hostName)
    if ($dnsCheck.Count -gt 0) { break }
  } catch {}
  Start-Sleep -Seconds 2
}
$candidates = @(
  "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles (x86)\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browserExe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($browserExe) {
  Start-Process -FilePath $browserExe -ArgumentList "--app=$url"
} else {
  Start-Process $url
}
