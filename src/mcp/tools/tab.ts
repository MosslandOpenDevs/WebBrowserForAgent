import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BrowserManager } from '../../core/browser.js';
import type { ScreenshotEngine } from '../../core/screenshot.js';
import { AccessibilityMapper } from '../../core/accessibility.js';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function registerTabTools(
  server: McpServer,
  browserManager: BrowserManager,
  screenshotEngine: ScreenshotEngine,
): void {
  server.tool('browser_list_tabs', 'List all open browser tabs', {}, async () => {
    try {
      const tabs = await browserManager.listTabs();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(tabs, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${getErrorMessage(error)}` }],
        isError: true,
      };
    }
  });

  server.tool(
    'browser_switch_tab',
    'Switch to a specific tab by index',
    {
      tabIndex: z.number().int().min(0).describe('Index of the tab to switch to'),
    },
    async (params) => {
      try {
        await browserManager.switchTab(params.tabIndex);
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

  server.tool(
    'browser_new_tab',
    'Open a new browser tab, optionally navigating to a URL',
    {
      url: z.string().url().optional().describe('URL to open in the new tab'),
    },
    async (params) => {
      try {
        const tabIndex = await browserManager.newTab(params.url);
        const page = browserManager.getActivePage();
        const viewport = browserManager.getViewport();
        const result = await screenshotEngine.capture(page, viewport, true);

        return {
          content: [
            { type: 'text' as const, text: `New tab opened at index ${tabIndex}.` },
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
    'browser_close_tab',
    'Close a specific tab or the active tab',
    {
      tabIndex: z.number().int().min(0).optional().describe('Tab to close; defaults to active tab'),
    },
    async (params) => {
      try {
        await browserManager.closeTab(params.tabIndex);

        if (!browserManager.isLaunched()) {
          return {
            content: [
              { type: 'text' as const, text: 'Last tab closed. Browser has been shut down.' },
            ],
          };
        }

        const tabs = await browserManager.listTabs();
        return {
          content: [
            { type: 'text' as const, text: `Tab closed. ${tabs.length} tab(s) remaining.` },
            { type: 'text' as const, text: JSON.stringify(tabs, null, 2) },
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
