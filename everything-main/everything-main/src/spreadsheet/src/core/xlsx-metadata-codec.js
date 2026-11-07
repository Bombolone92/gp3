// Native XFs already deduplicate displayed formatting. The private sidecar must
// also deduplicate original overrides, or a dense styled blank area can make
// our own export exceed the reader's per-part size limit.
const ENCODING = 'style-index-v1';
const record = value => value != null && typeof value === 'object' && !Array.isArray(value);
const STYLE_FIELDS = [['styles', /^\d+,\d+$/], ['colStyles', /^\d+$/], ['rowStyles', /^\d+$/]];

function indexedStyles(styles) {
  if (!record(styles)) return styles;
  const values = [], cells = Object.create(null), indices = new Map();
  let originalSize = 2, count = 0;
  for (const [key, style] of Object.entries(styles)) {
    if (!record(style)) return styles;
    const json = JSON.stringify(style);
    originalSize += JSON.stringify(key).length + 1 + json.length + Number(count++ > 0);
    let index = indices.get(json);
    if (index == null) { index = values.length; indices.set(json, index); values.push(style); }
    cells[key] = index;
  }
  const packed = { encoding: ENCODING, values, cells };
  // Small or mostly unique maps should retain the simpler legacy form. Compare
  // actual JSON sizes, rather than imposing a workbook/cell-count threshold.
  return JSON.stringify(packed).length < originalSize ? packed : styles;
}

/** Serialize without changing the live export baselines used by native writers. */
export function stringifyXlsxMetadata(meta) {
  if (!record(meta?.sheets)) return JSON.stringify(meta);
  const sheets = Object.fromEntries(Object.entries(meta.sheets).map(([name, sheet]) => {
    if (!record(sheet)) return [name, sheet];
    const next = { ...sheet };
    for (const [field] of STYLE_FIELDS) if (Object.hasOwn(sheet, field)) next[field] = indexedStyles(sheet[field]);
    return [name, next];
  }));
  return JSON.stringify({ ...meta, sheets });
}

function freezeStyle(style) {
  const pending = [style];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) continue;
    Object.freeze(value);
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child);
  }
  return style;
}

/** Accept legacy maps and restore indexed overrides as shared, read-only inputs. */
export function parseXlsxMetadata(json) {
  const meta = JSON.parse(json);
  for (const sheet of Object.values(record(meta?.sheets) ? meta.sheets : {})) for (const [field, keyPattern] of STYLE_FIELDS) {
    const packed = sheet?.[field];
    if (packed?.encoding !== ENCODING) continue;
    const styles = Object.create(null);
    const values = Array.isArray(packed.values) ? packed.values.map(v => record(v) ? freezeStyle(v) : null) : [];
    for (const [key, index] of Object.entries(record(packed.cells) ? packed.cells : {})) {
      if (!keyPattern.test(key) || !Number.isInteger(index) || index < 0 || index >= values.length || values[index] == null) continue;
      // The importer sanitizes these into independently owned cell/line styles.
      // Cloning here would undo the memory saving and let a malicious pool
      // multiply a large nested value by an arbitrary number of references.
      styles[key] = values[index];
    }
    sheet[field] = styles;
  }
  return meta;
}
