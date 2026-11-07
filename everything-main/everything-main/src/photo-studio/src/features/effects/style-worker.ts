/// <reference lib="webworker" />
import { compositeLayerStyle, renderLayerStyle } from '../../imaging/effects/render';
import type { LayerStyle } from '../../imaging/effects/types';
import { thumbnailSample } from './thumb-sample';
import { findPatternPreset } from '../../imaging/pattern/presets';
import type { Pattern } from '../../imaging/pattern/pattern';
import type { StyleJob } from '../../renderer/layer-style';

// Layer styles render here so blurs and distance transforms of large layers
// never block painting or the dialog's sliders.
const worker = self as unknown as DedicatedWorkerGlobalScope;
type Thumb = { style: LayerStyle; size: number; fillOpacity: number };
worker.onmessage = (event: MessageEvent<{ id: number; job?: StyleJob; thumb?: Thumb }>) => {
  const { id, thumb } = event.data;
  if (thumb) {
    // Style swatch: the style on a sample shape over a light backdrop.
    const { size } = thumb;
    const backdrop = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4).fill(236) };
    try {
      compositeLayerStyle(backdrop, thumbnailSample(size), { ...thumb.style, scale: (thumb.style.scale ?? 1) * Math.min(1, size / 96) }, { fillOpacity: thumb.fillOpacity, patterns: findPatternPreset });
    } catch {
      /* A broken style shows the plain backdrop. */
    }
    worker.postMessage({ id, result: backdrop }, [backdrop.data.buffer]);
    return;
  }
  const job = event.data.job!;
  try {
    const own = new Map<string, Pattern>(job.patterns.map((p) => [p.id, p]));
    const r = renderLayerStyle(job.input, job.style, {
      fillOpacity: job.fillOpacity,
      interiorAsGroup: job.interiorAsGroup,
      patterns: (pid) => own.get(pid) ?? findPatternPreset(pid),
      separatePasses: true,
      origin: job.origin,
      documentSize: job.documentSize,
    });
    // The combined below/above images are not needed by the compositor.
    const result = { bounds: r.bounds, layer: r.layer, below: null, above: null, passes: r.passes };
    const transfer = [r.layer.data.buffer, ...(r.passes ?? []).map((p) => p.image.data.buffer)] as ArrayBuffer[];
    worker.postMessage({ id, result }, [...new Set(transfer)]);
  } catch (error) {
    worker.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
