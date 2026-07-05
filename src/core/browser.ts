import {
  chromium,
  firefox,
  webkit,
  devices,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import { BrowserNotLaunchedError, NoActivePageError, TabIndexOutOfBoundsError } from './errors.js';

export interface BrowserLaunchOptions {
  /** Browser engine to use. Defaults to `chromium`. */
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  viewport?: { width: number; height: number };
  device?: string;
  /** Screenshot scale (Retina/high-DPI). Clamped to 1x–2x. Applied at launch only. */
  deviceScaleFactor?: number;
}

export interface TabInfo {
  tabIndex: number;
  url: string;
  title: string;
  isActive: boolean;
  isNew: boolean;
}

export const VIEWPORT_CONSTRAINTS = {
  MIN_WIDTH: 320,
  MAX_WIDTH: 1280,
  MIN_HEIGHT: 480,
  MAX_HEIGHT: 720,
} as const;

export const DEVICE_PRESETS: Record<string, string> = {
  desktop: '',
  'iphone-14': 'iPhone 14',
  'iphone-14-landscape': 'iPhone 14 landscape',
  'pixel-7': 'Pixel 7',
  'ipad-pro-11': 'iPad Pro 11',
};

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages: Page[] = [];
  private activePageIndex = -1;
  private newTabIndices = new Set<number>();
  private suppressPageEvent = false;

  async launch(options: BrowserLaunchOptions = {}): Promise<void> {
    if (this.browser) {
      await this.close();
    }

    const browserType = options.browser ?? 'chromium';
    const launcher = { chromium, firefox, webkit }[browserType];
    this.browser = await launcher.launch({ headless: options.headless ?? true });

    const contextOptions: Record<string, unknown> = {};

    if (options.device && options.device !== 'desktop') {
      const playwrightName = DEVICE_PRESETS[options.device];
      if (playwrightName && devices[playwrightName]) {
        const descriptor = devices[playwrightName];
        Object.assign(contextOptions, descriptor);
        if (descriptor.viewport) {
          contextOptions.viewport = {
            width: this.clamp(
              descriptor.viewport.width,
              VIEWPORT_CONSTRAINTS.MIN_WIDTH,
              VIEWPORT_CONSTRAINTS.MAX_WIDTH,
            ),
            height: this.clamp(
              descriptor.viewport.height,
              VIEWPORT_CONSTRAINTS.MIN_HEIGHT,
              VIEWPORT_CONSTRAINTS.MAX_HEIGHT,
            ),
          };
        }
      }
    }

    if (options.viewport) {
      contextOptions.viewport = this.clampViewport(options.viewport.width, options.viewport.height);
    }

    if (!contextOptions.viewport) {
      contextOptions.viewport = { width: 1280, height: 720 };
    }

    // Clamp the device scale factor to 1x–2x. Device presets carry their own
    // (e.g. iPhone 14 = 3x, Pixel 7 = 2.625x); leaving those unclamped would
    // blow past the intended screenshot size ceiling, so cap whatever ended up
    // in contextOptions — whether caller-supplied or descriptor-derived.
    const scaleFactor =
      options.deviceScaleFactor ?? (contextOptions.deviceScaleFactor as number | undefined);
    if (scaleFactor !== undefined) {
      contextOptions.deviceScaleFactor = Math.max(1, Math.min(2, scaleFactor));
    }

    // `isMobile` is a Chromium-only context option; passing it to Firefox throws
    // on newContext(), which would turn any mobile preset into a launch failure.
    if (browserType === 'firefox') {
      delete contextOptions.isMobile;
    }

    this.context = await this.browser.newContext(contextOptions);
    this.setupNewPageListener();

    this.suppressPageEvent = true;
    const page = await this.context.newPage();
    this.suppressPageEvent = false;
    this.pages = [page];
    this.activePageIndex = 0;
    this.newTabIndices.clear();

    this.setupPageCloseListener(page);
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
    }
    if (this.browser) {
      await this.browser.close();
    }
    this.browser = null;
    this.context = null;
    this.pages = [];
    this.activePageIndex = -1;
    this.newTabIndices.clear();
  }

  isLaunched(): boolean {
    return this.browser !== null;
  }

  getActivePage(): Page {
    if (!this.browser) {
      throw new BrowserNotLaunchedError();
    }
    if (this.pages.length === 0 || this.activePageIndex < 0) {
      throw new NoActivePageError();
    }
    return this.pages[this.activePageIndex];
  }

  getActivePageIndex(): number {
    return this.activePageIndex;
  }

  async listTabs(): Promise<TabInfo[]> {
    if (!this.browser) throw new BrowserNotLaunchedError();
    const tabs: TabInfo[] = [];
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      tabs.push({
        tabIndex: i,
        url: page.url(),
        title: await page.title(),
        isActive: i === this.activePageIndex,
        isNew: this.newTabIndices.has(i),
      });
    }
    return tabs;
  }

  async switchTab(tabIndex: number): Promise<void> {
    if (!this.browser) throw new BrowserNotLaunchedError();
    if (tabIndex < 0 || tabIndex >= this.pages.length) {
      throw new TabIndexOutOfBoundsError(tabIndex, this.pages.length - 1);
    }
    this.activePageIndex = tabIndex;
    this.newTabIndices.delete(tabIndex);
    await this.pages[tabIndex].bringToFront();
  }

  async newTab(url?: string): Promise<number> {
    if (!this.browser || !this.context) throw new BrowserNotLaunchedError();
    this.suppressPageEvent = true;
    const page = await this.context.newPage();
    this.suppressPageEvent = false;
    const tabIndex = this.pages.length;
    this.pages.push(page);
    this.setupPageCloseListener(page);
    this.activePageIndex = tabIndex;
    if (url) {
      await page.goto(url);
    }
    return tabIndex;
  }

  async closeTab(tabIndex?: number): Promise<void> {
    if (!this.browser) throw new BrowserNotLaunchedError();
    const idx = tabIndex ?? this.activePageIndex;
    if (idx < 0 || idx >= this.pages.length) {
      throw new TabIndexOutOfBoundsError(idx, this.pages.length - 1);
    }

    const page = this.pages[idx];
    // page.close() triggers the 'close' event listener which handles
    // removing from pages[], adjusting activePageIndex, and reindexing
    await page.close();

    // If all tabs are gone, fully close browser
    if (this.pages.length === 0) {
      await this.close();
    }
  }

  getPageCount(): number {
    return this.pages.length;
  }

  async resize(options: { width?: number; height?: number; device?: string }): Promise<void> {
    if (!this.browser) throw new BrowserNotLaunchedError();
    const page = this.getActivePage();

    if (options.device && options.device !== 'desktop') {
      const playwrightName = DEVICE_PRESETS[options.device];
      if (playwrightName && devices[playwrightName]) {
        const descriptor = devices[playwrightName];
        if (descriptor.viewport) {
          await page.setViewportSize(
            this.clampViewport(descriptor.viewport.width, descriptor.viewport.height),
          );
          return;
        }
      }
    }

    const current = page.viewportSize() ?? { width: 1280, height: 720 };
    const width = options.width ?? current.width;
    const height = options.height ?? current.height;
    await page.setViewportSize(this.clampViewport(width, height));
  }

  getViewport(): { width: number; height: number } {
    if (!this.browser) throw new BrowserNotLaunchedError();
    const page = this.getActivePage();
    return page.viewportSize() ?? { width: 1280, height: 720 };
  }

  private setupNewPageListener(): void {
    if (!this.context) return;
    this.context.on('page', (page: Page) => {
      // Skip pages created internally via newTab() or launch()
      if (this.suppressPageEvent) return;
      const idx = this.pages.length;
      this.pages.push(page);
      this.newTabIndices.add(idx);
      this.setupPageCloseListener(page);
    });
  }

  private setupPageCloseListener(page: Page): void {
    page.on('close', () => {
      const currentIndex = this.pages.indexOf(page);
      if (currentIndex === -1) return;
      this.pages.splice(currentIndex, 1);
      this.newTabIndices.delete(currentIndex);

      const updated = new Set<number>();
      for (const i of this.newTabIndices) {
        if (i > currentIndex) updated.add(i - 1);
        else updated.add(i);
      }
      this.newTabIndices = updated;

      if (this.pages.length === 0) {
        this.activePageIndex = -1;
        return;
      }

      if (this.activePageIndex >= this.pages.length) {
        this.activePageIndex = this.pages.length - 1;
      } else if (this.activePageIndex > currentIndex) {
        this.activePageIndex--;
      }
    });
  }

  private clampViewport(width: number, height: number): { width: number; height: number } {
    return {
      width: this.clamp(width, VIEWPORT_CONSTRAINTS.MIN_WIDTH, VIEWPORT_CONSTRAINTS.MAX_WIDTH),
      height: this.clamp(height, VIEWPORT_CONSTRAINTS.MIN_HEIGHT, VIEWPORT_CONSTRAINTS.MAX_HEIGHT),
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
