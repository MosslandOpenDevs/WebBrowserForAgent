import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Server } from 'http';
import { BrowserManager } from '../browser.js';
import {
  AccessibilityMapper,
  createAccessibilityMap,
  type AccessibilityMap,
} from '../accessibility.js';
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

  it('should detect non-standard clickable elements (cursor:pointer / onclick)', async () => {
    const page = bm.getActivePage();
    await page.goto(baseUrl + '/clickable.html');
    const viewport = bm.getViewport();
    const map = await mapper.generateMap(page, viewport);

    const pointerCard = map.findByText('Open settings');
    expect(pointerCard).toBeDefined();
    expect(pointerCard!.role).toBe('clickable');
    expect(pointerCard!.attributes.clickable).toBe('true');

    const onclickDiv = map.findByText('Run action');
    expect(onclickDiv).toBeDefined();
    expect(onclickDiv!.attributes.clickable).toBe('true');
  });

  it('should keep metadata aligned with coordinates around long-text wrappers (regression)', async () => {
    // The long-text wrapper + long-text child used to desync the two DOM walks
    // and misalign metadata with bounding boxes. Verify the standard elements
    // that follow it still map to their own identity and sane geometry.
    const page = bm.getActivePage();
    await page.goto(baseUrl + '/clickable.html');
    const viewport = bm.getViewport();
    const map = await mapper.generateMap(page, viewport);

    const tailButton = map.findByText('Tail Button');
    expect(tailButton).toBeDefined();
    expect(tailButton!.role).toBe('button');
    // A real <button> has a small, positive box — not the coordinates of some
    // other element that a misalignment would have handed it.
    expect(tailButton!.bounds.width).toBeGreaterThan(0);
    expect(tailButton!.bounds.height).toBeGreaterThan(0);
    expect(tailButton!.bounds.height).toBeLessThan(100);

    const deepLink = map.elements.find(
      (e) => e.role === 'link' && e.attributes.href?.includes('/deep-link'),
    );
    expect(deepLink).toBeDefined();
    expect(deepLink!.bounds.width).toBeGreaterThan(0);
  });

  it('should format multiple frames as separate sections', () => {
    const map: AccessibilityMap = createAccessibilityMap([
      {
        index: 0,
        role: 'button',
        name: 'Main',
        bounds: { x: 10, y: 10, width: 80, height: 30 },
        attributes: {},
        frameId: 'main',
      },
      {
        index: 1,
        role: 'input[text]',
        name: 'Card',
        bounds: { x: 100, y: 200, width: 250, height: 35 },
        attributes: { placeholder: 'Card number' },
        frameId: 'iframe#payment',
      },
    ]);

    const text = AccessibilityMapper.formatAsText(map);
    expect(text).toContain('frame: main');
    expect(text).toContain('frame: iframe#payment');
    // Two distinct section headers
    expect(text.match(/\[Accessibility Map/g)?.length).toBe(2);
    expect(text).toContain('[1] input[text] "Card"');
    expect(text).toContain('placeholder=Card number');
  });

  it('should keep totalCount in sync with the elements array', () => {
    const map = createAccessibilityMap([]);
    expect(map.totalCount).toBe(0);
    map.elements.push({
      index: 0,
      role: 'button',
      name: 'X',
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      attributes: {},
      frameId: 'main',
    });
    // Getter-backed: reflects the mutation instead of a frozen snapshot.
    expect(map.totalCount).toBe(1);
  });
});
