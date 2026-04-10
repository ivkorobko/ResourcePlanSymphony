@echo off
setlocal

cd /d "%~dp0"

set "ROOT_DIR=%cd%"
set "PORT=3003"
set "PHP_EXE=%ROOT_DIR%\.tools\php83\php.exe"
set "PUBLIC_DIR=%ROOT_DIR%\.symfony_tmp\public"
set "ROUTER=%PUBLIC_DIR%\index.php"
set "LOG_DIR=%ROOT_DIR%\logs"
set "LOG_OUT=%LOG_DIR%\site-%PORT%.out.log"
set "LOG_ERR=%LOG_DIR%\site-%PORT%.err.log"
set "PID_FILE=%LOG_DIR%\active-pid.txt"
set "PORT_FILE=%LOG_DIR%\active-port.txt"

if not exist "%LOG_DIR%" (
    mkdir "%LOG_DIR%"
)

if not exist "%PHP_EXE%" (
    echo Local PHP executable not found: .tools\php83\php.exe
    exit /b 1
)

if not exist "%ROUTER%" (
    echo Symfony public entrypoint not found: .symfony_tmp\public\index.php
    exit /b 1
)

call "%~dp0stop.bat" >nul 2>nul

> "%LOG_OUT%" type nul
> "%LOG_ERR%" type nul

echo Starting Resource Plan on Symfony...
echo URL: http://127.0.0.1:%PORT%
echo Logs: logs\site-%PORT%.out.log and logs\site-%PORT%.err.log

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$p = Start-Process -FilePath '%PHP_EXE%' -ArgumentList '-S','127.0.0.1:%PORT%','-t','%PUBLIC_DIR%','%ROUTER%' -WorkingDirectory '%ROOT_DIR%' -RedirectStandardOutput '%LOG_OUT%' -RedirectStandardError '%LOG_ERR%' -PassThru; " ^
    "Set-Content -Path '%PID_FILE%' -Value $p.Id -Encoding ascii; " ^
    "Set-Content -Path '%PORT_FILE%' -Value '%PORT%' -Encoding ascii"

if errorlevel 1 (
    echo Failed to start Symfony process.
    exit /b 1
)

set "START_PID="
if exist "%PID_FILE%" (
    set /p START_PID=<"%PID_FILE%"
)

if not defined START_PID (
    echo Failed to read Symfony PID.
    exit /b 1
)

echo Started Symfony PID: %START_PID%

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$deadline = (Get-Date).AddSeconds(20); " ^
    "$ready = $false; " ^
    "while ((Get-Date) -lt $deadline) { " ^
    "  if (-not (Get-Process -Id %START_PID% -ErrorAction SilentlyContinue)) { break } " ^
    "  try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { $ready = $true; break } } " ^
    "  catch { Start-Sleep -Milliseconds 500 } " ^
    "} " ^
    "if ($ready) { exit 0 } else { exit 1 }"

if errorlevel 1 (
    echo Symfony did not become ready on port %PORT%.
    call "%~dp0stop.bat" >nul 2>nul
    exit /b 1
)

echo Symfony is up on http://127.0.0.1:%PORT%
endlocal
exit /b 0
