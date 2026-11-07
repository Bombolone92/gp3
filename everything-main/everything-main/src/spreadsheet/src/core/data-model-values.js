import { readModelColumnIdentifiers } from './data-model-columns.js';
import { readModelDictionary } from './data-model-dictionaries.js';

const fail = message => { throw new Error(`Invalid Data Model values: ${message}`); };
// Engine-reserved XM_DATA_ID_NULL; never derive it from a segment minimum.
// See https://github.com/Hugoberry/pbixray/blob/main/pbixray/vertipaq_decoder.py
const NULL_ID = 2;
const MIN_LONG = -9223372036854775808n, MAX_LONG = 9223372036854775807n;

/** Decimal magnitude metadata must not round a 64-bit integer through Number.
 * Keep the finite serialized scale as an exact ratio for integer arithmetic. */
export function modelMagnitudeRatio(magnitude) {
  if (typeof magnitude !== 'number' || !Number.isFinite(magnitude) || magnitude === 0) fail('dictionary magnitude');
  const [mantissa, exponent = '0'] = String(magnitude).split('e');
  const places = (mantissa.split('.')[1] || '').length - Number(exponent);
  const numerator = BigInt(mantissa.replace('.', ''));
  return places > 0 ? { numerator, denominator: 10n ** BigInt(places) }
    : { numerator: numerator * 10n ** BigInt(-places), denominator: 1n };
}

/** Join persisted identifiers to their declared dictionary. Results are raw
 * storage values (string, bigint, double or null), in storage row order, not
 * worksheet cell values. This does not refresh or mutate the model archive.
 */
export function decodeModelValues(ids, dictionary) {
  if (!(ids instanceof Int32Array) || ids.length > 16 * 1048576 || !dictionary) fail('input');
  const { kind, type, stats } = dictionary;
  if (!['hash', 'value'].includes(kind) || !['string', 'long', 'real'].includes(type)) fail('dictionary type');
  if (!stats || stats.rows !== ids.length || typeof stats.hasNulls !== 'boolean' || stats.xmType !== { long: 0, real: 1, string: 2 }[type]) fail('column statistics');
  for (const n of [stats.min, stats.max]) if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) fail('statistics bounds');
  let firstId, ratio;
  if (kind === 'hash') {
    if (!Array.isArray(dictionary.values) || dictionary.values.length > 1048576 || !Number.isInteger(dictionary.lastId) || dictionary.lastId < -2147483648 || dictionary.lastId > 2147483647) fail('hash dictionary');
    firstId = dictionary.lastId - dictionary.values.length + 1;
    if (firstId < -2147483648) fail('dictionary identifier range');
  } else {
    if (type === 'string' || typeof dictionary.baseId !== 'bigint' || dictionary.baseId < MIN_LONG || dictionary.baseId > MAX_LONG) fail('value dictionary');
    // A native XMValueDataDictionary stores the encoding multiplier:
    // value = (id + BaseId) / Magnitude. MS-XLDM 2.5.2.18.1 describes the
    // opposite direction; native scaled columns and their report caches agree
    // on division (also used by independent VertiPaq decoders).
    ratio = modelMagnitudeRatio(dictionary.magnitude);
  }
  const values = new Array(ids.length);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (id === NULL_ID) {
      if (!stats.hasNulls) fail('undeclared null identifier');
      values[i] = null; continue;
    }
    if (id < stats.min || id > stats.max) fail('identifier outside column statistics');
    let value;
    if (kind === 'hash') {
      const index = id - firstId;
      if (index < 0 || index >= dictionary.values.length) fail('identifier outside dictionary');
      value = dictionary.values[index];
    } else {
      const sum = BigInt(id) + dictionary.baseId;
      if (type === 'long') {
        const scaled = sum * ratio.denominator;
        if (scaled % ratio.numerator) fail('fractional integer value');
        value = scaled / ratio.numerator;
      } else value = Number(sum) / dictionary.magnitude;
    }
    if (type === 'long' && (typeof value !== 'bigint' || value < MIN_LONG || value > MAX_LONG)
      || type === 'real' && (typeof value !== 'number' || !Number.isFinite(value))
      || type === 'string' && typeof value !== 'string') fail('decoded value type or bounds');
    values[i] = value;
  }
  return values;
}

export function readModelColumnValues(archive, tableFile, columnName, options = {}) {
  const dictionary = readModelDictionary(archive, tableFile, columnName, options);
  const ids = readModelColumnIdentifiers(archive, tableFile, columnName, options);
  return decodeModelValues(ids, dictionary);
}
