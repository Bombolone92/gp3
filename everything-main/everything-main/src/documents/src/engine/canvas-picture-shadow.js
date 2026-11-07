import { drawingRasterScale } from './drawing-raster-scale.js';
import { backingFillPaint } from './picture-backing-fill.js';
import { paintWideShadow } from './wide-shadow-blur.js';

// Composite in physical frame coordinates. Shadow bounds never change layout,
// and the session bitmap never replaces retained DrawingML during export.
export function paintPictureShadow(source, shadow, geometry) {
  const pad = shadow.blur + 1;
  const sx = shadow.scaleX ?? 1, sy = shadow.scaleY ?? 1;
  const anchors = { tl:[0,0], t:[.5,0], tr:[1,0], l:[0,.5], ctr:[.5,.5], r:[1,.5], bl:[0,1], b:[.5,1], br:[1,1] };
  const [ax, ay] = anchors[shadow.alignment || 'b'];
  const px = ax * source.frameWidth, py = ay * source.frameHeight;
  const dx = px * (1 - sx) + shadow.x, dy = py * (1 - sy) + shadow.y;
  const xs = [source.left * sx + dx, (source.left + source.width) * sx + dx];
  const ys = [source.top * sy + dy, (source.top + source.height) * sy + dy];
  const visible = sx !== 0 && sy !== 0;
  const left = Math.floor(Math.min(source.left, visible ? Math.min(...xs) - pad : source.left));
  const top = Math.floor(Math.min(source.top, visible ? Math.min(...ys) - pad : source.top));
  const right = Math.ceil(Math.max(source.left + source.width, visible ? Math.max(...xs) + pad : source.left + source.width));
  const bottom = Math.ceil(Math.max(source.top + source.height, visible ? Math.max(...ys) + pad : source.top + source.height));
  const width = right - left, height = bottom - top;
  if (width > 4096 || height > 4096 || width * height > 4000000) { source.close(); throw new Error('This drawing preview exceeds the image resource limit.'); }
  const resolution = drawingRasterScale(width,height,source.rasterScale || 2);
  const canvas = new OffscreenCanvas(width * resolution, height * resolution), ctx = canvas.getContext('2d');
  const mask = new OffscreenCanvas(source.bitmap.width, source.bitmap.height), m = mask.getContext('2d');
  m.drawImage(source.bitmap, 0, 0);
  if (shadow.obscured) {
    // An obscured shadow casts the full geometric silhouette, then
    // removes its interior. Using texture alpha here incorrectly weakens the
    // exterior shadow beside translucent or transparent picture pixels.
    m.save(); m.scale(mask.width / source.width, mask.height / source.height);
    m.translate(-source.left, -source.top); m.fillStyle = '#000'; m.beginPath();
    if (geometry === 'ellipse') m.ellipse(source.frameWidth / 2, source.frameHeight / 2, source.frameWidth / 2, source.frameHeight / 2, 0, 0, Math.PI * 2);
    else m.rect(0, 0, source.frameWidth, source.frameHeight);
    m.fill(); m.restore();
  }
  m.globalCompositeOperation = 'source-in';
  m.fillStyle = backingFillPaint(shadow.color); m.fillRect(0, 0, mask.width, mask.height);
  // DrawingML gives a blur radius, rather than the Gaussian sigma used by CSS.
  // For wide blurs, the browser blur approximation can over-darken finite
  // masks. A float intermediate on a bounded shadow grid avoids that loss.
  // Keep small blurs on the browser path, where CPU convolution costs more.
  const wide = shadow.blur / 3 >= 16;
  ctx.filter = !wide && shadow.blur ? `blur(${shadow.blur * resolution / 3}px)` : 'none';
  if (visible && wide) {
    paintWideShadow(ctx,mask,source,shadow,{sx,sy,dx,dy,left,top,resolution});
  } else if (visible) {
    ctx.save(); ctx.translate((dx - left) * resolution, (dy - top) * resolution); ctx.scale(sx, sy);
    ctx.drawImage(mask, source.left * resolution, source.top * resolution, source.width * resolution, source.height * resolution); ctx.restore();
  }
  ctx.filter = 'none';
  if (shadow.obscured) {
    ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000'; ctx.beginPath();
    const x = -left * resolution, y = -top * resolution, w = source.frameWidth * resolution, h = source.frameHeight * resolution;
    if (geometry === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else ctx.rect(x, y, w, h);
    ctx.fill(); ctx.globalCompositeOperation = 'source-over';
  }
  ctx.drawImage(source.bitmap, (source.left - left) * resolution, (source.top - top) * resolution, source.width * resolution, source.height * resolution);
  source.close(); const bitmap = canvas.transferToImageBitmap();
  return { ...source, bitmap, left, top, width, height, rasterScale:resolution, close: () => bitmap.close() };
}
