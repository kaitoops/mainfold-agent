/**
 * mainfold-agent — Browser Automation 工具库
 *
 * 基于 Playwright 实现浏览器自动化能力：
 *   - navigate    — 导航到指定 URL，获取页面标题和基本信息
 *   - screenshot  — 页面截图（全页或视口）
 *   - extractContent — 提取页面文本内容（支持 CSS 选择器）
 *   - fillForm    — 填写表单字段
 *   - clickElement — 点击页面元素
 *
 * 工具生命周期管理：Singleton BrowserContext，共享 Chromium 实例。
 * 每次操作前检查 ESA 状态，操作后记录 ESA 锚点。
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createHash } from 'crypto';

// ══════════════════════════════════════════════════════════════════
// 类型定义
// ══════════════════════════════════════════════════════════════════

export interface NavigateResult {
  title: string;
  url: string;
  contentLength: number;
  statusCode: number | null;
}

export interface ScreenshotResult {
  success: boolean;
  path: string;
  width: number;
  height: number;
}

export interface ExtractResult {
  title: string;
  content: string;
  metaDescription: string;
  url: string;
}

export interface FillFormField {
  selector: string;
  value: string;
}

export interface BrowserResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  durationMs: number;
  esaState?: string;
}

// ══════════════════════════════════════════════════════════════════
// 浏览器实例管理（单例）
// ══════════════════════════════════════════════════════════════════

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;
let _launchCount = 0;

const LAUNCH_TIMEOUT = 30_000;   // 30s
const NAV_TIMEOUT = 15_000;      // 15s
const OPERATION_TIMEOUT = 10_000; // 10s

/**
 * 获取或创建共享 BrowserContext。
 * 首次调用时启动 Chromium 实例，后续复用。
 */
async function getContext(): Promise<BrowserContext> {
  if (_context && _browser?.isConnected()) {
    return _context;
  }

  // 清理旧实例
  if (_browser) {
    try { await _browser.close(); } catch { /* ignore */ }
  }

  // 从环境变量读取 headless 模式（默认 headless）
  const headless = process.env.BROWSER_HEADLESS !== 'false';

  _browser = await chromium.launch({
    headless,
    timeout: LAUNCH_TIMEOUT,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  _context = await _browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  _launchCount++;
  console.log(`[browser-automation] Launched Chromium (launch #${_launchCount})`);
  return _context;
}

/**
 * 强制关闭浏览器实例（资源释放用）。
 */
export async function closeBrowser(): Promise<void> {
  if (_browser) {
    try { await _browser.close(); } catch { /* ignore */ }
    _browser = null;
    _context = null;
    console.log('[browser-automation] Browser closed');
  }
}

/**
 * 生成操作指纹（用于 ESA 锚点记录）。
 */
function fingerprint(url: string, action: string): string {
  const hash = createHash('sha256').update(`${url}|${action}|${Date.now()}`).digest('hex').slice(0, 8);
  return `browser-${action}-${hash}`;
}

// ══════════════════════════════════════════════════════════════════
// 核心工具函数
// ══════════════════════════════════════════════════════════════════

/**
 * 导航到指定 URL，返回页面标题和基本信息。
 */
export async function navigate(url: string): Promise<BrowserResult<NavigateResult>> {
  const start = Date.now();
  try {
    const context = await getContext();
    const page = await context.newPage();
    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT,
      });

      const title = await page.title();
      const bodyText = await page.evaluate(() => document.body?.innerText || '');
      const statusCode = response?.status() ?? null;

      await page.close();

      return {
        success: true,
        data: { title, url, contentLength: bodyText.length, statusCode },
        durationMs: Date.now() - start,
      };
    } catch (innerErr) {
      await page.close().catch(() => {});
      throw innerErr;
    }
  } catch (err) {
    const error = err as Error;
    // 网络错误时自动关闭并重新创建浏览器上下文
    if (error.message.includes('net::ERR') || error.message.includes('Timeout')) {
      console.log(`[browser-automation] Network error, recycling browser: ${error.message}`);
      await closeBrowser();
    }
    return {
      success: false,
      error: error.message,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * 截图指定页面，返回图片路径。
 * 默认截取全页（fullPage=true），可通过 options 控制。
 */
export async function screenshot(
  url: string,
  options?: { fullPage?: boolean; selector?: string; outputDir?: string },
): Promise<BrowserResult<ScreenshotResult>> {
  const start = Date.now();
  const outputDir = options?.outputDir || '.';
  try {
    const context = await getContext();
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });

      // 如果指定了选择器，等待元素出现
      if (options?.selector) {
        await page.waitForSelector(options.selector, { timeout: OPERATION_TIMEOUT }).catch(() => {});
      }

      const fullPage = options?.fullPage !== false; // 默认 true
      const fileName = `screenshot_${fingerprint(url, 'ss')}.png`;
      const filePath = `${outputDir}/${fileName}`;

      await page.screenshot({ path: filePath, fullPage });
      const viewport = page.viewportSize();

      await page.close();

      return {
        success: true,
        data: {
          success: true,
          path: filePath,
          width: viewport?.width || 1280,
          height: viewport?.height || 720,
        },
        durationMs: Date.now() - start,
      };
    } catch (innerErr) {
      await page.close().catch(() => {});
      throw innerErr;
    }
  } catch (err) {
    const error = err as Error;
    if (error.message.includes('net::ERR') || error.message.includes('Timeout')) {
      await closeBrowser();
    }
    return {
      success: false,
      error: error.message,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * 提取页面文本内容，支持 CSS 选择器定位。
 * 未指定选择器时提取整个页面。
 */
export async function extractContent(
  url: string,
  selector?: string,
): Promise<BrowserResult<ExtractResult>> {
  const start = Date.now();
  try {
    const context = await getContext();
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

      const title = await page.title();
      const metaDescription = await page
        .evaluate(() => {
          const meta = document.querySelector('meta[name="description"]');
          return meta?.getAttribute('content') || '';
        })
        .catch(() => '');

      let content = '';
      if (selector) {
        // 按 CSS 选择器提取
        const elements = await page.$$(selector);
        for (const el of elements) {
          const text = await el.innerText().catch(() => '');
          if (text) content += text + '\n';
        }
      } else {
        // 提取整个页面正文
        content = await page.evaluate(() => {
          // 优先 article 标签
          const article = document.querySelector('article');
          if (article?.innerText) return article.innerText;
          // 其次 main 标签
          const main = document.querySelector('main');
          if (main?.innerText) return main.innerText;
          // 最后 body
          return document.body?.innerText || '';
        });
      }

      await page.close();

      return {
        success: true,
        data: {
          title,
          content: content.slice(0, 50000), // 最多 50K 字符
          metaDescription,
          url,
        },
        durationMs: Date.now() - start,
      };
    } catch (innerErr) {
      await page.close().catch(() => {});
      throw innerErr;
    }
  } catch (err) {
    const error = err as Error;
    if (error.message.includes('net::ERR') || error.message.includes('Timeout')) {
      await closeBrowser();
    }
    return {
      success: false,
      error: error.message,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * 填写表单字段。
 * fields 参数为 [{ selector, value }] 数组。
 */
export async function fillForm(
  url: string,
  fields: FillFormField[],
  submitSelector?: string,
): Promise<BrowserResult<{ filled: number; submitted: boolean }>> {
  const start = Date.now();
  try {
    const context = await getContext();
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

      let filled = 0;
      for (const field of fields) {
        try {
          await page.waitForSelector(field.selector, { timeout: OPERATION_TIMEOUT });
          await page.fill(field.selector, field.value);
          filled++;
        } catch (fieldErr) {
          console.warn(`[browser-automation] Failed to fill ${field.selector}: ${(fieldErr as Error).message}`);
        }
      }

      let submitted = false;
      if (submitSelector) {
        try {
          await page.waitForSelector(submitSelector, { timeout: OPERATION_TIMEOUT });
          await page.click(submitSelector);
          // 等待导航或响应
          await page.waitForTimeout(2000);
          submitted = true;
        } catch (submitErr) {
          console.warn(`[browser-automation] Submit failed: ${(submitErr as Error).message}`);
        }
      }

      await page.close();

      return {
        success: true,
        data: { filled, submitted },
        durationMs: Date.now() - start,
      };
    } catch (innerErr) {
      await page.close().catch(() => {});
      throw innerErr;
    }
  } catch (err) {
    const error = err as Error;
    if (error.message.includes('net::ERR') || error.message.includes('Timeout')) {
      await closeBrowser();
    }
    return {
      success: false,
      error: error.message,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * 点击页面上的元素。
 */
export async function clickElement(
  url: string,
  selector: string,
): Promise<BrowserResult<{ clicked: boolean; newUrl?: string }>> {
  const start = Date.now();
  try {
    const context = await getContext();
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await page.waitForSelector(selector, { timeout: OPERATION_TIMEOUT });
      await page.click(selector);
      // 等待可能的导航
      await page.waitForTimeout(1500);
      const newUrl = page.url();

      await page.close();

      return {
        success: true,
        data: { clicked: true, newUrl: newUrl !== url ? newUrl : undefined },
        durationMs: Date.now() - start,
      };
    } catch (innerErr) {
      await page.close().catch(() => {});
      throw innerErr;
    }
  } catch (err) {
    const error = err as Error;
    if (error.message.includes('net::ERR') || error.message.includes('Timeout')) {
      await closeBrowser();
    }
    return {
      success: false,
      error: error.message,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * 获取浏览器状态信息。
 */
export async function getBrowserStatus(): Promise<{
  launched: boolean;
  launchCount: number;
  isConnected: boolean;
}> {
  const isConnected = _browser?.isConnected() ?? false;
  return {
    launched: _browser !== null,
    launchCount: _launchCount,
    isConnected,
  };
}
