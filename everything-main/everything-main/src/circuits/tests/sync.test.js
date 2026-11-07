import { describe, it, expect, beforeEach } from 'vitest';
import { planSync, applySync } from '../src/model/sync.js';
import { Project, newProjectData } from '../src/model/project.js';
import { findComponent, cloneDef } from '../src/model/library/builtin.js';
import { mil } from '../src/core/units.js';

let project, sheet, board;

beforeEach(() => {
  project = new Project(newProjectData('Sync'));
  project.ensureComponent(cloneDef(findComponent('res-0603')));
  sheet = project.sheets[0];
  board = project.boards[0];
  // R1 pin 2 (200, 0) wired to R2 pin 1 (800, 0); R1 pin 1 on VCC.
  sheet.store.transact('setup', (s) => {
    s.add({ id: 'p1', t: 'part', comp: 'res-0603', designator: 'R1', value: '10k', x: 0, y: 0, rot: 0, uid: 'u1' });
    s.add({ id: 'p2', t: 'part', comp: 'res-0603', designator: 'R2', value: '1k', x: mil(1000), y: 0, rot: 0, uid: 'u2' });
    s.add({ id: 'w1', t: 'wire', pts: [mil(200), 0, mil(800), 0] });
    s.add({ id: 'w2', t: 'wire', pts: [-mil(200), 0, -mil(400), 0] });
    s.add({ id: 'vcc', t: 'power', net: 'VCC', style: 'bar', x: -mil(400), y: 0, rot: 0 });
  });
});

const comps = () => [...board.items()].filter((o) => o.t === 'comp');
const kinds = (changes) => changes.map((c) => c.kind).sort();

describe('planSync', () => {
  it('adds components with pad nets from the netlist', () => {
    const plan = planSync(project, board);
    expect(kinds(plan)).toEqual(['add', 'add', 'netlist']);
    applySync(board, plan);
    const byDes = Object.fromEntries(comps().map((c) => [c.designator, c]));
    expect(byDes.R1.padNets).toEqual({ 1: 'VCC', 2: 'NetR1_2' });
    expect(byDes.R2.padNets[1]).toBe('NetR1_2');
    expect(byDes.R1.uid).toBe('u1');
    expect(Object.keys(board.nets).sort()).toEqual(['NetR1_2', 'NetR2_2', 'VCC']);
    // New parts are placed off the board, to its right.
    const outlineMaxX = Math.max(...board.board.outline.filter((_, i) => i % 2 === 0));
    for (const c of comps()) expect(c.x).toBeGreaterThan(outlineMaxX);
    expect(planSync(project, board)).toEqual([]);
  });

  it('plans updates, removals and net changes after the schematic changes', () => {
    applySync(board, planSync(project, board));
    sheet.store.transact('edit', (s) => {
      s.update('p1', { value: '22k', designator: 'R10' });
      s.remove('p2');
    });
    const plan = planSync(project, board);
    const update = plan.find((c) => c.kind === 'update');
    expect(update.detail).toContain('22k');
    expect(update.detail).toContain('R10');
    expect(plan.find((c) => c.kind === 'remove').label).toBe('Remove R2');
    applySync(board, plan);
    const left = comps();
    expect(left.map((c) => c.designator)).toEqual(['R10']);
    expect(left[0].value).toBe('22k');
  });

  it('plans pad net changes when the wiring changes', () => {
    applySync(board, planSync(project, board));
    sheet.store.transact('rename', (s) => s.add({ id: 'lab', t: 'label', text: 'SIG', x: mil(500), y: 0, rot: 0 }));
    const plan = planSync(project, board);
    expect(kinds(plan)).toEqual(['netlist', 'nets', 'nets']);
    applySync(board, plan);
    expect(comps().find((c) => c.designator === 'R2').padNets[1]).toBe('SIG');
  });

  it('applies the changes as one undoable step', () => {
    applySync(board, planSync(project, board));
    expect(comps()).toHaveLength(2);
    board.store.undo();
    expect(comps()).toHaveLength(0);
    expect(board.nets).toEqual({});
    board.store.redo();
    expect(comps()).toHaveLength(2);
  });

  it('skips parts without a footprint', () => {
    project.putComponent({ id: 'sym', name: 'Symbol', prefix: 'X', footprint: null, symbol: { pins: [], graphics: [] } });
    sheet.store.transact('add', (s) => s.add({ id: 'p3', t: 'part', comp: 'sym', designator: 'X1', x: mil(3000), y: 0, rot: 0, uid: 'u3' }));
    applySync(board, planSync(project, board));
    expect(comps().map((c) => c.designator).sort()).toEqual(['R1', 'R2']);
  });
});
