// Main-thread side of the stack worker; computes inline if workers fail.
import { stackLayers } from '../../imaging/stack';
import type { StackMode } from '../../model/embedded';
import type { StackReply } from './stack-worker';

let worker: Worker | undefined;
let failed = false;
let next = 1;
const waiting = new Map<number, { resolve: (d: Uint8ClampedArray) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (worker || failed) return worker;
  try {
    worker = new Worker(new URL('./stack-worker.ts', import.meta.url), { type: 'module', name: 'stack' });
    worker.onmessage = (ev: MessageEvent<StackReply>) => {
      const w = waiting.get(ev.data.id);
      if (!w) return;
      waiting.delete(ev.data.id);
      if (ev.data.data) w.resolve(ev.data.data);
      else w.reject(new Error(ev.data.error ?? 'The stack could not be computed.'));
    };
    worker.onerror = (ev) => {
      ev.preventDefault();
      failed = true;
      worker?.terminate();
      worker = undefined;
      for (const w of waiting.values()) w.reject(new Error('The stack worker stopped.'));
      waiting.clear();
    };
  } catch {
    failed = true;
  }
  return worker;
}

/** Per-pixel statistic of same-size RGBA8 layers (the buffers are transferred). */
export function computeStack(layers: Uint8ClampedArray[], pixels: number, mode: StackMode): Promise<Uint8ClampedArray> {
  const w = getWorker();
  if (!w) return Promise.resolve(stackLayers(layers, pixels, mode));
  const id = next++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    w.postMessage({ id, layers, pixels, mode }, layers.map((l) => l.buffer as ArrayBuffer));
  });
}
