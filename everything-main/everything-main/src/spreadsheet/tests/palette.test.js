// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { paletteCommands, matchCommands, openCommandPalette, rememberCommand, recentCommands } from '../src/ui/palette.js';

describe('command palette', () => {
  it('lists the menu actions and gates the contextual ones', () => {
    const base = paletteCommands({});
    expect(base.some((c) => c.cmd === 'insertTable')).toBe(true);
    expect(base.some((c) => c.cmd === 'aiFormula')).toBe(false);
    expect(base.some((c) => c.cmd === 'evaluateFormula')).toBe(false);
    const rich = paletteCommands({ ai: true, hasFormula: true, hasTable: true, hasNote: true, fns: { shortcuts() {} } });
    expect(rich.some((c) => c.cmd === 'aiExplain')).toBe(true);
    expect(rich.some((c) => c.cmd === 'editTable')).toBe(true);
    expect(rich.some((c) => c.cmd === 'deleteNote')).toBe(true);
    expect(rich.some((c) => c.label === 'Keyboard shortcuts…' && typeof c.fn === 'function')).toBe(true);
    const withChart = paletteCommands({ chart: 'c1' });
    expect(withChart.some((c) => c.cmd === 'duplicateChart' && c.arg.id === 'c1')).toBe(true);
    expect(withChart.some((c) => c.cmd === 'editChart')).toBe(true);
    expect(paletteCommands({ chart: 'c1', chartIsImage: true }).some((c) => c.cmd === 'replaceImage')).toBe(true);
    expect(base.some((c) => c.cmd === 'deleteChart')).toBe(false);
    expect(base.some((c) => c.cmd === 'insertImagePuter')).toBe(false);
    expect(paletteCommands({ pick: true }).find(c => c.cmd === 'insertImagePuter')?.label).toBe('Image from Puter…');
    // Every entry names a section and has a label; no duplicate labels.
    const labels = rich.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(rich.every((c) => c.section && c.label)).toBe(true);
  });

  it('matches every word against label, section, and keywords, best label matches first', () => {
    const cmds = paletteCommands({});
    const freeze = matchCommands(cmds, 'freeze');
    expect(freeze[0].label).toBe('Freeze first row');
    expect(freeze.every((c) => /freeze/i.test(c.label))).toBe(true);
    expect(matchCommands(cmds, 'zebra')[0].label).toBe('Alternating colors');
    expect(matchCommands(cmds, 'row hide')[0].cmd).toBe('hide');
    expect(matchCommands(cmds, 'currency')[0].label).toBe('Number format: Currency');
    expect(matchCommands(cmds, 'xyzzy')).toEqual([]);
    expect(matchCommands(cmds, '').length).toBeGreaterThan(10);
  });

  it('runs the highlighted action on Enter and closes', () => {
    const ran = [];
    const cmds = paletteCommands({});
    const palette = openCommandPalette({ commands: cmds, run: (cmd, arg) => ran.push([cmd, arg]) });
    expect(document.querySelector('.palette-panel')).toBeTruthy();
    palette.input.value = 'pivot';
    palette.input.dispatchEvent(new Event('input'));
    const rows = document.querySelectorAll('.palette-item');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].textContent).toContain('Pivot table');
    palette.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    palette.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    palette.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(ran).toEqual([['pivot', null]]);
    expect(document.querySelector('.palette-panel')).toBeNull();
  });

  it('closes on Escape without running anything', () => {
    const ran = [];
    let closed = false;
    openCommandPalette({ commands: paletteCommands({}), run: () => ran.push(1), onClose: () => { closed = true; } });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toBe(true);
    expect(ran).toEqual([]);
    expect(document.querySelector('.palette-root')).toBeNull();
  });
});

describe('recent actions', () => {
  it('lists the actions used last at the top of an empty search', () => {
    const m = new Map();
    Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }, configurable: true });
    const cmds = paletteCommands({});
    expect(recentCommands()).toEqual([]);
    rememberCommand('Freeze first row');
    rememberCommand('Pivot table…');
    rememberCommand('Freeze first row');
    expect(recentCommands()).toEqual(['Freeze first row', 'Pivot table…']);
    const list = matchCommands(cmds, '');
    expect(list[0].label).toBe('Freeze first row');
    expect(list[0].recent).toBe(true);
    expect(list[1].label).toBe('Pivot table…');
    expect(list.filter((c) => c.label === 'Pivot table…').length).toBe(1);
    // A search ignores recency and ranks by the label.
    expect(matchCommands(cmds, 'pivot')[0].recent).toBeUndefined();
    // Picking through the palette records the action.
    const ran = [];
    const palette = openCommandPalette({ commands: cmds, run: (cmd) => ran.push(cmd) });
    palette.input.value = 'zoom in';
    palette.input.dispatchEvent(new Event('input'));
    palette.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(ran).toEqual(['zoom']);
    expect(recentCommands()[0]).toBe('Zoom in');
  });
});


it('does not run a command or dismiss the palette while composing', () => {
  const ran = [];
  const palette = openCommandPalette({ commands: paletteCommands({}), run: (...args) => ran.push(args) });
  for (const key of ['Enter', 'Escape', 'ArrowDown']) {
    const event = new KeyboardEvent('keydown', { key, isComposing: true, bubbles: true, cancelable: true });
    palette.input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(palette.input.isConnected).toBe(true);
    expect(ran).toEqual([]);
  }
  palette.close();
});
