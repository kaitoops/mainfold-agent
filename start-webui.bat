@echo off
chcp 65001 >nul
title mainfold-agent WebUI Launcher
setlocal enabledelayedexpansion

echo ================================================
echo   mainfold-agent WebUI 一键启动
echo   后端 (Backend)  : port 8000
echo   前端 (WebUI)    : port 5173
echo ================================================
echo.

if not exist ".env" (
    echo [ERROR] .env 文件不存在
    pause
    exit /b 1
)

echo [1/2] 启动后端 Backend...
start "mainfold-backend" cmd /c "cd /d src\backend && npx tsx index.ts"

REM BUGFIX 2026-05-01: 用健康检测循环替代 timeout /t 3
REM 等待后端就绪（最多 30 秒，每秒检测一次）
set BACKEND_READY=0
echo [*] 等待后端就绪...
for /l %%i in (1,1,30) do (
    >nul 2>&1 curl -s http://localhost:8000/api/health
    if !errorlevel! equ 0 (
        set BACKEND_READY=1
        echo [+] 后端就绪（%%i 秒）
        goto :backend_ready
    )
    timeout /t 1 /nobreak >nul
)

:backend_ready
if !BACKEND_READY! equ 0 (
    echo [WARNING] 后端 30 秒未就绪，仍然尝试启动前端...
)

echo [2/2] 启动前端 WebUI...
start "mainfold-webui" cmd /c "cd /d webui && npx vite --host 0.0.0.0"
timeout /t 2 /nobreak >nul

echo.
start http://localhost:5173/
echo 后端: http://localhost:8000
echo 前端: http://localhost:5173
echo.
pause
