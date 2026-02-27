import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BrowserManager } from '../../core/browser.js';
import type { InputController } from '../../core/input.js';
import type { ScreenshotEngine } from '../../core/screenshot.js';
import { AccessibilityMapper } from '../../core/accessibility.js';

const coordinateTarget = z.object({
  x: z.number().describe('X pixel coordinate'),
  y: z.number().describe('Y pixel coordinate'),
});

const elementIndexTarget = z.object({
  elementIndex: z.number().int().min(0).describe('Element index from accessibility map'),
});

const clickTargetSchema = z
  .union([coordinateTarget, elementIndexTarget])
  .describe('Target: {x, y} coordinates or {elementIndex} from accessibility map');

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function captureResult(browserManager: BrowserManager, screenshotEngine: ScreenshotEngine) {
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
}

export function registerMouseTools(
  server: McpServer,
  browserManager: BrowserManager,
  inputController: InputController,
  screenshotEngine: ScreenshotEngine,
  accessibilityMapper: AccessibilityMapper,
): void {
  server.tool(
    'browser_click',
    'Click at a position. Use {elementIndex: N} from the accessibility map, or {x, y} pixel coordinates.',
    { target: clickTargetSchema },
    async (params) => {
      try {
        const page = browserManager.getActivePage();
        const viewport = browserManager.getViewport();
        const map = await accessibilityMapper.generateMap(page, viewport);
        await inputController.click(page, params.target, map);
        // Brief wait for any state change
        await page.waitForTimeout(100);
        return await captureResult(browserManager, screenshotEngine);
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${getErrorMessage(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'browser_double_click',
    'Double-click at a position',
    { target: clickTargetSchema },
    async (params) => {
      try {
        const page = browserManager.getActivePage();
        const viewport = browserManager.getViewport();
        const map = await accessibilityMapper.generateMap(page, viewport);
        await inputController.doubleClick(page, params.target, map);
        await page.waitForTimeout(100);
        return await captureResult(browserManager, screenshotEngine);
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${getErrorMessage(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'browser_right_click',
    'Right-click at a position',
    { target: clickTargetSchema },
    async (params) => {
      try {
        const page = browserManager.getActivePage();
        const viewport = browserManager.getViewport();
        const map = await accessibilityMapper.generateMap(page, viewport);
        await inputController.rightClick(page, params.target, map);
        await page.waitForTimeout(100);
        return await captureResult(browserManager, screenshotEngine);
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${getErrorMessage(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'browser_drag',
    'Drag from one position to another',
    {
      from: clickTargetSchema.describe('Drag start position'),
      to: clickTargetSchema.describe('Drag end position'),
    },
    async (params) => {
      try {
        const page = browserManager.getActivePage();
        const viewport = browserManager.getViewport();
        const map = await accessibilityMapper.generateMap(page, viewport);
        await inputController.drag(page, { from: params.from, to: params.to }, map);
        await page.waitForTimeout(100);
        return await captureResult(browserManager, screenshotEngine);
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${getErrorMessage(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'browser_mouse_move',
    'Move the mouse to a position (hover)',
    { target: clickTargetSchema },
    async (params) => {
      try {
        const page = browserManager.getActivePage();
        const viewport = browserManager.getViewport();
        const map = await accessibilityMapper.generateMap(page, viewport);
        await inputController.mouseMove(page, params.target, map);
        return await captureResult(browserManager, screenshotEngine);
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${getErrorMessage(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'browser_scroll',
    'Scroll the page. Use deltaY=500 to scroll down, deltaY=-500 to scroll up. No target needed for basic page scrolling.',
    {
      target: clickTargetSchema
        .optional()
        .describe('Position to scroll at; defaults to viewport center'),
      deltaX: z.number().optional().default(0).describe('Horizontal scroll pixels'),
      deltaY: z.number().describe('Vertical scroll pixels (positive=down, negative=up)'),
    },
    async (params) => {
      try {
        const page = browserManager.getActivePage();
        const viewport = browserManager.getViewport();
        const map = await accessibilityMapper.generateMap(page, viewport);
        await inputController.scroll(
          page,
          { target: params.target, deltaX: params.deltaX, deltaY: params.deltaY },
          map,
        );
        await page.waitForTimeout(200);
        return await captureResult(browserManager, screenshotEngine);
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${getErrorMessage(error)}` }],
          isError: true,
        };
      }
    },
  );
}
