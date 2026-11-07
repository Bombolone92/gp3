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

/**
 * Runs fn, which replaces root's contents. That would drop focus from a
 * search box, tab, chip, or sort button inside it, so remember where focus
 * was and put it back on the same control in the new nodes: the one with the
 * same data-key, or the only control of its kind and name. Repeated controls
 * (a "Check out" button on every row) are only matched by data-key, so focus
 * never jumps to another row's action; repeated form fields keep their place
 * when the list around them did not change.
 */
export function keepFocus(root, fn) {
  const focus = captureFocus(root);
  fn();
  if (focus) restoreFocus(root, focus);
}

const signature = (el) => [el.tagName, el.type || '', el.name || '', el.getAttribute('role') || '', el.getAttribute('aria-label') || '', el.getAttribute('placeholder') || ''].join('\u0000');
const isField = (el) => el.matches('input, select, textarea');
const alike = (root, f) => [...root.querySelectorAll(f.tag)].filter((x) => signature(x) === f.sig && (f.field || x.textContent === f.text));

function captureFocus(root) {
  const el = document.activeElement;
  if (!el || el === root || !root.contains(el)) return null;
  let sel = null;
  try {
    if (typeof el.selectionStart === 'number') sel = [el.selectionStart, el.selectionEnd, el.selectionDirection];
  } catch {}
  const f = { key: el.dataset?.key, tag: el.tagName, sig: signature(el), text: el.textContent, field: isField(el), value: el.value, sel };
  const like = alike(root, f);
  return { ...f, index: like.indexOf(el), count: like.length };
}

function restoreFocus(root, f) {
  let el = null;
  if (f.key != null) el = [...root.querySelectorAll('[data-key]')].find((x) => x.dataset.key === f.key && x.tagName === f.tag) || null;
  else {
    const like = alike(root, f);
    if (f.count === 1 && like.length === 1) el = like[0];
    else if (f.field && like.length === f.count) el = like[f.index];
  }
  if (!el || el === document.activeElement || root.contains(document.activeElement)) return;
  el.focus({ preventScroll: true });
  if (f.sel && el.value === f.value) {
    try {
      el.setSelectionRange(...f.sel);
    } catch {}
  }
}

export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
