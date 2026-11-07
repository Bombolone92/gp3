import type { LayerStyleResult } from '../../imaging/effects/render';
import type { LayerStyle } from '../../imaging/effects/types';
import type { RGBA8 } from '../../imaging/types';
import type { StyleJob, StyleRenderFn } from '../../renderer/layer-style';

// Rendering on the main thread (no worker) loads the effect renderer on demand.
const local = () => import('./style-local');

/** A style renderer backed by a dedicated worker, falling back to the main
 * thread if workers are unavailable. */
export type ThumbRenderFn = (style: LayerStyle, size: number, fillOpacity: number) => Promise<RGBA8>;
export let renderThumb: ThumbRenderFn = async (style, size, fillOpacity) => (await local()).renderThumbLocally(style, size, fillOpacity);
export function workerStyleRenderer(): StyleRenderFn {
  let worker: Worker | undefined;
  try {
    worker = new Worker(new URL('./style-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = undefined;
  }
  let sequence = 0;
  const pending = new Map<number, { resolve: (r: never) => void; reject: (e: Error) => void }>();
  if (worker) {
    worker.onmessage = (e: MessageEvent<{ id: number; result?: never; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.result!);
    };
    renderThumb = (style, size, fillOpacity) => {
      if (!worker) return Promise.reject(new Error('The layer style worker failed.'));
      return new Promise<RGBA8>((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve: resolve as (r: never) => void, reject });
        worker!.postMessage({ id, thumb: { style, size, fillOpacity } });
      });
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('The layer style worker failed.'));
      pending.clear();
      worker = undefined;
    };
  }
  return (job: StyleJob) => {
    if (!worker) return renderLocally(job);
    return new Promise<LayerStyleResult>((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve: resolve as (r: never) => void, reject });
      worker!.postMessage({ id, job }, [job.input.data.buffer as ArrayBuffer]);
    });
  };
}
export async function renderLocally(job: StyleJob): Promise<LayerStyleResult> {
  return (await local()).renderLocally(job);
}
