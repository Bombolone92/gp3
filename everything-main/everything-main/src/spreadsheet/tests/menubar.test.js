// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { menubarMenus, menuLeaves, createMenubar, MENU_TITLES } from '../src/ui/menubar.js';
import { paletteCommands } from '../src/ui/palette.js';
import { isMenuOpen, closeMenu } from '../src/ui/menu.js';
import { icon } from '../src/ui/icons.js';

const editorSource = fs.readFileSync(path.resolve(process.cwd(), 'src/views/editor.js'), 'utf8');
const knownCommands = new Set([...editorSource.matchAll(/case '([A-Za-z]+)'/g)].map((m) => m[1]));
const richFlags = { templates: true, pick: true, saving: true, ai: true, fullscreen: true, hasFormula: true, hasTable: true, hasNote: true, hasLink: true, fns: { shortcuts() {}, locale() {}, about() {} } };

function walk(items, visit) {
  for (const it of items) { visit(it); if (it.submenu) walk(it.submenu, visit); }
}

describe('menu bar definitions', () => {
  it('has the eight standard menus in order, each item naming a real editor command and icon', () => {
    const menus = menubarMenus(richFlags);
    expect(menus.map((m) => m.label)).toEqual(['File', 'Edit', 'View', 'Insert', 'Format', 'Data', 'Tools', 'Help']);
    expect(MENU_TITLES.map(([id]) => id)).toEqual(menus.map((m) => m.id));
    const unknownIcon = icon('definitely-not-an-icon');
    for (const menu of menus) {
      expect(menu.items.length).toBeGreaterThan(2);
      walk(menu.items, (it) => {
        if (it.separator || it.header) return;
        expect(it.label, `${menu.label}: item without label`).toBeTruthy();
        if (it.icon && it.icon !== 'info') expect(icon(it.icon), `${menu.label}: unknown icon ${it.icon}`).not.toBe(unknownIcon); // 'info' is also the fallback
        if (it.submenu) { expect(it.submenu.length).toBeGreaterThan(1); return; }
        if (it.fn) { expect(typeof it.fn).toBe('function'); return; }
        expect(knownCommands.has(it.cmd), `${menu.label}: "${it.label}" runs unknown command ${it.cmd}`).toBe(true);
      });
      // No separator at an edge or beside another, at any depth.
      walk([{ submenu: menu.items }], (it) => {
        if (!it.submenu) return;
        const list = it.submenu;
        expect(list[0].separator).toBeFalsy();
        expect(list[list.length - 1].separator).toBeFalsy();
        for (let k = 1; k < list.length; k++) expect(list[k].separator && list[k - 1].separator).toBeFalsy();
      });
      // Labels are unique within a menu level.
      const top = menu.items.filter((it) => it.label).map((it) => it.label);
      expect(new Set(top).size).toBe(top.length);
    }
  });

  it('reaches every palette command except the contextual chart and helper ones', () => {
    const inMenus = new Set(menubarMenus(richFlags).flatMap((m) => menuLeaves(m.items)).map((it) => it.cmd).filter(Boolean));
    const palette = paletteCommands({ ...richFlags, chart: 'c1' });
    const allowed = new Set(['editChart', 'replaceImage', 'duplicateChart', 'copyChart', 'downloadChart', 'deleteChart', 'scrollToActive', 'cellStylesMenu', 'selectSpecialMenu', 'pasteSpecialMenu']);
    const missing = palette.map((c) => c.cmd).filter((cmd) => cmd && !inMenus.has(cmd) && !allowed.has(cmd));
    expect(missing).toEqual([]);
  });

  it('follows the flags: host abilities, the active cell, and the view toggles', () => {
    const bare = menubarMenus({});
    const labels = (menus, id) => menuLeaves(menus.find((m) => m.id === id).items).map((it) => it.label);
    expect(labels(bare, 'file')).not.toContain('New from template…');
    expect(labels(bare, 'file')).not.toContain('Open from Puter…');
    expect(labels(bare, 'file')).toContain('Excel workbook (.xlsx)');
    expect(menubarMenus({ saving: true }).find((m) => m.id === 'file').items.map((it) => it?.label)).toContain('Export');
    expect(labels(menubarMenus({ saving: true }), 'file')).toContain('Excel workbook (.xlsx)');
    expect(labels(bare, 'help')).toEqual(['Search the menus…']);
    expect(labels(bare, 'insert')).toContain('Note');
    expect(labels(bare, 'insert')).not.toContain('From Puter…');
    expect(labels(menubarMenus(richFlags), 'insert')).toContain('From Puter…');
    expect(labels(bare, 'data')).toContain('Filter');
    expect(labels(bare, 'data')).toContain('Create table…');
    expect(labels(bare, 'tools')).not.toContain('Write a formula with AI…');

    const rich = menubarMenus({ ...richFlags, filter: true, showFormulas: true, gridlines: false, canUndo: false, isFullscreen: true, style: { bold: true, fmt: 'percent', wrap: true, rot: 45 } });
    expect(labels(rich, 'file')).toContain('New from template…');
    expect(labels(rich, 'help')).toEqual(['Search the menus…', 'Keyboard shortcuts…', 'About Spreadsheet…']); // the two dialogs end in an ellipsis, as every item that opens one does
    expect(labels(rich, 'insert')).toEqual(expect.arrayContaining(['Edit note', 'Delete note', 'Remove link']));
    expect(labels(rich, 'data')).toEqual(expect.arrayContaining(['Filter', 'Edit table…', 'Total row', 'Ask AI about this data…']));
    expect(labels(rich, 'tools')).toEqual(expect.arrayContaining(['Write a formula with AI…', 'Explain this formula (AI)…']));
    const leaf = (id, label) => menuLeaves(rich.find((m) => m.id === id).items).find((it) => it.label === label);
    expect(leaf('edit', 'Undo').disabled).toBe(true);
    expect(leaf('edit', 'Redo').disabled).toBe(false);
    expect(leaf('view', 'Show formulas').checked).toBe(true);
    // A checkable item names the thing, not the action that flips it; a choose-one list is radio items.
    expect(leaf('data', 'Filter').checked).toBe(true);
    expect(leaf('data', 'Total row').checked).toBe(false);
    expect(menuLeaves(rich.find((m) => m.id === 'data').items).filter((it) => it.cmd === 'tableStyle').every((it) => it.radio)).toBe(true);
    expect(leaf('view', 'Gridlines').checked).toBe(false);
    expect(leaf('view', 'Show zeros').checked).toBe(true);
    expect(leaf('view', 'Full screen').checked).toBe(true);
    expect(leaf('format', 'Bold').checked).toBe(true);
    expect(leaf('format', 'Italic').checked).toBe(false);
    expect(leaf('format', 'Percent').checked).toBe(true);
    expect(leaf('format', 'Automatic').checked).toBe(false);
    expect(leaf('format', 'Wrap').checked).toBe(true);
    expect(leaf('format', 'Overflow').checked).toBe(false);
    expect(leaf('format', 'Tilt up (45°)').checked).toBe(true);
    expect(menubarMenus({ style: {} }).find((m) => m.id === 'format') && leaf('format', 'None')).toBeTruthy();
    // Without a formula the auditing tools are present but disabled.
    expect(menuLeaves(bare.find((m) => m.id === 'tools').items).find((it) => it.label === 'Show precedents').disabled).toBe(true);
    expect(menuLeaves(bare.find((m) => m.id === 'tools').items).find((it) => it.label === 'Show dependents').disabled).toBeFalsy();
  });
});

describe('menu bar widget', () => {
  let ran;
  let closed;
  let bar;
  beforeEach(() => {
    closeMenu();
    document.body.innerHTML = '';
    ran = [];
    closed = 0;
    bar = createMenubar({ flags: () => ({ hasNote: true }), run: (cmd, arg) => ran.push([cmd, arg]), onClose: () => closed++ });
    document.body.append(bar.el);
  });

  const title = (label) => [...bar.el.querySelectorAll('.menubar-btn')].find((b) => b.textContent === label);
  const openLabel = () => document.querySelector('.menu:not(.submenu)')?.getAttribute('aria-label') || null;
  const itemNamed = (text) => [...document.querySelectorAll('.menu:not(.submenu) .menu-item')].find((b) => b.textContent.includes(text));

  it('renders the titles as a menubar and opens a menu on click', () => {
    expect(bar.el.getAttribute('role')).toBe('menubar');
    const btns = [...bar.el.querySelectorAll('[role="menuitem"]')];
    expect(btns.map((b) => b.textContent)).toEqual(['File', 'Edit', 'View', 'Insert', 'Format', 'Data', 'Tools', 'Help']);
    expect(btns.map((b) => b.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1, -1]);
    title('File').click();
    expect(isMenuOpen()).toBe(true);
    expect(openLabel()).toBe('File');
    expect(title('File').getAttribute('aria-expanded')).toBe('true');
    expect(title('File').classList.contains('open')).toBe(true);
    expect(itemNamed('New spreadsheet')).toBeTruthy();
    expect(bar.openId).toBe('file');
  });

  it('runs the chosen command and closes, telling the editor', () => {
    title('Insert').click();
    itemNamed('Edit note').click();
    expect(ran).toEqual([['note', null]]);
    expect(isMenuOpen()).toBe(false);
    expect(closed).toBe(1);
    expect(bar.openId).toBe(null);
    expect(title('Insert').getAttribute('aria-expanded')).toBe('false');
  });

  it('walks into submenus and passes the argument through', () => {
    title('View').click();
    itemNamed('Freeze').click();
    const sub = [...document.querySelectorAll('.menu.submenu .menu-item')].find((b) => b.textContent.includes('First row'));
    sub.click();
    expect(ran).toEqual([['freeze', { rows: 1 }]]);
    expect(document.querySelectorAll('.menu').length).toBe(0);
  });

  it('switches menus on hover and with the arrow keys, and the open title toggles it closed', () => {
    title('File').click();
    title('Edit').dispatchEvent(new Event('pointerenter'));
    expect(openLabel()).toBe('Edit');
    expect(title('File').getAttribute('aria-expanded')).toBe('false');
    expect(title('Edit').getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('.menu').length).toBe(1);
    expect(closed).toBe(0); // a hand-over is not a close

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(openLabel()).toBe('View');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(openLabel()).toBe('File');
    // Right on an item that has a submenu opens the submenu instead of moving on.
    title('View').click();
    itemNamed('Freeze').focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(openLabel()).toBe('View');
    expect(document.querySelectorAll('.menu.submenu').length).toBe(1);

    // Wraps from the last title back to the first.
    title('Help').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(openLabel()).toBe('File');

    // A press on the open title is not an outside click; the click then closes it.
    const press = new Event('pointerdown', { bubbles: true });
    title('File').dispatchEvent(press);
    expect(isMenuOpen()).toBe(true);
    title('File').click();
    expect(isMenuOpen()).toBe(false);
    expect(bar.openId).toBe(null);
    // A press elsewhere still closes it.
    title('Data').click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(isMenuOpen()).toBe(false);
  });

  it('returns focus to the open menu’s title on Escape, and Right on a submenu item moves to the next menu', () => {
    title('File').focus();
    title('File').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(openLabel()).toBe('View');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(isMenuOpen()).toBe(false);
    expect(document.activeElement).toBe(title('View'));
    expect(title('View').tabIndex).toBe(0);
    // Inside a submenu, Right on a plain item hands over to the next title, as at the top level.
    title('View').click();
    itemNamed('Freeze').focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    const first = [...document.querySelectorAll('.menu.submenu .menu-item')].find((b) => b.textContent.includes('First row'));
    expect(document.activeElement).toBe(first);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(openLabel()).toBe('Insert');
    expect(document.querySelectorAll('.menu.submenu').length).toBe(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(title('Insert'));
  });

  it('moves focus between titles with the arrows and opens on Down', () => {
    title('File').focus();
    title('File').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(title('Edit'));
    expect(title('Edit').tabIndex).toBe(0);
    expect(title('File').tabIndex).toBe(-1);
    title('Edit').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(title('Help'));
    title('Help').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(title('File'));
    title('File').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(openLabel()).toBe('File');
    expect(document.activeElement).toBe(itemNamed('New spreadsheet'));
    // Up opens a title's menu on its last item.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    title('Edit').focus();
    title('Edit').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(openLabel()).toBe('Edit');
    const editItems = [...document.querySelectorAll('.menu .menu-item')].filter((b) => !b.disabled);
    expect(editItems.length).toBeGreaterThan(2);
    expect(document.activeElement).toBe(editItems.at(-1));
    bar.destroy();
    expect(isMenuOpen()).toBe(false);
    expect(document.querySelector('.menubar')).toBe(null);
  });
});
