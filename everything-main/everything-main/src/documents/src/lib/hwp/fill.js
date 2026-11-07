/** HWP's modern binary gradient layout, shared by borders and drawings. */
import { check } from './binary.js';
import { encodePng } from './bitmap.js';
import { imageResource } from './image.js';

const rgb = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255].map((n) => n.toString(16).padStart(2, '0')).join('');
export function binaryGradient(r) {
  const type = r.u8(), angle = r.u32(), centerX = r.u32(), centerY = r.u32(), blur = r.u32(), count = r.u32();
  check(count > 0 && count <= 1024, 'The Hanword gradient has an invalid color count.');
  const positions = count > 2 ? Array.from({ length: count }, () => r.u32()) : [];
  const colors = Array.from({ length: count }, () => rgb(r.u32()));
  return { type: ['LINEAR', 'RADIAL', 'CONICAL', 'SQUARE'][type - 1] || 'UNKNOWN', angle, centerX, centerY, blur, colors, positions };
}

// Hanword circular fills use distances in the object's coordinate system.
// DrawingML path gradients use a different focus geometry, and the editor's
// radial painter makes a thin rule almost entirely its end color. Rasterize
// the fill only, at twice screen resolution, retaining the table as text.
export function gradientPixels(g, sourceWidth, sourceHeight) {
  check(sourceWidth > 0 && sourceHeight > 0 && Number.isFinite(sourceWidth + sourceHeight));
  const scale = Math.min(2 / 75, 2048 / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale)), height = Math.max(1, Math.round(sourceHeight * scale));
  check(g.colors.length > 1 && g.colors.length <= 1024);
  const colors = g.colors.map((c) => [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)));
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const positions = g.positions?.length === colors.length ? g.positions.map((p) => clamp(p / 100)) : colors.map((_, i) => i / (colors.length - 1));
  check(positions.every((p, i) => Number.isFinite(p) && (!i || p >= positions[i - 1])), 'The Hanword gradient stops are invalid.');
  const cx = clamp((g.centerX ?? 50) / 100) * sourceWidth, cy = clamp((g.centerY ?? 50) / 100) * sourceHeight;
  const dx = Math.max(cx, sourceWidth - cx), dy = Math.max(cy, sourceHeight - cy), radius = Math.hypot(dx, dy);
  const angle = (g.angle || 0) * Math.PI / 180, ax = Math.cos(angle), ay = Math.sin(angle);
  const corners = [0, ax * sourceWidth, ay * sourceHeight, ax * sourceWidth + ay * sourceHeight], low = Math.min(...corners), high = Math.max(...corners);
  const steps = Math.max(2, Math.min(255, Math.round(g.blur || 255))), shades = []; let stop = 0;
  // Resolve stop intervals once; a hostile 1024-stop fill must not require
  // scanning its entire color list for each of millions of pixels.
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    while (stop < positions.length - 2 && t > positions[stop + 1]) stop++;
    const blend = clamp((t - positions[stop]) / (positions[stop + 1] - positions[stop] || 1));
    shades.push(colors[stop].map((v, c) => Math.round(v * (1 - blend) + colors[stop + 1][c] * blend)));
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = width === 1 ? sourceWidth / 2 : x * sourceWidth / (width - 1), py = height === 1 ? sourceHeight / 2 : y * sourceHeight / (height - 1);
    let t = g.type === 'RADIAL' ? Math.hypot(px - cx, py - cy) / radius
      : g.type === 'SQUARE' ? Math.max(Math.abs(px - cx) / dx, Math.abs(py - cy) / dy)
        : (px * ax + py * ay - low) / (high - low);
    // Shift the halfway color to Hanword's requested blend center.
    const center = clamp((g.center ?? 50) / 100);
    t = clamp(t); t = t < center ? t / (center || 1) / 2 : 0.5 + (t - center) / ((1 - center) || 1) / 2;
    // Step counts in HWP deliberately produce bands (the guide uses 50).
    const shade = shades[Math.round(t * (steps - 1))], offset = (y * width + x) * 4;
    pixels.set(shade, offset);
    pixels[offset + 3] = 255;
  }
  return { pixels, width, height };
}

export function gradientImage(g, width, height) {
  return imageResource(encodePng(gradientPixels(g, width, height)), 'png');
}
