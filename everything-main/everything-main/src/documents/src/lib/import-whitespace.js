// Elements that the native converter maps to separate paragraph flows.
const blocks = new Set(['p', 'div', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'blockquote', 'section', 'article', 'header', 'footer', 'aside', 'address', 'figure', 'figcaption', 'center', 'main', 'nav', 'hr']);
const discarded = new Set(['script', 'style', 'noscript', 'template', 'textarea', 'math']);
const preserves = new Set(['pre', 'pre-wrap', 'break-spaces']);

/**
 * Text without the spaces and tabs on either side of each of its line breaks
 * (the pre-line rule); spaces elsewhere are left for the collapsing pass. Done
 * by hand: a pattern such as /[ \t]*\n/ retries from every position of a long
 * run of spaces that no newline follows, which is quadratic on a hostile import.
 */
function trimAroundBreaks(text) {
  const lines = text.split('\n');
  if (lines.length === 1) return text;
  return lines.map((line, i) => {
    let start = 0, end = line.length;
    if (i > 0) while (start < end && (line[start] === ' ' || line[start] === '\t')) start++;
    if (i < lines.length - 1) while (end > start && (line[end - 1] === ' ' || line[end - 1] === '\t')) end--;
    return line.slice(start, end);
  }).join('\n');
}

/** Apply whitespace rules across inline content before native conversion. */
export async function htmlToFragmentWithWhitespace(api, html) {
  const preserving = /white-space\s*:\s*(?:pre(?:-wrap|-line)?|break-spaces)(?![\w-])/i.test(html);
  if (typeof DOMParser === 'undefined' || (!preserving
    && !(/<pre\b/i.test(html) && /white-space\s*:/i.test(html)))) return api.htmlToFragment({ html });
  // A collapsing PRE without text whitespace needs no preparation. Everything
  // after the first tag end is included, so nested markup only adds false positives.
  if (!preserving && !html.includes('&') && !/[\t\n ]/.test(html.slice(html.indexOf('>') + 1))) return api.htmlToFragment({ html });
  // A single plain-text PRE needs no inline-flow reconstruction. Parse only
  // its attributes, then let the native paragraph converter collapse the text.
  // This avoids building a second DOM for very large, unformatted code blocks.
  const plainPre = /^(\s*)<pre\b((?:"[^"]*"|'[^']*'|[^'">])*)>([^<]*)<\/pre\s*>(\s*)$/i.exec(html);
  if (plainPre) {
    const shell = new DOMParser().parseFromString(`<pre${plainPre[2]}></pre>`, 'text/html');
    const pre = shell.querySelector('pre');
    if (['normal', 'nowrap', 'initial', 'inherit', 'unset'].includes(pre?.style.whiteSpace.toLowerCase())) {
      const paragraph = shell.createElement('p');
      for (const attribute of pre.attributes) paragraph.setAttribute(attribute.name, attribute.value);
      // PRE has no legacy align hint; preserve only its actual CSS alignment.
      paragraph.removeAttribute('align');
      if (!pre.style.fontFamily) paragraph.style.fontFamily = 'monospace';
      return api.htmlToFragment({ html: `${plainPre[1]}${paragraph.outerHTML.slice(0, -4)}${plainPre[3]}</p>${plainPre[4]}` });
    }
  }
  const document = new DOMParser().parseFromString(html, 'text/html');
  let prefix;
  do { prefix = `SDIMPORTSPACE${crypto.randomUUID().replaceAll('-', '')}X`; } while (document.body.textContent.includes(prefix));
  const texts = [], contexts = [];
  const makeContext = () => { const context = { events: [], active: false }; contexts.push(context); return context; };
  const stack = [{ node: document.body, mode: 'normal', context: makeContext(), pre: null }];
  while (stack.length) {
    let { node, mode, context, pre } = stack.pop();
    if (node.nodeType === 3) {
      context.events.push({ node, mode, pre });
      if (/[\t\n ]/.test(node.data)) {
        if (preserves.has(mode) || mode === 'pre-line') context.active = true;
        if (pre && !preserves.has(mode)) context.active = true;
      }
      continue;
    }
    if (node.nodeType !== 1 || discarded.has(node.localName)) continue;
    if (blocks.has(node.localName)) {
      context.events.push({ boundary: true });
      context = makeContext();
    }
    if (node.localName === 'br') { context.events.push({ boundary: true }); continue; }
    if (node.localName === 'img') { context.events.push({ atomic: true }); continue; }
    const inherited = mode;
    if (node.localName === 'pre') { mode = 'pre'; pre = node; }
    const declared = node.style?.whiteSpace?.toLowerCase() || '';
    if (preserves.has(declared) || ['normal', 'nowrap', 'pre-line'].includes(declared)) mode = declared;
    else if (declared === 'inherit' || declared === 'unset') mode = inherited;
    else if (declared === 'initial') mode = 'normal';
    for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push({ node: node.childNodes[i], mode, context, pre });
  }
  // Normalize a complete inline flow so spaces collapse across element edges.
  // Markers keep native conversion from collapsing preserved spaces afterward.
  for (const context of contexts) {
    if (!context.active) continue;
    let lineStart = true, space = null;
    const trim = () => { if (space) space.text = space.text.slice(0, -1); space = null; };
    for (const event of context.events) {
      if (event.boundary) { trim(); lineStart = true; continue; }
      if (event.atomic) { space = null; lineStart = false; continue; }
      const preserve = preserves.has(event.mode);
      event.text = event.node.data;
      if (!preserve) {
        event.text = event.mode === 'pre-line'
          ? trimAroundBreaks(event.text).replace(/[ \t]+/g, ' ')
          : event.text.replace(/[ \t\n]+/g, ' ');
        if (event.text.startsWith(' ') && (lineStart || space)) event.text = event.text.slice(1);
      }
      if (!event.text) continue;
      if (event.text.startsWith('\n')) trim();
      lineStart = event.text.endsWith('\n');
      space = !preserve && event.text.endsWith(' ') ? event : null;
    }
    trim();
    for (const event of context.events) {
      if (!event.node) continue;
      if (!event.text && !event.pre) { event.node.data = ''; continue; }
      texts.push(event.text);
      event.node.data = `${prefix}${texts.length - 1}Z`;
    }
  }
  const converted = await api.htmlToFragment({ html: texts.length ? document.body.innerHTML : html });
  if (!texts.length || !Array.isArray(converted?.fragment)) return converted;
  const pattern = new RegExp(`${prefix}(\\d+)Z`, 'g');
  const pending = [converted.fragment];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value.inlines)) {
      value.inlines = value.inlines.flatMap(inline => {
        if (inline.kind !== 'run' || !inline.run.text?.includes(prefix)) return [inline];
        const result = [], text = inline.run.text;
        const append = part => { if (part) result.push({ ...inline, run: { ...inline.run, text: part } }); };
        let offset = 0;
        for (const match of text.matchAll(pattern)) {
          append(text.slice(offset, match.index));
          const original = texts[Number(match[1])];
          if (original == null) throw new Error('Could not restore imported whitespace');
          original.split('\n').forEach((line, index) => {
            if (index) result.push({ kind: 'lineBreak', lineBreak: {} });
            append(line);
          });
          offset = match.index + match[0].length;
        }
        append(text.slice(offset));
        if (result.some(item => item.run?.text.includes(prefix))) throw new Error('Could not restore imported whitespace');
        return result;
      });
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child);
  }
  return converted;
}
