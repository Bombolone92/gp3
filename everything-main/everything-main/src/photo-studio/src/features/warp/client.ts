// Main-thread side of the warp worker: one worker per job, so a job is
// cancelled by terminating it. Runs inline where module workers are missing.
import { seamOrder, type SeamAxis } from '../../imaging/warp/seam-carve';
import type { RGBA8 } from '../../imaging/types';
import { rgbaPng } from '../color/encode';
import type { WarpJob, WarpReply } from './worker';

type Job<T> = { promise: Promise<T>; cancel: () => void };
function run<T>(job: WarpJob, pick: (r: WarpReply) => T | undefined, inline: () => T, progress?: (f: number) => void): Job<T> {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'warp' });
  } catch {
    return { promise: Promise.resolve().then(inline), cancel: () => {} };
  }
  let reject: (e: Error) => void = () => {};
  const promise = new Promise<T>((resolve, rej) => {
    reject = rej;
    worker.onmessage = (ev: MessageEvent<WarpReply>) => {
      const r = ev.data;
      if (r.progress !== undefined) return progress?.(r.progress);
      worker.terminate();
      const value = pick(r);
      if (value !== undefined) resolve(value);
      else rej(new Error(r.error ?? 'The warp worker failed.'));
    };
    worker.onerror = (ev) => {
      ev.preventDefault();
      worker.terminate();
      rej(new Error('The warp worker stopped.'));
    };
    // Copy so the caller keeps its pixels; the copy is transferred.
    const copy: RGBA8 = { width: job.image.width, height: job.image.height, data: new Uint8ClampedArray(job.image.data) };
    worker.postMessage({ ...job, image: copy }, [copy.data.buffer]);
  });
  return {
    promise,
    cancel: () => {
      worker.terminate();
      reject(new Error('cancelled'));
    },
  };
}

/** Seam removal order of one axis (Context Scale). */
export function seamOrderJob(image: RGBA8, axis: SeamAxis, maxSeams: number, protect?: Uint8Array, progress?: (f: number) => void) {
  return run({ kind: 'seams', image, axis, maxSeams, protect }, (r) => r.order, () => seamOrder(image, axis, maxSeams, protect), progress);
}
/** PNG file of an image (straight alpha kept exactly). */
export function pngJob(image: RGBA8) {
  return run({ kind: 'png', image }, (r) => r.png, () => rgbaPng(image));
}
