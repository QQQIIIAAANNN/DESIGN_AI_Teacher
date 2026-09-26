@echo off
for %%I in ("%~dp0..\..") do set "PROJECT_ROOT=%%~fI"
cd /d "%PROJECT_ROOT%"
chcp 65001 >nul
title DESIGN_AI_Teacher - Git Pull 更新專案

echo ===================================================
echo   DESIGN_AI_Teacher - 專案最新進度同步工具
echo ===================================================
echo.

echo [1/3] 正在執行 git pull origin main...
git pull origin main
if errorlevel 1 goto GIT_ERROR
echo.
echo [成功] 已同步至 GitHub 遠端最新進度！
goto CHECK_NODE

:GIT_ERROR
echo.
echo [警告] git pull 執行有狀況，請檢查網路或是否有未提交變更。

:CHECK_NODE
echo.
echo [2/3] 檢查依賴套件...
if exist node_modules goto VALIDATE
echo [提示] 檢測到尚未安裝依賴，正在執行 npm install...
call npm install

:VALIDATE
echo [完成] node_modules 已準備就緒。
echo.
echo [3/3] 驗證知識庫結構 (npm run validate:knowledge)...
call npm run validate:knowledge
echo.

echo ===================================================
echo   同步完成！按任意鍵關閉此視窗。
echo ===================================================
pause
