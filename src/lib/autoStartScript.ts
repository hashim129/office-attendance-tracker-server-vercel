import { Employee, OfficeSettings } from '../types';
import { getAutoStartToken } from './pinAuth';

/**
 * Compute SHA-256 verification token matching api/auto-punch.js.
 * Does NOT expose the user's plain PIN in the downloaded .bat file, and
 * automatically invalidates if the PIN changes.
 */
export async function computeAutoStartToken(employee: Employee): Promise<string> {
  if (!employee.pin) {
    // Cloud setup: the server creates the token after checking the PIN.
    const { token, error } = await getAutoStartToken(employee.id);
    if (!token) {
      if (typeof window !== 'undefined') window.alert(error || 'Could not create the startup file.');
      throw new Error(error || 'Could not create the startup file.');
    }
    return token;
  }
  const raw = `${employee.id}|${employee.pin}|OFFICE_AUTO_V1`;
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

function getShortcutFilename(safeCompany: string): string {
  const clean = safeCompany || 'Office Attendance Tracker';
  return /attendance/i.test(clean) ? `${clean}.url` : `${clean} Attendance.url`;
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
 * for an employee's office Windows PC.
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
  const shortcutName = getShortcutFilename(safeCompany);
  const safeName = sanitizeSafeAscii(employee.name);
  const safeCode = sanitizeSafeAscii(employee.employeeCode);

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
echo   Security : Office Wi-Fi / IP Verification Enabled
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
  echo   "deviceId": "WIN-AUTO-START",
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
set "SHORTCUT_NAME=${shortcutName}"
set "PORTAL_URL=${cleanUrl}"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); if(-not $d){$d=Join-Path $env:USERPROFILE 'Desktop'}; $p=Join-Path $d $env:SHORTCUT_NAME; $c=@('[InternetShortcut]',('URL='+$env:PORTAL_URL),'IconFile=%SystemRoot%\\System32\\SHELL32.dll','IconIndex=20') -join [Environment]::NewLine; [System.IO.File]::WriteAllText($p,$c,(New-Object System.Text.UTF8Encoding($false)))"

echo.
echo ============================================================================
echo   SUCCESS! Automated Startup Attendance is now ACTIVE on this PC.
echo ============================================================================
echo   - Runs automatically every time you turn on Windows or sign in.
echo   - Enforces Office Wi-Fi / IP Security (will not punch from outside office).
echo   - Log file saved to: "%APP_DIR%\\startup.log"
echo.
echo Running initial verification check now...
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%\\auto_attendance.ps1" -TestOnce
echo Starting background connectivity & activity monitor...
start "" /b wscript.exe "%APP_DIR%\\launch_hidden.vbs"
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
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%\\auto_attendance.ps1" -TestOnce
echo.
echo Check "%APP_DIR%\\startup.log" for full diagnostic output.
pause
goto MENU

:UNINSTALL
echo.
echo Removing Windows Startup registration...
reg delete "%REG_KEY%" /v "%REG_NAME%" /f >nul 2>&1
if exist "%APP_DIR%\\agent.pid" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$pf=Join-Path $env:APP_DIR 'agent.pid'; if(Test-Path $pf){$p=Get-Content $pf -ErrorAction SilentlyContinue; if($p){Stop-Process -Id ([int]$p) -Force -ErrorAction SilentlyContinue}}" >nul 2>&1
)
if exist "%APP_DIR%" rmdir /s /q "%APP_DIR%"
set "SHORTCUT_NAME=${shortcutName}"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); if($d){Remove-Item (Join-Path $d $env:SHORTCUT_NAME) -Force -ErrorAction SilentlyContinue}"
del "%USERPROFILE%\\Desktop\\${shortcutName}" >nul 2>&1
echo.
echo Auto-Start Attendance has been completely removed from this PC.
pause
exit /b 0

::##PS_START##
param([switch]$TestOnce)
$ErrorActionPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$appDir = Join-Path $env:LOCALAPPDATA 'OfficeAttendanceTracker'
$cfgPath = Join-Path $appDir 'config.json'
$logPath = Join-Path $appDir 'startup.log'
$pidPath = Join-Path $appDir 'agent.pid'

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

# Asks "Are you working extra hours?" in a separate hidden process so heartbeats keep flowing. YES pauses the automatic punch-out.
function Start-WorkConfirmPrompt($endpoint, $employeeId, $authToken, $title) {
  try {
    $q = [string][char]39
    $tpl = @'
Add-Type -AssemblyName System.Windows.Forms
$nl = [Environment]::NewLine
$msg = 'Your shift has ended. Are you working extra hours?' + $nl + $nl + 'YES = I am still working (automatic punch-out is paused).' + $nl + 'NO = I am finished (please punch out).'
$r = [System.Windows.Forms.MessageBox]::Show($msg, '__TITLE__', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
if ($r -eq [System.Windows.Forms.DialogResult]::Yes) {
  $body = @{ employeeId = '__EMP__'; authToken = '__TOK__'; source = 'windows-agent'; confirmWork = $true } | ConvertTo-Json -Compress
  try { Invoke-RestMethod -Uri '__EP__' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 20 | Out-Null } catch {}
}
'@
    $esc = { param($v) ([string]$v).Replace($q, $q + $q) }
    $cmd = $tpl.Replace('__TITLE__', (& $esc $title)).Replace('__EMP__', (& $esc $employeeId)).Replace('__TOK__', (& $esc $authToken)).Replace('__EP__', (& $esc $endpoint))
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', $enc) | Out-Null
    Write-Log 'Asked the employee whether they are working extra hours.'
  } catch {
    Write-Log "Could not show the extra-hours question: $($_.Exception.Message)"
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

function Invoke-AttendanceApi($apiUrl, $payloadObj) {
  $jsonBody = $payloadObj | ConvertTo-Json -Compress
  $curlExe = "$env:SystemRoot\\System32\\curl.exe"
  $parsed = $null

  if (Test-Path $curlExe) {
    try {
      $tempBodyFile = Join-Path $appDir ("payload_" + $PID + ".tmp.json")
      [System.IO.File]::WriteAllText($tempBodyFile, $jsonBody, (New-Object System.Text.UTF8Encoding($false)))
      $rawCurlOut = & $curlExe -4 -sS --max-time 20 -X POST -H "Content-Type: application/json" --data-binary "@$tempBodyFile" "$apiUrl" 2>$null
      Remove-Item $tempBodyFile -Force -ErrorAction SilentlyContinue
      if ($rawCurlOut) {
        $parsed = $rawCurlOut | ConvertFrom-Json
      }
    } catch {
      $parsed = $null
    }
  }

  if (-not $parsed) {
    try {
      $parsed = Invoke-RestMethod -Uri $apiUrl -Method Post -ContentType 'application/json' -Body $jsonBody -TimeoutSec 20
    } catch {
      try {
        $stream = $_.Exception.Response.GetResponseStream()
        if ($stream) {
          $reader = New-Object System.IO.StreamReader($stream)
          $errBody = $reader.ReadToEnd()
          $parsed = $errBody | ConvertFrom-Json
        }
      } catch {
        return $null
      }
    }
  }

  return $parsed
}

try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OfficeIdleTracker {
  [StructLayout(LayoutKind.Sequential)]
  struct LASTINPUTINFO {
    public uint cbSize;
    public uint dwTime;
  }
  [DllImport("user32.dll")]
  static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  public static uint GetIdleSeconds() {
    LASTINPUTINFO lii = new LASTINPUTINFO();
    lii.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
    if (!GetLastInputInfo(ref lii)) return 0;
    uint nowTicks = unchecked((uint)Environment.TickCount);
    return (uint)((nowTicks - lii.dwTime) / 1000);
  }
}
'@
} catch {
  # Fallback gracefully if runtime blocks Add-Type
}

function Get-PcIdleSeconds {
  try {
    return [int][OfficeIdleTracker]::GetIdleSeconds()
  } catch {
    return 0
  }
}

if (-not (Test-Path $cfgPath)) {
  Write-Log 'ERROR: config.json missing.'
  exit 1
}

if (-not $TestOnce) {
  if (Test-Path $pidPath) {
    $oldPid = (Get-Content $pidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($oldPid -and ([int]$oldPid -ne $PID)) {
      Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
    }
  }
  [System.IO.File]::WriteAllText($pidPath, [string]$PID, (New-Object System.Text.UTF8Encoding($false)))
}

$cfg = Get-Content -Path $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$endpoint = "$($cfg.appUrl)/api/auto-punch"
$hbEndpoint = "$($cfg.appUrl)/api/heartbeat"
$hostName = ([System.Uri]$cfg.appUrl).Host
$startDate = (Get-Date).ToString('yyyy-MM-dd')

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

$bodyObj = @{
  employeeId = $cfg.employeeId
  deviceId = $cfg.deviceId
  authToken = $cfg.authToken
  machineName = $env:COMPUTERNAME
}

$shiftCompleted = $false

if (-not $online) {
  Write-Log 'Network unavailable after 90s wait. Skipping initial auto check-in.'
  Show-TrayToast "$($cfg.companyName)" 'No internet connection detected at startup. Please open Attendance Portal once Wi-Fi connects.' $true
  if ($TestOnce) { exit 0 }
} else {
  $respJson = Invoke-AttendanceApi $endpoint $bodyObj

  if ($respJson -and $respJson.ok) {
    if ($respJson.status -eq 'punched_in') {
      $msg = "Auto Clocked In at $($respJson.timeInFormatted) ($($respJson.arrivalStatus))"
      Write-Log "SUCCESS: $msg"
      Show-TrayToast "$($cfg.companyName) - Checked In" $msg $false
    } elseif ($respJson.status -eq 'already_punched') {
      Write-Log "INFO: $($respJson.message)"
      if ($respJson.timeOut) {
        $shiftCompleted = $true
      } elseif (-not $TestOnce) {
        Show-TrayToast "$($cfg.companyName) - Attendance Active" $respJson.message $false
      }
    }
  } elseif ($respJson -and $respJson.message) {
    Write-Log "BLOCKED [$($respJson.code)]: $($respJson.message)"
    Show-TrayToast "$($cfg.companyName) - Notice" $respJson.message $true
  } else {
    Write-Log 'WARNING: No valid response received from attendance server.'
  }
}

if ($cfg.openPortal -eq $true -and -not $TestOnce) {
  Open-AttendancePortal $cfg.appUrl
} elseif ($cfg.openPortal -eq $true -and $TestOnce -and $online) {
  Open-AttendancePortal $cfg.appUrl
}

if ($TestOnce -or $shiftCompleted) {
  exit 0
}

# Continuous silent presence & activity monitor loop (pings every 45s so one missed ping never shows 'No Internet')
$wasOffline = (-not $online)
$lastWorkAsk = [DateTime]::MinValue
$didAutoPunchOnce = $online
while ($true) {
  Start-Sleep -Seconds 45
  if ((Get-Date).ToString('yyyy-MM-dd') -ne $startDate) {
    Write-Log 'Calendar day ended; background monitor stopping cleanly.'
    break
  }

  # If network was down at boot and just came up, attempt initial punch-in once
  if (-not $didAutoPunchOnce) {
    $punchRetry = Invoke-AttendanceApi $endpoint $bodyObj
    if ($punchRetry -and $punchRetry.ok) {
      $didAutoPunchOnce = $true
      $wasOffline = $false
      if ($punchRetry.timeOut) { break }
      Show-TrayToast "$($cfg.companyName) - Checked In" $punchRetry.message $false
      continue
    }
  }

  $idleSec = Get-PcIdleSeconds
  $hbObj = @{
    employeeId = $cfg.employeeId
    deviceId = $cfg.deviceId
    authToken = $cfg.authToken
    source = 'windows-agent'
    isUserActive = ($idleSec -lt 120)
    idleSeconds = $idleSec
    machineName = $env:COMPUTERNAME
  }

  $hbResp = Invoke-AttendanceApi $hbEndpoint $hbObj
  if ($hbResp -and $hbResp.ok) {
    if ($hbResp.askWorking -eq $true -and ((Get-Date) - $lastWorkAsk).TotalMinutes -ge 10) {
      $lastWorkAsk = Get-Date
      Start-WorkConfirmPrompt $hbEndpoint $cfg.employeeId $cfg.authToken "$($cfg.companyName) - Extra hours?"
    }
    if ($wasOffline) {
      Write-Log 'Internet reconnected. Attendance synced as Online.'
      Show-TrayToast "$($cfg.companyName) - Back Online" 'Internet connection restored. Attendance active.' $false
      $wasOffline = $false
    }
    if ($hbResp.state -eq 'punched_out') {
      if ($hbResp.autoPunchOutReason -eq 'shift_end_2h') {
        $outMsg = "Auto punched out at $($hbResp.timeOutFormatted) (shift ended +2 hours and no 'still working' confirmation was given)."
        Write-Log "AUTO PUNCH-OUT: $outMsg"
        Show-TrayToast "$($cfg.companyName) - Auto Punched Out" $outMsg $true
      } elseif ($hbResp.autoPunchOutReason -eq 'inactivity_2h') {
        $outMsg = "Auto punched out at $($hbResp.timeOutFormatted)."
        Write-Log "AUTO PUNCH-OUT: $outMsg"
        Show-TrayToast "$($cfg.companyName) - Auto Punched Out" $outMsg $true
      } else {
        Write-Log "Shift completed ($($hbResp.timeOutFormatted)). Background monitor stopping."
      }
      break
    }
  } elseif ($hbResp -and $hbResp.code) {
    # Server was reached but refused the ping (expired PIN token, deactivated account...). Not an internet problem.
    Write-Log "HEARTBEAT REFUSED [$($hbResp.code)]: $($hbResp.message)"
    if ($hbResp.code -eq 'TOKEN_INVALID' -or $hbResp.code -eq 'EMPLOYEE_INACTIVE') {
      if ($hbResp.code -eq 'EMPLOYEE_INACTIVE') { Write-Log 'Profile disabled by the administrator. Background monitor stopping.' }
      Show-TrayToast "$($cfg.companyName) - Notice" $hbResp.message $true
      break
    }
  } else {
    if (-not $wasOffline) {
      Write-Log 'Internet disconnect detected. Server will reflect No Internet (In) after grace window.'
      $wasOffline = $true
    }
  }
}

exit 0
`;

  const filename = `AutoAttendance_${sanitizeFilename(safeName)}_${sanitizeFilename(safeCode)}.bat`;
  return { filename, content: batContent };
}

/**
 * Generates a clean Windows .bat startup app launcher for the current Attendance Tracker.
 * Automatically starts the software when Windows boots or signs in so staff can select
 * their Employee ID / PIN and punch manually without disrupting PIN or office-network rules.
 */
export function generatePortalLauncherBat(params: {
  appUrl: string;
  companyName: string;
  employeeCode?: string;
  employeeName?: string;
}): { filename: string; content: string } {
  const cleanUrl = params.appUrl.replace(/\/+$/, '');
  const safeCompany = sanitizeSafeAscii(params.companyName || 'Office Attendance Tracker');
  const shortcutName = getShortcutFilename(safeCompany);
  const safeCode = params.employeeCode ? sanitizeSafeAscii(params.employeeCode) : '';
  const safeName = params.employeeName ? sanitizeSafeAscii(params.employeeName) : '';
  const targetUrl = safeCode
    ? `${cleanUrl}/?emp=${encodeURIComponent(safeCode)}`
    : cleanUrl;

  const batContent = `@echo off
setlocal EnableExtensions DisableDelayedExpansion
title ${safeCompany} - Windows Auto-Start App Installer
color 0B

set "APP_DIR=%LOCALAPPDATA%\\OfficeAttendanceLauncher"
set "REG_KEY=HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
set "REG_NAME=OfficeAttendancePortalLauncher"
set "SELF_BAT=%~f0"

:MENU
cls
echo ============================================================================
echo   ${safeCompany} - Windows Auto-Start Attendance Software
echo ============================================================================
echo   Portal URL : ${targetUrl}
${safeCode ? `echo   Employee   : ${safeName || safeCode} - ${safeCode}\n` : ''}echo   Punch Mode : Manual Selection by Employee ID & PIN (Startup Auto-Open)
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
set "TARGET_PS=%APP_DIR%\\launch_portal.ps1"
set "PORTAL_URL=${targetUrl}"
set "SHORTCUT_NAME=${shortcutName}"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$raw=[System.IO.File]::ReadAllText($env:SELF_BAT); $parts=$raw -split '::##PS_START##\\r?\\n',2; if($parts.Length -eq 2){ $script=$parts[1].Replace('__PORTAL_URL__',$env:PORTAL_URL); [System.IO.File]::WriteAllText($env:TARGET_PS, $script, (New-Object System.Text.UTF8Encoding($false))) }"

(
  echo Set objShell = CreateObject^("WScript.Shell"^)
  echo psPath = objShell.ExpandEnvironmentStrings^("%LOCALAPPDATA%\\OfficeAttendanceLauncher\\launch_portal.ps1"^)
  echo cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ ^& psPath ^& """"
  echo objShell.Run cmd, 0, False
) > "%APP_DIR%\\launch_hidden.vbs"

echo Registering Windows Startup auto-launch (no admin required)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$q=[char]34; Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name $env:REG_NAME -Value ('wscript.exe ' + $q + $env:APP_DIR + '\\launch_hidden.vbs' + $q); Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'OfficeAttendanceAutoStart' -ErrorAction SilentlyContinue"

echo Creating Desktop shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); if(-not $d){$d=Join-Path $env:USERPROFILE 'Desktop'}; $p=Join-Path $d $env:SHORTCUT_NAME; $c=@('[InternetShortcut]',('URL='+$env:PORTAL_URL),'IconFile=%SystemRoot%\\System32\\SHELL32.dll','IconIndex=20') -join [Environment]::NewLine; [System.IO.File]::WriteAllText($p,$c,(New-Object System.Text.UTF8Encoding($false)))"

echo.
echo ============================================================================
echo   SUCCESS! Attendance Tracker will auto-start at every Windows login.
echo ============================================================================
echo   - Punches stay manual: select your Employee ID & PIN when the window opens.
echo   - Desktop shortcut created: "%SHORTCUT_NAME%"
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%\\launch_portal.ps1"
pause
exit /b 0

:RUN_NOW
if exist "%APP_DIR%\\launch_portal.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%\\launch_portal.ps1"
) else (
  start "" "${targetUrl}"
)
exit /b 0

:UNINSTALL
reg delete "%REG_KEY%" /v "%REG_NAME%" /f >nul 2>&1
if exist "%APP_DIR%" rmdir /s /q "%APP_DIR%"
set "SHORTCUT_NAME=${shortcutName}"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); if($d){Remove-Item (Join-Path $d $env:SHORTCUT_NAME) -Force -ErrorAction SilentlyContinue}"
del "%USERPROFILE%\\Desktop\\${shortcutName}" >nul 2>&1
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

  const filename = safeCode
    ? `AutoStart_${sanitizeFilename(safeName || safeCode)}_${sanitizeFilename(safeCode)}.bat`
    : `AutoStart_${sanitizeFilename(safeCompany)}_App.bat`;
  return { filename, content: batContent };
}

/**
 * Determine if the employee can use personalized silent boot auto-punch (.bat)
 * instead of the standard manual-ID portal auto-start launcher.
 * Requires explicit Administrator opt-in (`settings.allowAutoStartPunch === true`).
 */
export function canEmployeeAutoPunch(_employee: Employee, settings: OfficeSettings): boolean {
  return settings.allowAutoStartPunch === true;
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
    employeeCode: employee.employeeCode,
    employeeName: employee.name,
  });
  downloadWindowsBatFile(filename, content);
  return 'portal';
}


