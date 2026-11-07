/**
 * Conditional writes over Puter's atomic list append. KV has no native CAS.
 *
 * Each revision has an immutable value and a list of proposed successors.
 * The FIRST appended successor wins. Its value is uploaded before the append,
 * so a closed tab cannot leave an accepted revision waiting for its writer.
 * The ordinary key is only a shortcut to a revision: a delayed shortcut write
 * may point backwards, but readers follow successors to the current value.
 * No lease, timer, or browser-local lock is involved.
 *
 * Legacy values use the fixed "initial" revision until their first write.
 * Successor links stay permanently; superseded payloads can be removed.
 * Sources: https://docs.puter.com/KV/add/ and Puter's SystemKVStore.add,
 * which uses a single DynamoDB list_append update and returns the new list.
 *
 * A read costs one round trip per hop: the shortcut, then each revision's
 * successor link and payload fetched together. This context also remembers
 * the head it last saw at every key and starts the next read there, which
 * makes the common read - the save that follows a load, or the next save -
 * a single hop. The memory is only a starting point, never an answer:
 * successors are still followed from it, and a memory nothing confirms is
 * dropped for the shortcut.
 */

export class KVConflictError extends Error {
  constructor(key) {
    super(`The value at ${key} changed during the write.`);
    this.name = 'KVConflictError';
    this.key = key;
  }
}

export class KVReadError extends Error {
  constructor(key) {
    super(`The revision stored at ${key} could not be read.`);
    this.name = 'KVReadError';
    this.key = key;
  }
}

/** The revision of a value written without a conditional publication (a
 * legacy value, or one a caller set plainly on a key it alone knows about). */
export const INITIAL = 'initial';
const marker = '__captableRevision';
const revisionId = (id) => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
const linkKey = (key, revision) => `${key}:revision:${revision}:next`;
const valueKey = (key, revision) => `${key}:revision:${revision}:value`;
const absent = (value) => value === null || value === undefined;

function decode(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function pointer(value, key) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !revisionId(value[marker]) || (value.deleted !== undefined && value.deleted !== true)) {
    throw new KVReadError(key);
  }
  return { revision: value[marker], deleted: value.deleted === true };
}

/**
 * The head this context last saw at each key: where a read starts, never
 * what it returns. Only a live head, whose payload confirms it on the next
 * read; a tombstone has no payload, so one remembered from a store that has
 * since been replaced would be believed and start a second chain.
 */
const heads = new Map();
const remember = (key, head) => {
  if (head.deleted) heads.delete(key);
  else heads.set(key, { revision: head.revision, deleted: false });
};

/** Read a value and the revision a later conditional write must replace. */
export async function readKV(key) {
  let remembered = heads.get(key) ?? null;
  // A reader overtaken by payload cleanup restarts at the shortcut.
  for (let attempt = 0; attempt < 3; attempt++) {
    let initial = null;
    let head = remembered;
    if (!head) {
      initial = await puter.kv.get(key);
      const parsed = decode(initial);
      head = parsed && typeof parsed === 'object' && Object.hasOwn(parsed, marker)
        ? pointer(parsed, key) : { revision: INITIAL, deleted: false };
    }
    const visited = new Set();
    let raw = null;
    for (;;) {
      if (visited.has(head.revision)) throw new KVReadError(key);
      visited.add(head.revision);
      // The link and the payload in one round trip. The payload is only
      // wasted when a successor exists, which means the start was behind.
      const [next, value] = await Promise.all([
        puter.kv.get(linkKey(key, head.revision)).then(decode),
        head.deleted || head.revision === INITIAL ? null : puter.kv.get(valueKey(key, head.revision)),
      ]);
      if (absent(next)) {
        raw = value;
        break;
      }
      if (!Array.isArray(next) || !next.length) throw new KVReadError(key);
      head = pointer(next[0], key);
    }
    if (head.deleted) {
      heads.delete(key);
      // Said, so a caller can tell a key that was deleted from one never written.
      return { raw: null, revision: head.revision, deleted: true };
    }
    if (head.revision === INITIAL) return { raw: initial ?? null, revision: INITIAL };
    if (!absent(raw)) {
      remember(key, head);
      return { raw, revision: head.revision };
    }
    // A remembered head nothing confirms may be from another account or a
    // flushed store, not damage: the shortcut decides.
    if (remembered) {
      remembered = null;
      heads.delete(key);
      continue;
    }
    // Only a published successor justifies a missing immutable payload.
    if (absent(await puter.kv.get(linkKey(key, head.revision)))) throw new KVReadError(key);
  }
  throw new KVReadError(key);
}

/**
 * Publish only if expected is still the current revision. A rejected append
 * may have landed: leave its payload available for readback and rollback.
 */
export async function compareAndSetKV(key, expected, raw, { revision = crypto.randomUUID() } = {}) {
  if (typeof puter.kv.add !== 'function') {
    throw Object.assign(new Error('This Puter SDK does not support safe concurrent saves. Reload to update it.'), { refused: true });
  }
  if (!revisionId(revision)) throw new TypeError('Invalid publication revision');
  const deleted = absent(raw);
  const proposed = { [marker]: revision, ...(deleted ? { deleted: true } : {}) };
  const payload = valueKey(key, revision);
  if (!deleted) {
    try {
      await puter.kv.set(payload, raw);
    } catch (err) {
      /* Nothing has been appended, so this revision can never be published:
         a payload that landed with its acknowledgement lost is unreachable,
         and is removed rather than left behind. The failure is marked as one
         that never reached the append, so a caller holding storage of its
         own behind the payload (a value written across parts) can tell it
         from an append that may have been accepted. */
      await Promise.resolve().then(() => puter.kv.del?.(payload)).catch(() => {});
      if (err && typeof err === 'object') err.unsent = true;
      throw err;
    }
  }
  const candidates = decode(await puter.kv.add(linkKey(key, expected.revision), [proposed]));
  /* An append that does not resolve to the list cannot say who won, which
     is the same missing capability as no append at all - said as such,
     rather than as a read failure the forms report as a connection problem. */
  if (!Array.isArray(candidates)) {
    throw Object.assign(new Error('This Puter SDK does not support safe concurrent saves. Reload to update it.'), { refused: true });
  }
  if (!candidates.length) throw new KVReadError(key);
  const winner = pointer(candidates[0], key);
  if (winner.revision !== revision) {
    // The winner is a published head, so the next read can start from it.
    remember(key, winner);
    if (!deleted) await Promise.resolve().then(() => puter.kv.del?.(payload)).catch(() => {});
    throw new KVConflictError(key);
  }
  remember(key, { revision, deleted });
  // Neither a failed shortcut nor a failed cleanup invalidates the append,
  // and neither waits for the other.
  await Promise.allSettled([
    Promise.resolve().then(() => puter.kv.set(key, JSON.stringify(proposed))),
    expected.revision === INITIAL ? null
      : Promise.resolve().then(() => puter.kv.del?.(valueKey(key, expected.revision))),
  ]);
  return { raw: raw ?? null, revision };
}

export async function getKV(key) {
  return (await readKV(key)).raw;
}

/**
 * Keep a tombstone so a delayed writer cannot resurrect a deleted value, and
 * resolve to the value removed, for the caller to clean up what stood behind
 * it. A key holding nothing - never written, or already deleted - is left
 * alone, since there is nothing a delayed writer could bring back. A delete
 * that a write overtakes is retried against that write: it was asked to
 * remove whatever is there.
 */
export async function deleteKV(key) {
  for (let attempt = 0; ; attempt++) {
    const expected = await readKV(key);
    if (expected.raw === null) return null;
    try {
      await compareAndSetKV(key, expected, null);
      return expected.raw;
    } catch (err) {
      if (!(err instanceof KVConflictError) || attempt >= 3) throw err;
    }
  }
}
