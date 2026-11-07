import { describe, it, expect } from 'vitest';
import { planAnnotation, nextDesignator } from '../src/model/annotate.js';
import { mil } from '../src/core/units.js';

const lib = { r: { prefix: 'R' }, c: { prefix: 'C' } };
let n = 0;
const part = (designator, x = 0, y = 0, comp = 'r') => ({ id: `p${++n}`, t: 'part', comp, designator, x: mil(x), y: mil(y), rot: 0 });
const result = (plan) => Object.fromEntries(plan.map((p) => [p.id, p.to]));

describe('planAnnotation', () => {
  it('keeps unique numbers and fills gaps for unnumbered parts', () => {
    const a = part('R1'), b = part('R3'), c = part('R?', 0, 1000), d = part('R?', 2000, 1000);
    const plan = planAnnotation([{ id: 's', objects: [a, b, c, d] }], lib);
    expect(result(plan)).toEqual({ [c.id]: 'R2', [d.id]: 'R4' });
  });

  it('numbers per prefix', () => {
    const plan = planAnnotation([{ id: 's', objects: [part('R?'), part('C?', 1000, 0, 'c'), part('C1', 0, 0, 'c')] }], lib);
    expect(plan.map((p) => p.to).sort()).toEqual(['C2', 'R1']);
  });

  it('orders across rows or down columns', () => {
    const low = part('R?', 0, 0), high = part('R?', 2000, 2000);
    const across = result(planAnnotation([{ id: 's', objects: [low, high] }], lib, { order: 'across' }));
    expect(across[high.id]).toBe('R1');
    expect(across[low.id]).toBe('R2');
    const down = result(planAnnotation([{ id: 's', objects: [low, high] }], lib, { order: 'down' }));
    expect(down[low.id]).toBe('R1');
    expect(down[high.id]).toBe('R2');
  });

  it('orders by sheet before position', () => {
    const a = part('R?', 0, 0), b = part('R?', 0, 5000);
    const plan = result(planAnnotation([{ id: 's1', objects: [a] }, { id: 's2', objects: [b] }], lib));
    expect(plan[a.id]).toBe('R1');
    expect(plan[b.id]).toBe('R2');
  });

  it('renumbers duplicates and leaves the first one', () => {
    const a = part('R1', 0, 1000), b = part('R1', 0, 0);
    const plan = planAnnotation([{ id: 's', objects: [a, b] }], lib);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ id: b.id, from: 'R1', to: 'R2' });
  });

  it('renumbers everything on reset, omitting parts that keep their name', () => {
    const a = part('R7', 0, 1000), b = part('R2', 0, 0);
    const plan = planAnnotation([{ id: 's', objects: [a, b] }], lib, { reset: true });
    expect(result(plan)).toEqual({ [a.id]: 'R1' });
  });

  it('uses the library prefix when a designator has none', () => {
    const plan = planAnnotation([{ id: 's', objects: [part('', 0, 0, 'c')] }], lib);
    expect(plan[0].to).toBe('C1');
  });
});

describe('nextDesignator', () => {
  it('returns the lowest free number for a prefix', () => {
    const sheets = [{ objects: [part('R1'), part('R2'), part('R4'), part('C3', 0, 0, 'c')] }];
    expect(nextDesignator(sheets, 'R')).toBe('R3');
    expect(nextDesignator(sheets, 'C')).toBe('C1');
    expect(nextDesignator(sheets, 'U')).toBe('U1');
  });
});
