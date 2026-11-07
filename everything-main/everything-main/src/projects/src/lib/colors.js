/**
 * The two palettes, their names, and the one check every colour that comes
 * in from outside has to pass.
 *
 * A colour is written straight into an element's style — a chip's
 * background, an avatar's fill — so it must be a colour and nothing else:
 * `url(https://…)` is a valid CSS background too, and one in an imported
 * label would have the browser fetch that address every time the label
 * drew. Only a plain hex value gets through; anything else falls back to
 * the palette.
 */

/* First entry leads, so it is the brand purple: it is what a first project
   and the owner's avatar get. The old brand blue keeps a slot of its own so
   projects already coloured with it still match a swatch here. */
export const PROJECT_COLORS = [
  '#8833eb', '#0d9488', '#d97706', '#dc4b6a', '#4f63f0', '#2382c4', '#5f7d2f', '#b4552e',
];

export const LABEL_COLORS = [
  '#2382c4', '#0d9488', '#5f7d2f', '#d97706', '#b4552e', '#dc4b6a', '#7c53c9', '#64748b',
];

/**
 * What each swatch in those two palettes is called.
 *
 * A swatch shows its colour, which says everything to someone who can see it
 * and nothing at all to someone whose screen reader is reading out
 * "Color #8833eb, radio button" — eight of those in a row are eight options
 * that cannot be told apart, which is the same as having no control.
 */
const COLOR_NAMES = new Map([
  ['#8833eb', 'Purple'], ['#0d9488', 'Teal'], ['#d97706', 'Amber'],
  ['#dc4b6a', 'Rose'], ['#4f63f0', 'Indigo'], ['#2382c4', 'Blue'],
  ['#5f7d2f', 'Olive'], ['#b4552e', 'Rust'], ['#7c53c9', 'Violet'],
  ['#64748b', 'Slate'],
]);

/** A palette colour's name, or the value itself when it is not one of ours. */
export function colorName(hex) {
  const value = String(hex ?? '').trim();
  return COLOR_NAMES.get(value.toLowerCase()) || value;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** True for "#abc" and "#aabbcc"; nothing else is a colour this app stores. */
export function isHexColor(value) {
  return typeof value === 'string' && HEX.test(value.trim());
}

/** The value when it is a hex colour, otherwise the fallback. */
export function normalizeColor(value, fallback) {
  return isHexColor(value) ? value.trim() : fallback;
}
