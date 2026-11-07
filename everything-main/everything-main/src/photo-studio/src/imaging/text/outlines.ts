// Text to outlines ("Convert to Shape"). Canvas cannot expose glyph outlines,
// so this lays text out with metrics read from the font files themselves
// (sfnt.ts) and emits the glyph contours, transformed by size, scaling, faux
// italic, baseline shift and warp, as SVG path data in document pixels.
//
// What works: bundled TrueType fonts at any weight (variations applied),
// kerning from GPOS/kern, tracking, scaling, super/subscript, small and all
// caps, underline/strikethrough, point/paragraph, horizontal/vertical, warp.
// Not supported: ligatures and other GSUB substitutions (one glyph per
// character), faux bold (outlines are not expanded), system/local fonts
// (no file access; they fall back to the default bundled face).

import { layoutText, type FontMetrics, type Measure, type Rect } from './layout';
import { defaultCharStyle, type TextLayerData } from './model';
import { loadFontFile, findBundled } from './fonts';
import { parseFont, type GlyphPoint, type SfntFont } from './sfnt';
import { FAUX_ITALIC_SKEW } from './render';
import { isIdentityWarp, warpPoint } from './warp';

export type PathCommand = ['M', number, number] | ['L', number, number] | ['Q', number, number, number, number] | ['Z'];
export type TextPath = {
  d: string; // SVG path data, nonzero fill rule, document pixels
  contours: PathCommand[][];
  bounds: Rect;
  missingFonts: string[]; // families drawn with the fallback face
  approximations: string[]; // styles that outlines cannot reproduce exactly
};
export type FontResolver = (family: string, italic: boolean) => SfntFont | undefined;

const IGNORABLE = /[­​-‏⁠﻿]/g;
const FALLBACK_FAMILY = defaultCharStyle().family;

export function parseCssFont(font: string): { family: string; weight: number; italic: boolean; size: number } {
  const m = /^(italic )?(\d+) ([\d.]+)px (.+?)(, [\w-]+)?$/.exec(font);
  if (!m) return { family: FALLBACK_FAMILY, weight: 400, italic: false, size: 16 };
  let family = m[4].trim();
  // An OpenType feature alias comes first: "Inter ~onum", Inter.
  if (family.startsWith('"') && /^"[^"]* ~[^"]*", /.test(family)) family = family.slice(family.indexOf('", ') + 3);
  if (family.startsWith('"')) family = family.slice(1, -1).replace(/\\"/g, '"');
  return { family, weight: Number(m[2]), italic: !!m[1], size: Number(m[3]) };
}

function resolveWithFallback(fonts: FontResolver, family: string, italic: boolean): SfntFont | undefined {
  return fonts(family, italic) ?? fonts(family, false) ?? fonts(FALLBACK_FAMILY, italic) ?? fonts(FALLBACK_FAMILY, false);
}

// A `Measure` backed by font files, so outline positions match their glyphs.
export function sfntMeasure(fonts: FontResolver): Measure {
  return (text, font, kerning = true): FontMetrics => {
    const f = parseCssFont(font);
    const sf = resolveWithFallback(fonts, f.family, f.italic);
    if (!sf) return { width: 0, ascent: f.size * 0.8, descent: f.size * 0.2 };
    const s = f.size / sf.unitsPerEm;
    const coords = sf.normalize({ wght: f.weight });
    let w = 0, prev = -1;
    for (const ch of text.replace(IGNORABLE, '')) {
      const g = sf.glyphIndex(ch.codePointAt(0)!);
      if (kerning && prev >= 0) w += sf.kerning(prev, g);
      w += sf.advance(g, coords);
      prev = g;
    }
    return { width: w * s, ascent: sf.ascent * s, descent: sf.descent * s };
  };
}

export function textToPath(data: TextLayerData, opts: { fonts: FontResolver; resolution?: number }): TextPath {
  const { fonts } = opts;
  const layout = layoutText(data, { measure: sfntMeasure(fonts), resolution: opts.resolution });
  const warp = isIdentityWarp(data.warp) || data.path ? undefined : data.warp;
  const wrect = layout.bounds;
  const contours: PathCommand[][] = [];
  const missing = new Set<string>();
  const approx = new Set<string>();
  let maxSeg = Infinity;

  for (const run of layout.runs) {
    const st = run.style;
    const { family, weight, italic } = parseCssFont(run.font);
    if (!fonts(family, italic) && !fonts(family, false)) missing.add(family);
    const sf = resolveWithFallback(fonts, family, italic);
    if (!sf) continue;
    if (st.fauxBold) approx.add('faux bold');
    const coords = sf.normalize({ wght: weight });
    const s = run.sizePx / sf.unitsPerEm;
    const skew = st.fauxItalic ? FAUX_ITALIC_SKEW : 0;
    maxSeg = Math.min(maxSeg, Math.max(0.5, run.sizePx / 12));
    let pen = run.x;
    // Right-to-left runs are laid out left to right in reverse cluster order.
    const order = run.clusters.map((_, k) => k);
    if (run.rtl) order.reverse();
    for (const k of order) {
      let x = pen, prev = -1;
      for (const ch of run.clusters[k].replace(IGNORABLE, '')) {
        const gid = sf.glyphIndex(ch.codePointAt(0)!);
        if (prev >= 0 && run.kerning) x += sf.kerning(prev, gid) * s * run.scaleX;
        const g = sf.glyph(gid, coords);
        const ox = x, oy = run.y;
        // Path text runs are rotated about their origin.
        const cos = Math.cos(run.angle ?? 0), sin = Math.sin(run.angle ?? 0);
        const map = (gx: number, gy: number): [number, number] => {
          const u = (x - run.x) + (gx + gy * skew) * s * run.scaleX, v = -gy * s * run.scaleY;
          return run.angle ? [run.x + u * cos - v * sin, oy + u * sin + v * cos] : [ox + (gx + gy * skew) * s * run.scaleX, oy + v];
        };
        for (const c of g.contours) {
          const cmds = contourToCommands(c, map);
          if (cmds.length) contours.push(cmds);
        }
        x += g.advance * s * run.scaleX;
        prev = gid;
      }
      pen += run.advances[k];
    }
  }
  for (const d of layout.decorations) {
    if (d.points) {
      contours.push(strokeOutline(d.points, d.thickness));
      continue;
    }
    const t = d.thickness / 2;
    const r = d.vertical ? { x: d.x - t, y: d.y, w: d.thickness, h: d.width } : { x: d.x, y: d.y - t, w: d.width, h: d.thickness };
    contours.push([['M', r.x, r.y], ['L', r.x + r.w, r.y], ['L', r.x + r.w, r.y + r.h], ['L', r.x, r.y + r.h], ['Z']]);
  }
  const out = warp ? contours.map((c) => warpContour(c, (x, y) => warpPoint(warp, wrect, x, y), maxSeg)) : contours;
  return { d: toSvg(out), contours: out, bounds: pathBounds(out), missingFonts: [...missing], approximations: [...approx] };
}

// Loads outline data for every bundled family the layer uses, then converts.
export async function textToPathAsync(data: TextLayerData, opts: { resolution?: number } = {}): Promise<TextPath> {
  const loaded = new Map<string, SfntFont>();
  const want = new Set<string>([`${FALLBACK_FAMILY}|false`]);
  for (const p of data.content.paragraphs) for (const r of p.runs) want.add(`${r.style.family}|${r.style.italic}`);
  await Promise.all([...want].map(async (key) => {
    const [family, it] = key.split('|');
    const b = findBundled(family);
    if (!b) return;
    const italic = it === 'true' && b.faces.some((f) => f.italic);
    try { loaded.set(`${b.family.toLowerCase()}|${italic}`, parseFont(await loadFontFile(b.family, italic))); } catch { /* reported as missing */ }
  }));
  return textToPath(data, { ...opts, fonts: (family, italic) => loaded.get(`${family.toLowerCase()}|${italic}`) });
}

// Closed outline of a polyline stroked with butt ends.
function strokeOutline(pts: [number, number][], width: number): PathCommand[] {
  const h = width / 2;
  const normal = (i: number): [number, number] => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  };
  const left: [number, number][] = [], right: [number, number][] = [];
  pts.forEach((p, i) => {
    const [nx, ny] = normal(i);
    left.push([p[0] + nx * h, p[1] + ny * h]);
    right.push([p[0] - nx * h, p[1] - ny * h]);
  });
  const ring = [...left, ...right.reverse()];
  return [['M', ...ring[0]], ...ring.slice(1).map((p) => ['L', ...p] as PathCommand), ['Z']];
}

// TrueType quadratic contour (on/off points, implied midpoints) to commands.
function contourToCommands(pts: GlyphPoint[], map: (x: number, y: number) => [number, number]): PathCommand[] {
  const n = pts.length;
  if (!n) return [];
  let first = pts.findIndex((p) => p.on);
  let start: { x: number; y: number };
  if (first < 0) {
    start = { x: (pts[0].x + pts[1 % n].x) / 2, y: (pts[0].y + pts[1 % n].y) / 2 };
    first = 0;
  } else start = pts[first];
  const out: PathCommand[] = [['M', ...map(start.x, start.y)]];
  let ctrl: GlyphPoint | null = null;
  const startIdx = pts[first].on ? first + 1 : first;
  for (let k = 0; k < n; k++) {
    const p = pts[(startIdx + k) % n];
    if (p.on) {
      if (ctrl) out.push(['Q', ...map(ctrl.x, ctrl.y), ...map(p.x, p.y)]);
      else out.push(['L', ...map(p.x, p.y)]);
      ctrl = null;
    } else {
      if (ctrl) {
        const mx = (ctrl.x + p.x) / 2, my = (ctrl.y + p.y) / 2;
        out.push(['Q', ...map(ctrl.x, ctrl.y), ...map(mx, my)]);
      }
      ctrl = p;
    }
  }
  if (ctrl) out.push(['Q', ...map(ctrl.x, ctrl.y), ...map(start.x, start.y)]);
  out.push(['Z']);
  return out;
}

// Applies a nonlinear point map to a contour, subdividing so straight
// segments become curves and curves follow the warp closely.
function warpContour(c: PathCommand[], f: (x: number, y: number) => [number, number], maxSeg: number): PathCommand[] {
  const out: PathCommand[] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  for (const cmd of c) {
    if (cmd[0] === 'M') {
      [cx, cy] = [cmd[1], cmd[2]];
      [sx, sy] = [cx, cy];
      out.push(['M', ...f(cx, cy)]);
    } else if (cmd[0] === 'L' || cmd[0] === 'Z') {
      const [x, y] = cmd[0] === 'L' ? [cmd[1], cmd[2]] : [sx, sy];
      const n = Math.max(1, Math.ceil(Math.hypot(x - cx, y - cy) / maxSeg));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        out.push(['L', ...f(cx + (x - cx) * t, cy + (y - cy) * t)]);
      }
      [cx, cy] = [x, y];
      if (cmd[0] === 'Z') out.push(['Z']);
    } else {
      const [, qx, qy, x, y] = cmd;
      const n = Math.max(1, Math.ceil((Math.hypot(qx - cx, qy - cy) + Math.hypot(x - qx, y - qy)) / maxSeg));
      const at = (t: number): [number, number] => [(1 - t) * (1 - t) * cx + 2 * (1 - t) * t * qx + t * t * x, (1 - t) * (1 - t) * cy + 2 * (1 - t) * t * qy + t * t * y];
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const p0 = at(t0), p2 = at(t1);
        // The mapped control point is chosen so the mapped curve passes
        // through the mapped midpoint of the piece (exact at the ends and middle).
        const m0 = f(...p0), m2 = f(...p2), mid = f(...at((t0 + t1) / 2));
        out.push(['Q', 2 * mid[0] - (m0[0] + m2[0]) / 2, 2 * mid[1] - (m0[1] + m2[1]) / 2, m2[0], m2[1]]);
      }
      [cx, cy] = [x, y];
    }
  }
  return out;
}

const num = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
export function toSvg(contours: PathCommand[][]): string {
  const parts: string[] = [];
  for (const c of contours) for (const cmd of c) parts.push(cmd[0] === 'Z' ? 'Z' : cmd[0] + cmd.slice(1).map((v) => num(v as number)).join(' '));
  return parts.join('');
}
function pathBounds(contours: PathCommand[][]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of contours)
    for (const cmd of c)
      for (let i = 1; i + 1 < cmd.length; i += 2) {
        const x = cmd[i] as number, y = cmd[i + 1] as number;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  return x0 === Infinity ? { x: 0, y: 0, width: 0, height: 0 } : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
