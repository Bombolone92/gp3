import { validateImage, isPositionedImage, CROP_SIDES, normalizedRotation } from './images.js';

/**
 * Wrap Text for pictures and drawings: In Line with Text, Square, Top and Bottom, Behind Text and In Front
 * of Text (§20.4.2.3 wp:anchor with wrapSquare, wrapTopAndBottom or wrapNone, and §20.4.2.8 wp:inline).
 * Changing it marks the drawing's frame for rewriting on save; its graphic is kept as it is.
 */
export const WRAP_MODES = Object.freeze(['inline', 'square', 'topAndBottom', 'behind', 'front']);
const SIDE_DISTANCE = 114300; // The default 0.125 in left and right distance from text.

export function imageWrapMode(image) {
  if (!image) return null;
  if (!image.anchor) return 'inline';
  if (!isPositionedImage(image)) return 'other';
  if (image.anchor.wrap === 'square') return 'square';
  if (image.anchor.wrap === 'topAndBottom') return 'topAndBottom';
  return image.anchor.behind ? 'behind' : 'front';
}

/** Why a wrap mode is unavailable for this drawing, or null. */
export function wrapUnavailable(image, mode) {
  if (!image) return 'Select a picture or shape.';
  if (image.anchor?.relativeSize) return 'This drawing is sized relative to the page and keeps its wrapping.';
  if (image.anchor && !isPositionedImage(image)) return 'This drawing uses a wrapping layout that is kept as authored.';
  if (image.kind === 'chart' && mode !== 'inline') return 'Charts stay in line with text.';
  if (image.frameRotation) return 'This rotated drawing keeps its wrapping.';
  if (['square', 'topAndBottom'].includes(mode) && (normalizedRotation(image.rotation) || CROP_SIDES.some(side => image.effectExtent?.[side]))) return 'Rotated pictures and pictures with effects can float in front of or behind text only.';
  return null;
}

/**
 * Set the selected drawing's wrapping. `place` gives the position a newly floating drawing keeps:
 * { x, y } in EMU from the column's left edge and the paragraph's top.
 */
export function setImageWrap(model, mode, place = { x: 0, y: 0 }) {
  if (!WRAP_MODES.includes(mode)) throw new Error('Choose a text wrapping option.');
  const image = model.selectedImage;
  const reason = wrapUnavailable(image, mode);
  if (reason) throw new Error(reason);
  if (imageWrapMode(image) === mode) return false;
  const next = { ...image };
  if (mode === 'inline') delete next.anchor;
  else {
    const orders = model.paragraphs.flatMap(p => p.runs).filter(r => r.image?.anchor && r.image !== image).map(r => r.image.anchor.order || 0);
    const previous = image.anchor;
    // Square wrapping is measured from the column and paragraph; keep a floating drawing's place where the
    // coordinate systems agree, and otherwise start from where the drawing is now.
    const keep = previous && previous.horizontal === 'column' && previous.vertical === 'paragraph' && !previous.xAlign && !previous.yAlign && previous.xPercentage === undefined && previous.yPercentage === undefined;
    const base = { horizontal: 'column', vertical: 'paragraph', x: keep ? previous.x : Math.round(place.x || 0), y: keep ? previous.y : Math.round(place.y || 0),
      order: previous?.order ?? Math.max(0, ...orders) + 1 };
    if (mode === 'square') next.anchor = { ...base, wrap: 'square', wrapText: 'bothSides', distances: { T: 0, B: 0, L: SIDE_DISTANCE, R: SIDE_DISTANCE }, behind: false };
    else if (mode === 'topAndBottom') next.anchor = { ...base, wrap: 'topAndBottom', behind: false };
    else next.anchor = { ...base, wrap: 'none', behind: mode === 'behind' };
  }
  validateImage(next);
  model.checkpoint();
  const updated = { ...next, wrapChanged: true, anchorChanged: true };
  for (const p of model.paragraphs) for (const run of p.runs) if (run.image === image) run.image = updated;
  model.didChange();
  return true;
}
