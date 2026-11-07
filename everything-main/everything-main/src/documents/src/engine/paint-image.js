import { vectorEffectSample } from './vector-image-effects.js';
// Display-only samples of immutable pictures, bounded to 4 MP (16 MiB RGBA).
// LRU entries retain no source bitmap, so they cannot keep a document alive.
const samples = new WeakMap(), recent = new Set();
const MAX_PIXELS = 4 * 1024 * 1024;
let pixels = 0;
function discard(entry) {
  recent.delete(entry); pixels -= entry.width * entry.height;
  entry.bitmap.close(); entry.variants.delete(entry.key);
}

export function bitmapDisplayFrame(m, scale, x, y, width, height) {
  if (!(scale > 0) || !Number.isFinite(scale) || m.b !== 0 || m.c !== 0 || !(m.a > 0 && m.d > 0)) return;
  if (![m.a,m.d,m.e,m.f,x,y,width,height].every(Number.isFinite)) return;
  // Display frames truncate physical extents to twips before rounding
  // each device extent independently from its origin. Do not round far edges.
  const extent = value => {
    const twips = value / scale * 15;
    // Recover exact whole twips lost only to floating-point multiplication.
    const whole = Math.trunc(twips + Number.EPSILON * Math.max(1, Math.abs(twips)) * 8);
    return Math.round(whole / 15 * scale);
  };
  const w = extent(width * m.a), h = extent(height * m.d);
  // Keep subpixel pictures visible until their native minimum footprint is
  // established. Reflections/rotations retain the existing affine sampling.
  if (!(w > 0 && h > 0)) return;
  return [(Math.round(m.e + m.a * x) - m.e) / m.a,
    (Math.round(m.f + m.d * y) - m.f) / m.d, w / m.a, h / m.d];
}

export function paintDisplayImage(ctx, image, x, y, width, height, scale) {
  const m = ctx.getTransform();
  const frame = ctx.imageSmoothingEnabled && ctx.globalCompositeOperation === 'source-over'
    ? bitmapDisplayFrame(m, scale, x, y, width, height) : undefined;
  return paintImageFrame(ctx, image, frame || [x,y,width,height], m);
}

export function paintImage(ctx, image, ...coordinates) {
  return paintImageFrame(ctx, image, coordinates, ctx.getTransform());
}

function paintImageFrame(ctx, image, coordinates, m) {
  const [sx,sy,sw,sh,dx,dy,dw,dh] = coordinates.length === 8 ? coordinates : [0,0,image.width,image.height,...coordinates];
  const width = Math.ceil(Math.abs(dw) * Math.hypot(m.a,m.b));
  const height = Math.ceil(Math.abs(dh) * Math.hypot(m.c,m.d));
  const sample = vectorEffectSample(image, width * image.width / sw, height * image.height / sh);
  if (sample !== image) {
    if (coordinates.length === 8) return paintImage(ctx, sample, sx * sample.width / image.width, sy * sample.height / image.height,
      sw * sample.width / image.width, sh * sample.height / image.height, dx, dy, dw, dh);
    return paintImage(ctx, sample, ...coordinates);
  }
  // Preserve the established enlargement and intentional nearest-neighbor paths.
  if (!ctx.imageSmoothingEnabled || !width || !height || !(width < sw || height < sh)) {
    ctx.drawImage(image,...coordinates); return;
  }
  // A separately rasterized rotated edge can interact differently with the
  // caller's clip coverage. Keep those reductions on the direct sampling path.
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap &&
      image.width && image.height && dw > 0 && dh > 0 && width*2 < sw && height*2 < sh &&
      sx >= 0 && sy >= 0 && sx+sw <= image.width && sy+sh <= image.height &&
      ctx.globalCompositeOperation === 'source-over' && m.b === 0 && m.c === 0) {
    // Retain final device pixels, including the fractional translation and the
    // axis-aligned transform. Resizing a cached picture a second time blurs
    // fractional placements and can reintroduce aliasing inside drawing groups.
    const x = m.e+m.a*dx+m.c*dy, y = m.f+m.b*dx+m.d*dy;
    const xs = [x,x+m.a*dw,x+m.c*dh,x+m.a*dw+m.c*dh];
    const ys = [y,y+m.b*dw,y+m.d*dh,y+m.b*dw+m.d*dh];
    const left = Math.floor(Math.min(...xs)), top = Math.floor(Math.min(...ys));
    const w = Math.ceil(Math.max(...xs))-left, h = Math.ceil(Math.max(...ys))-top;
    if (w > 0 && h > 0 && w*h <= MAX_PIXELS) {
      const key = [sx,sy,sw,sh,dw,dh,m.a,m.b,m.c,m.d,x-left,y-top,w,h].join(',');
      let variants = samples.get(image);
      if (!variants) { variants = new Map(); samples.set(image,variants); }
      let entry = variants.get(key);
      if (!entry) {
        while (pixels+w*h > MAX_PIXELS) discard(recent.values().next().value);
        const canvas = new OffscreenCanvas(w,h), sample = canvas.getContext('2d');
        sample.imageSmoothingQuality = 'high';
        sample.setTransform(m.a,m.b,m.c,m.d,x-left,y-top);
        sample.drawImage(image,sx,sy,sw,sh,0,0,dw,dh);
        entry = {key,bitmap:canvas.transferToImageBitmap(),width:w,height:h,variants};
        variants.set(key,entry); pixels += w*h;
      }
      recent.delete(entry); recent.add(entry);
      ctx.save();
      try { ctx.resetTransform(); ctx.drawImage(entry.bitmap,left,top); }
      finally { ctx.restore(); }
      return;
    }
  }
  // Mutable canvases and samples beyond the display budget are painted afresh.
  const quality = ctx.imageSmoothingQuality;
  ctx.imageSmoothingQuality = 'high';
  try { ctx.drawImage(image,...coordinates); }
  finally { ctx.imageSmoothingQuality = quality; }
}
