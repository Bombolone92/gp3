/** HWP drawing transforms use row-major 2×3 affine matrices. */
import { check } from './binary.js';

const identity = [1, 0, 0, 0, 1, 0];
const multiply = (a, b) => [
  a[0] * b[0] + a[1] * b[3], a[0] * b[1] + a[1] * b[4], a[0] * b[2] + a[1] * b[5] + a[2],
  a[3] * b[0] + a[4] * b[3], a[3] * b[1] + a[4] * b[4], a[3] * b[2] + a[4] * b[5] + a[5],
];

export function composeDrawingMatrices(matrices) {
  let result = identity;
  for (const matrix of matrices) {
    check(matrix.length === 6 && matrix.every(Number.isFinite), 'A Hanword drawing has an invalid transform.');
    result = multiply(result, matrix);
  }
  check(result.every(Number.isFinite), 'A Hanword drawing has an invalid transform.');
  return result;
}

export function drawingMatrix(reader, count) {
  check((1 + count * 2) * 48 <= reader.remaining);
  return composeDrawingMatrices(Array.from({ length: 1 + count * 2 }, () =>
    Array.from({ length: 6 }, () => reader.view.getFloat64(reader.take(8), true))));
}

// A component's matrix sequence already includes its ancestor group transforms.
// Applying the container matrices again would scale and translate it twice.
export function groupPlacement(matrix, width, height, warnings) {
  const [a, c, e, b, d, f] = matrix, sx = Math.hypot(a, b), sy = Math.hypot(c, d);
  // A connector or line scaled to zero width (or height) is still a drawing: a vertical or horizontal line.
  check(sx >= 0 && sy >= 0 && (sx > 0 || sy > 0) && width >= 0 && height >= 0 && (width > 0 || height > 0), 'A Hanword drawing has an invalid size.');
  if (Math.abs(a * c + b * d) > sx * sy * 1e-6) warnings.add('Skewed drawing transforms are approximated.');
  const w = width * sx, h = height * sy;
  const x = a * width / 2 + c * height / 2 + e - w / 2, y = b * width / 2 + d * height / 2 + f - h / 2;
  // A matrix with astronomically large entries places nothing; the writer
  // would otherwise be handed Infinity or NaN for a coordinate.
  check([x, y, w, h].every(Number.isFinite) && (w > 0 || h > 0), 'A Hanword drawing has an invalid size.');
  const rotation = sx > 0 ? Math.atan2(b, a) : Math.atan2(-c, d);
  return { x, y, width: w, height: h, rotation: rotation * 180 / Math.PI, flipH: false, flipV: a * d - b * c < 0 };
}

/**
 * A Hanword arc is the quarter of an ellipse between two conjugate semi-axis
 * endpoints, ax1 and ax2, measured from the ellipse center. One cubic Bézier
 * traces a quarter ellipse to within 0.03% and survives any affine frame.
 */
export function arcPath(type, center, ax1, ax2) {
  const u = { x: ax1.x - center.x, y: ax1.y - center.y }, v = { x: ax2.x - center.x, y: ax2.y - center.y };
  check([center, ax1, ax2].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) && (u.x || u.y) && (v.x || v.y), 'A Hanword arc has an invalid geometry.');
  const k = 0.5522847498, path = [];
  if (type === 'PIE') path.push({ kind: 'move', x: center.x, y: center.y }, { kind: 'line', x: ax1.x, y: ax1.y });
  else path.push({ kind: 'move', x: ax1.x, y: ax1.y });
  path.push({ kind: 'cubic', x1: ax1.x + k * v.x, y1: ax1.y + k * v.y, x2: ax2.x + k * u.x, y2: ax2.y + k * u.y, x: ax2.x, y: ax2.y });
  if (type === 'PIE' || type === 'CHORD') path.push({ kind: 'close' });
  return path;
}

/**
 * A Hanword curve passes through its points; curve segments are smoothed
 * through their neighbors (a Catmull-Rom spline as cubic Béziers) and line
 * segments stay straight. A curve that returns to its first point is closed.
 */
export function curvePath(points, types = []) {
  check(points.length >= 2 && points.length <= 10000 && points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), 'A Hanword curve has an invalid geometry.');
  const closed = points.length > 2 && points[0].x === points.at(-1).x && points[0].y === points.at(-1).y;
  const distinct = closed ? points.length - 1 : points.length;
  const at = (i) => closed ? points[((i % distinct) + distinct) % distinct] : points[Math.max(0, Math.min(points.length - 1, i))];
  const path = [{ kind: 'move', x: points[0].x, y: points[0].y }];
  for (let i = 0; i + 1 < points.length; i++) {
    const p0 = at(i - 1), p1 = points[i], p2 = points[i + 1], p3 = at(i + 2);
    if (types[i] === 'LINE') { path.push({ kind: 'line', x: p2.x, y: p2.y }); continue; }
    path.push({ kind: 'cubic', x1: p1.x + (p2.x - p0.x) / 6, y1: p1.y + (p2.y - p0.y) / 6, x2: p2.x - (p3.x - p1.x) / 6, y2: p2.y - (p3.y - p1.y) / 6, x: p2.x, y: p2.y });
  }
  if (closed) path.push({ kind: 'close' });
  return { path, closed };
}

/** Text art lines: Hanword separates them with the CR/LF symbol characters. */
export const textArtLines = (text) => String(text || '').split(/␍␊|[␍␊]|\r\n|[\r\n]/).slice(0, 100);

/**
 * Hanword stretches each text-art line over the whole box. Without warping,
 * the nearest plain text is the largest size whose line still fits the box
 * width (CJK glyphs about one em, Latin about half) and whose lines share
 * the box height. Sizes are in Hanword's hundredths of a point.
 */
export function textArtSize(line, lines, width, height, lineSpacing = 120) {
  const spacing = Math.max(50, lineSpacing || 120) / 100;
  const ems = [...line].reduce((sum, c) => sum + (/\s/.test(c) ? 0.3 : /[ᄀ-ᇿ　-鿿가-퟿豈-﫿＀-￯]/.test(c) ? 1 : 0.55), 0);
  const byHeight = height / Math.max(1, lines) / spacing, byWidth = ems > 0 ? width / ems : byHeight;
  return Math.max(400, Math.min(400000, Math.round(Math.min(byHeight, byWidth))));
}

export const arrowSizes = ['SMALL_SMALL', 'SMALL_MEDIUM', 'SMALL_LARGE', 'MEDIUM_SMALL', 'MEDIUM_MEDIUM', 'MEDIUM_LARGE', 'LARGE_SMALL', 'LARGE_MEDIUM', 'LARGE_LARGE'];

/** HWP 5 table 87: the binary enum differs from the HWPX arrow enum. */
export function binaryLine(color, width, flags) {
  const styles = ['NORMAL', 'ARROW', 'CONCAVE_ARROW', 'EMPTY_DIAMOND', 'EMPTY_CIRCLE', 'EMPTY_BOX', 'DIAMOND', 'CIRCLE', 'BOX'];
  return { color, width, style: ['NONE', 'SOLID', 'DASH', 'DOT', 'DASH_DOT', 'DASH_DOT_DOT', 'LONG_DASH'][flags & 63] || 'SOLID',
    cap: (flags >>> 6 & 15) === 0 ? 'ROUND' : 'FLAT',
    head: styles[flags >>> 10 & 63], tail: styles[flags >>> 16 & 63],
    headSize: arrowSizes[flags >>> 22 & 15], tailSize: arrowSizes[flags >>> 26 & 15],
    headFill: !!(flags & 0x40000000), tailFill: !!(flags & 0x80000000) };
}

export function polygonPoints(reader) {
  // Modern files have a DWORD count and interleaved (x,y) pairs. Older files
  // use a WORD count. Distinguish by record length, including the optional tail.
  const length = reader.remaining, count = reader.u16();
  if (length >= 4 + count * 8 && (length - 4 - count * 8) % 4 === 0) {
    check(reader.u16() === 0, 'A Hanword polygon has too many points.');
  }
  check(count > 0 && count * 8 <= reader.remaining, 'A Hanword polygon has incomplete coordinates.');
  return Array.from({ length: count }, () => ({ x: reader.i32(), y: reader.i32() }));
}
