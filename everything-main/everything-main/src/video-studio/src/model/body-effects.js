/**
 * Body effects: looks that know where the person is. They read the person
 * matte (media/segmenter.js, engine/cutout.js) of the clip they sit on, so
 * they only work in a video or image clip's own effect stack, never on an
 * effect track. Shaders are in engine/body-effects.js.
 */
export const BODY_CATEGORY = { id: 'body', label: 'Body' };

export const BODY_EFFECTS = [
  { id: 'body-outline', label: 'Outline', cat: 'body' },
  { id: 'body-aura', label: 'Aura', cat: 'body' },
  { id: 'body-neon', label: 'Neon edge', cat: 'body' },
  { id: 'body-bg-blur', label: 'Background blur', cat: 'body' },
  { id: 'body-color-spot', label: 'Color spotlight', cat: 'body' },
  { id: 'body-spotlight', label: 'Spotlight', cat: 'body' },
  { id: 'body-shadow', label: 'Cast shadow', cat: 'body' },
  { id: 'body-clones', label: 'Clones', cat: 'body' },
  { id: 'body-silhouette', label: 'Silhouette', cat: 'body' },
  { id: 'body-mosaic', label: 'Hide person', cat: 'body' },
];

const IDS = new Set(BODY_EFFECTS.map((e) => e.id));

/** Whether an effect needs the person matte. */
export const isBodyEffect = (id) => IDS.has(id);

/** Whether any effect a clip uses needs the person matte. */
export const clipUsesBodyEffect = (clip) => Boolean(clip?.effects?.some((e) => !e.off && IDS.has(e.id)));

const pct = (key, label, def, extra = {}) => ({ key, label, min: 0, max: 100, step: 1, unit: '%', def, ...extra });
const color = (key, label, def) => ({ key, label, type: 'color', def });
const degrees = (key, label, def, min = 0, max = 360) => ({ key, label, min, max, step: 1, unit: '°', def, raw: true });

export const BODY_EFFECT_PARAMS = {
  'body-outline': [pct('strength', 'Opacity', 100, { zeroOff: true }), pct('size', 'Thickness', 30), color('color', 'Color', '#ffffff')],
  'body-aura': [pct('strength', 'Glow', 70, { zeroOff: true }), pct('size', 'Size', 50), pct('speed', 'Pulse', 35), color('color', 'Color', '#8f6bff')],
  'body-neon': [pct('strength', 'Glow', 80, { zeroOff: true }), pct('size', 'Thickness', 35), pct('speed', 'Color cycle', 40), pct('dim', 'Darken picture', 55)],
  'body-bg-blur': [pct('strength', 'Blur', 60, { zeroOff: true })],
  'body-color-spot': [pct('strength', 'Amount', 100, { zeroOff: true })],
  'body-spotlight': [pct('strength', 'Darken', 65, { zeroOff: true }), pct('size', 'Light spread', 45)],
  'body-shadow': [pct('strength', 'Opacity', 60, { zeroOff: true }), degrees('angle', 'Direction', 45), pct('size', 'Distance', 30), pct('soft', 'Softness', 40), color('color', 'Color', '#000000')],
  'body-clones': [pct('strength', 'Opacity', 70, { zeroOff: true }), pct('size', 'Spacing', 40), pct('speed', 'Sway', 30)],
  'body-silhouette': [pct('strength', 'Amount', 100, { zeroOff: true }), color('color', 'Color', '#111318')],
  'body-mosaic': [pct('strength', 'Amount', 100, { zeroOff: true }), pct('size', 'Block size', 40)],
};
