import type { Page, Frame, ElementHandle } from 'playwright';

export interface AccessibilityElement {
  index: number;
  role: string;
  name: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  attributes: Record<string, string>;
  frameId: string;
}

export interface AccessibilityMap {
  elements: AccessibilityElement[];
  totalCount: number;
  timestamp: number;
}

interface RawElementData {
  tagName: string;
  type: string;
  role: string;
  innerText: string;
  ariaLabel: string;
  placeholder: string;
  href: string;
  checked: boolean | null;
  value: string;
  options: string[];
  contentEditable: boolean;
  isHidden: boolean;
  isCursorPointer: boolean;
}

const INTERACTIVE_SELECTORS = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[tabindex]',
  '[contenteditable="true"]',
].join(', ');

export class AccessibilityMapper {
  async generateMap(
    page: Page,
    viewport: { width: number; height: number },
  ): Promise<AccessibilityMap> {
    const elements: AccessibilityElement[] = [];
    const frames = page.frames();

    for (const frame of frames) {
      const frameId = this.getFrameId(frame, page);
      try {
        const frameElements = await this.extractFromFrame(frame, frameId, viewport);
        elements.push(...frameElements);
      } catch {
        // Frame may have been detached during extraction
      }
    }

    // Assign sequential indices
    for (let i = 0; i < elements.length; i++) {
      elements[i].index = i;
    }

    return {
      elements,
      totalCount: elements.length,
      timestamp: Date.now(),
    };
  }

  private async extractFromFrame(
    frame: Frame,
    frameId: string,
    viewport: { width: number; height: number },
  ): Promise<AccessibilityElement[]> {
    const elements: AccessibilityElement[] = [];

    // Pass 1: Standard interactive selectors
    const pass1Elements = await this.extractBySelector(
      frame,
      INTERACTIVE_SELECTORS,
      viewport,
      frameId,
    );
    elements.push(...pass1Elements);

    // Pass 2: Non-standard clickable elements (cursor:pointer, onclick, etc.)
    // that were NOT already captured by pass 1
    const pass2Elements = await this.extractClickableElements(frame, viewport, frameId);
    elements.push(...pass2Elements);

    return elements;
  }

  private async extractBySelector(
    frame: Frame,
    selector: string,
    viewport: { width: number; height: number },
    frameId: string,
  ): Promise<AccessibilityElement[]> {
    const elements: AccessibilityElement[] = [];

    let handles: ElementHandle<Node>[];
    try {
      handles = await frame.$$(selector);
    } catch {
      return elements;
    }

    const rawDataList = await frame.evaluate((sel: string) => {
      const els = document.querySelectorAll(sel);
      return Array.from(els).map((el) => {
        const htmlEl = el as HTMLElement;
        const inputEl = el as HTMLInputElement;
        const selectEl = el as HTMLSelectElement;
        const style = window.getComputedStyle(htmlEl);
        const isHidden =
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.opacity === '0' ||
          htmlEl.offsetWidth === 0 ||
          htmlEl.offsetHeight === 0;

        return {
          tagName: htmlEl.tagName.toLowerCase(),
          type: inputEl.type || '',
          role: htmlEl.getAttribute('role') || '',
          innerText: (htmlEl.innerText || '').trim().substring(0, 100),
          ariaLabel: htmlEl.getAttribute('aria-label') || '',
          placeholder: inputEl.placeholder || '',
          href: (el as HTMLAnchorElement).href || '',
          checked: 'checked' in inputEl ? inputEl.checked : null,
          value: inputEl.value || '',
          options:
            htmlEl.tagName === 'SELECT' ? Array.from(selectEl.options).map((o) => o.text) : [],
          contentEditable: htmlEl.contentEditable === 'true',
          isHidden,
          isCursorPointer: false,
        };
      });
    }, selector);

    for (let i = 0; i < handles.length; i++) {
      const raw = rawDataList[i] as RawElementData;
      if (raw.isHidden) continue;

      const el = await this.rawToElement(handles[i], raw, viewport, frameId);
      if (el) elements.push(el);
    }

    return elements;
  }

  private async extractClickableElements(
    frame: Frame,
    viewport: { width: number; height: number },
    frameId: string,
  ): Promise<AccessibilityElement[]> {
    const elements: AccessibilityElement[] = [];

    // Find elements with cursor:pointer that are NOT standard interactive elements
    // and have meaningful text content (to avoid catching every styled container)
    let clickableData: RawElementData[];
    try {
      clickableData = await frame.evaluate((interactiveSelector: string) => {
        const interactiveEls = new Set<Element>(
          Array.from(document.querySelectorAll(interactiveSelector)),
        );
        const results: Array<{
          tagName: string;
          type: string;
          role: string;
          innerText: string;
          ariaLabel: string;
          placeholder: string;
          href: string;
          checked: boolean | null;
          value: string;
          options: string[];
          contentEditable: boolean;
          isHidden: boolean;
          isCursorPointer: boolean;
        }> = [];

        // Walk all elements and check for cursor:pointer
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let node: Node | null = walker.nextNode();
        const seen = new Set<Element>();

        while (node) {
          const el = node as HTMLElement;
          // Skip if already in interactive set or already processed
          if (interactiveEls.has(el) || seen.has(el)) {
            node = walker.nextNode();
            continue;
          }

          const style = window.getComputedStyle(el);
          const hasPointer = style.cursor === 'pointer';
          const hasOnClick =
            el.hasAttribute('onclick') || el.hasAttribute('ng-click') || el.hasAttribute('@click');

          if (!hasPointer && !hasOnClick) {
            node = walker.nextNode();
            continue;
          }

          // Must have direct text or aria-label, and not be a huge container
          const directText = (el.innerText || '').trim().substring(0, 100);
          const ariaLabel = el.getAttribute('aria-label') || '';
          if (!directText && !ariaLabel) {
            node = walker.nextNode();
            continue;
          }

          // Skip if a child of this element is already interactive (avoid duplicating parent)
          const hasInteractiveChild = el.querySelector(interactiveSelector);

          // Only include leaf-like clickable elements or elements whose text differs from their interactive children
          if (hasInteractiveChild) {
            const childText = (hasInteractiveChild as HTMLElement).innerText?.trim() || '';
            if (childText === directText) {
              node = walker.nextNode();
              continue;
            }
          }

          const isHidden =
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.opacity === '0' ||
            el.offsetWidth === 0 ||
            el.offsetHeight === 0;

          if (!isHidden) {
            seen.add(el);
            results.push({
              tagName: el.tagName.toLowerCase(),
              type: '',
              role: el.getAttribute('role') || '',
              innerText: directText,
              ariaLabel,
              placeholder: '',
              href: '',
              checked: null,
              value: '',
              options: [],
              contentEditable: false,
              isHidden: false,
              isCursorPointer: true,
            });
          }

          node = walker.nextNode();
        }

        return results;
      }, INTERACTIVE_SELECTORS);
    } catch {
      return elements;
    }

    // Now get handles for these elements to compute bounding boxes
    // We use a different approach: evaluate returns data, then we re-query by matching
    // Actually, we need handles. Let's use a marker approach.
    try {
      // Mark clickable elements with a temporary data attribute
      await frame.evaluate((interactiveSelector: string) => {
        const interactiveEls = new Set<Element>(
          Array.from(document.querySelectorAll(interactiveSelector)),
        );
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let node: Node | null = walker.nextNode();
        let idx = 0;
        const seen = new Set<Element>();

        while (node) {
          const el = node as HTMLElement;
          if (interactiveEls.has(el) || seen.has(el)) {
            node = walker.nextNode();
            continue;
          }

          const style = window.getComputedStyle(el);
          const hasPointer = style.cursor === 'pointer';
          const hasOnClick =
            el.hasAttribute('onclick') || el.hasAttribute('ng-click') || el.hasAttribute('@click');

          if (!hasPointer && !hasOnClick) {
            node = walker.nextNode();
            continue;
          }

          const directText = (el.innerText || '').trim();
          const ariaLabel = el.getAttribute('aria-label') || '';
          if (!directText && !ariaLabel) {
            node = walker.nextNode();
            continue;
          }

          const hasInteractiveChild = el.querySelector(interactiveSelector);
          if (hasInteractiveChild) {
            const childText = (hasInteractiveChild as HTMLElement).innerText?.trim() || '';
            if (childText === directText) {
              node = walker.nextNode();
              continue;
            }
          }

          const isHidden =
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.opacity === '0' ||
            el.offsetWidth === 0 ||
            el.offsetHeight === 0;

          if (!isHidden) {
            seen.add(el);
            el.setAttribute('data-a11y-clickable', String(idx));
            idx++;
          }

          node = walker.nextNode();
        }
      }, INTERACTIVE_SELECTORS);

      const handles = await frame.$$('[data-a11y-clickable]');

      for (let i = 0; i < handles.length && i < clickableData.length; i++) {
        const raw = clickableData[i];
        const el = await this.rawToElement(handles[i], raw, viewport, frameId);
        if (el) elements.push(el);
      }

      // Clean up markers
      await frame.evaluate(() => {
        document.querySelectorAll('[data-a11y-clickable]').forEach((el) => {
          el.removeAttribute('data-a11y-clickable');
        });
      });
    } catch {
      // Cleanup on error
      try {
        await frame.evaluate(() => {
          document.querySelectorAll('[data-a11y-clickable]').forEach((el) => {
            el.removeAttribute('data-a11y-clickable');
          });
        });
      } catch {
        /* ignore */
      }
    }

    return elements;
  }

  private async rawToElement(
    handle: ElementHandle<Node>,
    raw: RawElementData,
    viewport: { width: number; height: number },
    frameId: string,
  ): Promise<AccessibilityElement | null> {
    let box;
    try {
      box = await handle.boundingBox();
    } catch {
      return null;
    }
    if (!box) return null;

    if (
      box.x + box.width < 0 ||
      box.y + box.height < 0 ||
      box.x > viewport.width ||
      box.y > viewport.height
    ) {
      return null;
    }

    const role = this.determineRole(raw);
    const name = this.determineName(raw);
    const attributes = this.extractAttributes(raw);
    if (raw.isCursorPointer) attributes.clickable = 'true';

    return {
      index: 0,
      role,
      name,
      bounds: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
      attributes,
      frameId,
    };
  }

  private determineRole(raw: RawElementData): string {
    if (raw.role) return raw.role;
    switch (raw.tagName) {
      case 'a':
        return 'link';
      case 'button':
        return 'button';
      case 'select':
        return 'select';
      case 'textarea':
        return 'textarea';
      case 'input': {
        const type = raw.type || 'text';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'submit' || type === 'button') return 'button';
        return `input[${type}]`;
      }
      default:
        if (raw.contentEditable) return 'contenteditable';
        if (raw.isCursorPointer) return 'clickable';
        return raw.tagName;
    }
  }

  private determineName(raw: RawElementData): string {
    return raw.ariaLabel || raw.innerText || raw.placeholder || raw.value || '';
  }

  private extractAttributes(raw: RawElementData): Record<string, string> {
    const attrs: Record<string, string> = {};
    if (raw.href) attrs.href = raw.href;
    if (raw.placeholder) attrs.placeholder = raw.placeholder;
    if (raw.checked !== null) attrs.checked = raw.checked ? 'checked' : 'unchecked';
    if (raw.options.length > 0) attrs.options = JSON.stringify(raw.options);
    if (raw.value && raw.tagName === 'input') attrs.value = raw.value;
    return attrs;
  }

  private getFrameId(frame: Frame, page: Page): string {
    if (frame === page.mainFrame()) return 'main';
    const name = frame.name();
    if (name) return `iframe#${name}`;
    const url = frame.url();
    if (url && url !== 'about:blank') {
      try {
        const parsed = new URL(url);
        return `iframe[${parsed.pathname}]`;
      } catch {
        return `iframe[${url.substring(0, 50)}]`;
      }
    }
    return `iframe[${page.frames().indexOf(frame)}]`;
  }

  static formatAsText(map: AccessibilityMap): string {
    if (map.elements.length === 0) {
      return '[Accessibility Map - 0 elements]';
    }

    const byFrame = new Map<string, AccessibilityElement[]>();
    for (const el of map.elements) {
      const list = byFrame.get(el.frameId) ?? [];
      list.push(el);
      byFrame.set(el.frameId, list);
    }

    const sections: string[] = [];
    for (const [frameId, elements] of byFrame) {
      const header = `[Accessibility Map - ${elements.length} element${elements.length > 1 ? 's' : ''}, frame: ${frameId}]`;
      const lines = elements.map((el) => {
        const attrs = Object.entries(el.attributes)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');
        const attrStr = attrs ? ` - ${attrs}` : '';
        return `[${el.index}] ${el.role} "${el.name}" @ (${el.bounds.x}, ${el.bounds.y}, ${el.bounds.width}, ${el.bounds.height})${attrStr}`;
      });
      sections.push([header, ...lines].join('\n'));
    }

    return sections.join('\n\n');
  }
}
