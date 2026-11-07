// Structural cloning for undo snapshots. Plain objects/arrays are deep-copied;
// typed arrays are shared (they are immutable after commit — writers must
// replace them using `cow()` before mutating).
import type { DocumentData } from './types';

export function cloneShared<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return value; // shared, immutable
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = cloneShared(value[i]);
    return out as T;
  }
  const out: Record<string, unknown> = {};
  for (const k in value as Record<string, unknown>) out[k] = cloneShared((value as Record<string, unknown>)[k]);
  return out as T;
}

export function snapshotDocument(doc: DocumentData): DocumentData {
  return cloneShared(doc);
}

// Arrays created since the last undo push are private to the pending step and
// may be written in place; everything else is copied on first write.
let privateSet = new WeakSet<object>();

/** Called after each undo push: every array becomes shared/immutable again. */
export function sealArrays() {
  privateSet = new WeakSet();
}

/** Copy-on-write accessor: returns a writable typed array stored back on the owner. */
export function cow<T extends object, K extends keyof T>(owner: T, key: K): T[K] {
  const arr = owner[key] as unknown as ({ slice(): unknown } & object) | undefined;
  if (!arr || privateSet.has(arr)) return owner[key];
  const copy = arr.slice() as T[K];
  privateSet.add(copy as unknown as object);
  owner[key] = copy;
  return copy;
}

/** Mark a freshly allocated array as private (no copy needed on write). */
export function own<A extends object>(a: A): A {
  privateSet.add(a);
  return a;
}
