/**
 * Business branding: the logo printed on documents and the accent color the
 * paper is tinted with.
 *
 * A logo is re-encoded client-side into a small image data URI, so every
 * place the paper renders — preview, print, and the self-contained public
 * share page — carries its own logo with no external request. The stored
 * string is validated on the way out again, because it is interpolated into
 * an <img src> that a share page must never be able to point elsewhere.
 */

/** Longest edge of the stored raster, and the budget for its data URI. */
export const LOGO_MAX_DIM = 720;
const LOGO_MAX_CHARS = 90_000;
const LOGO_MAX_FILE = 8 * 1024 * 1024;

const LOGO_MIME = /^image\/(png|jpe?g|webp|gif|svg\+xml)$/i;
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

/** Only a self-contained base64 image data URI may reach the paper. */
export function isLogoDataUri(value) {
  return typeof value === 'string'
    && /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.trim());
}

/** The renderable logo of a settings blob, or null. */
export function logoOf(settings) {
  const v = settings?.business?.logo;
  return isLogoDataUri(v) ? v.trim() : null;
}

/** '#ABC' or 'aabbcc' -> '#aabbcc'; anything unusable -> ''. */
export function normalizeHexColor(value) {
  const s = String(value ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) return `#${s.toLowerCase().replace(/./g, (c) => c + c)}`;
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s.toLowerCase()}`;
  return '';
}

/** The paper tint of a settings blob ('' when the paper stays in ink). */
export function brandColorOf(settings) {
  return normalizeHexColor(settings?.brandColor);
}

/* ---------- Upload pipeline (browser only) ---------- */

function readAsDataUri(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(new Error('That file could not be read'));
    fr.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That image could not be read'));
    img.src = src;
  });
}

/**
 * Encode attempts, best fidelity first. PNG keeps flat logos crisp; JPEG is
 * the fallback for photographic marks that blow the budget as PNG, drawn on
 * white because the paper is white and JPEG has no alpha.
 */
const PLAN = [
  [LOGO_MAX_DIM, 'image/png', undefined],
  [LOGO_MAX_DIM, 'image/jpeg', 0.92],
  [512, 'image/png', undefined],
  [512, 'image/jpeg', 0.86],
  [384, 'image/jpeg', 0.82],
  [256, 'image/jpeg', 0.76],
];

/**
 * Turn a user-chosen file into a stored logo data URI. Throws an Error whose
 * message is safe to show as-is.
 */
export async function processLogoFile(file) {
  if (!file) throw new Error('No image chosen');
  if (!LOGO_MIME.test(file.type || '')) throw new Error('Use a PNG, JPEG, WebP, or SVG image');
  if (file.size > LOGO_MAX_FILE) throw new Error('That image is larger than 8 MB');

  const img = await loadImage(await readAsDataUri(file));
  // SVGs without intrinsic dimensions report 0; fall back to the size a
  // browser gives a sizeless image so the raster still has a sane shape.
  const w0 = img.naturalWidth || 300;
  const h0 = img.naturalHeight || 150;

  const canvas = document.createElement('canvas');
  for (const [dim, type, quality] of PLAN) {
    const scale = Math.min(1, dim / Math.max(w0, h0));
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let url;
    try {
      url = canvas.toDataURL(type, quality);
    } catch {
      throw new Error('That image could not be processed');
    }
    if (isLogoDataUri(url) && url.length <= LOGO_MAX_CHARS) return url;
  }
  throw new Error('That image is too detailed to embed. Try a simpler or smaller logo');
}
