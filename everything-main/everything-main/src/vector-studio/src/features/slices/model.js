/**
 * Slices: rectangular regions of the document exported as separate web
 * images (Save for Web, Save Selected Slices).
 *
 * doc.root.slices lists the slices you make, back to front:
 *   { id, kind: 'user', x, y, w, h, ...options }          a drawn rectangle
 *   { id, kind: 'object', node, ...options }              follows an object's visual bounds
 * options: name, type ('image' | 'noImage' | 'html'), url, target, message,
 * alt, bg (null | '#rrggbb'), html (text for No Image slices),
 * export (Save for Web settings for this slice).
 *
 * doc.root.sliceClip (default true) clips slices to the artboard ("Clip to
 * Artboard"); the slicing area is then each artboard, otherwise the bounds
 * of all artwork and slices. The parts of the area no slice covers become
 * auto slices: a table-like partition into rows of rectangles, recomputed
 * whenever slices change. Slices are numbered in reading order (top to
 * bottom, then left to right) across user, object and auto slices.
 */
import { uid } from '../../lib/ids.js';
import { visualBounds, unionRect, rectsIntersect } from '../../model/geometry.js';

export const SLICE_TYPES = [
  { value: 'image', label: 'Image' },
  { value: 'noImage', label: 'No Image' },
  { value: 'html', label: 'HTML Text' },
];

export const TARGETS = ['', '_blank', '_self', '_parent', '_top'];

export function slicesOf(doc) {
  return doc.root.slices || [];
}

export function clipsToArtboard(doc) {
  return doc.root.sliceClip !== false;
}

export function findSlice(doc, id) {
  return slicesOf(doc).find((s) => s.id === id) || null;
}

/** Whole-unit rectangle covering r (slices are exported on the pixel grid). */
export function pixelRect(r) {
  const x = Math.floor(r.x + 1e-6);
  const y = Math.floor(r.y + 1e-6);
  const x2 = Math.ceil(r.x + r.w - 1e-6);
  const y2 = Math.ceil(r.y + r.h - 1e-6);
  return { x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
}

/** The document rectangle of a stored slice, or null (object slice whose object is gone or empty). */
export function sliceRect(doc, s) {
  if (s.kind === 'object') {
    const n = doc.get(s.node);
    if (!n) return null;
    const b = visualBounds(doc, n);
    return b ? pixelRect(b) : null;
  }
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}

/** Default slice name: the document name and a two-digit number, e.g. "Poster_03". */
export function defaultSliceName(doc, number) {
  const base = String(doc.root.name || 'Untitled').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_') || 'Untitled';
  return `${base}_${String(number).padStart(2, '0')}`;
}

/** Areas that slices divide: one per artboard when clipping, else the bounds of everything. */
export function sliceAreas(doc) {
  if (clipsToArtboard(doc)) return doc.artboards.map((a, i) => ({ x: a.x, y: a.y, w: a.w, h: a.h, artboard: i }));
  let b = null;
  for (const id of doc.root.children) {
    const l = doc.get(id);
    if (l && !l.hidden && !l.pattern) b = unionRect(b, visualBounds(doc, l));
  }
  for (const s of slicesOf(doc)) b = unionRect(b, sliceRect(doc, s));
  return b ? [{ ...pixelRect(b), artboard: -1 }] : [];
}

function clip(r, area) {
  const x = Math.max(r.x, area.x);
  const y = Math.max(r.y, area.y);
  const x2 = Math.min(r.x + r.w, area.x + area.w);
  const y2 = Math.min(r.y + r.h, area.y + area.h);
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
}

/**
 * Auto slices for an area around the given rectangles: horizontal bands at
 * every slice edge, each split at the slices crossing it; bands with the
 * same columns stacked directly above each other merge.
 */
export function autoSlices(area, rects) {
  const inside = rects.map((r) => clip(r, area)).filter(Boolean);
  const ys = [...new Set([area.y, area.y + area.h, ...inside.flatMap((r) => [r.y, r.y + r.h])])].sort((a, b) => a - b);
  const out = [];
  let open = new Map(); // "x0,x1" -> rect still growing downwards
  for (let i = 0; i < ys.length - 1; i++) {
    const y0 = ys[i];
    const y1 = ys[i + 1];
    if (y1 - y0 < 1e-9) continue;
    const spans = inside.filter((r) => r.y < y1 - 1e-9 && r.y + r.h > y0 + 1e-9).map((r) => [r.x, r.x + r.w]).sort((a, b) => a[0] - b[0]);
    const gaps = [];
    let x = area.x;
    for (const [a, b] of spans) {
      if (a > x + 1e-9) gaps.push([x, a]);
      x = Math.max(x, b);
    }
    if (area.x + area.w > x + 1e-9) gaps.push([x, area.x + area.w]);
    const next = new Map();
    for (const [a, b] of gaps) {
      const key = `${a},${b}`;
      const prev = open.get(key);
      if (prev && Math.abs(prev.y + prev.h - y0) < 1e-9) {
        prev.h = y1 - prev.y;
        next.set(key, prev);
      } else {
        const r = { x: a, y: y0, w: b - a, h: y1 - y0 };
        out.push(r);
        next.set(key, r);
      }
    }
    open = next;
  }
  return out;
}

const readingOrder = (a, b) => (Math.abs(a.rect.y - b.rect.y) > 1e-6 ? a.rect.y - b.rect.y : a.rect.x - b.rect.x);

/**
 * Every slice of the document, numbered: [{ id, kind, rect, number, slice,
 * area }] where auto slices have ids "auto:<area>:<n>" and no `slice`.
 * Stored slices are clipped to their area when clipping is on (a slice
 * crossing two artboards appears in both).
 */
export function sliceTable(doc) {
  const stored = slicesOf(doc)
    .map((s) => ({ s, r: sliceRect(doc, s) }))
    .filter((x) => x.r);
  const rows = [];
  const areas = sliceAreas(doc);
  areas.forEach((area, ai) => {
    const mine = [];
    for (const { s, r } of stored) {
      const c = clipsToArtboard(doc) ? clip(r, area) : r;
      if (c) mine.push({ id: s.id, kind: s.kind, rect: c, slice: s, area: ai });
    }
    rows.push(...mine);
    autoSlices(area, mine.map((m) => m.rect)).forEach((r, i) => rows.push({ id: `auto:${ai}:${i}`, kind: 'auto', rect: r, slice: null, area: ai }));
  });
  // Without an area (empty document, no clipping) user slices still show.
  if (!areas.length) for (const { s, r } of stored) rows.push({ id: s.id, kind: s.kind, rect: r, slice: s, area: -1 });
  rows.sort((a, b) => a.area - b.area || readingOrder(a, b));
  rows.forEach((row, i) => (row.number = i + 1));
  return rows;
}

/** The slice row under a document point (user and object slices before auto ones, front first). */
export function sliceAt(table, x, y) {
  const hit = (r) => x >= r.rect.x && y >= r.rect.y && x <= r.rect.x + r.rect.w && y <= r.rect.y + r.rect.h;
  const stored = table.filter((r) => r.kind !== 'auto' && hit(r));
  if (stored.length) return stored[stored.length - 1];
  return table.find((r) => r.kind === 'auto' && hit(r)) || null;
}

// ---- edits (inside a transaction) ----

function write(doc, list) {
  doc.updateRoot({ slices: list });
}

export function addSlice(doc, slice, index = Infinity) {
  const list = slicesOf(doc).slice();
  const s = { name: '', type: 'image', ...slice, id: slice.id || uid('sl') };
  if (s.kind !== 'object') Object.assign(s, pixelRect(s), { kind: 'user' });
  list.splice(Math.min(index, list.length), 0, s);
  write(doc, list);
  return s;
}

export function updateSlice(doc, id, patch) {
  write(
    doc,
    slicesOf(doc).map((s) => {
      if (s.id !== id) return s;
      const next = { ...s, ...patch };
      return next.kind === 'user' && ('x' in patch || 'w' in patch || 'y' in patch || 'h' in patch) ? { ...next, ...pixelRect(next) } : next;
    }),
  );
}

export function removeSlices(doc, ids) {
  const set = new Set(ids);
  write(doc, slicesOf(doc).filter((s) => !set.has(s.id)));
}

/** A user slice for an auto slice row (so it can be moved, resized or given options). Returns its id. */
export function promote(doc, row) {
  if (row.kind !== 'auto') return row.id;
  return addSlice(doc, { kind: 'user', ...row.rect }).id;
}

/** Object > Slice > Make: an object slice for each object that has none. Returns the new ids. */
export function makeObjectSlices(doc, nodeIds) {
  const have = new Set(slicesOf(doc).filter((s) => s.kind === 'object').map((s) => s.node));
  const out = [];
  for (const id of nodeIds) if (!have.has(id) && doc.has(id)) out.push(addSlice(doc, { kind: 'object', node: id }).id);
  return out;
}

/** Object > Slice > Create from Selection: a user slice around each object. */
export function slicesFromSelection(doc, nodeIds) {
  const out = [];
  for (const id of nodeIds) {
    const b = visualBounds(doc, doc.get(id));
    if (b) out.push(addSlice(doc, { kind: 'user', ...pixelRect(b) }).id);
  }
  return out;
}

/**
 * Object > Slice > Create from Guides: the cells between the guides over an
 * area replace the user slices there.
 */
export function slicesFromGuides(doc, area) {
  const guides = doc.root.guides || [];
  const xs = [...new Set([area.x, area.x + area.w, ...guides.filter((g) => g.axis === 'x' && g.pos > area.x && g.pos < area.x + area.w).map((g) => Math.round(g.pos))])].sort((a, b) => a - b);
  const ys = [...new Set([area.y, area.y + area.h, ...guides.filter((g) => g.axis === 'y' && g.pos > area.y && g.pos < area.y + area.h).map((g) => Math.round(g.pos))])].sort((a, b) => a - b);
  const keep = slicesOf(doc).filter((s) => s.kind !== 'user' || !rectsIntersect(sliceRect(doc, s), area));
  write(doc, keep);
  const out = [];
  for (let j = 0; j < ys.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) out.push(addSlice(doc, { kind: 'user', x: xs[i], y: ys[j], w: xs[i + 1] - xs[i], h: ys[j + 1] - ys[j] }).id);
  return out;
}

/** Duplicate slices offset down and right. Returns the copies' ids. */
export function duplicateSlices(doc, ids, offset = 10) {
  const out = [];
  for (const id of ids) {
    const s = findSlice(doc, id);
    if (!s) continue;
    const r = sliceRect(doc, s);
    if (!r) continue;
    const { id: _old, node: _node, kind: _kind, ...opts } = s;
    out.push(addSlice(doc, { ...opts, name: '', kind: 'user', x: r.x + offset, y: r.y + offset, w: r.w, h: r.h }).id);
  }
  return out;
}

/** Combine slices into one user slice covering them all (keeps the first one's options). */
export function combineSlices(doc, ids) {
  const list = ids.map((id) => findSlice(doc, id)).filter(Boolean);
  if (list.length < 2) return null;
  let b = null;
  for (const s of list) b = unionRect(b, sliceRect(doc, s));
  if (!b) return null;
  const first = list[0];
  const index = slicesOf(doc).indexOf(first);
  removeSlices(doc, ids);
  const { id: _id, node: _node, kind: _kind, x: _x, y: _y, w: _w, h: _h, ...opts } = first;
  return addSlice(doc, { ...opts, kind: 'user', ...b }, index).id;
}

/**
 * Divide a rectangle into a grid. Each axis is { count } (equal parts) or
 * { size } (parts of that size, the last one taking the rest).
 */
export function divideRect(r, across = { count: 1 }, down = { count: 1 }) {
  const cuts = (start, len, spec) => {
    const out = [start];
    if (spec.size > 0) for (let p = start + spec.size; p < start + len - 0.5; p += spec.size) out.push(Math.round(p));
    else {
      const n = Math.max(1, Math.round(spec.count || 1));
      for (let i = 1; i < n; i++) out.push(Math.round(start + (len * i) / n));
    }
    out.push(start + len);
    return [...new Set(out)];
  };
  const xs = cuts(r.x, r.w, across);
  const ys = cuts(r.y, r.h, down);
  const out = [];
  for (let j = 0; j < ys.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) out.push({ x: xs[i], y: ys[j], w: xs[i + 1] - xs[i], h: ys[j + 1] - ys[j] });
  return out;
}

/** Object > Slice > Divide Slices: replace each slice with a grid of user slices. Returns the new ids. */
export function divideSlices(doc, ids, across, down) {
  const out = [];
  for (const id of ids) {
    const s = findSlice(doc, id);
    const r = s && sliceRect(doc, s);
    if (!r) continue;
    const index = slicesOf(doc).indexOf(s);
    removeSlices(doc, [id]);
    divideRect(r, across, down).forEach((cell, k) => out.push(addSlice(doc, { kind: 'user', type: s.type, bg: s.bg ?? null, export: s.export, ...cell }, index + k).id));
  }
  return out;
}

/** Slice ids attached to any of the given objects (object slices). */
export function objectSliceIds(doc, nodeIds) {
  const set = new Set(nodeIds);
  return slicesOf(doc).filter((s) => s.kind === 'object' && set.has(s.node)).map((s) => s.id);
}
