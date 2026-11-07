// Runs the warps' heavy work off the main thread: Context Scale's seam search
// (the removal order of one axis) and encoding warped images as PNG.
import { seamOrder, type SeamAxis } from '../../imaging/warp/seam-carve';
import type { RGBA8 } from '../../imaging/types';
import { rgbaPng } from '../color/encode';

export type WarpJob = { kind: 'seams'; image: RGBA8; axis: SeamAxis; maxSeams: number; protect?: Uint8Array } | { kind: 'png'; image: RGBA8 };
export type WarpReply = { progress?: number; order?: Uint16Array; png?: Uint8Array; error?: string };

const scope = self as unknown as { onmessage: ((ev: MessageEvent<WarpJob>) => void) | null; postMessage: (m: WarpReply, t?: Transferable[]) => void };
scope.onmessage = (ev) => {
  const job = ev.data;
  try {
    if (job.kind === 'png') {
      const png = rgbaPng(job.image);
      scope.postMessage({ png }, [png.buffer]);
      return;
    }
    let last = 0;
    const order = seamOrder(job.image, job.axis, job.maxSeams, job.protect, {
      report: (f) => {
        const now = performance.now();
        if (now - last < 100) return;
        last = now;
        scope.postMessage({ progress: f });
      },
    });
    scope.postMessage({ order }, [order.buffer]);
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
