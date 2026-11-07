import { describe, it, expect, beforeEach } from 'vitest';
import { bootApp } from './helpers.js';
import { createPath } from '../src/model/nodes.js';
import { anchor } from '../src/model/bezier.js';

function addPath(app, pts, closed = false, extra = {}) {
  const doc = app.editor.doc;
  const n = createPath(pts.map(([x, y]) => anchor(x, y)), closed, { fill: null, ...extra });
  doc.transact('Path', () => doc.insert(n, app.editor.targetLayer().id));
  return doc.get(n.id);
}

describe('Average & Join', () => {
  let app;
  beforeEach(() => {
    app = bootApp();
    app.newDocument();
  });

  it('is a single undo step', async () => {
    const a = addPath(app, [[0, 0], [100, 0]]);
    const b = addPath(app, [[110, 10], [200, 10]]);
    const doc = app.editor.doc;
    app.editor.selectAnchors(a.id, [1]);
    app.editor.selectAnchors(b.id, [0], { add: true });
    const steps = doc.undoStack.length;
    await app.commands.run('path.averageJoin');
    expect(doc.leaves()).toHaveLength(1);
    expect(doc.leaves()[0].anchors.map((p) => [p.x, p.y])).toEqual([[0, 0], [105, 5], [200, 10]]);
    expect(doc.undoStack.length).toBe(steps + 1);
    doc.undo();
    expect(doc.leaves()).toHaveLength(2);
    expect(doc.get(a.id).anchors[1].x).toBe(100);
  });
});

describe('deleting the contents of groups and compound paths', () => {
  it('removes groups and compounds left empty by Delete or Cut', async () => {
    const app = bootApp();
    app.newDocument();
    const doc = app.editor.doc;
    const a = addPath(app, [[0, 0], [100, 0], [100, 100], [0, 100]], true);
    const b = addPath(app, [[20, 20], [50, 20], [50, 50], [20, 50]], true);
    app.editor.select([a.id, b.id]);
    await app.commands.run('object.compoundMake');
    const c = [...app.editor.selection][0];
    app.editor.clearSelection();
    app.editor.selectAnchors(a.id, [0, 1, 2, 3]);
    app.editor.selectAnchors(b.id, [0, 1], { add: true });
    await app.commands.run('edit.clear');
    // b keeps two anchors, so the compound stays; deleting the rest empties it.
    expect(doc.has(c)).toBe(true);
    app.editor.select([doc.get(c).children[0]]);
    await app.commands.run('edit.clear');
    expect(doc.has(c)).toBe(false);

    const e = addPath(app, [[0, 0], [10, 0]]);
    const f = addPath(app, [[0, 10], [10, 10]]);
    app.editor.select([e.id, f.id]);
    await app.commands.run('object.group');
    const g = [...app.editor.selection][0];
    app.editor.select([e.id, f.id]);
    await app.commands.run('edit.cut');
    expect(doc.has(g)).toBe(false);
    doc.undo();
    expect(doc.get(g).children).toEqual([e.id, f.id]);
    expect(doc.layers()[0].children).toEqual([g]);
  });
});

describe('deleting the last path of a group with anchor tools', () => {
  it('removes the emptied group too', async () => {
    const app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    const doc = app.editor.doc;
    const e = addPath(app, [[0, 0], [100, 0]]);
    app.editor.select([e.id]);
    await app.commands.run('object.group');
    const g = [...app.editor.selection][0];
    const { deleteAnchor } = await import('../src/tools/pen.js');
    deleteAnchor(app.editor, doc.get(e.id), 0);
    expect(doc.has(e.id)).toBe(false);
    expect(doc.has(g)).toBe(false);
  });
});

describe('isolation mode and empty groups', () => {
  it('keeps the isolated group when its contents are deleted', async () => {
    const app = bootApp();
    app.newDocument();
    const doc = app.editor.doc;
    const e = addPath(app, [[0, 0], [100, 0]]);
    app.editor.select([e.id]);
    await app.commands.run('object.group');
    const g = [...app.editor.selection][0];
    await app.commands.run('object.isolate', { id: g });
    app.editor.select([e.id]);
    await app.commands.run('edit.clear');
    expect(doc.has(g)).toBe(true);
    expect(app.editor.isolation).toBe(g);
  });
});
