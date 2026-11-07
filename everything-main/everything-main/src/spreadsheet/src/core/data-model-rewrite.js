import { decodeModelXml, parseModelXml, modelChildren, standaloneModelXml } from './data-model-metadata.js';
import { readDataModelArchive, replaceDataModelArchiveFiles } from './data-model-archive.js';
import { readModelDictionary, encodeModelStringDictionary, encodeModelNumericDictionary } from './data-model-dictionaries.js';
import { readModelColumnStorage, readModelColumnIdentifiers, encodeModelColumnIds, encodeModelMappingIds } from './data-model-columns.js';
import { decodeModelValues, modelMagnitudeRatio } from './data-model-values.js';
import { readModelIntrinsicHierarchy } from './data-model-hierarchies.js';
import { readModelHierarchyHash, encodeModelHierarchyHash } from './data-model-hash-index.js';

const NS = 'http://schemas.microsoft.com/analysisservices/imbi';
const widths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 21, 32];
const fail = message => { throw new Error(`Unsupported Data Model rewrite: ${message}`); };
const children = (node, name) => modelChildren(node, name, NS);
const only = (nodes, label) => { if (nodes.length !== 1) fail(`missing or duplicate ${label}`); return nodes[0]; };
const child = (node, name) => only(children(node, name), name);
const collection = (node, name) => only(children(child(node, 'Collections'), 'Collection').filter(n => child(n, 'Name').textContent === name), name);
const member = (node, name) => child(only(children(child(node, 'Members'), 'Member').filter(n => child(n, 'Name').textContent === name), name), 'XMObject');
const set = (node, name, value) => { child(child(node, 'Properties'), name).textContent = String(value); };
const folderOf = path => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
function xmlFile(file) {
  if (file.size > 16 * 1048576) fail('metadata size');
  const { xml, encoding } = decodeModelXml(file.read());
  return { root: parseModelXml(xml), xml, encoding };
}
function serialize({ root, encoding }) {
  const xml = standaloneModelXml(root);
  if (xml.length > 16 * 1048576) fail('metadata size');
  if (encoding === 'utf-8') return new TextEncoder().encode(xml);
  const little = encoding === 'utf-16le';
  const bytes = new Uint8Array((xml.length + 1) * 2), view = new DataView(bytes.buffer); view.setUint16(0, 0xFEFF, little);
  for (let i = 0; i < xml.length; i++) view.setUint16(2 + i * 2, xml.charCodeAt(i), little);
  return bytes;
}
function statistics(ids, runs = 0, packedRuns = 0) {
  let min = Infinity, max = -Infinity, originalMin = Infinity, hasNulls = false;
  const distinct = new Set();
  for (const id of ids) { distinct.add(id); originalMin = Math.min(originalMin, id); if (id === 2) hasNulls = true; else { min = Math.min(min, id); max = Math.max(max, id); } }
  return { DistinctStates: distinct.size, MinDataID: min === Infinity ? 2 : min, MaxDataID: max === -Infinity ? 2 : max,
    OriginalMinSegmentDataID: originalMin === Infinity ? 2 : originalMin, RLESortOrder: -1, RowCount: ids.length, HasNulls: hasNulls, RLERuns: runs, OthersRLERuns: packedRuns };
}
function setStatistics(node, stats) { for (const [key, value] of Object.entries(stats)) set(node, key, value); }
function runStatistics(ids) {
  const packed = new Int32Array(ids.length); let count = 0, runs = 0, packedRuns = 0, lastPacked = false;
  for (let at = 0; at < ids.length;) {
    let end = at + 1; while (end < ids.length && ids[end] === ids[at]) end++;
    if (end - at >= 64) { runs++; lastPacked = false; }
    else { if (!lastPacked) packedRuns++; lastPacked = true; packed.set(ids.subarray(at, end), count); count += end - at; }
    at = end;
  }
  return { runs, packedRuns, packed: packed.subarray(0, count) };
}
function compression(node, bits, min) { node.setAttribute('class', `XMRENoSplitCompressionInfo<${bits}>`); set(node, 'Min', min); }
function updateSegment(node, segment, ids, runInfo) {
  set(node, 'Records', segment.records);
  const info = member(node, 'CompressionInfo');
  if (segment.type === 'packed') compression(info, segment.bits, segment.min);
  else {
    info.setAttribute('class', `XMHybridRLECompressionInfo<class XMRENoSplitCompressionInfo<${segment.bits}>>`);
    compression(member(info, 'SubCompression'), segment.bits, segment.min);
    const rle = member(info, 'RLECompression'); set(rle, 'StorageAllocSize', segment.allocated); set(rle, 'StorageUsedSize', segment.used); set(rle, 'SegmentNeedsResizing', false);
    const sub = member(node, 'SubSegment'); set(sub, 'Records', segment.packedRecords);
    compression(member(sub, 'CompressionInfo'), segment.bits, segment.min);
    setStatistics(member(sub, 'ColumnSegmentStats'), statistics(runInfo.packed));
  }
  setStatistics(member(node, 'ColumnSegmentStats'), statistics(ids, runInfo.runs, runInfo.packedRuns));
}

const MIN_LONG = -9223372036854775808n, MAX_LONG = 9223372036854775807n, MAX_ID = 2147483647n;
function valueEncoding(values, dictionary) {
  let divisor = 0n;
  for (const value of values) if (value !== null) {
    if (typeof value !== 'bigint' || value < MIN_LONG || value > MAX_LONG) fail('integer value');
    if (divisor !== 1n) { let next = value < 0n ? -value : value; while (next) { const remainder = divisor % next; divisor = next; next = remainder; } }
  }
  const original = dictionary.magnitude;
  // Retain the existing scale when it represents the new values exactly.
  // A reciprocal GCD may be a repeating decimal; in that case its decimal
  // power-of-ten factor remains an exact alternative before unit encoding.
  let decimalFactor = divisor;
  let decimalPlaces = 0;
  while (decimalFactor && decimalFactor % 10n === 0n) { decimalPlaces++; decimalFactor /= 10n; }
  const scales = divisor ? [1 / Number(divisor), -1 / Number(divisor), 10 ** -decimalPlaces, -(10 ** -decimalPlaces)] : [];
  for (const magnitude of new Set([original, ...scales, 1, -1])) {
    const ratio = modelMagnitudeRatio(magnitude);
    let min = null, max = null, divisible = true;
    for (const value of values) if (value !== null) {
      const product = value * ratio.numerator;
      if (product % ratio.denominator) { divisible = false; break; }
      const scaled = product / ratio.denominator;
      if (min === null || scaled < min) min = scaled;
      if (max === null || scaled > max) max = scaled;
    }
    if (!divisible) continue;
    if (min === null || magnitude === original && min - dictionary.baseId >= 3n && max - dictionary.baseId <= MAX_ID) return { baseId: dictionary.baseId, magnitude, ratio };
    // Legal bases intersect the signed-long range and the interval that maps
    // every non-null value into [3, INT32_MAX]. IDs 0..2 remain reserved.
    const upper = min - 3n, lower = max - MAX_ID;
    const baseId = upper > MAX_LONG ? MAX_LONG : upper;
    if (baseId >= MIN_LONG && baseId >= lower) return { baseId, magnitude, ratio };
  }
  fail('value range exceeds supported arithmetic encoding');
}

// MS-XLDM 2.5.2.3.1: constraints belong to every persisted column update,
// including edits that retain the same NULL membership or dictionary domain.
function validateColumnConstraints(node, ids) {
  const read = (name, max) => {
    const text = child(child(node, 'Properties'), name).textContent.trim(), value = Number(text);
    if (!/^[+-]?\d+$/.test(text) || !Number.isSafeInteger(value) || value < 0 || value > max) fail('column constraints');
    return value;
  };
  const flags = read('ColumnFlags', 63), settings = read('Settings', 7994);
  if (ids.includes(2) && (flags & 1 || settings & 0x100)) fail('column forbids null values');
  if (flags & 2 && new Set(ids).size !== ids.length) fail('column requires unique values');
}

// Numeric ordering is independent of text collation (MS-XLDM 2.5.2.9.1).
// Rebuild the dictionary and both directions of its intrinsic hierarchy together.
function numericDictionaryIds(values, dictionary, hierarchy, active, members, lookup, first) {
  if (hierarchy.sortOrder !== 0) fail('numeric hierarchy requires ascending order');
  const oldValue = id => id === 2 ? null : dictionary.values[id - first];
  const compare = (a, b) => a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1;
  for (let i = 1; i < members.length; i++) if (compare(oldValue(members[i - 1]), oldValue(members[i])) >= 0) fail('numeric hierarchy order');
  if (hierarchy.materialization === 0 && (hierarchy.idToPosition.length !== dictionary.lastId + 1
    || hierarchy.positionToId.length !== hierarchy.idToPosition.length
    || dictionary.values.some((_, i) => !active.has(first + i)))) fail('sparse dictionary hierarchy rebuild');
  const distinct = new Map(); let hasNulls = false;
  const min = dictionary.storage.operatingOn32 ? -2147483648n : MIN_LONG;
  const max = dictionary.storage.operatingOn32 ? 2147483647n : MAX_LONG;
  for (const value of values) {
    if (value === null) { hasNulls = true; continue; }
    if (dictionary.type === 'long' ? typeof value !== 'bigint' || value < min || value > max
      : typeof value !== 'number' || !Number.isFinite(value)) fail('numeric dictionary value');
    if (lookup.has(value) && !Object.is(value, dictionary.values[lookup.get(value) - first])
      || distinct.has(value) && !Object.is(value, distinct.get(value))) fail('dictionary value identity');
    distinct.set(value, value);
    if (distinct.size > 1048576) fail('distinct value limit');
  }
  // Keep surviving dictionary entries in their stored order; append new values
  // in input order. Numeric sort order belongs to the separate hierarchy.
  const retained = dictionary.values.filter(value => distinct.has(value));
  for (const value of distinct.values()) if (!lookup.has(value)) retained.push(value);
  const lastId = first + retained.length - 1;
  if (lastId > 2147483647) fail('dictionary identifier limit');
  const next = new Map(retained.map((value, i) => [value, first + i]));
  const ids = Int32Array.from(values, value => value === null ? 2 : next.get(value));
  const ordered = retained.map((_, i) => first + i).sort((a, b) => compare(retained[a - first], retained[b - first]));
  if (hasNulls) ordered.unshift(2);
  return dictionaryRebuild(ids, retained, ordered, first, hierarchy, active, hasNulls);
}

function dictionaryRebuild(ids, retained, ordered, first, hierarchy, active, hasNulls) {
  const lastId = first + retained.length - 1;
  if (lastId > 2147483647) fail('dictionary identifier limit');
  const nullChanged = hasNulls !== active.has(2), oldTail = hierarchy.positionToId.subarray(hierarchy.distinctDataIds);
  const tailCount = oldTail.length + Number(active.has(2)) - Number(hasNulls);
  if (nullChanged && (tailCount < 0 || oldTail.some(id => id !== 0))) fail('null membership requires zero-filled mapping capacity');
  const tail = nullChanged ? new Int32Array(tailCount) : oldTail;
  const capacity = hierarchy.materialization === 0 ? lastId + 1 : ordered.length + tail.length;
  if (capacity !== ordered.length + tail.length || capacity > 16 * 1048576) fail('hierarchy mapping capacity');
  return { ids, rebuild: { values: retained, lastId, ordered, nullChanged, hasNulls, capacity, tail } };
}

// Explicit binary collation keys keep comparison/version selection outside the
// archive writer. Equal keys identify one member; surviving members retain
// their stored canonical spelling. New members use the first supplied spelling.
function stringDictionaryIds(values, dictionary, hierarchy, active, members, first, keys, budget) {
  if (!(keys instanceof Map) || hierarchy.sortOrder !== 0) fail('string collation keys and ascending hierarchy required');
  if (hierarchy.materialization === 0 && (hierarchy.idToPosition.length !== dictionary.lastId + 1
    || hierarchy.positionToId.length !== hierarchy.idToPosition.length
    || dictionary.values.some((_, i) => !active.has(first + i)))) fail('sparse dictionary hierarchy rebuild');
  const cached = new Map();
  const key = value => {
    if (typeof value !== 'string') fail('string dictionary value');
    if (cached.has(value)) return cached.get(value);
    const bytes = keys.get(value);
    if (!(bytes instanceof Uint8Array)) fail('missing or invalid string collation key');
    if ((budget.remaining -= bytes.length) < 0 || cached.size >= 2 * 1048576) fail('string collation key limit');
    let text = '';
    for (let at = 0; at < bytes.length; at += 8192) text += String.fromCharCode(...bytes.subarray(at, at + 8192));
    cached.set(value, text); return text;
  };
  const previous = new Map();
  for (const value of dictionary.values) {
    const id = key(value);
    if (previous.has(id)) fail('ambiguous stored string collation identity');
    previous.set(id, value);
  }
  let previousKey;
  for (let i = 0; i < members.length; i++) {
    if (members[i] === 2) { if (i) fail('string hierarchy null order'); continue; }
    const current = key(dictionary.values[members[i] - first]);
    if (previousKey !== undefined && previousKey >= current) fail('string hierarchy collation order');
    previousKey = current;
  }
  const distinct = new Map(); let hasNulls = false;
  for (const value of values) {
    if (value === null) { hasNulls = true; continue; }
    const id = key(value);
    if (!distinct.has(id)) distinct.set(id, previous.has(id) ? previous.get(id) : value);
    if (distinct.size > 1048576) fail('distinct value limit');
  }
  const retained = dictionary.values.filter(value => distinct.has(key(value)));
  for (const [id, value] of distinct) if (!previous.has(id)) retained.push(value);
  if (first + retained.length - 1 > 2147483647) fail('dictionary identifier limit');
  const next = new Map(retained.map((value, i) => [key(value), first + i]));
  const ids = Int32Array.from(values, value => value === null ? 2 : next.get(key(value)));
  const ordered = [...next].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(entry => entry[1]);
  if (hasNulls) ordered.unshift(2);
  return dictionaryRebuild(ids, retained, ordered, first, hierarchy, active, hasNulls);
}

// Reuse exact dictionary values and persisted member order when possible.
// New numeric members use type ordering; new strings require a collation-aware
// rebuild. Removing strings retains their persisted relative order.
function existingDictionaryIds(archive, table, name, values, dictionary, hierarchy, keys, budget) {
  const oldIds = readModelColumnIdentifiers(archive, table, name);
  decodeModelValues(oldIds, dictionary); // Validate source statistics and ID bounds.
  if (![0, 1].includes(hierarchy.materialization) || !hierarchy.isProcessed) fail('hierarchy materialization');
  const active = new Set(oldIds), members = hierarchy.positionToId.subarray(0, hierarchy.distinctDataIds);
  if (members.length !== active.size || new Set(members).size !== active.size || members.some(id => !active.has(id))) fail('hierarchy member set');
  if (hierarchy.materialization === 1) readModelHierarchyHash(archive, table, name);
  else {
    if (hierarchy.idToPosition[1] !== members.length) fail('hierarchy inverse end position');
    for (let i = 0; i < members.length; i++) if (hierarchy.idToPosition[members[i]] !== i) fail('hierarchy inverse');
  }
  const lookup = new Map(), first = dictionary.lastId - dictionary.values.length + 1;
  for (let i = 0; i < dictionary.values.length; i++) {
    const value = dictionary.values[i], id = first + i;
    if (id < 3 || id > 2147483647 || lookup.has(value)) fail('ambiguous dictionary identity');
    lookup.set(value, id);
  }
  if (keys !== undefined) {
    if (dictionary.type !== 'string') fail('collation keys require a string dictionary');
    return stringDictionaryIds(values, dictionary, hierarchy, active, members, first, keys, budget);
  }
  if (dictionary.type !== 'string' && (values.some(value => value !== null && (!lookup.has(value) || !active.has(lookup.get(value))))
    || values.includes(null) !== active.has(2))) return numericDictionaryIds(values, dictionary, hierarchy, active, members, lookup, first);
  const ids = new Int32Array(values.length), next = new Set();
  for (let i = 0; i < values.length; i++) {
    const value = values[i], id = value === null ? 2 : lookup.get(value);
    if (id === undefined || id !== 2 && !active.has(id)) fail('dictionary member rebuild required');
    // Map treats signed zero as equal; preserve a real dictionary's exact value.
    if (value !== null && !Object.is(value, dictionary.values[id - first])) fail('dictionary value identity');
    ids[i] = id; next.add(id);
  }
  const nullChanged = next.has(2) !== active.has(2);
  if (nullChanged) {
    if (dictionary.type !== 'string' || hierarchy.materialization !== 0 || hierarchy.sortOrder !== 0
      || hierarchy.positionToId.subarray(hierarchy.distinctDataIds).some(id => id !== 0)
      || active.has(2) && members[0] !== 2) fail('null membership requires dense string hierarchy');
  }
  if (!nullChanged && next.size === active.size) return { ids, rebuild: null };
  if (hierarchy.materialization === 0 && (hierarchy.idToPosition.length !== dictionary.lastId + 1
    || hierarchy.positionToId.length !== hierarchy.idToPosition.length
    || dictionary.values.some((_, i) => !active.has(first + i)))) fail('sparse dictionary hierarchy rebuild');
  const remap = new Map([[2, 2]]), retained = [];
  for (let i = 0; i < dictionary.values.length; i++) {
    const id = first + i;
    if (active.has(id) && !next.has(id)) continue;
    remap.set(id, first + retained.length); retained.push(dictionary.values[i]);
  }
  for (let i = 0; i < ids.length; i++) ids[i] = remap.get(ids[i]);
  const ordered = Array.from(members).filter(id => next.has(id)).map(id => remap.get(id));
  // String BLANK precedes every string, including the empty string. The relative
  // collation order of non-null members remains exactly as persisted.
  if (next.has(2) && !active.has(2)) ordered.unshift(2);
  return { ids, rebuild: { values: retained, lastId: first + retained.length - 1, ordered, nullChanged, hasNulls: next.has(2) } };
}

/** Rewrite fixed-row-count hash-dictionary columns and their hierarchy indexes.
 * Existing members retain dictionary order. New numeric values use the declared
 * ascending numeric hierarchy; new strings require a collation-aware rebuild.
 * Dense string and ascending numeric profiles allow NULL membership changes. Values
 * are storage values in storage row order, not worksheet order or display text.
 * Callers must also update dependent relationships and report caches.
 * stringSortKeys optionally maps column names to Maps of strings to Uint8Array
 * collation keys. Supply every old and new non-null value using the column's
 * resolved collation/version. Equal keys share a canonical member. Old hierarchy
 * order is validated; total distinct-string key bytes are limited to 16 MiB.
 */
export function rewriteModelDictionaryColumns(input, tablePath, updates, { stringSortKeys = null } = {}) {
  return rewriteColumns(input, tablePath, updates, true, null, stringSortKeys);
}

/** Atomically rewrite fixed-row-count integer value-encoded columns and their
 * materialized hash hierarchies. This is the storage stage of refresh: callers
 * must separately update related calculated columns, relationships and report
 * caches. No workbook UI refresh is claimed by this container-level operation.
 * Other dictionary/materialization profiles require their own coordinated path.
 */
export function rewriteModelValueColumns(input, tablePath, updates) {
  return rewriteColumns(input, tablePath, updates, false);
}

/** Replace a complete fixed-size table projection, with every column supplied
 * in the same physical row order. No source-to-stored row correspondence is
 * inferred: all ordinary columns are rewritten together. Unchanged generated
 * sequence columns retain their original storage. The caller must prepare the
 * related calculated data, relationships and report caches before committing.
 */
export function rewriteModelTableRows(input, tablePath, columns, { maxValues = 4 * 1048576, stringSortKeys = null } = {}) {
  if (!Number.isSafeInteger(maxValues) || maxValues < 0 || maxValues > 16 * 1048576) fail('table value limit');
  return rewriteColumns(input, tablePath, columns, 'table', maxValues, stringSortKeys);
}

/** Rebuild a complete table batch against one immutable archive, then repack
 * once. Shared storage writes are ambiguous dependencies, never last-writer wins.
 */
export function rewriteModelTables(input, tables, { maxValues = 4 * 1048576, stringSortKeys = null } = {}) {
  if (!(tables instanceof Map) || !tables.size || !Number.isSafeInteger(maxValues) || maxValues < 0 || maxValues > 16 * 1048576) fail('table batch or value limit');
  if (stringSortKeys !== null && (!(stringSortKeys instanceof Map) || [...stringSortKeys].some(([path, columns]) => !tables.has(path) || !(columns instanceof Map)))) fail('collation table keys');
  const archive = readDataModelArchive(input), changes = new Map(), keyBudget = { remaining: 16 * 1048576 };
  let remaining = maxValues;
  for (const [path, columns] of tables) {
    const prepared = prepareColumnChanges(archive, path, columns, 'table', remaining, stringSortKeys?.get(path) || null, keyBudget);
    for (const values of columns.values()) remaining -= values.length;
    for (const [file, bytes] of prepared) {
      if (changes.has(file)) fail('shared table storage dependency');
      changes.set(file, bytes);
    }
  }
  return replaceDataModelArchiveFiles(input, changes);
}

function rewriteColumns(input, tablePath, updates, mode, maxValues = null, stringSortKeys = null) {
  const changes = prepareColumnChanges(readDataModelArchive(input), tablePath, updates, mode, maxValues, stringSortKeys);
  return replaceDataModelArchiveFiles(input, changes);
}
function prepareColumnChanges(archive, tablePath, updates, mode, maxValues = null, stringSortKeys = null, keyBudget = { remaining: 16 * 1048576 }) {
  if (!(updates instanceof Map) || !updates.size) fail('column updates');
  if (stringSortKeys !== null && (!(stringSortKeys instanceof Map)
    || [...stringSortKeys].some(([name, keys]) => !updates.has(name) || !(keys instanceof Map)))) fail('string collation column keys');
  const table = only(archive.files.filter(f => f.path === tablePath), 'table');
  const document = xmlFile(table), schema = readModelColumnStorage(document.xml), changes = new Map();
  if (!schema.partitionMaps) fail('missing table partition maps');
  if (mode === 'table') {
    const rows = schema.partitionMaps.reduce((count, part) => count + part.records, 0);
    if (updates.size !== schema.columns.length || schema.columns.some(column => !updates.has(column.name))) fail('complete table projection required');
    if (rows * schema.columns.length > maxValues) fail('table value limit');
    for (const values of updates.values()) if (!Array.isArray(values) || values.length !== rows) fail('table row count');
  }
  const put = (path, bytes) => {
    only(archive.files.filter(f => f.path === path), 'storage file');
    if (changes.has(path) || path === tablePath) fail('shared storage dependency');
    changes.set(path, bytes);
  };
  for (const [name, values] of updates) {
    const column = only(schema.columns.filter(c => c.name === name), 'column'), dictionary = readModelDictionary(archive, table, name);
    if (stringSortKeys?.has(name) && (dictionary.kind !== 'hash' || dictionary.type !== 'string')) fail('collation keys require a string dictionary');
    const dictionaryOnly = mode === true || mode === 'table' && dictionary.kind === 'hash';
    if (dictionaryOnly) { if (dictionary.kind !== 'hash') fail('hash dictionary required'); }
    else if (dictionary.kind !== 'value' || dictionary.type !== 'long' || !Number.isFinite(dictionary.magnitude) || dictionary.magnitude === 0) fail('value encoding');
    if (!Array.isArray(values) || values.length !== dictionary.stats?.rows || values.length > 16 * 1048576) fail('row count');
    if (mode === 'table' && column.segments.length && column.segments.every(s => s.type === 'sequence')) {
      const previous = decodeModelValues(readModelColumnIdentifiers(archive, table, name), dictionary);
      if (values.some((value, i) => !Object.is(value, previous[i]))) fail('generated sequence changes require a table rebuild');
      continue;
    }
    if (column.segments.some(s => !['packed', 'hybrid'].includes(s.type))) fail('column compression');
    const hierarchy = readModelIntrinsicHierarchy(archive, table, name);
    const node = only(children(collection(document.root, 'Columns'), 'XMObject').filter(c => c.getAttribute('name') === name), 'column');
    let ids, distinct, rebuild = null, valueTail = null;
    if (dictionaryOnly) ({ ids, rebuild } = existingDictionaryIds(archive, table, name, values, dictionary, hierarchy, stringSortKeys?.get(name), keyBudget));
    else {
      if (hierarchy.materialization !== 1 || !hierarchy.isProcessed || hierarchy.sortOrder !== 0) fail('hierarchy materialization');
      readModelHierarchyHash(archive, table, name); // Validate the old inverse before replacing it.
      const encoding = valueEncoding(values, dictionary), { magnitude } = encoding;
      ids = new Int32Array(values.length); distinct = new Map();
      for (let i = 0; i < values.length; i++) {
        const value = values[i]; let id = 2;
        if (value !== null) {
          const encoded = value * encoding.ratio.numerator / encoding.ratio.denominator - encoding.baseId;
          id = Number(encoded);
        }
        ids[i] = id; distinct.set(id, value);
        if (distinct.size > 1048576) fail('distinct value limit');
      }
      if (distinct.has(2) !== dictionary.stats.hasNulls) {
        const oldIds = readModelColumnIdentifiers(archive, table, name); decodeModelValues(oldIds, dictionary);
        const active = new Set(oldIds), members = hierarchy.positionToId.subarray(0, hierarchy.distinctDataIds);
        if (active.has(2) !== dictionary.stats.hasNulls || members.length !== active.size || members.some(id => !active.has(id))
          || active.has(2) && members[0] !== 2) fail('inconsistent null hierarchy');
        const tail = hierarchy.positionToId.subarray(hierarchy.distinctDataIds);
        // NULL moves between the active prefix and the existing zero-filled
        // unused capacity. Keep that footprint relative to non-null members;
        // do not assume a producer-specific number of reserved slots.
        const count = tail.length + Number(active.has(2)) - Number(distinct.has(2));
        if (count < 0 || tail.some(id => id !== 0)) fail('null membership requires zero-filled mapping capacity');
        valueTail = new Int32Array(count);
      }
      const valueDictionary = only(children(child(node, 'DataObjects'), 'DataObject').map(d => child(d, 'XMObject')).filter(d => d.getAttribute('class') === 'XMValueDataDictionary<XM_Long>'), 'value dictionary');
      set(valueDictionary, 'BaseId', encoding.baseId); set(valueDictionary, 'Magnitude', encoding.magnitude);
    }
    validateColumnConstraints(node, ids);
    const segmentNodes = children(collection(node, 'Segments'), 'XMObject');
    let row = 0, segmentAt = 0, totalRuns = 0, totalPackedRuns = 0;
    if (column.files.length !== schema.partitions.length) fail('column partition count');
    for (const partition of schema.partitions) {
      const data = only(column.files.filter(f => f.partition === partition), 'partition file'), specs = column.segments.slice(segmentAt, segmentAt + data.segments);
      if (specs.length !== data.segments) fail('partition segment count');
      const count = specs.reduce((n, s) => n + s.records, 0), part = ids.subarray(row, row + count); let relative = 0;
      const next = specs.map(s => { let min = Infinity, max = -Infinity; for (const id of part.subarray(relative, relative + s.records)) { min = Math.min(min, id); max = Math.max(max, id); } relative += s.records;
        if (!s.records) min = max = 0;
        return { ...s, min, bits: widths.find(bits => max - min < 2 ** bits) };
      });
      const encoded = encodeModelColumnIds(part, next); relative = 0;
      encoded.segments.forEach((s, i) => {
        const slice = part.subarray(relative, relative + s.records), info = s.type === 'hybrid' ? runStatistics(slice) : { runs: 0, packedRuns: 0, packed: slice };
        updateSegment(segmentNodes[segmentAt + i], s, slice, info); totalRuns += info.runs; totalPackedRuns += info.packedRuns; relative += s.records;
      });
      put(folderOf(tablePath) + data.name, encoded.bytes); row += count; segmentAt += specs.length;
    }
    if (row !== ids.length || segmentAt !== column.segments.length) fail('unassigned segments');
    setStatistics(member(node, 'ColumnStats'), statistics(ids, totalRuns, totalPackedRuns));
    if (dictionaryOnly && !rebuild) continue;
    if (rebuild) {
      const dict = only(children(child(node, 'DataObjects'), 'DataObject').map(d => child(d, 'XMObject')).filter(d => /^XMHashDataDictionary</.test(d.getAttribute('class'))), 'hash dictionary');
      set(dict, 'LastId', rebuild.lastId);
      if (rebuild.nullChanged) set(dict, 'Nullable', rebuild.hasNulls);
      const options = dictionary.storage;
      put(options.path, dictionary.type === 'string' ? encodeModelStringDictionary(rebuild.values, options)
        : encodeModelNumericDictionary(rebuild.values, { ...options, type: dictionary.type }));
    }
    const ordered = rebuild ? rebuild.ordered : [...distinct].sort((a, b) => a[1] === b[1] ? 0 : a[1] === null ? -1 : b[1] === null ? 1 : a[1] < b[1] ? -1 : 1).map(([id]) => id);
    const tail = rebuild?.tail || valueTail || hierarchy.positionToId.subarray(hierarchy.distinctDataIds);
    const capacity = rebuild?.capacity ?? (rebuild?.nullChanged ? rebuild.lastId + 1 : ordered.length + tail.length);
    if (capacity < ordered.length) fail('hierarchy mapping capacity');
    const forward = new Int32Array(capacity); forward.set(ordered);
    if (!rebuild?.nullChanged || rebuild?.tail) forward.set(tail, ordered.length);
    const storageFile = only(archive.files.filter(f => f.path === hierarchy.storagePath), 'hierarchy table'), storage = xmlFile(storageFile), layout = readModelColumnStorage(storage.xml, { hierarchy: true });
    const names = hierarchy.materialization === 0 ? ['POS_TO_ID', 'ID_TO_POS'] : ['POS_TO_ID'];
    if (layout.columns.length !== names.length || layout.columns.some(c => !names.includes(c.name) || c.files.length !== 1)) fail('hierarchy storage layout');
    const arrays = new Map([['POS_TO_ID', forward]]);
    if (hierarchy.materialization === 0) {
      const inverse = new Int32Array(rebuild.lastId + 1);
      inverse.set(hierarchy.idToPosition.subarray(0, inverse.length));
      // Native dense inverse maps use reserved ID 1 for the one-past-end
      // hierarchy position. It changes with the active member count.
      inverse[1] = ordered.length;
      // The dense profile keeps reserved identifiers below the dictionary range.
      // Every remaining dictionary identifier is active and is assigned below.
      if (rebuild.nullChanged && !rebuild.hasNulls) inverse[2] = 0;
      ordered.forEach((id, i) => { inverse[id] = i; }); arrays.set('ID_TO_POS', inverse);
      if (inverse.length !== forward.length) fail('hierarchy mapping lengths');
    }
    for (const name of names) {
      const mapping = only(layout.columns.filter(c => c.name === name), 'mapping column');
      const mappingNode = only(children(collection(storage.root, 'Columns'), 'XMObject').filter(c => c.getAttribute('name') === name), 'mapping column');
      const mappingSegments = collection(mappingNode, 'Segments'), template = only(children(mappingSegments, 'XMObject').slice(0, 1), 'mapping segment').cloneNode(true);
      const values = arrays.get(name); let min = 0; for (const id of values) min = Math.min(min, id);
      const encoded = encodeModelMappingIds(values, [{ type: 'packed', bits: 32, min, records: values.length }]);
      set(template, 'Records', values.length); compression(member(template, 'CompressionInfo'), 32, min);
      for (const old of children(mappingSegments, 'XMObject')) mappingSegments.removeChild(old); mappingSegments.appendChild(template);
      const object = only(children(child(mappingNode, 'DataObjects'), 'DataObject').map(d => child(d, 'XMObject')).filter(d => d.getAttribute('class') === 'XMRawColumnPartitionDataObject'), 'mapping data'); set(object, 'SegmentCount', 1);
      put(folderOf(storageFile.path) + mapping.files[0].name, encoded.bytes);
    }
    const map = member(storage.root, 'SegmentMap'), props = child(map, 'Properties'), records = child(props, 'Records').cloneNode(true);
    while (props.firstChild) props.removeChild(props.firstChild); records.textContent = String(forward.length); props.appendChild(records); map.setAttribute('class', 'XMSegment1Map');
    set(member(node, 'IntrinsicHierarchy'), 'DistinctDataIDs', ordered.length);
    put(storageFile.path, serialize(storage));
    if (hierarchy.hashIndex) put(hierarchy.hashIndex.path, encodeModelHierarchyHash(new Map(ordered.map((id, i) => [id, i]))));
  }
  changes.set(tablePath, serialize(document));
  return changes;
}
