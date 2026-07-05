# WebBrowserForAgent

An MCP (Model Context Protocol) server that gives AI agents full control over a real web browser.

Built on Playwright with support for Chromium, Firefox, and WebKit. Provides screenshot capture, mouse/keyboard input, multi-tab management, and an **Accessibility Map** — a text-based representation of all interactive elements on a page — enabling any AI model to operate a browser regardless of multimodal capabilities.

[한국어 문서 (Korean)](./README_ko.md)

## Features

- **Screenshot Capture** — Single capture and FPS-based continuous recording (1–5 FPS, ring buffer)
- **Accessibility Map** — Extracts coordinates, roles, and attributes of all interactive elements as text. Enables browser control without vision.
- **Dual-mode Targeting** — Interact via `{x, y}` pixel coordinates or `{elementIndex}` from the accessibility map
- **Full Input Control** — Click, double-click, right-click, drag, scroll, type text, hotkeys
- **Multi-tab Management** — Auto-detect new tabs, explicit tab switching, open/close tabs
- **Device Presets** — Desktop, iPhone, Pixel, iPad and other mobile/tablet viewports
- **Dual Transport** — stdio (local) / Streamable HTTP (remote)

## Requirements

- **Node.js** >= 18
- **OS**: macOS, Windows, Linux (including headless servers)

### Headless Linux Servers (Ubuntu, Debian, etc.)

Playwright works in headless mode on CLI-only environments without a display server. Docker, CI/CD, and cloud servers are all supported. However, system libraries required by the browser must be installed:

```bash
# Automatically install OS-level dependencies for Chromium (requires root)
npx playwright install-deps chromium
```

Key libraries: `libnss3`, `libatk-bridge2.0-0`, `libdrm2`, `libxkbcommon0`, `libgbm1`, etc. The command above installs them via apt automatically.

### Docker

```dockerfile
FROM node:20-slim

# Enable pnpm (bundled with Node via Corepack)
RUN corepack enable

# Install Playwright system dependencies
RUN npx playwright install-deps chromium

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
RUN npx playwright install chromium

COPY . .
RUN pnpm build

EXPOSE 3100
CMD ["node", "dist/mcp/server.js", "--transport", "http"]
```

### Resource Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 512MB | 1GB+ |
| CPU | 1 core | 2+ cores |
| Disk | 500MB (Chromium binary) | 1GB+ |

A single Chromium instance uses approximately 200–500MB of memory. Complex pages require more.

## Limitations

- **Single browser session**: Only one browser instance per MCP server. To run multiple browsers concurrently, launch multiple server instances.
- **Viewport size cap**: Maximum 1280×720. This is an intentional limit to optimize token consumption for AI agents. Use scrolling to navigate pages beyond the viewport.
- **File download/upload**: File downloads and `<input type="file">` uploads are not currently supported.
- **Auth popups**: HTTP Basic Auth and OS-level authentication dialogs are not handled. Only web-based login forms are supported.
- **WebRTC/Media**: Camera, microphone, and media stream features are not supported.
- **HTTP transport security**: HTTP mode binds to `127.0.0.1` by default and enforces a Host-header allowlist (DNS-rebinding protection) so a malicious web page can't reach the endpoint even on the loopback bind. The `/mcp` endpoint has **no built-in authentication** — binding to a non-loopback host exposes full control of a browser holding the user's logged-in sessions, so an authenticating reverse proxy with TLS is **required**, not optional. When binding remotely, set `MCP_HTTP_ALLOWED_HOSTS` (and optionally `MCP_HTTP_ALLOWED_ORIGINS`) to the hostnames clients connect with.
- **Concurrent connections**: Multiple MCP clients connecting via HTTP share a single browser instance, which can cause state conflicts. Use separate server instances per client.
- **Browser binary not included**: The npm package does not bundle browser binaries. After installation, run `npx playwright install chromium` separately. Firefox/WebKit require their own install commands as well.

## Quick Start

### Install via npm

```bash
npm install web-browser-for-agent
```

After installation, install the Playwright Chromium browser:

```bash
npx playwright install chromium
```

### Use with Claude Desktop / MCP Clients

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "web-browser": {
      "command": "npx",
      "args": ["web-browser-for-agent", "--transport", "stdio"]
    }
  }
}
```

### Run as HTTP Server

```bash
npx web-browser-for-agent --transport http
# MCP HTTP server listening on 127.0.0.1:3100
```

Configuration via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_HTTP_PORT` | `3100` | Listen port |
| `MCP_HTTP_HOST` | `127.0.0.1` | Bind address. A non-loopback bind requires a reverse proxy (see [Limitations](#limitations)) |
| `MCP_HTTP_ALLOWED_HOSTS` | loopback + bind | Comma-separated Host-header allowlist (DNS-rebinding protection) |
| `MCP_HTTP_ALLOWED_ORIGINS` | _(any)_ | Comma-separated Origin allowlist |

## MCP Tools

### Navigation

| Tool | Description |
|------|-------------|
| `browser_launch` | Launch browser (engine, viewport, device preset) |
| `browser_navigate` | Navigate to a URL |
| `browser_back` | Go back in history |
| `browser_forward` | Go forward in history |
| `browser_close` | Close the browser |
| `browser_resize` | Resize viewport, or apply a device preset's dimensions (viewport only — no UA/touch emulation) |

### Screenshot & Recording

| Tool | Description |
|------|-------------|
| `browser_screenshot` | Capture screenshot + Accessibility Map |
| `browser_start_recording` | Start FPS-based continuous capture (1–5 FPS) |
| `browser_stop_recording` | Stop continuous capture |

### Accessibility

| Tool | Description |
|------|-------------|
| `browser_get_accessibility_map` | Get text-based map of interactive elements |

### Mouse

| Tool | Description |
|------|-------------|
| `browser_click` | Click (coordinates or elementIndex) |
| `browser_double_click` | Double-click |
| `browser_right_click` | Right-click |
| `browser_drag` | Drag and drop |
| `browser_mouse_move` | Move mouse (hover) |
| `browser_scroll` | Scroll the page |

### Keyboard

| Tool | Description |
|------|-------------|
| `browser_type` | Type text |
| `browser_key_press` | Press a single key (Enter, Tab, Escape, etc.) |
| `browser_hotkey` | Key combination (Ctrl+A, Cmd+C, etc.) |

### Tab Management

| Tool | Description |
|------|-------------|
| `browser_list_tabs` | List all open tabs |
| `browser_switch_tab` | Switch to a tab |
| `browser_new_tab` | Open a new tab |
| `browser_close_tab` | Close a tab |

## Accessibility Map

Enables models without vision capabilities to operate a browser by extracting all interactive elements on the page as structured text.

### Example Output

```
[Accessibility Map - 5 elements, frame: main]
[0] button "Login" @ (350, 420, 120, 40)
[1] link "Sign Up" @ (500, 425, 80, 20) - href=https://example.com/signup
[2] input[text] "" @ (300, 300, 200, 35) - placeholder=Email address
[3] input[password] "" @ (300, 350, 200, 35) - placeholder=Password
[4] checkbox "Remember me" @ (300, 390, 20, 20) - unchecked

[Accessibility Map - 1 element, frame: iframe#payment]
[5] input[text] "" @ (100, 200, 250, 35) - placeholder=Card number
```

- Each element gets a unique index — use `browser_click({ target: { elementIndex: 0 } })` to interact
- Automatically traverses iframes; coordinates are relative to the main frame
- Detects non-standard clickable elements via `cursor:pointer` and `onclick` attributes
- Link hrefs are DOM-resolved absolute URLs (e.g. a `/signup` link on `example.com` shows `href=https://example.com/signup`)

### Detected Elements

Standard interactive elements: `a[href]`, `button`, `input`, `select`, `textarea`, `[role="button"]`, `[role="link"]`, `[role="checkbox"]`, `[role="radio"]`, `[role="tab"]`, `[role="menuitem"]`, `[tabindex]`, `[contenteditable]`

Non-standard clickable elements: `cursor: pointer` style, `onclick`/`@click`/`ng-click` attributes

## Device Presets

| Preset | Device viewport | Applied (clamped) | Description |
|--------|-----------------|-------------------|-------------|
| `desktop` | 1280×720 | 1280×720 | Default |
| `iphone-14` | 390×664 | 390×664 | iOS mobile |
| `iphone-14-landscape` | 750×340 | 750×480 | Landscape mode |
| `pixel-7` | 412×839 | 412×720 | Android mobile |
| `ipad-pro-11` | 834×1194 | 834×720 | Tablet |

Viewport is clamped to 320–1280 (width) × 480–720 (height), and the device scale factor is clamped to 2× — keeping screenshots within the token-optimized size ceiling. `browser_launch({ device })` applies full mobile emulation (userAgent, touch, `isMobile`); `browser_resize({ device })` applies **only the viewport dimensions**.

> Exact preset viewports track the installed Playwright device registry (verified against Playwright 1.58.x).

## Programmatic Usage

Core modules can be imported directly without using the MCP server:

```typescript
import {
  BrowserManager,
  AccessibilityMapper,
  ScreenshotEngine,
  InputController,
} from 'web-browser-for-agent';

const browser = new BrowserManager();
const mapper = new AccessibilityMapper();
const screenshot = new ScreenshotEngine(mapper);
const input = new InputController();

await browser.launch({ headless: true });
const page = browser.getActivePage();
await page.goto('https://example.com');

// Screenshot + Accessibility Map
const viewport = browser.getViewport();
const result = await screenshot.capture(page, viewport, true);
console.log(AccessibilityMapper.formatAsText(result.accessibilityMap!));

// Click by element index — find helpers are available on the generated map
const map = await mapper.generateMap(page, viewport);
const loginBtn = map.findByText('Login');
if (loginBtn) {
  await input.click(page, { elementIndex: loginBtn.index }, map);
}

await browser.close();
```

## Development

```bash
git clone https://github.com/MosslandOpenDevs/WebBrowserForAgent.git
cd WebBrowserForAgent
pnpm install
pnpm build
pnpm test
```

| Command | Description |
|---------|-------------|
| `pnpm build` | Build TypeScript → dist/ |
| `pnpm dev` | Watch mode build |
| `pnpm test` | Run all tests |
| `pnpm test -- src/core/__tests__/browser.test.ts` | Run a single test file |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |

## Architecture

```
src/
├── core/                    # Browser control core
│   ├── browser.ts           # BrowserManager — browser/tab lifecycle, viewport
│   ├── screenshot.ts        # ScreenshotEngine — capture, FPS recording, ring buffer
│   ├── accessibility.ts     # AccessibilityMapper — DOM query, bounding box extraction
│   ├── input.ts             # InputController — mouse, keyboard, drag
│   └── errors.ts            # Custom error classes
├── mcp/
│   ├── server.ts            # MCP server entry point, transport selection
│   └── tools/               # MCP tool definitions (one file per domain)
└── index.ts                 # Library re-exports
```

## License

[MIT](./LICENSE)
