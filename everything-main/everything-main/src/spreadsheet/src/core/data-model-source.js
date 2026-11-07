import { DaxError } from './dax.js';
import { parseFormula } from './formula/parser.js';
import { tableRows } from './tables.js';

const key = value => String(value).normalize('NFC').toUpperCase();
const one = (items, label) => { if (items.length !== 1) throw new DaxError(`${items.length ? 'Ambiguous' : 'Missing'} ${label}`); return items[0]; };

/** Read an explicitly connected local source. No captions, short-column
 * annotations, filenames or worksheet position are treated as bindings.
 * External connections are not opened by measure evaluation.
 */
export function linkedModelSource(wb, schema, table) {
  const binding = one(schema.bindings.tables.filter(t => key(t.id) === key(table.id)), `source binding for ${table.name}`);
  const connection = one(schema.bindings.connections.filter(c => key(c.name) === key(binding.connection)), `connection for ${table.name}`);
  if (connection.type !== '102' || !connection.sourceName || connection.model) throw new DaxError('Only linked worksheet model sources can be evaluated');
  return resolveLinkedModelSource(wb, connection.sourceName);
}

/** Resolve a linked worksheet source, including an already imported external cache. */
export function resolveLinkedModelSource(wb, source) {
  const visited = new Set();
  for (let depth = 0; depth < 64; depth++) {
    const name = wb.names.filter(n => !n.sheet && key(n.name) === key(source));
    if (!name.length) break;
    const entry = one(name, `source name ${source}`);
    if (visited.has(key(source)) || entry.relative) throw new DaxError('Invalid linked model source name');
    visited.add(key(source)); source = entry.ref;
  }
  if (wb.names.some(n => !n.sheet && key(n.name) === key(source))) throw new DaxError('Linked source name exceeds nesting limit');
  let ast; try { ast = parseFormula(source); } catch { throw new DaxError('Invalid linked model source reference'); }
  const tableName = ast.type === 'tref' && ast.spec === '' ? ast.table : ast.type === 'name' ? ast.name : null;
  const found = tableName && wb.tableByName(tableName);
  if (found) {
    const rows = tableRows(found.table);
    return { tableName: found.table.name, sheet: found.sheet, headers: wb.tableColumns(found.sheet.id, found.table), c1: found.table.range.c1, r1: rows.dataStart, r2: rows.dataEnd };
  }
  if (ast.type === 'ref' && ast.ref.sheet && !ast.ref.sheetEnd && ['range', 'cell'].includes(ast.ref.kind)) {
    const sheet = wb.sheetByName(ast.ref.sheet), range = ast.ref;
    if (!sheet) throw new DaxError('Missing linked model worksheet');
    const headers = Array.from({ length: range.c2 - range.c1 + 1 }, (_, i) => wb.getValue(sheet.id, range.r1, range.c1 + i));
    if (headers.some(h => typeof h !== 'string' || !h)) throw new DaxError('Linked model source requires column headers');
    return { sheet, headers, c1: range.c1, r1: range.r1 + 1, r2: range.r2 };
  }
  throw new DaxError('Unsupported linked model source reference');
}

const ENGINE = 'http://schemas.microsoft.com/analysisservices/2003/engine';
const ENGINE200 = 'http://schemas.microsoft.com/analysisservices/2010/engine/200/200';

export function linkedModelColumn(src, table, field) {
  if (field.keys?.length !== 1) throw new DaxError('Model column requires a single source key');
  const item = field.keys[0], dataType = item.dataType;
  const type = ['BigInt', 'Integer'].includes(dataType) ? 'integer'
    : dataType === 'Double' ? 'number' : ['WChar', 'VarWChar', 'Char', 'VarChar'].includes(dataType) ? 'string'
      : dataType === 'Bool' ? 'boolean' : null;
  if (!type) throw new DaxError(`Unsupported Data Model column type ${dataType || '(missing)'}`);
  let sourceId = field.id, generated = null;
  if (item.source) {
    const source = item.source;
    if (source.type === 'RowNumberBinding' && source.namespace === ENGINE200) {
      if (dataType !== 'Integer' || field.type !== 'RowNumber') throw new DaxError('Invalid model row-number binding');
      generated = 'rowNumber';
    } else if (source.type === 'ColumnBinding' && source.namespace === ENGINE) {
      if (!source.columnId || ![table.id, src.tableName].filter(Boolean).some(id => key(id) === key(source.tableId))) throw new DaxError('Unsupported linked column source table');
      sourceId = source.columnId;
    } else throw new DaxError('Unsupported model column source binding');
  }
  const formatTrim = { TrimLeft: 'Left', TrimRight: 'Right', TrimAll: 'LeftRight', TrimNone: 'None' }[item.format];
  const trimming = item.trimming || formatTrim || 'Right';
  if (type === 'string' && (!['Left', 'Right', 'LeftRight', 'None'].includes(trimming)
    || item.trimming && formatTrim && formatTrim !== trimming)) throw new DaxError('Unsupported or conflicting Data Model text trimming');
  const nullProcessing = item.nullProcessing || 'Automatic';
  if (!['Preserve', 'Automatic', 'ZeroOrBlank', 'Error'].includes(nullProcessing)) throw new DaxError('Unsupported Data Model null processing');
  // ASSL object Name/ID creation implicitly trims boundary spaces. For an
  // implicit attribute-ID binding, compare the source header's object identity,
  // not its literal worksheet spelling. Explicit ColumnBinding names refer to
  // source columns and stay literal. Do not prefer an exact spelling over a
  // second normalized match: that collision needs an explicit binding.
  // Only U+0020 is normalized here; internal spaces and other whitespace retain
  // their identity. Worksheet headers and model metadata are never rewritten.
  // https://learn.microsoft.com/analysis-services/multidimensional-models/olap-physical/object-naming-rules-analysis-services
  const headerKey = h => key(item.source ? h : String(h).replace(/^ +| +$/g, ''));
  const matches = generated ? [] : src.headers.flatMap((h, i) => headerKey(h) === key(sourceId) ? [i] : []);
  return { trimming, nullProcessing, generated, index: generated ? null : src.c1 + one(matches, `linked source column ${sourceId}`), type, bits: dataType === 'BigInt' ? 64 : dataType === 'Integer' ? 32 : null };
}

export function linkedModelValue(wb, src, field, row) {
  let value = field.generated === 'rowNumber' ? row - src.r1 : wb.getValue(src.sheet.id, row, field.index);
  if (value == null) {
    if (field.nullProcessing === 'Preserve') return null;
    if (field.nullProcessing === 'Error') throw new DaxError('Null source value is forbidden by its Data Model column');
    // ASSL DataItem defaults to Automatic, which uses ZeroOrBlank for OLAP
    // data items. Normalize only the model input; worksheet cells stay blank.
    value = field.type === 'string' ? '' : field.type === 'boolean' ? false : 0;
  }
  if (typeof value !== (field.type === 'integer' ? 'number' : field.type) || typeof value === 'number' && !Number.isFinite(value)
    || field.type === 'integer' && !Number.isInteger(value)) throw new DaxError('Linked source value does not match its Data Model column type');
  if (field.bits) {
    const exact = BigInt(value), bound = 1n << BigInt(field.bits - 1);
    if (exact < -bound || exact >= bound) throw new DaxError('Linked source value exceeds its Data Model integer type');
  }
  if (field.type === 'string') {
    let text = value;
    if (field.trimming === 'Left' || field.trimming === 'LeftRight') text = text.replace(/^ +/, '');
    if (field.trimming === 'Right' || field.trimming === 'LeftRight') text = text.replace(/ +$/, '');
    return text;
  }
  return value;
}

/** Read an explicit projection of linked worksheet data in worksheet order.
 * Integer cells become exact BigInts; strings follow declared trimming. This
 * does not map source rows to existing model storage positions or mutate an
 * archive. A full refresh must rebuild all dependent columns consistently.
 */
export function readLinkedModelTable(wb, schema, tableId, { columns = null, maxValues = 4 * 1048576 } = {}) {
  if (!Number.isSafeInteger(maxValues) || maxValues < 0 || maxValues > 16 * 1048576) throw new DaxError('Invalid linked source value limit');
  const table = one(schema.tables.filter(t => key(t.id) === key(tableId)), `model table ${tableId}`), source = linkedModelSource(wb, schema, table);
  const selected = columns ?? table.columns.map(c => c.id);
  if (!Array.isArray(selected) || selected.some(id => typeof id !== 'string') || new Set(selected.map(key)).size !== selected.length) throw new DaxError('Invalid linked source columns');
  const rowCount = Math.max(0, source.r2 - source.r1 + 1);
  if (rowCount * selected.length > maxValues) throw new DaxError('Linked source exceeds value limit');
  const result = selected.map(id => {
    const column = one(table.columns.filter(c => key(c.id) === key(id)), `model column ${id}`), field = linkedModelColumn(source, table, column), values = new Array(rowCount);
    for (let row = 0; row < rowCount; row++) { const value = linkedModelValue(wb, source, field, source.r1 + row); values[row] = value !== null && field.type === 'integer' ? BigInt(value) : value; }
    return { id: column.id, name: column.name, type: field.type, values };
  });
  return { id: table.id, rowCount, sheetId: source.sheet.id, firstRow: source.r1, columns: result };
}
