// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openFormatCellsDialog } from '../src/ui/formatcells.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"><button id="opener">Format cells</button></div>';
  document.querySelector('#opener').focus();
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function setup(panel = 'number') {
  const wb = new Workbook();
  const run = vi.fn();
  const modal = openFormatCellsDialog({ wb, sheetId: () => wb.activeSheetId, active: () => ({ r: 0, c: 0 }), style: () => ({}), grid: {}, run }, { panel });
  return { ...modal, run };
}

function key(key) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  document.activeElement.dispatchEvent(event);
  return event;
}

describe('format cells tab navigation', () => {
  it('focuses the requested tab and exposes one tab stop', () => {
    const { panel } = setup('font');
    const tabs = [...panel.querySelectorAll('[role="tab"]')];
    expect(document.activeElement.dataset.key).toBe('font');
    expect(tabs.filter((tab) => tab.tabIndex === 0).map((tab) => tab.dataset.key)).toEqual(['font']);
  });

  it('moves between tabs with arrows, Home, and End without applying changes', () => {
    const { panel, run } = setup();
    for (const [press, name] of [['ArrowRight', 'align'], ['End', 'protect'], ['ArrowRight', 'number'], ['ArrowLeft', 'protect'], ['Home', 'number']]) {
      expect(key(press).defaultPrevented).toBe(true);
      const tab = document.activeElement;
      expect(tab.dataset.key).toBe(name);
      expect(tab.getAttribute('aria-selected')).toBe('true');
      const shown = document.getElementById(tab.getAttribute('aria-controls'));
      expect(shown?.hidden).toBe(false);
      expect(shown?.getAttribute('aria-labelledby')).toBe(tab.id);
      expect(panel.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
    }
    expect(run).not.toHaveBeenCalled();
    key('Escape');
    vi.advanceTimersByTime(200);
    expect(document.querySelector('.modal-root')).toBeNull();
    expect(document.activeElement.id).toBe('opener');
  });

  it('keeps arrow keys inside editable fields available for their native behavior', () => {
    const { panel } = setup();
    panel.querySelector('[aria-label="Category"]').focus();
    expect(key('ArrowDown').defaultPrevented).toBe(false);
  });

  it('keeps initial focus on the dialog on narrow screens', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const { panel } = setup('fill');
    expect(document.activeElement).toBe(panel);
    expect(panel.querySelector('[role="tab"][aria-selected="true"]').dataset.key).toBe('fill');
  });
});
