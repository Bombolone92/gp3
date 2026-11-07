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

/**
 * Children are written as `condition && el(...)`, so every falsy value a
 * short-circuit can yield is dropped, including 0 and ''. Numbers meant for
 * display are stringified at the call site.
 */
export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (!child) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

let counter = 0;
/** A fresh id for pairing a visible <label for> with its control. */
export function fieldId(prefix = 'f') {
  counter += 1;
  return `${prefix}-${counter}`;
}

/**
 * An inline validation line for one control: hidden until show() is given a
 * message, and wired to the input so a screen reader reads it with the field.
 */
export function inlineError(input) {
  const id = fieldId('err');
  const node = el('p.field-error', { id, hidden: true });
  const described = [input.getAttribute('aria-describedby'), id].filter(Boolean);
  input.setAttribute('aria-describedby', described.join(' '));
  return {
    node,
    show(message) {
      node.textContent = message || '';
      node.hidden = !message;
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
    },
  };
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

/** A labelled form field: label above control, optional hint and error line. */
export function field(label, control, { hint = null, error = null } = {}) {
  const id = control.id || fieldId();
  control.id = id;
  return el('div.field', {},
    el('label.field-label', { for: id }, label, hint && el('span.field-hint', {}, ` ${hint}`)),
    control,
    error?.node || null
  );
}
