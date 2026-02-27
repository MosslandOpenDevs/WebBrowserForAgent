import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BrowserManager } from '../../core/browser.js';
import type { InputController } from '../../core/input.js';
import type { ScreenshotEngine } from '../../core/screenshot.js';
import { AccessibilityMapper } from '../../core/accessibility.js';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function registerKeyboardTools(
  server: McpServer,
  browserManager: BrowserManager,
  inputController: InputController,
  screenshotEngine: ScreenshotEngine,
): void {
  server.tool(
    'browser_type',
    'Type text into the currently focused element. Click an input field first with browser_click, then use this to type.',
    {
      text: z
        .string()
        .describe('Text to type. Each character produces keydown/keypress/keyup events.'),
    },
    async (params) => {
      try {
        const page = browserManager.getActivePage();
        await inputController.type(page, params.text);

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
    'browser_key_press',
    'Press a single key (e.g., Enter, Tab, Escape, ArrowDown)',
    {
      key: z.string().describe('Key name (e.g., "Enter", "Tab", "Escape", "ArrowDown")'),
    },
    async (params) => {
      try {
        const page = browserManager.getActivePage();
        await inputController.keyPress(page, params.key);

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
    'browser_hotkey',
    'Press a key combination (e.g., Ctrl+A, Cmd+C)',
    {
      keys: z
        .array(z.string())
        .min(2)
        .describe('Keys to press simultaneously, e.g. ["Control", "a"] or ["Meta", "c"]'),
    },
    async (params) => {
      try {
        const page = browserManager.getActivePage();
        await inputController.hotkey(page, params.keys);

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
