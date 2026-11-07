import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isSignedIn, pullStats, pushStats, pullSave, pushSave, clearSave,
} from './puter-sync.js';

// The save/stats arbitration in main.js depends on this module's contract
// exactly: a failed cloud read must be distinguishable from a key that has
// never been written, or a transient failure gets treated as "empty" and a
// worse local value silently overwrites a better remote one. This module is
// trivially fakeable by assigning a fake `puter` onto globalThis — vitest
// runs in the node environment, and puter-sync.js only ever references the
// bare global `puter`, so a plain `globalThis.puter = {...}` is enough.
const ORIGINAL_PUTER = globalThis.puter;

afterEach(() => {
  if (ORIGINAL_PUTER === undefined) delete globalThis.puter;
  else globalThis.puter = ORIGINAL_PUTER;
});

function installFakePuter({ signedIn = true, kvGet, kvSet, maxValueSize = 100000 } = {}) {
  globalThis.puter = {
    auth: {
      isSignedIn: async () => {
        if (typeof signedIn === 'function') return signedIn();
        return signedIn;
      },
    },
    kv: {
      MAX_VALUE_SIZE: maxValueSize,
      get: kvGet || (async () => null),
      set: kvSet || (async () => {}),
      del: async () => {},
    },
  };
}

describe('isSignedIn', () => {
  it('returns false rather than throwing when puter is undefined entirely', async () => {
    delete globalThis.puter;
    await expect(isSignedIn()).resolves.toBe(false);
  });

  it('returns false rather than throwing when the underlying call rejects', async () => {
    installFakePuter({ signedIn: () => { throw new Error('boom'); } });
    await expect(isSignedIn()).resolves.toBe(false);
  });

  it('returns true when the underlying call resolves true', async () => {
    installFakePuter({ signedIn: true });
    await expect(isSignedIn()).resolves.toBe(true);
  });

  it('returns false when the underlying call resolves false', async () => {
    installFakePuter({ signedIn: false });
    await expect(isSignedIn()).resolves.toBe(false);
  });
});

describe('pullStats / pullSave (read contract)', () => {
  it('yields { ok: false } on a read failure', async () => {
    installFakePuter({ signedIn: true, kvGet: async () => { throw new Error('network'); } });
    const result = await pullStats();
    expect(result.ok).toBe(false);
  });

  it('yields { ok: true, value: null } for a key that has never been written — '
    + 'this is the distinction the original bug conflated', async () => {
    installFakePuter({ signedIn: true, kvGet: async () => null });
    const result = await pullSave();
    expect(result).toEqual({ ok: true, value: null });
  });

  it('yields { ok: false } when not signed in, not { ok: true, value: null } — '
    + 'signed-out is "unknown", not "empty"', async () => {
    installFakePuter({ signedIn: false });
    const result = await pullStats();
    expect(result.ok).toBe(false);
  });

  it('parses and returns a stored value', async () => {
    installFakePuter({ signedIn: true, kvGet: async () => JSON.stringify({ played: 3 }) });
    const result = await pullStats();
    expect(result).toEqual({ ok: true, value: { played: 3 } });
  });

  it('nothing throws when puter is undefined entirely', async () => {
    delete globalThis.puter;
    await expect(pullStats()).resolves.toEqual({ ok: false, value: null });
    await expect(pullSave()).resolves.toEqual({ ok: false, value: null });
  });
});

describe('kvSet contract (pushStats / pushSave)', () => {
  it('refuses (returns false) when not signed in', async () => {
    installFakePuter({ signedIn: false });
    await expect(pushStats({ played: 1 })).resolves.toBe(false);
  });

  it('refuses (returns false) when the payload exceeds MAX_VALUE_SIZE', async () => {
    installFakePuter({ signedIn: true, maxValueSize: 4 });
    await expect(pushSave({ big: 'this is well over four bytes' })).resolves.toBe(false);
  });

  it('succeeds and writes the JSON payload when signed in and within the size limit', async () => {
    let written = null;
    installFakePuter({
      signedIn: true,
      maxValueSize: 1000,
      kvSet: async (key, value) => { written = { key, value }; },
    });
    await expect(pushStats({ played: 1 })).resolves.toBe(true);
    expect(written).toEqual({ key: 'stats', value: JSON.stringify({ played: 1 }) });
  });

  it('returns false rather than throwing when the underlying set call rejects', async () => {
    installFakePuter({ signedIn: true, kvSet: async () => { throw new Error('boom'); } });
    await expect(pushSave({ v: 1 })).resolves.toBe(false);
  });

  it('nothing throws when puter is undefined entirely', async () => {
    delete globalThis.puter;
    await expect(pushStats({})).resolves.toBe(false);
    await expect(pushSave({})).resolves.toBe(false);
  });
});

describe('clearSave', () => {
  it('nothing throws when puter is undefined entirely', async () => {
    delete globalThis.puter;
    await expect(clearSave()).resolves.toBeUndefined();
  });

  it('nothing throws when not signed in', async () => {
    installFakePuter({ signedIn: false });
    await expect(clearSave()).resolves.toBeUndefined();
  });

  it('nothing throws when the underlying del call rejects', async () => {
    globalThis.puter = {
      auth: { isSignedIn: async () => true },
      kv: { del: async () => { throw new Error('boom'); }, MAX_VALUE_SIZE: 100000, get: async () => null, set: async () => {} },
    };
    await expect(clearSave()).resolves.toBeUndefined();
  });
});
