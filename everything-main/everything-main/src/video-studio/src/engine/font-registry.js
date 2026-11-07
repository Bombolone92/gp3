/**
 * Fonts registered at run time (uploaded by the user). Text rasters include
 * the registry version in their cache key, so text redraws once a face is
 * ready; listeners (the live player) are told to repaint.
 */

let version = 0;
const listeners = new Set();
const faces = new Map(); // family -> FontFace

export const fontsVersion = () => version;

export function onFontsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed() {
  version++;
  for (const fn of listeners) fn();
}

export const isFontRegistered = (family) => faces.has(family);

/**
 * Register font data (ArrayBuffer) under a CSS family name. Throws when the
 * data is not a font the browser can read.
 */
export async function registerFont(family, data) {
  if (faces.has(family)) return faces.get(family);
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) throw new Error('This browser cannot load fonts.');
  const face = new FontFace(family, data);
  await face.load();
  document.fonts.add(face);
  faces.set(family, face);
  changed();
  return face;
}
