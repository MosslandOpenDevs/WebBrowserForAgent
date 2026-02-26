import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AccessibilityMapper } from '../../core/accessibility.js';
import type { BrowserManager } from '../../core/browser.js';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function registerAccessibilityTools(
  server: McpServer,
  browserManager: BrowserManager,
  accessibilityMapper: AccessibilityMapper,
): void {
  server.tool(
    'browser_get_accessibility_map',
    'Get a text-based map of all interactive elements on the page with their coordinates and attributes',
    {},
    async () => {
      try {
        const page = browserManager.getActivePage();
        const viewport = browserManager.getViewport();
        const map = await accessibilityMapper.generateMap(page, viewport);

        return {
          content: [{ type: 'text' as const, text: AccessibilityMapper.formatAsText(map) }],
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
