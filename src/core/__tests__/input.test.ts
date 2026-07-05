import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Server } from 'http';
import { BrowserManager } from '../browser.js';
import { AccessibilityMapper, type AccessibilityMap } from '../accessibility.js';
import { InputController } from '../input.js';
import { ElementIndexOutOfBoundsError, AccessibilityMapRequiredError } from '../errors.js';
import { startTestServer } from '../../__tests__/helpers.js';

let testServer: Server;
let baseUrl: string;
let bm: BrowserManager;
let mapper: AccessibilityMapper;
let input: InputController;

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
  input = new InputController();
  await bm.launch();
});

afterEach(async () => {
  if (bm.isLaunched()) await bm.close();
});

describe('InputController', () => {
  describe('resolveTarget', () => {
    it('should return coordinates directly for {x, y}', () => {
      const result = input.resolveTarget({ x: 100, y: 200 });
      expect(result).toEqual({ x: 100, y: 200 });
    });

    it('should compute center from elementIndex', () => {
      const map: AccessibilityMap = {
        elements: [
          {
            index: 0,
            role: 'button',
            name: 'Test',
            bounds: { x: 100, y: 200, width: 80, height: 40 },
            attributes: {},
            frameId: 'main',
          },
        ],
        totalCount: 1,
        timestamp: Date.now(),
      };
      const result = input.resolveTarget({ elementIndex: 0 }, map);
      expect(result).toEqual({ x: 140, y: 220 });
    });

    it('should throw ElementIndexOutOfBoundsError for invalid index', () => {
      const map: AccessibilityMap = {
        elements: [
          {
            index: 0,
            role: 'button',
            name: 'Test',
            bounds: { x: 0, y: 0, width: 10, height: 10 },
            attributes: {},
            frameId: 'main',
          },
        ],
        totalCount: 1,
        timestamp: Date.now(),
      };
      expect(() => input.resolveTarget({ elementIndex: 5 }, map)).toThrow(
        ElementIndexOutOfBoundsError,
      );
    });

    it('should throw AccessibilityMapRequiredError when no map provided', () => {
      expect(() => input.resolveTarget({ elementIndex: 0 })).toThrow(AccessibilityMapRequiredError);
    });
  });

  describe('click', () => {
    it('should click at coordinates', async () => {
      const page = bm.getActivePage();
      await page.goto(baseUrl + '/simple.html');

      // Click on the login button using accessibility map
      const viewport = bm.getViewport();
      const map = await mapper.generateMap(page, viewport);
      const btn = map.elements.find((e) => e.name === 'Login');
      expect(btn).toBeDefined();

      await input.click(page, { elementIndex: btn!.index }, map);
    });
  });

  describe('type', () => {
    it('should type text into focused input', async () => {
      const page = bm.getActivePage();
      await page.goto(baseUrl + '/simple.html');

      // Click on email input first
      const viewport = bm.getViewport();
      const map = await mapper.generateMap(page, viewport);
      const emailInput = map.elements.find((e) => e.attributes.placeholder === 'Email address');
      expect(emailInput).toBeDefined();

      await input.click(page, { elementIndex: emailInput!.index }, map);
      await input.type(page, 'test@example.com');

      const value = await page.inputValue('#input-email');
      expect(value).toBe('test@example.com');
    });
  });

  describe('keyPress', () => {
    it('should press a key', async () => {
      const page = bm.getActivePage();
      await page.goto(baseUrl + '/simple.html');
      await input.keyPress(page, 'Tab');
      // No error means success
    });
  });

  describe('hotkey', () => {
    it('should press a key combination', async () => {
      const page = bm.getActivePage();
      await page.goto(baseUrl + '/simple.html');

      // Click and type into email, then select all with Ctrl+A
      await page.click('#input-email');
      await input.type(page, 'hello');
      await input.hotkey(page, ['Control', 'a']);
      // No error means success
    });
  });

  describe('elementIndex-based interactions', () => {
    it('should resolve elementIndex for doubleClick, rightClick, and mouseMove', async () => {
      const page = bm.getActivePage();
      await page.goto(baseUrl + '/simple.html');
      const viewport = bm.getViewport();
      const map = await mapper.generateMap(page, viewport);
      const btn = map.elements.find((e) => e.name === 'Login');
      expect(btn).toBeDefined();

      await input.doubleClick(page, { elementIndex: btn!.index }, map);
      await input.rightClick(page, { elementIndex: btn!.index }, map);
      await input.mouseMove(page, { elementIndex: btn!.index }, map);
    });

    it('should resolve elementIndex for both drag endpoints', async () => {
      const page = bm.getActivePage();
      await page.goto(baseUrl + '/simple.html');
      const viewport = bm.getViewport();
      const map = await mapper.generateMap(page, viewport);
      const from = map.elements.find((e) => e.name === 'Login');
      const to = map.elements.find((e) => e.name === 'Submit');
      expect(from).toBeDefined();
      expect(to).toBeDefined();

      await input.drag(
        page,
        { from: { elementIndex: from!.index }, to: { elementIndex: to!.index } },
        map,
      );
    });

    it('should resolve an elementIndex scroll target', async () => {
      const page = bm.getActivePage();
      await page.goto(baseUrl + '/simple.html');
      const viewport = bm.getViewport();
      const map = await mapper.generateMap(page, viewport);
      const btn = map.elements.find((e) => e.name === 'Login');
      expect(btn).toBeDefined();

      await input.scroll(page, { target: { elementIndex: btn!.index }, deltaY: 100 }, map);
    });

    it('should throw for an out-of-range elementIndex', async () => {
      const page = bm.getActivePage();
      await page.goto(baseUrl + '/simple.html');
      const viewport = bm.getViewport();
      const map = await mapper.generateMap(page, viewport);

      await expect(input.doubleClick(page, { elementIndex: 9999 }, map)).rejects.toThrow(
        ElementIndexOutOfBoundsError,
      );
    });
  });
});
