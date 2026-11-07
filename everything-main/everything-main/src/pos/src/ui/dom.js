/** Tiny element builder: el('button.btn.btn-primary', { onclick }, children...) */
export function el(spec, attrs = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');

  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v);
    } else if (k === 'html') {
      node.innerHTML = v;
    } else if (k === 'dataset') {
      Object.assign(node.dataset, v);
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(node.style, v);
    } else if (k in node && k !== 'list' && k !== 'form') {
      node[k] = v;
    } else {
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

export function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  append(node, children);
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

/**
 * Rebuild a group of controls in place without dropping keyboard focus.
 *
 * Chip rows, segmented controls, quantity steppers and whole sheet bodies
 * re-render here by clearing their container and building it again, so the
 * control the user just activated no longer exists by the time the handler
 * returns: focus falls to <body>, and a keyboard or screen-reader user has
 * to Tab in from the top of the dialog after every single choice. The
 * rebuild is deterministic, so whatever now sits in the same position is
 * that control's replacement.
 *
 * Nothing is forced: focus is handed back only when it was inside
 * `container` to begin with, and when the render didn't deliberately place
 * it somewhere else (a picker that focuses its own field keeps it).
 */
export function keepFocus(container, render) {
  const path = focusPath(container);
  render();
  const active = document.activeElement;
  if (path && (!active || active === document.body)) restoreFocus(container, path);
}

/** Child-element indexes from `container` down to whatever holds focus. */
function focusPath(container) {
  const active = document.activeElement;
  if (!active || active === container || !container.contains(active)) return null;
  const path = [];
  for (let node = active; node && node !== container; node = node.parentElement) {
    path.unshift([...node.parentElement.children].indexOf(node));
  }
  return path;
}

/**
 * Focus what now sits at `path` - or, when that can't take it (a stepper
 * button the last press disabled, a chip the rebuild dropped), the nearest
 * control beside it. Landing near where you were beats landing on <body>.
 */
function restoreFocus(container, path) {
  let node = container;
  for (const index of path) {
    node = node.children[index];
    if (!node) return;
  }
  node.focus();
  if (document.activeElement === node) return;
  for (const sibling of node.parentElement?.children || []) {
    if (sibling === node) continue;
    sibling.focus();
    if (document.activeElement === sibling) return;
  }
}
