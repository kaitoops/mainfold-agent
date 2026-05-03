# test-sse.ps1 — SSE 流式输出测试脚本
$body = @{
    message = '你好，请用一句话介绍你自己'
    model = 'deepseek-v3'
    stream = $true
    conversation_history = @()
    session_id = 'test-sse-001'
} | ConvertTo-Json -Depth 3

Write-Host "=== SSE 流式输出测试 ===" -ForegroundColor Cyan
Write-Host "发送请求到 http://localhost:8000/api/chat ..." -ForegroundColor Yellow

try {
    $response = Invoke-WebRequest -Uri 'http://localhost:8000/api/chat' -Method Post -Body $body -ContentType 'application/json; charset=utf-8' -UseBasicParsing -TimeoutSec 60
    Write-Host "HTTP Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host ""
    Write-Host "=== SSE 响应内容 ===" -ForegroundColor Cyan
    Write-Host $response.Content
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}
