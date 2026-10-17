/** Get an element by id or fail loudly at boot. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

export function all<T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

/** Create an element with attributes and children. Text is always set as text, never parsed as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | number | ((e: Event) => void)> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false) el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Set text only when it changed (avoids layout work every tick). */
export function text(el: HTMLElement, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

export function attr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

export function svgIcon(d: string, cls = 'ic'): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

export const ICONS = {
  retry: 'M20 12a8 8 0 1 1-3-6.2M20 4v5h-5',
  play: 'M7 4l13 8-13 8z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  blocked: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M6 6l12 12',
  mic: 'M9 3h6v11H9zM5 11a7 7 0 0 0 14 0M12 18v3M8 21h8',
};
