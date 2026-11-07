// Layered SVG export: shapes with a solid fill become paths, plain text layers
// become <text>, everything else is embedded as a cropped PNG per layer.
import type { Editor } from '../../editor';
import type { Layer, PhotoDocument } from '../../model/document';
import { hasMask } from '../../model/masks';
import { transformedVectorMask, vectorComponents } from '../../model/vector';
import { vectorDisplayHex } from '../../color/vector';
import { isVectorGradient } from '../../model/vector-gradient';
import { isVectorPattern } from '../../model/vector-pattern';
import { buildSvg, type SvgLayer } from '../../imaging/codecs/svg';
import { convertToSrgb, documentProfile } from './color';
import { outputSize, type ExportSettings, type SourceImage } from './encode';
import { encodePng, rgba16To8 } from './png';
import { documentSource } from './pipeline';

const plain = (l: Layer) =>
  !hasMask(l) && !l.maskGrid && !l.style && !Object.values(l.filters).some(Boolean) && (l.fillOpacity ?? 1) === 1;

/** SVG path data from PSD-style cubic knots (incoming, anchor, outgoing). */
export function knotsToPath(paths: { open: boolean; knots: { points: number[] }[] }[]): string {
  const n = (v: number) => String(Math.round(v * 1000) / 1000);
  let d = '';
  for (const p of paths) {
    const k = p.knots;
    if (!k.length) continue;
    d += `M${n(k[0].points[2])} ${n(k[0].points[3])}`;
    const count = p.open ? k.length - 1 : k.length;
    for (let i = 0; i < count; i++) {
      const a = k[i].points,
        b = k[(i + 1) % k.length].points;
      d += `C${n(a[4])} ${n(a[5])} ${n(b[0])} ${n(b[1])} ${n(b[2])} ${n(b[3])}`;
    }
    if (!p.open) d += 'Z';
  }
  return d;
}

function vectorPath(l: Layer, doc: PhotoDocument): SvgLayer | undefined {
  const v = l.vector;
  if (!v || v.stroke || isVectorGradient(v.fill) || isVectorPattern(v.fill) || v.mask.invert || v.mask.fillStartsWithAllPixels || v.mask.disable) return;
  const components = vectorComponents(v.mask);
  if (components.length !== 1 || components[0].operation !== 'combine') return;
  const mask = transformedVectorMask(l);
  return {
    kind: 'path',
    name: l.name,
    d: knotsToPath(mask.paths),
    fill: vectorDisplayHex(l, doc),
    // Continuation contours cut holes regardless of winding (see vectorComponents).
    fillRule: 'evenodd',
  };
}

function textLayer(l: Layer): SvgLayer | undefined {
  const t = l.transform;
  if (!l.text || t.rotation % 360 || Math.abs(t.width - l.sourceWidth) > 1e-6 || Math.abs(t.height - l.sourceHeight) > 1e-6) return;
  // The rasterizer draws 600-weight sans-serif with a top baseline; SVG text
  // is positioned on its alphabetic baseline, one em ascent lower.
  let ascent = l.fontSize * 0.8;
  try {
    const c = new OffscreenCanvas(1, 1).getContext('2d')!;
    c.font = `600 ${l.fontSize}px sans-serif`;
    c.textBaseline = 'top';
    const shift = c.measureText('M').alphabeticBaseline;
    if (Number.isFinite(shift) && shift) ascent = Math.abs(shift);
  } catch {
    /* Use the estimate. */
  }
  return { kind: 'text', name: l.name, x: t.x, y: t.y + ascent, text: l.text, font: 'sans-serif', size: l.fontSize, fill: l.color, weight: 600, lineHeight: 1.2 };
}

function crop(src: SourceImage): { x: number; y: number; image: SourceImage } | undefined {
  const { width: w, height: h, data } = src;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return;
  const cw = x1 - x0 + 1,
    ch = y1 - y0 + 1;
  const Ctor = data.constructor as { new (n: number): typeof data };
  const out = new Ctor(cw * ch * 4);
  for (let y = 0; y < ch; y++) out.set(data.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x1 + 1) * 4), y * cw * 4);
  return { x: x0, y: y0, image: { width: cw, height: ch, data: out } };
}

export async function exportSvg(e: Editor, doc: PhotoDocument, s: Pick<ExportSettings, 'sizeMode' | 'scale' | 'width' | 'height'>): Promise<string> {
  const profile = documentProfile(doc);
  const layers: SvgLayer[] = [];
  const top = doc.layers;
  for (let i = 0; i < top.length; i++) {
    const l = top[i];
    // A clipping base and the layers clipped to it export as one image.
    let j = i + 1;
    while (j < top.length && top[j].clipped) j++;
    const run = top.slice(i, j);
    i = j - 1;
    if (!l.visible) continue;
    const common = { name: l.name, opacity: l.opacity, blend: l.blend === 'pass through' ? 'normal' : l.blend };
    const simple = run.length === 1 && plain(l);
    const asVector = simple && l.kind === 'vector' ? vectorPath(l, doc) : undefined;
    const asText = simple && l.kind === 'text' ? textLayer(l) : undefined;
    if (asVector || asText) {
      layers.push({ ...(asVector ?? asText)!, ...common });
      continue;
    }
    const base = { ...l, visible: true, opacity: 1, blend: l.blend === 'pass through' ? l.blend : ('normal' as const), clipped: false };
    const src = await documentSource(e, { ...doc, layers: [base, ...run.slice(1)] });
    const c = crop(src);
    if (!c) continue;
    let data = c.image.data instanceof Uint16Array ? rgba16To8(c.image.data) : c.image.data;
    if (profile) data = convertToSrgb(data === src.data ? data.slice() : data, profile);
    layers.push({ kind: 'raster', ...common, x: c.x, y: c.y, width: c.image.width, height: c.image.height, pngBytes: encodePng({ width: c.image.width, height: c.image.height, data, channels: 4 }, { level: 9 }) });
  }
  let text = buildSvg({ width: doc.width, height: doc.height, layers, title: doc.info?.title || doc.name });
  const [w, h] = outputSize(doc.width, doc.height, s);
  if (w !== doc.width || h !== doc.height) text = text.replace(/(<svg [^>]*?)width="[^"]*" height="[^"]*"/, `$1width="${w}" height="${h}"`);
  return text;
}
