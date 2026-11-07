// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openCustomFormatDialog } from '../src/ui/numfmtdialog.js';
import { openTemplatePicker } from '../src/ui/templates.js';
import { customColorRows } from '../src/ui/colorpicker.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
  const store = new Map();
  vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) });
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// A button given role="listitem" stops being a button to assistive technology, and a list whose
// children are plain buttons reads as "list, 0 items".
describe('lists of buttons', () => {
  it('keeps the number format presets as buttons in a labelled group', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    openCustomFormatDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), style: () => ({ fmt: 'general' }), run: vi.fn(), grid: { focus: vi.fn() } });
    const presets = document.querySelector('.modal-root .numfmt-presets');
    expect(presets.getAttribute('role')).toBe('group');
    expect(presets.getAttribute('aria-label')).toBeTruthy();
    const buttons = presets.querySelectorAll('button.numfmt-preset');
    expect(buttons.length).toBeGreaterThan(3);
    for (const b of buttons) expect(b.hasAttribute('role')).toBe(false);
    expect(document.querySelectorAll('.modal-root [role="list"], .modal-root [role="listitem"]').length).toBe(0);
  });

  it('keeps the template cards as buttons in a labelled group', () => {
    openTemplatePicker({ onPick: vi.fn() });
    const grid = document.querySelector('.modal-root .template-grid');
    expect(grid.getAttribute('role')).toBe('group');
    expect(grid.getAttribute('aria-label')).toBe('Templates');
    for (const card of grid.querySelectorAll('button.template-card')) expect(card.hasAttribute('role')).toBe(false);
    expect(document.querySelectorAll('.modal-root [role="list"], .modal-root [role="listitem"]').length).toBe(0);
  });
});

describe('the hex color field', () => {
  it('marks a bad code invalid with a message, and clears it when the code changes', () => {
    const picked = [];
    const rows = customColorRows({ onPick: (hex) => picked.push(hex) });
    document.body.append(...rows);
    const hex = document.querySelector('.color-hex');
    hex.value = 'nope';
    hex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(hex.getAttribute('aria-invalid')).toBe('true');
    const hint = document.getElementById(hex.getAttribute('aria-describedby'));
    expect(hint).not.toBeNull();
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toBe('Enter a color like #1a73e8');
    expect(picked).toEqual([]);
    hex.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    expect(hex.hasAttribute('aria-invalid')).toBe(false);
    expect(hint.hidden).toBe(true);
    hex.value = '#1a73e8';
    hex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(picked).toEqual(['#1a73e8']);
    expect(hex.hasAttribute('aria-invalid')).toBe(false);
  });
});
