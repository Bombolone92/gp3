// Measurement geometry for the Ruler tool, the measurement scale and the
// Info panel: line lengths and angles, the two-line protractor, physical
// units and averaged color samples. Pure functions; coordinates are
// document pixels with y pointing down.
import type { RGBA8 } from '../types';

export type Point = { x: number; y: number };
const RAD = Math.PI / 180;

/** Angle of the line a→b in degrees, counterclockwise from the positive x
 * axis as seen on screen (a line rising to the right is positive), in
 * (-180, 180]. */
export function lineAngle(a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  if (!dx && !dy) return 0;
  let deg = Math.atan2(-dy, dx) / RAD;
  if (deg <= -180) deg += 360;
  // Avoid "-0.0" readouts.
  return deg === 0 ? 0 : deg;
}
export const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** Angle between the lines vertex→p1 and vertex→p2, in [0, 180] degrees. */
export function angleBetween(vertex: Point, p1: Point, p2: Point): number {
  const ax = p1.x - vertex.x,
    ay = p1.y - vertex.y,
    bx = p2.x - vertex.x,
    by = p2.y - vertex.y;
  if ((!ax && !ay) || (!bx && !by)) return 0;
  return Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) / RAD;
}

/** A ruler measurement: one line a→b, or a protractor with a second line
 * from the shared vertex `a` to `c`. */
export type RulerLine = { a: Point; b: Point; c?: Point };
export type RulerMetrics = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  // Angle of the first line, or the protractor angle between both lines.
  angle: number;
  length: number;
  l1: number;
  l2?: number;
};
export function rulerMetrics(r: RulerLine): RulerMetrics {
  const l1 = distance(r.a, r.b);
  if (r.c) {
    return { x: r.a.x, y: r.a.y, dx: r.b.x - r.a.x, dy: r.b.y - r.a.y, angle: angleBetween(r.a, r.b, r.c), length: l1, l1, l2: distance(r.a, r.c) };
  }
  return { x: r.a.x, y: r.a.y, dx: r.b.x - r.a.x, dy: r.b.y - r.a.y, angle: lineAngle(r.a, r.b), length: l1, l1 };
}

/** Rotation (degrees, clockwise positive on screen) that makes the line
 * horizontal, or vertical when it is closer to vertical. */
export function levelingRotation(a: Point, b: Point): number {
  const deg = Math.atan2(b.y - a.y, b.x - a.x) / RAD;
  let r = -deg;
  while (r > 45) r -= 90;
  while (r <= -45) r += 90;
  return r === 0 ? 0 : r;
}

/** Constrain `p` to the nearest multiple of 45 degrees around `from`. */
export function snapAngle(from: Point, p: Point): Point {
  const len = distance(from, p);
  const step = 45 * RAD;
  const a = Math.round(Math.atan2(p.y - from.y, p.x - from.x) / step) * step;
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
}

// ----- Measurement scale -----
/** `pixels` image pixels correspond to `length` real-world `units`. */
export type MeasurementScale = { pixels: number; length: number; units: string };
export const defaultScale: MeasurementScale = { pixels: 1, length: 1, units: 'pixels' };
export const isDefaultScale = (s: MeasurementScale | undefined) => !s || (s.pixels === s.length && s.units === 'pixels');
/** Real-world units per pixel. */
export const scaleFactor = (s: MeasurementScale = defaultScale) => s.length / s.pixels;
export const scaledLength = (px: number, s?: MeasurementScale) => px * scaleFactor(s);
export const scaledArea = (px2: number, s?: MeasurementScale) => px2 * scaleFactor(s) ** 2;
export function validScale(s: unknown): s is MeasurementScale {
  const v = s as MeasurementScale;
  return !!v && typeof v === 'object' && Number.isFinite(v.pixels) && v.pixels > 0 && v.pixels <= 1e7 &&
    Number.isFinite(v.length) && v.length > 0 && v.length <= 1e12 && typeof v.units === 'string' && v.units.length > 0 && v.units.length <= 32;
}

// ----- Ruler units (Info panel and rulers) -----
export type RulerUnit = 'px' | 'in' | 'cm' | 'mm' | 'pt' | 'pica' | 'percent';
export const RULER_UNITS: [RulerUnit, string, string][] = [
  ['px', 'Pixels', 'px'],
  ['in', 'Inches', 'in'],
  ['cm', 'Centimeters', 'cm'],
  ['mm', 'Millimeters', 'mm'],
  ['pt', 'Points', 'pt'],
  ['pica', 'Picas', 'pc'],
  ['percent', 'Percent', '%'],
];
const unitsPerInch: Record<string, number> = { in: 1, cm: 2.54, mm: 25.4, pt: 72, pica: 6 };
/** Pixels in one unit at `ppi`; percent is relative to `base` pixels. */
export function pixelsPerUnit(unit: RulerUnit, ppi: number, base: number): number {
  if (unit === 'px') return 1;
  if (unit === 'percent') return base / 100;
  return ppi / unitsPerInch[unit];
}
export const toUnit = (px: number, unit: RulerUnit, ppi: number, base: number) => px / pixelsPerUnit(unit, ppi, base);
export function formatUnit(px: number, unit: RulerUnit, ppi: number, base: number): string {
  const v = toUnit(px, unit, ppi, base);
  const digits = unit === 'px' ? 0 : unit === 'in' ? 3 : unit === 'mm' || unit === 'pt' || unit === 'percent' ? 1 : 2;
  return `${round(v, digits)}`;
}

/** Fixed-point string without a trailing "-0". */
export function round(v: number, digits: number): string {
  const s = v.toFixed(digits);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

/** Up to `digits` decimals with trailing zeros removed ("2.5", "120"). */
export const short = (v: number, digits: number) => round(v, digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

// ----- Sampling -----
export const SAMPLE_SIZES = [1, 3, 5, 11, 31, 51, 101];
/** Average color of a size x size square centered on the pixel containing
 * (x, y), weighting colors by alpha (transparent pixels do not darken the
 * result). Returns straight RGBA or null when every sampled pixel is
 * transparent or outside the image. */
export function sampleAverage(img: RGBA8, x: number, y: number, size = 1): [number, number, number, number] | null {
  const r = Math.max(0, Math.floor((size - 1) / 2));
  const cx = Math.floor(x),
    cy = Math.floor(y);
  let sr = 0,
    sg = 0,
    sb = 0,
    sa = 0,
    n = 0;
  for (let py = cy - r; py <= cy + r; py++) {
    if (py < 0 || py >= img.height) continue;
    for (let px = cx - r; px <= cx + r; px++) {
      if (px < 0 || px >= img.width) continue;
      const i = (py * img.width + px) * 4,
        a = img.data[i + 3];
      sr += img.data[i] * a;
      sg += img.data[i + 1] * a;
      sb += img.data[i + 2] * a;
      sa += a;
      n++;
    }
  }
  if (!n || !sa) return null;
  return [sr / sa, sg / sa, sb / sa, sa / n];
}
