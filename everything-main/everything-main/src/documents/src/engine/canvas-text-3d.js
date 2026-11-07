import { text3dSurface } from './text-3d.js';
import { preparedText3dFont } from './text-3d-fonts.js';
import { emboldenGlyphContours, flattenGlyphContours, bevelScanlineCrossings } from './text-bevel-geometry.js';
import { create3dShader } from './drawing-3d-lighting.js';
import { bevelLightingNormals } from './text-bevel-lighting.js';
import { measureCanvasText } from './canvas-text.js';

const images = new Map(), faceIds = new WeakMap();
let nextId = 0, cachedPixels = 0;
const front = [0, 0, 1];

function glyphPolygons(ctx, text, style, face, resolution) {
  // Native Canvas remains responsible for advances. Joining scripts, marks,
  // active ligatures and fallback glyphs need a shaped-glyph outline bridge;
  // retain their existing Canvas preview until that bridge is available.
  if (style.bidiDirection === 'rtl' || style.ligatures && style.ligatures !== 'none' ||
      !/^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Number}\p{Punctuation}\p{Symbol}\p{Separator}]*$/u.test(text)) return null;
  if (face.syntheticItalic) return null;
  const font = face.font, em = style.fontSize * 4 / 3, scale = em / font.unitsPerEm;
  const result = [];
  let prefix = '';
  for (const character of text) {
    const glyph = font.charToGlyph(character);
    if (!glyph.index && character !== '\0') return null;
    // Ensure lazy TrueType points have been read through the public API.
    const path = glyph.getPath();
    let contours = glyph.getContours().map(c => c.map(p => ({ x: p.x, y: -p.y, onCurve: p.onCurve })));
    if (!contours.length && path.commands.length) return null;
    if (face.syntheticBold && contours.length) {
      const height = Math.ceil(font.unitsPerEm / 50) - 1;
      contours = emboldenGlyphContours(contours, { scale: 1 - height / font.unitsPerEm, strengthX: height + 1, strengthY: height });
    }
    const x = prefix ? measureCanvasText(ctx, prefix + character, style).width - measureCanvasText(ctx, character, style).width : 0;
    prefix += character;
    for (const contour of flattenGlyphContours(contours, .125 / resolution / scale))
      if (contour.length >= 3) result.push(contour.map(p => ({ x: p.x * scale + x, y: p.y * scale })));
  }
  return result;
}

function paintBevelFace(quad, normal, rgb, gradient, bevelWidth, target) {
  const { pixels, distances, width, height, left, top, resolution } = target;
  const edgeX = quad[1].x - quad[0].x, edgeY = quad[1].y - quad[0].y;
  const lengthSquared = edgeX * edgeX + edgeY * edgeY;
  const y0 = Math.max(0, Math.floor((Math.min(...quad.map(p => p.y)) - top) * resolution));
  const y1 = Math.min(height, Math.ceil((Math.max(...quad.map(p => p.y)) - top) * resolution));
  for (let row = y0; row < y1; row++) {
    const y = top + (row + .5) / resolution;
    // The same even-odd coverage as the point test, evaluated once per row.
    // Pairing crossings also retains concave and self-intersecting offset faces.
    const crossings = bevelScanlineCrossings(quad, y);
    for (let segment = 0; segment + 1 < crossings.length; segment += 2) {
      const x0 = Math.max(0, Math.floor((crossings[segment] - left) * resolution) - 1);
      const x1 = Math.min(width, Math.ceil((crossings[segment + 1] - left) * resolution) + 1);
      for (let column = x0; column < x1; column++) {
        const x = left + (column + .5) / resolution;
        if (x < crossings[segment] || x >= crossings[segment + 1]) continue;
        const distance = (x - quad[0].x) * normal[0] + (y - quad[0].y) * normal[1], index = row * width + column;
        if (distance < 0 || distance >= bevelWidth || distance >= distances[index]) continue;
        distances[index] = distance;
        if (rgb) {
          pixels[index * 4] = rgb[0]; pixels[index * 4 + 1] = rgb[1]; pixels[index * 4 + 2] = rgb[2];
        } else {
          const t = Math.max(0, Math.min(1, ((x - quad[0].x) * edgeX + (y - quad[0].y) * edgeY) / lengthSquared));
          pixels[index * 4] = Math.min(255, Math.max(0, Math.round(gradient.first[0] + gradient.delta[0] * t)));
          pixels[index * 4 + 1] = Math.min(255, Math.max(0, Math.round(gradient.first[1] + gradient.delta[1] * t)));
          pixels[index * 4 + 2] = Math.min(255, Math.max(0, Math.round(gradient.first[2] + gradient.delta[2] * t)));
        }
      }
    }
  }
}

function raster(polygons, surface, color, resolution) {
  const points = polygons.flat();
  if (!points.length) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of points) { left = Math.min(left, p.x); top = Math.min(top, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
  left = Math.floor(left * resolution) / resolution; top = Math.floor(top * resolution) / resolution;
  const width = Math.max(1, Math.ceil((right - left) * resolution)), height = Math.max(1, Math.ceil((bottom - top) * resolution));
  // Avoid an unbounded allocation for malicious or extreme transformed text.
  if (width * height > 32 * 1024 * 1024) return null;
  const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
  const image = context.createImageData(width, height), pixels = image.data;
  const shader = surface.material === 'flat' ? rgb => rgb : create3dShader(surface);
  const faceColor = shader(color, front, front);
  for (let i = 0; i < pixels.length; i += 4) { pixels[i] = faceColor[0]; pixels[i + 1] = faceColor[1]; pixels[i + 2] = faceColor[2]; pixels[i + 3] = 255; }
  const bevelWidth = surface.width / 9525, bevelHeight = surface.height / 9525;
  if (bevelWidth && bevelHeight && surface.material !== 'flat') {
    const distances = new Float32Array(width * height); distances.fill(Infinity);
    const target = { pixels, distances, width, height, left, top, resolution };
    for (const contour of polygons) {
      const lighting = bevelLightingNormals(contour, bevelHeight / bevelWidth);
      const normals = contour.map((p, i) => {
        const q = contour[(i + 1) % contour.length], length = Math.hypot(q.x - p.x, q.y - p.y);
        return [-(q.y - p.y) / length, (q.x - p.x) / length];
      });
      const inner = contour.map((p, i) => {
        const a = normals[(i + contour.length - 1) % contour.length], b = normals[i];
        const factor = bevelWidth / Math.max(1 + a[0] * b[0] + a[1] * b[1], 1e-8);
        return { x: p.x + (a[0] + b[0]) * factor, y: p.y + (a[1] + b[1]) * factor };
      });
      for (let i = 0; i < contour.length; i++) {
        const next = (i + 1) % contour.length, quad = [contour[i], contour[next], inner[next], inner[i]], normal = normals[i];
        const [startNormal, endNormal] = lighting[i];
        const constant = startNormal.every((v, j) => v === endNormal[j]);
        const rgb = constant ? shader(color, startNormal, front) : null;
        const gradient = constant ? null : shader.gradient(color, startNormal, endNormal, front);
        paintBevelFace(quad, normal, rgb, gradient, bevelWidth, target);
      }
    }
  }
  context.putImageData(image, 0, 0);
  const mask = new Path2D();
  for (const contour of polygons) {
    mask.moveTo(contour[0].x, contour[0].y);
    for (let i = 1; i < contour.length; i++) mask.lineTo(contour[i].x, contour[i].y);
    mask.closePath();
  }
  return { canvas, mask, left, top, width: width / resolution, height: height / resolution, pixels: width * height };
}

export function paintText3d(ctx, text, x, y, style) {
  if (style.textFill === 'none' || style.textOutline?.width || style.syntheticItalic) return false;
  const surface = text3dSurface(style), face = preparedText3dFont(style);
  if (!surface || !face) return false;
  const fill = style.textFill && style.textFill !== 'empty' ? '#' + style.textFill : style.textFill === 'empty' ? '#000000' : ctx.fillStyle;
  if (typeof fill !== 'string' || !/^#[\da-f]{6}$/i.test(fill)) return false;
  const color = fill.slice(1).match(/../g).map(c => parseInt(c, 16));
  const m = ctx.getTransform(), resolution = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
  if (!resolution) return false;
  if (!faceIds.has(face)) faceIds.set(face, ++nextId);
  const key = JSON.stringify([faceIds.get(face), text, style.fontSize, style.characterSpacing, style.justificationSpacing, style.kerning, style.ligatures, surface, color, resolution]);
  let entry = images.get(key);
  if (!entry) {
    ctx.save();
    try {
      const polygons = glyphPolygons(ctx, text, style, face, resolution);
      if (!polygons) return false;
      entry = raster(polygons, surface, color, resolution);
    } catch { return false; }
    finally { ctx.restore(); }
    if (!entry) return false;
    const limit = 8 * 1024 * 1024;
    if (entry.pixels <= limit) {
      while (cachedPixels + entry.pixels > limit && images.size) { const oldest = images.keys().next().value; cachedPixels -= images.get(oldest).pixels; images.delete(oldest); }
      images.set(key, entry); cachedPixels += entry.pixels;
    }
  }
  ctx.save(); ctx.translate(x, y); ctx.clip(entry.mask);
  ctx.drawImage(entry.canvas, entry.left, entry.top, entry.width, entry.height); ctx.restore();
  return true;
}
