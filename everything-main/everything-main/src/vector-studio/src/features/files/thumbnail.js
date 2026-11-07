/**
 * Small PNG thumbnails of a document's first artboard for the home screen
 * and file lists, rendered with the same drawArtwork() as the canvas.
 */
import { drawArtwork, imageFor, LayerPool } from '../../render/draw.js';

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document === 'undefined') return null;
  return Object.assign(document.createElement('canvas'), { width: w, height: h });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function canvasToDataUrl(canvas) {
  if (canvas.convertToBlob) return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
  return canvas.toDataURL('image/png');
}

/** Wait (briefly) for the document's images to decode so they show in the thumbnail. */
async function imagesReady(doc, timeout = 800) {
  const ids = [];
  doc.walk((n) => {
    if (n.type === 'image' && n.asset) ids.push(n.asset);
  });
  if (!ids.length || typeof Image === 'undefined') return;
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (ids.every((id) => !doc.assets.has(id) || imageFor(doc, id))) return;
    await new Promise((r) => setTimeout(r, 40));
  }
}

/**
 * Render the first artboard into a PNG data URL no larger than `size` px on
 * its long side. Returns null where canvas rendering is unavailable.
 */
export async function renderThumbnail(doc, { size = 256, artboard = 0 } = {}) {
  try {
    const a = doc.artboards[artboard] || doc.artboards[0];
    if (!a) return null;
    await imagesReady(doc);
    const s = size / Math.max(a.w, a.h);
    const w = Math.max(1, Math.round(a.w * s));
    const h = Math.max(1, Math.round(a.h * s));
    const canvas = makeCanvas(w, h);
    const ctx = canvas?.getContext?.('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(s, 0, 0, s, -a.x * s, -a.y * s);
    ctx.beginPath();
    ctx.rect(a.x, a.y, a.w, a.h);
    ctx.clip();
    drawArtwork(ctx, doc, {
      viewRect: { x: a.x, y: a.y, w: a.w, h: a.h },
      outline: false,
      hairline: 1 / s,
      scale: s,
      layerPool: new LayerPool(w, h),
      // Template layers are guides for the artist, not part of the picture.
      layerFilter: (layer) => !layer.template,
    });
    return await canvasToDataUrl(canvas);
  } catch {
    return null;
  }
}
