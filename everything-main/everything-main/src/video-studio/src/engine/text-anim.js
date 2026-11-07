/**
 * Text animations that move letters or words individually. scene.js turns a
 * clip's in/out/loop animation into entries { id, phase, p } (p = 0..1
 * progress); the text renderer asks glyphState() how each glyph looks.
 * Everything here is deterministic: the same inputs give the same frame,
 * so preview and export match.
 */

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeOut = (p) => 1 - (1 - p) ** 3;
const easeIn = (p) => p * p * p;
const backOut = (p) => {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (p - 1) ** 3 + c1 * (p - 1) ** 2;
};
const bounceOut = (p) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (p < 1 / d1) return n1 * p * p;
  if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75;
  if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375;
  return n1 * (p -= 2.625 / d1) * p + 0.984375;
};

/** Integer hash to 0..1 (stable across engines, unlike Math.sin tricks). */
export function hash01(a, b) {
  let x = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+<>?';
const LOWER = 'abcdefghijklmnopqrstuvwxyz0123456789#%&*+<>?';

/** A stand-in character for the decoder effect. */
export function scrambleChar(ch, i, step) {
  const set = ch === ch.toLowerCase() && ch !== ch.toUpperCase() ? LOWER : UPPER;
  return set[Math.floor(hash01(i + 1, step + 7) * set.length)];
}

/**
 * Progress of unit k of n inside an overall progress p: units start one
 * after another and overlap, so the whole run still ends at p = 1.
 */
export function stagger(p, k, n) {
  if (n <= 1) return clamp01(p);
  const span = Math.max(0.25, Math.min(1, 2.5 / n));
  const step = (1 - span) / (n - 1);
  return clamp01((p - k * step) / span);
}

/**
 * Animation definitions. unit: 'char' | 'word' | 'all'. fn(q, g, env)
 * returns the glyph's offsets: { dx, dy, rot, scale, alpha, blur, ch, color }.
 * env: { size, p, step, words, wordLens }.
 */
export const TEXT_ANIMS = {
  // In
  'letters-rise': { phase: 'in', unit: 'char', fn: (q, g, e) => ({ dy: (1 - easeOut(q)) * e.size * 0.6, alpha: clamp01(q * 1.6) }) },
  'letters-fade': { phase: 'in', unit: 'char', fn: (q) => ({ alpha: q * q * (3 - 2 * q) }) },
  'word-pop': { phase: 'in', unit: 'word', fn: (q) => ({ scale: Math.max(0, backOut(q)), alpha: clamp01(q * 4) }) },
  'word-rise': { phase: 'in', unit: 'word', fn: (q, g, e) => ({ dy: (1 - easeOut(q)) * e.size * 0.8, alpha: clamp01(q * 2) }) },
  'letters-drop': { phase: 'in', unit: 'char', fn: (q, g, e) => ({ dy: -(1 - bounceOut(q)) * e.size * 1.1, alpha: q > 0 ? 1 : 0 }) },
  'letters-swing': { phase: 'in', unit: 'char', fn: (q) => ({ rot: (1 - easeOut(q)) * -1.4, scale: 0.4 + 0.6 * easeOut(q), alpha: clamp01(q * 2) }) },
  'letters-blur': { phase: 'in', unit: 'char', fn: (q, g, e) => ({ blur: (1 - easeOut(q)) * e.size * 0.22, alpha: clamp01(q * 1.4) }) },
  decode: { phase: 'in', unit: 'char', fn: (q, g, e) => (q >= 1 ? {} : { ch: scrambleChar(g.ch, g.ci, e.step), alpha: q > 0 ? 1 : 0.35 }) },
  'spacing-expand': { phase: 'in', unit: 'all', fn: (q, g) => ({ dx: (g.lineCx - g.cx) * (1 - easeOut(q)) * 0.75, alpha: clamp01(q * 1.5) }) },
  // Out
  'letters-sink': { phase: 'out', unit: 'char', fn: (q, g, e) => ({ dy: easeIn(q) * e.size * 0.6, alpha: 1 - clamp01(q * 1.4) }) },
  'letters-fade-out': { phase: 'out', unit: 'char', fn: (q) => ({ alpha: 1 - q * q * (3 - 2 * q) }) },
  'word-shrink': { phase: 'out', unit: 'word', fn: (q) => ({ scale: 1 - easeIn(q), alpha: 1 - clamp01((q - 0.6) * 2.5) }) },
  'letters-blur-out': { phase: 'out', unit: 'char', fn: (q, g, e) => ({ blur: easeIn(q) * e.size * 0.22, alpha: 1 - clamp01(q * 1.2) }) },
  'decode-out': { phase: 'out', unit: 'char', fn: (q, g, e) => (q <= 0 ? {} : q >= 1 ? { alpha: 0 } : { ch: scrambleChar(g.ch, g.ci, e.step) }) },
  'spacing-out': { phase: 'out', unit: 'all', fn: (q, g) => ({ dx: (g.cx - g.lineCx) * easeIn(q) * 0.9, alpha: 1 - clamp01(q * 1.3) }) },
  // Loop: q is the cycle phase (0..1) for the whole text
  wave: { phase: 'loop', unit: 'all', fn: (q, g, e) => ({ dy: Math.sin(q * Math.PI * 2 - Math.max(0, g.ci) * 0.55) * e.size * 0.14 }) },
  'letters-jelly': { phase: 'loop', unit: 'all', fn: (q, g) => ({ scale: 1 + 0.2 * Math.max(0, Math.sin(q * Math.PI * 2 - Math.max(0, g.ci) * 0.6)) }) },
  flicker: { phase: 'loop', unit: 'all', fn: (q, g, e) => ({ alpha: hash01(g.ci + 3, e.step) < 0.12 ? 0.25 : 1 }) },
  jitter: {
    phase: 'loop',
    unit: 'all',
    fn: (q, g, e) => ({ dx: (hash01(g.ci, e.step) - 0.5) * e.size * 0.06, dy: (hash01(g.ci + 99, e.step) - 0.5) * e.size * 0.06, rot: (hash01(g.ci + 7, e.step) - 0.5) * 0.12 }),
  },
  // Sung words take the highlight color as the clip plays (the whole clip is one cycle).
  karaoke: { phase: 'loop', unit: 'all', whole: true, fn: (q, g, e) => (g.wi >= 0 && g.wi <= activeWord(q, e.wordLens) ? { color: e.highlight } : {}) },
};

export const isGlyphAnim = (id) => Boolean(id) && Object.hasOwn(TEXT_ANIMS, id);

/** Loop animations that span the whole clip instead of repeating. */
export const isWholeClipAnim = (id) => Boolean(TEXT_ANIMS[id]?.whole);

/** Word being sung at progress p, words weighted by their length (+1 for the gap). */
export function activeWord(p, wordLens) {
  const n = wordLens.length;
  if (!n) return -1;
  const total = wordLens.reduce((a, b) => a + b + 1, 0);
  const target = clamp01(p) * total;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += wordLens[i] + 1;
    if (target < acc) return i;
  }
  return n - 1;
}

/**
 * How a glyph looks under the active entries. g: { ch, ci, wi, cx, lineCx }
 * (ci/wi are -1 for spaces). totals: { chars, words, wordLens }.
 * Returns null when nothing changes (the glyph draws as usual).
 */
export function glyphState(entries, g, totals, { size = 64, highlight = '#ffd23f' } = {}) {
  let out = null;
  for (const en of entries) {
    const def = TEXT_ANIMS[en.id];
    if (!def) continue;
    const env = { size, step: Math.floor(en.p * 30), wordLens: totals.wordLens, highlight };
    let q;
    if (def.unit === 'char') q = stagger(en.p, Math.max(0, g.ci), totals.chars);
    else if (def.unit === 'word') q = stagger(en.p, Math.max(0, g.wi), totals.words);
    else q = clamp01(en.p);
    if (def.phase === 'loop') q = en.p;
    const r = def.fn(q, g, env);
    if (!r) continue;
    out ||= { dx: 0, dy: 0, rot: 0, scale: 1, alpha: 1, blur: 0, ch: null, color: null };
    if (r.dx) out.dx += r.dx;
    if (r.dy) out.dy += r.dy;
    if (r.rot) out.rot += r.rot;
    if (r.scale !== undefined) out.scale *= r.scale;
    if (r.alpha !== undefined) out.alpha *= r.alpha;
    if (r.blur) out.blur = Math.max(out.blur, r.blur);
    if (r.ch) out.ch = r.ch;
    if (r.color) out.color = r.color;
  }
  return out;
}

/**
 * Cache key for a set of entries: frames that look the same share it, so
 * the renderer can skip redrawing (karaoke only changes per word).
 */
export function animKey(entries, totals) {
  if (!entries?.length) return '';
  return entries.map((en) => {
    if (en.id === 'karaoke') return `k${activeWord(en.p, totals?.wordLens || [])}`;
    if (en.id === 'flicker' || en.id === 'jitter' || en.id === 'decode' || en.id === 'decode-out') return `${en.id}${Math.floor(en.p * 30)}:${Math.round(en.p * 200)}`;
    const def = TEXT_ANIMS[en.id];
    // Finished in/out animations draw like plain text.
    if (def && def.phase !== 'loop' && en.p >= 1) return `${en.id}:end`;
    return `${en.id}:${Math.round(en.p * 1000)}`;
  }).join('|');
}

/** Extra room around the text an animation can move glyphs into (in font sizes). */
export function animMargin(entries) {
  let m = 0;
  for (const en of entries || []) {
    const id = en.id;
    if (id === 'letters-drop') m = Math.max(m, 1.2);
    else if (id === 'word-rise' || id === 'letters-rise' || id === 'letters-sink') m = Math.max(m, 0.85);
    else if (id === 'word-pop' || id === 'letters-swing' || id === 'letters-jelly') m = Math.max(m, 0.45);
    else if (id === 'letters-blur' || id === 'letters-blur-out') m = Math.max(m, 0.5);
    else m = Math.max(m, 0.25);
  }
  return m;
}
