import { describe, it, expect } from 'vitest';
import {
  canDeriveFairly,
  deriveDice,
  diceFromBytes,
  hashNonce,
  isNonce,
  randomNonce,
  rollDice,
} from '../src/engine/dice.js';

describe('turning bytes into dice', () => {
  it('reads two dice off the front of the stream', () => {
    expect(diceFromBytes(Uint8Array.from([0, 5, 9, 9]))).toEqual([1, 6]);
  });

  it('skips the values that would bias the result', () => {
    // 252-255 are the four values that make 256 not a multiple of 6. Taking
    // them modulo 6 would make 1-4 fractionally likelier than 5 and 6.
    expect(diceFromBytes(Uint8Array.from([252, 255, 3, 10]))).toEqual([4, 5]);
  });

  it('is uniform over the six faces', () => {
    const counts = new Array(7).fill(0);
    for (let byte = 0; byte < 252; byte++) counts[(byte % 6) + 1] += 1;
    expect(counts.slice(1)).toEqual([42, 42, 42, 42, 42, 42]);
  });
});

describe('rolling locally', () => {
  it('produces two dice in range', () => {
    for (let i = 0; i < 200; i++) {
      const [a, b] = rollDice();
      expect(a).toBeGreaterThanOrEqual(1);
      expect(a).toBeLessThanOrEqual(6);
      expect(b).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(6);
    }
  });

  it('takes an injected generator', () => {
    expect(rollDice(() => 0)).toEqual([1, 1]);
    expect(rollDice(() => 0.999)).toEqual([6, 6]);
  });

  it('lands on every face over a long run', () => {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) for (const d of rollDice()) seen.add(d);
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('nonces', () => {
  it('are 32 hex characters', () => {
    const nonce = randomNonce();
    expect(isNonce(nonce)).toBe(true);
    expect(nonce).toHaveLength(32);
  });

  it('are not repeated', () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(randomNonce());
    expect(seen.size).toBe(500);
  });

  it('reject anything that is not one', () => {
    expect(isNonce('')).toBe(false);
    expect(isNonce('XYZ')).toBe(false);
    expect(isNonce('a'.repeat(31))).toBe(false);
    expect(isNonce('A'.repeat(32))).toBe(false); // upper case is not our format
    expect(isNonce(null)).toBe(false);
    expect(isNonce(12345)).toBe(false);
  });
});

describe('deriving a roll fairly', () => {
  it('is available wherever WebCrypto is', () => {
    expect(canDeriveFairly()).toBe(true);
  });

  it('binds a nonce to its hash', async () => {
    const nonce = randomNonce();
    const hash = await hashNonce(nonce);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashNonce(nonce)).toBe(hash);
    expect(await hashNonce(randomNonce())).not.toBe(hash);
  });

  it('gives both peers the same two dice', async () => {
    const a = randomNonce();
    const b = randomNonce();
    expect(await deriveDice(a, b)).toEqual(await deriveDice(a, b));
  });

  it('depends on both contributions, in a fixed order', async () => {
    const a = 'a'.repeat(32);
    const b = 'b'.repeat(32);
    const dice = await deriveDice(a, b);
    expect(dice).not.toEqual(await deriveDice(a, 'c'.repeat(32)));
    // The roller's nonce comes first, always — the two peers cannot end up
    // hashing the same pair in opposite orders and disagreeing about the roll.
    expect(await deriveDice(b, a)).not.toEqual(dice);
  });

  it('covers the whole range of rolls', async () => {
    const seen = new Set();
    for (let i = 0; i < 400; i++) {
      const dice = await deriveDice(randomNonce(), randomNonce());
      seen.add(dice.join(''));
    }
    // 36 ordered outcomes; 400 draws makes missing any of them vanishingly
    // unlikely, and a derivation stuck on a few values would fail here.
    expect(seen.size).toBe(36);
  });
});
