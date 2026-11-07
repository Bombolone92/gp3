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
        // A CSS custom property is not an IDL attribute on the style object,
        // so assigning it there does nothing at all: it lands as a plain
        // expando and the declaration is never written. Every avatar built
        // this way fell back to the default hue, which is why senders in the
        // reader were all the same blue while the same senders in the list --
        // set through setProperty -- each had their own colour.
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

// Children are written as `condition && el(...)`, so every falsy value a
// short-circuit can yield has to be dropped, not just `false`.
export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (!child) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}
