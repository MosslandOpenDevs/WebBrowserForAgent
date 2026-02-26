#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';

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
import { registerPrompts } from './prompts.js';

// Read version from package.json
const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

// Core singletons
const browserManager = new BrowserManager();
const accessibilityMapper = new AccessibilityMapper();
const screenshotEngine = new ScreenshotEngine(accessibilityMapper);
const inputController = new InputController();

function createServer(): McpServer {
  const server = new McpServer({
    name: 'web-browser-for-agent',
    version: pkg.version,
  });

  registerNavigationTools(server, browserManager, screenshotEngine);
  registerTabTools(server, browserManager, screenshotEngine);
  registerScreenshotTools(server, browserManager, screenshotEngine);
  registerAccessibilityTools(server, browserManager, accessibilityMapper);
  registerMouseTools(server, browserManager, inputController, screenshotEngine, accessibilityMapper);
  registerKeyboardTools(server, browserManager, inputController, screenshotEngine);
  registerPrompts(server);

  return server;
}

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
    const { default: express } = await import('express');
    const { StreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/streamableHttp.js'
    );
    const { isInitializeRequest } = await import('@modelcontextprotocol/sdk/types.js');

    const port = parseInt(process.env.MCP_HTTP_PORT ?? '3100', 10);
    const host = process.env.MCP_HTTP_HOST ?? '127.0.0.1';
    const app = express();
    app.use(express.json());

    // Session management: map session IDs to transports
    const sessions = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();

    app.post('/mcp', async (req, res) => {
      try {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (sessionId && sessions.has(sessionId)) {
          // Existing session — route to its transport
          const transport = sessions.get(sessionId)!;
          await transport.handleRequest(req, res, req.body);
          return;
        }

        if (!sessionId && isInitializeRequest(req.body)) {
          // New session — create transport and connect a fresh server
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id: string) => {
              sessions.set(id, transport);
            },
          });

          transport.onclose = () => {
            if (transport.sessionId) {
              sessions.delete(transport.sessionId);
            }
          };

          const server = createServer();
          await server.connect(transport);
          await transport.handleRequest(req, res, req.body);
          return;
        }

        // Invalid: no session ID but not an initialize request
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Bad Request: No valid session or initialize request' },
          id: null,
        });
      } catch (error) {
        console.error('HTTP POST /mcp error:', error);
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
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !sessions.has(sessionId)) {
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Bad Request: Invalid or missing session ID' },
            id: null,
          });
          return;
        }
        await sessions.get(sessionId)!.handleRequest(req, res);
      } catch (error) {
        console.error('HTTP GET /mcp error:', error);
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
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !sessions.has(sessionId)) {
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Bad Request: Invalid or missing session ID' },
            id: null,
          });
          return;
        }
        const transport = sessions.get(sessionId)!;
        await transport.handleRequest(req, res);
        await transport.close();
        sessions.delete(sessionId);
      } catch (error) {
        console.error('HTTP DELETE /mcp error:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          });
        }
      }
    });

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
    const server = createServer();
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
