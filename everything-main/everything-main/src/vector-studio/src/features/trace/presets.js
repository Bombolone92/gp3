/**
 * Trace options, their ranges and the built-in presets.
 *
 * Options (all JSON-safe, stored on trace objects):
 *   mode         'color' | 'gray' | 'bw'
 *   palette      'auto' | 'limited' | 'fullTone' | 'swatches'   (color mode)
 *   colors       2..30 colors (color mode; the most colors for 'auto')
 *   grays        2..32 gray levels (gray mode)
 *   threshold    1..255: pixels darker than this become black (bw mode)
 *   paths        0..100: how closely paths follow the pixels
 *   corners      0..100: how readily sharp turns become corners
 *   noise        1..250: areas smaller than this many pixels are absorbed
 *   method       'abutting' (shapes meet edge to edge) | 'overlapping'
 *                (shapes are stacked: enclosed areas are filled underneath)
 *   fills        create filled shapes
 *   strokes      create centerline strokes for thin areas
 *   strokeWidth  1..100: areas up to this thick (pixels) become strokes
 *   snapLines    straighten nearly straight curves
 *   ignoreWhite  leave white areas out
 *   detail       1..3: working resolution (1 fast, 3 finest)
 */

export const DEFAULT_OPTIONS = Object.freeze({
  mode: 'color',
  palette: 'auto',
  colors: 12,
  grays: 8,
  threshold: 128,
  paths: 70,
  corners: 70,
  noise: 16,
  method: 'abutting',
  fills: true,
  strokes: false,
  strokeWidth: 8,
  snapLines: false,
  ignoreWhite: false,
  detail: 2,
});

const RANGES = {
  colors: [2, 30],
  grays: [2, 32],
  threshold: [1, 255],
  paths: [0, 100],
  corners: [0, 100],
  noise: [1, 250],
  strokeWidth: [1, 100],
  detail: [1, 3],
};

const CHOICES = {
  mode: ['color', 'gray', 'bw'],
  palette: ['auto', 'limited', 'fullTone', 'swatches'],
  method: ['abutting', 'overlapping'],
};

/** Complete, clamped options from a partial object. */
export function normalizeOptions(o = {}) {
  const out = { ...DEFAULT_OPTIONS };
  for (const k of Object.keys(DEFAULT_OPTIONS)) {
    const v = o[k];
    if (v === undefined || v === null) continue;
    if (RANGES[k]) {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      const [lo, hi] = RANGES[k];
      out[k] = Math.max(lo, Math.min(hi, k === 'strokeWidth' ? Math.round(n * 10) / 10 : Math.round(n)));
    } else if (CHOICES[k]) {
      if (CHOICES[k].includes(v)) out[k] = v;
    } else out[k] = Boolean(v);
  }
  // Nothing to draw is never useful: fall back to fills.
  if (!out.fills && !out.strokes) out.fills = true;
  return out;
}

export const OPTION_RANGES = RANGES;

/**
 * Built-in presets. `quick` ones appear as buttons at the top of the
 * Trace Image panel. Values are original to this app.
 */
export const PRESETS = [
  { id: 'auto-color', label: 'Auto Color', quick: true, icon: 'trace-auto', options: { mode: 'color', palette: 'auto', colors: 12, paths: 70, corners: 70, noise: 16 } },
  { id: 'photo-high', label: 'High-Detail Photo', quick: true, icon: 'trace-photo-high', options: { mode: 'color', palette: 'fullTone', colors: 26, paths: 88, corners: 80, noise: 4, method: 'overlapping', detail: 3 } },
  { id: 'photo-low', label: 'Low-Detail Photo', quick: true, icon: 'trace-photo-low', options: { mode: 'color', palette: 'fullTone', colors: 10, paths: 55, corners: 60, noise: 36, method: 'overlapping', detail: 2 } },
  { id: 'colors-3', label: '3 Colors', options: { mode: 'color', palette: 'limited', colors: 3, paths: 65, corners: 70, noise: 24 } },
  { id: 'colors-6', label: '6 Colors', options: { mode: 'color', palette: 'limited', colors: 6, paths: 70, corners: 70, noise: 20 } },
  { id: 'colors-16', label: '16 Colors', options: { mode: 'color', palette: 'limited', colors: 16, paths: 76, corners: 75, noise: 12 } },
  { id: 'grays', label: 'Shades of Gray', quick: true, icon: 'trace-grays', options: { mode: 'gray', grays: 8, paths: 74, corners: 70, noise: 12 } },
  { id: 'bw', label: 'Black and White', quick: true, icon: 'trace-bw', options: { mode: 'bw', threshold: 128, paths: 80, corners: 75, noise: 18, ignoreWhite: true } },
  { id: 'sketch', label: 'Sketch', options: { mode: 'bw', threshold: 150, paths: 86, corners: 55, noise: 6, ignoreWhite: true, detail: 3 } },
  { id: 'silhouette', label: 'Silhouette', options: { mode: 'bw', threshold: 228, paths: 60, corners: 40, noise: 80, ignoreWhite: true } },
  { id: 'line-art', label: 'Line Art', quick: true, icon: 'trace-line-art', options: { mode: 'bw', threshold: 128, paths: 72, corners: 60, noise: 10, fills: false, strokes: true, strokeWidth: 12, ignoreWhite: true } },
  { id: 'technical', label: 'Technical', options: { mode: 'bw', threshold: 128, paths: 90, corners: 92, noise: 10, fills: true, strokes: true, strokeWidth: 4, snapLines: true, ignoreWhite: true, detail: 3 } },
];

export const DEFAULT_PRESET = 'auto-color';

/** Built-in or saved preset by id (saved presets come from preferences). */
export function findPreset(id, saved = []) {
  return PRESETS.find((p) => p.id === id) || saved.find((p) => p.id === id) || null;
}

/** Full options for a preset id. */
export function presetOptions(id, saved = []) {
  const p = findPreset(id, saved);
  return normalizeOptions(p ? p.options : {});
}

/** The preset whose options equal `options`, or null (custom settings). */
export function matchingPreset(options, saved = []) {
  const o = normalizeOptions(options);
  for (const p of [...PRESETS, ...saved]) {
    const q = normalizeOptions(p.options);
    if (Object.keys(q).every((k) => q[k] === o[k])) return p;
  }
  return null;
}

/** Working resolution: the longest side of the traced pixel grid. */
export function gridSize(width, height, detail = 2) {
  const long = [700, 1200, 1700][Math.max(1, Math.min(3, detail)) - 1];
  const max = Math.max(width, height) || 1;
  let s = long / max;
  // Small images are enlarged (up to 4x) so their edges trace smoothly; large ones shrink.
  s = s > 1 ? Math.min(4, s) : s;
  return { w: Math.max(1, Math.round(width * s)), h: Math.max(1, Math.round(height * s)), scale: s };
}

/** A short stable hash of a string (FNV-1a, base 36). */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
