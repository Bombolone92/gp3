/**
 * Minimal DOM helpers. `h('button.btn.primary', { onclick }, 'Save')` builds
 * an element; class names can be given in the tag, attributes and event
 * handlers in the props, and children as strings, nodes, arrays or falsy
 * values (skipped).
 */

export function h(spec, props, ...children) {
  if (props === null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    if (props !== undefined && props !== null) children.unshift(props);
    props = {};
  }
  const [tagAndId, ...classes] = spec.split('.');
  const [tag, id] = tagAndId.split('#');
  const el = tag === 'svg' || tag === 'path' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag || 'div');
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class' || k === 'className') {
      el.className = [el.className, v].filter(Boolean).join(' ');
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(el.style, v);
    } else if (k === 'dataset') {
      Object.assign(el.dataset, v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'html') {
      el.innerHTML = v;
    } else if (k === 'text') {
      el.textContent = v;
    } else if (k in el && typeof v !== 'string' && k !== 'list') {
      el[k] = v;
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function replace(el, ...children) {
  clear(el);
  return append(el, children);
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

let idCounter = 0;
export function uid(prefix = 'id') {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** Run once the browser is idle (or soon), for non-urgent work. */
export function idle(fn) {
  if (typeof requestIdleCallback === 'function') return requestIdleCallback(fn, { timeout: 500 });
  return setTimeout(fn, 1);
}

export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

/** Coalesce calls into one per animation frame. */
export function rafThrottle(fn) {
  let pending = false;
  let lastArgs = null;
  return (...args) => {
    lastArgs = args;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      fn(...lastArgs);
    });
  };
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
export const modKey = isMac ? '⌘' : 'Ctrl';

/**
 * Run `paint`, which rebuilds part of the page, and put keyboard focus back
 * on the same control if it was inside `root`: found by its data-key, its
 * link target, or its label. Without this, a live update repainting a list
 * drops a keyboard user's place to the top of the page.
 */
export function preserveFocus(root, paint) {
  const was = document.activeElement;
  if (!was || was === document.body || !root.contains(was)) return paint();
  const tag = was.tagName;
  const key = was.dataset.key;
  const href = was.getAttribute('href');
  // A field's button shows its value, which may be what changed: its
  // <label> names it better.
  const nameOf = (e) => e.getAttribute('aria-label') || [...(e.labels || [])].map((l) => l.textContent).join(' ').trim() || e.textContent.trim();
  const label = nameOf(was);
  const out = paint();
  if (was.isConnected) return out;
  const same = [...root.querySelectorAll(tag)];
  const next = (key && same.find((e) => e.dataset.key === key))
    || (href && same.find((e) => e.getAttribute('href') === href))
    || (label && same.find((e) => nameOf(e) === label));
  next?.focus({ preventScroll: true });
  return out;
}

/**
 * True while an input method is composing text (Chinese, Japanese, Korean
 * and others): Enter then confirms the composition and is not a command.
 */
export function composing(e) {
  return e.isComposing || e.keyCode === 229;
}

/** Visually hidden live region announcements for screen readers. */
let live = null;
export function announce(message, politeness = 'polite') {
  // While a modal dialog is open the page behind it is inert and not read
  // out, so the dialog has a region of its own.
  const dlg = [...document.querySelectorAll('dialog[open]')].pop();
  let region = dlg?.querySelector(':scope > .sr-live');
  if (!region) {
    if (!live || !live.isConnected) {
      live = h('div.sr-only', { 'aria-live': politeness, role: 'status' });
      document.body.appendChild(live);
    }
    region = live;
  }
  region.setAttribute('aria-live', politeness);
  region.textContent = '';
  setTimeout(() => {
    region.textContent = message;
  }, 30);
}
