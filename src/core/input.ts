import type { Page } from 'playwright';
import type { AccessibilityMap } from './accessibility.js';
import { ElementIndexOutOfBoundsError, AccessibilityMapRequiredError } from './errors.js';

export interface CoordinateTarget {
  x: number;
  y: number;
}

export interface ElementIndexTarget {
  elementIndex: number;
}

export type ClickTarget = CoordinateTarget | ElementIndexTarget;

export interface DragOperation {
  from: ClickTarget;
  to: ClickTarget;
}

export interface ScrollOptions {
  target?: ClickTarget;
  deltaX?: number;
  deltaY?: number;
}

function isElementIndexTarget(target: ClickTarget): target is ElementIndexTarget {
  return 'elementIndex' in target;
}

export class InputController {
  resolveTarget(
    target: ClickTarget,
    accessibilityMap?: AccessibilityMap,
  ): { x: number; y: number } {
    if (isElementIndexTarget(target)) {
      if (!accessibilityMap) {
        throw new AccessibilityMapRequiredError();
      }
      const element = accessibilityMap.elements.find((e) => e.index === target.elementIndex);
      if (!element) {
        const max =
          accessibilityMap.elements.length > 0
            ? accessibilityMap.elements[accessibilityMap.elements.length - 1].index
            : -1;
        throw new ElementIndexOutOfBoundsError(target.elementIndex, max);
      }
      return {
        x: element.bounds.x + element.bounds.width / 2,
        y: element.bounds.y + element.bounds.height / 2,
      };
    }
    return { x: target.x, y: target.y };
  }

  async click(page: Page, target: ClickTarget, accessibilityMap?: AccessibilityMap): Promise<void> {
    const { x, y } = this.resolveTarget(target, accessibilityMap);
    await page.mouse.click(x, y);
  }

  async doubleClick(
    page: Page,
    target: ClickTarget,
    accessibilityMap?: AccessibilityMap,
  ): Promise<void> {
    const { x, y } = this.resolveTarget(target, accessibilityMap);
    await page.mouse.dblclick(x, y);
  }

  async rightClick(
    page: Page,
    target: ClickTarget,
    accessibilityMap?: AccessibilityMap,
  ): Promise<void> {
    const { x, y } = this.resolveTarget(target, accessibilityMap);
    await page.mouse.click(x, y, { button: 'right' });
  }

  async drag(
    page: Page,
    operation: DragOperation,
    accessibilityMap?: AccessibilityMap,
  ): Promise<void> {
    const from = this.resolveTarget(operation.from, accessibilityMap);
    const to = this.resolveTarget(operation.to, accessibilityMap);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
  }

  async mouseMove(
    page: Page,
    target: ClickTarget,
    accessibilityMap?: AccessibilityMap,
  ): Promise<void> {
    const { x, y } = this.resolveTarget(target, accessibilityMap);
    await page.mouse.move(x, y);
  }

  async scroll(
    page: Page,
    options: ScrollOptions,
    accessibilityMap?: AccessibilityMap,
  ): Promise<void> {
    if (options.target) {
      const { x, y } = this.resolveTarget(options.target, accessibilityMap);
      await page.mouse.move(x, y);
    }
    await page.mouse.wheel(options.deltaX ?? 0, options.deltaY ?? 0);
  }

  async type(page: Page, text: string): Promise<void> {
    await page.keyboard.type(text);
  }

  async keyPress(page: Page, key: string): Promise<void> {
    await page.keyboard.press(key);
  }

  async hotkey(page: Page, keys: string[]): Promise<void> {
    const modifiers = keys.slice(0, -1);
    const finalKey = keys[keys.length - 1];

    for (const mod of modifiers) {
      await page.keyboard.down(mod);
    }
    await page.keyboard.press(finalKey);
    for (const mod of modifiers.reverse()) {
      await page.keyboard.up(mod);
    }
  }
}
