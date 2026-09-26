@echo off
for %%I in ("%~dp0..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
title CLIProxyAPI - Antigravity OAuth Login

echo ===================================================
echo   Starting Antigravity OAuth Login...
echo ===================================================
echo.
echo Opening browser for OAuth authorization...
echo Please log in to your Google account in the browser.
echo Once authorized, credentials are saved to auth-dir.
echo.

if not defined CLIPROXY_BIN if exist "%PROJECT_ROOT%\cli-proxy-api.exe" set "CLIPROXY_BIN=%PROJECT_ROOT%\cli-proxy-api.exe"
if not defined CLIPROXY_BIN (
  where cli-proxy-api.exe >nul 2>&1
  if not errorlevel 1 set "CLIPROXY_BIN=cli-proxy-api.exe"
)
if not defined CLIPROXY_BIN (
  echo [錯誤] 找不到 CLIProxyAPI。請放在專案資料夾、PATH，或設定 CLIPROXY_BIN。
  pause
  exit /b 1
)

"%CLIPROXY_BIN%" --antigravity-login
set "LOGIN_EXIT=%ERRORLEVEL%"

echo.
echo ===================================================
echo OAuth process completed. Press any key to exit.
echo ===================================================
pause
exit /b %LOGIN_EXIT%
