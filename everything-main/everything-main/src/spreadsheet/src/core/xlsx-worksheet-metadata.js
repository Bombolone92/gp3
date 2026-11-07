/** Keep direct worksheet metadata without constructing DOM nodes for cell data.
 * Walk XML tokens so comments, CDATA and quoted angle brackets cannot become
 * fake tags. Namespace declarations on the worksheet and retained subtrees stay
 * intact. The caller still parses and validates the projected XML normally.
 */
export function worksheetMetadataXml(xml, names, { maxLength = 16 * 1024 * 1024 } = {}) {
  const keep = new Set(names), stack = [], parts = [];
  let start = null, rootSeen = false, length = 0, cursor = 0;
  const append = text => {
    if ((length += text.length) > maxLength) throw new Error('Worksheet metadata exceeds size limit');
    parts.push(text);
  };
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<[^<>"']*(?:(?:"[^"]*"|'[^']*')[^<>"']*)*>/g;
  for (const match of xml.matchAll(tokens)) {
    if (!stack.length && xml.slice(cursor, match.index).trim()) throw new Error('Text outside worksheet XML root');
    cursor = match.index + match[0].length;
    const token = match[0];
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[')) { if (!stack.length) throw new Error('CDATA outside worksheet XML root'); continue; }
    const tag = /^<(\/?)([^!?/\s<>"']+)(?:\s|\/?>)/.exec(token);
    if (!tag) throw new Error('Unsupported worksheet XML declaration');
    const closing = !!tag[1], name = tag[2], empty = /\/\s*>$/.test(token);
    if (closing) {
      if (stack.pop() !== name) throw new Error('Unbalanced worksheet XML');
      if (stack.length === 1 && start != null) { append(xml.slice(start, match.index + token.length)); start = null; }
      else if (!stack.length) append(token);
      continue;
    }
    if (!stack.length) {
      if (rootSeen) throw new Error('Multiple worksheet XML roots');
      rootSeen = true; append(token);
    } else if (stack.length === 1 && keep.has(name.split(':').at(-1))) {
      if (empty) append(token); else start = match.index;
    }
    if (!empty) stack.push(name);
    if (stack.length > 128) throw new Error('Worksheet XML exceeds depth limit');
  }
  if (!rootSeen || stack.length || xml.slice(cursor).trim()) throw new Error('Unbalanced worksheet XML');
  return parts.join('');
}
