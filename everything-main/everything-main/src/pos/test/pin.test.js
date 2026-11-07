import { describe, it, expect } from 'vitest';
import { validPin, makePinRecord, verifyPin, hashPin, needsRehash, lockDelayMs, PIN_GRACE_MS } from '../src/lib/pin.js';

describe('validPin', () => {
  it('accepts 4-6 digits and nothing else', () => {
    expect(validPin('1234')).toBe(true);
    expect(validPin('123456')).toBe(true);
    expect(validPin('123')).toBe(false);
    expect(validPin('1234567')).toBe(false);
    expect(validPin('12a4')).toBe(false);
    expect(validPin('')).toBe(false);
    expect(validPin(null)).toBe(false);
  });
});

describe('pin records', () => {
  // A small iteration count keeps the suite fast; the default is only
  // asserted, not paid for on every call.
  const FAST = 1000;

  it('stores a salted, stretched hash, never the code, and verifies it', async () => {
    const record = await makePinRecord('4321', FAST);
    expect(record.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(record.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.iterations).toBe(FAST);
    expect(JSON.stringify(record)).not.toContain('4321');

    expect(await verifyPin('4321', record)).toBe(true);
    expect(await verifyPin('1234', record)).toBe(false);
    expect(await verifyPin('4321', null)).toBe(false);
    expect(await verifyPin('4321', { salt: record.salt })).toBe(false);
  });

  it('stretches with the OWASP floor by default', async () => {
    const record = await makePinRecord('4321');
    expect(record.iterations).toBe(600_000);
    expect(await verifyPin('4321', record)).toBe(true);
  });

  it('the same code hashes differently under different salts', async () => {
    const a = await makePinRecord('4321', FAST);
    const b = await makePinRecord('4321', FAST);
    expect(a.hash).not.toBe(b.hash);
  });

  it('still verifies records from before the stretching', async () => {
    const salt = 'legacy-salt';
    const legacy = { salt, hash: await hashPin('4321', salt) };   // no iterations field
    expect(await verifyPin('4321', legacy)).toBe(true);
    expect(await verifyPin('1234', legacy)).toBe(false);
  });

  it('marks weaker-than-current records for a rewrite, never current ones', async () => {
    const salt = 'legacy-salt';
    expect(needsRehash({ salt, hash: await hashPin('4321', salt) })).toBe(true);
    expect(needsRehash({ salt, hash: 'x', iterations: 1000 })).toBe(true);
    expect(needsRehash({ salt, hash: 'x', iterations: 600_000 })).toBe(false);
  });
});

describe('lockDelayMs', () => {
  it('gives two free tries, then doubles from 5s to a minute cap', () => {
    expect(lockDelayMs(1)).toBe(0);
    expect(lockDelayMs(2)).toBe(0);
    expect(lockDelayMs(3)).toBe(5_000);
    expect(lockDelayMs(4)).toBe(10_000);
    expect(lockDelayMs(5)).toBe(20_000);
    expect(lockDelayMs(6)).toBe(40_000);
    expect(lockDelayMs(7)).toBe(60_000);
    expect(lockDelayMs(20)).toBe(60_000);
  });
});

describe('grace period', () => {
  it('is long enough to close a day without re-prompting', () => {
    expect(PIN_GRACE_MS).toBe(5 * 60 * 1000);
  });
});
