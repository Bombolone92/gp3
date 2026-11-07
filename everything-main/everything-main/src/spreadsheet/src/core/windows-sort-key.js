// MS-UCODEREF 3.1.5.2: versioned Windows linguistic comparison. The caller
// supplies the selected reference tables; neither host locale nor Intl is a
// substitute for the workbook's persisted comparison version.
const LIMIT = 1048576;
// MS-UCODEREF 3.1.5.2.13: these sort LCIDs, including their alternate-sort
// bits, use three-byte CJK primary weights in Windows 7 / Server 2008 R2.
const threeByteLocales = new Set([0x404, 0x804, 0xc04, 0x1004, 0x1404, 0x20804, 0x21004, 0x21404, 0x30404, 0x40411]);
const fail = message => { throw new Error(`Unsupported Windows sort key: ${message}`); };
const uint = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const same = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

/** Build keys for explicitly selected Vista or Windows 7 weight algorithms. Ordinary
 * scripts, nonspacing marks, expansions, contractions, punctuation, reverse
 * diacritics and CJK Extension A are supported. East Asian special weights,
 * Jamo composition and double compression require their own handlers and fail
 * explicitly. No dictionary mutation or model-version inference occurs here.
 */
export function createWindowsSortKey(tables, { locale, profile, flags = 0, maxChars = LIMIT, maxWorkBytes = 16 * LIMIT } = {}) {
  if (!['vista', 'windows7'].includes(profile) || !uint(locale, 0xffffffff) || [0, 0x400, 0x800, 0x1000].includes(locale)
    || !uint(flags, 0x30003) || flags & ~0x30003 || !uint(maxChars, LIMIT) || !uint(maxWorkBytes, 16 * LIMIT)) fail('options');
  if (tables?.release !== 2 || !(tables.weights instanceof Map) || !(tables.exceptions instanceof Map)
    || !(tables.expansions instanceof Map) || !(tables.contractions instanceof Map)
    || !tables.weights.size || !(tables.reverseDiacritics instanceof Set) || !(tables.doubleCompression instanceof Set)) fail('tables');
  if (tables.doubleCompression.has(locale)) fail('double compression');
  let records = 0;
  const consume = () => { if (++records > LIMIT) fail('table work limit'); };
  const weight = value => {
    consume();
    if (!Array.isArray(value) || value.length !== 4 || value.some(v => !uint(v, 255))) fail('weight bytes');
    return value.slice();
  };
  const weights = new Map();
  for (const source of [tables.weights, tables.exceptions.get(locale) || new Map()]) {
    if (!(source instanceof Map) || source.size > 65536) fail('weight table');
    for (const [code, value] of source) {
      if (!uint(code, 65535)) fail('character');
      weights.set(code, weight(value));
    }
  }
  const expansions = new Map();
  if (tables.expansions.size > 65536) fail('expansion table');
  for (const [code, values] of tables.expansions) {
    consume();
    if (!uint(code, 65535) || !Array.isArray(values) || values.length !== 2 || values.some(v => !uint(v, 65535))) fail('expansion');
    expansions.set(code, values.slice());
  }
  const groups = tables.contractions.get(locale) || new Map(), contractions = new Map();
  if (!(groups instanceof Map) || groups.size > 7) fail('contraction groups');
  for (const [length, entries] of groups) {
    if (!uint(length, 8) || length < 2 || !Array.isArray(entries) || entries.length > LIMIT - records) fail('contraction group');
    const index = new Map();
    for (const entry of entries) {
      if (typeof entry?.text !== 'string' || entry.text.length !== length) fail('contraction text');
      const next = weight(entry.weights), previous = index.get(entry.text);
      if (previous && !same(previous, next)) fail('ambiguous contraction');
      index.set(entry.text, next);
    }
    contractions.set(length, index);
  }
  const reverse = tables.reverseDiacritics.has(locale), ignoreAccent = !!(flags & 2);
  const threeByte = profile === 'windows7', threeByteCjk = threeByteLocales.has(locale);
  const caseMask = 0x3f & (flags & 1 ? 0xe7 : 255) & (flags & 0x10000 ? 0xdf : 255) & (flags & 0x20000 ? 0xfe : 255);
  const get = code => weights.get(code) || (expansions.has(code) ? [2, 0, 0, 0] : [0, 0, 0, 0]);
  return text => {
    if (typeof text !== 'string' || text.length > maxChars) fail('string limit');
    const primary = [], accent = [], casing = [], special = [];
    let primaryCount = 0;
    let units = 5; // Four level separators and the terminator.
    const room = count => { if ((units += count) > maxWorkBytes) fail('key byte limit'); };
    room(0);
    const normal = (w, allowThird = false) => {
      room(4); primary.push(w[0], w[1]); primaryCount++;
      // The third byte is a primary distinction, not a diacritic. It must
      // survive NORM_IGNORENONSPACE. Resolved contractions/expansions keep
      // their separate two-byte handler from MS-UCODEREF 3.1.5.2.4/12/14.
      if (allowThird && threeByte && (w[0] >= 0xa9 && w[0] <= 0xaf
        || threeByteCjk && w[0] >= 0xc0 && w[0] <= 0xf9)) {
        if (w[2]) primary.push(w[2]);
      } else accent.push(w[2]);
      casing.push(w[3] & caseMask);
    };
    const expanded = (code, active = new Set()) => {
      if (active.has(code) || active.size > 2) fail('cyclic or excessive expansion');
      const pair = expansions.get(code);
      if (!pair) fail('missing expansion');
      active.add(code); const result = [];
      for (const next of pair) {
        const w = get(next);
        if (w[0] === 2) result.push(...expanded(next, active));
        else result.push(w);
      }
      active.delete(code);
      if (result.length > 3) fail('excessive expansion');
      return result;
    };
    for (let at = 0; at < text.length; at++) {
      const code = text.charCodeAt(at); let w = get(code), contracted = false;
      if (w[0] > 12 && w[3] & 0xc0) {
        const maximum = [0, 3, 5, 8][w[3] >>> 6];
        for (let length = Math.min(maximum, text.length - at); length >= 2; length--) {
          const found = contractions.get(length)?.get(text.slice(at, at + length));
          if (found) { w = found; at += length - 1; contracted = true; break; }
        }
      }
      if (contracted) {
        // A matched contraction is already a complete weight record. The
        // contraction handler does not redispatch its script as a character.
        normal(w); continue;
      }
      switch (w[0]) {
        case 0: break; // Undefined and explicitly unsortable characters.
        case 1:
          if (accent.length) accent[accent.length - 1] = (accent.at(-1) + w[2]) & 255;
          else { room(1); accent.push(w[2]); }
          break;
        case 2:
          for (const item of expanded(code)) normal(item);
          break;
        case 3: fail('East Asian special weights'); break;
        case 4: fail('Jamo composition'); break;
        case 5:
          room(6); primary.push(254, 255, w[1], w[2]); primaryCount += 2; accent.push(2); casing.push(2); break;
        case 6: {
          const position = primaryCount;
          if (position > 8191) fail('punctuation position range');
          const encoded = (position << 2) | 0x8003;
          room(4); special.push(encoded >>> 8, encoded & 255, w[0], w[1]); break;
        }
        default: normal(w, true);
      }
    }
    if (ignoreAccent) accent.length = 0;
    else if (reverse) accent.reverse();
    while (accent.length && accent.at(-1) <= 2) accent.pop();
    if ((flags & 0x20001) === 0x20001) casing.length = 0;
    else while (casing.length && casing.at(-1) <= 2) casing.pop();
    const key = new Uint8Array(primary.length + accent.length + casing.length + special.length + 5);
    let at = 0;
    for (const part of [primary, accent, casing, []]) { key.set(part, at); at += part.length; key[at++] = 1; }
    key.set(special, at); // The allocated final byte remains the terminator.
    return key;
  };
}
