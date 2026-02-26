export class BrowserNotLaunchedError extends Error {
  constructor() {
    super('Browser is not launched. Call browser_launch first.');
    this.name = 'BrowserNotLaunchedError';
  }
}

export class NoActivePageError extends Error {
  constructor() {
    super('No active page available. All tabs may have been closed.');
    this.name = 'NoActivePageError';
  }
}

export class TabIndexOutOfBoundsError extends Error {
  constructor(index: number, max: number) {
    super(`Tab index ${index} is out of bounds. Valid range: 0-${max}.`);
    this.name = 'TabIndexOutOfBoundsError';
  }
}

export class ElementIndexOutOfBoundsError extends Error {
  constructor(index: number, max: number) {
    super(
      `Element index ${index} is out of bounds. Valid range: 0-${max}. Re-fetch the accessibility map.`,
    );
    this.name = 'ElementIndexOutOfBoundsError';
  }
}

export class AccessibilityMapRequiredError extends Error {
  constructor() {
    super(
      'elementIndex was provided but no accessibility map is available. Take a screenshot first.',
    );
    this.name = 'AccessibilityMapRequiredError';
  }
}

export class RecordingAlreadyActiveError extends Error {
  constructor() {
    super('Recording is already in progress. Stop it before starting a new one.');
    this.name = 'RecordingAlreadyActiveError';
  }
}
