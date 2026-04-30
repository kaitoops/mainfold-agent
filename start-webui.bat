@echo off
chcp 65001 >nul
title mainfold-agent WebUI Launcher

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
timeout /t 3 /nobreak >nul

echo [2/2] 启动前端 WebUI...
start "mainfold-webui" cmd /c "cd /d webui && npx vite --host 0.0.0.0"
timeout /t 2 /nobreak >nul

echo.
start http://localhost:5173/
echo 后端: http://localhost:8000
echo 前端: http://localhost:5173
echo.
pause
