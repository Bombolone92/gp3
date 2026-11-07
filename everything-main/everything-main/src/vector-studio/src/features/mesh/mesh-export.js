/**
 * Gradient meshes in SVG and PDF.
 *
 * PDF gets a true Coons patch mesh shading (ShadingType 6) painted inside
 * the mesh outline, so it stays smooth at any zoom; point opacities become
 * a luminosity soft mask made of the same patches in gray. SVG has no mesh
 * gradients, so the mesh is written as an image clipped to its outline.
 */
import { exportWriters } from '../io/hooks.js';
import { meshBoundary, meshBounds, patchOf, rgba } from './mesh-model.js';
import { meshImage } from './mesh-raster.js';

const escapeXml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const BLEND_PDF = {
  multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten', colorDodge: 'ColorDodge',
  colorBurn: 'ColorBurn', hardLight: 'HardLight', softLight: 'SoftLight', difference: 'Difference', exclusion: 'Exclusion',
  hue: 'Hue', saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity',
};

/**
 * Patch stream data for a type 6 shading: per patch a flag byte (0), 12
 * points as 32-bit coordinates and 4 corner colors as 16-bit components.
 * `gray` writes one component per color: the point opacity.
 * Returns { bytes, decode: [xmin, xmax, ymin, ymax] }.
 */
export function coonsPatchData(mesh, { gray = false } = {}) {
  const b = meshBounds(mesh);
  // Control points can reach past the outline: decode over every point and handle.
  let x0 = b.x;
  let y0 = b.y;
  let x1 = b.x + b.w;
  let y1 = b.y + b.h;
  for (const p of mesh.points) {
    for (const [x, y] of [[p.x, p.y], [p.lx, p.ly], [p.rx, p.ry], [p.ux, p.uy], [p.dx, p.dy]]) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 - x0 < 1e-6) x1 = x0 + 1;
  if (y1 - y0 < 1e-6) y1 = y0 + 1;
  const comps = gray ? 1 : 3;
  const per = 1 + 12 * 8 + 4 * comps * 2;
  const bytes = new Uint8Array(per * mesh.rows * mesh.cols);
  const dv = new DataView(bytes.buffer);
  let o = 0;
  const MAX = 0xffffffff;
  const coord = (v, lo, hi) => Math.max(0, Math.min(MAX, Math.round(((v - lo) / (hi - lo)) * MAX)));
  for (let i = 0; i < mesh.rows; i++) {
    for (let j = 0; j < mesh.cols; j++) {
      const p = patchOf(mesh, i, j);
      const { top, right, bottom, left } = p;
      // Counterclockwise in parameter space from the top-left corner: top, right, bottom (reversed), left (reversed).
      const pts = [
        [top[0], top[1]], [top[2], top[3]], [top[4], top[5]], [top[6], top[7]],
        [right[2], right[3]], [right[4], right[5]], [right[6], right[7]],
        [bottom[4], bottom[5]], [bottom[2], bottom[3]], [bottom[0], bottom[1]],
        [left[4], left[5]], [left[2], left[3]],
      ];
      bytes[o++] = 0;
      for (const [x, y] of pts) {
        dv.setUint32(o, coord(x, x0, x1));
        dv.setUint32(o + 4, coord(y, y0, y1));
        o += 8;
      }
      for (const c of [p.A, p.B, p.C, p.D].map(rgba)) {
        if (gray) {
          dv.setUint16(o, Math.round(Math.max(0, Math.min(1, c[3])) * 65535));
          o += 2;
        } else {
          for (let k = 0; k < 3; k++) {
            dv.setUint16(o, Math.round((Math.max(0, Math.min(255, c[k])) / 255) * 65535));
            o += 2;
          }
        }
      }
    }
  }
  return { bytes, decode: [x0, x1, y0, y1] };
}

function shadingStream(r, mesh, gray) {
  const { bytes, decode } = coonsPatchData(mesh, { gray });
  const f = (v) => r.f(v);
  const range = gray ? '0 1' : '0 1 0 1 0 1';
  return r.w.addStream(`/ShadingType 6 /ColorSpace /${gray ? 'DeviceGray' : 'DeviceRGB'} /BitsPerCoordinate 32 /BitsPerComponent 16 /BitsPerFlag 8 /Decode [${f(decode[0])} ${f(decode[1])} ${f(decode[2])} ${f(decode[3])} ${range}]`, bytes);
}

/** PDF writer: the mesh shading inside its outline, with opacity as a soft mask when needed. */
export async function writeMeshPDF(r, ctx, node) {
  const res = ctx.res;
  const sh = shadingStream(r, node, false);
  const op = node.opacity ?? 1;
  const bm = BLEND_PDF[node.blendMode];
  const translucent = node.points.some((p) => (p.a ?? 1) < 0.999);
  let gs = null;
  if (translucent) {
    const b = meshBounds(node);
    const pad = 2;
    const gray = shadingStream(r, node, true);
    const formRes = r.w.add(`<< /Shading << /Sh1 ${gray} 0 R >> >>`);
    const form = r.w.addStream(`/Type /XObject /Subtype /Form /BBox [${r.f(b.x - pad)} ${r.f(b.y - pad)} ${r.f(b.x + b.w + pad)} ${r.f(b.y + b.h + pad)}] /Group << /S /Transparency /CS /DeviceGray >> /Resources ${formRes} 0 R`, '/Sh1 sh\n');
    gs = r.w.add(`<< /Type /ExtGState /SMask << /Type /Mask /S /Luminosity /G ${form} 0 R >> /ca ${r.f(op)} /CA ${r.f(op)}${bm ? ` /BM /${bm}` : ''} >>`);
  } else gs = r.extGState(op, op, node.blendMode);
  const clip = r.pathOps([{ anchors: meshBoundary(node), closed: true }]);
  ctx.ops.push(`q\n${gs ? `/${res.name(res.ext, 'GS', gs)} gs\n` : ''}${clip}W n\n/${res.name(res.shading, 'Sh', sh)} sh\nQ\n`);
}

/** SVG writer: the rendered mesh as an image clipped to the outline. */
export function writeMeshSVG(w, node, depth) {
  const res = Math.max(150, w.doc.root?.rasterResolution || 0);
  const img = meshImage(node, Math.min(4, res / 72));
  if (!img) return '';
  const nl = w.nl(2);
  const cp = w.def('c', (id) => `${nl}<clipPath id="${id}">${nl}  <path d="${w.d([{ anchors: meshBoundary(node), closed: true }])}"/>${nl}</clipPath>`);
  const p = w.map(img.x, img.y);
  w.needsXlink = true;
  const image = `<image x="${w.n(p.x)}" y="${w.n(p.y)}" width="${w.n(img.w)}" height="${w.n(img.h)}" preserveAspectRatio="none" xlink:href="${escapeXml(img.dataUrl)}"/>`;
  return `${w.nl(depth)}<g${w.nameId(node.name)} clip-path="url(#${cp})"${w.commonAttrs(node)}>${w.nl(depth + 1)}${image}${w.nl(depth)}</g>`;
}

export function installMeshExport() {
  exportWriters.svg.set('mesh', writeMeshSVG);
  exportWriters.pdf.set('mesh', writeMeshPDF);
}
