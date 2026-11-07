import { describe, it, expect } from 'vitest';
import { createPath } from '../src/model/nodes.js';
import { rectangle } from '../src/model/shapes.js';
import { nodeBounds } from '../src/model/geometry.js';
import { rotate, scale, translate, multiply, apply } from '../src/lib/matrix.js';
import { applyStyle } from '../src/ops/paint-ops.js';
import { nudge } from '../src/ops/object-ops.js';
import { bootAppWithFeatures } from './helpers.js';
import { relativeTransform, absoluteTransform, exportSetsData, parseSetsData, isPlain, isRecordable, defaultSets, findAction, stepDetail } from '../src/features/panels/actions-model.js';
import { shortcutOwner, syncActionCommands, shortcutFromEvent } from '../src/features/panels/actions-panel.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function dialogEl() {
  for (let i = 0; i < 50 && !document.querySelector('dialog[open]'); i++) await new Promise((r) => setTimeout(r, 5));
  return document.querySelector('dialog[open]');
}
const click = (dlg, text) => [...dlg.querySelectorAll('button')].find((b) => b.textContent === text).click();
function field(dlg, label) {
  const l = [...dlg.querySelectorAll('label')].find((x) => x.textContent === label);
  return dlg.querySelector(`#${l.getAttribute('for')}`);
}

async function setup() {
  const app = await bootAppWithFeatures();
  const notes = [];
  app.notify = (m) => notes.push(m);
  const ed = app.newDocument({ width: 400, height: 300 });
  const doc = ed.doc;
  const add = (x = 0, y = 0, w = 20, h = 20) => {
    const p = createPath(rectangle(x, y, w, h), true);
    doc.transact('Add', () => doc.insert(p, ed.targetLayer().id));
    return p.id;
  };
  const engine = app.actions;
  const set = { id: 'set-t', name: 'Test', actions: [{ id: 'act-t', name: 'Test Action', steps: [] }] };
  engine.sets.push(set);
  return { app, ed, doc, add, engine, set, action: set.actions[0], notes };
}

describe('relative transforms', () => {
  it('replays a recorded matrix around a new selection center', () => {
    const c0 = { x: 10, y: 20 };
    const M = multiply(translate(5, -3), rotate(30, c0.x, c0.y));
    const rel = relativeTransform(M, c0);
    // Around the same center it is the same matrix.
    const same = absoluteTransform(rel, c0);
    for (let i = 0; i < 6; i++) expect(same[i]).toBeCloseTo(M[i]);
    // Around another center: the center moves by the same offset, shapes turn the same.
    const c1 = { x: 200, y: 100 };
    const m1 = absoluteTransform(rel, c1);
    const p = apply(m1, c1.x, c1.y);
    expect(p.x).toBeCloseTo(c1.x + 5);
    expect(p.y).toBeCloseTo(c1.y - 3);
    const s = relativeTransform(scale(2, 2, 0, 0), { x: 50, y: 50 });
    expect(s.d).toEqual([50, 50]);
  });
});

describe('action data', () => {
  it('knows plain data and recordable commands', () => {
    expect(isPlain({ a: [1, 'x', null, { b: true }] })).toBe(true);
    expect(isPlain({ el: document.body })).toBe(false);
    expect(isPlain(NaN)).toBe(false);
    expect(isRecordable('object.group')).toBe(true);
    expect(isRecordable('panel.layers')).toBe(false);
    expect(isRecordable('edit.undo')).toBe(false);
    expect(isRecordable('file.save')).toBe(false);
  });

  it('round-trips sets through a file with fresh ids', () => {
    const sets = defaultSets();
    const data = JSON.parse(JSON.stringify(exportSetsData(sets)));
    const back = parseSetsData(data);
    expect(back[0].name).toBe('Default Actions');
    expect(back[0].actions.length).toBe(sets[0].actions.length);
    expect(back[0].id).not.toBe(sets[0].id);
    expect(back[0].actions[1].steps[2]).toMatchObject({ kind: 'command', cmd: 'object.transform.move' });
    expect(() => parseSetsData({ format: 'nope' })).toThrow(/does not contain/);
  });

  it('describes steps', () => {
    const move = defaultSets()[0].actions.find((a) => a.id === 'act-offset').steps[2];
    expect(stepDetail(move)).toBe('dx: 12, dy: 12');
    expect(stepDetail({ kind: 'transform', m: [0, -1, 1, 0], d: [3, 0], copy: true })).toBe('move 3, 0, rotate 90°, copy');
  });
});

describe('recording', () => {
  it('records commands with their dialog values, paint changes and nudges', async () => {
    const { app, ed, add, engine, action } = await setup();
    const id = add(10, 10);
    ed.select([id]);
    engine.startRecording(action.id);
    const done = app.commands.run('object.transform.move');
    const dlg = await dialogEl();
    field(dlg, 'Horizontal').value = '15 pt';
    field(dlg, 'Vertical').value = '5 pt';
    click(dlg, 'OK');
    await done;
    applyStyle(ed, { fill: { type: 'solid', color: '#ff0000' } }, 'Fill Color');
    nudge(ed, 1, 0);
    await tick();
    // A cancelled dialog leaves no step.
    const cancelled = app.commands.run('object.transform.rotate');
    click(await dialogEl(), 'Cancel');
    await cancelled;
    // Workspace commands are not recorded.
    await app.commands.run('panel.layers');
    engine.stopRecording();
    expect(action.steps.map((s) => s.kind)).toEqual(['command', 'style', 'transform']);
    expect(action.steps[0]).toMatchObject({ cmd: 'object.transform.move', label: 'Move', dialogs: [{ title: 'Move', value: { dx: 15, dy: 5 } }] });
    expect(action.steps[1].patch).toEqual({ fill: { type: 'solid', color: '#ff0000' } });
    expect(action.steps[2].d).toEqual([1, 0]);
    // Saved to preferences.
    expect(app.prefs.get('actionSets').find((s) => s.id === 'set-t').actions[0].steps.length).toBe(3);
  });

  it('merges a slider drag into one paint step', async () => {
    const { ed, add, engine, action } = await setup();
    ed.select([add()]);
    engine.startRecording(action.id);
    for (const o of [0.9, 0.7, 0.5]) applyStyle(ed, { opacity: o }, 'Opacity', 'op');
    engine.stopRecording();
    expect(action.steps.length).toBe(1);
    expect(action.steps[0].patch).toEqual({ opacity: 0.5 });
  });
});

describe('playback', () => {
  async function recorded() {
    const ctx = await setup();
    const { app, ed, add, engine, action } = ctx;
    const id = add(10, 10);
    ed.select([id]);
    engine.startRecording(action.id);
    const done = app.commands.run('object.transform.move');
    const dlg = await dialogEl();
    field(dlg, 'Horizontal').value = '15 pt';
    field(dlg, 'Vertical').value = '5 pt';
    click(dlg, 'OK');
    await done;
    applyStyle(ed, { fill: { type: 'solid', color: '#00ff00' } }, 'Fill Color');
    nudge(ed, 0, 2);
    await tick();
    engine.stopRecording();
    return { ...ctx, first: id };
  }

  it('replays on another selection without showing dialogs', async () => {
    const { ed, doc, add, engine, action } = await recorded();
    const other = add(100, 100);
    ed.select([other]);
    const undo0 = doc.undoStack.length;
    let opened = false;
    const obs = new MutationObserver(() => (opened ||= Boolean(document.querySelector('dialog[open]'))));
    obs.observe(document.body, { childList: true, subtree: true });
    const res = await engine.play(action.id);
    obs.disconnect();
    expect(opened).toBe(false);
    expect(res).toEqual({ ok: true, done: 3 });
    const b = nodeBounds(doc, doc.get(other));
    expect(b.x).toBeCloseTo(115);
    expect(b.y).toBeCloseTo(107);
    expect(doc.get(other).fill.color).toBe('#00ff00');
    expect(doc.undoStack.length).toBe(undo0 + 3);
  });

  it('shows dialogs prefilled with the recorded values when the step is modal', async () => {
    const { ed, doc, add, engine, action } = await recorded();
    action.steps[0].modal = true;
    action.steps[1].on = false;
    action.steps[2].on = false;
    const other = add(100, 100);
    ed.select([other]);
    const playing = engine.play(action.id);
    const dlg = await dialogEl();
    expect(field(dlg, 'Horizontal').value).toBe('15 pt');
    field(dlg, 'Vertical').value = '0';
    click(dlg, 'OK');
    expect(await playing).toEqual({ ok: true, done: 1 });
    const b = nodeBounds(doc, doc.get(other));
    expect([b.x, b.y]).toEqual([115, 100]);
    expect(doc.get(other).fill.color).not.toBe('#00ff00');
  });

  it('plays from a step and stops at missing commands', async () => {
    const { engine, action, ed, add, notes } = await recorded();
    ed.select([add(100, 100)]);
    action.steps.push({ id: 'x', kind: 'command', cmd: 'no.such.command', label: 'Mystery', on: true, modal: false, dialogs: [] });
    const res = await engine.play(action.id, { from: 1 });
    expect(res.ok).toBe(false);
    expect(res.done).toBe(2);
    expect(notes.join(' ')).toMatch(/step 4: "Mystery" is not available/);
  });

  it('pauses at a stop step', async () => {
    const { app, engine, set, ed, add } = await setup();
    ed.select([add()]);
    set.actions.push({ id: 'act-stop', name: 'Paused', steps: [{ id: 's1', kind: 'stop', message: 'Check the art', canContinue: true, on: true }, { id: 's2', kind: 'command', cmd: 'object.flipH', label: 'Flip', on: true, dialogs: [] }] });
    let playing = engine.play('act-stop');
    let dlg = await dialogEl();
    expect(dlg.textContent).toContain('Check the art');
    click(dlg, 'Stop');
    expect(await playing).toEqual({ ok: false, done: 0, stoppedAt: 0 });
    playing = engine.play('act-stop');
    dlg = await dialogEl();
    click(dlg, 'Continue');
    expect(await playing).toEqual({ ok: true, done: 2 });
    void app;
  });

  it('plays default actions', async () => {
    const { app, ed, doc, add, engine } = await setup();
    const id = add(10, 10, 40, 20);
    ed.select([id]);
    await engine.play('act-center');
    const b = nodeBounds(doc, doc.get(id));
    expect(b.x + b.w / 2).toBeCloseTo(200);
    expect(b.y + b.h / 2).toBeCloseTo(150);
    expect(app.alignTo).toBe('selection');
    const before = doc.layers()[0].children.length;
    await engine.play('act-offset');
    expect(doc.layers()[0].children.length).toBe(before + 1);
    const copy = doc.get([...ed.selection][0]);
    expect(nodeBounds(doc, copy).x).toBeCloseTo(b.x + 12);
  });

  it('plays on every open document', async () => {
    const { app, engine, set } = await setup();
    set.actions.push({ id: 'act-flip', name: 'Flip', steps: [{ id: 'f', kind: 'style', patch: { opacity: 0.5 }, on: true, label: 'Opacity' }] });
    const ids = [];
    for (const ed of [app.editor, app.newDocument()]) {
      const p = createPath(rectangle(0, 0, 10, 10), true);
      ed.doc.transact('Add', () => ed.doc.insert(p, ed.targetLayer().id));
      ed.select([p.id]);
      ids.push([ed, p.id]);
    }
    const active = app.editor;
    await engine.playOnAll('act-flip');
    expect(app.editor).toBe(active);
    for (const [ed, id] of ids) expect(ed.doc.get(id).opacity).toBe(0.5);
  });
});

describe('shortcuts', () => {
  it('runs actions from their shortcuts and refuses taken ones', async () => {
    const { app, engine, action, ed, add } = await setup();
    expect(shortcutOwner(app, 'Mod+G')).toBe('Group');
    expect(shortcutOwner(app, 'Shift+F9')).toBeNull();
    action.shortcut = 'Shift+F9';
    action.steps.push({ id: 'o', kind: 'style', patch: { opacity: 0.25 }, on: true, label: 'Opacity' });
    syncActionCommands(app, engine);
    const id = add();
    ed.select([id]);
    const e = new KeyboardEvent('keydown', { key: 'F9', code: 'F9', shiftKey: true, bubbles: true });
    expect(app.commands.match(e)).toBe('actions.run.act-t');
    expect(shortcutFromEvent(e)).toBe('Shift+F9');
    await app.commands.run('actions.run.act-t');
    expect(ed.doc.get(id).opacity).toBe(0.25);
    delete action.shortcut;
    syncActionCommands(app, engine);
    expect(app.commands.match(e)).toBeNull();
    expect(findAction(engine.sets, 'act-t').action.name).toBe('Test Action');
  });
});

describe('Actions panel', () => {
  it('shows sets, actions and steps, and records from the footer', async () => {
    const { app, ed, add } = await setup();
    app.openPanel('actions');
    const panel = app.dock.panels.get('actions');
    panel.expanded.add('set-default');
    panel.update();
    const labels = [...panel.tree.querySelectorAll('.ac-label')].map((l) => l.textContent);
    expect(labels).toContain('Default Actions');
    expect(labels).toContain('Center on Artboard');
    // Select the test action and record a command.
    panel.select({ kind: 'action', id: 'act-t' });
    panel.recBtn.click();
    await tick();
    expect(app.actions.recording?.action.id).toBe('act-t');
    ed.select([add()]);
    await app.commands.run('object.flipH');
    panel.stopBtn.click();
    expect(app.actions.recording).toBeNull();
    panel.expanded.add('set-t');
    panel.expanded.add('act-t');
    panel.renderKey = null;
    panel.update();
    expect([...panel.tree.querySelectorAll('.ac-step .ac-label')].map((l) => l.textContent.trim())).toEqual(['Flip Horizontal']);
    // Turning the step off.
    panel.tree.querySelector('.ac-step .ac-on').click();
    expect(app.actions.sets.find((s) => s.id === 'set-t').actions[0].steps[0].on).toBe(false);
    // Button mode.
    panel.setButtonMode(true);
    expect(panel.buttons.hidden).toBe(false);
    expect([...panel.buttons.querySelectorAll('.ac-button-name')].map((b) => b.textContent)).toContain('Test Action');
  });

  it('inserts a menu item into the selected action', async () => {
    const { app } = await setup();
    app.openPanel('actions');
    const panel = app.dock.panels.get('actions');
    panel.select({ kind: 'action', id: 'act-t' });
    const done = panel.insertMenuItem();
    const dlg = await dialogEl();
    const search = dlg.querySelector('input[type=search]');
    search.value = 'Ungroup All';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    click(dlg, 'Insert');
    await done;
    const step = app.actions.sets.find((s) => s.id === 'set-t').actions[0].steps[0];
    expect(step).toMatchObject({ kind: 'command', cmd: 'object.ungroupAll', modal: true });
  });

  it('creates actions with options and starts recording', async () => {
    const { app } = await setup();
    app.openPanel('actions');
    const panel = app.dock.panels.get('actions');
    panel.select({ kind: 'set', id: 'set-t' });
    const done = panel.newAction();
    const dlg = await dialogEl();
    dlg.querySelector('#aco-name').value = 'Recolor Pass';
    const key = dlg.querySelector('#aco-key');
    key.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', metaKey: true, ctrlKey: true, bubbles: true }));
    // Mod+G belongs to Group: refused with a message.
    expect(dlg.querySelector('#aco-key-help').textContent).toMatch(/is used by Group/);
    key.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', code: 'F7', altKey: true, bubbles: true }));
    expect(key.value).not.toBe('');
    click(dlg, 'Record');
    await done;
    const action = app.actions.sets.find((s) => s.id === 'set-t').actions.find((a) => a.name === 'Recolor Pass');
    expect(action.shortcut).toBe('Alt+F7');
    expect(app.actions.recording.action).toBe(action);
    app.actions.stopRecording();
  });
});
