const inheritedKeywords = new Set(['inherit', 'unset']);
const revertedKeywords = new Set(['revert', 'revert-layer']);
const boldElements = new Set(['b', 'strong', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'th']);
const italicElements = new Set(['i', 'em', 'cite', 'dfn', 'var', 'address']);

/** Normalize explicit weight/style resets while retaining descendant emphasis. */
export function prepareFontResets(html) {
  if (typeof DOMParser === 'undefined' || !/font-(?:weight|style)\s*:\s*initial(?![\w-])/i.test(html)) return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  if (![...document.body.querySelectorAll('[style]')].some(el => [el.style?.fontWeight, el.style?.fontStyle].some(value => value?.toLowerCase() === 'initial'))) return html;
  const nodes = [{ node: document.body, weight: false, style: false }];
  while (nodes.length) {
    const { node, weight, style } = nodes.pop();
    if (node.nodeType === 3) {
      if ((weight || style) && node.data) {
        const span = document.createElement('span');
        if (weight) span.style.fontWeight = 'normal';
        if (style) span.style.fontStyle = 'normal';
        node.replaceWith(span);
        span.append(node);
      }
      continue;
    }
    if (node.nodeType !== 1) continue;
    const reset = (property, inherited, semantic) => {
      const declared = node.style?.getPropertyValue(property).toLowerCase() || '';
      if (declared === 'initial') {
        node.style.setProperty(property, 'normal');
        return true;
      }
      if (inheritedKeywords.has(declared)) return inherited;
      if (!declared || revertedKeywords.has(declared)) {
        if (semantic && inherited) node.style?.setProperty(property, property === 'font-weight' ? 'bold' : 'italic');
        return semantic ? false : inherited;
      }
      if (inherited && declared === 'normal') return true;
      if (inherited && property === 'font-weight') {
        const numeric = Number(declared);
        if (declared === 'lighter' || (numeric > 0 && numeric < 600)) return true;
      }
      return false;
    };
    const nextWeight = reset('font-weight', weight, boldElements.has(node.localName));
    const nextStyle = reset('font-style', style, italicElements.has(node.localName));
    // Carry resets on inline text too: native list-item conversion does not
    // consistently propagate the item's run styles into nested lists.
    for (let i = node.childNodes.length - 1; i >= 0; i--) nodes.push({ node: node.childNodes[i], weight: nextWeight, style: nextStyle });
  }
  return document.body.innerHTML;
}
