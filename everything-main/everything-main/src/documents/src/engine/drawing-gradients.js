import { UnsupportedDocumentError } from './errors.js';
import { drawingPaintColor } from './docx-drawing-style.js';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const fail = why => { throw new UnsupportedDocumentError(`DrawingML gradient ${why}`); };
function attributes(node, allowed) {
  for (const a of node.attributes) if (a.namespaceURI !== 'http://www.w3.org/2000/xmlns/' && (a.namespaceURI || !allowed.includes(a.name))) fail('attributes');
}
function boolean(node, name, fallback) {
  if (!node.hasAttribute(name)) return fallback;
  const value = node.getAttribute(name);
  if (!['0', '1', 'true', 'false'].includes(value)) fail(`invalid ${name}`);
  return value === '1' || value === 'true';
}
export function readLinearGradient(node, readSchemeColor) {
  attributes(node, ['flip', 'rotWithShape']);
  if (node.hasAttribute('flip') && !['none', 'x', 'y', 'xy'].includes(node.getAttribute('flip'))) fail('invalid flip');
  if (!boolean(node, 'rotWithShape', true)) fail('fixed page orientation');
  const children = [...node.children];
  if (children.some(n => n.namespaceURI !== A || !['gsLst', 'lin', 'path', 'tileRect'].includes(n.localName))) fail('unsupported shading style');
  const find = name => {
    const found = children.filter(n => n.localName === name);
    if (found.length > 1) fail('duplicate properties');
    return found[0];
  };
  const list = find('gsLst'), linear = find('lin'), tile = find('tileRect'), path = find('path');
  if (!list || (!linear && !path) || (linear && path)) fail('missing or conflicting shading properties');
  attributes(list, []);
  if (linear) {
    attributes(linear, ['ang', 'scaled']);
    if (linear.children.length) fail('linear children');
  }
  let focus;
  if (path) {
    attributes(path, ['path']);
    if (path.getAttribute('path') !== 'circle') fail('unsupported path');
    if (path.children.length > 1) fail('path children');
    const rect = path.children[0];
    if (rect) {
      if (rect.namespaceURI !== A || rect.localName !== 'fillToRect' || rect.children.length) fail('path rectangle');
      attributes(rect, ['l', 't', 'r', 'b']);
      focus = ['l', 't', 'r', 'b'].map(name => {
        const value = rect.getAttribute(name) ?? '0';
        if (!/^[+-]?(?:\d+|\d+(?:\.\d+)?%)$/.test(value)) fail('invalid focus rectangle');
        const n = value.endsWith('%') ? parseFloat(value) / 100 : +value / 100000;
        if (!Number.isFinite(n)) fail('invalid focus rectangle');
        return n;
      });
    }
  }
  if (tile) {
    attributes(tile, ['l', 't', 'r', 'b']);
    if (tile.children.length || [...tile.attributes].some(a => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/' && !/^[+]?0(?:\.0+)?%?$/.test(a.value))) fail('nonempty tile rectangle');
  }
  const raw = linear?.getAttribute('ang') ?? '0';
  if (!/^\d+$/.test(raw) || +raw >= 21600000) fail('invalid angle');
  const stops = [...list.children].map(stop => {
    if (stop.namespaceURI !== A || stop.localName !== 'gs') fail('invalid stop');
    attributes(stop, ['pos']);
    const value = stop.getAttribute('pos');
    if (!value || !/^(?:\d+|\d+(?:\.\d+)?%)$/.test(value)) fail('invalid stop position');
    const position = value.endsWith('%') ? parseFloat(value) / 100 : +value / 100000;
    if (position < 0 || position > 1 || stop.children.length !== 1) fail('invalid stop');
    return { position, color: drawingPaintColor(stop.children[0], readSchemeColor) };
  });
  if (stops.length < 2 || stops.length > 256) fail('stop count');
  // Positions define the color band; XML order need not be ascending. Stable
  // sorting retains equal-position transitions without changing source XML.
  if (stops.some((stop, i) => i && stop.position < stops[i-1].position)) stops.sort((a, b) => a.position - b.position);
  if (path) return { type: 'circularGradient', focus, stops };
  return { type: 'linearGradient', angle: +raw / 60000, scaled: boolean(linear, 'scaled', false), stops };
}

export function linearGradientAxis(width, height, angle, scaled) {
  const radians = angle * Math.PI / 180;
  let x = Math.cos(radians), y = Math.sin(radians);
  // Native reference axial shadings use inverse dimensions for scaled gradients,
  // unlike the multiplication formula in ECMA-376 Part 1 §20.1.8.41.
  if (scaled) { x /= width; y /= height; }
  const norm = Math.hypot(x, y); x /= norm; y /= norm;
  const half = (Math.abs(width*x) + Math.abs(height*y)) / 2;
  return [width/2-x*half, height/2-y*half, width/2+x*half, height/2+y*half];
}

// Opaque two-endpoint gradients use a normalized Gaussian transition
// over [-2, 2] and a 2.2 RGB gamma. Other stop lists use linear interpolation.
// Integrate exp(-x*x) with its convergent Taylor series on [-sqrt(2),sqrt(2)].
function gaussianIntegral(x) {
  let term = x, sum = x;
  for (let n = 1; n < 20; n++) { term *= -x * x / n; sum += term / (2 * n + 1); }
  return sum;
}
const gaussianLimit = gaussianIntegral(Math.SQRT2);
const twoStopWeights = Array.from({ length: 256 }, (_, i) => i === 0 ? 0 : i === 255 ? 1
  : .5 + gaussianIntegral(Math.SQRT2 * (2 * i / 255 - 1)) / (2 * gaussianLimit));
const nativeStopCache = new WeakMap();
function paintStops(fill) {
  const stops = fill.stops;
  if (stops.length !== 2 || stops[0].position !== 0 || stops[1].position !== 1 ||
      stops.some(stop => !/^#[\da-f]{6}$/i.test(stop.color))) return stops;
  let result = nativeStopCache.get(fill);
  if (!result) {
    const colors = stops.map(stop => stop.color.slice(1).match(/../g).map(c => (parseInt(c, 16) / 255) ** 2.2));
    result = twoStopWeights.map((weight, i) => ({ position: i / 255,
      color: `rgb(${colors[0].map((start, channel) => 255 * (start * (1 - weight) + colors[1][channel] * weight) ** (1 / 2.2)).join(',')})` }));
    nativeStopCache.set(fill, result);
  }
  return result;
}

export function canvasLinearGradient(ctx, fill, width, height) {
  // Flat geometry has no fill area; avoid division by zero in scaled axes.
  if (width <= 0 || height <= 0) return 'rgba(0,0,0,0)';
  const paint = ctx.createLinearGradient(...linearGradientAxis(width, height, fill.angle, fill.scaled));
  addGradientStops(paint, fill);
  return paint;
}

function addGradientStops(paint, fill) {
  // The first stop at a repeated positive position is retained, but the last
  // at zero. Canvas instead paints a hard transition between duplicate stops.
  // Keep the parsed/source list intact; resolve this only for painting.
  const stops = paintStops(fill);
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    if (stop.position === 0 ? stops[i + 1]?.position === 0 : stops[i - 1]?.position === stop.position) continue;
    paint.addColorStop(stop.position, stop.color);
  }
  // The original final color extends to the endpoint even when a tie
  // at a positive interior position selected an earlier stop for that point.
  const last = stops[stops.length - 1];
  if (last.position < 1) paint.addColorStop(1, last.color);
}

// Circular path shading is centered and fillToRect is ignored (ECMA-376
// 20.1.8.31). Native reference controls bind this compatibility behavior.
export function canvasCircularGradient(ctx, fill, width, height) {
  if (width <= 0 || height <= 0) return 'rgba(0,0,0,0)';
  const paint = ctx.createRadialGradient(width / 2, height / 2, 0,
    width / 2, height / 2, Math.hypot(width, height) / 2);
  addGradientStops(paint, fill);
  return paint;
}
