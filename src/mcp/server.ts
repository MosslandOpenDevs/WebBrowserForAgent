#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequire } from 'module';

import { BrowserManager } from '../core/browser.js';
import { AccessibilityMapper } from '../core/accessibility.js';
import { ScreenshotEngine } from '../core/screenshot.js';
import { InputController } from '../core/input.js';

import { registerNavigationTools } from './tools/navigation.js';
import { registerTabTools } from './tools/tab.js';
import { registerScreenshotTools } from './tools/screenshot.js';
import { registerAccessibilityTools } from './tools/accessibility.js';
import { registerMouseTools } from './tools/mouse.js';
import { registerKeyboardTools } from './tools/keyboard.js';

// Read version from package.json
const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

// Core singletons
const browserManager = new BrowserManager();
const accessibilityMapper = new AccessibilityMapper();
const screenshotEngine = new ScreenshotEngine(accessibilityMapper);
const inputController = new InputController();

// MCP server
const server = new McpServer({
  name: 'web-browser-for-agent',
  version: pkg.version,
});

// Register all tools
registerNavigationTools(server, browserManager, screenshotEngine);
registerTabTools(server, browserManager, screenshotEngine);
registerScreenshotTools(server, browserManager, screenshotEngine);
registerAccessibilityTools(server, browserManager, accessibilityMapper);
registerMouseTools(server, browserManager, inputController, screenshotEngine, accessibilityMapper);
registerKeyboardTools(server, browserManager, inputController, screenshotEngine);

// Transport selection
const transportArg = process.argv.includes('--transport')
  ? process.argv[process.argv.indexOf('--transport') + 1]
  : 'stdio';

async function cleanup() {
  await screenshotEngine.stopRecording();
  if (browserManager.isLaunched()) {
    await browserManager.close();
  }
}

async function main() {
  if (transportArg === 'http') {
    // Lazy-import express only when HTTP transport is used
    const { default: express } = await import('express');
    const { StreamableHTTPServerTransport } =
      await import('@modelcontextprotocol/sdk/server/streamableHttp.js');

    const port = parseInt(process.env.MCP_HTTP_PORT ?? '3100', 10);
    const host = process.env.MCP_HTTP_HOST ?? '127.0.0.1';
    const app = express();
    app.use(express.json());

    const httpTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    app.post('/mcp', async (req, res) => {
      try {
        await httpTransport.handleRequest(req, res, req.body);
      } catch {
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          });
        }
      }
    });

    app.get('/mcp', async (req, res) => {
      try {
        await httpTransport.handleRequest(req, res);
      } catch {
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          });
        }
      }
    });

    app.delete('/mcp', async (req, res) => {
      try {
        await httpTransport.handleRequest(req, res);
      } catch {
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          });
        }
      }
    });

    await server.connect(httpTransport);
    app.listen(port, host, () => {
      console.error(`MCP HTTP server listening on ${host}:${port}`);
      if (host === '0.0.0.0') {
        console.error(
          'WARNING: Server is bound to all interfaces. This is not recommended for production.',
        );
      }
    });
  } else {
    // Default: stdio transport
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
  }
}

// Graceful shutdown
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await cleanup();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
