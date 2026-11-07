/**
 * Memoized lookups over store collections. store.all(coll) returns the same
 * array until that collection changes, so results are cached per array in a
 * WeakMap and rebuilt only after a change. This keeps per-matter and
 * per-contact views O(1) to look up instead of scanning every record on each
 * render.
 */
const groupCache = new WeakMap();

/** Map of key -> records[] for list grouped by record[field]. */
export function groupBy(list, field) {
  let byField = groupCache.get(list);
  if (!byField) {
    byField = new Map();
    groupCache.set(list, byField);
  }
  let groups = byField.get(field);
  if (!groups) {
    groups = new Map();
    for (const r of list) {
      const keys = Array.isArray(r[field]) ? r[field] : [r[field]];
      for (const k of keys) {
        if (k === null || k === undefined || k === '') continue;
        let arr = groups.get(k);
        if (!arr) groups.set(k, (arr = []));
        arr.push(r);
      }
    }
    byField.set(field, groups);
  }
  return groups;
}

const EMPTY = Object.freeze([]);

/** Records of `coll` whose `field` equals `value`. */
export function where(store, coll, field, value) {
  return groupBy(store.all(coll), field).get(value) || EMPTY;
}

/** Matters a contact is party to (as client or related contact). */
const partyCache = new WeakMap();
export function mattersForContact(store, contactId) {
  const list = store.all('matters');
  let idx = partyCache.get(list);
  if (!idx) {
    idx = new Map();
    const add = (cid, m, rel) => {
      if (!cid) return;
      if (!idx.has(cid)) idx.set(cid, []);
      idx.get(cid).push({ matter: m, relationship: rel });
    };
    for (const m of list) {
      add(m.clientId, m, 'Client');
      for (const r of m.related || []) add(r.contactId, m, r.relationship || 'Related');
    }
    partyCache.set(list, idx);
  }
  return idx.get(contactId) || EMPTY;
}

/** Sorted copy with a cheap memo on (array, key). */
const sortCache = new WeakMap();
export function sortedBy(list, key, fn) {
  let byKey = sortCache.get(list);
  if (!byKey) sortCache.set(list, (byKey = new Map()));
  let out = byKey.get(key);
  if (!out) {
    out = [...list].sort(fn);
    byKey.set(key, out);
  }
  return out;
}
