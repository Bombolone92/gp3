/**
 * A few DOM helpers. `h()` builds elements declaratively:
 *
 *   h('button', { class: 'btn', onclick: save, 'aria-label': 'Save' }, icon('check'), 'Save')
 *
 * Props: `class`, `style` (string or object), `dataset`, `ref` (called with
 * the element), `on<event>` handlers, booleans (true sets, false omits), and
 * anything else as an attribute. Children may be nodes, strings, numbers,
 * arrays, or null/false (skipped).
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) applyProps(el, props);
  append(el, children);
  return el;
}

export function applyProps(el, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class' || key === 'className') el.className = value;
    else if (key === 'style') {
      if (typeof value === 'string') el.style.cssText = value;
      else for (const [k, v] of Object.entries(value)) k.startsWith('--') ? el.style.setProperty(k, v) : (el.style[k] = v);
    } else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'ref') value(el);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value' && 'value' in el) el.value = value;
    else if (key === 'checked' || key === 'selected' || key === 'disabled' || key === 'hidden' || key === 'indeterminate') el[key] = !!value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
}

export function append(el, children) {
  for (const child of children) {
    if (child == null || child === false || child === true) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function replace(el, ...children) {
  clear(el);
  return append(el, children);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let uid = 0;
/** A unique DOM id for label/aria wiring. */
export const domId = (prefix = 'u') => `${prefix}-${++uid}`;

/** Debounce with flush() and cancel(). */
export function debounce(fn, ms) {
  let t = null;
  let lastArgs = null;
  const run = () => {
    t = null;
    const args = lastArgs;
    lastArgs = null;
    return fn(...args);
  };
  const d = (...args) => {
    lastArgs = args;
    clearTimeout(t);
    t = setTimeout(run, ms);
  };
  d.flush = () => (t ? (clearTimeout(t), run()) : undefined);
  d.cancel = () => {
    clearTimeout(t);
    t = null;
    lastArgs = null;
  };
  d.pending = () => t != null;
  return d;
}

/** Announce a message to screen readers through a polite live region. */
/**
 * Where messages that must stay perceivable go: the topmost open modal
 * dialog, since a modal makes the rest of the page inert (hidden from
 * screen readers, unclickable, under its backdrop), or else the body.
 */
export function liveContainer() {
  let modal = null;
  for (const d of document.querySelectorAll('dialog[open]')) {
    try {
      if (d.matches(':modal')) modal = d;
    } catch {
      /* no :modal support: dialogs here are always modal */
      modal = d;
    }
  }
  return modal || document.body;
}

export function announce(message) {
  let region = document.getElementById('sr-live');
  if (!region) region = h('div', { id: 'sr-live', class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const host = liveContainer();
  if (region.parentNode !== host) host.append(region);
  region.textContent = '';
  // A separate task so repeated identical messages are still read.
  setTimeout(() => (region.textContent = message), 30);
}

export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
export const modKey = () => (isMac() ? '⌘' : 'Ctrl');

/** True when keyboard focus is in a text-editing control. */
export function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** 'smooth', or 'auto' when the person asked for reduced motion (CSS
 *  cannot reach scrolls started from script). */
export function scrollMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}
