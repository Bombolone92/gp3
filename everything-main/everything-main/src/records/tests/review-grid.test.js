/**
 * Grid fixes from review.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEADER_H } from '../src/views/grid/layout.js';
import { Painter } from '../src/views/grid/cells.js';
import { iconImage } from '../src/lib/icons.js';
import { mountApp, openBase, tick, key, click } from './helpers/app.js';

function sized(g, w, h) {
  Object.defineProperty(g.scroller, 'clientWidth', { configurable: true, get: () => w });
  Object.defineProperty(g.scroller, 'clientHeight', { configurable: true, get: () => h });
  const rect = () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h });
  g.el.getBoundingClientRect = rect;
  g.scroller.getBoundingClientRect = rect;
  g.resize();
  // Moves made while jsdom gave the grid no height scrolled it.
  g.scroller.scrollTop = 0;
  g.scroller.scrollLeft = 0;
}

function pointer(type, x, y, opts = {}) {
  const { pointerType = 'mouse', ...rest } = opts;
  const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true, ...rest });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  return e;
}

/** A grid on a fresh base with records named by `names`. */
async function grid(names = ['A', 'B', 'C']) {
  const { app, store } = await mountApp();
  const id = await store.createBase();
  const page = await openBase(app, id);
  const t = page.table;
  // Start from just the named records.
  page.base.deleteRecords(t.id, t.ordered().map((r) => r.id));
  page.base.createRecords(t.id, names.map((n) => ({ [t.primary.id]: n })));
  await tick();
  const g = page.viewInst;
  g.setCursor(0, 0);
  g.scroller.focus();
  return { app, store, page, g, t, base: page.base, name: t.primary.id };
}

const col = (g, fieldId) => g.layout.cols.findIndex((x) => x.field.id === fieldId);

describe('leaving with a cell editor open', () => {
  it('switching views saves the text being typed', async () => {
    const { page, g, t, base, name } = await grid();
    key(g.scroller, 'Enter');
    document.querySelector('input.cell-editor').value = 'Typed';
    const other = base.addView(t.id, 'grid', 'Second');
    await tick();
    page.go(t.id, other);
    expect(t.ordered()[0].c[name]).toBe('Typed');
  });

  it('saving on the way out mounts just one new view', async () => {
    const { page, g, t, base } = await grid();
    const other = base.addView(t.id, 'grid', 'Second');
    await tick();
    // Paste handlers on the document: one per live grid.
    const live = new Set([g.onPaste]);
    const add = vi.spyOn(document, 'addEventListener').mockImplementation(function (type, fn, opts) {
      if (type === 'paste') live.add(fn);
      return EventTarget.prototype.addEventListener.call(this, type, fn, opts);
    });
    const remove = vi.spyOn(document, 'removeEventListener').mockImplementation(function (type, fn, opts) {
      if (type === 'paste') live.delete(fn);
      return EventTarget.prototype.removeEventListener.call(this, type, fn, opts);
    });
    key(g.scroller, 'Enter');
    document.querySelector('input.cell-editor').value = 'Typed';
    page.go(t.id, other);
    add.mockRestore();
    remove.mockRestore();
    expect([...live]).toEqual([page.viewInst.onPaste]);
  });

  it('leaving the base saves the text being typed', async () => {
    const { app, store, g, t, name, page } = await grid();
    key(g.scroller, 'Enter');
    document.querySelector('input.cell-editor').value = 'Typed';
    location.hash = '/';
    await app.route();
    await page.closed;
    const again = await store.openBase(page.baseId);
    expect(again.base.table(t.id).ordered()[0].c[name]).toBe('Typed');
  });

  it('does not reload from another device while a cell is being edited', async () => {
    const { app, page, g } = await grid();
    await page.session.flush();
    key(g.scroller, 'Enter');
    document.querySelector('input.cell-editor').value = 'Typed';
    page.session.changedElsewhere = async () => true;
    await page.onVisible();
    expect(app.page).toBe(page);
    expect(page.destroyed).toBeFalsy();
  });
});

describe('groups', () => {
  it('collapsing the group with the active cell moves to the next shown record', async () => {
    const { g, t, base, name } = await grid(['A1', 'A2', 'B1', 'B2', 'B3']);
    const s = base.addField(t.id, { name: 'S', type: 'singleSelect', options: { choices: [{ id: 'selA', name: 'A', color: 'blue' }, { id: 'selB', name: 'B', color: 'red' }] } });
    t.ordered().forEach((r, i) => base.setCell(t.id, r.id, s, i < 2 ? 'selA' : 'selB'));
    base.updateView(t.id, g.view.id, { groups: [{ fieldId: s, dir: 'asc' }] });
    await tick();
    g.setCursor(1, 0);
    expect(g.layout.records[g.cursor.r].c[name]).toBe('A2');
    g.toggleGroup(g.result.tree[0].path);
    await tick();
    expect(g.layout.records[g.cursor.r].c[name]).toBe('B1');
  });
});

describe('column header', () => {
  it('clicking a header makes the top record the active cell', async () => {
    const { g, t, name } = await grid();
    sized(g, 1200, 600);
    const c = g.layout.cols[0];
    g.scroller.dispatchEvent(pointer('pointerdown', c.x + 40, HEADER_H / 2));
    window.dispatchEvent(pointer('pointerup', c.x + 40, HEADER_H / 2));
    expect(g.range()).toMatchObject({ r0: 0, r1: 2, c0: 0, c1: 0 });
    key(g.scroller, 'x');
    document.querySelector('input.cell-editor').value = 'Edited';
    key(document.querySelector('input.cell-editor'), 'Enter');
    expect(t.ordered().map((r) => r.c[name])).toEqual(['Edited', 'B', 'C']);
  });
});

describe('paste', () => {
  const paste = (data) => {
    const e = new Event('paste', { bubbles: true, cancelable: true });
    e.clipboardData = data;
    document.dispatchEvent(e);
    return e;
  };

  it('pasting a picture (no text) leaves the cells alone', async () => {
    const { g, t, name } = await grid();
    g.setCursor(0, 0);
    const e = paste({ types: ['Files'], getData: () => '' });
    expect(t.ordered()[0].c[name]).toBe('A');
    expect(e.defaultPrevented).toBe(false);
    void g;
  });

  it('pasting copied empty text still clears the cell', async () => {
    const { g, t, name } = await grid();
    g.setCursor(0, 0);
    paste({ types: ['text/plain'], getData: () => '' });
    expect(t.ordered()[0].c[name] ?? null).toBe(null);
  });

  it('pasting a copied empty cell clears the cell (Chrome lists no types for empty text)', async () => {
    const { g, t, name } = await grid();
    g.setCursor(0, 0);
    paste({ types: [], getData: () => '' });
    expect(t.ordered()[0].c[name] ?? null).toBe(null);
  });
});

describe('paste widths', () => {
  it('a paste whose first row is shorter keeps the longer rows', async () => {
    const { g, t, base } = await grid();
    const notes = base.addField(t.id, { name: 'Extra', type: 'text' });
    await tick();
    const c = col(g, notes);
    g.setCursor(0, c - 1);
    g.pasteText('a\nb\tc');
    expect(t.ordered()[1].c[notes]).toBe('c');
    // The short first row leaves the cell past its end alone.
    expect(t.ordered()[0].c[notes]).toBeUndefined();
    expect(g.range()).toMatchObject({ r0: 0, r1: 1, c0: c - 1, c1: c });
  });
});

describe('cells without an editor', () => {
  it('F2 on a checkbox toggles it and leaves no editor behind', async () => {
    const { g, t, base } = await grid();
    const done = base.addField(t.id, { name: 'Done', type: 'checkbox' });
    await tick();
    g.setCursor(0, col(g, done));
    key(g.scroller, 'F2');
    expect(t.ordered()[0].c[done]).toBe(true);
    expect(g.editor).toBeNull();
    expect(g.ownsClipboardEvent(new Event('copy'))).toBe(true);
  });

  it('a link to a deleted table leaves no editor behind', async () => {
    const { g, t, base } = await grid();
    const other = base.addTable('Other');
    const link = base.addField(t.id, { name: 'Link', type: 'link', options: { tableId: other } });
    await tick();
    // The linked table is gone, but the field still points at it.
    base.table(t.id).field(link).options.tableId = 'tblGone';
    g.setCursor(0, col(g, link));
    key(g.scroller, 'Enter');
    expect(g.editor).toBeNull();
    expect(g.overlay.querySelector('.cell-anchor')).toBeNull();
  });
});

describe('focus after an edit', () => {
  it('moving focus out of a cell editor saves it and leaves focus where it went', async () => {
    const { g, t, name } = await grid();
    // Let the grid's own focus on mount happen first.
    await tick(30);
    key(g.scroller, 'Enter');
    const input = document.querySelector('input.cell-editor');
    input.value = 'Typed';
    const find = document.body.appendChild(document.createElement('input'));
    find.focus();
    await tick();
    expect(t.ordered()[0].c[name]).toBe('Typed');
    expect(document.activeElement).toBe(find);
  });

  it('Enter in a cell editor brings focus back to the grid', async () => {
    const { g } = await grid();
    key(g.scroller, 'Enter');
    key(document.querySelector('input.cell-editor'), 'Enter');
    expect(document.activeElement).toBe(g.scroller);
  });
});

describe('pickers follow their record', () => {
  async function setup() {
    const ctx = await grid(['A', 'B', 'C']);
    const { t, base, g } = ctx;
    const s = base.addField(t.id, { name: 'Tags', type: 'multipleSelect', options: { choices: [{ id: 'selM', name: 'M', color: 'blue' }, { id: 'selZ', name: 'Z', color: 'red' }] } });
    for (const r of t.ordered()) base.setCell(t.id, r.id, s, ['selM']);
    base.updateView(t.id, g.view.id, { sorts: [{ fieldId: s, dir: 'asc' }] });
    await tick();
    sized(g, 1200, 600);
    return { ...ctx, s };
  }

  it('a pick that re-sorts the view moves the picker with its record', async () => {
    const { g, s, name } = await setup();
    expect(g.layout.records[0].c[name]).toBe('A');
    g.setCursor(0, col(g, s));
    g.startEdit();
    const option = [...document.querySelectorAll('.choice-item')].find((el) => el.textContent.includes('Z'));
    option.click();
    await tick();
    const r = g.layout.records.findIndex((x) => x.c[name] === 'A');
    expect(r).toBe(2);
    const row = g.layout.rows[g.layout.recRow[r]];
    expect(g.editor).toBeTruthy();
    expect(g.overlay.querySelector('.cell-anchor').style.top).toBe(`${HEADER_H + row.y}px`);
  });

  it('a pick that filters the record out closes the picker', async () => {
    const { g, t, base, s } = await setup();
    base.updateView(t.id, g.view.id, { filters: { conjunction: 'and', conditions: [{ fieldId: s, op: 'hasNoneOf', value: ['selZ'] }] } });
    await tick();
    g.setCursor(0, col(g, s));
    g.startEdit();
    [...document.querySelectorAll('.choice-item')].find((el) => el.textContent.includes('Z')).click();
    await tick();
    expect(g.editor).toBeNull();
    expect(g.overlay.querySelector('.cell-anchor')).toBeNull();
  });
});

describe('hidden fields keep their place', () => {
  async function setup() {
    const ctx = await grid();
    const { t, base, g } = ctx;
    const ids = ['B', 'C', 'D', 'E'].map((n) => base.addField(t.id, { name: n, type: 'text' }));
    const order = [t.primary.id, ...ids];
    base.updateView(t.id, g.view.id, { order, hidden: [ids[1]] });
    await tick();
    sized(g, 1600, 600);
    const names = () => (g.view.order || []).map((id) => t.field(id)?.name).filter((n) => ['Name', 'B', 'C', 'D', 'E'].includes(n));
    return { ...ctx, ids, names };
  }

  it('moving a column keeps hidden fields where they were', async () => {
    const { g, ids, names } = await setup();
    const from = g.layout.cols[col(g, ids[3])];
    const to = g.layout.cols[col(g, ids[0])];
    g.scroller.dispatchEvent(pointer('pointerdown', from.x + 40, HEADER_H / 2));
    window.dispatchEvent(pointer('pointermove', to.x + 10, HEADER_H / 2, { buttons: 1 }));
    window.dispatchEvent(pointer('pointerup', to.x + 10, HEADER_H / 2));
    await tick();
    expect(names()).toEqual(['Name', 'E', 'B', 'C', 'D']);
    // It tells screen readers which field moved.
    await tick(40);
    expect(document.getElementById('live-region').textContent).toBe('Moved E');
  });

  it('inserting a field to the left keeps hidden fields where they were', async () => {
    const { g, t, ids, names } = await setup();
    g.addField(col(g, ids[0]));
    click([...document.querySelectorAll('.popover .btn.primary')].find((x) => x.textContent === 'Create field'));
    await tick();
    const added = g.view.order.find((id) => !t.field(id) || ![t.primary.id, ...ids].includes(id));
    expect(names()).toEqual(['Name', 'B', 'C', 'D', 'E']);
    expect(g.view.order.indexOf(added)).toBe(1);
  });
});

describe('adding records in a filtered view', () => {
  it('Shift+Enter says when the new record is hidden by the filters', async () => {
    const { g, t, base, name } = await grid();
    base.updateView(t.id, g.view.id, { filters: { conjunction: 'and', conditions: [{ fieldId: name, op: 'isNotEmpty' }] } });
    await tick();
    g.setCursor(0, 0);
    key(g.scroller, 'Enter', { shiftKey: true });
    expect(t.records.size).toBe(4);
    expect([...document.querySelectorAll('.toast')].some((x) => x.textContent.includes('hidden by this view'))).toBe(true);
  });
});

describe('typing to edit', () => {
  // jsdom is not a Mac: Ctrl is the shortcut key, Meta is not.
  it('a character typed with AltGr (Ctrl+Alt) starts editing with it', async () => {
    const { g } = await grid();
    key(g.scroller, '€', { ctrlKey: true, altKey: true });
    expect(document.querySelector('input.cell-editor')?.value).toBe('€');
  });

  it('a letter pressed with a modifier that is not the shortcut key does not start editing', async () => {
    const { g } = await grid();
    key(g.scroller, 'v', { metaKey: true });
    key(g.scroller, 'a', { altKey: true });
    expect(g.editor).toBeNull();
    expect(document.querySelector('.cell-editor')).toBeNull();
  });
});

describe('IME', () => {
  it('Enter that ends an IME composition in Safari does not commit the cell', async () => {
    const { g, t, name } = await grid();
    key(g.scroller, 'Enter');
    const input = document.querySelector('input.cell-editor');
    input.value = 'にほん';
    // Safari reports the composition-ending Enter with keyCode 229, not isComposing.
    const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(e, 'keyCode', { value: 229 });
    input.dispatchEvent(e);
    expect(g.editor).toBeTruthy();
    expect(t.ordered()[0].c[name]).toBe('A');
  });
});

describe('long text editor', () => {
  it('opens upward when a cell near the bottom has no room below', async () => {
    const { g, t, base } = await grid(['A', 'B', 'C', 'D', 'E', 'F']);
    const notes = base.addField(t.id, { name: 'Long', type: 'longText' });
    await tick();
    sized(g, 1200, 260);
    g.setCursor(4, col(g, notes));
    g.startEdit();
    const area = document.querySelector('textarea.cell-editor');
    const top = parseFloat(area.style.top);
    const height = parseFloat(area.style.height);
    expect(top + height).toBeLessThanOrEqual(260);
    expect(top).toBeGreaterThanOrEqual(0);
  });
});

describe('screen reader proxy', () => {
  it('moving to another cell points the grid at a new active descendant', async () => {
    const { g } = await grid();
    const active = () => g.scroller.getAttribute('aria-activedescendant');
    const first = active();
    key(g.scroller, 'ArrowDown');
    const second = active();
    expect(second).not.toBe(first);
    expect(document.getElementById(second).textContent).toBe('Name: B');
    key(g.scroller, 'ArrowDown');
    expect(active()).not.toBe(second);
    expect(document.getElementById(active()).textContent).toBe('Name: C');
    // Only the active proxy is in the accessibility tree.
    expect(g.a11y.querySelectorAll('[role=row]:not([hidden]) [role=gridcell]').length).toBe(1);
  });
});

describe('narrow screens', () => {
  it('a wide first column is shown narrower so other columns stay reachable', async () => {
    const { g, t, base, name } = await grid();
    base.updateView(t.id, g.view.id, { widths: { [name]: 500 } });
    await tick();
    sized(g, 1600, 600);
    expect(g.layout.cols[0].w).toBe(500);
    sized(g, 375, 600);
    expect(g.layout.frozenW).toBeLessThanOrEqual(375 - 160);
    expect(g.layout.colX(1, 0)).toBeLessThan(375);
    expect(g.view.widths[name]).toBe(500);
    sized(g, 1600, 600);
    expect(g.layout.cols[0].w).toBe(500);
  });

  it('widening a first column shown narrower keeps its saved width', async () => {
    const { g, t, base, name } = await grid();
    base.updateView(t.id, g.view.id, { widths: { [name]: 600 } });
    await tick();
    sized(g, 500, 600);
    const { x, w } = g.layout.cols[0];
    const edge = x + w - 2;
    g.scroller.dispatchEvent(pointer('pointerdown', edge, HEADER_H / 2));
    window.dispatchEvent(pointer('pointermove', edge + 50, HEADER_H / 2, { buttons: 1 }));
    window.dispatchEvent(pointer('pointerup', edge + 50, HEADER_H / 2));
    expect(g.view.widths[name]).toBe(600);
    expect(g.layout.cols[0].w).toBe(w);
    // Narrowing it saves the narrower width.
    g.scroller.dispatchEvent(pointer('pointerdown', edge, HEADER_H / 2));
    window.dispatchEvent(pointer('pointermove', edge - 40, HEADER_H / 2, { buttons: 1 }));
    window.dispatchEvent(pointer('pointerup', edge - 40, HEADER_H / 2));
    expect(g.view.widths[name]).toBe(w - 40);
  });
});

describe('drags the browser takes over', () => {
  it('a cancelled column resize ends the drag and changes nothing', async () => {
    const { g, name } = await grid();
    sized(g, 1600, 600);
    const { x, w } = g.layout.cols[0];
    const edge = x + w - 2;
    g.scroller.dispatchEvent(pointer('pointerdown', edge, HEADER_H / 2, { pointerType: 'pen' }));
    window.dispatchEvent(pointer('pointermove', edge + 80, HEADER_H / 2, { buttons: 1, pointerType: 'pen' }));
    expect(g.layout.cols[0].w).toBe(w + 80);
    // The pen's drag turned into a scroll.
    window.dispatchEvent(pointer('pointercancel', edge + 80, HEADER_H / 2, { pointerType: 'pen' }));
    expect(g.drag).toBeNull();
    expect(g.layout.cols[0].w).toBe(w);
    expect(g.view.widths?.[name]).toBeUndefined();
  });

  it('a move with no button pressed ends a drag whose release was missed', async () => {
    const { g } = await grid();
    sized(g, 1600, 600);
    const row = g.layout.rows[g.layout.recRow[0]];
    g.scroller.dispatchEvent(pointer('pointerdown', g.layout.cols[0].x + 20, HEADER_H + row.y + 10));
    expect(g.drag).toBeTruthy();
    window.dispatchEvent(pointer('pointermove', g.layout.cols[0].x + 20, HEADER_H + row.y + 40, { buttons: 0 }));
    expect(g.drag).toBeNull();
  });
});

describe('touch', () => {
  /** Listeners the scroller still holds, by event type. */
  function track(el) {
    const live = new Map();
    const add = el.addEventListener.bind(el);
    const remove = el.removeEventListener.bind(el);
    el.addEventListener = (type, fn, opts) => {
      live.set(fn, type);
      add(type, fn, opts);
    };
    el.removeEventListener = (type, fn, opts) => {
      live.delete(fn);
      remove(type, fn, opts);
    };
    return () => [...live.values()];
  }

  it('taps and cancelled touches leave no listeners behind', async () => {
    const { g } = await grid();
    sized(g, 1200, 600);
    const live = track(g.scroller);
    const row = g.layout.rows[g.layout.recRow[1]];
    const x = g.layout.cols[0].x + 20;
    const y = HEADER_H + row.y + 10;
    for (let i = 0; i < 3; i++) {
      g.scroller.dispatchEvent(pointer('pointerdown', x, y, { pointerType: 'touch' }));
      g.scroller.dispatchEvent(pointer('pointerup', x, y, { pointerType: 'touch' }));
    }
    g.scroller.dispatchEvent(pointer('pointerdown', x, y, { pointerType: 'touch' }));
    g.scroller.dispatchEvent(pointer('pointercancel', x, y, { pointerType: 'touch' }));
    expect(live()).toEqual([]);
  });

  it('a long press pending when the view goes away opens no menu', async () => {
    const { g } = await grid();
    sized(g, 1200, 600);
    const row = g.layout.rows[g.layout.recRow[1]];
    g.scroller.dispatchEvent(pointer('pointerdown', g.layout.cols[0].x + 20, HEADER_H + row.y + 10, { pointerType: 'touch' }));
    g.destroy();
    await tick(600);
    expect(document.querySelector('[role=menu]')).toBeNull();
  });
});

describe('tapping a cell', () => {
  it('focuses the grid so keys and paste reach it', async () => {
    const { g } = await grid();
    sized(g, 1200, 600);
    const other = document.body.appendChild(document.createElement('input'));
    other.focus();
    const row = g.layout.rows[g.layout.recRow[1]];
    const x = g.layout.cols[0].x + 20;
    const y = HEADER_H + row.y + 10;
    g.scroller.dispatchEvent(pointer('pointerdown', x, y, { pointerType: 'touch' }));
    g.scroller.dispatchEvent(pointer('pointerup', x, y, { pointerType: 'touch' }));
    expect(g.cursor).toEqual({ r: 1, c: 0 });
    expect(document.activeElement).toBe(g.scroller);
  });
});

describe('compact grid corner', () => {
  it('clicking the blank top-left corner checks nothing', async () => {
    const { g } = await grid();
    sized(g, 500, 600);
    expect(g.compact).toBe(true);
    g.scroller.dispatchEvent(pointer('pointerdown', 10, HEADER_H / 2));
    window.dispatchEvent(pointer('pointerup', 10, HEADER_H / 2));
    expect(g.checked.size).toBe(0);
  });
});

/** A grid in a fresh copy of the app that believes it runs on a Mac. */
async function macGrid(names) {
  Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' });
  vi.resetModules();
  try {
    const helpers = await import('./helpers/app.js');
    const { app, store } = await helpers.mountApp();
    const id = await store.createBase();
    const page = await helpers.openBase(app, id);
    const t = page.table;
    page.base.deleteRecords(t.id, t.ordered().map((r) => r.id));
    page.base.createRecords(t.id, (names || ['A', 'B', 'C']).map((n) => ({ [t.primary.id]: n })));
    await tick();
    const g = page.viewInst;
    g.setCursor(0, 0);
    g.scroller.focus();
    return { app, page, g, t, base: page.base, name: t.primary.id };
  } finally {
    delete navigator.platform;
  }
}

describe('on a Mac', () => {
  it('Ctrl-click opens the context menu without acting like a click', async () => {
    const { g, t, base } = await macGrid();
    const done = base.addField(t.id, { name: 'Done', type: 'checkbox' });
    await tick();
    sized(g, 1200, 600);
    const c = g.layout.cols[col(g, done)];
    const row = g.layout.rows[g.layout.recRow[1]];
    const at = [c.x + c.w / 2, HEADER_H + row.y + row.h / 2];
    g.scroller.dispatchEvent(pointer('pointerdown', ...at, { ctrlKey: true }));
    window.dispatchEvent(pointer('pointerup', ...at));
    expect(t.ordered()[1].c[done]).toBeUndefined();
    expect(g.cursor).toEqual({ r: 0, c: 0 });
  });

  it('Ctrl+letter does not start editing; Option characters do', async () => {
    const { g } = await macGrid();
    key(g.scroller, 'a', { ctrlKey: true });
    expect(g.editor).toBeNull();
    key(g.scroller, 'å', { altKey: true });
    expect(document.querySelector('input.cell-editor')?.value).toBe('å');
  });
});

describe('dropping files', () => {
  function drag(type, x, y) {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { clientX: x, clientY: y, dataTransfer: { types: ['Files'], files: [], dropEffect: 'copy' } });
    return e;
  }

  it('a file dropped on a cell that takes no files does not open the file instead', async () => {
    const { g } = await grid();
    sized(g, 1200, 600);
    const row = g.layout.rows[g.layout.recRow[0]];
    const at = [g.layout.cols[0].x + 20, HEADER_H + row.y + 10];
    const over = drag('dragover', ...at);
    g.scroller.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe('none');
    const drop = drag('drop', ...at);
    g.scroller.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
  });
});

describe('wide columns', () => {
  it('moving onto a column wider than the visible area shows its left edge', async () => {
    const { g, t, base } = await grid();
    const wide = base.addField(t.id, { name: 'Wide', type: 'text' });
    base.updateView(t.id, g.view.id, { widths: { [wide]: 900 } });
    await tick();
    sized(g, 800, 600);
    const c = col(g, wide);
    g.setCursor(0, c);
    expect(g.scroller.scrollLeft).toBe(g.layout.cols[c].x - g.layout.frozenW);
  });
});

describe('context menu from the keyboard', () => {
  it('Shift+F10 opens the record menu', async () => {
    const { g } = await grid();
    sized(g, 1200, 600);
    key(g.scroller, 'F10', { shiftKey: true });
    expect(document.querySelector('[role=menu][aria-label="Record actions"]')).toBeTruthy();
  });

  it('the context menu key first scrolls the active cell into view', async () => {
    const { g } = await grid(Array.from({ length: 60 }, (_, i) => `R${i}`));
    sized(g, 1200, 400);
    g.setCursor(50, 0);
    g.scroller.scrollTop = 0;
    key(g.scroller, 'ContextMenu');
    const row = g.layout.rows[g.layout.recRow[50]];
    expect(g.scroller.scrollTop).toBeGreaterThan(0);
    expect(row.y - g.scroller.scrollTop).toBeLessThan(400);
  });
});

describe('hover', () => {
  it('scrolling under a still pointer moves the row highlight', async () => {
    const { g } = await grid(Array.from({ length: 30 }, (_, i) => `R${i}`));
    sized(g, 1200, 400);
    const x = g.layout.cols[0].x + 20;
    const y = HEADER_H + 10;
    g.scroller.dispatchEvent(pointer('pointermove', x, y));
    expect(g.hover.row).toBe(0);
    g.scroller.scrollTop = g.layout.rowH * 3;
    g.scroller.dispatchEvent(new Event('scroll'));
    expect(g.hover.row).toBe(3);
  });
});

describe('resizing', () => {
  it('repaints right away when the canvas is resized, so it never shows blank', async () => {
    const { g } = await grid();
    sized(g, 1200, 600);
    const paint = vi.spyOn(g, 'paint');
    sized(g, 900, 500);
    expect(paint).toHaveBeenCalledTimes(1);
    // The size is already painted: no second paint is waiting.
    await tick(30);
    expect(paint).toHaveBeenCalledTimes(1);
  });
});

describe('mounting', () => {
  it('a grid that already has a size paints when mounted', async () => {
    const { page, g } = await grid();
    const { GridView } = await import('../src/views/grid/grid.js');
    const fresh = new GridView(page, g.table, g.view);
    Object.defineProperty(fresh.scroller, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(fresh.scroller, 'clientHeight', { configurable: true, get: () => 500 });
    expect(() => fresh.mounted()).not.toThrow();
    fresh.destroy();
  });
});

describe('painting text', () => {
  /** A context that measures 7px per UTF-16 unit and logs what it draws. */
  function fakeCtx() {
    const drawn = [];
    return {
      drawn,
      font: '',
      direction: 'inherit',
      textAlign: 'start',
      measureText: (t) => ({ width: t.length * 7 }),
      fillText(t, x) {
        drawn.push({ t, x, direction: this.direction, align: this.textAlign });
      },
    };
  }

  it('cut text never ends in half an emoji', () => {
    const P = new Painter(fakeCtx(), {}, () => {}, () => null);
    // 'ab' + one emoji (two UTF-16 units) + 'cd'; room for four units.
    const out = P.fit('ab\u{1F600}cd', 30);
    expect(out).toBe('ab…');
  });

  it('very long text is cut before it is measured, so caches stay small', () => {
    const P = new Painter(fakeCtx(), {}, () => {}, () => null);
    const long = 'word '.repeat(20_000);
    expect(P.fit(long, 200)).toMatch(/…$/);
    expect(P.wrap(long, 200, 3).at(-1)).toMatch(/…$/);
    const longest = (m) => Math.max(...[...m.keys()].map((k) => k.length));
    expect(longest(P.widths)).toBeLessThan(5000);
    expect(longest(P.wraps)).toBeLessThan(5000);
    // A cut text that would fit whole still shows it was cut.
    expect(P.fit('x'.repeat(5000), 1e6)).toMatch(/…$/);
  });

  it('right-to-left text is drawn right to left in the same place', () => {
    const ctx = fakeCtx();
    const P = new Painter(ctx, {}, () => {}, () => null);
    P.text('שלום', 10, 10, 200, '#000');
    P.text('Hello', 10, 10, 200, '#000');
    expect(ctx.drawn[0]).toMatchObject({ direction: 'rtl', align: 'right', x: 10 + 4 * 7 });
    expect(ctx.drawn[1]).toMatchObject({ x: 10 });
    expect(ctx.direction).not.toBe('rtl');
  });
});

describe('grid icons', () => {
  it('are drawn from images as sharp as the screen', () => {
    const made = [];
    const RealImage = globalThis.Image;
    const dpr = window.devicePixelRatio;
    globalThis.Image = class {
      set src(v) {
        made.push(decodeURIComponent(v));
      }
    };
    try {
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 });
      iconImage('plus', '#123456', 14);
      expect(made.at(-1)).toContain('width="42"');
      // Another screen gets its own image.
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
      iconImage('plus', '#123456', 14);
      expect(made.at(-1)).toContain('width="28"');
    } finally {
      globalThis.Image = RealImage;
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: dpr });
    }
  });
});

describe('changes elsewhere in the base', () => {
  it('edits to an unrelated table do not re-run the view', async () => {
    const { g, t, base, name } = await grid();
    const other = base.addTable('Other');
    const o = base.table(other);
    const [x] = base.createRecords(other, [{ [o.primary.id]: 'x' }]);
    await tick();
    const recompute = vi.spyOn(g, 'recompute');
    base.setCell(other, x, o.primary.id, 'y');
    expect(recompute).not.toHaveBeenCalled();
    // Its own records still do.
    base.setCell(t.id, t.ordered()[0].id, name, 'Z');
    expect(recompute).toHaveBeenCalledTimes(1);
  });

  it('edits to a linked table still re-run the view', async () => {
    const { g, t, base } = await grid();
    const other = base.addTable('Other');
    const o = base.table(other);
    const [x] = base.createRecords(other, [{ [o.primary.id]: 'x' }]);
    base.addField(t.id, { name: 'Link', type: 'link', options: { tableId: other } });
    await tick();
    const recompute = vi.spyOn(g, 'recompute');
    base.setCell(other, x, o.primary.id, 'y');
    expect(recompute).toHaveBeenCalledTimes(1);
  });
});

describe('leaving a deleted table', () => {
  it('a cell edit open when its table goes away is dropped without errors', async () => {
    const { page, g, t, base } = await grid();
    base.addTable('Other');
    await tick();
    key(g.scroller, 'Enter');
    document.querySelector('input.cell-editor').value = 'Typed';
    expect(() => base.apply({ t: 'table.del', id: t.id }, { label: 'Delete table' })).not.toThrow();
    expect(page.viewInst).not.toBe(g);
  });
});
