import { describe, it, expect } from 'vitest';
import { VDocument } from '../src/model/document.js';
import { createPath } from '../src/model/nodes.js';
import { rectangle } from '../src/model/shapes.js';
import { bootAppWithFeatures } from './helpers.js';
import { addSnapshot, restoreSnapshot, snapshotsOf, removeSnapshot, renameSnapshot } from '../src/features/panels/history.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

function docWithEdits(n = 3) {
  const doc = VDocument.create({ width: 100, height: 100 });
  const layer = doc.layers()[0];
  const ids = [];
  for (let i = 0; i < n; i++) {
    const p = createPath(rectangle(i * 10, 0, 5, 5), true);
    doc.transact(`Add ${i + 1}`, () => doc.insert(p, layer.id));
    ids.push(p.id);
  }
  return { doc, layer, ids };
}

describe('VDocument history browsing', () => {
  it('lists applied and undone steps', () => {
    const { doc } = docWithEdits(3);
    doc.undo();
    const h = doc.history();
    expect(h.steps.map((s) => s.label)).toEqual(['Add 1', 'Add 2', 'Add 3']);
    expect(h.index).toBe(2);
  });

  it('jumps backward and forward to any state', () => {
    const { doc, ids } = docWithEdits(3);
    doc.goToHistory(0);
    expect(ids.every((id) => !doc.has(id))).toBe(true);
    expect(doc.history().index).toBe(0);
    doc.goToHistory(2);
    expect(doc.has(ids[0]) && doc.has(ids[1]) && !doc.has(ids[2])).toBe(true);
    doc.goToHistory(99);
    expect(doc.history().index).toBe(3);
    expect(ids.every((id) => doc.has(id))).toBe(true);
  });

  it('clears the history without changing the document', () => {
    const { doc, ids } = docWithEdits(2);
    let events = 0;
    doc.on('history', () => events++);
    doc.clearHistory();
    expect(doc.history().steps).toEqual([]);
    expect(doc.canUndo).toBe(false);
    expect(ids.every((id) => doc.has(id))).toBe(true);
    expect(events).toBe(1);
  });

  it('restores a snapshot as one undoable step', () => {
    const { doc, layer, ids } = docWithEdits(2);
    const snap = doc.snapshot();
    doc.transact('Edit', () => {
      doc.update(ids[0], { name: 'changed' });
      doc.remove(ids[1]);
      doc.insert(createPath(rectangle(50, 50, 5, 5), true), layer.id);
    });
    const after = doc.get(layer.id).children.slice();
    doc.transact('Restore', () => doc.restoreSnapshot(snap));
    expect(doc.get(ids[0]).name).toBe('');
    expect(doc.has(ids[1])).toBe(true);
    expect(doc.get(layer.id).children).toEqual(ids);
    doc.undo();
    expect(doc.get(layer.id).children).toEqual(after);
    expect(doc.get(ids[0]).name).toBe('changed');
    doc.redo();
    expect(doc.get(layer.id).children).toEqual(ids);
  });

  it('keeps the snapshot intact when later inserts reuse the container', () => {
    const { doc, layer, ids } = docWithEdits(1);
    const snap = doc.snapshot();
    doc.transact('Edit', () => {
      doc.insert(createPath(rectangle(50, 50, 5, 5), true), layer.id);
      doc.restoreSnapshot(snap);
      doc.insert(createPath(rectangle(60, 60, 5, 5), true), layer.id);
    });
    expect(snap.nodes.get(layer.id).children).toEqual(ids);
    expect(doc.get(layer.id).children.length).toBe(2);
  });
});

describe('History snapshots', () => {
  it('adds, renames, restores and removes snapshots', async () => {
    const app = await bootAppWithFeatures();
    const ed = app.newDocument();
    const doc = ed.doc;
    const p = createPath(rectangle(0, 0, 10, 10), true);
    doc.transact('Add', () => doc.insert(p, ed.targetLayer().id));
    const snap = addSnapshot(doc);
    expect(snap.name).toBe('Snapshot 1');
    renameSnapshot(doc, snap.id, 'Before delete');
    doc.transact('Delete', () => doc.remove(p.id));
    expect(doc.has(p.id)).toBe(false);
    restoreSnapshot(ed, snap.id);
    expect(doc.has(p.id)).toBe(true);
    expect(doc.undoLabel).toBe('Snapshot: Before delete');
    removeSnapshot(doc, snap.id);
    expect(snapshotsOf(doc).some((s) => s.id === snap.id)).toBe(false);
  });
});

describe('History panel', () => {
  async function setup() {
    const app = await bootAppWithFeatures();
    const ed = app.newDocument();
    const doc = ed.doc;
    await tick();
    for (let i = 0; i < 3; i++) doc.transact(`Step ${i + 1}`, () => doc.insert(createPath(rectangle(i * 10, 0, 5, 5), true), ed.targetLayer().id));
    app.openPanel('history');
    const panel = app.dock.panels.get('history');
    panel.update();
    return { app, ed, doc, panel };
  }

  it('lists states with the current one selected, and an opened snapshot', async () => {
    const { panel, ed } = await setup();
    const rows = [...panel.list.querySelectorAll('.hp-row')];
    expect(rows.map((r) => r.querySelector('.hp-name').textContent)).toEqual(['Start of History', 'Step 1', 'Step 2', 'Step 3']);
    expect(rows[3].getAttribute('aria-selected')).toBe('true');
    expect(panel.snapList.textContent).toContain(ed.name);
  });

  it('clicking a state undoes to it and shows later states as undone', async () => {
    const { panel, doc } = await setup();
    panel.list.querySelectorAll('.hp-row')[1].click();
    expect(doc.history().index).toBe(1);
    panel.update();
    const rows = [...panel.list.querySelectorAll('.hp-row')];
    expect(rows[1].getAttribute('aria-selected')).toBe('true');
    expect(rows[2].classList.contains('undone')).toBe(true);
    rows[3].click();
    expect(doc.history().index).toBe(3);
  });

  it('steps with the arrow keys and Home/End', async () => {
    const { panel, doc } = await setup();
    panel.list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(doc.history().index).toBe(2);
    panel.list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(doc.history().index).toBe(0);
    panel.list.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(doc.history().index).toBe(3);
  });

  it('restores the opened snapshot after the history is cleared', async () => {
    const { panel, doc, app } = await setup();
    const opened = snapshotsOf(doc)[0];
    expect(opened.opened).toBe(true);
    const done = panel.clearHistory();
    await tick();
    [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Clear').click();
    await done;
    expect(doc.history().steps.length).toBe(0);
    panel.snapList.querySelector('.hp-snap-btn').click();
    expect(doc.layers()[0].children.length).toBe(0);
    expect(doc.canUndo).toBe(true);
    app.commands.run('edit.undo');
    expect(doc.layers()[0].children.length).toBe(3);
  });
});
