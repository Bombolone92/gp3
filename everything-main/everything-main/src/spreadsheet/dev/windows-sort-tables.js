// Development-time reader for the published MS-UCODEREF sorting tables.
// Keep table data/version selection separate from the sort-key algorithm.
// This module is not part of the app bundle.
// https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-ucoderef/227922dc-ca6e-4ed0-9347-0a4410d65ba4
const MAX_RECORDS = 1048576;
const fail = message => { throw new Error(`Invalid Windows sorting table: ${message}`); };
const integer = (text, max = 0xffffffff) => {
  if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(text || '')) fail('integer');
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail('integer bounds');
  return value;
};
const unique = (map, key, value) => {
  if (map.has(key)) fail('duplicate identity');
  map.set(key, value);
};

/** Read LCID-based tables with counted DEFAULT records (NT through Windows 7).
 * Names and comments are not identities. Unsupported sections/layouts fail;
 * they must not silently produce incomplete comparison data. Raw weight values
 * and transitions still require semantic validation before generating sort keys;
 * published reference files themselves contain contradictory records.
 */
export function readWindowsSortTables(text) {
  if (typeof text !== 'string' || text.length > 32 * 1048576) fail('text limit');
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).map(line => line.split(';', 1)[0].trim()).filter(Boolean);
  if (lines.length > MAX_RECORDS) fail('record limit');
  let at = 0;
  const peek = () => lines[at]?.split(/\s+/) || [];
  const take = (label, width) => {
    const row = peek();
    if (row.length !== width || row[0] !== label) fail(`expected ${label}`);
    at++; return row;
  };
  const count = label => integer(take(label, 2)[1], MAX_RECORDS);
  const record = bounds => {
    const row = peek();
    if (row.length !== bounds.length) fail('record width');
    at++; return row.map((value, i) => integer(value, bounds[i]));
  };
  const rows = (length, bounds) => {
    if (length > lines.length - at) fail('truncated records');
    return Array.from({ length }, () => record(bounds));
  };
  const indexed = (length, bounds) => {
    const map = new Map();
    for (const [id, ...values] of rows(length, bounds)) unique(map, id, values);
    return map;
  };
  const weightBounds = [65535, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff];
  take('SORTKEY', 1);
  const weights = indexed(count('DEFAULT'), weightBounds);
  take('ENDSORTKEY', 1); take('SORTTABLES', 1);
  const release = count('RELEASE');
  const nlsVersions = new Map(), definedVersions = new Map();
  while (['NLSVERSION', 'DEFINEDVERSION'].includes(peek()[0])) {
    const label = peek()[0], row = take(label, 3);
    unique(label === 'NLSVERSION' ? nlsVersions : definedVersions, integer(row[1]), integer(row[2]));
  }
  const locales = label => {
    const list = rows(count(label), [0xffffffff]).map(row => row[0]);
    if (new Set(list).size !== list.length) fail('duplicate locale');
    return new Set(list);
  };
  const reverseDiacritics = locales('REVERSEDIACRITICS'), doubleCompression = locales('DOUBLECOMPRESSION');
  const multipleWeights = rows(count('MULTIPLEWEIGHTS'), [255, 255]);
  const expansions = indexed(count('EXPANSION'), [65535, 65535, 65535]);
  const compatibility = peek()[0] === 'COMPATIBILITY' ? indexed(count('COMPATIBILITY'), [65535, 65535]) : new Map();
  const contractions = new Map(), lengths = { TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8 };
  const contractionCount = count('COMPRESSION');
  for (let i = 0; i < contractionCount;) {
    const aliases = [], groups = new Map();
    while (peek()[0] === 'LCID') {
      if (++i > contractionCount) fail('contraction locale count');
      aliases.push(integer(take('LCID', 2)[1]));
    }
    if (!aliases.length) fail('missing contraction locale');
    while (Object.hasOwn(lengths, peek()[0])) {
      const length = lengths[peek()[0]], size = count(peek()[0]), entries = [];
      for (const row of rows(size, [...Array(length).fill(65535), ...Array(4).fill(0xffffffff)])) {
        // Published tables can contain conflicting duplicate contractions.
        // Preserve their order and every record for the comparison-data
        // validator; choosing either occurrence here would invent semantics.
        entries.push({ text: String.fromCharCode(...row.slice(0, length)), weights: row.slice(length) });
      }
      unique(groups, length, entries);
    }
    if (!groups.size) fail('empty contraction locale');
    for (const locale of aliases) unique(contractions, locale, groups);
  }
  const exceptions = new Map(), exceptionCount = count('EXCEPTION');
  for (let i = 0; i < exceptionCount;) {
    const aliases = []; let size;
    while (peek()[0] === 'LCID') {
      if (++i > exceptionCount) fail('exception locale count');
      const row = take('LCID', peek().length === 2 ? 2 : 3);
      if (row.length === 3) {
        const nextSize = integer(row[2], MAX_RECORDS);
        if (size !== undefined && size !== nextSize) fail('conflicting exception counts');
        size = nextSize;
      }
      aliases.push(integer(row[1]));
    }
    if (!aliases.length || size === undefined) fail('missing exception locale/count');
    const entries = indexed(size, weightBounds);
    for (const locale of aliases) unique(exceptions, locale, entries);
  }
  const jamo = new Map(), jamoCount = count('JAMOSORT'); let read = 0;
  while (read < jamoCount) {
    const [id, size] = record([65535, MAX_RECORDS]);
    if (!size || size > jamoCount - read) fail('Jamo record count');
    const nodes = rows(size, [65535, ...Array(6).fill(0xffffffff)]);
    if (nodes[0][0] !== id) fail('Jamo root identity');
    // Transition counts describe subsequent records, not a conventional trie
    // child count. Keep the native record order for the Jamo state machine.
    unique(jamo, id, nodes); read += size;
  }
  take('ENDSORTTABLES', 1);
  if (at !== lines.length) fail('trailing records');
  return { release, weights, nlsVersions, definedVersions, reverseDiacritics, doubleCompression, multipleWeights, expansions, compatibility, contractions, exceptions, jamo };
}
