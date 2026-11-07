const logical = new Set(['initial', 'start', 'end', 'match-parent']);
const inherited = new Set(['inherit', 'unset']);
const directions = new Set(['ltr', 'rtl', 'auto']);
const excluded = new Set(['bdi', 'script', 'style', 'textarea']);
const alignElements = new Set(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th']);
const blocks = 'p,h1,h2,h3,h4,h5,h6,div,ul,ol,table,pre,blockquote,hr,section,article,header,footer,address,dl,dt,dd,figure,figcaption,details,summary';
const physical = (alignment, direction) => alignment === 'start' ? (direction === 'rtl' ? 'right' : 'left')
  : alignment === 'end' ? (direction === 'rtl' ? 'left' : 'right') : alignment;

// Native list/cell conversion ignores alignment on anonymous paragraphs. Make
// only those inline groups explicit, leaving existing block boundaries intact.
function alignInlineGroups(element, alignment) {
  let group = [];
  const flush = () => {
    if (group.some(node => node.textContent.trim() || (node.nodeType === 1 && (node.matches('img,br') || node.querySelector('img,br'))))) {
      const paragraph = element.ownerDocument.createElement('p');
      paragraph.style.textAlign = alignment;
      group[0].before(paragraph);
      for (const node of group) paragraph.append(node);
    }
    group = [];
  };
  for (const node of [...element.childNodes]) {
    if (node.nodeType === 1 && (node.matches(blocks) || node.querySelector(blocks))) flush();
    else group.push(node);
  }
  flush();
  if (!element.children.length && !element.textContent.trim()) {
    const paragraph = element.ownerDocument.createElement('p');
    paragraph.style.textAlign = alignment;
    element.append(paragraph);
  }
}

/** Resolve logical alignment before picture/text markers can affect dir=auto. */
export async function prepareAlignment(html) {
  if (typeof DOMParser === 'undefined' || !/text-align\s*:\s*(?:initial|start|end|match-parent)(?![\w-])/i.test(html)) return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  if (![...document.body.querySelectorAll('[style]')].some(el => logical.has(el.style?.textAlign?.toLowerCase()))) return html;
  const firstStrong = document.querySelector('bdi,[dir="auto" i]')
    ? (await import('./unicode-bidi.js')).firstStrongDirection : null;
  const autoDirection = element => {
    const pending = [...element.childNodes].reverse();
    while (pending.length) {
      const node = pending.pop();
      if (node.nodeType === 3) {
        const result = firstStrong(node.data);
        if (result) return result;
      } else if (node.nodeType === 1 && !excluded.has(node.localName) && !directions.has((node.getAttribute('dir') || '').toLowerCase())) {
        for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
      }
    }
    return 'ltr';
  };
  const nodes = [{ node: document.body, htmlDirection: 'ltr', direction: 'ltr', alignment: 'start', active: false }];
  while (nodes.length) {
    let { node, htmlDirection, direction, alignment, active } = nodes.pop();
    const parentDirection = direction, parentAlignment = alignment;
    const dir = (node.getAttribute('dir') || '').toLowerCase();
    if (dir === 'ltr' || dir === 'rtl') htmlDirection = dir;
    else if (dir === 'auto' || node.localName === 'bdi') htmlDirection = autoDirection(node);
    const uaDirection = node.hasAttribute('dir') || node.localName === 'bdi' ? htmlDirection : direction;
    direction = uaDirection;
    const declaredDirection = node.style?.direction?.toLowerCase() || '';
    if (declaredDirection === 'ltr' || declaredDirection === 'rtl') direction = declaredDirection;
    else if (declaredDirection === 'initial') direction = 'ltr';
    else if (inherited.has(declaredDirection)) direction = parentDirection;

    const semantic = node.localName === 'caption' || (node.localName === 'th' && alignment === 'start') ? 'center' : alignment;
    alignment = node.localName === 'center' ? 'center' : semantic;
    if (alignElements.has(node.localName)) {
      const hint = (node.getAttribute('align') || '').toLowerCase();
      if (['left', 'right', 'center', 'justify'].includes(hint)) alignment = hint;
      else if (hint === 'absmiddle' && ['thead', 'tbody', 'tfoot', 'tr', 'td', 'th'].includes(node.localName)) alignment = 'center';
    }
    const declared = node.style?.textAlign?.toLowerCase() || '';
    if (declared === 'initial') alignment = 'start';
    else if (inherited.has(declared)) alignment = parentAlignment;
    else if (declared === 'match-parent') alignment = physical(parentAlignment, parentDirection);
    else if (declared === 'revert') alignment = semantic;
    else if (declared && declared !== 'revert-layer') alignment = declared;
    active ||= logical.has(declared);
    if (active) {
      const resolved = physical(alignment, direction);
      node.style?.setProperty('text-align', resolved);
      if (['li', 'td', 'th'].includes(node.localName)) alignInlineGroups(node, resolved);
    }
    for (let i = node.children.length - 1; i >= 0; i--) nodes.push({ node: node.children[i], htmlDirection, direction, alignment, active });
  }
  return document.body.innerHTML;
}
