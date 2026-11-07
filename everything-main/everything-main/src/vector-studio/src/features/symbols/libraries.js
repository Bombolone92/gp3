/**
 * Symbol libraries: sets of ready-made symbols (original artwork) that can
 * be placed into any document. Each symbol is drawn in a 64 x 64 box as a
 * list of parts { d (SVG path data), fill, stroke, width, cap, join, rule };
 * placing one adds its definition to the document once (matched by
 * `symbolDef.source`), then places instances of it.
 */
import { parsePathData } from '../io/svg-path.js';
import { createPath, createCompound } from '../../model/nodes.js';
import { addDefinition, symbolDefs } from './model.js';

// ---- drawing helpers (path data in the 64 x 64 box) ----

const f = (n) => Number(n.toFixed(2));

function circle(cx, cy, r) {
  return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0z`;
}

/** A star or burst: `n` points between radii r1 (outer) and r2 (inner), first point up. */
function burst(cx, cy, r1, r2, n, turn = 0) {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = -Math.PI / 2 + (i * Math.PI) / n + turn;
    d += `${i ? 'L' : 'M'}${f(cx + Math.cos(a) * r)} ${f(cy + Math.sin(a) * r)}`;
  }
  return `${d}z`;
}

/** Regular polygon with `n` sides, first corner up. */
function polygon(cx, cy, r, n, turn = 0) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n + turn;
    d += `${i ? 'L' : 'M'}${f(cx + Math.cos(a) * r)} ${f(cy + Math.sin(a) * r)}`;
  }
  return `${d}z`;
}

/** Short strokes radiating from a center (sun rays, sparkles). */
function rays(cx, cy, r1, r2, n, turn = 0) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n + turn;
    d += `M${f(cx + Math.cos(a) * r1)} ${f(cy + Math.sin(a) * r1)}L${f(cx + Math.cos(a) * r2)} ${f(cy + Math.sin(a) * r2)}`;
  }
  return d;
}

// A puffy cloud, base line at y = 46.
const CLOUD = 'M18 46a10 10 0 0 1-1.2-19.9A14 14 0 0 1 44 22a11 11 0 0 1 3 24z';
const RAIN_CLOUD = 'M18 40a10 10 0 0 1-1.2-19.9A14 14 0 0 1 44 16a11 11 0 0 1 3 24z';

const fill = (d, color, extra = {}) => ({ d, fill: color, ...extra });
const line = (d, color, width = 4, extra = {}) => ({ d, stroke: color, width, cap: 'round', join: 'round', ...extra });

// ---- the libraries ----

export const SYMBOL_LIBRARIES = [
  {
    id: 'arrows',
    name: 'Arrows',
    symbols: [
      { id: 'right', name: 'Block Arrow', parts: [fill('M6 24h30V12l22 20-22 20V40H6z', '#2f6fde')] },
      { id: 'double', name: 'Double Arrow', parts: [fill('M4 32 18 18v8h28v-8l14 14-14 14v-8H18v8z', '#1f9d8b')] },
      { id: 'chevron', name: 'Chevron', parts: [line('M24 12l20 20-20 20', '#33363d', 8)] },
      { id: 'circle-right', name: 'Circled Arrow', parts: [fill(circle(32, 32, 26), '#f0a020'), line('M20 32h22M33 22l10 10-10 10', '#ffffff', 5)] },
      { id: 'return', name: 'Return Arrow', parts: [line('M50 12v18a8 8 0 0 1-8 8H16M26 27 15 38l11 11', '#5b4bdb', 6)] },
      { id: 'curve', name: 'Curved Arrow', parts: [line('M10 50C12 26 28 14 48 16', '#e2543b', 5), fill('M40 6l16 10-14 12z', '#e2543b')] },
      { id: 'cycle', name: 'Cycle Arrows', parts: [line('M50 26A19 19 0 0 0 16 20M14 38a19 19 0 0 0 34 6', '#2f9e44', 5), fill('M52 12v16H36z', '#2f9e44'), fill('M12 52V36h16z', '#2f9e44')] },
      { id: 'up-down', name: 'Up and Down', parts: [fill('M32 4 46 20h-9v24h9L32 60 18 44h9V20h-9z', '#8a8f98')] },
    ],
  },
  {
    id: 'interface',
    name: 'Interface',
    symbols: [
      { id: 'home', name: 'Home', parts: [fill('M32 8 6 30h7v24h14V40h10v14h14V30h7z', '#2f6fde')] },
      { id: 'search', name: 'Search', parts: [line(circle(27, 27, 15), '#33363d', 6), line('M38 38l16 16', '#33363d', 8)] },
      { id: 'heart', name: 'Heart', parts: [fill('M32 56C14 42 6 33 6 22a13 13 0 0 1 26-4 13 13 0 0 1 26 4c0 11-8 20-26 34z', '#e5484d')] },
      { id: 'bell', name: 'Bell', parts: [fill('M32 6a4 4 0 0 1 4 4v1.5c9 2 14 9 14 18V40l5 6v3H9v-3l5-6V29.5c0-9 5-16 14-18V10a4 4 0 0 1 4-4z', '#f0a020'), fill(circle(32, 54, 5), '#c77d0a')] },
      { id: 'chat', name: 'Speech Bubble', parts: [fill('M12 10h40a6 6 0 0 1 6 6v22a6 6 0 0 1-6 6H30l-12 10v-10h-6a6 6 0 0 1-6-6V16a6 6 0 0 1 6-6z', '#1f9d8b'), fill(`${circle(22, 27, 3.5)}${circle(32, 27, 3.5)}${circle(42, 27, 3.5)}`, '#ffffff')] },
      { id: 'mail', name: 'Envelope', parts: [fill('M8 14h48a2 2 0 0 1 2 2v32a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V16a2 2 0 0 1 2-2z', '#5b4bdb'), line('M8 18l24 18 24-18', '#ffffff', 4)] },
      { id: 'lock', name: 'Padlock', parts: [line('M20 28V20a12 12 0 0 1 24 0v8', '#8a8f98', 6), fill('M12 28h40a3 3 0 0 1 3 3v22a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3V31a3 3 0 0 1 3-3z', '#33363d'), fill(circle(32, 41, 5), '#f0a020')] },
      { id: 'toggle', name: 'Switch', parts: [fill('M20 18h24a14 14 0 0 1 0 28H20a14 14 0 0 1 0-28z', '#2f9e44'), fill(circle(44, 32, 10), '#ffffff')] },
      { id: 'pin', name: 'Map Pin', parts: [fill(`M32 58C18 40 12 31 12 23a20 20 0 0 1 40 0c0 8-6 17-20 35z${circle(32, 23, 8)}`, '#e2543b', { rule: 'evenodd' })] },
    ],
  },
  {
    id: 'nature',
    name: 'Nature',
    symbols: [
      { id: 'leaf', name: 'Leaf', parts: [fill('M54 8C26 8 8 22 8 42c0 6 2 10 4 14 22 0 42-14 42-48z', '#3fa34d'), line('M12 54C24 38 34 28 46 18', '#256b31', 3)] },
      { id: 'pine', name: 'Pine Tree', parts: [fill('M32 4 14 26h8L10 42h10L8 54h48L44 42h10L42 26h8z', '#2b8a3e'), fill('M28 54h8v8h-8z', '#7a4b2a')] },
      { id: 'flower', name: 'Flower', parts: [fill(`${circle(32, 16, 10)}${circle(47.2, 27.1, 10)}${circle(41.4, 44.9, 10)}${circle(22.6, 44.9, 10)}${circle(16.8, 27.1, 10)}`, '#f783ac'), fill(circle(32, 32, 8), '#f0b429')] },
      { id: 'mountain', name: 'Mountains', parts: [fill('M2 54 24 16l22 38z', '#5c6b7a'), fill('M28 54 44 28l18 26z', '#7d8b99'), fill('M24 16l7.5 13-4-2.5-3.5 4-3.5-4-4 2.5z', '#ffffff')] },
      { id: 'wave', name: 'Wave', parts: [fill('M4 40c8 0 8-8 16-8s8 8 16 8 8-8 16-8 8 8 8 8v18H4z', '#2f8fd6'), line('M4 30c8 0 8-8 16-8s8 8 16 8 8-8 16-8 8 8 8 8', '#74c0fc', 4)] },
      { id: 'mushroom', name: 'Mushroom', parts: [fill('M8 34C8 18 19 8 32 8s24 10 24 26z', '#e03131'), fill('M24 34h16l2 20a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4z', '#f1e3c8'), fill(`${circle(22, 22, 4)}${circle(38, 18, 3.5)}${circle(44, 28, 3)}`, '#ffffff')] },
      { id: 'cactus', name: 'Cactus', parts: [fill('M26 58V14a6 6 0 0 1 12 0v44zM26 40h-8a6 6 0 0 1-6-6V24a3 3 0 0 1 6 0v10h8zM38 34h8V20a3 3 0 0 1 6 0v14a6 6 0 0 1-6 6h-8z', '#40a35b')] },
      { id: 'grass', name: 'Grass Tuft', parts: [fill('M8 56C12 44 14 34 12 22c6 10 8 22 8 34zM22 56c0-16 2-30 10-46 0 16-2 30 0 46zM34 56c2-14 8-24 18-30-6 10-8 20-8 30zM46 56c2-8 6-14 12-16-4 6-4 10-4 16z', '#5cb85c')] },
    ],
  },
  {
    id: 'badges',
    name: 'Badges',
    symbols: [
      { id: 'seal', name: 'Seal', parts: [fill(burst(32, 32, 29, 25, 20), '#f0a020'), fill(circle(32, 32, 19), '#ffd43b'), line(circle(32, 32, 15), '#c77d0a', 2)] },
      { id: 'ribbon', name: 'Ribbon Banner', parts: [fill('M2 26h12v20H2l5-10z', '#a61e4d'), fill('M62 26H50v20h12l-5-10z', '#a61e4d'), fill('M10 18h44v24H10z', '#e64980')] },
      { id: 'shield', name: 'Shield', parts: [fill('M32 4 54 12v18c0 14-9 24-22 30C19 54 10 44 10 30V12z', '#364fc7'), fill('M32 10v44c-10-5-16-13-16-24V16z', '#4c6ef5')] },
      { id: 'rosette', name: 'Rosette', parts: [fill('M20 36l-8 24 10-5 6 9 6-22zM44 36l8 24-10-5-6 9-6-22z', '#1971c2'), fill(burst(32, 26, 22, 19, 16), '#228be6'), fill(circle(32, 26, 13), '#ffffff')] },
      { id: 'tag', name: 'Price Tag', parts: [fill(`M8 8h22l28 28-22 22L8 30z${circle(19, 19, 4)}`, '#f76707', { rule: 'evenodd' })] },
      { id: 'hex', name: 'Hex Badge', parts: [fill(polygon(32, 32, 28, 6), '#7048e8'), line(polygon(32, 32, 21, 6), '#d0bfff', 2.5)] },
      { id: 'check', name: 'Check Badge', parts: [fill(burst(32, 32, 28, 24, 12), '#2f9e44'), line('M21 33l7 7 15-16', '#ffffff', 6)] },
      { id: 'star', name: 'Star Medal', parts: [fill('M24 4h16l-4 20h-8z', '#e03131'), fill(circle(32, 40, 20), '#fab005'), fill(burst(32, 40, 13, 5.5, 5), '#ffffff')] },
    ],
  },
  {
    id: 'weather',
    name: 'Weather',
    symbols: [
      { id: 'sun', name: 'Sun', parts: [line(rays(32, 32, 20, 28, 8), '#f59f00', 5), fill(circle(32, 32, 13), '#fcc419')] },
      { id: 'cloud', name: 'Cloud', parts: [fill(CLOUD, '#a5b4c3')] },
      { id: 'partly', name: 'Partly Sunny', parts: [line(rays(24, 22, 14, 19, 8), '#f59f00', 3.5), fill(circle(24, 22, 9), '#fcc419'), fill('M24 54a8 8 0 0 1-.9-15.9A11 11 0 0 1 44 35a8.5 8.5 0 0 1 2 19z', '#c3ccd6')] },
      { id: 'rain', name: 'Rain', parts: [fill(RAIN_CLOUD, '#8a9bb0'), line('M20 48l-3 8M32 48l-3 8M44 48l-3 8', '#339af0', 4)] },
      { id: 'storm', name: 'Thunderstorm', parts: [fill(CLOUD, '#5f6b7a'), fill('M34 36 22 52h9l-4 10 14-18h-9l4-8z', '#fcc419')] },
      { id: 'snow', name: 'Snowflake', parts: [line(`${rays(32, 32, 0, 26, 6, Math.PI / 6)}${['M32 14l-6-6M32 14l6-6', 'M32 50l-6 6M32 50l6 6'].join('')}`, '#4dabf7', 4)] },
      { id: 'moon', name: 'Crescent Moon', parts: [fill('M40 6a26 26 0 1 0 18 40A22 22 0 0 1 40 6z', '#ffd43b')] },
      { id: 'rainbow', name: 'Rainbow', parts: [line('M8 52a24 24 0 0 1 48 0', '#e03131', 5, { cap: 'butt' }), line('M14 52a18 18 0 0 1 36 0', '#fab005', 5, { cap: 'butt' }), line('M20 52a12 12 0 0 1 24 0', '#40c057', 5, { cap: 'butt' }), line('M26 52a6 6 0 0 1 12 0', '#339af0', 5, { cap: 'butt' })] },
    ],
  },
];

export function findLibrary(id) {
  return SYMBOL_LIBRARIES.find((l) => l.id === id) || null;
}

const sourceKey = (lib, sym) => `library:${lib.id}/${sym.id}`;

/** Master nodes for a library symbol: [{ node, descendants }] in paint order. */
export function libraryArtwork(sym) {
  const out = [];
  for (const p of sym.parts) {
    const subs = parsePathData(p.d).filter((s) => s.anchors.length > 1);
    if (!subs.length) continue;
    const style = {
      fill: p.fill ? { type: 'solid', color: p.fill } : null,
      stroke: p.stroke ? { type: 'solid', color: p.stroke } : null,
      strokeWidth: p.stroke ? p.width || 2 : 0,
      strokeCap: p.cap || 'butt',
      strokeJoin: p.join || 'miter',
    };
    if (subs.length === 1) out.push({ node: createPath(subs[0].anchors, subs[0].closed, style), descendants: [] });
    else {
      const kids = subs.map((s) => createPath(s.anchors, s.closed, { fill: null, stroke: null }));
      const c = createCompound(kids.map((k) => k.id), { ...style, fillRule: p.rule || 'nonzero' });
      c.fillRule = p.rule || 'nonzero';
      out.push({ node: c, descendants: kids.map((k) => ({ ...k, parent: c.id })) });
    }
  }
  return out;
}

/** The document's symbol for a library symbol, added on first use (inside a transaction). */
export function ensureLibrarySymbol(doc, lib, sym) {
  const key = sourceKey(lib, sym);
  const have = symbolDefs(doc).find((d) => d.symbolDef.source === key);
  if (have) return have;
  const def = addDefinition(doc, { name: sym.name, kind: 'dynamic', reg: { x: 32, y: 32 }, source: key });
  for (const { node, descendants } of libraryArtwork(sym)) doc.insert(node, def.id, Infinity, descendants);
  return doc.get(def.id);
}
