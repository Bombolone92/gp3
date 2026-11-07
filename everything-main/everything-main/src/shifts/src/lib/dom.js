/**
 * Minimal DOM helper. `el('div', { class: 'card', onClick: fn }, ...children)`.
 * Children may be nodes, strings, numbers, arrays, or null/undefined (skipped).
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') {
      node.className = value;
    } else if (key === 'value') {
      node.value = value;
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) node.style.setProperty(prop, v);
        else node.style[prop] = v;
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && key !== 'list' && typeof value !== 'string') {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? '' : value);
    }
  }
  append(node, children);
  return node;
}

function append(node, child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const c of child) append(node, c);
  } else if (child instanceof Node) {
    node.appendChild(child);
  } else {
    node.appendChild(document.createTextNode(String(child)));
  }
}

export function clear(node) {
  node.replaceChildren();
}

export function mount(container, ...children) {
  container.replaceChildren();
  append(container, children);
}
