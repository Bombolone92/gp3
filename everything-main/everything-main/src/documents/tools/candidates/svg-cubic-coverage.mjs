// Unreleased coverage candidate: the preview-performance gate has NOT passed.
// Kept outside the renderer; tests opt in explicitly. Native arithmetic also
// remains inexact on three larger native reference controls.
// Original finite-difference implementation; no native API or fixture lookup.
const NS = 'http://www.w3.org/2000/svg';
const SCALE = 262144;
const snap = value => Math.ceil(Math.fround(value) * 16) / 16;
const half = value => Math.floor(value / 2);

export function flattenMaskCubic(input) {
  if (input.length !== 4 || input.some(point => point.length !== 2 || point.some(value => !Number.isFinite(value) || Math.abs(value) > 1e7))) return null;
  const p = input.map(point => point.map(value => snap(value) * SCALE));
  let position = [...p[0]], delta = p[3].map((v, k) => v - p[0][k]);
  let e2 = p[0].map((v, k) => 3 * (v - 2 * p[1][k] + p[2][k]));
  let e3 = p[1].map((v, k) => 3 * (v - 2 * p[2][k] + p[3][k]));
  let t = 0, step = 1;
  const result = [position.map(v => v / SCALE)];
  const error = (a, b) => Math.max(...a.map(Math.abs), ...b.map(Math.abs));
  const threshold = 196608;
  while (t < 1) {
    while (error(e2, e3) > threshold) {
      e3 = e2.map((v, k) => Math.floor((v + e3[k]) / 8));
      delta = delta.map((v, k) => half(v) - e3[k]);
      e2 = e2.map(v => Math.floor(v / 4));
      step /= 2;
      if (step < 1 / 65536) return null;
    }
    while (step < 1 && t % (2 * step) === 0 && t + 2 * step <= 1) {
      const next2 = e2.map(v => 4 * v), next3 = e3.map((v, k) => 8 * v - 4 * e2[k]);
      if (error(next2, next3) > threshold) break;
      delta = delta.map((v, k) => 2 * v + 2 * e3[k]);
      e2 = next2; e3 = next3; step *= 2;
    }
    position = position.map((v, k) => v + delta[k]);
    delta = delta.map((v, k) => v + 2 * e3[k]);
    [e2, e3] = [e3, e3.map((v, k) => 2 * v - e2[k])];
    t += step;
    result.push(position.map(v => Math.floor(v / 16384 + .5) / 16));
    if (result.length > 4096) return null;
  }
  return result;
}

// Keep unsupported grammar on the existing vector path. This first subset
// accepts explicit absolute M/L/C/Z commands, including multiple subpaths.
export function maskedCubicContours(d, matrix) {
  const token = /[MLCZ]|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g;
  if (d.replace(token, '').replace(/[\s,]/g, '') || !d.includes('C')) return null;
  const tokens = d.match(token) || [];
  if (tokens.length > 16384) return null;
  const contours = [];
  let at = 0, current = null, contour = null, start = null;
  const transform = (x, y) => [matrix.a * x + matrix.e, matrix.d * y + matrix.f];
  while (at < tokens.length) {
    const command = tokens[at++], count = {M: 2, L: 2, C: 6, Z: 0}[command];
    if (count === undefined || at + count > tokens.length || command !== 'M' && !current) return null;
    const values = tokens.slice(at, at + count).map(Number); at += count;
    if (!values.every(Number.isFinite)) return null;
    if (command === 'M') {
      current = transform(...values); start = current;
      contour = [current.map(snap)]; contours.push(contour);
    } else if (command === 'L') {
      current = transform(...values); contour.push(current.map(snap));
    } else if (command === 'C') {
      const end = transform(values[4], values[5]);
      const points = flattenMaskCubic([current, transform(values[0], values[1]), transform(values[2], values[3]), end]);
      if (!points) return null;
      contour.push(...points.slice(1)); current = end;
    } else {
      // Leave uncommon continuation after a close command on the vector path.
      current = null;
    }
    if (contours.reduce((sum, points) => sum + points.length, 0) > 4096) return null;
  }
  return contours;
}

export function cubicCoveragePixels(contours, box, color, rule = 'nonzero') {
  const {x: originX, y: originY, width, height} = box;
  const counts = new Uint8Array(width * height);
  const edges = contours.flatMap(points => points.map((a, n) => [a, points[(n + 1) % points.length]]));
  for (let row = 0; row < height; row++) for (let sy = 0; sy < 4; sy++) {
    const y = originY + row + sy / 4, events = [];
    for (const [a, b] of edges) {
      if (a[1] <= y && y < b[1]) events.push([a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]), 1]);
      else if (b[1] <= y && y < a[1]) events.push([a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]), -1]);
    }
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let winding = 0, start;
    for (const [x, change] of events) {
      const before = rule === 'evenodd' ? Math.abs(winding) % 2 : winding !== 0;
      winding += change;
      const after = rule === 'evenodd' ? Math.abs(winding) % 2 : winding !== 0;
      if (!before && after) start = x;
      else if (before && !after) {
        const left = Math.max(0, Math.ceil((start - originX) * 8));
        const right = Math.min(width * 8, Math.ceil((x - originX) * 8));
        if (right <= left) continue;
        const first = Math.floor(left / 8), last = Math.floor((right - 1) / 8), offset = row * width;
        if (first === last) counts[offset + first] += right - left;
        else {
          counts[offset + first] += 8 - left % 8;
          counts[offset + last] += (right - 1) % 8 + 1;
          for (let column = first + 1; column < last; column++) counts[offset + column] += 8;
        }
      }
    }
  }
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let n = 0; n < counts.length; n++) {
    const count = counts[n], alpha = Math.round(count * 255 / 32);
    if (!alpha) continue;
    const inverse = Math.floor(255 * 65536 / alpha);
    for (let k = 0; k < 3; k++) pixels[n * 4 + k] = Math.floor(Math.round(color[k] * count / 32) * inverse / 65536);
    pixels[n * 4 + 3] = alpha;
  }
  return pixels;
}

export function nativeSvgMaskedCubics(root) {
  const masks = new Map([...root.querySelectorAll('mask')].map(mask => [mask.id, mask]));
  if (!masks.size) return;
  let budget = 0, work = 0;
  for (const path of root.querySelectorAll('path')) {
    if (!(path.getAttribute('d') || '').includes('C') || path.closest('defs,mask,clipPath,filter')) continue;
    const style = getComputedStyle(path), matrix = path.getCTM();
    // Native controls establish intrinsic coordinates and integer translation.
    // Other affine mappings retain the vector path until independently checked.
    if (!matrix || matrix.b || matrix.c || matrix.a !== 1 || matrix.d !== 1 || !Number.isInteger(matrix.e) || !Number.isInteger(matrix.f) || style.stroke !== 'none'
      || style.filter !== 'none' || style.clipPath !== 'none' || style.display === 'none' || style.visibility !== 'visible'
      || Number(style.opacity) !== 1 || Number(style.fillOpacity) !== 1) continue;
    const color = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(style.fill)?.slice(1).map(Number);
    if (!color) continue;
    let masked = false, clipped = false, ownMask = 'none';
    for (let ancestor = path; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
      const s = getComputedStyle(ancestor);
      clipped ||= s.clipPath !== 'none' || s.filter !== 'none' || Number(s.opacity) !== 1;
      if (s.maskImage !== 'none') {
        const id = /#([\w.:-]+)["']?\s*\)$/.exec(s.maskImage)?.[1];
        const mask = masks.get(id);
        if (!mask || mask.getAttribute('maskUnits') !== 'userSpaceOnUse' || mask.getAttribute('maskContentUnits') === 'objectBoundingBox') { clipped = true; break; }
        masked = true;
        if (ancestor === path) ownMask = `url(#${id})`;
      }
    }
    if (!masked || clipped) continue;
    const b = path.getBBox();
    const x = Math.floor(matrix.a * b.x + matrix.e) - 1, y = Math.floor(matrix.d * b.y + matrix.f) - 1;
    const width = Math.ceil(matrix.a * (b.x + b.width) + matrix.e) - x + 1;
    const height = Math.ceil(matrix.d * (b.y + b.height) + matrix.f) - y + 1;
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || width > 8192 || height > 8192
      || width * height > 524288 || budget + width * height > 2097152) continue;
    const contours = maskedCubicContours(path.getAttribute('d') || '', matrix);
    if (!contours) continue;
    const cost = height * contours.reduce((sum, points) => sum + points.length, 0) * 4;
    if (work + cost > 8000000) continue;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'), pixels = cubicCoveragePixels(contours, {x, y, width, height}, color, style.fillRule);
    ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
    const image = document.createElementNS(NS, 'image'), wrapper = document.createElementNS(NS, 'g');
    if (path.id) wrapper.id = path.id;
    image.setAttribute('href', canvas.toDataURL()); image.setAttribute('preserveAspectRatio', 'none');
    image.setAttribute('x', String(x)); image.setAttribute('y', String(y));
    image.setAttribute('width', String(width)); image.setAttribute('height', String(height));
    // Keep the mask in the original path coordinate system. Its inner bitmap
    // cancels the full transform because coverage was sampled in intrinsic pixels.
    const own = path.parentElement.getCTM().inverse().multiply(matrix), cancel = matrix.inverse();
    wrapper.style.cssText = `all:initial;transform:matrix(${own.a},${own.b},${own.c},${own.d},${own.e},${own.f});transform-origin:0 0;mask:${ownMask}`;
    image.style.cssText = `all:initial;x:${x}px;y:${y}px;width:${width}px;height:${height}px;transform:matrix(${cancel.a},${cancel.b},${cancel.c},${cancel.d},${cancel.e},${cancel.f});transform-origin:0 0`;
    wrapper.append(image); path.replaceWith(wrapper); budget += width * height; work += cost; canvas.width = canvas.height = 0;
  }
}
