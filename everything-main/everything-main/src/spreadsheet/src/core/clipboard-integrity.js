/**
 * Fingerprint the markup paired with a private clipboard snapshot. Other
 * applications can retain our table attributes while replacing its cells.
 * A copy token alone therefore does not identify the current clipboard data.
 * This is a change detector, not an authentication/security boundary.
 *
 * Input is either our generated fragment or a DOM's serialization, never raw
 * foreign HTML. Normalize the serializer's entity/attribute spelling without
 * building a second DOM (a copy can contain 200,000 cells).
 */
export function clipboardMarkupStamp(markup, serialized = false) {
  let a = 2166136261, b = 5381;
  const feed = (text) => {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      a = Math.imul(a ^ c, 16777619);
      b = Math.imul(b, 33) ^ c;
    }
  };
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: '\u00a0' };
  const decode = (text, attribute = false) => {
    if (!/[&\r\0]/.test(text)) return text;
    // A DOM serialization may contain a literal CR from an entity such as
    // &#13;. Normalize it too: clipboard HTML can be parsed more than once.
    if (!serialized) text = text.replace(/\r\n?/g, '\n').replace(/\0/g, attribute ? '\ufffd' : '');
    return text.replace(/&(amp|lt|gt|quot|nbsp|#(?:[0-9]+|x[0-9a-f]+));/gi, (all, code) => {
      if (code[0] !== '#') return entities[code.toLowerCase()];
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
    }).replace(/\r\n?/g, '\n');
  };
  // Rows and cell styles repeat heavily in large copies. Cache only short
  // markup tokens, with a fixed memory bound; never retain copied cell text.
  const tags = new Map(), attributes = new Map();
  for (const [token] of markup.matchAll(/<!--[\s\S]*?-->|<(?:[^<>"']|"[^"]*"|'[^']*')*>|[^<]+|</g)) {
    const cached = tags.get(token);
    if (cached !== undefined) { feed(cached); continue; }
    const tag = /^<(\/)?([a-z][\w:-]*)([\s\S]*?)>$/i.exec(token);
    if (!tag) {
      const text = decode(token);
      // A text token consisting only of discarded NULs leaves no DOM node.
      if (text) feed(JSON.stringify(['text', text]));
      continue;
    }
    const attrs = [];
    for (const m of tag[3].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      // Typed values make each TD unique, while its potentially long style
      // repeats. Cache attributes separately so large typed copies need not
      // decode the same formatting for every cell. Both caches stay bounded.
      let pair = attributes.get(m[0]);
      if (!pair) {
        pair = [m[1].toLowerCase(), decode(m[2] ?? m[3] ?? m[4] ?? '', true)];
        if (attributes.size < 256 && m[0].length <= 4096) attributes.set(m[0], pair);
      }
      attrs.push(pair);
    }
    attrs.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const normalized = JSON.stringify([tag[1] ? 'end' : 'start', tag[2].toLowerCase(), attrs]);
    if (tags.size < 256 && token.length <= 4096) tags.set(token, normalized);
    feed(normalized);
  }
  return `1:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}

export function hasClipboardSnapshot(table) {
  const stamp = table.getAttribute('data-spreadsheet-markup');
  if (!/^1:[0-9a-f]{1,8}:[0-9a-f]{1,8}$/.test(stamp || '')) return false;
  // Our fragment has inline cell styles and only private table attributes.
  // Foreign formatting outside the body also invalidates its old snapshot.
  if (Array.from(table.attributes).some(a => !a.name.startsWith('data-spreadsheet-'))
    || table.ownerDocument.querySelector('style, link[rel~="stylesheet"]')) return false;
  for (let parent = table.parentElement; parent; parent = parent.parentElement) {
    if (parent.hasAttribute('style') || parent.hasAttribute('align') || parent.hasAttribute('bgcolor')
      || parent.tagName === 'FONT') return false;
  }
  return stamp === clipboardMarkupStamp(table.innerHTML, true);
}
