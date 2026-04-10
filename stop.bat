@echo off
setlocal

cd /d "%~dp0"

set "ROOT_DIR=%cd%"
set "TARGET_PORT=3003"
set "PID_FILE=%ROOT_DIR%\logs\active-pid.txt"
set "PORT_FILE=%ROOT_DIR%\logs\active-port.txt"
set "STOPPED_PID="

if exist "%PID_FILE%" (
    set /p STOPPED_PID=<"%PID_FILE%"
    if not "%STOPPED_PID%"=="" (
        echo Stopping process %STOPPED_PID% from active-pid.txt...
        taskkill /PID %STOPPED_PID% /T /F >nul 2>nul
    )
)

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%TARGET_PORT% .*LISTENING"') do (
    echo Stopping process %%P on port %TARGET_PORT%...
    taskkill /PID %%P /T /F >nul 2>nul
)

:cleanup
if exist "%PID_FILE%" (
    del /q "%PID_FILE%"
)

if exist "%PORT_FILE%" (
    del /q "%PORT_FILE%"
)

set "REMAINING_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%TARGET_PORT% .*LISTENING"') do (
    set "REMAINING_PID=%%P"
    goto :still_busy
)

echo Project stopped. Port %TARGET_PORT% is free.
endlocal
exit /b 0

:still_busy
echo Failed to free port %TARGET_PORT%. Remaining PID: %REMAINING_PID%
endlocal
exit /b 1
