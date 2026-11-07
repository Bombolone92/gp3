import { describe, it, expect } from 'vitest';
import { SUITS, RANKS, RANK_VAL, SUIT_COLOR, newDeck } from './deck.js';

describe('newDeck', () => {
  it('produces 52 cards with unique ids', () => {
    const deck = newDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(c => c.id)).size).toBe(52);
  });

  it('produces 13 cards of each suit and 4 of each rank', () => {
    const deck = newDeck();
    for (const s of SUITS) {
      expect(deck.filter(c => c.suit === s)).toHaveLength(13);
    }
    for (const r of RANKS) {
      expect(deck.filter(c => c.rank === r)).toHaveLength(4);
    }
  });

  it('deals every card face down', () => {
    expect(newDeck().every(c => c.faceUp === false)).toBe(true);
  });

  it('assigns red to hearts and diamonds, black to spades and clubs', () => {
    const deck = newDeck();
    for (const c of deck) {
      const expected = (c.suit === '♥' || c.suit === '♦') ? 'red' : 'black';
      expect(c.color).toBe(expected);
    }
  });

  it('sets id to suit plus rank', () => {
    for (const c of newDeck()) expect(c.id).toBe(c.suit + c.rank);
  });

  it('shuffles using the injected random source', () => {
    // Always returning 0 makes Fisher-Yates swap every position with index 0,
    // which is deterministic — so two runs must match exactly.
    const a = newDeck(() => 0).map(c => c.id);
    const b = newDeck(() => 0).map(c => c.id);
    expect(a).toEqual(b);
  });

  it('actually permutes, and preserves the multiset', () => {
    // Do not use a random that returns ~1.0 here: floor(0.999999 * (i+1)) === i,
    // so Fisher-Yates swaps every index with itself and the "shuffle" is a no-op.
    const ids = newDeck(() => 0).map(c => c.id);
    const buildOrder = SUITS.flatMap(s => RANKS.map(r => s + r));
    expect(ids).not.toEqual(buildOrder);
    expect([...ids].sort()).toEqual([...buildOrder].sort());
  });
});

describe('RANK_VAL', () => {
  it('maps ace to 1 and king to 13', () => {
    expect(RANK_VAL['A']).toBe(1);
    expect(RANK_VAL['K']).toBe(13);
    expect(RANK_VAL['10']).toBe(10);
  });
});

describe('SUIT_COLOR', () => {
  it('covers all four suits', () => {
    expect(Object.keys(SUIT_COLOR).sort()).toEqual([...SUITS].sort());
  });
});
