/** Tiny DOM helpers so the UI can be written without a framework. */
export type Child = Node | string | number | null | undefined | false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Props = Record<string, any> | null;

function apply(node: Element, props: Props): void {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      node.setAttribute('class', String(value));
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign((node as HTMLElement).style, value);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign((node as HTMLElement).dataset, value);
    } else if (key === 'value' && 'value' in node) {
      (node as HTMLInputElement).value = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
}

export function append(node: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'object' ? child : String(child));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  apply(node, props ?? null);
  append(node, children);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  props?: Props,
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  apply(node, props ?? null);
  append(node, children);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
