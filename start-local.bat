@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "CLIPROXY_BIN=%CLIPROXY_BIN%"
if not defined CLIPROXY_BIN set "CLIPROXY_BIN=cli-proxy-api.exe"

if /I "%~1"=="codex-login" goto codex_login
if /I "%~1"=="antigravity-login" goto antigravity_login
if /I "%~1"=="management" goto management

echo [AI審圖老師] 啟動本機 Next.js 前端...
start "AI審圖老師" "%ComSpec%" /k npm run dev

call :find_proxy
if not errorlevel 1 (
  echo [AI審圖老師] 啟動 CLIProxyAPI：%CLIPROXY_BIN%
  start "CLIProxyAPI" "%ComSpec%" /k ""%CLIPROXY_BIN%""
) else (
  echo [提示] 找不到 CLIProxyAPI，前端仍會啟動。
  echo       可設定 CLIPROXY_BIN=完整的 cli-proxy-api.exe 路徑後再執行。
)

timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:3000"
exit /b 0

:codex_login
call :require_proxy
if errorlevel 1 exit /b 1
echo [CLIProxyAPI] 開始 Codex OAuth；完成後請關閉此視窗或按 Ctrl+C。
"%CLIPROXY_BIN%" --codex-login
exit /b %errorlevel%

:antigravity_login
call :require_proxy
if errorlevel 1 exit /b 1
echo [CLIProxyAPI] 開始 Antigravity OAuth；完成後請關閉此視窗或按 Ctrl+C。
"%CLIPROXY_BIN%" --antigravity-login
exit /b %errorlevel%

:management
start "" "http://127.0.0.1:8317/management.html"
exit /b 0

:require_proxy
call :find_proxy
if not errorlevel 1 exit /b 0
echo [錯誤] 找不到 CLIProxyAPI。
echo        請設定 CLIPROXY_BIN=完整的 cli-proxy-api.exe 路徑。
exit /b 1

:find_proxy
if exist "%CLIPROXY_BIN%" exit /b 0
where "%CLIPROXY_BIN%" >nul 2>&1
if not errorlevel 1 exit /b 0
exit /b 1
