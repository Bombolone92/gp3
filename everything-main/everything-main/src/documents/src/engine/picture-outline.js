import { closedOutlinePath } from './compound-outlines.js';
import { UnsupportedDocumentError } from './errors.js';
import { backingFillPaint } from './picture-backing-fill.js';

// Picture textures and outlines use independent path flags and alpha. Reuse
// the shape pen renderer so group scaling does not scale the physical pen.
export function pictureOutlineScene(picture, paths, outline, backingFill = null) {
  if (!outline && !backingFill) return picture;
  if (outline && paths.some(p => p.stroke && !closedOutlinePath(p))) throw new UnsupportedDocumentError('picture outlines with open paths');
  const { width, height, x, y } = picture;
  const surface = { type: 'shape', x: 0, y: 0, width, height, paths,
    flipH: picture.image.flipH, flipV: picture.image.flipV,
    ...(picture.pictureRotation ? { shapeRotation: picture.pictureRotation } : {}) };
  return { type: 'group', x, y, width, height, childX: 0, childY: 0,
    childWidth: width, childHeight: height, children: [
      ...(backingFill ? [{ ...surface, fill: backingFillPaint(backingFill), outline: null }] : []),
      { ...picture, x: 0, y: 0 },
      ...(outline ? [{ ...surface, fill: null, outline, pictureOutline: !outline.cachedSketch }] : []),
    ] };
}
