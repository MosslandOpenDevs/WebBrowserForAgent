export {
  BrowserManager,
  type BrowserLaunchOptions,
  type TabInfo,
  VIEWPORT_CONSTRAINTS,
  DEVICE_PRESETS,
} from './core/browser.js';

export {
  ScreenshotEngine,
  type ScreenshotResult,
  type RecordingOptions,
} from './core/screenshot.js';

export {
  AccessibilityMapper,
  type AccessibilityElement,
  type AccessibilityMap,
} from './core/accessibility.js';

export {
  InputController,
  type ClickTarget,
  type CoordinateTarget,
  type ElementIndexTarget,
  type DragOperation,
  type ScrollOptions,
} from './core/input.js';

export {
  BrowserNotLaunchedError,
  NoActivePageError,
  TabIndexOutOfBoundsError,
  ElementIndexOutOfBoundsError,
  AccessibilityMapRequiredError,
  RecordingAlreadyActiveError,
} from './core/errors.js';
