import { describe, it, expect } from 'vitest';
import { canPlaceOnTableau, canPlaceOnFoundation, isWon } from './rules.js';
import { SUIT_COLOR } from './deck.js';

const card = (suit, rank, faceUp = true) => ({
  suit, rank, color: SUIT_COLOR[suit], faceUp, id: suit + rank,
});

describe('canPlaceOnTableau', () => {
  it('allows only a King onto an empty column', () => {
    expect(canPlaceOnTableau(card('♠', 'K'), [])).toBe(true);
    expect(canPlaceOnTableau(card('♥', 'K'), [])).toBe(true);
    expect(canPlaceOnTableau(card('♠', 'Q'), [])).toBe(false);
    expect(canPlaceOnTableau(card('♠', 'A'), [])).toBe(false);
  });

  it('allows descending rank with alternating colour', () => {
    expect(canPlaceOnTableau(card('♥', 'Q'), [card('♠', 'K')])).toBe(true);
    expect(canPlaceOnTableau(card('♦', 'Q'), [card('♣', 'K')])).toBe(true);
  });

  it('rejects same colour', () => {
    expect(canPlaceOnTableau(card('♠', 'Q'), [card('♣', 'K')])).toBe(false);
    expect(canPlaceOnTableau(card('♥', 'Q'), [card('♦', 'K')])).toBe(false);
  });

  it('rejects a rank that is not exactly one below', () => {
    expect(canPlaceOnTableau(card('♥', 'J'), [card('♠', 'K')])).toBe(false);
    expect(canPlaceOnTableau(card('♥', 'K'), [card('♠', 'Q')])).toBe(false);
  });

  it('rejects a face-down top card', () => {
    expect(canPlaceOnTableau(card('♥', 'Q'), [card('♠', 'K', false)])).toBe(false);
  });

  it('only considers the top card of the target', () => {
    const pile = [card('♠', '5'), card('♦', '3'), card('♠', 'K')];
    expect(canPlaceOnTableau(card('♥', 'Q'), pile)).toBe(true);
  });
});

describe('canPlaceOnFoundation', () => {
  it('allows only an Ace onto an empty foundation', () => {
    expect(canPlaceOnFoundation(card('♠', 'A'), [])).toBe(true);
    expect(canPlaceOnFoundation(card('♠', '2'), [])).toBe(false);
    expect(canPlaceOnFoundation(card('♠', 'K'), [])).toBe(false);
  });

  it('allows ascending rank of the same suit', () => {
    expect(canPlaceOnFoundation(card('♠', '2'), [card('♠', 'A')])).toBe(true);
    expect(canPlaceOnFoundation(card('♥', 'K'), [card('♥', 'Q')])).toBe(true);
  });

  it('rejects a different suit', () => {
    expect(canPlaceOnFoundation(card('♥', '2'), [card('♠', 'A')])).toBe(false);
  });

  it('rejects a non-consecutive rank', () => {
    expect(canPlaceOnFoundation(card('♠', '3'), [card('♠', 'A')])).toBe(false);
    expect(canPlaceOnFoundation(card('♠', 'A'), [card('♠', '2')])).toBe(false);
  });
});

describe('isWon', () => {
  const full = () => Array.from({ length: 13 }, (_, i) => card('♠', String(i)));

  it('is true when all four foundations hold 13 cards', () => {
    expect(isWon({ foundations: [full(), full(), full(), full()] })).toBe(true);
  });

  it('is false when any foundation is short', () => {
    expect(isWon({ foundations: [full(), full(), full(), full().slice(1)] })).toBe(false);
    expect(isWon({ foundations: [[], [], [], []] })).toBe(false);
  });
});
