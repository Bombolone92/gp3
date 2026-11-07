const keywords = new Set(['initial', 'inherit', 'unset', 'revert', 'revert-layer']);
const monospaceElements = new Set(['code', 'pre', 'kbd', 'samp', 'tt']);

/** Resolve CSS-wide family keywords before they become literal DOCX font names. */
export function prepareFontFamilies(html) {
  if (typeof DOMParser === 'undefined' || !/font-family\s*:\s*(?:initial|inherit|unset|revert(?:-layer)?)(?![\w-])/i.test(html)) return null;
  const document = new DOMParser().parseFromString(html, 'text/html');
  if (![...document.body.querySelectorAll('[style]')].some(el => keywords.has(el.style?.fontFamily?.toLowerCase()))) return null;
  let marker;
  do { marker = `SDIMPORTFONT${crypto.randomUUID().replaceAll('-', '')}X`; } while (html.includes(marker));
  const nodes = [{ node: document.body, family: marker, active: false }];
  while (nodes.length) {
    let { node, family, active } = nodes.pop();
    if (node.nodeType === 3) {
      if (active && node.data) {
        const span = document.createElement('span');
        span.style.fontFamily = family;
        node.replaceWith(span);
        span.append(node);
      }
      continue;
    }
    if (node.nodeType !== 1) continue;
    const inherited = family, semantic = monospaceElements.has(node.localName) ? 'monospace' : inherited;
    family = semantic;
    // The legacy face attribute supplies an author-level inheritance value.
    // Reverting an origin discards this hint; reverting a layer retains it.
    if (node.localName === 'font' && node.hasAttribute('face')) {
      const probe = document.createElement('span');
      probe.style.fontFamily = node.getAttribute('face');
      family = probe.style.fontFamily || family;
    }
    const declared = node.style?.fontFamily || '', keyword = declared.toLowerCase();
    if (keywords.has(keyword)) {
      active = true;
      if (keyword === 'initial') family = marker;
      else if (keyword === 'inherit' || keyword === 'unset') family = inherited;
      else if (keyword === 'revert') family = semantic;
      node.style.setProperty('font-family', family);
    } else if (declared) family = declared;
    // Inline spans also preserve effective family inheritance across list items,
    // where the native converter can otherwise lose the containing run styles.
    for (let i = node.childNodes.length - 1; i >= 0; i--) nodes.push({ node: node.childNodes[i], family, active });
  }
  return { html: document.body.innerHTML, marker };
}

/** Default families use the document's existing defaults, never a marker name. */
export function restoreFontFamilies(result, marker) {
  const pending = [result?.fragment];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    const props = value.kind === 'run' ? value.run?.props : null;
    if (props?.fontFamily === marker) delete props.fontFamily;
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child);
  }
  return result;
}
