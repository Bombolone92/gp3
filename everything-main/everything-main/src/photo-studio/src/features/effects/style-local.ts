// Layer effects rendered on the main thread, used only when the style
// worker is unavailable.
import { compositeLayerStyle, renderLayerStyle, type LayerStyleResult } from '../../imaging/effects/render';
import type { LayerStyle } from '../../imaging/effects/types';
import type { RGBA8 } from '../../imaging/types';
import { findPatternPreset } from '../../imaging/pattern/presets';
import type { Pattern } from '../../imaging/pattern/pattern';
import type { StyleJob } from '../../renderer/layer-style';
import { thumbnailSample } from './thumb-sample';

export function renderThumbLocally(style: LayerStyle, size: number, fillOpacity: number): RGBA8 {
  const backdrop = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4).fill(236) };
  compositeLayerStyle(backdrop, thumbnailSample(size), { ...style, scale: (style.scale ?? 1) * Math.min(1, size / 96) }, { fillOpacity, patterns: findPatternPreset });
  return backdrop;
}
export function renderLocally(job: StyleJob): LayerStyleResult {
  const own = new Map<string, Pattern>(job.patterns.map((p) => [p.id, p]));
  return renderLayerStyle(job.input, job.style, {
    fillOpacity: job.fillOpacity,
    interiorAsGroup: job.interiorAsGroup,
    patterns: (pid) => own.get(pid) ?? findPatternPreset(pid),
    separatePasses: true,
    origin: job.origin,
    documentSize: job.documentSize,
  });
}
