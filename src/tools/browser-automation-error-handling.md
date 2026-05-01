# Browser Automation — 异常恢复方案

> 合同 I-BROWSER-001 | 交付物 DEL-ERROR-RECOVERY
> 状态: COMPLETED
> 日期: 2026-05-02

## 概述

本文档定义 browser-automation 工具库执行失败时的异常处理流程。
所有工具函数遵循 `BrowserResult<T>` 统一返回格式，success=false 时携带 error 信息和耗时。

---

## 异常场景与恢复策略

### 场景 1：网络错误（net::ERR\*）

**触发条件**：目标 URL 连接失败、DNS 解析失败、服务器无响应、连接重置。

**现有防护**（browser-automation.ts L162-165, L220-222, L294-296, L358-360, L401-403）：

```
if (error.message.includes('net::ERR'))
  → 自动关闭当前浏览器实例（closeBrowser()）
  → 下次调用时 getContext() 重新创建全新实例
```

**自动恢复**：
- 浏览器实例自动回收：网络错误后 `closeBrowser()` 将 `_browser` 置为 null
- 下一次 `getContext()` 检测到 `_browser === null`，自动启动新 Chromium 实例
- 该机制确保单次网络故障不会污染后续操作的状态

**手动恢复**：
```typescript
// 强制关闭后自动重建
await closeBrowser();
// 下次任意操作自动触发 getContext() 重建
```

---

### 场景 2：操作超时（Timeout）

**触发条件**：
- 页面加载超时（`NAV_TIMEOUT = 15s`）
- 元素等待超时（`OPERATION_TIMEOUT = 10s`）
- 浏览器启动超时（`LAUNCH_TIMEOUT = 30s`）

**现有防护**：

| 超时类型 | 超时值 | 触发位置 | 恢复动作 |
|---------|--------|---------|---------|
| 浏览器启动 | 30s | `chromium.launch({ timeout: LAUNCH_TIMEOUT })` | 抛出异常，由调用方重试 |
| 页面导航 | 15s | `page.goto(url, { timeout: NAV_TIMEOUT })` | 自动关闭页面 + 回收浏览器 |
| 元素等待 | 10s | `waitForSelector({ timeout: OPERATION_TIMEOUT })` | 抛出异常，单个字段跳过 |
| 导航+超时 | — | 错误消息含 `Timeout` 关键词 | 与 net::ERR 同等处理，自动回收 |

**恢复策略**：
1. **自动重试**：超时后浏览器自动回收，下一次操作从头开始
2. **局部失败**：`fillForm()` 中对单个字段的超时不会中断整体操作，仅跳过该字段
3. **渐进超时**：先等元素（10s），再提交（10s），最后等待导航（2s），层级清晰

**示例**：
```typescript
// 超时后自动回收，无需手动处理
const result = await navigate('https://slow-server.example.com');
// result.success === false
// result.error 包含 'Timeout' 字样
// 浏览器已自动关闭
```

---

### 场景 3：元素未找到（Element Not Found）

**触发条件**：
- CSS 选择器在页面中匹配不到任何元素
- 等待的 DOM 元素在超时时间内未出现
- 页面结构变化导致旧选择器失效

**现有防护**：

| 函数 | 防护策略 |
|------|---------|
| `extractContent(selector?)` | 选择器不匹配时返回空 content，不抛异常 |
| `fillForm(fields)` | 每个字段独立的 try/catch，失败仅跳过该字段 |
| `clickElement(selector)` | `waitForSelector` 超时后抛出明确错误信息 |
| `screenshot(selector?)` | 元素等待失败仅警告，仍截取当前页面 |

**恢复策略**：

| 层级 | 策略 | 示例 |
|------|------|------|
| L1 跳过 | 字段级失败不影响整体 | fillForm 中 3/5 字段填写成功 |
| L2 告警 | console.warn 记录失败详情 | `Failed to fill #username: element not found` |
| L3 降级 | 有备用数据源时使用 | extractContent 无 article → 回退 main → 回退 body |

**最佳实践建议**：
1. 优先使用稳定选择器（`data-testid`、ID），避免依赖动态 class
2. 对关键元素设置显式等待：`page.waitForSelector(selector, { timeout: 5000 })`
3. 复杂表单建议分步操作：先 navigate → 检查关键元素存在 → 再 fillForm

---

### 场景 4：Playwright 运行时异常

**触发条件**：
- Chromium 二进制丢失或损坏
- 窗口系统不可用（无头模式下较少发生）
- 并发页面竞争（单例模式下较少发生）

**现有防护**：
```typescript
// getContext() 中：
if (_context && _browser?.isConnected()) {
  return _context;  // 复用
}
// isConnected() 检测失败 → 自动重建
```

**恢复策略**：
1. **进程级隔离**：每个 `getContext()` 调用检查 `_browser.isConnected()`
2. **自动重建**：断连后自动 `close()` + `launch()`，`_launchCount` 累计
3. **状态可见**：`getBrowserStatus()` 暴露 `launched`、`launchCount`、`isConnected`

---

## 通用错误处理流程

```
操作开始
  │
  ├─ getContext() ── 浏览器未启动？ → 启动 Chromium
  │                      │
  │                      └─ 已启动但断连？ → 关闭并重新启动
  │
  ├─ 执行操作 ── 成功？ → 返回 { success: true, data }
  │      │
  │      └─ net::ERR/Timeout 错误？ → closeBrowser() + 返回错误
  │      │
  │      └─ 元素未找到？ → 跳过/降级 + 返回带警告的失败
  │      │
  │      └─ 其他异常？ → 记录错误 + 返回失败
  │
  └─ 完成
```

---

## ESA 自检锚点

每次操作自动生成 ESA 指纹：

```typescript
function fingerprint(url: string, action: string): string {
  const hash = createHash('sha256')
    .update(`${url}|${action}|${Date.now()}`)
    .digest('hex').slice(0, 8);
  return `browser-${action}-${hash}`;
}
```

错误场景下，fingerprint 用于 ESA 锚点追踪异常调用链。

---

## 外围系统依赖

| 依赖 | 版本约束 | 安装验证 |
|------|---------|---------|
| `playwright` npm 包 | ≥1.40 | `npx playwright --version` |
| Chromium 二进制 | 与 playwright 匹配 | `npx playwright install chromium` |
| 操作系统 | Windows / Linux / macOS | 无特殊要求 |

**故障排查**：
1. `browser_status` 返回 `{ launched: false }` → 从未启动，首次操作自动初始化
2. `navigate` 连续失败 → 检查网络连通性 + Chromium 二进制是否已安装
3. `screenshot` 路径问题 → 确保 `outputDir` 存在或使用默认值

---

*异常恢复方案版本 1.0 | 合同 I-BROWSER-001 | 2026-05-02*
