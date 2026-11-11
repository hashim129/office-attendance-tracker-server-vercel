import { Employee, OfficeSettings } from '../types';

/**
 * Compute SHA-256 verification token matching api/auto-punch.js.
 * Does NOT expose the user's plain PIN in the downloaded .bat file, and
 * automatically invalidates if PIN or approved device binding changes.
 */
export async function computeAutoStartToken(employee: Employee): Promise<string> {
  const raw = `${employee.id}|${employee.pin}|${employee.registeredDeviceId || 'UNBOUND'}|OFFICE_AUTO_V1`;
  const encoder = new TextEncoder();
  const data = encoder.encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sanitizeSafeAscii(input: string): string {
  return String(input || '')
    .replace(/[()"`$&|<>^%!]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function sanitizeFilename(input: string): string {
  return String(input || 'Employee')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Trigger browser file download with Windows CRLF line endings (\r\n)
 */
export function downloadWindowsBatFile(filename: string, rawContent: string): void {
  const crlfContent = rawContent.replace(/\r?\n/g, '\r\n');
  const blob = new Blob([crlfContent], { type: 'application/x-msdownload;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.bat') ? filename : `${filename}.bat`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Generates a personalized Windows .bat installer & background auto-check-in launcher
 * for an individual employee's bound Windows PC.
 */
export async function generateEmployeeAutoStartBat(params: {
  employee: Employee;
  appUrl: string;
  companyName: string;
}): Promise<{ filename: string; content: string }> {
  const { employee, appUrl, companyName } = params;
  const authToken = await computeAutoStartToken(employee);
  const cleanUrl = appUrl.replace(/\/+$/, '');
  const safeCompany = sanitizeSafeAscii(companyName || 'Office Attendance Tracker');
  const safeName = sanitizeSafeAscii(employee.name);
  const safeCode = sanitizeSafeAscii(employee.employeeCode);
  const safeDeviceId = sanitizeSafeAscii(employee.registeredDeviceId || '');

  const batContent = `@echo off
setlocal EnableExtensions DisableDelayedExpansion
title ${safeCompany} - Windows Auto-Attendance Installer - ${safeName}
color 0B

set "APP_DIR=%LOCALAPPDATA%\\OfficeAttendanceTracker"
set "REG_KEY=HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
set "REG_NAME=OfficeAttendanceAutoStart"
set "SELF_BAT=%~f0"

:MENU
cls
echo ============================================================================
echo   ${safeCompany} - Automated Startup Attendance Setup
echo ============================================================================
echo   Employee : ${safeName} - ${safeCode}
echo   Server   : ${cleanUrl}
echo   Bound ID : ${safeDeviceId || 'Admin Bypass / Unbound'}
echo ============================================================================
echo.
echo   Select an installation option:
echo.
echo     [1] Install Auto-Start + Silent Check-In + Open App Window (Recommended)
echo         - Automatically marks Time In when Windows starts/logs in
echo         - Shows confirmation popup and opens the Attendance Portal window
echo.
echo     [2] Install 100%% Silent Auto Check-In ONLY (Tray Popup Only)
echo         - Marks Time In silently at Windows login with tray notification
echo         - Does NOT open a browser window automatically
echo.
echo     [3] Test Automated Check-In Now (Without Re-Installing)
echo.
echo     [4] Uninstall Auto-Start from This PC
echo.
echo     [5] Exit
echo.
set /p CHOICE="Enter choice [1-5] (Default 1): "
if "%CHOICE%"=="" set "CHOICE=1"

if "%CHOICE%"=="1" (
  set "OPEN_PORTAL=true"
  goto INSTALL
)
if "%CHOICE%"=="2" (
  set "OPEN_PORTAL=false"
  goto INSTALL
)
if "%CHOICE%"=="3" goto TEST_NOW
if "%CHOICE%"=="4" goto UNINSTALL
if "%CHOICE%"=="5" exit /b 0
goto MENU

:INSTALL
echo.
echo [1/4] Creating installation folder: "%APP_DIR%"
if not exist "%APP_DIR%" mkdir "%APP_DIR%"

echo [2/4] Writing configuration and automation engine...
(
  echo {
  echo   "appUrl": "${cleanUrl}",
  echo   "companyName": "${safeCompany}",
  echo   "employeeId": "${sanitizeSafeAscii(employee.id)}",
  echo   "employeeCode": "${safeCode}",
  echo   "employeeName": "${safeName}",
  echo   "deviceId": "${safeDeviceId}",
  echo   "authToken": "${authToken}",
  echo   "openPortal": %OPEN_PORTAL%
  echo }
) > "%APP_DIR%\\config.json"

set "TARGET_PS=%APP_DIR%\\auto_attendance.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$raw=[System.IO.File]::ReadAllText($env:SELF_BAT); $parts=$raw -split '::##PS_START##\\r?\\n',2; if($parts.Length -eq 2){[System.IO.File]::WriteAllText($env:TARGET_PS, $parts[1], (New-Object System.Text.UTF8Encoding($false)))}"

if not exist "%APP_DIR%\\auto_attendance.ps1" (
  echo ERROR: Failed to extract PowerShell automation script.
  pause
  goto MENU
)

(
  echo Set objShell = CreateObject^("WScript.Shell"^)
  echo psPath = objShell.ExpandEnvironmentStrings^("%LOCALAPPDATA%\\OfficeAttendanceTracker\\auto_attendance.ps1"^)
  echo cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ ^& psPath ^& """"
  echo objShell.Run cmd, 0, False
) > "%APP_DIR%\\launch_hidden.vbs"

echo [3/4] Registering Windows Startup auto-launch (no admin required)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$q=[char]34; Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name $env:REG_NAME -Value ('wscript.exe ' + $q + $env:APP_DIR + '\\launch_hidden.vbs' + $q)"

echo [4/4] Creating Desktop shortcut...
set "SHORTCUT_NAME=${safeCompany} Attendance.url"
set "PORTAL_URL=${cleanUrl}"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); if(-not $d){$d=Join-Path $env:USERPROFILE 'Desktop'}; $p=Join-Path $d $env:SHORTCUT_NAME; $c=@('[InternetShortcut]',('URL='+$env:PORTAL_URL),'IconFile=%SystemRoot%\\System32\\SHELL32.dll','IconIndex=20') -join [Environment]::NewLine; [System.IO.File]::WriteAllText($p,$c,(New-Object System.Text.UTF8Encoding($false)))"

echo.
echo ============================================================================
echo   SUCCESS! Automated Startup Attendance is now ACTIVE on this PC.
echo ============================================================================
echo   - Runs automatically every time you turn on Windows or sign in.
echo   - Enforces Office Wi-Fi & Device Security (will not punch from home).
echo   - Log file saved to: "%APP_DIR%\\startup.log"
echo.
echo Running initial verification check now...
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%\\auto_attendance.ps1"
echo.
pause
exit /b 0

:TEST_NOW
if not exist "%APP_DIR%\\auto_attendance.ps1" (
  echo.
  echo Not installed yet! Please choose option [1] or [2] first to install.
  pause
  goto MENU
)
echo.
echo Running Auto Check-In test...
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%\\auto_attendance.ps1"
echo.
echo Check "%APP_DIR%\\startup.log" for full diagnostic output.
pause
goto MENU

:UNINSTALL
echo.
echo Removing Windows Startup registration...
reg delete "%REG_KEY%" /v "%REG_NAME%" /f >nul 2>&1
if exist "%APP_DIR%" rmdir /s /q "%APP_DIR%"
set "SHORTCUT_NAME=${safeCompany} Attendance.url"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); if($d){Remove-Item (Join-Path $d $env:SHORTCUT_NAME) -Force -ErrorAction SilentlyContinue}"
del "%USERPROFILE%\\Desktop\\${safeCompany} Attendance.url" >nul 2>&1
echo.
echo Auto-Start Attendance has been completely removed from this PC.
pause
exit /b 0

::##PS_START##
$ErrorActionPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$appDir = Join-Path $env:LOCALAPPDATA 'OfficeAttendanceTracker'
$cfgPath = Join-Path $appDir 'config.json'
$logPath = Join-Path $appDir 'startup.log'

function Write-Log($msg) {
  $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  Add-Content -Path $logPath -Value "[$ts] $msg" -Encoding UTF8
}

function Show-TrayToast($title, $message, $isError = $false) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $notify = New-Object System.Windows.Forms.NotifyIcon
    $notify.Icon = [System.Drawing.SystemIcons]::Information
    $notify.BalloonTipIcon = if ($isError) { [System.Windows.Forms.ToolTipIcon]::Warning } else { [System.Windows.Forms.ToolTipIcon]::Info }
    $notify.BalloonTipTitle = $title
    $notify.BalloonTipText = $message
    $notify.Visible = $true
    $notify.ShowBalloonTip(7000)
    Start-Sleep -Seconds 3
    $notify.Dispose()
  } catch {
    # Ignore headless toast errors
  }
}

function Open-AttendancePortal($url) {
  try {
    $candidates = @(
      "$env:ProgramFiles (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "$env:ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe",
      "$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe",
      "$env:ProgramFiles (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "$env:LOCALAPPDATA\\Google\\Chrome\\Application\\chrome.exe"
    )
    $browserExe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($browserExe) {
      Start-Process -FilePath $browserExe -ArgumentList "--app=$url"
    } else {
      Start-Process $url
    }
  } catch {
    Start-Process $url
  }
}

if (-not (Test-Path $cfgPath)) {
  Write-Log 'ERROR: config.json missing.'
  exit 1
}

$cfg = Get-Content -Path $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$endpoint = "$($cfg.appUrl)/api/auto-punch"
$hostName = ([System.Uri]$cfg.appUrl).Host

Write-Log "Startup agent started for $($cfg.employeeName) ($($cfg.employeeCode))."

# Wait up to 90 seconds for Wi-Fi / LAN Internet connectivity on boot
$online = $false
for ($i = 1; $i -le 30; $i++) {
  try {
    $dnsCheck = [System.Net.Dns]::GetHostAddresses($hostName)
    if ($dnsCheck.Count -gt 0) {
      $online = $true
      break
    }
    if (Test-Connection -ComputerName $hostName -Count 1 -Quiet) {
      $online = $true
      break
    }
  } catch {
    # Still waiting for Wi-Fi
  }
  Start-Sleep -Seconds 3
}

if (-not $online) {
  Write-Log 'Network unavailable after 90s wait. Skipping auto check-in.'
  Show-TrayToast "$($cfg.companyName)" 'No internet connection detected at startup. Please open Attendance Portal once Wi-Fi connects.' $true
  exit 0
}

$bodyObj = @{
  employeeId = $cfg.employeeId
  deviceId = $cfg.deviceId
  authToken = $cfg.authToken
  machineName = $env:COMPUTERNAME
}
$jsonBody = $bodyObj | ConvertTo-Json -Compress

$respJson = $null

# Prefer native Windows curl.exe -4 so dual-stack Windows 11 PCs consistently send Office IPv4
$curlExe = "$env:SystemRoot\\System32\\curl.exe"
if (Test-Path $curlExe) {
  try {
    $tempBodyFile = Join-Path $appDir 'payload.tmp.json'
    [System.IO.File]::WriteAllText($tempBodyFile, $jsonBody, (New-Object System.Text.UTF8Encoding($false)))
    $rawCurlOut = & $curlExe -4 -sS --max-time 20 -X POST -H "Content-Type: application/json" --data-binary "@$tempBodyFile" "$endpoint" 2>$null
    Remove-Item $tempBodyFile -Force -ErrorAction SilentlyContinue
    if ($rawCurlOut) {
      $respJson = $rawCurlOut | ConvertFrom-Json
    }
  } catch {
    $respJson = $null
  }
}

# Fallback to standard PowerShell Invoke-RestMethod (supports IPv6-only networks too)
if (-not $respJson) {
  try {
    $respJson = Invoke-RestMethod -Uri $endpoint -Method Post -ContentType 'application/json' -Body $jsonBody -TimeoutSec 20
  } catch {
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      if ($stream) {
        $reader = New-Object System.IO.StreamReader($stream)
        $errBody = $reader.ReadToEnd()
        $respJson = $errBody | ConvertFrom-Json
      }
    } catch {
      Write-Log "HTTP request failed: $($_.Exception.Message)"
    }
  }
}

if ($respJson -and $respJson.ok) {
  if ($respJson.status -eq 'punched_in') {
    $msg = "Auto Clocked In at $($respJson.timeInFormatted) ($($respJson.arrivalStatus))"
    Write-Log "SUCCESS: $msg"
    Show-TrayToast "$($cfg.companyName) - Checked In" $msg $false
  } elseif ($respJson.status -eq 'already_punched') {
    $msg = "Already clocked in today at $($respJson.timeInFormatted)."
    Write-Log "INFO: $msg"
    Show-TrayToast "$($cfg.companyName) - Attendance Active" $msg $false
  }
} elseif ($respJson -and $respJson.message) {
  Write-Log "BLOCKED [$($respJson.code)]: $($respJson.message)"
  Show-TrayToast "$($cfg.companyName) - Notice" $respJson.message $true
} else {
  Write-Log 'WARNING: No valid response received from attendance server.'
}

if ($cfg.openPortal -eq $true) {
  Open-AttendancePortal $cfg.appUrl
}
exit 0
`;

  const filename = `AutoAttendance_${sanitizeFilename(safeName)}_${sanitizeFilename(safeCode)}.bat`;
  return { filename, content: batContent };
}

/**
 * Generates a universal Windows .bat startup launcher (opens Portal as a Desktop App on login)
 * Useful for Lobby Kiosk terminals or staff PCs without headless check-in credentials.
 */
export function generatePortalLauncherBat(params: {
  appUrl: string;
  companyName: string;
}): { filename: string; content: string } {
  const cleanUrl = params.appUrl.replace(/\/+$/, '');
  const safeCompany = sanitizeSafeAscii(params.companyName || 'Office Attendance Tracker');

  const batContent = `@echo off
setlocal EnableExtensions DisableDelayedExpansion
title ${safeCompany} - Windows Startup App Launcher
color 0B

set "APP_DIR=%LOCALAPPDATA%\\OfficeAttendanceLauncher"
set "REG_KEY=HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
set "REG_NAME=OfficeAttendancePortalLauncher"
set "SELF_BAT=%~f0"

:MENU
cls
echo ============================================================================
echo   ${safeCompany} - Windows Auto-Start Portal Installer
echo ============================================================================
echo   Portal URL : ${cleanUrl}
echo ============================================================================
echo.
echo     [1] Install Auto-Launch on Windows Startup + Open App Now
echo     [2] Open Attendance Portal App Now
echo     [3] Uninstall Auto-Launch from This PC
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
set "TARGET_PS=%APP_DIR%\\launch_portal.ps1"
set "PORTAL_URL=${cleanUrl}"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$raw=[System.IO.File]::ReadAllText($env:SELF_BAT); $parts=$raw -split '::##PS_START##\\r?\\n',2; if($parts.Length -eq 2){ $script=$parts[1].Replace('__PORTAL_URL__',$env:PORTAL_URL); [System.IO.File]::WriteAllText($env:TARGET_PS, $script, (New-Object System.Text.UTF8Encoding($false))) }"

(
  echo Set objShell = CreateObject^("WScript.Shell"^)
  echo psPath = objShell.ExpandEnvironmentStrings^("%LOCALAPPDATA%\\OfficeAttendanceLauncher\\launch_portal.ps1"^)
  echo cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ ^& psPath ^& """"
  echo objShell.Run cmd, 0, False
) > "%APP_DIR%\\launch_hidden.vbs"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$q=[char]34; Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name $env:REG_NAME -Value ('wscript.exe ' + $q + $env:APP_DIR + '\\launch_hidden.vbs' + $q)"

echo.
echo Installed! Attendance Tracker will auto-start cleanly on every Windows login.
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%\\launch_portal.ps1"
pause
exit /b 0

:RUN_NOW
if exist "%APP_DIR%\\launch_portal.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%\\launch_portal.ps1"
) else (
  start "" "${cleanUrl}"
)
exit /b 0

:UNINSTALL
reg delete "%REG_KEY%" /v "%REG_NAME%" /f >nul 2>&1
if exist "%APP_DIR%" rmdir /s /q "%APP_DIR%"
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
  "$env:ProgramFiles (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "$env:ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe",
  "$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe",
  "$env:ProgramFiles (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "$env:LOCALAPPDATA\\Google\\Chrome\\Application\\chrome.exe"
)
$browserExe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($browserExe) {
  Start-Process -FilePath $browserExe -ArgumentList "--app=$url"
} else {
  Start-Process $url
}
`;

  const filename = `AutoLaunch_${sanitizeFilename(safeCompany)}_Portal.bat`;
  return { filename, content: batContent };
}

/**
 * Determine if the employee can use personalized boot auto-punch (.bat)
 * vs. the universal portal launcher.
 */
export function canEmployeeAutoPunch(employee: Employee, settings: OfficeSettings): boolean {
  return (
    !!employee.registeredDeviceId ||
    employee.role === 'admin' ||
    settings.enforceDeviceBinding === false
  );
}

/**
 * Generate and trigger browser download of the matching Windows startup .bat script.
 */
export async function downloadAutoStartScriptForUser(params: {
  employee: Employee;
  settings: OfficeSettings;
  appUrl?: string;
}): Promise<'personal' | 'portal'> {
  const { employee, settings, appUrl } = params;
  const resolvedUrl = appUrl ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const companyName = settings.companyName || 'Office Attendance Tracker';
  if (canEmployeeAutoPunch(employee, settings)) {
    const { filename, content } = await generateEmployeeAutoStartBat({
      employee,
      appUrl: resolvedUrl,
      companyName,
    });
    downloadWindowsBatFile(filename, content);
    return 'personal';
  }
  const { filename, content } = generatePortalLauncherBat({
    appUrl: resolvedUrl,
    companyName,
  });
  downloadWindowsBatFile(filename, content);
  return 'portal';
}

