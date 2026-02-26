import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Server } from 'http';
import { BrowserManager } from '../browser.js';
import { AccessibilityMapper } from '../accessibility.js';
import { startTestServer } from '../../__tests__/helpers.js';

let testServer: Server;
let baseUrl: string;
let bm: BrowserManager;
let mapper: AccessibilityMapper;

beforeAll(async () => {
  const result = await startTestServer();
  testServer = result.server;
  baseUrl = result.baseUrl;
});

afterAll(() => {
  testServer.close();
});

beforeEach(async () => {
  bm = new BrowserManager();
  mapper = new AccessibilityMapper();
  await bm.launch();
});

afterEach(async () => {
  if (bm.isLaunched()) await bm.close();
});

describe('AccessibilityMapper', () => {
  it('should extract interactive elements from simple page', async () => {
    const page = bm.getActivePage();
    await page.goto(baseUrl + '/simple.html');
    const viewport = bm.getViewport();
    const map = await mapper.generateMap(page, viewport);

    expect(map.totalCount).toBeGreaterThan(0);
    expect(map.elements.length).toBe(map.totalCount);

    // Should have links, buttons, inputs, select, textarea
    const roles = map.elements.map((e) => e.role);
    expect(roles).toContain('link');
    expect(roles).toContain('button');
    expect(roles).toContain('select');
    expect(roles).toContain('textarea');
  });

  it('should not include hidden elements', async () => {
    const page = bm.getActivePage();
    await page.goto(baseUrl + '/simple.html');
    const viewport = bm.getViewport();
    const map = await mapper.generateMap(page, viewport);

    const names = map.elements.map((e) => e.name);
    expect(names).not.toContain('Hidden Button');
  });

  it('should assign sequential indices', async () => {
    const page = bm.getActivePage();
    await page.goto(baseUrl + '/simple.html');
    const viewport = bm.getViewport();
    const map = await mapper.generateMap(page, viewport);

    for (let i = 0; i < map.elements.length; i++) {
      expect(map.elements[i].index).toBe(i);
    }
  });

  it('should compute bounding boxes with valid coordinates', async () => {
    const page = bm.getActivePage();
    await page.goto(baseUrl + '/simple.html');
    const viewport = bm.getViewport();
    const map = await mapper.generateMap(page, viewport);

    for (const el of map.elements) {
      expect(el.bounds.width).toBeGreaterThan(0);
      expect(el.bounds.height).toBeGreaterThan(0);
    }
  });

  it('should extract elements from iframes', async () => {
    const page = bm.getActivePage();
    await page.goto(baseUrl + '/iframe.html');
    // Wait for iframe to load
    await page.waitForTimeout(500);
    const viewport = bm.getViewport();
    const map = await mapper.generateMap(page, viewport);

    const frameIds = [...new Set(map.elements.map((e) => e.frameId))];
    expect(frameIds.length).toBeGreaterThanOrEqual(2);

    const iframeElements = map.elements.filter((e) => e.frameId !== 'main');
    expect(iframeElements.length).toBeGreaterThan(0);
  });

  it('should extract element attributes', async () => {
    const page = bm.getActivePage();
    await page.goto(baseUrl + '/simple.html');
    const viewport = bm.getViewport();
    const map = await mapper.generateMap(page, viewport);

    const link = map.elements.find((e) => e.role === 'link' && e.name === 'About');
    expect(link).toBeDefined();
    expect(link!.attributes.href).toContain('/about');

    const emailInput = map.elements.find(
      (e) => e.role === 'input[text]' && e.attributes.placeholder === 'Email address',
    );
    expect(emailInput).toBeDefined();
  });

  it('should format as text', async () => {
    const page = bm.getActivePage();
    await page.goto(baseUrl + '/simple.html');
    const viewport = bm.getViewport();
    const map = await mapper.generateMap(page, viewport);

    const text = AccessibilityMapper.formatAsText(map);
    expect(text).toContain('[Accessibility Map');
    expect(text).toContain('frame: main');
    expect(text).toMatch(/\[\d+\]/);
  });

  it('should return empty map for page with no interactive elements', async () => {
    const page = bm.getActivePage();
    await page.setContent('<html><body><p>Just text</p></body></html>');
    const viewport = bm.getViewport();
    const map = await mapper.generateMap(page, viewport);

    expect(map.totalCount).toBe(0);
    expect(AccessibilityMapper.formatAsText(map)).toContain('0 elements');
  });
});
