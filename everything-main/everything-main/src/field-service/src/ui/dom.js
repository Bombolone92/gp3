/**
 * Minimal DOM builder. `h('div.card#main', { onClick }, ...children)`.
 * The tag may carry `.class` and `#id` shorthands. Children can be nodes,
 * strings, numbers, arrays, or null/undefined/false (skipped).
 */
export function h(tag, props, ...children) {
  if (props instanceof Node || typeof props === 'string' || typeof props === 'number' || Array.isArray(props)) {
    children.unshift(props);
    props = null;
  }
  let name = tag;
  let classes = '';
  let id = null;
  const m = /^([a-z0-9-]*)([.#][^\s]*)?$/i.exec(tag);
  if (m && m[2]) {
    name = m[1] || 'div';
    for (const part of m[2].match(/[.#][^.#]+/g) || []) {
      if (part[0] === '.') classes += (classes ? ' ' : '') + part.slice(1);
      else id = part.slice(1);
    }
  }
  const node = name === 'svg' || name === 'path' ? document.createElementNS('http://www.w3.org/2000/svg', name) : document.createElement(name || 'div');
  if (classes) node.className = classes;
  if (id) node.id = id;
  if (props) setProps(node, props);
  append(node, children);
  return node;
}

function setProps(node, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') {
      node.className = node.className ? `${node.className} ${value}` : value;
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key === 'style' && typeof value === 'object') {
      for (const [p, v] of Object.entries(value)) {
        if (v === null || v === undefined) continue;
        if (p.startsWith('--')) node.style.setProperty(p, v);
        else node.style[p] = v;
      }
    } else if (key === 'ref' && typeof value === 'function') {
      value(node);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'value' || key === 'checked' || key === 'selected' || key === 'indeterminate') {
      node[key] = value;
    } else if (key === 'html') {
      node.innerHTML = value;
    } else {
      node.setAttribute(key, value === true ? '' : value);
    }
  }
}

export function append(node, child) {
  if (child === null || child === undefined || child === false || child === true) return;
  if (Array.isArray(child)) {
    for (const c of child) append(node, c);
  } else if (child instanceof Node) {
    node.appendChild(child);
  } else {
    node.appendChild(document.createTextNode(String(child)));
  }
}

export function mount(container, ...children) {
  container.replaceChildren();
  append(container, children);
  return container;
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

export const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

/**
 * Redraw part of a page without dropping keyboard focus: if focus was on a
 * control inside `node` (a filter chip, a sort button), it goes back to the
 * control in the same place once redraw() has replaced them.
 */
export function keepFocus(node, redraw) {
  const el = document.activeElement;
  const at = el && el !== node && node.contains(el) ? [...node.querySelectorAll(FOCUSABLE)].indexOf(el) : -1;
  redraw();
  if (at >= 0 && !node.contains(el)) node.querySelectorAll(FOCUSABLE)[at]?.focus({ preventScroll: true });
}

let uid = 0;
export function uniqueId(prefix = 'id') {
  uid += 1;
  return `${prefix}-${uid}`;
}

/** Run fn at most once per animation frame. */
export function rafThrottle(fn) {
  let queued = false;
  let lastArgs;
  return (...args) => {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn(...lastArgs);
    });
  };
}

export function debounce(fn, ms) {
  let t;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

/** Keeps the focused element's identity across a re-render when possible. */
export function preserveScroll(scroller, fn) {
  const top = scroller?.scrollTop ?? 0;
  fn();
  if (scroller) scroller.scrollTop = top;
}

export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
