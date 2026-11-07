import { afterEach, describe, expect, it, vi } from 'vitest';
import { CELLS } from '../src/engine/grid.js';
import { hasUniqueSolution } from '../src/engine/solver.js';
import { gradePuzzle } from '../src/engine/techniques.js';
import { toText } from '../src/game/serialize.js';
import { disposeWorker, requestPuzzle } from '../src/game/puzzles.js';

afterEach(() => {
  disposeWorker();
  vi.unstubAllGlobals();
});

/**
 * A Worker stand-in. `behaviour` decides what happens to a posted message, so
 * the same double covers the happy path, a worker that fails, and one that
 * never answers.
 */
function stubWorker(behaviour) {
  const instances = [];
  class FakeWorker {
    constructor() {
      this.listeners = { message: [], error: [] };
      instances.push(this);
    }
    addEventListener(type, fn) {
      this.listeners[type]?.push(fn);
    }
    postMessage(data) {
      behaviour(data, this);
    }
    terminate() {}
    emit(type, event) {
      for (const fn of this.listeners[type]) fn(event);
    }
  }
  vi.stubGlobal('Worker', FakeWorker);
  return instances;
}

describe('without a worker', () => {
  it('generates inline rather than failing', async () => {
    // No Worker global at all, which is the situation in Node and in any
    // browser context where workers are blocked.
    const result = await requestPuzzle({ difficulty: 'easy' });
    expect(result.puzzle).toHaveLength(CELLS);
    expect(result.difficulty).toBe('easy');
    expect(hasUniqueSolution(result.puzzle)).toBe(true);
    expect(gradePuzzle(result.puzzle).solved).toBe(true);
  });

  it('honours the seed, so the same request gives the same puzzle', async () => {
    const a = await requestPuzzle({ difficulty: 'medium', seed: 'inline' });
    const b = await requestPuzzle({ difficulty: 'medium', seed: 'inline' });
    expect(toText(a.puzzle)).toBe(toText(b.puzzle));
  });

  it('builds the daily puzzle for a date', async () => {
    const result = await requestPuzzle({ difficulty: 'medium', daily: '2026-08-21' });
    expect(result.daily).toBe('2026-08-21');
    const again = await requestPuzzle({ difficulty: 'medium', daily: '2026-08-21' });
    expect(toText(result.puzzle)).toBe(toText(again.puzzle));
  });
});

describe('with a working worker', () => {
  it('uses the worker’s answer', async () => {
    const puzzleText = '5'.padEnd(CELLS, '.');
    const solutionText = '5'.repeat(CELLS);
    stubWorker((data, worker) => {
      worker.emit('message', {
        data: {
          id: data.id,
          ok: true,
          puzzle: puzzleText,
          solution: solutionText,
          difficulty: data.difficulty,
          givens: 1,
          seed: 'from-worker',
          onTarget: true,
          grade: { tier: 2, score: 100, hardest: 'pointing' },
        },
      });
    });

    const result = await requestPuzzle({ difficulty: 'hard' });
    expect(result.seed).toBe('from-worker');
    expect(result.givens).toBe(1);
    expect(toText(result.puzzle)).toBe(puzzleText);
    expect(result.grade.hardest).toBe('pointing');
  });

  it('ignores a reply to a request that is no longer wanted', async () => {
    // A player who presses New puzzle twice must not get the first board.
    const seen = [];
    stubWorker((data, worker) => {
      seen.push(data.id);
      worker.emit('message', { data: { id: 999, ok: true } }); // an id nobody awaits
      worker.emit('message', {
        data: {
          id: data.id,
          ok: true,
          puzzle: '.'.repeat(CELLS),
          solution: '1'.repeat(CELLS),
          difficulty: data.difficulty,
          givens: 0,
          seed: 1,
          onTarget: true,
          grade: {},
        },
      });
    });

    const result = await requestPuzzle({ difficulty: 'easy' });
    expect(result.givens).toBe(0);
    expect(seen).toHaveLength(1);
  });
});

describe('when the worker lets us down', () => {
  it('falls back to inline generation on an error reply', async () => {
    stubWorker((data, worker) => {
      worker.emit('message', { data: { id: data.id, ok: false, error: 'boom' } });
    });
    const result = await requestPuzzle({ difficulty: 'easy' });
    expect(hasUniqueSolution(result.puzzle)).toBe(true);
  });

  it('falls back when the worker never answers', async () => {
    stubWorker(() => {}); // silence
    const result = await requestPuzzle({ difficulty: 'easy', timeoutMs: 20 });
    expect(hasUniqueSolution(result.puzzle)).toBe(true);
    expect(gradePuzzle(result.puzzle).solved).toBe(true);
  });

  it('falls back when the worker cannot even be constructed', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('blocked by policy');
        }
      },
    );
    const result = await requestPuzzle({ difficulty: 'easy' });
    expect(hasUniqueSolution(result.puzzle)).toBe(true);
  });

  it('stops trying the worker once it has broken', async () => {
    let constructed = 0;
    const instances = stubWorker((data, worker) => {
      worker.emit('error', new Error('crashed'));
    });
    await requestPuzzle({ difficulty: 'easy' });
    constructed = instances.length;
    await requestPuzzle({ difficulty: 'easy' });
    // The second request goes straight to inline generation rather than
    // building another worker that will crash the same way.
    expect(instances.length).toBe(constructed);
  });
});
