import { describe, it, expect } from 'vitest';
import { Project, newProjectData, parseProject, sheetExtents, defaultBoard } from '../src/model/project.js';
import { findComponent, cloneDef } from '../src/model/library/builtin.js';
import { FORMAT, FORMAT_VERSION } from '../src/model/schema.js';
import { mil, mm } from '../src/core/units.js';

const res = () => cloneDef(findComponent('res-0603'));

function sample() {
  const p = new Project(newProjectData('Sample'));
  p.ensureComponent(res());
  const sheet = p.sheets[0], board = p.boards[0];
  sheet.store.transact('setup', (s) => {
    s.add({ id: 'p1', t: 'part', comp: 'res-0603', designator: 'R1', x: 0, y: 0, rot: 0, uid: 'u1' });
    s.add({ id: 'w1', t: 'wire', pts: [mil(200), 0, mil(600), 0] });
    s.update('sheet', { title: 'Main', size: 'A3' });
  });
  board.store.transact('setup', (s) => {
    s.add({ id: 't1', t: 'track', layer: 'top', x1: 0, y1: 0, x2: mm(5), y2: 0, w: mm(0.3), net: 'N' });
    s.update('rules', { clearance: mm(0.15) });
    s.update('nets', { nets: { N: { class: 'Power' } } });
  });
  return p;
}

describe('Project', () => {
  it('starts with one sheet and one board with defaults', () => {
    const p = new Project(newProjectData('X'));
    expect(p.docs.map((d) => [d.kind, d.name])).toEqual([['sch', 'Sheet1.sch'], ['pcb', 'Board1.pcb']]);
    expect(p.boards[0].board.outline).toEqual(defaultBoard().outline);
    expect(p.boards[0].rules.clearance).toBeGreaterThan(0);
    expect(p.dirty).toBe(false);
  });

  it('round-trips through JSON', () => {
    const p = sample();
    const json = JSON.parse(JSON.stringify(p.toJSON()));
    expect(json.format).toBe(FORMAT);
    expect(json.version).toBe(FORMAT_VERSION);
    // Metadata is stored on the document, not among its objects.
    for (const d of json.documents) expect(d.objects.every((o) => !['sheet', 'board', 'rules', 'nets'].includes(o.t))).toBe(true);
    const q = parseProject(json);
    expect(q.name).toBe('Sample');
    expect(Object.keys(q.library)).toEqual(['res-0603']);
    expect(q.sheets[0].sheet.title).toBe('Main');
    expect(q.sheets[0].sheet.size).toBe('A3');
    expect(q.boards[0].rules.clearance).toBe(mm(0.15));
    expect(q.boards[0].nets).toEqual({ N: { class: 'Power' } });
    expect([...q.sheets[0].items()].map((o) => o.id).sort()).toEqual(['p1', 'w1']);
    expect(q.boards[0].store.get('t1').w).toBe(mm(0.3));
    expect(q.dirty).toBe(false);
  });

  it('makes metadata edits undoable', () => {
    const p = new Project(newProjectData('X'));
    const sheet = p.sheets[0];
    sheet.store.transact('title', (s) => s.update('sheet', { title: 'New' }));
    expect(sheet.sheet.title).toBe('New');
    sheet.store.undo();
    expect(sheet.sheet.title).toBe('');
  });

  it('tracks unsaved changes across documents', () => {
    const p = new Project(newProjectData('X'));
    p.boards[0].store.transact('t', (s) => s.add({ t: 'via', x: 0, y: 0, d: mm(0.6), drill: mm(0.3), from: 'top', to: 'bottom' }));
    expect(p.dirty).toBe(true);
    p.markSaved();
    expect(p.dirty).toBe(false);
    p.rename('Y');
    expect(p.dirty).toBe(true);
  });

  it('gives added documents unique names and can remove them', () => {
    const p = new Project(newProjectData('X'));
    const s2 = p.addSheet();
    const b2 = p.addBoard();
    expect(s2.name).toBe('Sheet2.sch');
    expect(b2.name).toBe('Board2.pcb');
    expect(s2.sheet.number).toBe(2);
    p.removeDoc(s2.id);
    expect(p.getDoc(s2.id)).toBeNull();
    expect(p.sheets).toHaveLength(1);
  });

  it('reindexes parts when their component is replaced', () => {
    const p = sample();
    const sheet = p.sheets[0];
    const far = { minX: mil(4000), minY: mil(4000), maxX: mil(4100), maxY: mil(4100) };
    expect(sheet.store.query(far)).toEqual([]);
    const big = res();
    big.symbol.graphics.push({ t: 'rect', x1: 0, y1: 0, x2: mil(5000), y2: mil(5000), w: 0 });
    p.putComponent(big);
    expect(sheet.store.query(far).map((o) => o.id)).toEqual(['p1']);
  });

  it('caches the netlist until a sheet changes', () => {
    const p = sample();
    const a = p.netlist();
    expect(p.netlist()).toBe(a);
    p.boards[0].store.transact('t', (s) => s.update('t1', { w: mm(0.5) }));
    expect(p.netlist()).toBe(a);
    p.sheets[0].store.transact('t', (s) => s.add({ t: 'label', text: 'SIG', x: mil(600), y: 0, rot: 0 }));
    const b = p.netlist();
    expect(b).not.toBe(a);
    expect(b.byPin.get('p1:2')).toBe('SIG');
  });

  it('lists components no document uses', () => {
    const p = sample();
    p.putComponent({ id: 'unused', name: 'U', prefix: 'U', symbol: { pins: [], graphics: [] }, footprint: null });
    expect(p.unusedComponents()).toEqual(['unused']);
  });
});

describe('parseProject', () => {
  const valid = () => newProjectData('P');

  it('rejects files that are not projects or come from a newer version', () => {
    expect(() => parseProject({ format: 'other' })).toThrow(/not a Circuits project/);
    expect(() => parseProject({ ...valid(), version: FORMAT_VERSION + 1 })).toThrow(/newer version/);
    expect(() => parseProject({ ...valid(), documents: null })).toThrow();
    expect(() => parseProject({ ...valid(), documents: [{ kind: 'gerber', objects: [] }] })).toThrow(/Unknown document/);
    expect(() => parseProject('{ not json')).toThrow();
  });

  it('drops metadata-typed and malformed objects and fixes duplicate ids', () => {
    const data = valid();
    data.documents[0].objects = [
      { id: 'a', t: 'wire', pts: [0, 0, 10, 0] },
      { id: 'a', t: 'wire', pts: [0, 0, 0, 10] },
      { id: 'b', t: 'board', outline: [] },
      { t: 'junction', x: 0, y: 0 },
      null,
      'junk',
    ];
    const p = parseProject(data);
    const objs = [...p.sheets[0].items()];
    expect(objs).toHaveLength(3);
    expect(new Set(objs.map((o) => o.id)).size).toBe(3);
    expect(objs.some((o) => o.t === 'board')).toBe(false);
  });
});

describe('sheetExtents', () => {
  it('snaps sheet sizes to the 100 mil grid and honours orientation', () => {
    const land = sheetExtents({ size: 'A4', orientation: 'landscape' });
    const port = sheetExtents({ size: 'A4', orientation: 'portrait' });
    expect(land.maxX % mil(100)).toBe(0);
    expect(land.maxY % mil(100)).toBe(0);
    expect(land.maxX).toBeGreaterThan(land.maxY);
    expect(port.maxX).toBe(land.maxY);
    expect(Math.abs(land.maxX - mm(297))).toBeLessThan(mil(100));
    expect(sheetExtents({ size: 'nonsense' })).toEqual(sheetExtents({ size: 'A4' }));
  });
});
