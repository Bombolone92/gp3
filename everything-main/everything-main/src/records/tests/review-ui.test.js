/**
 * Regressions for the app shell and its panels, found in review.
 */
import { describe, it, expect } from 'vitest';
import { mountApp, openBase, tick, key, click } from './helpers/app.js';
import { popoverOpen, openPopover } from '../src/ui/popover.js';
import { openMenu } from '../src/ui/menu.js';
import { toast } from '../src/ui/toast.js';
import { confirmDialog } from '../src/ui/dialog.js';
import { calendar } from '../src/ui/datepicker.js';
import { openFieldEditor } from '../src/ui/fieldeditor.js';
import { openRecordPicker, previewAttachment } from '../src/ui/editors.js';

async function basePage() {
  const { app, store } = await mountApp();
  const id = await store.createBase();
  const page = await openBase(app, id);
  return { app, store, id, page, t: page.table };
}

const toolBtn = (kind) => document.querySelector(`.viewbar .tool-btn.t-${kind}`);

describe('toolbar panels', () => {
  it('close when the table changes, so they never edit the previous view', async () => {
    const { page, t } = await basePage();
    const other = page.base.addTable('Other');
    click(toolBtn('sort'));
    expect(popoverOpen()).toBe(true);
    page.go(other, null);
    expect(popoverOpen()).toBe(false);
    expect(t.views[0].sorts || []).toEqual([]);
  });
});

describe('a toolbar panel after an edit in it', () => {
  const addSort = (t) => {
    toolBtn('sort').focus();
    click(toolBtn('sort'));
    click(document.querySelector('.levels-panel .link-btn'));
    click([...document.querySelectorAll('.menu-item')].find((x) => x.textContent === t.primary.name));
  };

  it('stays tied to its button: the button shows it open and closes it', async () => {
    const { t } = await basePage();
    addSort(t);
    expect(t.views[0].sorts.length).toBe(1);
    expect(toolBtn('sort').textContent).toContain('Sorted by 1 field');
    expect(toolBtn('sort').getAttribute('aria-expanded')).toBe('true');
    click(toolBtn('sort'));
    expect(popoverOpen()).toBe(false);
    expect(toolBtn('sort').getAttribute('aria-expanded')).toBe('false');
  });

  it('returns focus to its button on Escape', async () => {
    const { t } = await basePage();
    addSort(t);
    key(document.activeElement, 'Escape');
    expect(popoverOpen()).toBe(false);
    expect(document.activeElement).toBe(toolBtn('sort'));
  });

  it('returns focus to its button on Escape after typing a filter value', async () => {
    const { t } = await basePage();
    toolBtn('filter').focus();
    click(toolBtn('filter'));
    click([...document.querySelectorAll('.filter-panel .link-btn')].find((b) => b.textContent.includes('Add condition')));
    const input = document.querySelector('.filter-panel input.filter-value');
    input.focus();
    input.value = 'x';
    input.dispatchEvent(new Event('input'));
    key(input, 'Escape');
    expect(t.views[0].filters.conditions[0].value).toBe('x');
    expect(document.activeElement).toBe(toolBtn('filter'));
    expect(toolBtn('filter').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('the filter panel', () => {
  const typeFilter = (text) => {
    click(toolBtn('filter'));
    click([...document.querySelectorAll('.filter-panel .link-btn')].find((b) => b.textContent.includes('Add condition')));
    const input = document.querySelector('.filter-panel input.filter-value');
    input.value = text;
    input.dispatchEvent(new Event('input'));
  };

  it('saves a value typed just before leaving the base', async () => {
    const { app, page, t } = await basePage();
    typeFilter('urgent');
    app.navigate('');
    await app.route();
    expect(t.views[0].filters.conditions[0].value).toBe('urgent');
  });

  it('saves a value typed just before switching tables, to the view it was typed for', async () => {
    const { page, t } = await basePage();
    const other = page.base.addTable('Other');
    typeFilter('urgent');
    page.go(other, null);
    expect(t.views[0].filters.conditions[0].value).toBe('urgent');
    expect(page.base.table(other).views[0].filters?.conditions?.length || 0).toBe(0);
    expect(page.viewInst.view.id).toBe(page.base.table(other).views[0].id);
  });
});

describe('the record picker', () => {
  it('shows linked records past the first 200 of their table', async () => {
    const { page, t } = await basePage();
    const link = page.base.addField(t.id, { name: 'Related', type: 'link', options: { tableId: t.id } });
    const ids = page.base.createRecords(t.id, Array.from({ length: 250 }, (_, i) => ({ [t.primary.id]: `R${i}` })));
    page.base.setCell(t.id, ids[0], link, [ids[240]]);
    const anchor = document.body.appendChild(document.createElement('button'));
    const pop = openRecordPicker(anchor, page, t, t.field(link), t.record(ids[0]));
    const linked = [...pop.el.querySelectorAll('.record-item[aria-selected="true"] .record-name')].map((x) => x.textContent);
    expect(linked).toEqual(['R240']);
    expect(pop.el.querySelectorAll('.record-item').length).toBe(201);
    pop.close();
    anchor.remove();
  });
});

describe('creating a base', () => {
  it('runs once on a double click', async () => {
    const { app, store } = await mountApp();
    const btn = [...document.querySelectorAll('.home-nav button')].find((b) => b.textContent.includes('Create base'));
    click(btn);
    click(btn);
    await tick(20);
    expect(store.bases().length).toBe(1);
    void app;
  });

  it('says so when it fails', async () => {
    const { store } = await mountApp();
    store.createBase = async () => {
      throw new Error('offline');
    };
    const err = console.error;
    console.error = () => {};
    try {
      click([...document.querySelectorAll('.home-nav button')].find((b) => b.textContent.includes('Create base')));
      await tick(5);
    } finally {
      console.error = err;
    }
    expect(document.querySelector('.toast.error').textContent).toContain('Could not create the base');
  });
});

describe('a base in the trash', () => {
  it('opens the trash from its address, with a way to restore it', async () => {
    const { app, store } = await mountApp();
    const id = await store.createBase({ name: 'Plans' });
    store.trashBase(id);
    location.hash = `/${id}`;
    await app.route();
    expect(location.hash).toBe('#/trash');
    expect(app.page.mode).toBe('trash');
    const t = [...document.querySelectorAll('.toast')].find((x) => x.textContent.includes('Plans is in the trash'));
    click([...t.querySelectorAll('button')].find((b) => b.textContent === 'Restore'));
    await app.route();
    await tick(5);
    expect(store.entry(id).trashedAt).toBeFalsy();
    expect(app.page.baseId).toBe(id);
  });
});

describe('reloading with changes from another device', () => {
  it('keeps the open record open', async () => {
    const { app, page, t } = await basePage();
    const [rid] = page.base.createRecords(t.id, [{ [t.primary.id]: 'Kept' }]);
    await page.session.flush();
    page.openRecord(rid);
    page.session.changedElsewhere = async () => true;
    await page.onVisible();
    await tick(5);
    expect(app.page).not.toBe(page);
    expect(location.hash).toContain(rid);
    expect(app.page.recordDialog?.recordId).toBe(rid);
  });
});

describe('deleting the current view or table', () => {
  it('replaces its address instead of adding one to history', async () => {
    const { page, t, id } = await basePage();
    const v2 = page.base.addView(t.id, 'grid', 'Second');
    page.go(t.id, v2);
    const length = history.length;
    page.deleteView(t.view(v2));
    expect(location.hash).toBe(`#/${id}/${t.id}/${t.views[0].id}`);
    expect(history.length).toBe(length);
    const other = page.base.addTable('Other');
    page.go(other, null);
    const length2 = history.length;
    page.base.undo();
    expect(page.tableId).toBe(t.id);
    expect(history.length).toBe(length2);
  });
});

describe('the views sidebar on a tablet-sized screen', () => {
  it('starts closed and closes after picking a view, as it covers the view', async () => {
    const mm = globalThis.matchMedia;
    // 700px wide: the sidebar overlays the view (max-width: 768px) but this is not a phone.
    globalThis.matchMedia = window.matchMedia = (q) => ({ matches: /max-width: (768|900)px/.test(q), addEventListener() {}, removeEventListener() {} });
    try {
      const { page, t } = await basePage();
      expect(page.el.classList.contains('sidebar-closed')).toBe(true);
      const v2 = page.base.addView(t.id, 'grid', 'Second');
      page.toggleSidebar(true);
      expect(page.el.classList.contains('sidebar-closed')).toBe(false);
      click([...document.querySelectorAll('.view-item')].find((li) => li.textContent.includes('Second')));
      expect(page.viewId).toBe(v2);
      expect(page.el.classList.contains('sidebar-closed')).toBe(true);
    } finally {
      globalThis.matchMedia = window.matchMedia = mm;
    }
  });
});

describe('toolbar buttons', () => {
  it('have names when only their icons show on narrow screens', async () => {
    const { page, t } = await basePage();
    page.base.updateView(t.id, t.views[0].id, { filters: { conjunction: 'and', conditions: [{ id: 'c1', fieldId: t.primary.id, op: 'isNotEmpty', value: null }] } });
    await tick();
    for (const b of document.querySelectorAll('.viewbar .tool-btn')) {
      expect(b.getAttribute('aria-label')).toBeTruthy();
      expect(b.dataset.tip).toBeTruthy();
    }
    expect(toolBtn('filter').getAttribute('aria-label')).toBe(`Filtered by ${t.primary.name}`);
  });
});

describe('Escape that ends an IME composition', () => {
  it('does not close a popover or menu', () => {
    const anchor = document.body.appendChild(document.createElement('button'));
    const input = document.createElement('input');
    const pop = openPopover(anchor, input);
    key(input, 'Escape', { isComposing: true });
    // Safari sends the Escape that ends composition as keyCode 229.
    key(input, 'Escape', { keyCode: 229 });
    expect(pop.closed).toBe(false);
    key(input, 'Escape');
    expect(pop.closed).toBe(true);
    const menu = openMenu(anchor, [{ label: 'Copy' }], { search: true });
    key(document.activeElement, 'Escape', { keyCode: 229 });
    expect(menu.closed).toBe(false);
    menu.close();
    anchor.remove();
  });
});

describe('Ctrl+K', () => {
  it('opens quick search in a base and is left to the browser elsewhere', async () => {
    const { app, store } = await mountApp();
    const press = () => {
      const e = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
      document.body.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(press()).toBe(false);
    const page = await openBase(app, await store.createBase());
    expect(press()).toBe(true);
    expect(page.searchPop && !page.searchPop.closed).toBe(true);
  });
});

describe('a toast', () => {
  it('waits while focused and goes once focus leaves it', async () => {
    // A fresh app, with nothing from earlier tests left to move focus.
    await mountApp();
    await tick(5);
    const outside = document.body.appendChild(document.createElement('button'));
    toast('Deleted Notes', { action: { label: 'Undo', onClick() {} }, timeout: 20 });
    const el = [...document.querySelectorAll('.toast')].find((x) => x.textContent.includes('Deleted Notes'));
    el.querySelector('button').focus();
    await tick(40);
    expect(el.isConnected).toBe(true);
    outside.focus();
    await tick(40);
    expect(el.isConnected).toBe(false);
    outside.remove();
  });
});

describe('moving through search results with the arrow keys', () => {
  const counting = (base) => {
    const name = base.recordName.bind(base);
    const calls = { n: 0 };
    base.recordName = (...a) => {
      calls.n++;
      return name(...a);
    };
    return calls;
  };

  it('does not search again in quick search', async () => {
    const { page, t } = await basePage();
    page.base.createRecords(t.id, Array.from({ length: 50 }, (_, i) => ({ [t.primary.id]: `Item ${i}` })));
    page.quickSearch();
    const input = page.searchPop.el.querySelector('input');
    input.value = 'item';
    input.dispatchEvent(new Event('input'));
    const calls = counting(page.base);
    key(input, 'ArrowDown');
    key(input, 'ArrowDown');
    expect(calls.n).toBe(0);
    const active = page.searchPop.el.querySelectorAll('[role=option].active');
    expect(active.length).toBe(1);
    expect(active[0].getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(active[0].id);
    expect(page.searchPop.el.querySelectorAll('[aria-selected=true]').length).toBe(1);
  });

  it('does not search again in the record picker', async () => {
    const { page, t } = await basePage();
    const link = page.base.addField(t.id, { name: 'Related', type: 'link', options: { tableId: t.id } });
    const [rec] = page.base.createRecords(t.id, Array.from({ length: 50 }, (_, i) => ({ [t.primary.id]: `Item ${i}` })));
    const anchor = document.body.appendChild(document.createElement('button'));
    const pop = openRecordPicker(anchor, page, t, t.field(link), t.record(rec));
    const input = pop.el.querySelector('input');
    const calls = counting(page.base);
    key(input, 'ArrowDown');
    expect(calls.n).toBe(0);
    const active = pop.el.querySelectorAll('.record-item.active');
    expect(active.length).toBe(1);
    expect(input.getAttribute('aria-activedescendant')).toBe(active[0].id);
    expect(active[0].querySelector('.record-name').textContent).toBe('Item 1');
    pop.close();
    anchor.remove();
  });
});

describe('a confirm dialog', () => {
  it('is described by its message, and a dangerous one starts on Cancel', async () => {
    const done = confirmDialog({ title: 'Delete Tasks?', message: 'The table and its records are deleted.', confirmLabel: 'Delete table', danger: true });
    const dlg = document.querySelector('dialog[open]');
    expect(document.getElementById(dlg.getAttribute('aria-describedby')).textContent).toBe('The table and its records are deleted.');
    expect(document.activeElement.textContent).toBe('Cancel');
    click(document.activeElement);
    expect(await done).toBe(false);
  });
});

describe('the date picker', () => {
  const mount = (opts) => {
    const cal = calendar(opts);
    document.body.append(cal.el);
    const title = () => cal.el.querySelector('.cal-title').textContent;
    return { cal, title };
  };

  it('keeps focus on Next month, so a second press pages again rather than picking a day', () => {
    const picked = [];
    const { cal, title } = mount({ value: '2026-10-12', onPick: (d) => picked.push(d) });
    const next = cal.el.querySelector('[aria-label="Next month"]');
    next.focus();
    click(next);
    expect(title()).toBe('November 2026');
    expect(document.activeElement).toBe(next);
    click(next);
    expect(title()).toBe('December 2026');
    expect(picked).toEqual([]);
    cal.el.remove();
  });

  it('shows the month of a day picked from the next month, with focus on it', () => {
    const { cal, title } = mount({ value: '2026-10-12' });
    const day = cal.el.querySelector('[aria-label="November 1, 2026"]');
    day.focus();
    click(day);
    expect(title()).toBe('November 2026');
    expect(document.activeElement.getAttribute('aria-label')).toBe('November 1, 2026');
    expect(document.activeElement.getAttribute('aria-selected')).toBe('true');
    cal.el.remove();
  });

  it('shows this month after Today', () => {
    const { cal, title } = mount({ value: '2020-01-15' });
    click([...cal.el.querySelectorAll('button')].find((b) => b.textContent === 'Today'));
    const now = new Date();
    expect(title()).toBe(`${now.toLocaleString('en-US', { month: 'long' })} ${now.getFullYear()}`);
    expect(cal.el.querySelector('.cal-day[tabindex="0"]').classList.contains('today')).toBe(true);
    cal.el.remove();
  });
});

describe('Ctrl+Y', () => {
  it('does not redo while a popover is open, like Ctrl+Z', async () => {
    const { page } = await basePage();
    page.base.addTable('Other');
    page.base.undo();
    const anchor = document.body.appendChild(document.createElement('button'));
    const pop = openPopover(anchor, document.createElement('div'));
    key(document.body, 'y', { ctrlKey: true });
    expect(page.base.tableList().length).toBe(1);
    pop.close();
    key(document.body, 'y', { ctrlKey: true });
    expect(page.base.tableList().length).toBe(2);
    anchor.remove();
  });
});

describe('previewing attachments', () => {
  it('shows the file stepped to, even when an earlier one loads after it', async () => {
    const { page } = await basePage();
    page.store.readFile = async (path) => {
      await tick(path.endsWith('slow.txt') ? 30 : 0);
      return new Blob(['x'], { type: 'text/plain' });
    };
    const a = { id: 'att1', name: 'slow.txt', path: 'p/slow.txt', type: 'application/x-slow', size: 1 };
    const b = { id: 'att2', name: 'fast.txt', path: 'p/fast.txt', type: 'application/x-fast', size: 1 };
    previewAttachment(page, a, [a, b]);
    click(document.querySelector('[aria-label="Next file"]'));
    await tick(50);
    expect(document.querySelector('.att-title').textContent).toBe('fast.txt');
    expect(document.querySelector('.att-file p').textContent).toBe('fast.txt');
    click(document.querySelector('dialog[open] [aria-label="Close"]'));
  });
});

describe('focus after a choice in a panel or picker', () => {
  const press = (el) => {
    el.focus();
    click(el);
  };
  const inPopover = () => !!document.activeElement?.closest('.popover');

  it('stays on a hide-fields switch', async () => {
    const { page, t } = await basePage();
    page.base.addField(t.id, { name: 'Notes', type: 'text' });
    click(toolBtn('hide'));
    const sw = document.querySelector('.hide-panel input[aria-label="Show Notes"]');
    press(sw);
    expect(t.views[0].hidden).toContain(t.fieldByName('Notes').id);
    expect(document.activeElement.getAttribute('aria-label')).toBe('Show Notes');
    expect(document.activeElement.checked).toBe(false);
  });

  it('stays on a sort direction, and in the panel after adding a sort', async () => {
    const { t } = await basePage();
    click(toolBtn('sort'));
    const add = document.querySelector('.levels-panel .link-btn');
    add.focus();
    click(add);
    click([...document.querySelectorAll('.menu-item')].find((x) => x.textContent === t.primary.name));
    expect(inPopover()).toBe(true);
    press(document.querySelectorAll('.levels-panel [role=radio]')[1]);
    expect(t.views[0].sorts[0].dir).toBe('desc');
    expect(document.activeElement.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement.closest('.levels-panel')).not.toBeNull();
  });

  it('stays on the color mode chosen', async () => {
    const { t } = await basePage();
    click(toolBtn('color'));
    press([...document.querySelectorAll('.color-panel [role=radio]')].find((b) => b.textContent === 'By conditions'));
    expect(t.views[0].color.type).toBe('conditions');
    expect(document.activeElement.textContent).toBe('By conditions');
    expect(document.activeElement.getAttribute('aria-checked')).toBe('true');
  });

  it('returns to a color rule after editing its conditions, and keeps them', async () => {
    const { t } = await basePage();
    click(toolBtn('color'));
    press([...document.querySelectorAll('.color-panel [role=radio]')].find((b) => b.textContent === 'By conditions'));
    click([...document.querySelectorAll('.color-panel .link-btn')].find((b) => b.textContent.includes('Add a color rule')));
    press(document.querySelector('.color-panel .rule-edit'));
    const input = document.querySelector('.popover[aria-label="Rule conditions"] input.filter-value');
    input.focus();
    input.value = 'urgent';
    input.dispatchEvent(new Event('input'));
    key(input, 'Escape');
    expect(document.activeElement.classList.contains('rule-edit')).toBe(true);
    expect(document.activeElement.textContent).toContain('urgent');
    press(document.querySelector('.color-panel .color-rule .swatch'));
    click(document.querySelector('.popover[aria-label="Rule color"] [aria-label="purple"]'));
    const rule = t.views[0].color.rules[0];
    expect(rule.color).toBe('purple');
    expect(rule.filter.conditions[0].value).toBe('urgent');
  });

  it('stays on a base color, and Escape returns to the base title', async () => {
    const { page } = await basePage();
    const title = () => document.querySelector('.base-title-btn');
    press(title());
    click([...document.querySelectorAll('.menu-item')].find((x) => x.textContent.includes('Change color and icon')));
    const swatch = [...document.querySelectorAll('.appearance .swatch')].find((b) => b.getAttribute('aria-checked') !== 'true');
    const color = swatch.getAttribute('aria-label');
    press(swatch);
    expect(page.base.doc.color).toBe(color);
    expect(document.activeElement).toBe(swatch);
    expect(swatch.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelectorAll('.appearance .swatch[aria-checked=true]').length).toBe(1);
    key(document.activeElement, 'Escape');
    expect(document.activeElement).toBe(title());
  });

  it('stays on a base color on the home page, and Escape returns to the base\'s button', async () => {
    const { app, store } = await mountApp();
    const id = await store.createBase({ name: 'Plans', color: 'blue' });
    app.navigate('');
    await app.route();
    const more = () => document.querySelector(`[data-base="${id}"] [aria-label="More actions for Plans"]`);
    press(more());
    click([...document.querySelectorAll('.menu-item')].find((x) => x.textContent.includes('Change color and icon')));
    const swatch = document.querySelector('.appearance .swatch[aria-label="green"]');
    press(swatch);
    await tick();
    expect(store.entry(id).color).toBe('green');
    expect(document.activeElement).toBe(swatch);
    key(document.activeElement, 'Escape');
    expect(document.activeElement).toBe(more());
  });

  it('stays in the field editor after choosing a color, a toggle, or removing an option', async () => {
    const { page, t } = await basePage();
    const anchor = document.body.appendChild(document.createElement('button'));
    const rating = page.base.addField(t.id, { name: 'Stars', type: 'rating' });
    openFieldEditor(anchor, page, t, { field: t.field(rating) });
    const sw = [...document.querySelectorAll('.field-editor .swatch')].find((b) => b.getAttribute('aria-checked') !== 'true');
    press(sw);
    expect(document.activeElement).toBe(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    key(sw, 'Escape');

    const due = page.base.addField(t.id, { name: 'Due', type: 'date' });
    openFieldEditor(anchor, page, t, { field: t.field(due) });
    const toggleRow = [...document.querySelectorAll('.field-editor .switch-row')].find((r) => r.textContent === 'Include time');
    press(toggleRow.querySelector('input'));
    expect(document.querySelector('.field-editor select[aria-label="Time format"]')).not.toBeNull();
    expect(document.activeElement.closest('.switch-row')?.textContent).toBe('Include time');
    key(document.activeElement, 'Escape');

    const sel = page.base.addField(t.id, { name: 'S', type: 'singleSelect', options: { choices: [{ id: 'selA', name: 'A', color: 'blue' }, { id: 'selB', name: 'B', color: 'red' }] } });
    openFieldEditor(anchor, page, t, { field: t.field(sel) });
    press(document.querySelector('[aria-label="Remove A"]'));
    expect(document.activeElement.getAttribute('aria-label')).toBe('Remove B');
    press(document.querySelector('[aria-label="Color of B"]'));
    click(document.querySelector('.popover [aria-label="green"]'));
    expect(document.activeElement.getAttribute('aria-label')).toBe('Color of B');
    key(document.activeElement, 'Escape');
    anchor.remove();
  });

  it('stays on the rating star chosen in an expanded record', async () => {
    const { page, t } = await basePage();
    const f = page.base.addField(t.id, { name: 'Stars', type: 'rating' });
    const [rid] = page.base.createRecords(t.id, [{}]);
    page.openRecord(rid);
    await tick(20);
    press(document.querySelector(`[data-field="${f}"] [aria-label="3 of 5"]`));
    expect(t.record(rid).c[f]).toBe(3);
    expect(document.activeElement.getAttribute('aria-label')).toBe('3 of 5');
    expect(document.activeElement.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelectorAll(`[data-field="${f}"] .rating-star.on`).length).toBe(3);
  });
});

describe('table tabs', () => {
  it('scroll sideways with a mouse wheel when they do not fit, and show a cut-short name in full', async () => {
    const proto = HTMLElement.prototype;
    // jsdom has no layout: a long tab name is wider than its tab, and the tabs wider than the bar.
    Object.defineProperty(proto, 'scrollWidth', { configurable: true, get() {
      return this.classList.contains('table-tabs') || (this.classList.contains('tab-name') && this.textContent.length > 30) ? 400 : 0;
    } });
    Object.defineProperty(proto, 'clientWidth', { configurable: true, get() {
      return this.classList.contains('table-tabs') ? 200 : 0;
    } });
    try {
      const { page } = await basePage();
      const long = 'A table with a very long name indeed';
      page.base.addTable(long);
      await tick(40);
      const tabs = document.querySelector('.table-tabs');
      const tab = [...tabs.querySelectorAll('.table-tab')].find((x) => x.textContent === long);
      expect(tab.title).toBe(long);
      const e = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
      tabs.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
      expect(tabs.scrollLeft).toBe(120);
    } finally {
      delete proto.scrollWidth;
      delete proto.clientWidth;
    }
  });
});
