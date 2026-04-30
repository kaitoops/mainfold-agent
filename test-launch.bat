@echo off
title mainfold-agent TEST LAUNCHER
set NODE=c:\Program Files\nodejs\node.exe
set NPX=c:\Program Files\nodejs\npx.cmd
set ROOT=G:\Orikarma-mainfold-navigation-mempalace-agent
echo [1] node: %NODE%
echo [2] root: %ROOT%
echo.
echo Starting backend...
start "mainfold-backend" cmd /k "cd /d %ROOT%\src\backend && %NPX% tsx index.ts"
timeout /t 3 >nul
echo Starting frontend...
start "mainfold-webui" cmd /k "cd /d %ROOT%\webui && %NPX% vite --host 0.0.0.0"
timeout /t 2 >nul
echo.
echo Open http://localhost:5173/
start http://localhost:5173/
echo.
echo All services started. Close windows to stop.
pause
