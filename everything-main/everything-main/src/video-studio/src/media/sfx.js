/**
 * Sound effects library. Every effect is an original sound synthesized on
 * the fly from a small parameter recipe (oscillators, noise, envelopes,
 * filters), so nothing is downloaded and nothing is copied from elsewhere.
 *
 * The renderer is plain JavaScript sample math rather than a Web Audio
 * graph: effects are short (under 3 s, a few milliseconds to render), the
 * output is identical in the browser and in unit tests, and seeded noise
 * keeps every render of a recipe the same.
 *
 * Recipe = { id, label, group, dur, layers: [Layer] }
 * Layer  = {
 *   type: 'osc' | 'noise',
 *   wave: 'sine' | 'square' | 'saw' | 'triangle'        (osc)
 *   freq: Hz | [Hz, Hz, ...]   points spread over the layer, exponential glide
 *   steps: { count, seed, lo, hi, gate }                random stepped pitch (osc)
 *   fm: { ratio, index, decay }                         bell-like FM (osc)
 *   at, dur: seconds
 *   env: { a, h, d } percussive (exponential decay over d) | [[t 0..1, level], ...]
 *   filter: { type: 'lp' | 'hp' | 'bp', freq: Hz | [Hz...], q }
 *   drive: saturation amount, crush: sample-hold factor
 *   gain
 *   hits: [t | [t, gain]] | { count, span, seed, jitter, shape }  retrigger the layer
 *   vary: { gain, pitch }  random variation per hit
 * }
 */

export const SFX_GROUPS = [
  { id: 'transitions', label: 'Transitions' },
  { id: 'interface', label: 'Interface' },
  { id: 'everyday', label: 'Everyday' },
  { id: 'impacts', label: 'Hits and fx' },
  { id: 'cartoon', label: 'Cartoon' },
  { id: 'scifi', label: 'Sci-fi' },
  { id: 'nature', label: 'Nature' },
];

const perc = (a, d, h = 0) => ({ a, h, d });

/* More original recipes, grouped by mood. */
const EXTRA_SFX = [
  // Transitions
  {
    id: 'whoosh-soft', label: 'Soft whoosh', group: 'transitions', dur: 0.7,
    layers: [
      { type: 'noise', dur: 0.7, filter: { type: 'lp', freq: [300, 1400, 250], q: 0.9 }, env: [[0, 0], [0.4, 1], [1, 0]], gain: 1 },
    ],
  },
  {
    id: 'reverse-swell', label: 'Reverse swell', group: 'transitions', dur: 2,
    layers: [
      { type: 'osc', wave: 'sine', freq: 440, fm: { ratio: 2, index: 1.2, decay: 5 }, dur: 2, env: [[0, 0], [0.9, 1], [0.93, 0.2], [1, 0]], gain: 0.6 },
      { type: 'noise', dur: 2, filter: { type: 'bp', freq: [600, 3000], q: 1 }, env: [[0, 0], [0.9, 1], [0.93, 0], [1, 0]], gain: 0.5 },
    ],
  },
  {
    id: 'tape-stop', label: 'Tape stop', group: 'transitions', dur: 1.2,
    layers: [
      { type: 'osc', wave: 'saw', freq: [330, 300, 200, 40], dur: 1.2, filter: { type: 'lp', freq: [3000, 200], q: 0.8 }, env: [[0, 1], [0.85, 0.8], [1, 0]], gain: 0.5 },
      { type: 'osc', wave: 'sine', freq: [110, 100, 66, 20], dur: 1.2, env: [[0, 1], [0.85, 0.8], [1, 0]], gain: 0.6 },
    ],
  },
  {
    id: 'deep-boom', label: 'Deep boom', group: 'transitions', dur: 2.5,
    layers: [
      { type: 'osc', wave: 'sine', freq: [60, 30], dur: 2.4, env: perc(0.004, 2.2), drive: 1, gain: 1 },
      { type: 'noise', dur: 1.8, filter: { type: 'lp', freq: [900, 60], q: 0.7 }, env: perc(0.002, 1.6), gain: 0.5 },
    ],
  },
  {
    id: 'swipe', label: 'Swipe', group: 'transitions', dur: 0.35,
    layers: [
      { type: 'noise', dur: 0.35, filter: { type: 'bp', freq: [1200, 5000], q: 2 }, env: [[0, 0], [0.3, 1], [1, 0]], gain: 1 },
    ],
  },
  // Interface
  {
    id: 'toggle-on', label: 'Toggle on', group: 'interface', dur: 0.2,
    layers: [
      { type: 'osc', wave: 'sine', freq: 660, dur: 0.07, env: perc(0.002, 0.06), gain: 0.8 },
      { type: 'osc', wave: 'sine', freq: 990, at: 0.07, dur: 0.12, env: perc(0.002, 0.1), gain: 0.8 },
    ],
  },
  {
    id: 'toggle-off', label: 'Toggle off', group: 'interface', dur: 0.2,
    layers: [
      { type: 'osc', wave: 'sine', freq: 990, dur: 0.07, env: perc(0.002, 0.06), gain: 0.8 },
      { type: 'osc', wave: 'sine', freq: 660, at: 0.07, dur: 0.12, env: perc(0.002, 0.1), gain: 0.8 },
    ],
  },
  {
    id: 'success', label: 'Success', group: 'interface', dur: 1,
    layers: [
      { type: 'osc', wave: 'triangle', freq: 523.25, at: 0, dur: 0.9, env: perc(0.004, 0.7), gain: 0.6 },
      { type: 'osc', wave: 'triangle', freq: 659.25, at: 0.09, dur: 0.8, env: perc(0.004, 0.7), gain: 0.6 },
      { type: 'osc', wave: 'triangle', freq: 783.99, at: 0.18, dur: 0.8, env: perc(0.004, 0.7), gain: 0.6 },
      { type: 'osc', wave: 'sine', freq: 1046.5, at: 0.27, dur: 0.7, env: perc(0.004, 0.65), gain: 0.5 },
    ],
  },
  {
    id: 'blip', label: 'Blip', group: 'interface', dur: 0.12,
    layers: [
      { type: 'osc', wave: 'square', freq: 1250, dur: 0.1, filter: { type: 'lp', freq: 4000, q: 0.7 }, env: perc(0.001, 0.08), gain: 0.5 },
    ],
  },
  {
    id: 'message-sent', label: 'Message sent', group: 'interface', dur: 0.5,
    layers: [
      { type: 'noise', dur: 0.3, filter: { type: 'bp', freq: [800, 4000], q: 2.5 }, env: [[0, 0], [0.5, 1], [1, 0]], gain: 0.4 },
      { type: 'osc', wave: 'sine', freq: [700, 1400], dur: 0.3, env: [[0, 0], [0.6, 1], [1, 0]], gain: 0.4 },
      { type: 'osc', wave: 'sine', freq: 1568, at: 0.28, dur: 0.2, env: perc(0.002, 0.18), gain: 0.5 },
    ],
  },
  {
    id: 'coin', label: 'Coin', group: 'interface', dur: 0.6,
    layers: [
      { type: 'osc', wave: 'square', freq: 988, dur: 0.08, filter: { type: 'lp', freq: 5000, q: 0.7 }, env: perc(0.001, 0.07), gain: 0.45 },
      { type: 'osc', wave: 'square', freq: 1319, at: 0.08, dur: 0.5, filter: { type: 'lp', freq: 5000, q: 0.7 }, env: perc(0.001, 0.45), gain: 0.45 },
    ],
  },
  // Cartoon
  {
    id: 'boing', label: 'Boing', group: 'cartoon', dur: 0.9,
    layers: [
      { type: 'osc', wave: 'sine', freq: [140, 380, 170, 330, 190, 300, 210, 270, 230], dur: 0.9, env: perc(0.003, 0.85), gain: 1 },
      { type: 'osc', wave: 'triangle', freq: [280, 760, 340, 660, 380, 600, 420, 540, 460], dur: 0.9, env: perc(0.003, 0.6), gain: 0.25 },
    ],
  },
  {
    id: 'slide-up', label: 'Slide whistle up', group: 'cartoon', dur: 0.9,
    layers: [
      { type: 'osc', wave: 'sine', freq: [500, 1800], dur: 0.9, env: [[0, 0], [0.08, 1], [0.85, 1], [1, 0]], gain: 0.9 },
      { type: 'noise', dur: 0.9, filter: { type: 'bp', freq: [500, 1800], q: 8 }, env: [[0, 0], [0.08, 1], [0.85, 1], [1, 0]], gain: 0.15 },
    ],
  },
  {
    id: 'slide-down', label: 'Slide whistle down', group: 'cartoon', dur: 0.9,
    layers: [
      { type: 'osc', wave: 'sine', freq: [1800, 450], dur: 0.9, env: [[0, 0], [0.08, 1], [0.85, 1], [1, 0]], gain: 0.9 },
      { type: 'noise', dur: 0.9, filter: { type: 'bp', freq: [1800, 450], q: 8 }, env: [[0, 0], [0.08, 1], [0.85, 1], [1, 0]], gain: 0.15 },
    ],
  },
  {
    id: 'bonk', label: 'Bonk', group: 'cartoon', dur: 0.5,
    layers: [
      { type: 'osc', wave: 'sine', freq: [520, 380], fm: { ratio: 1.41, index: 2, decay: 0.05 }, dur: 0.45, env: perc(0.001, 0.4), gain: 1 },
      { type: 'noise', dur: 0.03, filter: { type: 'bp', freq: 2000, q: 1 }, env: perc(0.0005, 0.02), gain: 0.4 },
    ],
  },
  {
    id: 'honk', label: 'Honk', group: 'cartoon', dur: 0.6,
    layers: [
      { type: 'osc', wave: 'saw', freq: 310, dur: 0.25, hits: [0, 0.3], filter: { type: 'bp', freq: 900, q: 2 }, env: [[0, 0], [0.1, 1], [0.8, 1], [1, 0]], drive: 1, gain: 0.8 },
      { type: 'osc', wave: 'saw', freq: 466, dur: 0.25, hits: [0, 0.3], filter: { type: 'bp', freq: 1100, q: 2 }, env: [[0, 0], [0.1, 1], [0.8, 1], [1, 0]], gain: 0.5 },
    ],
  },
  {
    id: 'zip', label: 'Zip', group: 'cartoon', dur: 0.3,
    layers: [
      { type: 'osc', wave: 'square', freq: [300, 3000], dur: 0.25, filter: { type: 'lp', freq: 6000, q: 0.7 }, env: perc(0.002, 0.24), gain: 0.5 },
      { type: 'noise', dur: 0.25, filter: { type: 'hp', freq: 4000, q: 0.7 }, env: perc(0.002, 0.2), gain: 0.2 },
    ],
  },
  {
    id: 'cartoon-pop', label: 'Bubble pop', group: 'cartoon', dur: 0.25,
    layers: [
      { type: 'osc', wave: 'sine', freq: [300, 1600], dur: 0.08, env: perc(0.001, 0.07), gain: 1 },
      { type: 'osc', wave: 'sine', freq: [900, 500], at: 0.06, dur: 0.15, env: perc(0.001, 0.12), gain: 0.4 },
    ],
  },
  // Sci-fi
  {
    id: 'teleport', label: 'Teleport', group: 'scifi', dur: 1.5,
    layers: [
      { type: 'osc', wave: 'sine', freq: [200, 2400], fm: { ratio: 7.1, index: 3, decay: 2 }, dur: 1.5, env: [[0, 0], [0.2, 1], [0.8, 0.6], [1, 0]], gain: 0.6 },
      { type: 'noise', dur: 1.5, filter: { type: 'bp', freq: [400, 6000], q: 4 }, env: [[0, 0], [0.3, 1], [1, 0]], gain: 0.4 },
    ],
  },
  {
    id: 'power-up', label: 'Power up', group: 'scifi', dur: 1.2,
    layers: [
      { type: 'osc', wave: 'square', freq: [150, 1200], dur: 1.2, filter: { type: 'lp', freq: [800, 7000], q: 3 }, env: [[0, 0], [0.1, 1], [0.9, 1], [1, 0]], gain: 0.4 },
      { type: 'osc', wave: 'saw', freq: [151, 1210], dur: 1.2, filter: { type: 'lp', freq: [800, 7000], q: 3 }, env: [[0, 0], [0.1, 1], [0.9, 1], [1, 0]], gain: 0.3 },
    ],
  },
  {
    id: 'power-down', label: 'Power down', group: 'scifi', dur: 1.4,
    layers: [
      { type: 'osc', wave: 'square', freq: [1100, 60], dur: 1.4, filter: { type: 'lp', freq: [6000, 300], q: 3 }, env: [[0, 1], [0.8, 0.8], [1, 0]], gain: 0.45 },
      { type: 'osc', wave: 'sine', freq: [220, 30], dur: 1.4, env: [[0, 1], [0.8, 0.8], [1, 0]], gain: 0.5 },
    ],
  },
  {
    id: 'computer-beeps', label: 'Computer beeps', group: 'scifi', dur: 1.6,
    layers: [
      { type: 'osc', wave: 'sine', steps: { count: 12, seed: 23, lo: 600, hi: 2400, gate: 0.3 }, dur: 1.6, env: [[0, 1], [0.95, 1], [1, 0]], gain: 0.7 },
    ],
  },
  {
    id: 'warp', label: 'Warp', group: 'scifi', dur: 2,
    layers: [
      { type: 'osc', wave: 'saw', freq: [80, 160, 40], dur: 2, filter: { type: 'bp', freq: [300, 4000, 200], q: 6 }, env: [[0, 0], [0.5, 1], [1, 0]], gain: 0.7 },
      { type: 'osc', wave: 'saw', freq: [81, 162, 41], dur: 2, filter: { type: 'bp', freq: [320, 4200, 220], q: 6 }, env: [[0, 0], [0.5, 1], [1, 0]], gain: 0.7 },
    ],
  },
  {
    id: 'scanner', label: 'Scanner', group: 'scifi', dur: 2,
    layers: [
      { type: 'osc', wave: 'triangle', freq: [900, 1500, 900, 1500, 900], dur: 2, env: [[0, 0], [0.05, 1], [0.95, 1], [1, 0]], gain: 0.6 },
      { type: 'osc', wave: 'sine', freq: 60, dur: 2, env: [[0, 0], [0.05, 1], [0.95, 1], [1, 0]], gain: 0.3 },
    ],
  },
  // Nature
  {
    id: 'wind', label: 'Wind', group: 'nature', dur: 3,
    layers: [
      { type: 'noise', dur: 3, filter: { type: 'bp', freq: [300, 700, 400, 900, 350], q: 3 }, env: [[0, 0], [0.2, 1], [0.6, 0.7], [0.8, 1], [1, 0]], gain: 1 },
      { type: 'noise', dur: 3, filter: { type: 'lp', freq: 250, q: 0.7 }, env: [[0, 0], [0.3, 1], [1, 0]], gain: 0.5 },
    ],
  },
  {
    id: 'rain', label: 'Rain', group: 'nature', dur: 3,
    layers: [
      { type: 'noise', dur: 3, filter: { type: 'hp', freq: 1500, q: 0.7 }, env: [[0, 0], [0.1, 1], [0.9, 1], [1, 0]], gain: 0.35 },
      { type: 'noise', dur: 0.012, hits: { count: 90, span: 2.9, seed: 31 }, vary: { gain: 0.8, pitch: 0.8 }, filter: { type: 'bp', freq: 3500, q: 2 }, env: perc(0.0005, 0.01), gain: 1 },
    ],
  },
  {
    id: 'thunder', label: 'Thunder', group: 'nature', dur: 3,
    layers: [
      { type: 'noise', dur: 3, filter: { type: 'lp', freq: [2000, 300, 120], q: 0.8 }, env: [[0, 0], [0.02, 1], [0.15, 0.6], [0.3, 0.9], [1, 0]], drive: 1.5, gain: 1 },
      { type: 'noise', dur: 0.15, filter: { type: 'hp', freq: 2000, q: 0.7 }, env: perc(0.001, 0.12), gain: 0.4 },
    ],
  },
  {
    id: 'water-drop', label: 'Water drop', group: 'nature', dur: 0.4,
    layers: [
      { type: 'osc', wave: 'sine', freq: [700, 1900], dur: 0.12, env: perc(0.001, 0.11), gain: 1 },
      { type: 'osc', wave: 'sine', freq: [1200, 2400], at: 0.1, dur: 0.25, env: perc(0.001, 0.2), gain: 0.25 },
    ],
  },
  {
    id: 'birds', label: 'Birdsong', group: 'nature', dur: 2.5,
    layers: [
      { type: 'osc', wave: 'sine', freq: [3200, 4200, 2800], dur: 0.12, hits: { count: 9, span: 2.3, seed: 17, jitter: 0.8 }, vary: { gain: 0.4, pitch: 0.3 }, env: [[0, 0], [0.2, 1], [1, 0]], gain: 0.8 },
      { type: 'osc', wave: 'sine', freq: [2500, 3600], dur: 0.06, hits: { count: 7, span: 2.3, seed: 41, jitter: 0.9 }, vary: { gain: 0.5, pitch: 0.2 }, env: [[0, 0], [0.3, 1], [1, 0]], gain: 0.6 },
    ],
  },
  {
    id: 'fire-crackle', label: 'Fire crackle', group: 'nature', dur: 3,
    layers: [
      { type: 'noise', dur: 3, filter: { type: 'lp', freq: 500, q: 0.7 }, env: [[0, 0], [0.1, 1], [0.9, 1], [1, 0]], gain: 0.3 },
      { type: 'noise', dur: 0.008, hits: { count: 45, span: 2.9, seed: 9, jitter: 1 }, vary: { gain: 0.9, pitch: 0.6 }, filter: { type: 'bp', freq: 2500, q: 1.5 }, env: perc(0.0003, 0.007), gain: 1 },
    ],
  },
];

export const SFX = [
  {
    id: 'whoosh', label: 'Whoosh', group: 'transitions', dur: 1,
    layers: [
      { type: 'noise', dur: 1, filter: { type: 'bp', freq: [300, 1800, 400], q: 1.2 }, env: [[0, 0], [0.45, 1], [1, 0]], gain: 1 },
      { type: 'noise', dur: 1, filter: { type: 'lp', freq: [500, 1200, 300], q: 0.8 }, env: [[0, 0], [0.5, 1], [1, 0]], gain: 0.45 },
    ],
  },
  {
    id: 'swoosh-up', label: 'Swoosh up', group: 'transitions', dur: 0.8,
    layers: [
      { type: 'noise', dur: 0.8, filter: { type: 'bp', freq: [250, 4500], q: 1.5 }, env: [[0, 0], [0.8, 1], [1, 0]], gain: 1 },
      { type: 'osc', wave: 'sine', freq: [180, 700], dur: 0.8, env: [[0, 0], [0.8, 1], [1, 0]], gain: 0.15 },
    ],
  },
  {
    id: 'swoosh-down', label: 'Swoosh down', group: 'transitions', dur: 0.8,
    layers: [
      { type: 'noise', dur: 0.8, filter: { type: 'bp', freq: [4500, 250], q: 1.5 }, env: [[0, 0], [0.15, 1], [1, 0]], gain: 1 },
      { type: 'osc', wave: 'sine', freq: [700, 180], dur: 0.8, env: [[0, 0], [0.15, 1], [1, 0]], gain: 0.15 },
    ],
  },
  {
    id: 'riser', label: 'Riser', group: 'transitions', dur: 3,
    layers: [
      { type: 'osc', wave: 'saw', freq: [110, 880], dur: 3, filter: { type: 'lp', freq: [400, 6000], q: 2 }, env: [[0, 0], [0.88, 1], [1, 0]], gain: 0.5 },
      { type: 'osc', wave: 'saw', freq: [111.5, 884], dur: 3, filter: { type: 'lp', freq: [400, 6000], q: 2 }, env: [[0, 0], [0.88, 1], [1, 0]], gain: 0.5 },
      { type: 'noise', dur: 3, filter: { type: 'hp', freq: [800, 8000], q: 0.7 }, env: [[0, 0], [0.88, 1], [1, 0]], gain: 0.35 },
    ],
  },
  {
    id: 'impact', label: 'Impact', group: 'transitions', dur: 2,
    layers: [
      { type: 'osc', wave: 'sine', freq: [90, 28], dur: 1.95, env: perc(0.002, 1.8), drive: 2, gain: 1 },
      { type: 'noise', dur: 1.2, filter: { type: 'lp', freq: [2000, 120], q: 0.7 }, env: perc(0.001, 1), gain: 0.7 },
      { type: 'noise', dur: 0.05, filter: { type: 'bp', freq: 3000, q: 1 }, env: perc(0.0005, 0.03), gain: 0.4 },
    ],
  },
  {
    id: 'pop', label: 'Pop', group: 'interface', dur: 0.18,
    layers: [
      { type: 'osc', wave: 'sine', freq: [1100, 180], dur: 0.12, env: perc(0.002, 0.12), gain: 1 },
      { type: 'noise', dur: 0.012, filter: { type: 'hp', freq: 3000, q: 0.7 }, env: perc(0.0005, 0.01), gain: 0.3 },
    ],
  },
  {
    id: 'click', label: 'Click', group: 'interface', dur: 0.08,
    layers: [
      { type: 'noise', dur: 0.02, filter: { type: 'bp', freq: 3500, q: 2 }, env: perc(0.0003, 0.015), gain: 1 },
      { type: 'osc', wave: 'sine', freq: 1800, dur: 0.03, env: perc(0.0005, 0.02), gain: 0.5 },
    ],
  },
  {
    id: 'ding', label: 'Ding', group: 'interface', dur: 1.6,
    layers: [
      { type: 'osc', wave: 'sine', freq: 1320, fm: { ratio: 2.76, index: 1.5, decay: 0.3 }, dur: 1.6, env: perc(0.002, 1.5), gain: 1 },
      { type: 'osc', wave: 'sine', freq: 2640, dur: 0.8, env: perc(0.002, 0.6), gain: 0.25 },
    ],
  },
  {
    id: 'chime', label: 'Chime', group: 'interface', dur: 2,
    layers: [
      { type: 'osc', wave: 'sine', freq: 1047, fm: { ratio: 3.5, index: 1, decay: 0.4 }, at: 0, dur: 1.7, env: perc(0.002, 1.6), gain: 0.7 },
      { type: 'osc', wave: 'sine', freq: 1319, fm: { ratio: 3.5, index: 1, decay: 0.4 }, at: 0.14, dur: 1.7, env: perc(0.002, 1.6), gain: 0.7 },
      { type: 'osc', wave: 'sine', freq: 1568, fm: { ratio: 3.5, index: 1, decay: 0.4 }, at: 0.28, dur: 1.7, env: perc(0.002, 1.6), gain: 0.7 },
    ],
  },
  {
    id: 'notification', label: 'Notification', group: 'interface', dur: 0.7,
    layers: [
      { type: 'osc', wave: 'sine', freq: 880, at: 0, dur: 0.25, env: perc(0.004, 0.22), gain: 1 },
      { type: 'osc', wave: 'triangle', freq: 1760, at: 0, dur: 0.2, env: perc(0.004, 0.15), gain: 0.2 },
      { type: 'osc', wave: 'sine', freq: 1318.5, at: 0.14, dur: 0.54, env: perc(0.004, 0.45), gain: 1 },
      { type: 'osc', wave: 'triangle', freq: 2637, at: 0.14, dur: 0.4, env: perc(0.004, 0.3), gain: 0.2 },
    ],
  },
  {
    id: 'glitch', label: 'Glitch', group: 'interface', dur: 0.8,
    layers: [
      { type: 'osc', wave: 'square', steps: { count: 14, seed: 11, lo: 120, hi: 2400, gate: 0.25 }, dur: 0.8, filter: { type: 'lp', freq: 5000, q: 0.7 }, env: [[0, 1], [0.92, 1], [1, 0]], crush: 6, gain: 0.5 },
      { type: 'noise', steps: { count: 9, seed: 5, gate: 0.5 }, dur: 0.8, env: [[0, 1], [0.92, 1], [1, 0]], crush: 12, gain: 0.25 },
    ],
  },
  {
    id: 'error-buzz', label: 'Error buzz', group: 'interface', dur: 0.55,
    layers: [
      { type: 'osc', wave: 'square', freq: 100, dur: 0.2, hits: [0, 0.28], filter: { type: 'lp', freq: 1400, q: 0.7 }, env: [[0, 0], [0.05, 1], [0.85, 1], [1, 0]], drive: 1.2, gain: 0.6 },
      { type: 'osc', wave: 'saw', freq: 150, dur: 0.2, hits: [0, 0.28], filter: { type: 'lp', freq: 1400, q: 0.7 }, env: [[0, 0], [0.05, 1], [0.85, 1], [1, 0]], gain: 0.3 },
    ],
  },
  {
    id: 'camera-shutter', label: 'Camera shutter', group: 'everyday', dur: 0.35,
    layers: [
      { type: 'noise', dur: 0.04, hits: [0, 0.1], filter: { type: 'bp', freq: 2500, q: 1.5 }, env: perc(0.0005, 0.035), gain: 1 },
      { type: 'osc', wave: 'sine', freq: [220, 90], dur: 0.08, hits: [0, 0.1], env: perc(0.001, 0.07), gain: 0.5 },
      { type: 'noise', at: 0.01, dur: 0.12, filter: { type: 'hp', freq: 6000, q: 0.7 }, env: [[0, 0], [0.1, 1], [1, 0]], gain: 0.15 },
    ],
  },
  {
    id: 'typewriter-key', label: 'Typewriter key', group: 'everyday', dur: 0.3,
    layers: [
      { type: 'noise', dur: 0.02, filter: { type: 'hp', freq: 1500, q: 0.7 }, env: perc(0.0003, 0.02), gain: 1 },
      { type: 'noise', dur: 0.06, filter: { type: 'bp', freq: 900, q: 4 }, env: perc(0.001, 0.05), gain: 0.6 },
      { type: 'osc', wave: 'sine', freq: [300, 120], dur: 0.05, env: perc(0.001, 0.04), gain: 0.5 },
      { type: 'osc', wave: 'sine', freq: 2600, dur: 0.15, env: perc(0.001, 0.12), gain: 0.08 },
    ],
  },
  {
    id: 'keyboard-typing', label: 'Keyboard typing', group: 'everyday', dur: 2,
    layers: [
      { type: 'noise', dur: 0.03, hits: { count: 16, span: 1.85, seed: 7, jitter: 0.5 }, vary: { gain: 0.5, pitch: 0.25 }, filter: { type: 'bp', freq: 2200, q: 1.5 }, env: perc(0.0005, 0.025), gain: 1 },
      { type: 'osc', wave: 'sine', freq: 180, dur: 0.03, hits: { count: 16, span: 1.85, seed: 7, jitter: 0.5 }, vary: { gain: 0.5 }, env: perc(0.001, 0.025), gain: 0.3 },
    ],
  },
  {
    id: 'applause', label: 'Applause', group: 'everyday', dur: 3,
    layers: [
      { type: 'noise', dur: 0.025, hits: { count: 150, span: 2.8, seed: 3, shape: [[0, 0.3], [0.15, 1], [0.7, 0.9], [1, 0.1]] }, vary: { gain: 0.7, pitch: 0.4 }, filter: { type: 'bp', freq: 1400, q: 1.2 }, env: perc(0.0005, 0.02), gain: 1 },
      { type: 'noise', dur: 3, filter: { type: 'bp', freq: 1000, q: 0.7 }, env: [[0, 0], [0.15, 1], [0.7, 0.8], [1, 0]], gain: 0.12 },
    ],
  },
  {
    id: 'cash-register', label: 'Cash register', group: 'everyday', dur: 1.6,
    layers: [
      { type: 'noise', dur: 0.06, hits: [0, 0.05], filter: { type: 'bp', freq: 1500, q: 1 }, env: perc(0.001, 0.05), gain: 0.6 },
      { type: 'osc', wave: 'sine', freq: [140, 70], dur: 0.1, env: perc(0.001, 0.09), gain: 0.5 },
      { type: 'osc', wave: 'sine', freq: 2350, fm: { ratio: 2.4, index: 2, decay: 0.25 }, at: 0.1, dur: 1.45, env: perc(0.001, 1.3), gain: 0.7 },
      { type: 'osc', wave: 'sine', freq: 3520, fm: { ratio: 1.5, index: 1, decay: 0.2 }, at: 0.1, dur: 1.1, env: perc(0.001, 1), gain: 0.4 },
    ],
  },
  {
    id: 'tick-tock', label: 'Tick tock', group: 'everyday', dur: 2,
    layers: [
      { type: 'osc', wave: 'sine', freq: 2100, dur: 0.05, hits: [0, 1], env: perc(0.0005, 0.04), gain: 0.8 },
      { type: 'noise', dur: 0.02, hits: [0, 1], filter: { type: 'bp', freq: 2500, q: 3 }, env: perc(0.0005, 0.02), gain: 0.5 },
      { type: 'osc', wave: 'sine', freq: 1400, dur: 0.06, hits: [0.5, 1.5], env: perc(0.0005, 0.05), gain: 0.8 },
      { type: 'noise', dur: 0.02, hits: [0.5, 1.5], filter: { type: 'bp', freq: 1600, q: 3 }, env: perc(0.0005, 0.02), gain: 0.5 },
    ],
  },
  {
    id: 'heartbeat', label: 'Heartbeat', group: 'everyday', dur: 2,
    layers: [
      { type: 'osc', wave: 'sine', freq: [70, 42], dur: 0.18, hits: [0, [0.26, 0.7], 1, [1.26, 0.7]], env: perc(0.004, 0.16), gain: 1 },
      { type: 'noise', dur: 0.12, hits: [0, [0.26, 0.7], 1, [1.26, 0.7]], filter: { type: 'lp', freq: 150, q: 0.7 }, env: perc(0.003, 0.1), gain: 0.5 },
    ],
  },
  {
    id: 'drum-hit', label: 'Drum hit', group: 'impacts', dur: 0.6,
    layers: [
      { type: 'osc', wave: 'sine', freq: [160, 48], dur: 0.55, env: perc(0.001, 0.45), drive: 1.5, gain: 1 },
      { type: 'noise', dur: 0.05, filter: { type: 'lp', freq: 4000, q: 0.7 }, env: perc(0.0005, 0.04), gain: 0.35 },
      { type: 'noise', dur: 0.18, filter: { type: 'bp', freq: 1800, q: 0.9 }, env: perc(0.001, 0.15), gain: 0.35 },
    ],
  },
  {
    id: 'laser', label: 'Laser', group: 'impacts', dur: 0.45,
    layers: [
      { type: 'osc', wave: 'square', freq: [2800, 180], dur: 0.42, filter: { type: 'lp', freq: 6000, q: 0.7 }, env: perc(0.001, 0.4), gain: 0.5 },
      { type: 'osc', wave: 'saw', freq: [3000, 200], dur: 0.42, env: perc(0.001, 0.35), gain: 0.35 },
    ],
  },
  ...EXTRA_SFX,
];

export const SFX_BY_ID = new Map(SFX.map((s) => [s.id, s]));

/** Deterministic PRNG so seeded noise renders the same every time. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Value of a list of points spread evenly over 0..1 at x (exponential between positive points). */
function glide(points, x) {
  if (!Array.isArray(points)) return points;
  if (points.length === 1) return points[0];
  const pos = Math.min(1, Math.max(0, x)) * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = points[i];
  const b = points[i + 1];
  return a > 0 && b > 0 ? a * (b / a) ** f : a + (b - a) * f;
}

/** Linear interpolation through [[x, y], ...] points at x. */
function curve(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return x1 > x0 ? y0 + ((y1 - y0) * (x - x0)) / (x1 - x0) : y1;
    }
  }
  return points[points.length - 1][1];
}

function envelope(env, t, dur) {
  if (!env) return 1;
  if (Array.isArray(env)) return curve(env, t / dur);
  const { a = 0.001, h = 0, d = dur } = env;
  if (t < a) return t / a;
  if (t < a + h) return 1;
  // exp(-6.9) is -60 dB, reached at the end of the decay.
  return Math.exp((-6.9 * (t - a - h)) / Math.max(1e-4, d));
}

/** Start times and gains for each trigger of a layer. */
export function hitTimes(layer) {
  const hits = layer.hits;
  if (!hits) return [{ t: 0, gain: 1 }];
  if (Array.isArray(hits)) return hits.map((x) => (Array.isArray(x) ? { t: x[0], gain: x[1] } : { t: x, gain: 1 }));
  const { count, span, seed = 1, jitter = 1, shape } = hits;
  const rnd = mulberry32(seed);
  const out = [];
  const step = span / count;
  for (let i = 0; i < count; i++) {
    // Even spacing nudged by up to jitter of a step, then sorted.
    const t = Math.max(0, Math.min(span, (i + 0.5) * step + (rnd() - 0.5) * step * jitter * 2));
    out.push({ t, gain: shape ? curve(shape, t / span) : 1 });
  }
  return out.sort((a, b) => a.t - b.t);
}

const TWO_PI = Math.PI * 2;

function oscSample(wave, phase) {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case 'square':
      return p < 0.5 ? 0.8 : -0.8;
    case 'saw':
      return 2 * p - 1;
    case 'triangle':
      return 1 - 4 * Math.abs(p - 0.5);
    default:
      return Math.sin(TWO_PI * p);
  }
}

/**
 * Render one trigger of a layer into out starting at sample offset start.
 * pitch scales oscillator and filter frequencies; gain scales the level.
 */
function renderLayer(out, layer, sr, start, { gain, pitch, rnd }) {
  const n = Math.min(out.length - start, Math.round(layer.dur * sr));
  if (n <= 0) return;
  const filter = layer.filter;
  // State-variable filter (topology-preserving) with a cutoff that may sweep.
  let ic1 = 0;
  let ic2 = 0;
  let a1 = 0;
  let a2 = 0;
  let a3 = 0;
  const k = filter ? 1 / (filter.q || 0.707) : 0;
  const setCutoff = (x) => {
    const fc = Math.min(sr * 0.45, Math.max(20, glide(filter.freq, x) * pitch));
    const g = Math.tan((Math.PI * fc) / sr);
    a1 = 1 / (1 + g * (g + k));
    a2 = g * a1;
    a3 = g * a2;
  };
  const steps = layer.steps;
  let stepFreq = 0;
  let stepOn = true;
  const stepLen = steps ? Math.max(1, Math.floor(n / steps.count)) : 0;
  const stepRnd = steps ? mulberry32(steps.seed || 1) : null;
  const crush = Math.max(1, Math.round(layer.crush || 1));
  let held = 0;
  let phase = 0;
  let modPhase = 0;
  const fm = layer.fm;
  const drive = layer.drive || 0;
  const driveNorm = drive ? 1 / Math.tanh(1 + drive) : 1;
  const fade = Math.min(n, Math.round(0.003 * sr));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const x = i / n;
    if (steps && i % stepLen === 0) {
      const r = stepRnd();
      stepFreq = steps.lo !== undefined ? steps.lo * (steps.hi / steps.lo) ** r : 0;
      stepOn = stepRnd() >= (steps.gate || 0);
    }
    if (filter && (i & 7) === 0) setCutoff(x);
    let s;
    if (layer.type === 'noise') {
      s = rnd() * 2 - 1;
    } else {
      const f = (steps ? stepFreq : glide(layer.freq, x)) * pitch;
      if (fm) {
        const mf = f * fm.ratio;
        const idx = fm.index * Math.exp(-t / Math.max(1e-3, fm.decay));
        modPhase += mf / sr;
        s = oscSample(layer.wave, phase + (idx * Math.sin(TWO_PI * modPhase)) / TWO_PI);
      } else s = oscSample(layer.wave, phase);
      phase += f / sr;
      if (phase > 1e6) phase -= Math.floor(phase);
    }
    if (crush > 1) {
      if (i % crush === 0) held = s;
      s = held;
    }
    if (filter) {
      const v3 = s - ic2;
      const v1 = a1 * ic1 + a2 * v3;
      const v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1;
      ic2 = 2 * v2 - ic2;
      s = filter.type === 'hp' ? s - k * v1 - v2 : filter.type === 'bp' ? v1 * k : v2;
    }
    if (drive) s = Math.tanh(s * (1 + drive)) * driveNorm;
    let g = envelope(layer.env, t, layer.dur) * gain;
    if (!stepOn) g = 0;
    // A few milliseconds of fade out so a layer never ends on a click.
    if (i >= n - fade) g *= (n - i) / fade;
    out[start + i] += s * g;
  }
}

/**
 * Render a recipe (or an id) to mono samples. Returns a Float32Array of
 * round(dur * sampleRate) samples, peak normalized to about -1 dBFS.
 */
export function renderSfx(recipeOrId, sampleRate = 44100) {
  const recipe = typeof recipeOrId === 'string' ? SFX_BY_ID.get(recipeOrId) : recipeOrId;
  if (!recipe) throw new Error(`Unknown sound effect ${recipeOrId}`);
  const out = new Float32Array(Math.round(recipe.dur * sampleRate));
  recipe.layers.forEach((layer, li) => {
    const rnd = mulberry32(hashString(`${recipe.id}:${li}`));
    const vary = layer.vary || {};
    for (const hit of hitTimes(layer)) {
      const start = Math.round(((layer.at || 0) + hit.t) * sampleRate);
      if (start >= out.length) continue;
      const gain = (layer.gain ?? 1) * hit.gain * (1 - (vary.gain || 0) * rnd());
      const pitch = 1 + (vary.pitch || 0) * (rnd() - 0.5);
      renderLayer(out, layer, sampleRate, start, { gain, pitch, rnd });
    }
  });
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0) {
    const k = 0.89 / peak;
    for (let i = 0; i < out.length; i++) out[i] *= k;
  }
  return out;
}
