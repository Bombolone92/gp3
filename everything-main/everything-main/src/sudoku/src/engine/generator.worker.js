/**
 * Generation, off the main thread.
 *
 * An Expert puzzle costs a few hundred milliseconds of solid arithmetic on a
 * desktop and can run past a second on a phone. Spent on the main thread that
 * is a frozen tab: the spinner that is supposed to explain the wait cannot even
 * paint. So the work happens here and the UI stays live and cancellable.
 *
 * The protocol is one message each way, tagged with the request id so a reply
 * to a puzzle the player has already navigated away from can be ignored.
 * Boards cross as plain strings rather than typed arrays: cheap at 81
 * characters, and it keeps the message JSON-clean.
 */

import { generate, generateDaily } from './generator.js';
import { toText } from '../game/serialize.js';

self.addEventListener('message', (event) => {
  const { id, difficulty, seed, daily } = event.data ?? {};
  try {
    const result = daily ? generateDaily(daily, difficulty) : generate({ difficulty, seed });
    self.postMessage({
      id,
      ok: true,
      puzzle: toText(result.puzzle),
      solution: toText(result.solution),
      difficulty: result.difficulty,
      givens: result.givens,
      seed: result.seed,
      onTarget: result.onTarget,
      // Only the summary crosses; the step list is large and the UI recomputes
      // steps from the board when a hint is asked for.
      grade: { tier: result.grade.tier, score: result.grade.score, hardest: result.grade.hardest },
    });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message ?? error) });
  }
});
