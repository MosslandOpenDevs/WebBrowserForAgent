import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BrowserManager } from '../../core/browser.js';
import type { ScreenshotEngine } from '../../core/screenshot.js';
import { AccessibilityMapper } from '../../core/accessibility.js';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function registerScreenshotTools(
  server: McpServer,
  browserManager: BrowserManager,
  screenshotEngine: ScreenshotEngine,
): void {
  server.tool(
    'browser_screenshot',
    'Take a screenshot of the current page, optionally with an accessibility map',
    {
      includeAccessibilityMap: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include text-based accessibility map of interactive elements'),
    },
    async (params) => {
      try {
        const page = browserManager.getActivePage();
        const viewport = browserManager.getViewport();
        const result = await screenshotEngine.capture(
          page,
          viewport,
          params.includeAccessibilityMap,
        );

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
    'browser_start_recording',
    'Start periodic screenshot recording at a given FPS (1-5)',
    {
      fps: z.number().int().min(1).max(5).describe('Frames per second (1-5)'),
      bufferSize: z
        .number()
        .int()
        .min(5)
        .max(30)
        .optional()
        .default(10)
        .describe('Ring buffer size (5-30 frames)'),
    },
    async (params) => {
      try {
        // Validate the browser is up, then let the recorder follow the active
        // tab so tab switches / closes don't leave it capturing a stale page.
        browserManager.getActivePage();
        await screenshotEngine.startRecording(() => browserManager.getActivePage(), {
          fps: params.fps,
          bufferSize: params.bufferSize,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `Recording started at ${params.fps} FPS with buffer size ${params.bufferSize}.`,
            },
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

  server.tool('browser_stop_recording', 'Stop periodic screenshot recording', {}, async () => {
    try {
      await screenshotEngine.stopRecording();
      return {
        content: [{ type: 'text' as const, text: 'Recording stopped.' }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${getErrorMessage(error)}` }],
        isError: true,
      };
    }
  });
}
