/**
 * summarize(), on the main thread for small sets and in a Web Worker past
 * WORKER_THRESHOLD responses. Falls back to the main thread when workers are
 * unavailable or fail, so results always arrive.
 */
import { summarize } from './aggregate.js';

export const WORKER_THRESHOLD = 3000;

let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL('./aggregate.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.result);
    };
    // A reply that cannot be read (messageerror) carries no id either:
    // like a crash, every waiting summary falls back to the main thread.
    worker.onerror = worker.onmessageerror = () => {
      for (const p of pending.values()) p.reject(new Error('worker failed'));
      pending.clear();
      worker.terminate();
      worker = false;
    };
  } catch {
    worker = false;
  }
  return worker;
}

export async function summarizeAsync(survey, responses) {
  if (responses.length <= WORKER_THRESHOLD || typeof Worker === 'undefined') return summarize(survey, responses);
  const w = getWorker();
  if (!w) return summarize(survey, responses);
  const id = ++seq;
  try {
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ id, survey, responses });
    });
  } catch {
    return summarize(survey, responses);
  }
}
