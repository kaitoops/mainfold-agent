# 工具返回结构 Schema 参考

本文档描述每个工具的返回结构，供 agent 理解工具输出格式。

---

## Browser 工具

### browser_status
```json
{
  "launched": boolean,      // 浏览器是否已启动
  "launchCount": number,    // 启动次数
  "isConnected": boolean    // 是否连接中
}
```
**注意**：直接返回对象，无 `data` 包装层。

### browser_navigate
```json
{
  "success": boolean,
  "data": {
    "title": string,        // 页面标题
    "url": string,          // 最终 URL
    "contentLength": number,// 页面内容长度
    "statusCode": number    // HTTP 状态码
  },
  "durationMs": number      // 耗时（毫秒）
}
```

### browser_screenshot
```json
{
  "success": boolean,
  "data": {
    "success": boolean,
    "path": string,         // 截图文件路径
    "width": number,
    "height": number
  },
  "durationMs": number
}
```

### browser_extract
```json
{
  "success": boolean,
  "data": {
    "title": string,
    "content": string,      // 提取的文本内容
    "metaDescription": string,
    "url": string
  },
  "durationMs": number
}
```

### browser_fill_form / browser_click
```json
{
  "success": boolean,
  "data": { ... },          // 操作结果
  "durationMs": number
}
```

---

## ESA 工具

### esa_status / esa_focus / esa_anchor
返回 JSON 字符串，包含 ESA 状态信息。

---

## Self-Scan 工具

### self_scan (action=search)
```json
{
  "keyword": string,
  "matchCount": number,
  "results": [
    {
      "path": string,
      "type": string,
      "lines": number,
      "exports": string[],
      "purpose": string,
      "matchFields": string[]  // 匹配的字段类型
    }
  ]
}
```

### self_scan (action=stats)
```json
{
  "totalFiles": number,
  "totalLines": number,
  "totalSizeKB": number,
  "modules": Record<string, number>,
  "topFiles": Array<{ path: string; lines: number }>
}
```

---

## 工具健康检查

### tool_health_check
```json
{
  "totalTools": number,
  "categories": {
    "browser": number,
    "esa": number,
    "self-scan": number,
    "file": number,
    "system": number
  },
  "tools": [
    {
      "name": string,
      "category": string,
      "status": "available",
      "description": string
    }
  ],
  "note": string
}
```

---

## 表格格式化

### format_table
输入：
```json
{
  "headers": ["列1", "列2"],
  "rows": [["值1", "值2"]],
  "title": "可选标题"
}
```
输出：Markdown 表格文本

---

## 关键区别

| 工具 | 返回格式 | 注意事项 |
|------|----------|----------|
| `browser_status` | 直接对象 `{launched, launchCount, isConnected}` | **无** `data` 包装 |
| `browser_navigate` | `BrowserResult<NavigateResult>` 有 `data` 包装 | 有 `success` 和 `data` 字段 |
| `browser_screenshot` | `BrowserResult<ScreenshotResult>` 有 `data` 包装 | 同上 |
| `browser_extract` | `BrowserResult<ExtractResult>` 有 `data` 包装 | 同上 |
| `tool_health_check` | 直接对象 | 无包装 |
| `self_scan` | JSON 字符串 | 需要 JSON.parse |
