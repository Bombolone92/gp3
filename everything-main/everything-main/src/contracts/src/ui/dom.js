/** Tiny element builder: el('button.btn.btn-primary', { onclick }, children...) */
export function el(spec, attrs = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');

  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v);
    } else if (k === 'html') {
      node.innerHTML = v;
    } else if (k === 'dataset') {
      Object.assign(node.dataset, v);
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(node.style, v);
    } else if (k in node && k !== 'list' && k !== 'form') {
      // Properties take false as a value (checked, spellcheck, ...);
      // only plain attributes treat false as "omit".
      node[k] = v;
    } else {
      if (v === false) continue;
      node.setAttribute(k, v === true ? '' : v);
    }
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

/**
 * Redraw `root` without throwing the keyboard away.
 *
 * These views rebuild wholesale on every store change, which destroys the
 * control the user just used — the checkbox they ticked — and drops focus to
 * the body. For anyone on a keyboard that means tabbing back from the top of
 * the page after every single action.
 *
 * The same control is preferred, matched by id across the rebuild. When the
 * action removed it outright (ticking a one-off duty takes it out of the open
 * list) the `fallback` selector picks whatever slid into its place, so focus
 * stays where the user's attention already is.
 */
export function preservingFocus(root, draw, { fallback = null } = {}) {
  const active = document.activeElement;
  const inside = !!active && root.contains(active);
  const id = inside && active.id ? active.id : null;
  const peers = inside && fallback ? [...root.querySelectorAll(fallback)] : [];
  const index = peers.indexOf(active);

  draw();

  if (!inside) return;
  const same = id && root.querySelector(`#${CSS.escape(id)}`);
  if (same) {
    same.focus();
    return;
  }
  if (index === -1) return;
  const remaining = [...root.querySelectorAll(fallback)];
  if (remaining.length) remaining[Math.min(index, remaining.length - 1)].focus();
}
