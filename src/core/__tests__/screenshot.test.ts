import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Server } from 'http';
import { BrowserManager } from '../browser.js';
import { AccessibilityMapper } from '../accessibility.js';
import { ScreenshotEngine } from '../screenshot.js';
import { RecordingAlreadyActiveError } from '../errors.js';
import { startTestServer } from '../../__tests__/helpers.js';

let testServer: Server;
let baseUrl: string;
let bm: BrowserManager;
let screenshotEngine: ScreenshotEngine;

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
  const mapper = new AccessibilityMapper();
  screenshotEngine = new ScreenshotEngine(mapper);
  await bm.launch();
});

afterEach(async () => {
  await screenshotEngine.stopRecording();
  if (bm.isLaunched()) await bm.close();
});

describe('ScreenshotEngine', () => {
  it('should capture screenshot as base64 PNG', async () => {
    const page = bm.getActivePage();
    await page.goto(baseUrl + '/simple.html');
    const viewport = bm.getViewport();
    const result = await screenshotEngine.capture(page, viewport, false);

    expect(result.image).toBeTruthy();
    expect(typeof result.image).toBe('string');
    // Validate it's valid base64 by checking PNG header
    const buf = Buffer.from(result.image, 'base64');
    expect(buf[0]).toBe(0x89); // PNG magic byte
    expect(result.accessibilityMap).toBeUndefined();
  });

  it('should include accessibility map when requested', async () => {
    const page = bm.getActivePage();
    await page.goto(baseUrl + '/simple.html');
    const viewport = bm.getViewport();
    const result = await screenshotEngine.capture(page, viewport, true);

    expect(result.accessibilityMap).toBeDefined();
    expect(result.accessibilityMap!.totalCount).toBeGreaterThan(0);
  });

  it('should start and stop recording', async () => {
    const page = bm.getActivePage();
    await page.goto(baseUrl + '/simple.html');

    await screenshotEngine.startRecording(page, { fps: 2 });
    const status = screenshotEngine.getRecordingStatus();
    expect(status.isRecording).toBe(true);
    expect(status.fps).toBe(2);

    // Wait for a few frames
    await new Promise((r) => setTimeout(r, 1500));
    expect(screenshotEngine.getLatestFrame()).not.toBeNull();

    await screenshotEngine.stopRecording();
    expect(screenshotEngine.getRecordingStatus().isRecording).toBe(false);
  });

  it('should throw when starting recording twice', async () => {
    const page = bm.getActivePage();
    await page.goto(baseUrl + '/simple.html');

    await screenshotEngine.startRecording(page, { fps: 1 });
    await expect(screenshotEngine.startRecording(page, { fps: 1 })).rejects.toThrow(
      RecordingAlreadyActiveError,
    );
  });

  it('should clamp FPS to valid range', async () => {
    const page = bm.getActivePage();
    await page.goto(baseUrl + '/simple.html');

    await screenshotEngine.startRecording(page, { fps: 10 }); // should clamp to 5
    const status = screenshotEngine.getRecordingStatus();
    expect(status.fps).toBe(5);
  });

  it('should return latest frame during recording via capture()', async () => {
    const page = bm.getActivePage();
    await page.goto(baseUrl + '/simple.html');

    await screenshotEngine.startRecording(page, { fps: 2 });
    await new Promise((r) => setTimeout(r, 1000));

    const viewport = bm.getViewport();
    const result = await screenshotEngine.capture(page, viewport, true);
    expect(result.image).toBeTruthy();
    expect(result.accessibilityMap).toBeDefined();
  });

  it('should handle stopRecording when not recording', async () => {
    await screenshotEngine.stopRecording(); // should not throw
  });
});
