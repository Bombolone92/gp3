// Lens Correction for File → Automate → Lens Correction: measures automatic
// settings per image when asked, then runs the ordinary operation off the
// main thread.
import { lensCorrection, type LensParams } from '../../imaging/filters/lens';
import { autoLensParams } from '../../imaging/filters/lens-auto';
import type { RGBA8 } from '../../imaging/types';

export type LensJob = {
  id: number;
  image: RGBA8;
  params: LensParams;
  auto?: { straighten: boolean; vignette: boolean; fill: boolean };
  background: [number, number, number];
};

self.onmessage = async (ev: MessageEvent<LensJob>) => {
  const { id, image, params, auto, background } = ev.data;
  try {
    const p = auto ? autoLensParams(image, params, auto) : params;
    const out = await lensCorrection.apply(image, p as Record<string, unknown> as never, { foreground: [0, 0, 0], background });
    (self as unknown as Worker).postMessage({ id, image: out, params: p }, [out.data.buffer]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
