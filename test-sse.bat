@echo off
echo === SSE 流式输出测试 ===
echo 发送请求到 http://localhost:8000/api/chat ...

curl -s -X POST http://localhost:8000/api/chat ^
  -H "Content-Type: application/json" ^
  -d "{\"message\":\"你好，请用一句话介绍你自己\",\"model\":\"deepseek-v3\",\"stream\":true,\"conversation_history\":[],\"session_id\":\"test-sse-001\"}"

echo.
echo === 测试完成 ===
pause
