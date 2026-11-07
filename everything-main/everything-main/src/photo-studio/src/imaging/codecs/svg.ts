// SVG 1.1/2 export of a layered document: one group per layer, opacity and
// CSS mix-blend-mode (Compositing and Blending Level 1) per group, raster
// layers embedded as base64 data URIs. Layers are listed bottom to top.
import { base64Encode } from './bytes';

type Common = { name: string; opacity?: number; blend?: string; visible?: boolean };
export type SvgRasterLayer = Common & {
  kind: 'raster';
  x: number;
  y: number;
  width: number;
  height: number;
  pngBytes: Uint8Array;
  // Defaults to image/png; JPEG or WebP bytes also work.
  mime?: string;
};
export type SvgPathLayer = Common & {
  kind: 'path';
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fillRule?: 'nonzero' | 'evenodd';
  transform?: string;
};
export type SvgTextLayer = Common & {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  font: string;
  size: number;
  fill: string;
  weight?: string | number;
  italic?: boolean;
  anchor?: 'start' | 'middle' | 'end';
  // Line advance as a multiple of size for multi-line text (default 1.2).
  lineHeight?: number;
};
export type SvgLayer = SvgRasterLayer | SvgPathLayer | SvgTextLayer;
export type SvgDocument = {
  width: number;
  height: number;
  layers: SvgLayer[];
  background?: string;
  title?: string;
  // Hidden layers are omitted unless this is set (then written with display="none").
  includeHidden?: boolean;
};

const CSS_BLENDS: Record<string, string> = {
  normal: 'normal',
  passthrough: 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  colordodge: 'color-dodge',
  colorburn: 'color-burn',
  hardlight: 'hard-light',
  softlight: 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

// CSS mix-blend-mode for a blend name in any casing ('colorDodge',
// 'color-dodge', 'Color Dodge'); null when CSS has no equivalent.
export function cssBlendMode(blend: string | undefined): string | null {
  if (!blend) return 'normal';
  return CSS_BLENDS[blend.toLowerCase().replace(/[^a-z]/g, '')] ?? null;
}

// Characters XML 1.0 does not allow at all are removed.
const stripInvalid = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
export function escapeXml(s: string): string {
  return stripInvalid(String(s)).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}
const num = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '0');

export function buildSvg(doc: SvgDocument): string {
  const { width, height } = doc;
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" version="1.1" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">`,
  );
  if (doc.title) out.push(`<title>${escapeXml(doc.title)}</title>`);
  // Isolate so blend modes mix with the layers below, not the host page.
  out.push('<g style="isolation:isolate">');
  if (doc.background) out.push(`<rect width="100%" height="100%" fill="${escapeXml(doc.background)}"/>`);
  const used = new Set<string>();
  doc.layers.forEach((layer, i) => {
    const hidden = layer.visible === false;
    if (hidden && !doc.includeHidden) return;
    let id = `layer-${i + 1}-${layer.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'layer'}`;
    while (used.has(id)) id += '-';
    used.add(id);
    const attrs = [`id="${escapeXml(id)}"`, `inkscape:groupmode="layer"`, `inkscape:label="${escapeXml(layer.name)}"`];
    const opacity = layer.opacity ?? 1;
    if (opacity < 1) attrs.push(`opacity="${num(Math.max(0, opacity))}"`);
    const css = cssBlendMode(layer.blend);
    if (css && css !== 'normal') attrs.push(`style="mix-blend-mode:${css}"`);
    else if (!css) attrs.push(`data-blend="${escapeXml(layer.blend!)}"`); // no CSS equivalent: drawn normal
    if (hidden) attrs.push('display="none"');
    out.push(`<g ${attrs.join(' ')}>`);
    if (layer.kind === 'raster') {
      const href = `data:${escapeXml(layer.mime ?? 'image/png')};base64,${base64Encode(layer.pngBytes)}`;
      out.push(`<image x="${num(layer.x)}" y="${num(layer.y)}" width="${num(layer.width)}" height="${num(layer.height)}" preserveAspectRatio="none" xlink:href="${href}"/>`);
    } else if (layer.kind === 'path') {
      const a = [`d="${escapeXml(layer.d)}"`, `fill="${escapeXml(layer.fill ?? 'none')}"`];
      if (layer.fillRule === 'evenodd') a.push('fill-rule="evenodd"');
      if (layer.stroke) a.push(`stroke="${escapeXml(layer.stroke)}"`, `stroke-width="${num(layer.strokeWidth ?? 1)}"`);
      if (layer.transform) a.push(`transform="${escapeXml(layer.transform)}"`);
      out.push(`<path ${a.join(' ')}/>`);
    } else {
      const a = [`x="${num(layer.x)}"`, `y="${num(layer.y)}"`, `font-family="${escapeXml(layer.font)}"`, `font-size="${num(layer.size)}"`, `fill="${escapeXml(layer.fill)}"`];
      if (layer.weight !== undefined) a.push(`font-weight="${escapeXml(String(layer.weight))}"`);
      if (layer.italic) a.push('font-style="italic"');
      if (layer.anchor && layer.anchor !== 'start') a.push(`text-anchor="${layer.anchor}"`);
      const lines = layer.text.split(/\r\n|\r|\n/);
      if (lines.length === 1) out.push(`<text xml:space="preserve" ${a.join(' ')}>${escapeXml(lines[0])}</text>`);
      else {
        const step = num(layer.size * (layer.lineHeight ?? 1.2));
        const spans = lines.map((l, k) => `<tspan x="${num(layer.x)}"${k ? ` dy="${step}"` : ''}>${escapeXml(l)}</tspan>`).join('');
        out.push(`<text xml:space="preserve" ${a.join(' ')}>${spans}</text>`);
      }
    }
    out.push('</g>');
  });
  out.push('</g>');
  out.push('</svg>');
  return out.join('\n');
}
