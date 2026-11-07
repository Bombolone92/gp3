const space = c => c !== undefined && /[\t\n\f\r ]/.test(c);

/** Preserve an Office distinction the HTML DOM erases: x:str is a text
 * marker, whereas x:str="" supplies an empty string. Add a temporary attribute
 * to the latter cells before parsing, then remove it before reading styles.
 * Tokenize attributes, not text matches: quotes can contain > or entire tags.
 * For external explicit values, encode NUL references through the DOM using
 * CR followed by 0, and escape both literal CR and CR references as CR
 * followed by 1. No named entity produces CR, so escaping every source of CR
 * makes this temporary encoding collision-free. Excel preserves literal CR
 * and CRLF in typed attributes; the browser would normalize both to LF.
 * Restore these marked attributes after parsing. Literal NUL is discarded;
 * a numeric NUL reference in a typed value is retained.
 * Numeric C1 references in explicit values also denote their actual code
 * points in Excel. Replace them with literal C1 characters before the HTML
 * parser applies its legacy Windows-1252 mapping. Rendered text still uses
 * normal HTML decoding.
 * https://html.spec.whatwg.org/multipage/parsing.html#numeric-character-reference-end-state
 * https://html.spec.whatwg.org/multipage/parsing.html#preprocessing-the-input-stream
 * Attribute/reference tokenization follows HTML, including its defined
 * recovery from duplicate attributes and missing entity semicolons. Excel's
 * legacy malformed-hex recovery has different character boundaries.
 * https://html.spec.whatwg.org/multipage/parsing.html#hexadecimal-character-reference-state
 * Duplicate attributes follow the HTML parser's first-attribute rule.
 * https://html.spec.whatwg.org/multipage/parsing.html#attribute-name-state
 */
export function prepareOfficeStrings(html, normalizeText = false) {
  if (!normalizeText && !/x:str[\t\n\f\r ]*=[\t\n\f\r ]*(?:""|''|>)/i.test(html)) return { html, marker: null };
  const names = new Set([...html.matchAll(/data-office-empty-string(?:-\d+)?/gi)].map(m => m[0].toLowerCase()));
  let marker = 'data-office-empty-string', suffix = 0;
  while (names.has(marker)) marker = `data-office-empty-string-${suffix++}`;
  const pieces = [];
  let from = 0, i = 0;
  while ((i = html.indexOf('<', i)) >= 0) {
    if (html.startsWith('<!--', i)) {
      // HTML also terminates comments with --!> and the abrupt <!--> forms.
      const start = i + 4;
      if (html[start] === '>') i = start + 1;
      else if (html.startsWith('->', start)) i = start + 2;
      else {
        const end = /--!?>/g;
        end.lastIndex = start;
        const stop = end.exec(html);
        i = stop ? end.lastIndex : html.length;
      }
      continue;
    }
    if (html[i + 1] === '!' || html[i + 1] === '?') {
      const end = html.indexOf('>', i + 2);
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    const closing = html[i + 1] === '/';
    const start = i + (closing ? 2 : 1);
    if (!/[a-z]/i.test(html[start] || '')) { i++; continue; }
    i = start;
    while (i < html.length && !space(html[i]) && !'/>'.includes(html[i])) i++;
    const tag = html.slice(start, i).toLowerCase(), nameEnd = i;
    let seen = false, empty = false, encoded = false, edit = null;
    while (i < html.length && html[i] !== '>') {
      if (space(html[i]) || html[i] === '/') { i++; continue; }
      const attrStart = i++;
      while (i < html.length && !space(html[i]) && !'/=>'.includes(html[i])) i++;
      const name = html.slice(attrStart, i).toLowerCase();
      while (space(html[i])) i++;
      let assigned = false, value = null, valueStart;
      if (html[i] === '=') {
        assigned = true; i++;
        while (space(html[i])) i++;
        const quote = html[i] === '"' || html[i] === "'" ? html[i++] : null;
        valueStart = i;
        if (quote) {
          const end = html.indexOf(quote, i);
          i = end < 0 ? html.length : end;
        } else while (i < html.length && !space(html[i]) && html[i] !== '>') i++;
        value = html.slice(valueStart, i);
        if (quote && i < html.length) i++;
      }
      if (name === 'x:str' && !seen) {
        seen = true;
        if (normalizeText && assigned) {
          const cleaned = value.replace(/\0/g, '');
          encoded = /\r|&#(?:0+(?!\d);?|x0+(?![0-9a-f]);?)/i.test(cleaned);
          const replacement = cleaned.replace(/\r|&#(?:x([0-9a-f]+)|([0-9]+));?/gi, (ref, hex, dec) => {
            if (ref === '\r') return '&#13;1';
            const code = parseInt(hex || dec, hex ? 16 : 10);
            if (code >= 0x80 && code <= 0x9f) return String.fromCharCode(code);
            return encoded && code === 0 ? '&#13;0' : encoded && code === 13 ? '&#13;1' : ref;
          });
          if (replacement !== value) edit = { start: valueStart, end: valueStart + value.length, replacement };
          value = cleaned;
        }
        empty = assigned && value === '';
      }
    }
    if (i === html.length) break; // An unfinished tag is not emitted by HTML.
    i++;
    if (!closing && (tag === 'td' || tag === 'th')) {
      if (empty || encoded) {
        pieces.push(html.slice(from, nameEnd), ` ${marker}${encoded ? '="nul"' : ''}`);
        from = nameEnd;
      }
      if (edit) {
        pieces.push(html.slice(from, edit.start), edit.replacement);
        from = edit.end;
      }
    }
    // Contents of these HTML elements are text, not attributes. Inert parsing
    // leaves noscript enabled as markup, so it deliberately is not in this list.
    if (!closing && tag === 'plaintext') break;
    if (!closing && /^(script|style|textarea|title|xmp|iframe|noembed|noframes)$/.test(tag)) {
      const end = new RegExp(`</${tag}(?=[\\t\\n\\f\\r />])`, 'gi');
      end.lastIndex = i;
      const match = end.exec(html);
      i = match ? match.index : html.length;
    }
  }
  return pieces.length ? { html: pieces.join('') + html.slice(from), marker } : { html, marker: null };
}
