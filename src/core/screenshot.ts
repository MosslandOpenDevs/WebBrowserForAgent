import type { Page } from 'playwright';
import { AccessibilityMapper, type AccessibilityMap } from './accessibility.js';
import { RecordingAlreadyActiveError } from './errors.js';

export interface ScreenshotResult {
  image: string;
  accessibilityMap?: AccessibilityMap;
  timestamp: number;
}

export interface RecordingOptions {
  fps: number;
  bufferSize?: number;
}

const MAX_FPS = 5;
const MIN_FPS = 1;
const DEFAULT_BUFFER_SIZE = 10;
const MIN_BUFFER_SIZE = 5;
const MAX_BUFFER_SIZE = 30;

export class ScreenshotEngine {
  private ringBuffer: (Buffer | null)[] = [];
  private bufferWriteIndex = 0;
  private frameCount = 0;
  private bufferSize = DEFAULT_BUFFER_SIZE;
  private recordingInterval: ReturnType<typeof setInterval> | null = null;
  private recording = false;
  private currentFps = 0;

  constructor(private accessibilityMapper: AccessibilityMapper) {}

  async capture(
    page: Page,
    viewport: { width: number; height: number },
    includeAccessibilityMap = true,
  ): Promise<ScreenshotResult> {
    let imageBuffer: Buffer;

    if (this.recording) {
      const latest = this.getLatestFrame();
      if (latest) {
        imageBuffer = latest;
      } else {
        imageBuffer = await page.screenshot({ type: 'png', fullPage: false });
      }
    } else {
      imageBuffer = await page.screenshot({ type: 'png', fullPage: false });
    }

    const result: ScreenshotResult = {
      image: imageBuffer.toString('base64'),
      timestamp: Date.now(),
    };

    if (includeAccessibilityMap) {
      result.accessibilityMap = await this.accessibilityMapper.generateMap(page, viewport);
    }

    return result;
  }

  async startRecording(page: Page, options: RecordingOptions): Promise<void> {
    if (this.recording) {
      throw new RecordingAlreadyActiveError();
    }

    const fps = Math.max(MIN_FPS, Math.min(MAX_FPS, Math.round(options.fps)));
    const bufferSize = Math.max(
      MIN_BUFFER_SIZE,
      Math.min(MAX_BUFFER_SIZE, options.bufferSize ?? DEFAULT_BUFFER_SIZE),
    );

    this.bufferSize = bufferSize;
    this.ringBuffer = new Array<Buffer | null>(bufferSize).fill(null);
    this.bufferWriteIndex = 0;
    this.frameCount = 0;
    this.currentFps = fps;
    this.recording = true;

    const intervalMs = Math.round(1000 / fps);
    this.recordingInterval = setInterval(async () => {
      try {
        await this.captureFrame(page);
      } catch {
        // Page may have navigated or closed; skip this frame
      }
    }, intervalMs);
  }

  async stopRecording(): Promise<void> {
    if (!this.recording) return;

    if (this.recordingInterval) {
      clearInterval(this.recordingInterval);
      this.recordingInterval = null;
    }

    this.recording = false;
    this.ringBuffer = [];
    this.bufferWriteIndex = 0;
    this.frameCount = 0;
    this.currentFps = 0;
  }

  getRecordingStatus(): { isRecording: boolean; fps?: number; frameCount?: number } {
    if (!this.recording) return { isRecording: false };
    return {
      isRecording: true,
      fps: this.currentFps,
      frameCount: this.frameCount,
    };
  }

  getLatestFrame(): Buffer | null {
    if (this.frameCount === 0) return null;
    const idx = (this.bufferWriteIndex - 1 + this.bufferSize) % this.bufferSize;
    return this.ringBuffer[idx];
  }

  private async captureFrame(page: Page): Promise<void> {
    const buffer = await page.screenshot({ type: 'png', fullPage: false });
    this.ringBuffer[this.bufferWriteIndex % this.bufferSize] = buffer;
    this.bufferWriteIndex = (this.bufferWriteIndex + 1) % this.bufferSize;
    this.frameCount++;
  }
}
