@echo off
for %%I in ("%~dp0..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
title CLIProxyAPI Service (Port 8317)

echo ===================================================
echo   Starting CLIProxyAPI Service on Port 8317...
echo ===================================================
echo.
echo Service URL: http://127.0.0.1:8317
echo Web Management: http://127.0.0.1:8317/management.html
echo.
echo Keep this window open while using AI Teacher.
echo.

powershell.exe -NoProfile -Command "$client = New-Object System.Net.Sockets.TcpClient; try { $client.Connect('127.0.0.1',8317); exit 0 } catch { exit 1 } finally { $client.Dispose() }" >nul 2>&1
if not errorlevel 1 (
  echo CLIProxyAPI is already running. Opening the management center.
  start "" "http://127.0.0.1:8317/management.html"
  pause
  exit /b 0
)

if not defined CLIPROXY_BIN if exist "%PROJECT_ROOT%\cli-proxy-api.exe" set "CLIPROXY_BIN=%PROJECT_ROOT%\cli-proxy-api.exe"
if not defined CLIPROXY_BIN (
  where cli-proxy-api.exe >nul 2>&1
  if not errorlevel 1 set "CLIPROXY_BIN=cli-proxy-api.exe"
)
if not defined CLIPROXY_BIN (
  echo [ERROR] CLIProxyAPI was not found. Set CLIPROXY_BIN or place the executable in this folder or PATH.
  pause
  exit /b 1
)

"%CLIPROXY_BIN%"

pause
