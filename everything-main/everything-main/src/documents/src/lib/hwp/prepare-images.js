/** Prepare media for the editor while retaining editable placement and crop. */
import { check, HwpError, LIMITS } from './binary.js';
import { IMAGE_MIMES, imageResource, imageDimensions, imageFormat } from './image.js';
import { checkPixels } from './tiff.js';
import { tiffWorker } from './tiff-worker.js';
import { decodeBmp, encodePng } from './bitmap.js';

const timeoutMs = 15000;
function pictureRuns(model) {
  const result = [];
  function walk(blocks, depth = 0) {
    check(depth <= LIMITS.depth);
    for (const item of blocks || []) {
      if (item.kind === 'image') result.push(item);
      // Shape and cell background pictures go through the same media preparation as pictures in the text.
      if (item.pictureFill?.kind === 'image') result.push(item.pictureFill);
      if (item.runs) walk(item.runs, depth + 1);
      if (item.blocks) walk(item.blocks, depth + 1);
      if (item.children) walk(item.children, depth + 1);
      if (item.cells) for (const cell of item.cells) { if (cell.pictureFill?.kind === 'image') result.push(cell.pictureFill); walk(cell.blocks, depth + 1); }
      if (item.caption) walk(item.caption, depth + 1);
      if (item.comment) walk(item.comment.blocks, depth + 1);
    }
  }
  for (const section of model.sections) { walk(section.blocks); for (const part of [...(section.headers || []), ...(section.footers || [])]) walk(part.blocks); }
  return result;
}

function canvas(width, height) {
  checkPixels(width, height);
  const result = document.createElement('canvas'); result.width = width; result.height = height;
  check(result.getContext('2d'), 'Image conversion is unavailable in this browser.'); return result;
}
async function loadImage(blob) {
  const url = URL.createObjectURL(blob), img = new Image();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { img.src = ''; reject(new Error('Picture decoding timed out.')); }, timeoutMs);
      img.onload = () => { clearTimeout(timer); resolve(); };
      img.onerror = () => { clearTimeout(timer); reject(new Error('The picture data could not be decoded.')); };
      img.src = url;
    });
    checkPixels(img.naturalWidth, img.naturalHeight); return img;
  } finally { URL.revokeObjectURL(url); }
}

/** Pixel adjustments are baked once because the editor does not paint a:lum. */
export function adjustPixels(pixels, adjustments) {
  const clamp = (v, low, high) => Math.max(low, Math.min(high, v || 0));
  const brightness = clamp(adjustments.brightness, -100, 100) * 2.55, c = clamp(adjustments.contrast, -100, 100) / 100;
  const contrast = c >= 1 ? 10000 : (1 + c) / (1 - c), opacity = 1 - clamp(adjustments.transparency, 0, 1);
  for (let i = 0; i < pixels.length; i += 4) {
    let r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    if (adjustments.effect === 'GRAY_SCALE' || adjustments.effect === 'BLACK_WHITE') {
      r = g = b = 0.299 * r + 0.587 * g + 0.114 * b;
      if (adjustments.effect === 'BLACK_WHITE') r = g = b = r >= 128 ? 255 : 0;
    }
    pixels[i] = clamp(Math.round((r - 127.5) * contrast + 127.5 + brightness), 0, 255);
    pixels[i + 1] = clamp(Math.round((g - 127.5) * contrast + 127.5 + brightness), 0, 255);
    pixels[i + 2] = clamp(Math.round((b - 127.5) * contrast + 127.5 + brightness), 0, 255);
    pixels[i + 3] = Math.round(pixels[i + 3] * opacity);
  }
}

async function render(resource, run, warnings) {
  let result;
  if (resource.ext === 'tif') {
    const decoded = await tiffWorker(resource.bytes), { width, height, pixels, orientation } = decoded;
    const source = canvas(width, height); source.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), width, height), 0, 0);
    result = canvas(orientation >= 5 && orientation <= 8 ? height : width, orientation >= 5 && orientation <= 8 ? width : height);
    const ctx = result.getContext('2d');
    const transforms = { 2: [-1, 0, 0, 1, width, 0], 3: [-1, 0, 0, -1, width, height], 4: [1, 0, 0, -1, 0, height], 5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, height, 0], 7: [0, -1, -1, 0, height, width], 8: [0, -1, 1, 0, 0, width] };
    if (transforms[orientation]) ctx.setTransform(...transforms[orientation]);
    ctx.drawImage(source, 0, 0); source.width = source.height = 0;
    if (decoded.multiplePages) warnings.add('Only the first page of a multipage TIFF picture is displayed.');
  } else {
    let blob, width, height;
    if (resource.ext === 'emf' || resource.ext === 'wmf') {
      const dims = imageDimensions(run), scale = Math.min(2 / 75, 4096 / Math.max(dims.width, dims.height));
      width = Math.max(1, Math.round(dims.width * scale)); height = Math.max(1, Math.round(dims.height * scale));
      checkPixels(width, height);
      const { metafileSvg } = await import('./metafile.js'); blob = await metafileSvg(resource, width, height);
      warnings.add('WMF/EMF pictures are rendered as PNG for editing; advanced metafile drawing commands may differ.');
    } else {
      if (resource.dimensions) checkPixels(resource.dimensions.width, resource.dimensions.height);
      blob = new Blob([resource.bytes], { type: IMAGE_MIMES[resource.ext] });
    }
    const decoded = await loadImage(blob); result = canvas(width || decoded.naturalWidth, height || decoded.naturalHeight);
    result.getContext('2d').drawImage(decoded, 0, 0, result.width, result.height);
    if (resource.ext === 'webp' || resource.ext === 'gif') warnings.add('Converted animated pictures retain their first frame.');
  }
  return result;
}

/**
 * The editor lays out an inline shape as a block under its text (inline
 * pictures stay in the line). A text-free drawing treated as a character
 * inside a line of text is therefore rasterized to a picture of its own size,
 * so it keeps its place in the line. Drawings with text, anchored drawings and
 * drawings alone in their paragraph keep their editable shape form.
 */
const HWPUNIT_PER_PX = 37.5; // 192 px per inch
function textFree(run) {
  // Rasterizing paints the shape's base color and outline only: a picture fill or a shadow would be lost, so such a shape stays a shape.
  if (run.kind === 'shape') return !run.pictureFill && !run.shadow && !(run.blocks || []).some((p) => p.kind !== 'p' || (p.runs || []).some((r) => r.kind !== 'text' || r.text.trim()));
  if (run.kind === 'group') return run.children.every((child) => child.kind === 'shape' && textFree(child));
  return false;
}
function drawShape(ctx, run, scale, offsetX = 0, offsetY = 0) {
  const w = run.width * scale, h = run.height * scale, x = (run.x || 0) * scale + offsetX, y = (run.y || 0) * scale + offsetY;
  if (!(w >= 0 && h >= 0) || (!w && !h)) return;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (run.rotation) ctx.rotate(run.rotation * Math.PI / 180);
  ctx.scale(run.flipH ? -1 : 1, run.flipV ? -1 : 1);
  ctx.translate(-w / 2, -h / 2);
  const path = new Path2D();
  const sx = run.coordWidth > 0 ? w / run.coordWidth : 1, sy = run.coordHeight > 0 ? h / run.coordHeight : 1;
  let closed = true;
  switch (run.shape) {
    case 'ellipse': path.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); break;
    case 'roundRect': { const r = Math.min(w, h) / 2 * Math.max(0, Math.min(100, run.roundness ?? 33)) / 100; path.roundRect(0, 0, w, h, r); break; }
    case 'line': path.moveTo(0, 0); path.lineTo(w, h); closed = false; break;
    case 'polygon': (run.points || []).forEach((p, i) => path[i ? 'lineTo' : 'moveTo'](p.x * sx, p.y * sy)); path.closePath(); break;
    case 'custom':
      closed = (run.path || []).some((c) => c.kind === 'close');
      for (const c of run.path || []) {
        if (c.kind === 'move') path.moveTo(c.x * sx, c.y * sy); else if (c.kind === 'line') path.lineTo(c.x * sx, c.y * sy);
        else if (c.kind === 'cubic') path.bezierCurveTo(c.x1 * sx, c.y1 * sy, c.x2 * sx, c.y2 * sy, c.x * sx, c.y * sy); else path.closePath();
      }
      break;
    default: path.rect(0, 0, w, h);
  }
  const color = (c, alpha = 1) => `rgba(${parseInt(c.slice(0, 2), 16)},${parseInt(c.slice(2, 4), 16)},${parseInt(c.slice(4, 6), 16)},${alpha})`;
  if (closed && (run.fill || run.gradient?.colors?.length > 1)) {
    if (run.gradient?.colors?.length > 1) {
      const angle = ((run.gradient.angle || 0) % 360) * Math.PI / 180, g = ctx.createLinearGradient(w / 2 - Math.cos(angle) * w / 2, h / 2 - Math.sin(angle) * h / 2, w / 2 + Math.cos(angle) * w / 2, h / 2 + Math.sin(angle) * h / 2);
      run.gradient.colors.forEach((c, i, all) => g.addColorStop(i / (all.length - 1), color(c)));
      ctx.fillStyle = g;
    } else ctx.fillStyle = color(run.fill, run.fillAlpha ?? 1);
    ctx.fill(path);
  }
  const line = run.line || {};
  if (line.style !== 'NONE' && (line.width ?? 33) >= 0) {
    ctx.lineWidth = Math.max(1, (line.width || 33) * scale);
    ctx.strokeStyle = color(line.color || '000000');
    ctx.lineCap = line.cap === 'ROUND' ? 'round' : 'butt';
    const unit = ctx.lineWidth;
    ctx.setLineDash(({ DASH: [3 * unit, unit], DOT: [unit, unit], DASH_DOT: [3 * unit, unit, unit, unit], DASH_DOT_DOT: [3 * unit, unit, unit, unit, unit, unit], LONG_DASH: [6 * unit, unit] })[line.style] || []);
    ctx.stroke(path);
  }
  ctx.restore();
}
export function rasterizeDrawing(run) {
  const scale = Math.min(1 / HWPUNIT_PER_PX, 2048 / Math.max(run.width, run.height, 1));
  const width = Math.max(1, Math.round(run.width * scale)), height = Math.max(1, Math.round(run.height * scale));
  const bitmap = canvas(width, height), ctx = bitmap.getContext('2d');
  if (run.kind === 'group') for (const child of run.children) drawShape(ctx, child, scale);
  else drawShape(ctx, run, scale);
  const pixels = ctx.getImageData(0, 0, width, height).data; bitmap.width = bitmap.height = 0;
  return imageResource(encodePng({ pixels, width, height }), 'png');
}
export function flattenInlineDrawings(model, rasterize = rasterizeDrawing) {
  let changed = false;
  function visit(blocks, depth = 0) {
    check(depth <= LIMITS.depth);
    for (const item of blocks || []) {
      if (item.kind === 'p' && item.runs) {
        const hasText = item.runs.some((r) => r.kind === 'text' && r.text.trim());
        if (hasText) item.runs.forEach((run, i) => {
          if (['shape', 'group'].includes(run.kind) && !run.layout && run.width > 0 && run.height > 0 && textFree(run)) {
            try { item.runs[i] = { kind: 'image', image: rasterize(run), width: run.width, height: run.height, alt: run.alt || 'Drawing', effects: {}, adjustments: {} }; changed = true; }
            catch { /* the shape stays a shape */ }
          }
        });
        for (const run of item.runs) { if (run.blocks) visit(run.blocks, depth + 1); if (run.cells) for (const cell of run.cells) visit(cell.blocks, depth + 1); if (run.caption) visit(run.caption, depth + 1); }
      }
      if (item.kind === 'table') for (const cell of item.cells) visit(cell.blocks, depth + 1);
    }
  }
  for (const section of model.sections) { visit(section.blocks); for (const part of [...(section.headers || []), ...(section.footers || [])]) visit(part.blocks); }
  if (changed) model.warnings.add('Drawings treated as characters inside text are converted to pictures so they keep their place in the line.');
  return changed;
}

/** How long all of a document's pictures together may take to convert; each one already has its own 15 s deadline. */
export const IMAGE_CONVERSION_BUDGET_MS = 120000;

/** "A PNG", "An EMF", "A TIFF": the format as the user knows it. */
const pictureLabel = (ext) => { const name = { tif: 'TIFF', jpg: 'JPEG' }[String(ext || '').toLowerCase()] || String(ext || '').toUpperCase(); return `${/^[AEIOU]/.test(name) ? 'An' : 'A'} ${name}`; };
/** A conversion note carries the reason only when it is one the reader wrote for the user, not a codec's internals. */
const reason = (error) => (error instanceof HwpError ? `: ${error.message}` : '.');

export async function prepareHanwordImages(model, { now = () => performance.now(), budgetMs = IMAGE_CONVERSION_BUDGET_MS } = {}) {
  if (typeof document !== 'undefined' && typeof Path2D !== 'undefined') flattenInlineDrawings(model);
  const runs = pictureRuns(model), cache = new Map(), largest = new Map(); let outputBytes = 0, decodedPixels = 0;
  const deadline = now() + budgetMs;
  // A logo reused in a small header and a large body picture should use one
  // raster with enough resolution for the largest occurrence.
  for (const run of runs) {
    const size = imageDimensions(run), prior = largest.get(run.image);
    if (!prior || Math.max(size.width, size.height) > Math.max(prior.width, prior.height)) largest.set(run.image, size);
  }
  for (const run of runs) {
    const original = run.image, resource = imageResource(original.bytes, original.ext), a = run.adjustments || {};
    if (!imageFormat(resource.bytes)) { model.warnings.add(`${pictureLabel(resource.ext)} picture has unrecognized or damaged image data.`); missing(run); continue; }
    const adjusted = a.brightness || a.contrast || a.transparency || ['GRAY_SCALE', 'BLACK_WHITE'].includes(a.effect);
    const convert = adjusted || ['bmp', 'webp', 'tif', 'wmf', 'emf'].includes(resource.ext);
    if (!convert) {
      // The editor decodes this picture as it is; a header declaring a
      // million pixels a side must not reach it.
      try { if (resource.dimensions) checkPixels(Math.ceil(resource.dimensions.width), Math.ceil(resource.dimensions.height)); }
      catch (error) { model.warnings.add(`${pictureLabel(resource.ext)} picture could not be imported${reason(error)}`); missing(run); continue; }
      Object.assign(original, resource); continue;
    }
    if (!cache.has(original)) cache.set(original, new Map());
    const variants = cache.get(original), key = JSON.stringify([a.brightness || 0, a.contrast || 0, a.transparency || 0, a.effect || 'REAL_PIC']);
    if (variants.has(key)) {
      const image = variants.get(key); if (image) { run.image = image; delete run.adjustments; } else missing(run);
      continue;
    }
    // Thousands of slow pictures would otherwise hold the editor in "converting" for hours, one deadline at a time.
    if (now() > deadline) { model.warnings.add('Converting the pictures took too long; the remaining ones were left out.'); variants.set(key, null); missing(run); continue; }
    let bitmap;
    try {
      if (resource.dimensions && !['emf', 'wmf'].includes(resource.ext)) {
        checkPixels(Math.ceil(resource.dimensions.width), Math.ceil(resource.dimensions.height));
        check(decodedPixels + resource.dimensions.width * resource.dimensions.height <= 64 * 1024 * 1024, 'The document exceeds the 64 megapixel picture conversion budget.');
      }
      let decoded;
      if (resource.ext === 'bmp') decoded = decodeBmp(resource.bytes);
      else { bitmap = await render(resource, { ...run, ...largest.get(original) }, model.warnings); const ctx = bitmap.getContext('2d'); decoded = { pixels: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data, width: bitmap.width, height: bitmap.height }; }
      decodedPixels += decoded.width * decoded.height;
      check(decodedPixels <= 64 * 1024 * 1024, 'The document exceeds the 64 megapixel picture conversion budget.');
      if (adjusted) {
        adjustPixels(decoded.pixels, a);
        model.warnings.add('Picture color adjustments and transparency are applied to the imported pixels; their appearance can differ slightly from Hanword.');
      }
      const bytes = encodePng(decoded);
      outputBytes += bytes.length; check(outputBytes <= LIMITS.expanded, 'Converted pictures exceed the 96 MB output limit.');
      const image = imageResource(bytes, 'png'); variants.set(key, image); run.image = image; delete run.adjustments;
    } catch (error) {
      model.warnings.add(`${pictureLabel(resource.ext)} picture could not be converted${reason(error)}`); variants.set(key, null); missing(run);
    } finally { if (bitmap) bitmap.width = bitmap.height = 0; }
  }
  function missing(run) { run.kind = 'text'; run.text = `[Picture unavailable${run.alt ? ': ' + run.alt : ''}]`; delete run.image; }
}
