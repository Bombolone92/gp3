import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SNAPSHOT_KEY, SNAPSHOT_ENABLED_KEY, MAX_SNAPSHOT_BYTES,
  serializeSnapshot, parseSnapshot, writeSnapshot, readSnapshot, clearSnapshot,
  offlineEnabled, setOfflineEnabled,
} from '../src/lib/snapshot.js';

/* A localStorage stand-in, with a switch for the two ways a real one fails:
   being unavailable at all, and being full. */
let full = false;
const memory = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => {
      if (full) throw new Error('QuotaExceededError');
      memory.set(k, String(v));
    },
    removeItem: (k) => { memory.delete(k); },
  },
};

const dataset = () => ({
  settings: { currency: 'USD', business: { name: 'Aurora' } },
  clients: [{ id: 'c1', name: 'Maya' }, null],
  items: [{ id: 'i1', name: 'Design', rate: 100 }],
  recurring: [{ id: 'r1' }],
  docs: { 2026: [{ id: 'd1', kind: 'invoice', number: 'INV-0001' }] },
});

beforeEach(() => {
  memory.clear();
  full = false;
});

describe('the snapshot payload', () => {
  it('round-trips a whole account', () => {
    const payload = serializeSnapshot(dataset(), { at: 1700000000000, user: 'demo' });
    const parsed = parseSnapshot(JSON.stringify(payload));
    expect(parsed.ok).toBe(true);
    expect(parsed.savedAt).toBe(1700000000000);
    expect(parsed.user).toBe('demo');
    expect(parsed.data.settings.currency).toBe('USD');
    expect(parsed.data.docs['2026']).toHaveLength(1);
    // Junk among the lists never comes back out of one.
    expect(parsed.data.clients).toHaveLength(1);
  });

  it('discards a payload from another version', () => {
    const payload = { ...serializeSnapshot(dataset()), version: 99 };
    expect(parseSnapshot(JSON.stringify(payload))).toEqual({ ok: false, error: 'version mismatch' });
  });

  it('discards anything that is not one of ours', () => {
    expect(parseSnapshot('nonsense').ok).toBe(false);
    expect(parseSnapshot('null').ok).toBe(false);
    expect(parseSnapshot(JSON.stringify({ app: 'other', kind: 'snapshot', version: 1 })).ok).toBe(false);
    expect(parseSnapshot(JSON.stringify({ app: 'invoicing', kind: 'backup', version: 1 })).ok).toBe(false);
  });

  it('discards one with no settings, or unreadable documents', () => {
    expect(parseSnapshot(JSON.stringify(serializeSnapshot({ docs: {} }))).ok).toBe(false);
    const bad = serializeSnapshot({ settings: {}, docs: { notayear: [] } });
    expect(parseSnapshot(JSON.stringify(bad)).ok).toBe(false);
    const worse = serializeSnapshot({ settings: {}, docs: { 2026: 'nope' } });
    expect(parseSnapshot(JSON.stringify(worse)).ok).toBe(false);
  });
});

describe('the copy on the device', () => {
  it('is off until it is switched on, and goes when it is switched off', () => {
    expect(offlineEnabled()).toBe(false);
    setOfflineEnabled(true);
    expect(offlineEnabled()).toBe(true);
    writeSnapshot(serializeSnapshot(dataset()));
    expect(memory.has(SNAPSHOT_KEY)).toBe(true);

    setOfflineEnabled(false);
    expect(offlineEnabled()).toBe(false);
    expect(memory.has(SNAPSHOT_KEY)).toBe(false);
    expect(memory.has(SNAPSHOT_ENABLED_KEY)).toBe(false);
  });

  it('reads back what it wrote, with its size', () => {
    const result = writeSnapshot(serializeSnapshot(dataset(), { user: 'demo' }));
    expect(result.ok).toBe(true);
    const snapshot = readSnapshot();
    expect(snapshot.user).toBe('demo');
    expect(snapshot.bytes).toBe(result.bytes);
    expect(snapshot.data.docs['2026'][0].number).toBe('INV-0001');
  });

  it('throws nothing away quietly: a corrupt payload is dropped, not returned', () => {
    memory.set(SNAPSHOT_KEY, '{ this is not json');
    expect(readSnapshot()).toBe(null);
    expect(memory.has(SNAPSHOT_KEY)).toBe(false);
  });

  it('refuses an account bigger than the browser will hold', () => {
    const huge = serializeSnapshot({ settings: { note: 'x'.repeat(MAX_SNAPSHOT_BYTES) }, docs: {} });
    expect(writeSnapshot(huge)).toEqual({ ok: false, error: 'too large' });
    expect(memory.has(SNAPSHOT_KEY)).toBe(false);
  });

  it('drops the old copy when the account has outgrown it, like a full browser', () => {
    writeSnapshot(serializeSnapshot(dataset()));
    expect(memory.has(SNAPSHOT_KEY)).toBe(true);
    const huge = serializeSnapshot({ settings: { note: 'x'.repeat(MAX_SNAPSHOT_BYTES) }, docs: {} });
    expect(writeSnapshot(huge).error).toBe('too large');
    expect(memory.has(SNAPSHOT_KEY)).toBe(false);
  });

  it('drops the old copy rather than keeping a stale one when storage is full', () => {
    writeSnapshot(serializeSnapshot(dataset()));
    full = true;
    expect(writeSnapshot(serializeSnapshot(dataset())).error).toBe('no room');
    expect(memory.has(SNAPSHOT_KEY)).toBe(false);
  });

  it('says nothing is there when there is nothing', () => {
    expect(readSnapshot()).toBe(null);
    clearSnapshot();
    expect(readSnapshot()).toBe(null);
  });
});
