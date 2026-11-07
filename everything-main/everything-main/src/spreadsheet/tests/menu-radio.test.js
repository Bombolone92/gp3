// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { openMenu, closeMenu } from '../src/ui/menu.js';
import { menubarMenus, menuLeaves } from '../src/ui/menubar.js';
import { createToolbar } from '../src/ui/toolbar.js';
import { Workbook } from '../src/core/workbook.js';

afterEach(() => { closeMenu(); document.body.replaceChildren(); });

// Every checked item was a menuitemcheckbox, so a screen reader called a font, a size or a number
// format a checkbox. An item that is one choice of several now says it is a radio item; a toggle
// such as Gridlines or Thousands separator is still a checkbox.
describe('single-choice menu items', () => {
  it('are menuitemradio when marked radio, and menuitemcheckbox otherwise', () => {
    openMenu({ x: 10, y: 10, items: [{ label: 'Arial', checked: true, radio: true }, { label: 'Gridlines', checked: false }, { label: 'Plain' }] });
    const [font, toggle, plain] = document.querySelectorAll('.menu-item');
    expect(font.getAttribute('role')).toBe('menuitemradio');
    expect(font.getAttribute('aria-checked')).toBe('true');
    expect(font.classList.contains('checked')).toBe(true);
    expect(toggle.getAttribute('role')).toBe('menuitemcheckbox');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(plain.getAttribute('role')).toBe('menuitem');
    expect(plain.hasAttribute('aria-checked')).toBe(false);
  });

  it('cover the menu bar’s number formats, alignments, wrapping and rotation, while the view toggles stay checkboxes', () => {
    const menus = menubarMenus({ style: { fmt: 'percent', align: 'left' } });
    const leaf = (id, label) => menuLeaves(menus.find((m) => m.id === id).items).find((it) => it.label === label);
    for (const label of ['Automatic', 'Percent', 'Plain text', 'Left', 'Center', 'Right', 'Top', 'Middle', 'Bottom', 'Overflow', 'Wrap', 'Clip', 'None', 'Tilt up (45°)', 'Rotate up (90°)']) {
      expect(leaf('format', label).radio, label).toBe(true);
      expect(leaf('format', label).checked, label).toBeTypeOf('boolean');
    }
    for (const label of ['Show formulas', 'Gridlines', 'Show zeros', 'Focus mode']) {
      expect(leaf('view', label).radio, label).toBeUndefined();
      expect(leaf('view', label).checked, label).toBeTypeOf('boolean');
    }
    expect(leaf('format', 'Bold').radio).toBeUndefined();
    expect(leaf('tools', 'Check spelling as you type').radio).toBeUndefined();
  });

  it('cover the toolbar’s font, size, alignment and number-format menus, while Thousands separator stays a checkbox', () => {
    const wb = new Workbook();
    const toolbar = createToolbar({
      wb, run() {}, activeCell: () => null, style: () => ({}), active: () => ({ r: 0, c: 0 }),
      range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId,
      grid: { editing: false }, subscribe: () => () => {},
    });
    document.body.append(toolbar.el);
    const roles = () => [...document.querySelectorAll('.menu-item')].map((b) => [b.textContent.trim(), b.getAttribute('role')]);
    toolbar.el.querySelector('.tb-font').click();
    expect(roles().every(([, role]) => role === 'menuitemradio')).toBe(true);
    expect(document.querySelectorAll('[role="menuitemradio"][aria-checked="true"]')).toHaveLength(1);
    toolbar.el.querySelector('.tb-size').click();
    expect(roles().find(([label]) => label === 'Custom size…')[1]).toBe('menuitem');
    expect(roles().filter(([label]) => label !== 'Custom size…').every(([, role]) => role === 'menuitemradio')).toBe(true);
    expect(document.querySelectorAll('[role="menuitemradio"][aria-checked="true"]')).toHaveLength(1);
    toolbar.el.querySelector('[aria-label="Vertical align"]').click();
    expect(roles().filter(([, role]) => role === 'menuitemradio')).toHaveLength(11);
    expect(roles().find(([label]) => label.startsWith('Custom angle'))[1]).toBe('menuitem');
    toolbar.el.querySelector('.tb-fmt').click();
    const fmt = new Map(roles());
    expect(fmt.get('General1234.5')).toBe('menuitemradio');
    expect(fmt.get('Custom format…')).toBe('menuitemradio');
    expect(fmt.get('Thousands separator')).toBe('menuitemcheckbox');
    expect([...fmt.keys()].find((k) => k.startsWith('Currency symbol'))).toBeTruthy();
    expect(fmt.get([...fmt.keys()].find((k) => k.startsWith('Currency symbol')))).toBe('menuitem');
  });
});
