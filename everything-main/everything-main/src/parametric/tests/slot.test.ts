import { describe, expect, it } from 'vitest';
import type { SkConstraint, SkEntity } from '../src/model/types';
import { solveSketch } from '../src/sketch/solver';

/** The geometry and relations the Straight Slot tool creates. */
function slot(): { entities: SkEntity[]; constraints: SkConstraint[] } {
  const P = (id: string, x: number, y: number): SkEntity => ({ id, t: 'point', x, y });
  return {
    entities: [
      P('ca', 0, 0), P('cb', 20, 0), P('p1', 0, 5), P('p2', 0, -5), P('q1', 20, 5), P('q2', 20, -5),
      { id: 'l1', t: 'line', a: 'p1', b: 'q1' }, { id: 'l2', t: 'line', a: 'q2', b: 'p2' },
      { id: 'arcB', t: 'arc', c: 'cb', a: 'q2', b: 'q1' }, { id: 'arcA', t: 'arc', c: 'ca', a: 'p1', b: 'p2' },
      { id: 'axis', t: 'line', a: 'ca', b: 'cb', construction: true },
    ],
    constraints: [
      { id: 't1', type: 'tangent', refs: ['l1', 'arcA'] }, { id: 't2', type: 'tangent', refs: ['l1', 'arcB'] },
      { id: 't3', type: 'tangent', refs: ['l2', 'arcA'] }, { id: 't4', type: 'tangent', refs: ['l2', 'arcB'] },
      { id: 'eq', type: 'equal', refs: ['arcA', 'arcB'] },
    ],
  };
}

describe('slot relations', () => {
  it('leave a slot with five degrees of freedom and nothing redundant', () => {
    const { entities, constraints } = slot();
    const r = solveSketch(entities, constraints, { value: () => 0 });
    expect(r.badConstraints.size).toBe(0);
    expect(r.status).toBe('under');
    // Position (2), rotation (1), length (1) and width (1).
    expect(r.dof).toBe(5);
  });
});
