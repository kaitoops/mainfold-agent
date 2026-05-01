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
        description: '导航到指定 URL 并返回页面标题和基本信息。用于打开网页、验证页面可访问性。',
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
        description: '查看当前浏览器自动化引擎的状态：是否已启动、启动次数、连接状态。',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
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
};

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

      default:
        return JSON.stringify({ error: `Unknown browser tool: ${name}` });
    }
  } catch (err) {
    const error = err as Error;
    return JSON.stringify({ error: `Browser tool execution failed: ${error.message}` });
  }
}
