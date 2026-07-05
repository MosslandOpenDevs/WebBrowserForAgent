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

// Core singletons.
//
// NOTE: A single browser is shared per server process. In HTTP mode this means
// concurrent client sessions share one browser — an intentional, documented
// limitation (see README "Concurrent connections"). Run one server process per
// client for isolation.
const browserManager = new BrowserManager();
const accessibilityMapper = new AccessibilityMapper();
const screenshotEngine = new ScreenshotEngine(accessibilityMapper);
const inputController = new InputController();

// Extra teardown steps registered by the active transport (e.g. closing HTTP
// sessions and the Express listener). Run during graceful shutdown.
const shutdownHooks: Array<() => Promise<void>> = [];

function createServer(): McpServer {
  const server = new McpServer({
    name: 'web-browser-for-agent',
    version: pkg.version,
  });

  registerNavigationTools(server, browserManager, screenshotEngine);
  registerTabTools(server, browserManager, screenshotEngine);
  registerScreenshotTools(server, browserManager, screenshotEngine);
  registerAccessibilityTools(server, browserManager, accessibilityMapper);
  registerMouseTools(
    server,
    browserManager,
    inputController,
    screenshotEngine,
    accessibilityMapper,
  );
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
  for (const hook of shutdownHooks) {
    try {
      await hook();
    } catch {
      // Best-effort teardown; keep going so remaining hooks still run.
    }
  }
}

async function main() {
  if (transportArg === 'http') {
    const { default: express } = await import('express');
    const { StreamableHTTPServerTransport } =
      await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const { isInitializeRequest } = await import('@modelcontextprotocol/sdk/types.js');

    const port = parseInt(process.env.MCP_HTTP_PORT ?? '3100', 10);
    const host = process.env.MCP_HTTP_HOST ?? '127.0.0.1';
    const app = express();
    app.use(express.json());

    // DNS-rebinding protection. Without a Host allowlist, a web page the user
    // opens in an ordinary browser could rebind a hostname to 127.0.0.1 and
    // POST to this endpoint, driving the agent's real (logged-in) browser.
    // Default allowlist covers the loopback bind; extend via env vars for
    // remote/reverse-proxy deployments.
    const defaultAllowedHosts = [
      `${host}:${port}`,
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      `[::1]:${port}`,
    ];
    const allowedHosts = new Set(
      (process.env.MCP_HTTP_ALLOWED_HOSTS
        ? process.env.MCP_HTTP_ALLOWED_HOSTS.split(',')
        : defaultAllowedHosts
      )
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    );
    const allowedOrigins = process.env.MCP_HTTP_ALLOWED_ORIGINS
      ? new Set(
          process.env.MCP_HTTP_ALLOWED_ORIGINS.split(',')
            .map((o) => o.trim())
            .filter(Boolean),
        )
      : null;

    app.use('/mcp', (req, res, next) => {
      const hostHeader = (req.headers.host ?? '').toLowerCase();
      if (!allowedHosts.has(hostHeader)) {
        res.status(403).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: `Forbidden: Host "${hostHeader}" is not allowed. Set MCP_HTTP_ALLOWED_HOSTS to permit it.`,
          },
          id: null,
        });
        return;
      }
      const origin = req.headers.origin;
      if (origin && allowedOrigins && !allowedOrigins.has(origin)) {
        res.status(403).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: `Forbidden: Origin "${origin}" is not allowed.` },
          id: null,
        });
        return;
      }
      next();
    });

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

    const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
    const httpServer = app.listen(port, host, () => {
      console.error(`MCP HTTP server listening on ${host}:${port}`);
      if (!isLoopback) {
        console.error(
          `WARNING: Bound to non-loopback host "${host}". The /mcp endpoint is unauthenticated — ` +
            "anyone who can reach this port gains full control of a browser holding the user's " +
            'logged-in sessions. Put it behind an authenticating reverse proxy with TLS, and set ' +
            'MCP_HTTP_ALLOWED_HOSTS to the hostnames clients connect with.',
        );
      }
    });

    // Graceful shutdown: close every open session transport, then the listener.
    shutdownHooks.push(async () => {
      for (const transport of sessions.values()) {
        try {
          await transport.close();
        } catch {
          /* ignore */
        }
      }
      sessions.clear();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });
  } else {
    // Default: stdio transport
    const server = createServer();
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
  }
}

// Graceful shutdown. Guard against re-entry (a second Ctrl-C / SIGTERM) and
// bound the wait so a hung browser close can't block process exit forever.
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await Promise.race([cleanup(), new Promise((resolve) => setTimeout(resolve, 5000))]);
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
