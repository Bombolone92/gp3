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
      for (const [prop, value] of Object.entries(v)) {
        if (value === null || value === undefined) continue;
        // Custom properties are invisible to CSSStyleDeclaration assignment
        // (`style['--x'] = …` is silently dropped), so they need setProperty.
        if (prop.startsWith('--')) node.style.setProperty(prop, value);
        else node.style[prop] = value;
      }
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

export function clear(node) {
  node.replaceChildren();
  return node;
}

/**
 * Guard a submit on a field that has to hold something, and say why when it
 * does not. Every one of these forms used to move focus to the field and stop
 * there, which reads as a button that does nothing — so the native bubble
 * carries the reason instead: it points at the field, needs no layout of its
 * own, and dismisses itself.
 *
 * The message is dropped the moment the field is edited, so it can never
 * outlive the mistake and reject a good value later.
 *
 * Returns the trimmed value, or '' — callers read:
 *   const name = requireValue(input, 'Name cannot be empty.');
 *   if (!name) return;
 */
export function requireValue(input, message) {
  const value = input.value.trim();
  input.setCustomValidity(value ? '' : message);
  if (value) return value;
  input.focus();
  input.reportValidity();
  input.addEventListener('input', () => input.setCustomValidity(''), { once: true });
  return '';
}
