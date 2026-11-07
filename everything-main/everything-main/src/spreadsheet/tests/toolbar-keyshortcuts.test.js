// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createToolbar } from '../src/ui/toolbar.js';
import { ariaKeyShortcuts } from '../src/ui/menu.js';
import { MOD_KEY } from '../src/ui/dom.js';
import { Workbook } from '../src/core/workbook.js';

afterEach(() => document.body.replaceChildren());

function setup() {
  const wb = new Workbook();
  const toolbar = createToolbar({
    wb, run() {}, activeCell: () => null, style: () => ({}), active: () => ({ r: 0, c: 0 }),
    range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId,
    grid: { editing: false }, subscribe: () => () => {},
  });
  document.body.append(toolbar.el);
  return toolbar;
}

// The tooltip of Bold, Italic, Underline, Strikethrough, Insert link, Undo and Redo names a shortcut
// that only a sighted pointer user could read; the buttons now carry it as aria-keyshortcuts too, in
// the attribute's spelling, as the menu items do.
it('carries the shortcut its tooltip shows as aria-keyshortcuts', () => {
  const toolbar = setup();
  const cases = [['Bold', `${MOD_KEY}+B`], ['Italic', `${MOD_KEY}+I`], ['Underline', `${MOD_KEY}+U`], ['Strikethrough', `${MOD_KEY}+5`], ['Insert link', `${MOD_KEY}+K`], ['Undo', `${MOD_KEY}+Z`], ['Redo', `${MOD_KEY}+Shift+Z`]];
  for (const [label, keys] of cases) {
    const button = toolbar.el.querySelector(`[aria-label="${label}"]`);
    expect(button.getAttribute('aria-keyshortcuts'), label).toBe(ariaKeyShortcuts(keys));
    expect(ariaKeyShortcuts(keys), label).toBeTruthy();
    if (!label.startsWith('Undo') && !label.startsWith('Redo')) expect(button.title, label).toBe(`${label} (${keys})`);
  }
  // A button without a shortcut carries no empty attribute.
  expect(toolbar.el.querySelector('[aria-label="Merge cells"]').hasAttribute('aria-keyshortcuts')).toBe(false);
  expect(toolbar.el.querySelector('[aria-label="Wrap text"]').hasAttribute('aria-keyshortcuts')).toBe(false);
});
