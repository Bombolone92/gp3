/**
 * Getting a puzzle, wherever it comes from.
 *
 * The worker is the fast path and the fallback is the same code running inline.
 * Both matter: a worker can fail to start (an unusual bundling setup, a
 * restrictive policy) and the game should not, but generating inline blocks
 * paint, so it is never the first choice.
 */

import { generate, generateDaily } from '../engine/generator.js';
import { fromText } from './serialize.js';

let worker = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map();

function ensureWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('../engine/generator.worker.js', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', (event) => {
      const { id } = event.data ?? {};
      const settle = pending.get(id);
      if (!settle) return; // a request that was abandoned
      pending.delete(id);
      settle(event.data);
    });
    worker.addEventListener('error', () => {
      // Fail the whole batch over to inline generation rather than leave
      // callers waiting on a worker that will not answer.
      workerBroken = true;
      for (const settle of pending.values()) settle(null);
      pending.clear();
      worker?.terminate();
      worker = null;
    });
  } catch {
    workerBroken = true;
  }
  return worker;
}

/** Generate inline. Blocks, and is only used when the worker is unavailable. */
function generateInline({ difficulty, seed, daily }) {
  const result = daily ? generateDaily(daily, difficulty) : generate({ difficulty, seed });
  return {
    puzzle: result.puzzle,
    solution: result.solution,
    difficulty: result.difficulty,
    givens: result.givens,
    seed: result.seed,
    onTarget: result.onTarget,
    grade: result.grade,
    daily: daily ?? null,
  };
}

/**
 * A puzzle at `difficulty`, or the daily puzzle for `daily`.
 *
 * @param {object} options
 * @param {string} options.difficulty
 * @param {number|string} [options.seed]
 * @param {string|null} [options.daily] ISO date; makes this the daily puzzle.
 * @param {number} [options.timeoutMs] How long to wait on the worker before
 *   giving up on it and generating inline.
 */
export async function requestPuzzle({ difficulty, seed, daily = null, timeoutMs = 15000 }) {
  const w = ensureWorker();
  if (!w) return generateInline({ difficulty, seed, daily });

  const id = nextId++;
  const reply = await new Promise((resolve) => {
    pending.set(id, resolve);
    const timer = setTimeout(() => {
      if (pending.delete(id)) resolve(null);
    }, timeoutMs);
    const settle = pending.get(id);
    pending.set(id, (data) => {
      clearTimeout(timer);
      settle?.(data);
    });
    w.postMessage({ id, difficulty, seed, daily });
  });

  if (!reply?.ok) return generateInline({ difficulty, seed, daily });
  return {
    puzzle: fromText(reply.puzzle),
    solution: fromText(reply.solution),
    difficulty: reply.difficulty,
    givens: reply.givens,
    seed: reply.seed,
    onTarget: reply.onTarget,
    grade: reply.grade,
    daily: daily ?? null,
  };
}

/** Drop the worker. Used by tests, and on teardown. */
export function disposeWorker() {
  worker?.terminate();
  worker = null;
  workerBroken = false;
  pending.clear();
}
