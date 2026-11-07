import { describe, it, expect } from 'vitest';
import { BUILTIN_COMPONENTS, CATEGORIES, findComponent, searchComponents, cloneDef } from '../src/model/library/builtin.js';
import { FOOTPRINT_WIZARDS, SYMBOL_WIZARD, parsePinTable, findWizard } from '../src/model/library/wizards.js';
import { padBox } from '../src/model/library/footprints.js';
import { mil, mm } from '../src/core/units.js';
import { distSegSeg } from '../src/core/geom.js';
import { padForPin } from '../src/model/place.js';
import { PIN_TYPES } from '../src/model/schema.js';

const GRID = mil(100);
const SILK_GAP = mm(0.15);

/** Distance from a segment to an axis-aligned box (0 when touching or inside). */
function segBoxDist(x1, y1, x2, y2, b) {
  const inside = (x, y) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
  if (inside(x1, y1) || inside(x2, y2)) return 0;
  const edges = [
    [b.minX, b.minY, b.maxX, b.minY], [b.maxX, b.minY, b.maxX, b.maxY],
    [b.maxX, b.maxY, b.minX, b.maxY], [b.minX, b.maxY, b.minX, b.minY],
  ];
  return Math.min(...edges.map((e) => distSegSeg(x1, y1, x2, y2, ...e)));
}

function pointBoxDist(x, y, b) {
  const dx = Math.max(b.minX - x, 0, x - b.maxX), dy = Math.max(b.minY - y, 0, y - b.maxY);
  return Math.hypot(dx, dy);
}

/** Checks one footprint and returns a list of problems. */
function footprintProblems(fp) {
  const problems = [];
  if (!fp.name) problems.push('missing name');
  if (!fp.pads.length) problems.push('no pads');
  const nums = fp.pads.map((p) => p.num);
  if (!fp.dupPads && new Set(nums).size !== nums.length) problems.push(`duplicate pad numbers ${nums}`);
  const c = fp.courtyard;
  if (!c) problems.push('no courtyard');
  for (const p of fp.pads) {
    for (const k of ['x', 'y', 'w', 'h']) if (!Number.isInteger(p[k])) problems.push(`pad ${p.num} ${k} not integer`);
    if (!['round', 'rect', 'roundrect', 'oval'].includes(p.shape)) problems.push(`pad ${p.num} bad shape`);
    if (!['top', 'bottom', 'thru'].includes(p.side)) problems.push(`pad ${p.num} bad side`);
    if (p.side === 'thru') {
      if (!(p.drill > 0)) problems.push(`pad ${p.num} missing drill`);
      if (p.plated !== false && !(p.drill < Math.min(p.w, p.h))) problems.push(`pad ${p.num} drill not smaller than pad`);
    }
    const b = padBox(p);
    if (c && (b.minX < c.x1 || b.maxX > c.x2 || b.minY < c.y1 || b.maxY > c.y2)) problems.push(`pad ${p.num} outside courtyard`);
  }
  // Pads must not overlap each other unless they share a number.
  for (let i = 0; i < fp.pads.length; i++) {
    for (let j = i + 1; j < fp.pads.length; j++) {
      const a = fp.pads[i], b = fp.pads[j];
      if (a.num === b.num) continue;
      const A = padBox(a), B = padBox(b);
      const gap = Math.max(A.minX - B.maxX, B.minX - A.maxX, A.minY - B.maxY, B.minY - A.maxY);
      if (gap < mm(0.1)) problems.push(`pads ${a.num} and ${b.num} closer than 0.1 mm`);
    }
  }
  // Silkscreen keeps clear of copper.
  for (const g of fp.graphics) {
    if (g.layer !== 'topOverlay') continue;
    for (const p of fp.pads) {
      const b = padBox(p);
      let d;
      if (g.t === 'line') d = segBoxDist(g.x1, g.y1, g.x2, g.y2, b) - g.w / 2;
      else if (g.t === 'circle') d = pointBoxDist(g.cx, g.cy, b) - g.r;
      else continue;
      if (d < SILK_GAP - 2) problems.push(`silk ${g.t} too close to pad ${p.num} (${(d / 1e6).toFixed(3)} mm)`);
    }
  }
  if (fp.body) {
    for (const k of ['w', 'h', 'height']) if (!(fp.body[k] > 0)) problems.push(`body ${k} invalid`);
  }
  return problems;
}

describe('built-in library', () => {
  it('has a substantial catalog in known categories', () => {
    expect(BUILTIN_COMPONENTS.length).toBeGreaterThanOrEqual(90);
    for (const d of BUILTIN_COMPONENTS) expect(CATEGORIES).toContain(d.category);
  });

  it('uses unique ids and complete definitions', () => {
    const ids = BUILTIN_COMPONENTS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of BUILTIN_COMPONENTS) {
      expect(d.id).toMatch(/^[a-z0-9][a-z0-9.\-]*$/);
      expect(d.name, d.id).toBeTruthy();
      expect(d.prefix, d.id).toMatch(/^[A-Z]+$/);
      expect(d.description, d.id).toBeTruthy();
      expect(d.symbol, d.id).toBeTruthy();
      expect(d.footprint, d.id).toBeTruthy();
      expect(d.symbol.designatorPos, d.id).toBeTruthy();
    }
  });

  it('has symbols with unique pins on the 100 mil grid', () => {
    for (const d of BUILTIN_COMPONENTS) {
      const nums = d.symbol.pins.map((p) => p.num);
      expect(new Set(nums).size, `${d.id} pin numbers`).toBe(nums.length);
      const spots = new Set();
      for (const p of d.symbol.pins) {
        expect(Math.abs(p.x % GRID), `${d.id} pin ${p.num} x`).toBe(0);
        expect(Math.abs(p.y % GRID), `${d.id} pin ${p.num} y`).toBe(0);
        expect([0, 90, 180, 270], `${d.id} pin ${p.num} rot`).toContain(p.rot);
        expect(PIN_TYPES, `${d.id} pin ${p.num} type`).toContain(p.type);
        expect(p.length, `${d.id} pin ${p.num} length`).toBeGreaterThan(0);
        const key = `${p.x},${p.y}`;
        expect(spots.has(key), `${d.id} pin ${p.num} overlaps another pin`).toBe(false);
        spots.add(key);
      }
    }
  });

  it('maps every symbol pin to an existing pad', () => {
    for (const d of BUILTIN_COMPONENTS) {
      const pads = new Set(d.footprint.pads.map((p) => p.num));
      for (const p of d.symbol.pins) expect(pads.has(padForPin(d, p.num)), `${d.id} pin ${p.num}`).toBe(true);
    }
  });

  it('has manufacturable footprints with silkscreen clear of pads', () => {
    for (const d of BUILTIN_COMPONENTS) expect(footprintProblems(d.footprint), `${d.id} ${d.footprint.name}`).toEqual([]);
  });

  it('puts the cathode on pad 1 for diodes and LEDs', () => {
    for (const d of BUILTIN_COMPONENTS.filter((x) => x.prefix === 'D' && x.symbol.pins.length === 2 && x.id !== 'tvs-bidir-sma')) {
      const k = d.symbol.pins.find((p) => p.name === 'K');
      expect(k?.num, d.id).toBe('1');
    }
  });

  it('finds and clones definitions', () => {
    const r = findComponent('res-0603');
    expect(r.footprint.name).toBe('R0603');
    expect(findComponent('nope')).toBeNull();
    const c = cloneDef(r);
    expect(c).toEqual(r);
    c.symbol.pins[0].x = 1;
    expect(r.symbol.pins[0].x).not.toBe(1);
  });

  it('searches by tokens with sensible ranking', () => {
    expect(searchComponents('0603 res')[0].id).toBe('res-0603');
    expect(searchComponents('555').map((d) => d.id)).toContain('ic-555-soic8');
    expect(searchComponents('soic-8').length).toBeGreaterThan(2);
    expect(searchComponents('zzzz-nothing')).toEqual([]);
    const caps = searchComponents('', 'Capacitors');
    expect(caps.length).toBeGreaterThan(5);
    expect(caps.every((d) => d.category === 'Capacitors')).toBe(true);
    expect(searchComponents('led red').every((d) => d.category === 'LEDs')).toBe(true);
  });
});

describe('footprint wizards', () => {
  it('generate valid footprints from defaults', () => {
    for (const w of FOOTPRINT_WIZARDS) {
      const fp = w.generate({});
      expect(footprintProblems(fp), w.id).toEqual([]);
      for (const f of w.fields) expect(f.default, `${w.id}.${f.key}`).not.toBeUndefined();
    }
  });

  it('honour parameters', () => {
    const fp = findWizard('soic').generate({ pins: 14 });
    expect(fp.pads.length).toBe(14);
    expect(fp.name).toBe('SOIC-14');
    const q = findWizard('qfn').generate({ pins: 16, size: mm(3), epad: mm(1.7) });
    expect(q.pads.length).toBe(17);
    expect(q.name).toBe('QFN-16-3x3');
    const h = findWizard('header').generate({ rows: 2, cols: 8 });
    expect(h.pads.length).toBe(16);
    const mhole = findWizard('mountingHole').generate({ pad: 0 });
    expect(mhole.pads[0].plated).toBe(false);
  });

  it('numbers quad packages counter-clockwise from the top of the left side', () => {
    const q = findWizard('qfp').generate({ pins: 32, size: mm(7), pitch: mm(0.8) });
    const p = (n) => q.pads.find((x) => x.num === String(n));
    expect(p(1).x).toBeLessThan(0);
    expect(p(1).y).toBeGreaterThan(p(8).y);
    expect(p(9).y).toBeLessThan(0);
    expect(p(17).x).toBeGreaterThan(0);
    expect(p(25).y).toBeGreaterThan(0);
    expect(p(25).x).toBeGreaterThan(p(32).x);
  });
});

describe('symbol wizard', () => {
  it('parses pasted pin tables', () => {
    const { pins, errors } = parsePinTable('Pin\tName\tType\tSide\n1\tVCC\tpower\ttop\n2\tIN\tin\tleft\n3,OUT,out,r\n4;GND\n5\tX\tweird\n5\tdup');
    expect(pins.map((p) => p.num)).toEqual(['1', '2', '3', '4', '5']);
    expect(pins[0]).toEqual({ num: '1', name: 'VCC', type: 'power', side: 'top' });
    expect(pins[1].type).toBe('input');
    expect(pins[2]).toMatchObject({ type: 'output', side: 'right' });
    expect(pins[3]).toMatchObject({ name: 'GND', type: 'power', side: 'bottom' });
    expect(pins[4].type).toBe('passive');
    expect(errors.length).toBe(2);
  });

  it('builds a grid-aligned symbol from pins', () => {
    const { pins } = parsePinTable('1,VCC,power\n2,GND,power\n3,A,in\n4,B,in\n5,Y,out\n6,LONG_SIGNAL_NAME,io,right');
    const sym = SYMBOL_WIZARD.generate({ pins });
    expect(sym.pins.length).toBe(6);
    for (const p of sym.pins) {
      expect(Math.abs(p.x % GRID)).toBe(0);
      expect(Math.abs(p.y % GRID)).toBe(0);
    }
    const body = sym.graphics[0];
    for (const p of sym.pins) {
      const r = p.rot * Math.PI / 180;
      const bx = p.x + Math.round(Math.cos(r)) * p.length, by = p.y + Math.round(Math.sin(r)) * p.length;
      const onEdge = (bx === body.x1 || bx === body.x2) ? by >= body.y1 && by <= body.y2 : (by === body.y1 || by === body.y2) && bx >= body.x1 && bx <= body.x2;
      expect(onEdge, `pin ${p.num} touches body`).toBe(true);
    }
  });
});
