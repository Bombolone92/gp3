/**
 * Client-side image downscaling.
 *
 * Anything a camera or a design tool produces (multi-megabyte, thousands of
 * pixels) is scaled down before it is kept: the receipt logo lives inline in
 * settings kv, so its stored size is capped hard. Decoding goes through an
 * <img> so the browser applies EXIF orientation for us.
 */

// The size cap lives with the store: settings kv is what it protects, and
// importAll enforces it on restored backups with the same value.
import { LOGO_MAX_CHARS } from '../lib/store.js';

/** Decode a picked file into a drawable image. Throws a user-facing Error. */
async function decode(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('That file couldn’t be read as an image.');
  }
  return { img, release: () => URL.revokeObjectURL(url) };
}

/** Draw `img` onto a canvas no larger than maxDim on its long side. */
function draw(img, maxDim, background = null) {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * A picked logo as a data URL under LOGO_MAX_CHARS.
 *
 * PNG first (logos are flat shapes and often transparent), JPEG on white as
 * the fallback for photographic marks, stepping the size down until one
 * fits. Throws when even the smallest attempt is too complex to fit.
 */
export async function logoDataUrl(file) {
  const { img, release } = await decode(file);
  try {
    for (const maxDim of [320, 240, 160, 120]) {
      const png = draw(img, maxDim).toDataURL('image/png');
      if (png.length <= LOGO_MAX_CHARS) return png;
      const jpeg = draw(img, maxDim, '#ffffff').toDataURL('image/jpeg', 0.85);
      if (jpeg.length <= LOGO_MAX_CHARS) return jpeg;
    }
    throw new Error('That image is too detailed for a receipt logo. Try a simpler or smaller one.');
  } finally {
    release();
  }
}

/**
 * A product photo, register-sized: 256px on the long side, JPEG on white -
 * a few tens of KB, small enough that a whole catalog of them stays cheap
 * to fetch and cache.
 */
export async function photoBlob(file) {
  const { img, release } = await decode(file);
  try {
    const canvas = draw(img, 256, '#ffffff');
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) throw new Error('That image couldn’t be processed.');
    return blob;
  } finally {
    release();
  }
}
