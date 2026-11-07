// Alignment guides shown while moving layers: the moving bounds snap to the
// edges and centers of other layers and the canvas, or to an equal spacing
// between neighbours, and the matches are reported for drawing. Pure math on
// axis-aligned rectangles in document pixels.
import type { Rect } from './document';
import type { SnapTargets } from './transform';

// A line along which edges or centers line up. `axis: 'x'` is a vertical
// line at x = `at`, drawn from y = `from` to `to` (and vice versa).
export type AlignmentLine = { axis: 'x' | 'y'; at: number; from: number; to: number };
// An equal gap: for `axis: 'x'` a horizontal span from x = `from` to `to`
// drawn at y = `at`; `gap` is its length in pixels.
export type SpacingMark = { axis: 'x' | 'y'; from: number; to: number; at: number; gap: number };
export type SmartGuideResult = { dx: number; dy: number; lines: AlignmentLine[]; spacing: SpacingMark[] };
export type SmartGuideInput = {
  moving: Rect;
  // Bounds of other layers (alignment and spacing targets).
  rects: Rect[];
  // Canvas bounds: lines span it, and its edges and center are targets when `snapCanvas`.
  canvas: Rect;
  snapCanvas?: boolean;
  // Guides and grid lines: snapping targets drawn across the canvas.
  lines?: SnapTargets;
  // Snapping distance in document pixels; 0 reports exact matches only.
  threshold: number;
  // Equal-spacing detection (on by default).
  spacing?: boolean;
};

type Span = { start: number; end: number };
const EPS = 0.01;
const along = (r: Rect, axis: 'x' | 'y'): Span => (axis === 'x' ? { start: r.x, end: r.x + r.width } : { start: r.y, end: r.y + r.height });
const across = (r: Rect, axis: 'x' | 'y') => along(r, axis === 'x' ? 'y' : 'x');
const marks = (s: Span) => [s.start, (s.start + s.end) / 2, s.end];
const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

/** Best snapping offset along one axis and the gap it produces, if spacing won. */
function solveAxis(input: SmartGuideInput, axis: 'x' | 'y') {
  const m = along(input.moving, axis);
  const t = input.threshold;
  let best: { delta: number; gap?: number } | undefined;
  const consider = (delta: number, gap?: number) => {
    if (Math.abs(delta) > t + 1e-9) return;
    // Alignment wins ties over spacing.
    if (!best || Math.abs(delta) < Math.abs(best.delta) - 1e-9 || (Math.abs(Math.abs(delta) - Math.abs(best.delta)) < 1e-9 && best.gap !== undefined && gap === undefined))
      best = { delta, gap };
  };
  const targets: number[] = [];
  for (const r of input.rects) targets.push(...marks(along(r, axis)));
  if (input.snapCanvas) targets.push(...marks(along(input.canvas, axis)));
  targets.push(...(input.lines?.[axis] ?? []));
  for (const v of marks(m)) for (const target of targets) consider(target - v);
  if (input.spacing !== false) for (const option of spacingOptions(input, axis)) consider(option.start - m.start, option.gap);
  return best;
}

// Neighbours in the same row (or column) as the moving rectangle, and the
// gaps between consecutive ones.
function row(input: SmartGuideInput, axis: 'x' | 'y') {
  const cross = across(input.moving, axis);
  return input.rects.filter((r) => overlaps(across(r, axis), cross)).map((r) => ({ rect: r, span: along(r, axis) }));
}
function gapsBetween(items: { span: Span; rect: Rect }[]) {
  const sorted = [...items].sort((a, b) => a.span.start - b.span.start);
  const out: { a: (typeof items)[0]; b: (typeof items)[0]; gap: number }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    // The nearest following item that does not overlap this one.
    const next = sorted.slice(i + 1).filter((s) => s.span.start >= sorted[i].span.end).sort((p, q) => p.span.start - q.span.start)[0];
    if (next) out.push({ a: sorted[i], b: next, gap: next.span.start - sorted[i].span.end });
  }
  return out;
}
function spacingOptions(input: SmartGuideInput, axis: 'x' | 'y') {
  const m = along(input.moving, axis);
  const size = m.end - m.start,
    center = (m.start + m.end) / 2;
  const items = row(input, axis);
  const before = items.filter((i) => (i.span.start + i.span.end) / 2 < center && i.span.end <= center).sort((a, b) => b.span.end - a.span.end)[0];
  const after = items.filter((i) => (i.span.start + i.span.end) / 2 > center && i.span.start >= center).sort((a, b) => a.span.start - b.span.start)[0];
  const options: { start: number; gap: number }[] = [];
  if (before && after) {
    const gap = (after.span.start - before.span.end - size) / 2;
    if (gap > 0) options.push({ start: before.span.end + gap, gap });
  }
  for (const { gap } of gapsBetween(items)) {
    if (gap <= 0) continue;
    if (before) options.push({ start: before.span.end + gap, gap });
    if (after) options.push({ start: after.span.start - gap - size, gap });
  }
  return options;
}

/** Snap a moving rectangle and describe the alignment and spacing it shows. */
export function smartGuides(input: SmartGuideInput): SmartGuideResult {
  const sx = solveAxis(input, 'x'),
    sy = solveAxis(input, 'y');
  const dx = sx?.delta ?? 0,
    dy = sy?.delta ?? 0;
  const moved: Rect = { ...input.moving, x: input.moving.x + dx, y: input.moving.y + dy };
  const settled = { ...input, moving: moved };
  return { dx, dy, lines: [...alignmentLines(settled, 'x'), ...alignmentLines(settled, 'y')], spacing: [...spacingMarks(settled, 'x'), ...spacingMarks(settled, 'y')] };
}

function alignmentLines(input: SmartGuideInput, axis: 'x' | 'y'): AlignmentLine[] {
  const m = along(input.moving, axis),
    cross = across(input.moving, axis);
  const found = new Map<number, AlignmentLine>();
  const add = (at: number, span: Span) => {
    const key = Math.round(at * 100);
    const line = found.get(key);
    if (line) {
      line.from = Math.min(line.from, span.start);
      line.to = Math.max(line.to, span.end);
    } else found.set(key, { axis, at, from: span.start, to: span.end });
  };
  const values = marks(m);
  for (const r of input.rects) {
    const rc = across(r, axis);
    for (const target of marks(along(r, axis)))
      if (values.some((v) => Math.abs(v - target) < EPS)) add(target, { start: Math.min(cross.start, rc.start), end: Math.max(cross.end, rc.end) });
  }
  const canvasSpan = across(input.canvas, axis);
  const canvasTargets = [...(input.snapCanvas ? marks(along(input.canvas, axis)) : []), ...(input.lines?.[axis] ?? [])];
  for (const target of canvasTargets) if (values.some((v) => Math.abs(v - target) < EPS)) add(target, canvasSpan);
  return [...found.values()];
}

function spacingMarks(input: SmartGuideInput, axis: 'x' | 'y'): SpacingMark[] {
  if (input.spacing === false) return [];
  const m = along(input.moving, axis);
  const items = row(input, axis);
  const center = (m.start + m.end) / 2;
  const before = items.filter((i) => i.span.end <= m.start + EPS && (i.span.start + i.span.end) / 2 < center).sort((a, b) => b.span.end - a.span.end)[0];
  const after = items.filter((i) => i.span.start >= m.end - EPS && (i.span.start + i.span.end) / 2 > center).sort((a, b) => a.span.start - b.span.start)[0];
  const own: { a: Rect; b: Rect; gap: number; start: number; end: number }[] = [];
  if (before) own.push({ a: before.rect, b: input.moving, gap: m.start - before.span.end, start: before.span.end, end: m.start });
  if (after) own.push({ a: input.moving, b: after.rect, gap: after.span.start - m.end, start: m.end, end: after.span.start });
  const others = gapsBetween(items);
  const mid = (a: Rect, b: Rect) => {
    const ca = across(a, axis),
      cb = across(b, axis);
    return (Math.max(ca.start, cb.start) + Math.min(ca.end, cb.end)) / 2;
  };
  const out: SpacingMark[] = [];
  for (const g of own) {
    if (g.gap <= EPS) continue;
    const equal = others.filter((o) => Math.abs(o.gap - g.gap) < 0.5);
    const twin = own.find((o) => o !== g && Math.abs(o.gap - g.gap) < 0.5);
    if (!equal.length && !twin) continue;
    out.push({ axis, from: g.start, to: g.end, at: mid(g.a, g.b), gap: g.gap });
    for (const o of equal) out.push({ axis, from: o.a.span.end, to: o.b.span.start, at: mid(o.a.rect, o.b.rect), gap: o.gap });
  }
  // Each matching gap once.
  const seen = new Set<string>();
  return out.filter((s) => {
    const key = `${Math.round(s.from * 10)}:${Math.round(s.to * 10)}:${Math.round(s.at)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
