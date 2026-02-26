import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { Server } from 'http';
import { BrowserManager, VIEWPORT_CONSTRAINTS } from '../browser.js';
import { BrowserNotLaunchedError, TabIndexOutOfBoundsError } from '../errors.js';
import { startTestServer } from '../../__tests__/helpers.js';

let testServer: Server;
let baseUrl: string;

beforeAll(async () => {
  const result = await startTestServer();
  testServer = result.server;
  baseUrl = result.baseUrl;
});

afterAll(() => {
  testServer.close();
});

describe('BrowserManager', () => {
  let bm: BrowserManager;

  afterEach(async () => {
    if (bm?.isLaunched()) {
      await bm.close();
    }
  });

  it('should launch browser and create initial page', async () => {
    bm = new BrowserManager();
    await bm.launch();
    expect(bm.isLaunched()).toBe(true);
    expect(bm.getPageCount()).toBe(1);
    expect(bm.getActivePageIndex()).toBe(0);
  });

  it('should navigate initial page to URL', async () => {
    bm = new BrowserManager();
    await bm.launch();
    const page = bm.getActivePage();
    await page.goto(baseUrl);
    expect(page.url()).toBe(baseUrl + '/');
  });

  it('should throw BrowserNotLaunchedError when not launched', () => {
    bm = new BrowserManager();
    expect(() => bm.getActivePage()).toThrow(BrowserNotLaunchedError);
  });

  it('should set default viewport 1280x720', async () => {
    bm = new BrowserManager();
    await bm.launch();
    const vp = bm.getViewport();
    expect(vp).toEqual({ width: 1280, height: 720 });
  });

  it('should clamp viewport to constraints', async () => {
    bm = new BrowserManager();
    await bm.launch({ viewport: { width: 2000, height: 1200 } });
    const vp = bm.getViewport();
    expect(vp.width).toBe(VIEWPORT_CONSTRAINTS.MAX_WIDTH);
    expect(vp.height).toBe(VIEWPORT_CONSTRAINTS.MAX_HEIGHT);
  });

  it('should resize viewport', async () => {
    bm = new BrowserManager();
    await bm.launch();
    await bm.resize({ width: 800, height: 600 });
    const vp = bm.getViewport();
    expect(vp).toEqual({ width: 800, height: 600 });
  });

  it('should resize with device preset', async () => {
    bm = new BrowserManager();
    await bm.launch();
    await bm.resize({ device: 'iphone-14' });
    const vp = bm.getViewport();
    expect(vp.width).toBe(390);
    expect(vp.height).toBeLessThanOrEqual(VIEWPORT_CONSTRAINTS.MAX_HEIGHT);
  });

  it('should list tabs', async () => {
    bm = new BrowserManager();
    await bm.launch();
    const page = bm.getActivePage();
    await page.goto(baseUrl);
    const tabs = await bm.listTabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].isActive).toBe(true);
    expect(tabs[0].url).toContain(baseUrl);
  });

  it('should open new tab and switch', async () => {
    bm = new BrowserManager();
    await bm.launch();
    const idx = await bm.newTab(baseUrl);
    expect(idx).toBe(1);
    expect(bm.getPageCount()).toBe(2);
    expect(bm.getActivePageIndex()).toBe(1);

    await bm.switchTab(0);
    expect(bm.getActivePageIndex()).toBe(0);
  });

  it('should throw on invalid tab index', async () => {
    bm = new BrowserManager();
    await bm.launch();
    await expect(bm.switchTab(5)).rejects.toThrow(TabIndexOutOfBoundsError);
  });

  it('should close tab and adjust active index', async () => {
    bm = new BrowserManager();
    await bm.launch();
    await bm.newTab();
    await bm.newTab();
    expect(bm.getPageCount()).toBe(3);

    await bm.closeTab(1);
    expect(bm.getPageCount()).toBe(2);
  });

  it('should close browser when last tab is closed', async () => {
    bm = new BrowserManager();
    await bm.launch();
    await bm.closeTab(0);
    expect(bm.isLaunched()).toBe(false);
  });

  it('should close and relaunch', async () => {
    bm = new BrowserManager();
    await bm.launch();
    await bm.close();
    expect(bm.isLaunched()).toBe(false);

    await bm.launch();
    expect(bm.isLaunched()).toBe(true);
  });
});
