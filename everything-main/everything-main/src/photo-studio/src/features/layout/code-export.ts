// Layer → Copy CSS and Copy SVG: code describing selected layers for web
// pages. Shapes, text and solid fills become CSS properties or SVG elements;
// other layers are referenced as images (CSS) or embedded as PNG data (SVG,
// rendered by an injected function so this module stays free of the DOM).
import { allLayers, type Layer, type PhotoDocument, type Rect } from '../../model/document';
import { artboardFill, isArtboard, layerBounds, unionRect, type ArtboardLayer } from '../../model/artboard';
import { transformedVectorMask, vectorComponents, vectorMatrix, type VectorColor } from '../../model/vector';
import { isVectorGradient, type VectorGradient } from '../../model/vector-gradient';
import { isVectorPattern } from '../../model/vector-pattern';
import { solidRgb, strokeDashPixels, strokePixels, type VectorStroke } from '../../model/vector-stroke';
import { activeLayerStyle } from '../../model/layer-style';
import { documentPpi, textMatrix } from '../../model/text-layer';
import { ptToPx, type CharStyle, type TextLayerData } from '../../imaging/text/model';
import type { ShadowFx } from '../../imaging/effects/types';
import { vectorColorHex } from '../../color/vector';
import { base64Encode } from '../../imaging/codecs/bytes';
import { cssBlendMode, escapeXml } from '../../imaging/codecs/svg';
import { knotsToPath } from '../files/svg-export';

const n = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};
const px = (v: number) => (Math.abs(v) < 0.005 ? '0' : `${n(v)}px`);
const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
/** CSS color from 0-255 sRGB and an alpha: #rrggbb, or rgba() when translucent. */
export function cssColor(rgb: readonly number[], alpha = 1) {
  if (alpha >= 0.999) return `#${rgb.slice(0, 3).map(hex2).join('')}`;
  return `rgba(${rgb.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(255, v)))).join(', ')}, ${n(Math.max(0, alpha))})`;
}
const hexRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const vectorRgb = (c: VectorColor, doc: PhotoDocument) => hexRgb(vectorColorHex(c, doc));
const docColor = (rgb01: [number, number, number], doc: PhotoDocument) => vectorRgb({ rgb: rgb01, space: 'document' }, doc);

/** Class-name slugs from layer names, unique within one export. */
export function slugger() {
  const used = new Set<string>();
  return (name: string) => {
    let base = name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    if (!base) base = 'layer';
    if (/^[0-9]/.test(base)) base = `layer-${base}`;
    let slug = base;
    for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
    used.add(slug);
    return slug;
  };
}

/** Unrotated box (document space), rotation in degrees, of a layer as drawn. */
export type Box = Rect & { rotation: number };
function vectorBox(l: Layer): Box | undefined {
  const live = l.vector?.live;
  if (!live || live.kind === 'line') return;
  const m = vectorMatrix(l);
  const cx = live.x + live.width / 2,
    cy = live.y + live.height / 2;
  const x = m[0] * cx + m[2] * cy + m[4],
    y = m[1] * cx + m[3] * cy + m[5];
  const width = live.width * Math.hypot(m[0], m[1]),
    height = live.height * Math.hypot(m[2], m[3]);
  return { x: x - width / 2, y: y - height / 2, width, height, rotation: (Math.atan2(m[1], m[0]) * 180) / Math.PI };
}
export function layerBox(l: Layer): Box | undefined {
  if (l.artboard) return { ...l.artboard.rect, rotation: 0 };
  if (l.frame) return { ...l.frame.rect, rotation: 0 };
  if (l.kind === 'vector') {
    const live = vectorBox(l);
    if (live) return live;
    // Free-form paths: the bounds of their transformed anchors.
    const mask = transformedVectorMask(l);
    const pts = mask.paths.flatMap((p) => p.knots.map((k) => [k.points[2], k.points[3]]));
    if (pts.length) {
      const xs = pts.map((p) => p[0]),
        ys = pts.map((p) => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), rotation: 0 };
    }
    return { ...l.transform };
  }
  if (l.kind === 'group' || l.kind === 'adjustment') {
    const b = layerBounds(l);
    return b ? { ...b, rotation: 0 } : undefined;
  }
  return { ...l.transform };
}
const rad = (box: Box) => (((box.rotation % 360) + 360) % 360 > 1e-6 ? box.rotation : 0);

// ----------------------------------------------------------------- CSS

type Declarations = [string, string][];
function shadow(fx: ShadowFx, style: { scale?: number; globalAngle?: number }, text: boolean) {
  const k = style.scale ?? 1;
  const a = ((fx.useGlobalLight ? (style.globalAngle ?? 120) : fx.angle) * Math.PI) / 180;
  const d = fx.distance * k;
  const blur = fx.size * k * (1 - fx.spread);
  const spread = fx.size * k * fx.spread;
  const color = cssColor(fx.color, fx.opacity);
  return text
    ? `${px(-d * Math.cos(a))} ${px(d * Math.sin(a))} ${px(blur)} ${color}`
    : `${px(-d * Math.cos(a))} ${px(d * Math.sin(a))} ${px(blur)} ${px(spread)} ${color}`;
}
function styleDeclarations(l: Layer, text: boolean): Declarations {
  const s = activeLayerStyle(l);
  const shadows = s?.dropShadow?.filter((f) => f.enabled !== false) ?? [];
  if (!s || !shadows.length) return [];
  // The first array entry is drawn lowest; CSS lists the topmost shadow first.
  return [[text ? 'text-shadow' : 'box-shadow', [...shadows].reverse().map((f) => shadow(f, s, text)).join(', ')]];
}
/** Gradient stops with opacity sampled from the opacity stops. */
function gradientStops(g: VectorGradient, doc: PhotoDocument) {
  const opacity = (t: number) => {
    const stops = [...g.opacityStops].sort((a, b) => a.location - b.location);
    if (!stops.length) return 1;
    if (t <= stops[0].location) return stops[0].opacityPercent / 100;
    for (let i = 1; i < stops.length; i++)
      if (t <= stops[i].location) {
        const a = stops[i - 1],
          b = stops[i];
        const f = b.location > a.location ? (t - a.location) / (b.location - a.location) : 1;
        return (a.opacityPercent + (b.opacityPercent - a.opacityPercent) * f) / 100;
      }
    return stops[stops.length - 1].opacityPercent / 100;
  };
  const stops = [...g.colorStops]
    .sort((a, b) => a.location - b.location)
    .map((s) => {
      const rgb = solidRgb({ type: 'color', color: s.color });
      return { color: cssColor(rgb ? docColor(rgb, doc) : [0, 0, 0], opacity(s.location)), at: s.location };
    });
  return g.reverse ? stops.reverse().map((s) => ({ ...s, at: 1 - s.at })) : stops;
}
export function cssGradient(g: VectorGradient, doc: PhotoDocument): string {
  const stops = gradientStops(g, doc)
    .map((s) => `${s.color} ${n(s.at * 100)}%`)
    .join(', ');
  // Gradient angles run counterclockwise from the right; CSS angles run
  // clockwise from the top.
  const angle = n((((90 - (g.angle ?? 0)) % 360) + 360) % 360);
  if (g.style === 'radial') return `radial-gradient(circle, ${stops})`;
  if (g.style === 'angle') return `conic-gradient(from ${angle}deg, ${stops})`;
  return `linear-gradient(${angle}deg, ${stops})`;
}
function strokeDeclarations(s: VectorStroke, doc: PhotoDocument, box: Box): { decl: Declarations; box: Box } {
  const w = strokePixels(s);
  const color = cssColor(vectorRgb(s.color, doc), s.opacity);
  const style = s.lineDashSet?.length ? (strokeDashPixels(s)[0] <= w * 1.01 ? 'dotted' : 'dashed') : 'solid';
  if (s.alignment === 'outside') return { decl: [['outline', `${px(w)} ${style} ${color}`]], box };
  const decl: Declarations = [['box-sizing', 'border-box'], ['border', `${px(w)} ${style} ${color}`]];
  // A centered stroke straddles the edge: grow the border box by half a stroke.
  if (s.alignment === 'center') box = { ...box, x: box.x - w / 2, y: box.y - w / 2, width: box.width + w, height: box.height + w };
  return { decl, box };
}
function textDeclarations(data: TextLayerData, doc: PhotoDocument, l: Layer): Declarations {
  const run = data.content.paragraphs[0]?.runs[0]?.style as CharStyle | undefined;
  if (!run) return [];
  const ppi = documentPpi(doc);
  const scale = Math.abs(textMatrix(l)[3]) || 1;
  const size = ptToPx(run.size, ppi) * scale;
  const generic = /mono|code|courier/i.test(run.family) ? 'monospace' : /serif|times|georgia|garamond|merriweather/i.test(run.family) && !/sans/i.test(run.family) ? 'serif' : 'sans-serif';
  const decl: Declarations = [
    ['font-family', `"${run.family.replace(/"/g, '')}", ${generic}`],
    ['font-size', px(size)],
  ];
  if (run.weight !== 400 || run.fauxBold) decl.push(['font-weight', String(run.fauxBold ? Math.max(700, run.weight) : run.weight)]);
  if (run.italic || run.fauxItalic) decl.push(['font-style', 'italic']);
  decl.push(['color', cssColor(run.color)]);
  decl.push(['line-height', run.leading === 'auto' ? 'normal' : px(ptToPx(run.leading, ppi) * scale)]);
  if (run.tracking) decl.push(['letter-spacing', `${n(run.tracking / 1000)}em`]);
  const align = data.content.paragraphs[0]?.style.align ?? 'left';
  if (align !== 'left') decl.push(['text-align', align === 'justify-all' ? 'justify' : align.startsWith('justify') ? 'justify' : align]);
  const deco = [run.underline ? 'underline' : '', run.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ');
  if (deco) decl.push(['text-decoration', deco]);
  if (run.allCaps) decl.push(['text-transform', 'uppercase']);
  if (run.smallCaps) decl.push(['font-variant', 'small-caps']);
  if (data.mode === 'point') decl.push(['white-space', 'pre']);
  return decl;
}

export type CssRule = { selector: string; comment?: string; declarations: Declarations };
function positionDeclarations(box: Box, origin: { x: number; y: number }): Declarations {
  const decl: Declarations = [
    ['position', 'absolute'],
    ['left', px(box.x - origin.x)],
    ['top', px(box.y - origin.y)],
    ['width', px(box.width)],
    ['height', px(box.height)],
  ];
  const r = rad(box);
  if (r) decl.push(['transform', `rotate(${n(r)}deg)`]);
  return decl;
}
function commonDeclarations(l: Layer): Declarations {
  const decl: Declarations = [];
  if (l.opacity < 0.999) decl.push(['opacity', n(l.opacity)]);
  const blend = l.blend === 'pass through' ? 'normal' : cssBlendMode(l.blend);
  if (blend && blend !== 'normal') decl.push(['mix-blend-mode', blend]);
  return decl;
}

/** CSS rules for one layer (not descending into groups). */
export function layerCss(l: Layer, doc: PhotoDocument, slug: (name: string) => string, origin = { x: 0, y: 0 }): CssRule | undefined {
  let box = layerBox(l);
  if (!box || box.width <= 0 || box.height <= 0) return;
  const name = slug(l.name);
  const selector = `.${name}`;
  const decl: Declarations = [];
  let comment: string | undefined;
  const fillAlpha = l.fillOpacity ?? 1;
  if (l.artboard) {
    const fill = artboardFill(l.artboard);
    if (fill) decl.push(['background-color', fill]);
    if (l.artboard.clip !== false) decl.push(['overflow', 'hidden']);
    comment = 'artboard';
  } else if (l.frame) {
    decl.push(['overflow', 'hidden']);
    if (l.frame.shape === 'ellipse') decl.push(['border-radius', '50%']);
    comment = 'frame';
  } else if (l.kind === 'vector' && l.vector) {
    const v = l.vector;
    const fillOn = !v.stroke?.enabled || v.stroke.fillEnabled;
    if (fillOn) {
      if (isVectorGradient(v.fill)) decl.push(['background-image', cssGradient(v.fill, doc)]);
      else if (isVectorPattern(v.fill)) comment = 'pattern fill: export the layer as an image';
      else decl.push(['background-color', cssColor(vectorRgb(v.fill, doc), fillAlpha)]);
    }
    if (v.stroke?.enabled) {
      const s = strokeDeclarations(v.stroke, doc, box);
      decl.push(...s.decl);
      box = s.box;
    }
    const live = v.live;
    if (live?.kind === 'ellipse') decl.push(['border-radius', '50%']);
    else if (live?.kind === 'rect' && live.radii.some((r) => r > 0)) {
      const m = vectorMatrix(l);
      const sx = Math.hypot(m[0], m[1]),
        sy = Math.hypot(m[2], m[3]);
      // Radii run top-left, top-right, bottom-right, bottom-left.
      const rx = live.radii.map((r) => px(r * sx)).join(' '),
        ry = live.radii.map((r) => px(r * sy)).join(' ');
      decl.push(['border-radius', Math.abs(sx - sy) < 1e-6 ? rx : `${rx} / ${ry}`]);
    } else if (!live || live.kind !== 'rect') comment = comment ?? 'custom shape: CSS draws its bounding box; use Copy SVG for the outline';
  } else if (l.kind === 'text') {
    if (l.textData) decl.push(...textDeclarations(l.textData, doc, l));
    else decl.push(['font-size', px(l.fontSize)], ['color', l.color]);
  } else if (l.kind === 'solid' && !l.fill) {
    decl.push(['background-color', cssColor(hexRgb(l.color), fillAlpha)]);
  } else {
    const file = `${name}.png`;
    comment = `image: ${file}`;
    decl.push(['background-image', `url("${file}")`], ['background-size', '100% 100%']);
  }
  if (l.kind === 'text') decl.push(...styleDeclarations(l, true));
  else decl.push(...styleDeclarations(l, false));
  return { selector, comment, declarations: [...positionDeclarations(box, origin), ...commonDeclarations(l), ...decl] };
}

/** Rules for the selected layers: groups contribute their visible
 * descendants, artboards a rule for their box and their contents. Positions
 * are relative to the containing artboard, else the canvas. */
export function selectionCss(doc: PhotoDocument, roots: Layer[]): CssRule[] {
  const slug = slugger();
  const rules: CssRule[] = [];
  const artboardFor = (l: Layer): ArtboardLayer | undefined =>
    doc.layers.filter(isArtboard).find((a) => a === l || allLayers(a.children).includes(l));
  const visit = (l: Layer, top: boolean) => {
    if (!top && !l.visible) return;
    if (l.kind === 'adjustment') return;
    const a = artboardFor(l);
    const origin = a && a !== l ? { x: a.artboard.rect.x, y: a.artboard.rect.y } : { x: 0, y: 0 };
    if (l.kind !== 'group' || l.artboard || l.frame) {
      const rule = layerCss(l, doc, slug, origin);
      if (rule) rules.push(rule);
    }
    if (l.kind === 'group') for (const c of [...l.children].reverse()) visit(c, false);
  };
  for (const l of [...roots].reverse()) visit(l, true);
  return rules;
}
export function formatCss(rules: CssRule[]): string {
  return rules
    .map((r) => `${r.comment ? `/* ${r.comment.replace(/\*\//g, '* /')} */\n` : ''}${r.selector} {\n${r.declarations.map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`)
    .join('\n\n') + '\n';
}

// ----------------------------------------------------------------- SVG

export type RasterImage = { x: number; y: number; width: number; height: number; png: Uint8Array };
/** Renders one layer alone (opacity 1, normal blending) cropped to its ink. */
export type RasterLayer = (l: Layer) => Promise<RasterImage | undefined>;

const plain = (l: Layer) =>
  !l.mask && !l.maskAsset && !l.maskGrid && !l.pixelMask && !l.vectorMask && !l.maskStrokes?.length && !activeLayerStyle(l) && !Object.values(l.filters).some(Boolean) && !l.liveFilters?.length;

function svgColor(rgb: readonly number[]) {
  return `#${rgb.slice(0, 3).map(hex2).join('')}`;
}
function groupAttrs(l: Layer, extra = '') {
  const a: string[] = [`id="${escapeXml(l.name.replace(/\s+/g, '-'))}"`];
  if (l.opacity < 0.999) a.push(`opacity="${n(l.opacity)}"`);
  const blend = l.blend === 'pass through' ? 'normal' : cssBlendMode(l.blend);
  if (blend && blend !== 'normal') a.push(`style="mix-blend-mode:${blend}"`);
  return a.join(' ') + extra;
}

type SvgContext = { doc: PhotoDocument; raster: RasterLayer; defs: string[]; ids: () => string };

function vectorSvg(l: Layer, ctx: SvgContext): string | undefined {
  const v = l.vector!;
  if (isVectorPattern(v.fill) || v.mask.invert || v.mask.fillStartsWithAllPixels || v.mask.disable) return;
  const components = vectorComponents(v.mask);
  if (components.some((c) => c.operation !== 'combine')) return;
  const d = knotsToPath(transformedVectorMask(l).paths);
  if (!d) return '';
  const doc = ctx.doc;
  const fillOn = !v.stroke?.enabled || v.stroke.fillEnabled;
  const fillAlpha = l.fillOpacity ?? 1;
  let fill = 'none';
  if (fillOn && isVectorGradient(v.fill)) {
    const id = ctx.ids();
    const stops = gradientStops(v.fill, doc)
      .map((s) => {
        const m = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(s.color);
        const color = m ? svgColor([+m[1], +m[2], +m[3]]) : s.color;
        return `<stop offset="${n(s.at)}" stop-color="${color}"${m ? ` stop-opacity="${m[4]}"` : ''}/>`;
      })
      .join('');
    const box = layerBox(l)!;
    if (v.fill.style === 'radial')
      ctx.defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(box.x + box.width / 2)}" cy="${n(box.y + box.height / 2)}" r="${n(Math.max(box.width, box.height) / 2)}">${stops}</radialGradient>`);
    else {
      const a = ((v.fill.angle ?? 0) * Math.PI) / 180;
      const cx = box.x + box.width / 2,
        cy = box.y + box.height / 2;
      const half = (Math.abs(box.width * Math.cos(a)) + Math.abs(box.height * Math.sin(a))) / 2;
      ctx.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(cx - half * Math.cos(a))}" y1="${n(cy + half * Math.sin(a))}" x2="${n(cx + half * Math.cos(a))}" y2="${n(cy - half * Math.sin(a))}">${stops}</linearGradient>`);
    }
    fill = `url(#${id})`;
  } else if (fillOn && !isVectorGradient(v.fill) && !isVectorPattern(v.fill)) fill = svgColor(vectorRgb(v.fill, doc));
  const attrs = [`d="${d}"`, `fill="${fill}"`, 'fill-rule="evenodd"'];
  if (fill !== 'none' && fillAlpha < 0.999) attrs.push(`fill-opacity="${n(fillAlpha)}"`);
  const s = v.stroke;
  let wrap = (body: string) => body;
  if (s?.enabled) {
    const w = strokePixels(s);
    const align = v.mask.paths.some((p) => p.open) ? 'center' : s.alignment;
    attrs.push(`stroke="${svgColor(vectorRgb(s.color, doc))}"`, `stroke-width="${n(align === 'center' ? w : w * 2)}"`, `stroke-linecap="${s.cap}"`, `stroke-linejoin="${s.join}"`);
    if (s.opacity < 0.999) attrs.push(`stroke-opacity="${n(s.opacity)}"`);
    if (s.join === 'miter') attrs.push(`stroke-miterlimit="${n(s.miterLimit)}"`);
    const dashes = strokeDashPixels(s);
    if (dashes.length) attrs.push(`stroke-dasharray="${dashes.map(n).join(' ')}"`);
    // SVG strokes are centered; a double-width stroke clipped to the shape
    // (inside) or masked by it (outside) gives the aligned result.
    if (align !== 'center') {
      const id = ctx.ids();
      if (align === 'inside') {
        ctx.defs.push(`<clipPath id="${id}"><path d="${d}" fill-rule="evenodd"/></clipPath>`);
        wrap = (body) => `<g clip-path="url(#${id})">${body}</g>`;
      } else {
        const b = layerBox(l)!;
        const pad = w * 2;
        ctx.defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="${n(b.x - pad)}" y="${n(b.y - pad)}" width="${n(b.width + pad * 2)}" height="${n(b.height + pad * 2)}"><rect x="${n(b.x - pad)}" y="${n(b.y - pad)}" width="${n(b.width + pad * 2)}" height="${n(b.height + pad * 2)}" fill="#fff"/><path d="${d}" fill="#000" fill-rule="evenodd"/></mask>`);
        // The fill stays unmasked; only the stroke is limited to the outside.
        return `<path ${attrs.filter((a) => !a.startsWith('stroke')).join(' ')}/><path d="${d}" fill="none" ${attrs.filter((a) => a.startsWith('stroke')).join(' ')} mask="url(#${id})"/>`;
      }
    }
  }
  return wrap(`<path ${attrs.join(' ')}/>`);
}

function textSvg(l: Layer, doc: PhotoDocument): string | undefined {
  const data = l.textData;
  if (!data) {
    if (!l.text) return;
    const t = l.transform;
    return `<text x="${n(t.x)}" y="${n(t.y + l.fontSize * 0.8)}" font-family="sans-serif" font-size="${n(l.fontSize)}" font-weight="600" fill="${escapeXml(l.color)}">${escapeXml(l.text)}</text>`;
  }
  // Warped, vertical and path text have no plain SVG text equivalent here.
  if ((data.warp && data.warp.style !== 'none') || data.orientation === 'vertical' || data.path) return;
  const ppi = documentPpi(doc);
  const m = textMatrix(l);
  const first = data.content.paragraphs[0]?.runs[0]?.style;
  if (!first) return '';
  const size = ptToPx(first.size, ppi);
  const align = data.content.paragraphs[0].style.align;
  const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
  const width = data.box?.width ?? 0;
  const x = data.mode === 'paragraph' ? data.origin.x + (anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0) : data.origin.x;
  // Point text starts on its first baseline; paragraph text at the box top.
  const y = data.mode === 'paragraph' ? data.origin.y + size * 0.8 : data.origin.y;
  const lines = data.content.paragraphs
    .map((p, i) => {
      const lead = p.runs[0]?.style;
      const lineHeight = lead ? (lead.leading === 'auto' ? ptToPx(lead.size, ppi) * 1.2 : ptToPx(lead.leading, ppi)) : size * 1.2;
      const spans = p.runs
        .map((r) => {
          const s = r.style;
          const a = [`font-family="${escapeXml(s.family)}"`, `font-size="${n(ptToPx(s.size, ppi))}"`, `fill="${svgColor(s.color)}"`];
          if (s.weight !== 400 || s.fauxBold) a.push(`font-weight="${s.fauxBold ? Math.max(700, s.weight) : s.weight}"`);
          if (s.italic || s.fauxItalic) a.push('font-style="italic"');
          if (s.tracking) a.push(`letter-spacing="${n((s.tracking / 1000) * ptToPx(s.size, ppi))}"`);
          const deco = [s.underline ? 'underline' : '', s.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ');
          if (deco) a.push(`text-decoration="${deco}"`);
          return `<tspan ${a.join(' ')}>${escapeXml(s.allCaps ? r.text.toUpperCase() : r.text)}</tspan>`;
        })
        .join('');
      return `<tspan x="${n(x)}" ${i ? `dy="${n(lineHeight)}"` : `y="${n(y)}"`}>${spans || ' '}</tspan>`;
    })
    .join('');
  const identity = Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[3] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;
  const transform = identity ? (Math.abs(m[4]) > 1e-9 || Math.abs(m[5]) > 1e-9 ? ` transform="translate(${n(m[4])} ${n(m[5])})"` : '') : ` transform="matrix(${m.map((v) => n(v)).join(' ')})"`;
  return `<text text-anchor="${anchor}" xml:space="preserve"${transform}>${lines}</text>`;
}

async function layerSvg(l: Layer, ctx: SvgContext, top: boolean): Promise<string> {
  if (!top && !l.visible) return '';
  if (l.kind === 'adjustment') return '';
  const simple = plain(l) && !l.clipped;
  if (l.kind === 'group' && plain(l)) {
    let inner = '';
    for (const c of l.children) inner += await layerSvg(c, ctx, false);
    let clip = '';
    let background = '';
    const shape = l.frame ?? (l.artboard && l.artboard.clip !== false ? { shape: 'rect' as const, rect: l.artboard.rect } : undefined);
    if (shape) {
      const id = ctx.ids();
      const r = shape.rect;
      ctx.defs.push(
        `<clipPath id="${id}">${shape.shape === 'ellipse' ? `<ellipse cx="${n(r.x + r.width / 2)}" cy="${n(r.y + r.height / 2)}" rx="${n(r.width / 2)}" ry="${n(r.height / 2)}"/>` : `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.width)}" height="${n(r.height)}"/>`}</clipPath>`,
      );
      clip = ` clip-path="url(#${id})"`;
    }
    const fill = l.artboard ? artboardFill(l.artboard) : null;
    if (fill) {
      const r = l.artboard!.rect;
      background = `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.width)}" height="${n(r.height)}" fill="${fill}"/>`;
    }
    return `<g ${groupAttrs(l)}${clip}>${background}${inner}</g>`;
  }
  let body: string | undefined;
  if (simple && l.kind === 'vector' && l.vector) body = vectorSvg(l, ctx);
  else if (simple && l.kind === 'text') body = textSvg(l, ctx.doc);
  else if (simple && l.kind === 'solid' && !l.fill) {
    const t = l.transform;
    const r = rad(t);
    const alpha = l.fillOpacity ?? 1;
    body = `<rect x="${n(t.x)}" y="${n(t.y)}" width="${n(t.width)}" height="${n(t.height)}" fill="${escapeXml(l.color)}"${alpha < 0.999 ? ` fill-opacity="${n(alpha)}"` : ''}${r ? ` transform="rotate(${n(r)} ${n(t.x + t.width / 2)} ${n(t.y + t.height / 2)})"` : ''}/>`;
  }
  if (body === undefined) {
    const img = await ctx.raster(l);
    if (!img) return '';
    body = `<image x="${n(img.x)}" y="${n(img.y)}" width="${n(img.width)}" height="${n(img.height)}" preserveAspectRatio="none" href="data:image/png;base64,${base64Encode(img.png)}"/>`;
  }
  if (!body) return '';
  return `<g ${groupAttrs(l)}>${body}</g>`;
}

/** An SVG document for the selected layers, its view box at their bounds. */
export async function selectionSvg(doc: PhotoDocument, roots: Layer[], raster: RasterLayer): Promise<string> {
  const boxes = roots.map(layerBounds).filter((r): r is Rect => !!r && r.width > 0 && r.height > 0);
  const u = unionRect(boxes) ?? { x: 0, y: 0, width: doc.width, height: doc.height };
  const x = Math.floor(u.x),
    y = Math.floor(u.y);
  const w = Math.max(1, Math.ceil(u.x + u.width) - x),
    h = Math.max(1, Math.ceil(u.y + u.height) - y);
  let counter = 0;
  const ctx: SvgContext = { doc, raster, defs: [], ids: () => `ps-${++counter}` };
  let body = '';
  for (const l of roots) body += await layerSvg(l, ctx, true);
  const title = roots.length === 1 ? roots[0].name : `${roots.length} layers`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">\n<title>${escapeXml(title)}</title>\n${ctx.defs.length ? `<defs>${ctx.defs.join('')}</defs>\n` : ''}${body}\n</svg>\n`;
}
