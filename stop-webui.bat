@echo off
chcp 65001 >nul
title mainfold-agent Stopper

echo ================================================
echo   mainfold-agent 停止服务
echo ================================================
echo.

taskkill /fi "WINDOWTITLE eq mainfold-backend" /f >nul 2>&1
if %errorlevel% equ 0 ( echo [OK] 后端已停止 ) else ( echo [--] 后端未运行 )

taskkill /fi "WINDOWTITLE eq mainfold-webui" /f >nul 2>&1
if %errorlevel% equ 0 ( echo [OK] 前端已停止 ) else ( echo [--] 前端未运行 )

echo.
echo 服务已全部停止。
pause
