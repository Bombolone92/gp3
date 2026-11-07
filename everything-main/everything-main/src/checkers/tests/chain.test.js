import { describe, it, expect } from 'vitest';
import { Checkers } from '../src/engine/checkers.js';
import { continuations, nextHops } from '../src/game/chain.js';

describe('jump chains', () => {
  it('narrows to the sequences that match the hops taken', () => {
    const game = new Checkers('B:W15,23:B11');
    const all = game.moves({ square: 11 });
    expect(continuations(all, [11, 18])).toHaveLength(1);
    expect(continuations(all, [11, 19])).toHaveLength(0);
  });

  it('offers the next hop, not the far end', () => {
    const game = new Checkers('B:W15,23:B11');
    const hops = nextHops(continuations(game.moves({ square: 11 }), [11]), 1);
    expect([...hops.keys()]).toEqual([18]);
    expect(hops.get(18)).toBe(true);
  });

  // Forced capture guarantees this: if a sequence can continue, it must.
  it('never leaves a sequence both complete and extendable', () => {
    const game = new Checkers('B:W15,23:B11');
    for (const move of game.moves()) {
      for (let n = 2; n < move.path.length; n++) {
        const prefix = move.path.slice(0, n);
        const matches = continuations(game.moves({ square: prefix[0] }), prefix);
        const complete = matches.filter((m) => m.path.length === prefix.length);
        const longer = matches.filter((m) => m.path.length > prefix.length);
        expect(complete.length === 0 || longer.length === 0).toBe(true);
      }
    }
  });
});
