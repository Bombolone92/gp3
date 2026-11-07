/**
 * Character spacing ("expanded" and "condensed" text): extra space
 * between letters in points, positive or negative. The Document API takes
 * the value in points; the page painter renders it as a CSS letter-spacing
 * in pixels, which is how the current value is read back.
 */

import { inspectSelection } from './commands.js';

const PX_PER_PT = 96 / 72;
export const SPACING_MIN_PT = -20;
export const SPACING_MAX_PT = 50;

/** Quick choices for the dialog, in points. */
export const SPACING_PRESETS = [
  { id: 'tight', label: 'Tight', pt: -0.5 },
  { id: 'normal', label: 'Normal', pt: 0 },
  { id: 'loose', label: 'Loose', pt: 1 },
  { id: 'wide', label: 'Wide', pt: 3 },
];

/** A typed spacing in points (comma or dot decimals) within range, or null. */
export function parseSpacingPt(value) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < SPACING_MIN_PT || n > SPACING_MAX_PT) return null;
  return Math.round(n * 100) / 100;
}

/** A painted `letter-spacing` value ("2.6667px", "normal") -> points, 0 for none. */
export function letterSpacingPt(css) {
  const v = String(css || '').trim();
  if (!v || v === 'normal') return 0;
  const px = Number.parseFloat(v);
  if (!Number.isFinite(px)) return 0;
  return Math.round((px / PX_PER_PT) * 100) / 100;
}

/** The spacing of the run at the start of the selection, 0 when plain, null when it cannot be read. */
export function spacingAtSelection(ui, host) {
  const found = inspectSelection(ui, host, (el) => { const pt = letterSpacingPt(el.style?.letterSpacing); return pt ? pt : null; });
  if (found === undefined) return null;
  return found || 0;
}

/** Apply spacing (points) to a selection target; 0 clears the property. */
export async function applyLetterSpacing(api, target, pt) {
  if (!target) throw new Error('Select some text first');
  const r = await api.format.apply({ target, inline: { letterSpacing: pt ? pt : null } });
  if (r == null || (r.success === false && r.failure?.code !== 'NO_OP')) throw new Error(r?.failure?.message || 'Spacing was not applied');
  return r;
}
