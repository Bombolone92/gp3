/** Read local clipboard CSS without attaching untrusted styles to the page. */
const INHERITED = new Set(['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-align', 'white-space', 'direction']);
const TABLE_ALIGN_ELEMENTS = new Set(['THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH']);
const TABLE_ALIGN_HINTS = new Set(['top', 'middle', 'bottom', 'baseline']);
const compare = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

function withoutComments(text) {
  return text.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\/\*[\s\S]*?(?:\*\/|$)/g, (all, quoted) => quoted || ' ');
}

/** Split outside strings and parentheses, including quoted Excel number formats. */
function declarations(text) {
  text = withoutComments(text || '');
  const out = [];
  let start = 0, quote = null, depth = 0;
  const append = end => {
    const part = text.slice(start, end), at = part.indexOf(':');
    if (at < 0) return;
    const name = part.slice(0, at).trim().toLowerCase(), raw = part.slice(at + 1).trim();
    const important = /!\s*important\s*$/i.test(raw), value = raw.replace(/!\s*important\s*$/i, '').trim();
    if (name && value) out.push({ name, value, important: Number(important) });
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && !depth) { append(i); start = i + 1; }
  }
  append(text.length);
  return out;
}

/** Top-level rules only: @page and conditional/nested rules cannot leak into cells. */
function* rules(text) {
  text = withoutComments(text).replace(/^\s*<!--/, '').replace(/-->\s*$/, '');
  let start = 0, body = 0, depth = 0, quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') { if (!depth) body = i + 1; depth++; }
    else if (ch === '}' && depth && !--depth) {
      const selector = text.slice(start, body - 1).trim();
      if (selector && !selector.startsWith('@')) yield [selector, declarations(text.slice(body, i))];
      start = i + 1;
    } else if (ch === ';' && !depth) start = i + 1;
  }
}

/** Type, universal, ID and compound class selectors used by spreadsheet HTML. */
function selector(text) {
  const match = /^(\*|[a-z][\w-]*)?((?:[.#][\p{L}\p{N}_-]+)*)$/iu.exec(text.trim());
  if (!match || !match[0]) return null;
  const tag = match[1] && match[1] !== '*' ? match[1].toUpperCase() : null;
  const ids = [], classes = [];
  for (const part of match[2].matchAll(/([.#])([\p{L}\p{N}_-]+)/gu)) (part[1] === '#' ? ids : classes).push(part[2]);
  return { tag, ids, classes, specificity: [0, ids.length, classes.length, Number(!!tag)] };
}

export function readClipboardStyles(doc) {
  const byKey = new Map(), global = [], cache = new Map(), computed = new WeakMap();
  let order = 0;
  for (const style of doc.querySelectorAll('style')) for (const [selectors, values] of rules(style.textContent)) {
    for (const text of selectors.split(',')) {
      const parsed = selector(text);
      if (!parsed) continue;
      const rule = { ...parsed, values, order };
      const key = parsed.ids.length ? '#' + parsed.ids[0] : parsed.classes.length ? '.' + parsed.classes[0] : parsed.tag;
      if (!key) global.push(rule);
      else { if (!byKey.has(key)) byKey.set(key, []); byKey.get(key).push(rule); }
    }
    order++;
  }
  const own = el => {
    const names = [...el.classList].sort(), id = el.id, tag = el.tagName;
    const valign = TABLE_ALIGN_ELEMENTS.has(tag) ? el.getAttribute('valign')?.toLowerCase() : null;
    const key = JSON.stringify([tag, id, names, el.getAttribute('style'), valign]);
    if (cache.has(key)) return cache.get(key);
    const candidates = [...global, ...(byKey.get(tag) || []), ...(byKey.get('#' + id) || []), ...names.flatMap(name => byKey.get('.' + name) || [])];
    const matched = candidates.filter(rule => (!rule.tag || rule.tag === tag) && rule.ids.every(value => value === id) && rule.classes.every(name => el.classList.contains(name)));
    matched.push({ values: declarations(el.getAttribute('style')), specificity: [1, 0, 0, 0], order });
    const ranked = matched.flatMap(rule => rule.values.map((value, index) => ({ ...value, rank: [value.important, ...rule.specificity, rule.order, index] }))).sort((a, b) => compare(a.rank, b.rank));
    const result = new Map();
    // HTML presentational hints precede author CSS, including a universal
    // selector. Keeping them here also makes explicit CSS inherit work.
    if (TABLE_ALIGN_HINTS.has(valign)) result.set('vertical-align', valign);
    for (const { name, value } of ranked) { result.delete(name); result.set(name, value); }
    // The cache bounds repeated work without retaining every unique cell's inline CSS.
    if (cache.size < 4096) cache.set(key, result);
    return result;
  };
  return el => {
    // Iterative inheritance also handles deeply nested pasted markup.
    const ancestors = [];
    for (let node = el; node && !computed.has(node); node = node.parentElement) ancestors.push(node);
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const node = ancestors[i], parent = computed.get(node.parentElement), result = new Map();
      if (parent) for (const [name, value] of parent) if (INHERITED.has(name)) result.set(name, value);
      // HTML's table rendering rules inherit vertical alignment through rows
      // and cells, but not through arbitrary ancestors or nested tables.
      // Keep an absent default absent, as with the other unstyled properties.
      if ((node.tagName === 'TD' || node.tagName === 'TH' || node.tagName === 'TR' && node.parentElement?.tagName !== 'TABLE')
        && parent?.has('vertical-align')) result.set('vertical-align', parent.get('vertical-align'));
      // HTML's PRE default overrides inherited white-space; author rules win.
      if (node.tagName === 'PRE') result.set('white-space', 'pre');
      // Semantic inline markup affects its descendants, never unrelated text
      // elsewhere in the cell. Author CSS below can override these defaults.
      if (['B', 'STRONG', 'TH'].includes(node.tagName)) result.set('font-weight', 'bold');
      if (['I', 'EM'].includes(node.tagName)) result.set('font-style', 'italic');
      if (node.tagName === 'U') result.set('text-decoration-line', 'underline');
      if (['S', 'STRIKE', 'DEL'].includes(node.tagName)) result.set('text-decoration-line', 'line-through');
      if (node.tagName === 'SUP') result.set('vertical-align', 'super');
      if (node.tagName === 'SUB') result.set('vertical-align', 'sub');
      if (node.tagName === 'FONT') {
        if (node.getAttribute('face')) result.set('font-family', node.getAttribute('face'));
        if (node.getAttribute('color')) result.set('color', node.getAttribute('color'));
      }
      for (const [name, value] of own(node)) {
        const keyword = value.toLowerCase();
        result.delete(name);
        if (keyword === 'inherit' || (keyword === 'unset' && INHERITED.has(name))) {
          if (parent?.has(name)) result.set(name, parent.get(name));
        } else if (keyword !== 'initial' && keyword !== 'unset') result.set(name, value);
      }
      // Office uses a display-only FONT color for number-format colors.
      // Import the inherited font color instead; the live number format
      // supplies the display color. Descendants may still set genuine colors.
      if (/(?:^|[\s,])color(?:$|[\s,])/i.test(result.get('mso-ignore') || '')) {
        result.delete('color');
        if (parent?.has('color')) result.set('color', parent.get('color'));
      }
      // Decorations paint through descendants even though the CSS property
      // itself is not inherited. Preserve that paint separately from cascade.
      let decoration = '';
      for (const [name, value] of result) if (name === 'text-decoration' || name === 'text-decoration-line') decoration = value;
      const painted = new Set(((parent?.get('-spreadsheet-text-decoration') || '') + ' ' + decoration).match(/underline|line-through/g));
      if (painted.size) result.set('-spreadsheet-text-decoration', [...painted].join(' '));
      if (painted.has('underline')) {
        const double = /\bunderline\b/.test(decoration) && (result.get('text-decoration-style') === 'double' || /\bdouble\b/.test(decoration));
        if (double || parent?.get('-spreadsheet-underline-style') === 'double') result.set('-spreadsheet-underline-style', 'double');
      }
      // Inline baseline offsets carry their descendants with them even though
      // vertical-align itself does not inherit. Table alignment is unrelated.
      if (!TABLE_ALIGN_ELEMENTS.has(node.tagName) && node.tagName !== 'TABLE') {
        const vertical = result.get('vertical-align');
        const script = vertical === 'super' || vertical === 'sub' ? vertical : parent?.get('-spreadsheet-run-vertical-align');
        if (script) result.set('-spreadsheet-run-vertical-align', script);
      }
      computed.set(node, result);
    }
    return computed.get(el);
  };
}
