// Keep validated vector sources available when pixel effects need a different
// display resolution. Raster pictures retain their original sampling behavior.
const vectors = new WeakMap(), effects = new WeakMap(), recent = new Set();
const MAX_PIXELS = 4 * 1024 * 1024;
let pixels = 0;
export function vectorImage(image, {rasterFrame = null} = {}) { vectors.set(image, rasterFrame); return image; }

function discard(entry) {
  recent.delete(entry); pixels -= entry.width * entry.height;
  entry.bitmap.close(); entry.variants.delete(entry.key);
}
function rasterize(image, width, height, transform, rasterFrame) {
  const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
  // An inclusive EMF raster maps its physical frame through the final device
  // pixel, independently at each resolution. Other vector/raster formats keep
  // their existing full-width/full-height sampling.
  context.drawImage(image, 0, 0, rasterFrame ? Math.max(1,width-1)*rasterFrame.width : width, rasterFrame ? Math.max(1,height-1)*rasterFrame.height : height);
  const data = context.getImageData(0, 0, width, height);
  transform(data.data); context.putImageData(data, 0, 0);
  return canvas.transferToImageBitmap();
}

export function imageWithPixelEffects(image, transform) {
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  let retained = false;
  try {
    const rasterFrame = vectors.get(image);
    const bitmap = rasterize(image, width, height, transform, rasterFrame);
    if (vectors.has(image)) {
      const state = { image, transform, rasterFrame, variants: new Map() };
      effects.set(bitmap, state);
      const close = bitmap.close.bind(bitmap);
      bitmap.close = () => {
        if (effects.delete(bitmap)) {
          for (const entry of state.variants.values()) discard(entry);
          image.close();
        }
        close();
      };
      retained = true;
    }
    return bitmap;
  } finally { if (!retained) image.close(); }
}

// Width/height describe the entire vector at the requested device resolution,
// before source cropping. Bound all retained display samples together, and do
// not let the LRU keep a source vector or its document alive.
export function vectorEffectSample(image, width, height) {
  const state = effects.get(image);
  if (!state || !(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return image;
  width = Math.ceil(width); height = Math.ceil(height);
  // Existing source-quality pixels remain authoritative for reductions. Do not
  // change the order of color transformation and downsampling, or replace a
  // larger existing bitmap with a lower-quality capped enlargement sample.
  if (width <= image.width && height <= image.height) return image;
  const scale = Math.min(1, 8192 / width, 8192 / height, Math.sqrt(MAX_PIXELS / width / height));
  width = Math.max(1, Math.floor(width * scale)); height = Math.max(1, Math.floor(height * scale));
  if (width <= image.width && height <= image.height) return image;
  const key = `${width}/${height}`;
  let entry = state.variants.get(key);
  if (!entry) {
    while (pixels + width * height > MAX_PIXELS) discard(recent.values().next().value);
    const bitmap = rasterize(state.image, width, height, state.transform, state.rasterFrame);
    entry = { key, bitmap, width, height, variants: state.variants };
    state.variants.set(key, entry); pixels += width * height;
  }
  recent.delete(entry); recent.add(entry);
  return entry.bitmap;
}
