/**
 * mainfold-agent — HARNESS Browser Automation 工具注册模块
 *
 * 遵循 ESA 工具注册模式（getXxxToolDefinitions + executeXxxTool）：
 *   1. getBrowserToolDefinitions() — 返回 Function Calling 工具定义
 *   2. executeBrowserTool() — 执行 browser-automation 工具调用
 *
 * 被 chat.ts 的 executeToolCall() 导入并注册。
 * 此为 DEL-HARNESS-INTEGRATION 交付物，合同 I-BROWSER-001。
 */

import {
  navigate,
  screenshot,
  extractContent,
  fillForm,
  clickElement,
  getBrowserStatus,
  closeBrowser,
  type FillFormField,
} from '../tools/browser-automation.js';

// ══════════════════════════════════════════════════════════════════
// 工具定义（Function Calling Schema）
// ══════════════════════════════════════════════════════════════════

/**
 * 返回 browser-automation 工具定义列表，
 * 供 chat.ts 注册到 DeepSeek Function Calling。
 */
export function getBrowserToolDefinitions() {
  return [
    {
      type: 'function' as const,
      function: {
        name: 'browser_navigate',
        description: '导航到指定 URL 并返回页面标题和基本信息。首次调用时自动启动浏览器引擎（无需手动启动）。用于打开网页、验证页面可访问性。',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: '目标 URL（必需，需包含协议如 https://）',
            },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'browser_screenshot',
        description: '对指定页面进行截图，返回截图文件路径。支持全页截图和指定元素截图。',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: '目标 URL',
            },
            fullPage: {
              type: 'boolean',
              description: '是否截取全页（默认 true）',
            },
            selector: {
              type: 'string',
              description: '可选，指定元素的 CSS 选择器',
            },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'browser_extract',
        description: '从指定页面提取文本内容，支持 CSS 选择器定位。未指定选择器时自动提取页面正文。',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: '目标 URL',
            },
            selector: {
              type: 'string',
              description: '可选，CSS 选择器，如 "article"、"main"、".content"',
            },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'browser_fill_form',
        description: '在指定页面填写表单字段，可选提交。用于登录、搜索、数据录入等场景。',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: '目标 URL',
            },
            fields: {
              type: 'array',
              description: '表单字段数组，每个元素包含 selector 和 value',
              items: {
                type: 'object',
                properties: {
                  selector: { type: 'string', description: 'CSS 选择器' },
                  value: { type: 'string', description: '填入值' },
                },
                required: ['selector', 'value'],
              },
            },
            submitSelector: {
              type: 'string',
              description: '可选，提交按钮的 CSS 选择器',
            },
          },
          required: ['url', 'fields'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'browser_click',
        description: '在指定页面上点击一个元素，适用于链接跳转、按钮点击等交互。',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: '目标 URL',
            },
            selector: {
              type: 'string',
              description: '要点击的元素的 CSS 选择器',
            },
          },
          required: ['url', 'selector'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'browser_status',
        description: '查看当前浏览器自动化引擎的状态。浏览器为惰性启动——首次调用 browser_navigate 时自动启动，无需单独启动命令。',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'tool_health_check',
        description: '查看所有可用工具的列表和状态。当你不确定有哪些工具可用、或想确认某个工具是否存在时调用此工具。返回所有已注册工具的名称、类别和描述。',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'format_table',
        description: '将结构化数据格式化为 Markdown 表格。当你需要以表格形式展示数据（如测试结果、工具列表、文件清单等）时调用此工具。',
        parameters: {
          type: 'object',
          properties: {
            headers: {
              type: 'array',
              items: { type: 'string' },
              description: '表头列名数组，如 ["#", "名称", "状态"]',
            },
            rows: {
              type: 'array',
              items: {
                type: 'array',
                items: { type: 'string' },
              },
              description: '数据行数组，每行是字符串数组，如 [["1", "browser_navigate", "✅ 可用"]] ',
            },
            title: {
              type: 'string',
              description: '可选，表格标题',
            },
          },
          required: ['headers', 'rows'],
        },
      },
    },
  ];
}

// ══════════════════════════════════════════════════════════════════
// 工具执行器
// ══════════════════════════════════════════════════════════════════

/**
 * 浏览器工具标签映射（用于 agent status 显示）。
 */
export const BROWSER_TOOL_LABELS: Record<string, string> = {
  browser_navigate: '浏览',
  browser_screenshot: '截图',
  browser_extract: '内容提取',
  browser_fill_form: '表单填写',
  browser_click: '点击',
  browser_status: '浏览状态',
  tool_health_check: '工具健康检查',
};

/**
 * 表格格式化：将结构化数据转换为 Markdown 表格。
 * 供 agent 生成可读的表格输出。
 */
export function formatTable(args: { headers: string[]; rows: string[][]; title?: string }): string {
  const { headers, rows, title } = args;
  if (!headers || headers.length === 0) return JSON.stringify({ error: 'headers is required and must not be empty' });
  if (!rows || rows.length === 0) return JSON.stringify({ error: 'rows is required and must not be empty' });

  const lines: string[] = [];
  if (title) lines.push(`**${title}**\n`);

  // Header row
  lines.push('| ' + headers.join(' | ') + ' |');
  // Separator
  lines.push('| ' + headers.map(() => '---').join(' | ') + ' |');
  // Data rows
  for (const row of rows) {
    // Pad row to match headers length
    const paddedRow = [...row];
    while (paddedRow.length < headers.length) paddedRow.push('');
    lines.push('| ' + paddedRow.slice(0, headers.length).join(' | ') + ' |');
  }

  return lines.join('\n');
}

/**
 * 工具健康检查：列出所有可用工具及其状态。
 * 供 agent 了解自己有哪些工具可用，避免幻觉不存在的工具。
 */
export async function getToolHealthStatus(): Promise<string> {
  const tools: Array<{ name: string; category: string; status: string; description: string }> = [];

  // Browser tools
  const browserTools = [
    { name: 'browser_navigate', desc: '导航到URL（首次调用自动启动浏览器）' },
    { name: 'browser_screenshot', desc: '页面截图' },
    { name: 'browser_extract', desc: '提取页面文本内容' },
    { name: 'browser_fill_form', desc: '填写表单' },
    { name: 'browser_click', desc: '点击页面元素' },
    { name: 'browser_status', desc: '查看浏览器状态' },
  ];
  for (const t of browserTools) {
    tools.push({ name: t.name, category: 'browser', status: 'available', description: t.desc });
  }

  // ESA tools
  const esaTools = ['esa_status', 'esa_focus', 'esa_anchor'];
  for (const name of esaTools) {
    tools.push({ name, category: 'esa', status: 'available', description: 'ESA 自注意力工具' });
  }

  // Self-scan tools
  tools.push({ name: 'self_scan', category: 'self-scan', status: 'available', description: '代码自省（支持 search/files/query 等 action）' });

  // File tools
  tools.push({ name: 'read_file', category: 'file', status: 'available', description: '读取文件（绝对路径→外部，相对路径→自身代码）' });

  // Tool health check itself
  tools.push({ name: 'tool_health_check', category: 'system', status: 'available', description: '查看所有可用工具列表和状态' });

  return JSON.stringify({
    totalTools: tools.length,
    categories: {
      browser: tools.filter(t => t.category === 'browser').length,
      esa: tools.filter(t => t.category === 'esa').length,
      'self-scan': tools.filter(t => t.category === 'self-scan').length,
      file: tools.filter(t => t.category === 'file').length,
      system: tools.filter(t => t.category === 'system').length,
    },
    tools,
    note: '所有工具均为 available 状态。如需使用，直接调用对应工具名即可。',
  }, null, 2);
}

/**
 * 执行 browser-automation 工具调用。
 * 与 executeEsaTool 模式一致，供 chat.ts 的 executeToolCall 调用。
 */
export async function executeBrowserTool(args: {
  name: string;
  arguments: Record<string, unknown>;
}): Promise<string> {
  const { name, arguments: parsedArgs } = args;

  try {
    switch (name) {
      case 'browser_navigate': {
        const url = parsedArgs.url as string;
        if (!url) return JSON.stringify({ error: 'url is required' });
        const result = await navigate(url);
        return JSON.stringify(result);
      }

      case 'browser_screenshot': {
        const url = parsedArgs.url as string;
        if (!url) return JSON.stringify({ error: 'url is required' });
        const fullPage = parsedArgs.fullPage as boolean | undefined;
        const selector = parsedArgs.selector as string | undefined;
        const result = await screenshot(url, { fullPage, selector });
        return JSON.stringify(result);
      }

      case 'browser_extract': {
        const url = parsedArgs.url as string;
        if (!url) return JSON.stringify({ error: 'url is required' });
        const selector = parsedArgs.selector as string | undefined;
        const result = await extractContent(url, selector);
        return JSON.stringify(result);
      }

      case 'browser_fill_form': {
        const url = parsedArgs.url as string;
        if (!url) return JSON.stringify({ error: 'url is required' });
        const rawFields = parsedArgs.fields as Array<{ selector: string; value: string }> | undefined;
        if (!rawFields || !Array.isArray(rawFields) || rawFields.length === 0) {
          return JSON.stringify({ error: 'fields array is required' });
        }
        const fields: FillFormField[] = rawFields.map(f => ({
          selector: f.selector,
          value: String(f.value),
        }));
        const submitSelector = parsedArgs.submitSelector as string | undefined;
        const result = await fillForm(url, fields, submitSelector);
        return JSON.stringify(result);
      }

      case 'browser_click': {
        const url = parsedArgs.url as string;
        if (!url) return JSON.stringify({ error: 'url is required' });
        const selector = parsedArgs.selector as string;
        if (!selector) return JSON.stringify({ error: 'selector is required' });
        const result = await clickElement(url, selector);
        return JSON.stringify(result);
      }

      case 'browser_status': {
        const status = await getBrowserStatus();
        return JSON.stringify(status);
      }

      case 'tool_health_check': {
        return await getToolHealthStatus();
      }

      case 'format_table': {
        const headers = parsedArgs.headers as string[];
        const rows = parsedArgs.rows as string[][];
        const title = parsedArgs.title as string | undefined;
        return formatTable({ headers, rows, title });
      }

      default:
        return JSON.stringify({ error: `Unknown browser tool: ${name}` });
    }
  } catch (err) {
    const error = err as Error;
    return JSON.stringify({ error: `Browser tool execution failed: ${error.message}` });
  }
}
