import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BrowserManager } from '../../core/browser.js';
import type { ScreenshotEngine } from '../../core/screenshot.js';
import { AccessibilityMapper } from '../../core/accessibility.js';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function registerNavigationTools(
  server: McpServer,
  browserManager: BrowserManager,
  screenshotEngine: ScreenshotEngine,
): void {
  server.tool(
    'browser_launch',
    'Launch a browser instance with optional viewport/device configuration',
    {
      url: z.string().url().optional().describe('Initial URL to navigate to'),
      browser: z
        .enum(['chromium', 'firefox', 'webkit'])
        .optional()
        .default('chromium')
        .describe('Browser engine'),
      headless: z.boolean().optional().default(true),
      width: z.number().min(320).max(1280).optional().describe('Viewport width'),
      height: z.number().min(480).max(720).optional().describe('Viewport height'),
      device: z
        .string()
        .optional()
        .describe(
          'Device preset with full emulation (userAgent/touch/mobile): desktop, iphone-14, iphone-14-landscape, pixel-7, ipad-pro-11',
        ),
      deviceScaleFactor: z
        .number()
        .min(1)
        .max(2)
        .optional()
        .describe('Screenshot scale (1x–2x). Device presets are auto-clamped to 2x.'),
    },
    async (params) => {
      try {
        await browserManager.launch({
          browser: params.browser,
          headless: params.headless,
          viewport:
            params.width && params.height
              ? { width: params.width, height: params.height }
              : undefined,
          device: params.device,
          deviceScaleFactor: params.deviceScaleFactor,
        });

        if (params.url) {
          const page = browserManager.getActivePage();
          await page.goto(params.url, { waitUntil: 'load', timeout: 30000 });
        }

        const page = browserManager.getActivePage();
        const viewport = browserManager.getViewport();
        const result = await screenshotEngine.capture(page, viewport, true);

        return {
          content: [
            { type: 'text' as const, text: 'Browser launched successfully.' },
            { type: 'image' as const, data: result.image, mimeType: 'image/png' as const },
            ...(result.accessibilityMap
              ? [
                  {
                    type: 'text' as const,
                    text: AccessibilityMapper.formatAsText(result.accessibilityMap),
                  },
                ]
              : []),
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${getErrorMessage(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'browser_navigate',
    'Navigate the active tab to a URL',
    {
      url: z.string().url().describe('URL to navigate to'),
      waitUntil: z
        .enum(['load', 'domcontentloaded', 'networkidle'])
        .optional()
        .default('load')
        .describe('When to consider navigation complete'),
      timeout: z.number().min(1000).max(60000).optional().default(30000),
    },
    async (params) => {
      try {
        const page = browserManager.getActivePage();
        await page.goto(params.url, {
          waitUntil: params.waitUntil,
          timeout: params.timeout,
        });

        const viewport = browserManager.getViewport();
        const result = await screenshotEngine.capture(page, viewport, true);

        return {
          content: [
            { type: 'image' as const, data: result.image, mimeType: 'image/png' as const },
            ...(result.accessibilityMap
              ? [
                  {
                    type: 'text' as const,
                    text: AccessibilityMapper.formatAsText(result.accessibilityMap),
                  },
                ]
              : []),
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${getErrorMessage(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool('browser_back', 'Navigate back in browser history', {}, async () => {
    try {
      const page = browserManager.getActivePage();
      await page.goBack({ waitUntil: 'load', timeout: 30000 });
      const viewport = browserManager.getViewport();
      const result = await screenshotEngine.capture(page, viewport, true);

      return {
        content: [
          { type: 'image' as const, data: result.image, mimeType: 'image/png' as const },
          ...(result.accessibilityMap
            ? [
                {
                  type: 'text' as const,
                  text: AccessibilityMapper.formatAsText(result.accessibilityMap),
                },
              ]
            : []),
        ],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${getErrorMessage(error)}` }],
        isError: true,
      };
    }
  });

  server.tool('browser_forward', 'Navigate forward in browser history', {}, async () => {
    try {
      const page = browserManager.getActivePage();
      await page.goForward({ waitUntil: 'load', timeout: 30000 });
      const viewport = browserManager.getViewport();
      const result = await screenshotEngine.capture(page, viewport, true);

      return {
        content: [
          { type: 'image' as const, data: result.image, mimeType: 'image/png' as const },
          ...(result.accessibilityMap
            ? [
                {
                  type: 'text' as const,
                  text: AccessibilityMapper.formatAsText(result.accessibilityMap),
                },
              ]
            : []),
        ],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${getErrorMessage(error)}` }],
        isError: true,
      };
    }
  });

  server.tool('browser_close', 'Close the browser instance', {}, async () => {
    try {
      await screenshotEngine.stopRecording();
      await browserManager.close();
      return {
        content: [{ type: 'text' as const, text: 'Browser closed.' }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${getErrorMessage(error)}` }],
        isError: true,
      };
    }
  });

  server.tool(
    'browser_resize',
    "Resize the browser viewport or apply a device preset's dimensions. Note: a device preset here only changes the viewport size — userAgent, touch, mobile emulation, and deviceScaleFactor are fixed at browser_launch. Relaunch with { device } for full mobile emulation.",
    {
      width: z.number().min(320).max(1280).optional(),
      height: z.number().min(480).max(720).optional(),
      device: z
        .string()
        .optional()
        .describe(
          'Device preset (dimensions only): desktop, iphone-14, iphone-14-landscape, pixel-7, ipad-pro-11',
        ),
    },
    async (params) => {
      try {
        await browserManager.resize({
          width: params.width,
          height: params.height,
          device: params.device,
        });

        const page = browserManager.getActivePage();
        const viewport = browserManager.getViewport();
        const result = await screenshotEngine.capture(page, viewport, true);

        return {
          content: [
            { type: 'image' as const, data: result.image, mimeType: 'image/png' as const },
            ...(result.accessibilityMap
              ? [
                  {
                    type: 'text' as const,
                    text: AccessibilityMapper.formatAsText(result.accessibilityMap),
                  },
                ]
              : []),
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${getErrorMessage(error)}` }],
          isError: true,
        };
      }
    },
  );
}
