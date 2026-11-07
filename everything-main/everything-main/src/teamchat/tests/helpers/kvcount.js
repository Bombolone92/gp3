/**
 * Count the store round trips a request makes. Wraps the methods of the
 * runtime's in-memory kv in place (the worker reaches the store through the
 * runtime's getter, so the same object is what it calls) and tallies each
 * call by method, keeping the keys read so a document read twice in one
 * request shows up. `getMany` in the worker is a batch of `get`s, and is
 * counted as such: what is measured is what the real store would be asked.
 *
 *   const c = countKv(rt);
 *   await as(alice).post(...);
 *   c.counts            // { get: 5, update: 2, ... }
 *   c.total()           // every call
 *   c.duplicateGets()   // keys read more than once since the last reset
 *   c.reset(); c.restore();
 *
 * A batched read (`kv.get([...])`, what the worker's getMany makes) counts as
 * the one round trip it is, while each key in it is remembered for
 * duplicateGets: reading the same document twice is still a duplicate,
 * whether or not the two reads shared a call.
 */
const METHODS = ['get', 'set', 'del', 'incr', 'decr', 'add', 'update', 'remove', 'expire', 'expireAt', 'list'];

export function countKv(rt) {
  const kv = rt.kv;
  const orig = {};
  const counts = {};
  const keys = { get: [], set: [], update: [], incr: [], add: [], remove: [], del: [] };
  const reset = () => {
    for (const m of METHODS) counts[m] = 0;
    for (const m of Object.keys(keys)) keys[m] = [];
  };
  reset();
  for (const m of METHODS) {
    if (typeof kv[m] !== 'function') continue;
    orig[m] = kv[m];
    kv[m] = (k, ...rest) => {
      counts[m]++;
      if (keys[m]) keys[m].push(...(Array.isArray(k) ? k.map(String) : [String(k)]));
      return orig[m].call(kv, k, ...rest);
    };
  }
  const total = () => Object.values(counts).reduce((a, b) => a + b, 0);
  const duplicateGets = () => {
    const seen = new Map();
    for (const k of keys.get) seen.set(k, (seen.get(k) || 0) + 1);
    return [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`);
  };
  const restore = () => { for (const m of Object.keys(orig)) kv[m] = orig[m]; };
  const summary = () => Object.entries(counts).filter(([, n]) => n).map(([m, n]) => `${m}:${n}`).join(' ');
  return { counts, keys, total, duplicateGets, reset, restore, summary };
}
