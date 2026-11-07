/**
 * The pixel effect records and their rendering. Importing this module
 * registers them (no UI), so exporters and tests can use it on its own.
 *
 *   gallery    { stack: [{ filter, hidden?, ...params }], seed }
 *              Effect Gallery filters applied in order
 *   svgFilter  { name, markup }   an SVG <filter>
 *
 * Both render in document space at the document's raster effects
 * resolution (core.js), reach past the object by what their filters need
 * (visual bounds) and read that far around each pixel (layer margins).
 */
import { registerEffectType } from '../paint/effects-model.js';
import { registerContentEffect } from '../../render/effects.js';
import { effectOutsets } from '../../model/geometry.js';
import { pixelEffect } from './core.js';
import { cleanLayer, runStack, stackGrow, stackReach, stackLabel, FILTER } from './catalog.js';
import { recordFilter, renderFilter, filterOutset } from './svg-filters.js';

const newSeed = () => 1 + Math.floor(Math.random() * 0x7ffffffe);
const visibleStack = (e) => (e.stack || []).filter((l) => !l.hidden && FILTER.has(l.filter));

registerEffectType('gallery', {
  label: 'Effect Gallery',
  command: 'effect.gallery',
  defaults: { stack: [], seed: 0 },
  ranges: { seed: [0, 0x7fffffff] },
  init: (p) => ({ ...p, seed: Number.isFinite(p.seed) && p.seed > 0 ? p.seed : newSeed() }),
  normalize(out) {
    out.stack = (Array.isArray(out.stack) ? out.stack : []).map(cleanLayer).filter(Boolean);
    out.seed = Math.round(out.seed);
    return out;
  },
  describe: (e) => stackLabel(e.stack),
});

registerEffectType('svgFilter', {
  label: 'SVG Filter',
  command: 'effect.svgFilter.apply',
  defaults: { name: '', markup: '' },
  normalize(out) {
    out.name = String(out.name || '').slice(0, 200);
    out.markup = String(out.markup || '');
    return out;
  },
  describe: (e) => (e.name ? `SVG Filter: ${e.name}` : 'SVG Filter'),
});

registerContentEffect(
  'gallery',
  pixelEffect({
    key: (e) => `g${e.seed}:${JSON.stringify(visibleStack(e))}`,
    costKey: (e) => visibleStack(e).map((l) => l.filter).join('+'),
    skip: (e) => !visibleStack(e).length,
    process: (img, e, ctx) => runStack(img, e.stack, ctx),
  }),
  { margin: (e) => stackReach(e.stack) },
);
effectOutsets.set('gallery', (e, b) => stackGrow(e.stack, b));

registerContentEffect(
  'svgFilter',
  pixelEffect({
    key: (e) => `f:${e.markup}`,
    costKey: (e) => `f:${e.markup.length}`,
    skip: (e) => !recordFilter(e),
    process: (img, e, ctx) => renderFilter(img, recordFilter(e), ctx),
  }),
  { margin: () => 24 },
);
effectOutsets.set('svgFilter', (e, b) => filterOutset(recordFilter(e), b));

export { newSeed };
