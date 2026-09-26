@echo off
chcp 65001 >nul
setlocal EnableExtensions
for %%I in ("%~dp0..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
set "CLIPROXY_AUTO_START=1"

if not exist ".env.local" (
  if exist ".env.local.example" (
    copy ".env.local.example" ".env.local" >nul
  )
)

if not exist "node_modules\" (
  echo [提示] 尚未安裝依賴，正在執行 npm install...
  call npm install
  if errorlevel 1 (
    echo [錯誤] npm install 失敗，請確認 Node.js 與網路連線。
    pause
    exit /b 1
  )
  echo.
)

set "CLIPROXY_BIN=%CLIPROXY_BIN%"
if not defined CLIPROXY_BIN set "CLIPROXY_BIN=cli-proxy-api.exe"

if /I "%~1"=="codex-login" goto codex_login
if /I "%~1"=="antigravity-login" goto antigravity_login
if /I "%~1"=="management" goto management

echo [AI審圖老師] 檢查本機前端是否已啟動...
powershell.exe -NoProfile -Command "try { $null = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 5; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto ready

echo [AI審圖老師] 啟動本機 Next.js 前端...
start "AI審圖老師" /D "%PROJECT_ROOT%" "%ComSpec%" /k "npm run dev"

echo [AI審圖老師] 等待前端與本機 API 準備完成...
set "WAIT_ATTEMPTS=0"
:wait_for_frontend
powershell.exe -NoProfile -Command "try { $null = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto ready
set /a WAIT_ATTEMPTS+=1
if %WAIT_ATTEMPTS% GEQ 60 goto frontend_failed
powershell.exe -NoProfile -Command "Start-Sleep -Seconds 1" >nul 2>&1
goto wait_for_frontend

:frontend_failed
echo [錯誤] 等待前端逾時。請查看 AI審圖老師視窗中的錯誤訊息。
pause
exit /b 1

:ready
echo [AI審圖老師] 前端已就緒，CLIProxyAPI 會在背景自動啟動。
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
if exist "%PROJECT_ROOT%\cli-proxy-api.exe" (
  set "CLIPROXY_BIN=%PROJECT_ROOT%\cli-proxy-api.exe"
  exit /b 0
)
if exist "%CLIPROXY_BIN%" exit /b 0
where "%CLIPROXY_BIN%" >nul 2>&1
if not errorlevel 1 exit /b 0
exit /b 1
