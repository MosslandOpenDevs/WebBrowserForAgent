import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer): void {
  server.prompt(
    'browser-use-guide',
    'Complete guide for controlling the browser. Read this before using any browser tools.',
    {},
    async () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: BROWSER_USE_GUIDE,
          },
        },
      ],
    }),
  );

  server.prompt(
    'browser-quick-start',
    'Minimal step-by-step example: launch browser, navigate, click a button, and type text.',
    {
      url: z.string().url().describe('The URL to navigate to'),
    },
    async ({ url }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: getQuickStartPrompt(url),
          },
        },
      ],
    }),
  );
}

function getQuickStartPrompt(url: string): string {
  return `Navigate to ${url} and help me interact with the page.

Follow these steps:
1. Call browser_launch to start the browser
2. Call browser_navigate with url "${url}"
3. You will receive a screenshot and an accessibility map listing all interactive elements
4. Use the accessibility map indices to interact with elements via browser_click, browser_type, etc.
5. After each action, check the returned screenshot and accessibility map to verify the result

Remember:
- Use { "target": { "elementIndex": N } } to click elements from the accessibility map
- Use browser_type to enter text into the currently focused field
- Use browser_key_press with "Enter" to submit forms
- Use browser_scroll if you need to see content below the viewport`;
}

const BROWSER_USE_GUIDE = `# WebBrowserForAgent — Usage Guide

You have access to a set of browser control tools. This guide explains how to use them effectively.

## Core Workflow

Every browser session follows this pattern:

\`\`\`
browser_launch → browser_navigate → [screenshot + accessibility map returned]
  → read the accessibility map → interact (click/type/scroll) → [new screenshot returned]
  → repeat until task is done → browser_close
\`\`\`

Most tools automatically return a screenshot and accessibility map after execution, so you always see the current state.

## Accessibility Map

After most actions, you receive an **accessibility map** — a text listing of all interactive elements on the page:

\`\`\`
[Accessibility Map - 5 elements, frame: main]
[0] button "Login" @ (350, 420, 120, 40)
[1] link "Sign Up" @ (500, 425, 80, 20) - href=https://example.com/signup
[2] input[text] "" @ (300, 300, 200, 35) - placeholder=Email address
[3] input[password] "" @ (300, 350, 200, 35) - placeholder=Password
[4] checkbox "Remember me" @ (300, 390, 20, 20) - unchecked
\`\`\`

Each line shows: \`[index] role "name" @ (x, y, width, height) - attributes\`

## How to Interact with Elements

Use the **elementIndex** from the accessibility map:

- **Click a button**: \`browser_click({ target: { elementIndex: 0 } })\`
- **Click an input field, then type**:
  1. \`browser_click({ target: { elementIndex: 2 } })\` — focuses the input
  2. \`browser_type({ text: "user@example.com" })\` — types into it
- **Submit a form**: \`browser_key_press({ key: "Enter" })\`
- **Check a checkbox**: \`browser_click({ target: { elementIndex: 4 } })\`

You can also use raw pixel coordinates: \`browser_click({ target: { x: 350, y: 420 } })\`

## Step-by-Step Example: Login Flow

1. \`browser_launch({})\` — starts the browser
2. \`browser_navigate({ url: "https://example.com/login" })\` — go to login page
3. Read the accessibility map. Find the email input (e.g., index 2)
4. \`browser_click({ target: { elementIndex: 2 } })\` — focus email field
5. \`browser_type({ text: "user@example.com" })\` — type email
6. Read the new accessibility map. Find the password input (e.g., index 3)
7. \`browser_click({ target: { elementIndex: 3 } })\` — focus password field
8. \`browser_type({ text: "mypassword" })\` — type password
9. Find the login button (e.g., index 0)
10. \`browser_click({ target: { elementIndex: 0 } })\` — click login
11. Check the screenshot to verify login success
12. \`browser_close({})\` — done

## Important Rules

### Always re-read the accessibility map after each action
Element indices change after every page update. Never reuse indices from a previous map.

### Clear input fields before typing
If an input already has text, select all first:
1. \`browser_click({ target: { elementIndex: N } })\` — focus the field
2. \`browser_hotkey({ keys: ["Control", "a"] })\` — select all existing text
3. \`browser_type({ text: "new value" })\` — type replaces the selection

### Scrolling
The viewport is at most 1280×720. If content is below the fold:
- \`browser_scroll({ deltaY: 500 })\` — scroll down 500px
- \`browser_scroll({ deltaY: -500 })\` — scroll up 500px
- After scrolling, the new screenshot and accessibility map will show the updated view

### Handling new tabs
Some clicks open new tabs (e.g., target="_blank" links):
1. \`browser_list_tabs({})\` — see all open tabs (new tabs are marked)
2. \`browser_switch_tab({ tabIndex: 1 })\` — switch to the new tab
3. Interact with the new tab
4. \`browser_switch_tab({ tabIndex: 0 })\` — switch back if needed

### Waiting for page load
Most navigation tools wait for page load automatically. If a page is slow:
- Use \`browser_screenshot({})\` to check current state
- Click actions include a brief wait, but dynamic content (SPAs) may need an extra screenshot

## Tool Reference

### Lifecycle
- \`browser_launch\` — Start browser. Options: browser engine, viewport size, device preset, headless mode
- \`browser_close\` — Shut down browser
- \`browser_resize\` — Change viewport size. Device presets: desktop, iphone-14, pixel-7, ipad-pro-11

### Navigation
- \`browser_navigate\` — Go to URL
- \`browser_back\` / \`browser_forward\` — History navigation

### Observation
- \`browser_screenshot\` — Capture screenshot + accessibility map
- \`browser_get_accessibility_map\` — Get accessibility map only (no screenshot)

### Mouse
- \`browser_click\` — Click (left button)
- \`browser_double_click\` — Double-click
- \`browser_right_click\` — Right-click (context menu)
- \`browser_mouse_move\` — Hover over element
- \`browser_drag\` — Drag from one position to another
- \`browser_scroll\` — Scroll the page

### Keyboard
- \`browser_type\` — Type text into focused element
- \`browser_key_press\` — Press a single key: Enter, Tab, Escape, ArrowDown, Backspace, etc.
- \`browser_hotkey\` — Key combination: ["Control", "a"], ["Control", "c"], ["Meta", "v"], etc.

### Tabs
- \`browser_list_tabs\` — List all tabs
- \`browser_switch_tab\` — Switch active tab
- \`browser_new_tab\` — Open new tab
- \`browser_close_tab\` — Close a tab

### Recording (advanced)
- \`browser_start_recording\` — Start periodic screenshots (1-5 FPS)
- \`browser_stop_recording\` — Stop recording
`;
