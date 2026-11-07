/**
 * Storage layout shared by the browser backend and (mirrored by hand, see
 * tests/keys-parity.test.js) the team worker.
 *
 * Two kinds of collections:
 *
 *  - Static collections (students, rooms, invoices...) are small enough to
 *    load whole. Each record is one KV item under cc1:r:<coll>:<id>.
 *
 *  - Partitioned collections grow without bound (activities, attendance,
 *    messages), so they are split into partitions named "<base>:<key>":
 *      activities:2026-10-12   one school day of activity logs
 *      attendance:2026-10-12   one school day of check-ins and absences
 *      messages:<studentId>    one family conversation
 *    A partition is loaded with one prefix query when a screen needs it.
 *
 * Every collection and partition has a version number, bumped with an atomic
 * incr after each write batch, so a device re-reads only what moved. Versions
 * live in a few small meta items rather than one ever-growing one (KV bills a
 * write by the size of the whole item):
 *      cc1:meta              static collections and settings
 *      cc1:meta:d:2026-10    day partitions of that month
 *      cc1:meta:m            message threads
 */
export const PREFIX = 'cc1:';

export const COLLECTIONS = [
  'students',
  'guardians',
  'rooms',
  'staff',
  'events',
  'menus',
  'plans',
  'invoices',
  'payments',
  'announcements',
  'threads',
];

export const PARTITIONED = ['activities', 'attendance', 'messages'];
const DAY_PARTITIONED = new Set(['activities', 'attendance']);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_KEY_RE = /^[A-Za-z0-9]{1,40}$/;

export function partition(base, key) {
  return `${base}:${key}`;
}

/** Split "activities:2026-10-12" into { base, key }; static names have no key. */
export function splitName(name) {
  const i = name.indexOf(':');
  return i < 0 ? { base: name, key: null } : { base: name.slice(0, i), key: name.slice(i + 1) };
}

export function baseOf(name) {
  return splitName(name).base;
}

/** Whether a store name is a known collection, partition, or settings. */
export function isValidName(name) {
  if (name === 'settings') return true;
  const { base, key } = splitName(String(name));
  if (key === null) return COLLECTIONS.includes(base);
  if (DAY_PARTITIONED.has(base)) return DAY_RE.test(key);
  if (base === 'messages') return ID_KEY_RE.test(key);
  return false;
}

export const recordKey = (name, id) => `${PREFIX}r:${name}:${id}`;
export const recordPrefix = (name) => `${PREFIX}r:${name}:`;

/**
 * Where a name's version lives: { key, path }. `path` is a plain
 * alphanumeric field name, safe for KV's dotted incr paths.
 */
export function metaSlot(name) {
  const { base, key } = splitName(name);
  if (key === null) return { key: `${PREFIX}meta`, path: base };
  if (DAY_PARTITIONED.has(base)) return { key: `${PREFIX}meta:d:${key.slice(0, 7)}`, path: `${base}${key.slice(8, 10)}` };
  return { key: `${PREFIX}meta:m`, path: `t${key}` };
}

/** The inverse of metaSlot for one meta item: path -> store name. */
export function nameFromSlot(metaKey, path) {
  if (metaKey === `${PREFIX}meta`) return path;
  if (metaKey === `${PREFIX}meta:m`) return path.startsWith('t') ? partition('messages', path.slice(1)) : null;
  const m = /^cc1:meta:d:(\d{4}-\d{2})$/.exec(metaKey);
  const p = /^(activities|attendance)(\d{2})$/.exec(path);
  return m && p ? partition(p[1], `${m[1]}-${p[2]}`) : null;
}

/** Meta keys to read so a sync covers these names. */
export function metaKeysFor(names) {
  const keys = new Set([`${PREFIX}meta`]);
  for (const n of names) keys.add(metaSlot(n).key);
  return [...keys];
}

/** Flatten meta items { [metaKey]: { path: version } } to { name: version }. */
export function flattenMeta(items) {
  const out = {};
  for (const [metaKey, obj] of Object.entries(items || {})) {
    if (!obj || typeof obj !== 'object') continue;
    for (const [path, v] of Object.entries(obj)) {
      const name = nameFromSlot(metaKey, path);
      if (name) out[name] = Number(v) || 0;
    }
  }
  return out;
}

/** Group names by meta item for incr: { [metaKey]: { path: 1 } }. */
export function bumpPlan(names) {
  const plan = {};
  for (const n of names) {
    const { key, path } = metaSlot(n);
    (plan[key] ||= {})[path] = 1;
  }
  return plan;
}

export const dayPartition = (base, day) => partition(base, day);
export const monthMetaKey = (month) => `${PREFIX}meta:d:${month}`;
