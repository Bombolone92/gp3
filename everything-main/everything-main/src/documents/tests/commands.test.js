// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { parseVerticalAlign, parseCaps, registerAppCommands } from '../src/lib/commands.js';
import { fakeUi } from './helpers/fake-ui.js';

describe('parseVerticalAlign', () => {
  it('reads the painter\'s inline offsets and CSS keywords', () => {
    expect(parseVerticalAlign('5.28px')).toBe('superscript');
    expect(parseVerticalAlign('-3px')).toBe('subscript');
    expect(parseVerticalAlign('super')).toBe('superscript');
    expect(parseVerticalAlign('sub')).toBe('subscript');
    expect(parseVerticalAlign('baseline')).toBeNull();
    expect(parseVerticalAlign('0px')).toBeNull();
    expect(parseVerticalAlign('')).toBeNull();
    expect(parseVerticalAlign(undefined)).toBeNull();
  });
});

describe('registerAppCommands', () => {
  const range = { kind: 'selection', start: { kind: 'text', blockId: 'p1', offset: 0 }, end: { kind: 'text', blockId: 'p1', offset: 4 } };

  it('registers superscript and subscript, enabled only for a range in an editable document', () => {
    const ui = fakeUi();
    const off = registerAppCommands(ui, { probe: () => null });
    expect([...ui.registered.keys()]).toEqual(['all-caps', 'superscript', 'subscript']);
    const sup = ui.commands.get('superscript');
    expect(sup.getState().enabled).toBe(false);
    ui.selection.set({ empty: false, selectionTarget: range });
    sup.refresh();
    expect(sup.getState().enabled).toBe(true);
    ui.document.set({ mode: 'viewing' });
    sup.refresh();
    expect(sup.getState().enabled).toBe(false);
    off();
    expect(ui.registered.size).toBe(0);
  });

  it('inspects the page once per selection snapshot, however often the engine asks for the states', () => {
    const ui = fakeUi();
    const probe = vi.fn(() => 'superscript'), probeCaps = vi.fn(() => null);
    registerAppCommands(ui, { probe, probeCaps });
    ui.selection.set({ empty: false, selectionTarget: range });
    const before = probe.mock.calls.length, beforeCaps = probeCaps.mock.calls.length;
    for (let round = 0; round < 3; round++) for (const id of ['superscript', 'subscript', 'all-caps']) ui.commands.get(id).refresh();
    // One reading serves every command and every recompute of one selection.
    expect(probe.mock.calls.length - before).toBe(1);
    expect(probeCaps.mock.calls.length - beforeCaps).toBe(1);
    expect(ui.commands.get('superscript').getState().active).toBe(true);
    // A new selection snapshot is read again.
    ui.selection.set({ empty: false, selectionTarget: { ...range, end: { ...range.end, offset: 2 } } });
    ui.commands.get('subscript').refresh();
    expect(probe.mock.calls.length - before).toBe(2);
  });

  it('refuses a script or caps change at a collapsed caret with a message, since the engine has no pending form for them', async () => {
    const vertAlign = vi.fn(async () => ({ success: true })), apply = vi.fn(async () => ({ success: true }));
    const caret = { ...range, end: range.start };
    const ui = fakeUi({ docApi: { format: { vertAlign, apply } }, selection: { status: 'ready', empty: true, selectionTarget: caret, activeMarks: [] } });
    registerAppCommands(ui, { probe: () => null, probeCaps: () => null });
    for (const id of ['superscript', 'subscript', 'all-caps']) {
      const result = await ui.commands.get(id).executeAsync();
      expect(result).toMatchObject({ success: false, failure: { message: 'Select the text to change first' } });
    }
    expect(vertAlign).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('applies the script to the selection and clears it when already active', async () => {
    let painted = null;
    const vertAlign = vi.fn(async ({ value }) => { painted = value; return { success: true }; });
    const ui = fakeUi({ docApi: { format: { vertAlign } }, selection: { status: 'ready', empty: false, selectionTarget: range, activeMarks: [] } });
    registerAppCommands(ui, { probe: () => painted });
    const sup = ui.commands.get('superscript');
    const sub = ui.commands.get('subscript');
    expect(sup.getState().active).toBe(false);

    await sup.executeAsync();
    expect(vertAlign).toHaveBeenLastCalledWith({ target: range, value: 'superscript' });
    expect(sup.getState().active).toBe(true);
    expect(sub.getState().active).toBe(false);

    await sub.executeAsync();
    expect(vertAlign).toHaveBeenLastCalledWith({ target: range, value: 'subscript' });
    expect(sub.getState().active).toBe(true);

    await sub.executeAsync();
    expect(vertAlign).toHaveBeenLastCalledWith({ target: range, value: null });
    expect(sub.getState().active).toBe(false);
  });

  it('keeps the last reading while the selection is out of view', async () => {
    let painted = 'superscript';
    let visible = true;
    const ui = fakeUi({ docApi: { format: { vertAlign: async ({ value }) => { painted = value; return { success: true }; } } }, selection: { status: 'ready', empty: false, selectionTarget: range, activeMarks: [] } });
    registerAppCommands(ui, { probe: () => (visible ? painted : undefined) });
    const sup = ui.commands.get('superscript');
    expect(sup.getState().active).toBe(true);
    visible = false;
    sup.refresh();
    expect(sup.getState().active).toBe(true);
    await sup.executeAsync();
    expect(painted).toBeNull();
    expect(sup.getState().active).toBe(false);
  });

  it('fails closed without a selection or Document API', () => {
    const ui = fakeUi({ docApi: null });
    registerAppCommands(ui, { probe: () => null });
    const r = ui.commands.get('superscript').execute();
    expect(r.success).toBe(false);
    expect(ui.executed.at(-1).id).toBe('superscript');
  });
});

describe('all caps', () => {
  const range = { kind: 'selection', start: { kind: 'text', blockId: 'p1', offset: 0 }, end: { kind: 'text', blockId: 'p1', offset: 4 } };

  it('reads the painted text-transform', () => {
    expect(parseCaps('uppercase')).toBe(true);
    expect(parseCaps(' Uppercase ')).toBe(true);
    expect(parseCaps('none')).toBe(false);
    expect(parseCaps('')).toBe(false);
  });

  it('toggles w:caps on the selection and mirrors the painted state', async () => {
    let painted = null;
    const apply = vi.fn(async ({ inline }) => { painted = inline.caps ? true : null; return { success: true }; });
    const ui = fakeUi({ docApi: { format: { apply } }, selection: { status: 'ready', empty: false, selectionTarget: range, activeMarks: [] } });
    registerAppCommands(ui, { probe: () => null, probeCaps: () => painted });
    const caps = ui.commands.get('all-caps');
    expect(caps.getState()).toMatchObject({ enabled: true, active: false });
    await caps.executeAsync();
    expect(apply).toHaveBeenLastCalledWith({ target: range, inline: { caps: true } });
    expect(caps.getState().active).toBe(true);
    await caps.executeAsync();
    expect(apply).toHaveBeenLastCalledWith({ target: range, inline: { caps: false } });
    expect(caps.getState().active).toBe(false);
    // Scrolled out of view: keep the last known reading.
    painted = undefined;
    caps.refresh();
    expect(caps.getState().active).toBe(false);
  });

  it('refuses without a range', async () => {
    const ui = fakeUi({ docApi: { format: { apply: vi.fn() } } });
    registerAppCommands(ui, { probe: () => null, probeCaps: () => null });
    const r = await ui.commands.get('all-caps').executeAsync();
    expect(r.success).toBe(false);
  });
});
