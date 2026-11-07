/**
 * Profile photos are fetched through the worker (which checks membership)
 * and turned into object URLs, cached per workspace, member, and photo
 * version for as long as the tab lives. Squares, small, so the cache is
 * cheap; revoked when a workspace is left along with attachments. A
 * workspace's icon is kept the same way, under the workspace and its
 * icon version.
 */
import { api } from './api.js';
import { cachedObjectUrl, clearObjectUrls } from './files.js';

// `${ws}/${uuid}/${version}` (or `${ws}/icon/${version}`) -> the URL, or a
// fetch that failed and stands for a while (see files.js cachedObjectUrl:
// every row drawing a member whose photo the worker no longer has asked
// for it again on every redraw).
const cache = new Map();

export function avatarUrl(wsId, uuid, version) {
  return cachedObjectUrl(cache, `${wsId}/${uuid}/${version}`, () => api.avatarBlob(wsId, uuid));
}

/** A workspace's icon as an object URL, for any workspace the user is in (the switcher shows the others' too). */
export function workspaceIconUrl(ref, version) {
  return cachedObjectUrl(cache, `${ref}/icon/${version}`, () => api.workspaceIconBlob(ref));
}

export function clearAvatarCache() {
  clearObjectUrls(cache);
}

/**
 * Prepare a chosen image for upload: centre-crop to a square, downscale to
 * `size` pixels, and encode as JPEG (PNG when the source has transparency
 * would be nicer, but JPEG keeps every photo well under the cap). With
 * `png`, PNG is tried first when it fits, for the logos a workspace icon
 * is made of: flat colours, and often a transparent background that JPEG
 * would fill in. Rejects with a message that says why when the file is
 * not usable.
 */
export async function prepareAvatar(file, { size = 256, maxBytes = 300 * 1024, png = false } = {}) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Choose an image file (PNG, JPEG, WebP, or GIF)');
  if (file.size > 20 * 1024 * 1024) throw new Error('That image is over 20 MB; pick a smaller one');
  const bitmap = await loadImage(file);
  const side = Math.min(bitmap.width, bitmap.height);
  if (side < 32) throw new Error('That image is too small to use as a photo');
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close?.();
  if (png) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    if (blob && blob.size <= maxBytes) return blob;
  }
  for (const quality of [0.86, 0.75, 0.6]) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (blob && blob.size <= maxBytes) return blob;
  }
  throw new Error('Could not make that image small enough');
}

async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to an <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('That file could not be read as an image'));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
