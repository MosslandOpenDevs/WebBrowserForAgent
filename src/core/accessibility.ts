import type { Page, Frame } from 'playwright';

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

/**
 * Pure-data view of the interactive elements on a page.
 *
 * This is intentionally a plain data shape so it can be constructed by hand
 * (e.g. in tests or by library consumers) and serialized without losing
 * information. `generateMap()` / `createAccessibilityMap()` return the richer
 * {@link QueryableAccessibilityMap}, which adds convenience lookup helpers.
 */
export interface AccessibilityMap {
  elements: AccessibilityElement[];
  totalCount: number;
  timestamp: number;
}

/** {@link AccessibilityMap} plus convenience lookup helpers. */
export interface QueryableAccessibilityMap extends AccessibilityMap {
  /** Find the first element whose name contains the given text (case-insensitive). */
  findByText(text: string): AccessibilityElement | undefined;

  /** Find all elements whose name contains the given text (case-insensitive). */
  findAllByText(text: string): AccessibilityElement[];

  /** Find the first element matching the given role (e.g., 'button', 'input[text]', 'link', 'clickable'). */
  findByRole(role: string): AccessibilityElement | undefined;

  /** Find all elements matching the given role. */
  findAllByRole(role: string): AccessibilityElement[];

  /** Find an element by its index number. */
  findByIndex(index: number): AccessibilityElement | undefined;
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

// Temporary attributes used to bind a DOM element to its extracted metadata by
// index. Each extraction pass tags the elements it keeps, then fetches handles
// via the attribute so metadata and coordinates are keyed to the SAME node
// (never paired by array position, which desyncs if the DOM mutates).
const MARKER_STANDARD = 'data-a11y-el';
const MARKER_CLICKABLE = 'data-a11y-clickable';

export function createAccessibilityMap(
  elements: AccessibilityElement[],
): QueryableAccessibilityMap {
  const lowerName = (el: AccessibilityElement) => el.name.toLowerCase();

  return {
    elements,
    // Getter so totalCount can never desync from the elements array.
    get totalCount() {
      return elements.length;
    },
    timestamp: Date.now(),

    findByText(text: string): AccessibilityElement | undefined {
      const t = text.toLowerCase();
      return elements.find((el) => lowerName(el).includes(t));
    },

    findAllByText(text: string): AccessibilityElement[] {
      const t = text.toLowerCase();
      return elements.filter((el) => lowerName(el).includes(t));
    },

    findByRole(role: string): AccessibilityElement | undefined {
      return elements.find((el) => el.role === role);
    },

    findAllByRole(role: string): AccessibilityElement[] {
      return elements.filter((el) => el.role === role);
    },

    findByIndex(index: number): AccessibilityElement | undefined {
      return elements.find((el) => el.index === index);
    },
  };
}

export class AccessibilityMapper {
  async generateMap(
    page: Page,
    viewport: { width: number; height: number },
  ): Promise<QueryableAccessibilityMap> {
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

    return createAccessibilityMap(elements);
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
    let metadata: RawElementData[];
    try {
      // Single round-trip: tag every visible matching element with an index
      // marker and collect its metadata keyed to that same index.
      metadata = (await frame.evaluate(
        ({ sel, marker }) => {
          const results: unknown[] = [];
          const els = document.querySelectorAll(sel);
          let idx = 0;
          els.forEach((el) => {
            const htmlEl = el as HTMLElement;
            const style = window.getComputedStyle(htmlEl);
            const isHidden =
              style.display === 'none' ||
              style.visibility === 'hidden' ||
              style.opacity === '0' ||
              htmlEl.offsetWidth === 0 ||
              htmlEl.offsetHeight === 0;
            if (isHidden) return;

            const inputEl = el as HTMLInputElement;
            const selectEl = el as HTMLSelectElement;
            el.setAttribute(marker, String(idx));
            idx++;
            results.push({
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
              isCursorPointer: false,
            });
          });
          return results;
        },
        { sel: selector, marker: MARKER_STANDARD },
      )) as RawElementData[];
    } catch {
      return [];
    }

    return this.resolveMarked(frame, MARKER_STANDARD, metadata, viewport, frameId);
  }

  private async extractClickableElements(
    frame: Frame,
    viewport: { width: number; height: number },
    frameId: string,
  ): Promise<AccessibilityElement[]> {
    let metadata: RawElementData[];
    try {
      // Single DOM walk that both tags elements and collects their metadata,
      // so the two can never diverge (previously two separate walks could
      // select different sets and misalign metadata with coordinates).
      metadata = (await frame.evaluate(
        ({ interactiveSelector, marker }) => {
          if (!document.body) return [];
          const interactiveEls = new Set<Element>(
            Array.from(document.querySelectorAll(interactiveSelector)),
          );
          const results: unknown[] = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
          let node: Node | null = walker.nextNode();
          let idx = 0;

          while (node) {
            const el = node as HTMLElement;
            if (interactiveEls.has(el)) {
              node = walker.nextNode();
              continue;
            }

            const style = window.getComputedStyle(el);
            const hasPointer = style.cursor === 'pointer';
            const hasOnClick =
              el.hasAttribute('onclick') ||
              el.hasAttribute('ng-click') ||
              el.hasAttribute('@click');

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

            // Skip a wrapper whose text is identical to its interactive child's
            // (avoid duplicating what pass 1 already captured). Use the SAME
            // truncation on both sides so the comparison is consistent.
            const interactiveChild = el.querySelector(interactiveSelector);
            if (interactiveChild) {
              const childText = ((interactiveChild as HTMLElement).innerText || '')
                .trim()
                .substring(0, 100);
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
              el.setAttribute(marker, String(idx));
              idx++;
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
                isCursorPointer: true,
              });
            }

            node = walker.nextNode();
          }

          return results;
        },
        { interactiveSelector: INTERACTIVE_SELECTORS, marker: MARKER_CLICKABLE },
      )) as RawElementData[];
    } catch {
      return [];
    }

    return this.resolveMarked(frame, MARKER_CLICKABLE, metadata, viewport, frameId);
  }

  /**
   * Fetch handles for elements tagged with `marker`, compute their bounding
   * boxes concurrently, pair each handle with its own metadata (by the marker's
   * index value, never by array position), then strip the markers.
   */
  private async resolveMarked(
    frame: Frame,
    marker: string,
    metadata: RawElementData[],
    viewport: { width: number; height: number },
    frameId: string,
  ): Promise<AccessibilityElement[]> {
    const elements: AccessibilityElement[] = [];
    try {
      const handles = await frame.$$(`[${marker}]`);
      // Concurrent bounding-box resolution: one batched wait instead of N
      // serial CDP round-trips. boundingBox() returns main-frame-relative
      // coordinates (required for iframe elements), so keep using it.
      const [boxes, indices] = await Promise.all([
        Promise.all(handles.map((h) => h.boundingBox().catch(() => null))),
        Promise.all(handles.map((h) => h.getAttribute(marker))),
      ]);

      for (let i = 0; i < handles.length; i++) {
        const box = boxes[i];
        const rawIndex = indices[i] === null ? -1 : Number(indices[i]);
        const raw = metadata[rawIndex];
        if (!box || !raw) continue;
        const el = this.buildElement(raw, box, viewport, frameId);
        if (el) elements.push(el);
      }
    } catch {
      // Frame may have been detached during extraction
    } finally {
      try {
        await frame.evaluate((m) => {
          document.querySelectorAll(`[${m}]`).forEach((el) => el.removeAttribute(m));
        }, marker);
      } catch {
        /* ignore cleanup failure */
      }
    }
    return elements;
  }

  private buildElement(
    raw: RawElementData,
    box: { x: number; y: number; width: number; height: number },
    viewport: { width: number; height: number },
    frameId: string,
  ): AccessibilityElement | null {
    // Exclude elements fully outside the viewport
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
