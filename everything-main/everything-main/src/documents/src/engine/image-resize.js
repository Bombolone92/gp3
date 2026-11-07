import { EMU_PER_PX, ANGLE_PER_DEGREE, normalizedRotation } from './images.js';

/** Resize in the picture's axes, retaining the opposite corner (or its center).
 * Return rounded package dimensions and the matching physical preview frame.
 * Inline layout decides its final origin; anchored pictures use the origin delta.
 */
export function resizeImageFrame(frame, corner, dx, dy, { preserveAspect = frame.image.aspectLocked !== false, fromCenter = false } = {}) {
  const image = frame.image, angle = normalizedRotation(image.rotation) / ANGLE_PER_DEGREE * Math.PI / 180;
  const c = Math.cos(angle), s = Math.sin(angle);
  const sx = corner.includes('w') ? -1 : 1, sy = corner.includes('n') ? -1 : 1;
  const factor = fromCenter ? 2 : 1;
  const localX = (dx * c + dy * s) * factor, localY = (-dx * s + dy * c) * factor;
  let scaleX, scaleY;
  if (preserveAspect) {
    scaleX = scaleY = Math.max(.01, 1 + (localX * sx * frame.width + localY * sy * frame.height) / (frame.width ** 2 + frame.height ** 2));
  } else {
    scaleX = Math.max(.01, 1 + localX * sx / frame.width);
    scaleY = Math.max(.01, 1 + localY * sy / frame.height);
  }
  const width = Math.max(1, Math.round(image.width * scaleX));
  const height = Math.max(1, Math.round(preserveAspect ? width * image.height / image.width : image.height * scaleY));
  const paintedWidth = width / EMU_PER_PX, paintedHeight = height / EMU_PER_PX;
  const halfX = fromCenter ? 0 : sx * (paintedWidth - frame.width) / 2;
  const halfY = fromCenter ? 0 : sy * (paintedHeight - frame.height) / 2;
  return { width, height, frame: { ...frame,
    x: frame.x + (frame.width - paintedWidth) / 2 + halfX * c - halfY * s,
    y: frame.y + (frame.height - paintedHeight) / 2 + halfX * s + halfY * c,
    width: paintedWidth, height: paintedHeight } };
}
