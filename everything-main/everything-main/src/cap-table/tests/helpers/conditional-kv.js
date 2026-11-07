/**
 * Store unit tests exercise the conditional-storage interface against their
 * existing fault-injected KV doubles. kv.test.js and concurrency.test.js use
 * the real persistence implementation and an atomic-append backend instead.
 */
export async function conditionalKVMock(importOriginal) {
  const actual = await importOriginal();
  const queues = new WeakMap();
  const revisions = new WeakMap();
  const bytes = (raw) => raw == null ? null : typeof raw === 'string' ? raw : JSON.stringify(raw);
  const readKV = async (key) => {
    const raw = await puter.kv.get(key);
    let remembered = revisions.get(puter.kv)?.get(key);
    while (remembered && remembered.raw !== bytes(raw)) remembered = remembered.prior;
    return { raw, revision: remembered?.revision ?? bytes(raw), deleted: remembered?.deleted === true };
  };
  return {
    ...actual,
    readKV,
    getKV: async (key) => (await readKV(key)).raw,
    deleteKV: async (key) => {
      const raw = await puter.kv.get(key);
      await puter.kv.del?.(key);
      return raw;
    },
    compareAndSetKV: async (key, expected, raw, { revision = crypto.randomUUID() } = {}) => {
      const kv = puter.kv;
      if (!queues.has(kv)) queues.set(kv, new Map());
      const pending = queues.get(kv);
      const run = (pending.get(key) || Promise.resolve()).then(async () => {
        const current = await readKV(key);
        // A plain value never published through here stands at the initial revision, as in kv.js.
        const plain = expected.revision === actual.INITIAL && current.raw != null && !revisions.get(kv)?.get(key);
        if (!plain && current.revision !== expected.revision) throw new actual.KVConflictError(key);
        if (!revisions.has(kv)) revisions.set(kv, new Map());
        // Track candidate identity before calling a stub which may commit and
        // take its reads offline before returning an acknowledgement.
        const prior = revisions.get(kv).get(key);
        revisions.get(kv).set(key, { raw: bytes(raw), revision, prior, deleted: raw == null });
        if (raw == null && kv.del) await kv.del(key);
        else await kv.set(key, raw);
        return { raw, revision };
      });
      pending.set(key, run.catch(() => {}));
      return run;
    },
  };
}
