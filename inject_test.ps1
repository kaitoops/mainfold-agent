$body = @{
    content = "回復 OK 以確認你使用的是哪個模型，以及模型的完整名稱"
    source = "manual"
    priority = 2
} | ConvertTo-Json

try {
    $resp = Invoke-WebRequest -Uri "http://localhost:8000/api/inject/pending" -Method Post -Body $body -ContentType "application/json"
    Write-Host "Status: $($resp.StatusCode)"
    Write-Host "Body: $($resp.Content)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host "Response body: $($reader.ReadToEnd())"
        $reader.Close()
    }
}
