/** Tiny element builder: el('button.btn.btn-primary', { onclick }, children...) */
export function el(spec, attrs = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'class') node.className = [node.className, v].filter(Boolean).join(' ');
    else if (k in node && k !== 'list' && k !== 'form' && !k.startsWith('aria') && k !== 'role') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

/** SVG markup string to a node. */
export function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstChild;
}

let uid = 0;
export function nextId(prefix = 'id') {
  return `${prefix}-${++uid}`;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Announce text to screen readers through the polite live region. */
export function announce(text) {
  const region = document.getElementById('sr-live');
  if (!region) return;
  region.textContent = '';
  setTimeout(() => { region.textContent = text; }, 30);
}

/** Download a Blob or string as a file. */
export function download(content, filename, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Pick a local file. Resolves to a File or null. */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * Describe the focused control well enough to find its counterpart after the
 * page is rebuilt: same tag, same accessible label or text, same row key,
 * and its position among controls that match all of those.
 */
function labelOf(n) {
  // A field labelled by a <label> gets a fresh generated id on every render,
  // so its label text identifies it, not its id.
  return n.getAttribute('aria-label') || (n.tagName === 'BUTTON' || n.tagName === 'A' ? n.textContent.trim().slice(0, 60) : '') || n.labels?.[0]?.textContent.trim().slice(0, 60) || n.id || n.getAttribute('placeholder') || '';
}

function focusSignature(el, root) {
  if (!el || el === document.body || !root.contains(el)) return null;
  const label = labelOf(el);
  const rowKey = el.closest('tr')?.dataset?.key || '';
  const sig = { tag: el.tagName, label, rowKey, role: el.getAttribute('role') || '', type: el.type || '' };
  sig.index = matches(root, sig).indexOf(el);
  sig.selection = typeof el.selectionStart === 'number' ? [el.selectionStart, el.selectionEnd] : null;
  return sig;
}

function matches(root, sig) {
  return [...root.querySelectorAll(sig.tag)].filter((n) => {
    const label = labelOf(n);
    return label === sig.label && (n.closest('tr')?.dataset?.key || '') === sig.rowKey && (n.getAttribute('role') || '') === sig.role && (n.type || '') === sig.type;
  });
}

/** Replace a container's content, keeping keyboard focus on the same control. */
export function swap(container, ...nodes) {
  const sig = focusSignature(document.activeElement, container);
  container.replaceChildren(...nodes);
  if (!sig) return;
  const list = matches(container, sig);
  const target = list[sig.index] || list[0];
  if (!target) return;
  target.focus({ preventScroll: true });
  if (sig.selection && typeof target.setSelectionRange === 'function') {
    try { target.setSelectionRange(...sig.selection); } catch {}
  }
}
