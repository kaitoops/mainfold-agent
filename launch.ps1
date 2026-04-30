#Requires -Version 5.1
# launch.ps1 — mainfold-agent 最小启动脚本
# 双击此文件，在 PowerShell 窗口中启动后端 + 前端

$ROOT = "G:\Orikarma-mainfold-navigation-mempalace-agent"
$BACKEND = "$ROOT\src\backend"
$WEBUI = "$ROOT\webui"

$ENV_FILE = "$ROOT\.env"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  mainfold-agent WebUI 启动器" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# 1. 检查 .env
if (-not (Test-Path $ENV_FILE)) {
    Write-Host "[ERROR] .env 文件不存在: $ENV_FILE" -ForegroundColor Red
    Write-Host "        请确认 DEEPSEEK_API_KEY 已配置" -ForegroundColor Red
    pause
    exit 1
}
Write-Host "[OK] .env 已找到" -ForegroundColor Green

# 2. 检查 node/npx
$nodePath = (Get-Command "node.exe" -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
    # 尝试常见路径
    $fallback = "C:\Program Files\nodejs\node.exe"
    if (Test-Path $fallback) {
        $env:Path += ";C:\Program Files\nodejs"
        Write-Host "[OK] Node.js 已找到 (fallback): $fallback" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] 找不到 node.exe！请确认 Node.js 已安装" -ForegroundColor Red
        pause
        exit 1
    }
} else {
    Write-Host "[OK] Node.js 已找到: $nodePath" -ForegroundColor Green
}

# 3. 检查后端路径
if (-not (Test-Path "$BACKEND\index.ts")) {
    Write-Host "[ERROR] 后端入口不存在: $BACKEND\index.ts" -ForegroundColor Red
    pause
    exit 1
}
Write-Host "[OK] 后端入口: $BACKEND\index.ts" -ForegroundColor Green

# 4. 检查前端路径
if (-not (Test-Path "$WEBUI\package.json")) {
    Write-Host "[ERROR] 前端项目不存在: $WEBUI\package.json" -ForegroundColor Red
    pause
    exit 1
}
Write-Host "[OK] 前端入口: $WEBUI" -ForegroundColor Green

Write-Host ""

# 5. 启动后端
Write-Host "[1/2] 启动后端 Backend..." -ForegroundColor Yellow
$backendLog = "$ROOT\backend.log"
$backendJob = Start-Process -FilePath "npx" -ArgumentList "tsx", "index.ts" -WorkingDirectory $BACKEND -WindowStyle Normal -PassThru -RedirectStandardOutput $backendLog -RedirectStandardError $backendLog
Write-Host "      进程ID: $($backendJob.Id)" -ForegroundColor Gray
Write-Host "      日志: $backendLog" -ForegroundColor Gray
Start-Sleep -Seconds 3

# 6. 启动前端
Write-Host "[2/2] 启动前端 WebUI..." -ForegroundColor Yellow
$webuiLog = "$ROOT\webui.log"
$webuiJob = Start-Process -FilePath "npx" -ArgumentList "vite", "--host", "0.0.0.0" -WorkingDirectory $WEBUI -WindowStyle Normal -PassThru -RedirectStandardOutput $webuiLog -RedirectStandardError $webuiLog
Write-Host "      进程ID: $($webuiJob.Id)" -ForegroundColor Gray
Write-Host "      日志: $webuiLog" -ForegroundColor Gray
Start-Sleep -Seconds 2

# 7. 验证
Write-Host ""
Write-Host "正在验证后端..." -ForegroundColor Yellow
try {
    $health = Invoke-WebRequest -Uri "http://localhost:8000/api/health" -TimeoutSec 3 -UseBasicParsing
    if ($health.StatusCode -eq 200) {
        Write-Host "[OK] 后端已启动: http://localhost:8000" -ForegroundColor Green
    }
} catch {
    Write-Host "[WARN] 后端未响应，请查看日志: $backendLog" -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  启动完成！" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  后端: http://localhost:8000" -ForegroundColor White
Write-Host "  前端: http://localhost:5173" -ForegroundColor White
Write-Host ""
Write-Host "日志文件:" -ForegroundColor Gray
Write-Host "  后端日志: $backendLog" -ForegroundColor Gray
Write-Host "  前端日志: $webuiLog" -ForegroundColor Gray
Write-Host ""

Start-Process "http://localhost:5173/"

Write-Host "按任意键关闭此窗口（服务将继续在后台运行）" -ForegroundColor DarkGray
pause
