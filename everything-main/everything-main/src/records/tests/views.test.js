import { describe, it, expect } from 'vitest';
import { mountApp, openBase, tick, click, key } from './helpers/app.js';
import { TEMPLATES, buildTemplate } from '../src/data/templates.js';
import { toDate, dateKey, addDays } from '../src/lib/format.js';

async function projects() {
  const { app, store } = await mountApp();
  const tpl = TEMPLATES.find((t) => t.id === 'projects');
  const built = buildTemplate(tpl);
  const id = await store.createBase({ name: tpl.name, doc: built.doc, records: built.records });
  const page = await openBase(app, id);
  return { page, table: page.table };
}

describe('kanban', () => {
  it('stacks by status and moves cards between stacks', async () => {
    const { page, table } = await projects();
    page.go(table.id, table.views.find((v) => v.type === 'kanban').id);
    await tick();
    const k = page.viewInst;
    const labels = [...document.querySelectorAll('.stack[data-drop]')].map((s) => s.getAttribute('aria-label'));
    expect(labels).toEqual(['Planning', 'In progress', 'Blocked', 'Done']);
    const status = table.fieldByName('Status');
    const done = status.options.choices.find((c) => c.name === 'Done');
    const rec = table.ordered()[0];
    k.drop({ id: rec.id, zone: done.id, beforeId: null });
    expect(rec.c[status.id]).toBe(done.id);
    expect(document.querySelector(`.stack[data-drop="${done.id}"]`).textContent).toContain(page.base.recordName(table.id, rec.id));
    page.undo();
    expect(rec.c[status.id]).not.toBe(done.id);
  });
});

describe('gallery', () => {
  it('Enter on the Add record tile adds a record', async () => {
    const { page, table } = await projects();
    const v = page.base.addView(table.id, 'gallery', 'Cards');
    page.go(table.id, v);
    await tick();
    let opened = 'none';
    page.openRecord = (id) => (opened = id);
    const add = document.querySelector('.card-add');
    const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    add.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    click(add);
    expect(opened).not.toBe(undefined);
  });
});

describe('gallery keys', () => {
  it('ArrowDown moves to the card below', async () => {
    const { page, table } = await projects();
    page.base.createRecords(table.id, Array.from({ length: 20 }, () => ({})));
    const v = page.base.addView(table.id, 'gallery', 'Cards');
    page.go(table.id, v);
    await tick();
    const cards = [...document.querySelectorAll('.gallery .card')];
    // Eight cards per row on a very wide screen.
    cards.forEach((c, i) => {
      Object.defineProperty(c, 'offsetTop', { configurable: true, get: () => Math.floor(i / 8) * 300 });
      Object.defineProperty(c, 'offsetWidth', { configurable: true, get: () => 240 });
    });
    Object.defineProperty(document.querySelector('.gallery'), 'clientWidth', { configurable: true, get: () => 2050 });
    cards[1].focus();
    cards[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(cards[9]);
  });
});

describe('gallery covers', () => {
  it('load near the screen and are not refetched on each change', async () => {
    const Real = globalThis.IntersectionObserver;
    // The first 30 covers observed are on screen.
    globalThis.IntersectionObserver = class {
      constructor(cb) {
        this.cb = cb;
        this.seen = 0;
      }
      observe(el) {
        if (el.classList.contains('card-cover') && this.seen++ < 30) queueMicrotask(() => this.cb([{ isIntersecting: true, target: el }]));
      }
      unobserve() {}
      disconnect() {
        this.seen = 0;
      }
    };
    try {
      const { page, table } = await projects();
      const files = page.base.addField(table.id, { name: 'Photo', type: 'attachment' });
      page.base.createRecords(table.id, Array.from({ length: 400 }, (_, i) => ({ [files]: [{ id: `a${i}`, name: `p${i}.png`, size: 1, type: 'image/png', path: `p${i}.png` }] })));
      const v = page.base.addView(table.id, 'gallery', 'Photos');
      page.base.updateView(table.id, v, { coverFieldId: files });
      let reads = 0;
      page.store.readFile = async () => {
        reads++;
        return new Blob(['x'], { type: 'image/png' });
      };
      page.go(table.id, v);
      await tick(5);
      page.viewInst.limit = 420;
      page.viewInst.render();
      await tick(5);
      const first = reads;
      expect(first).toBeLessThanOrEqual(30);
      page.base.setCell(table.id, table.ordered()[0].id, table.primary.id, 'Renamed');
      await tick(5);
      expect(reads).toBe(first);
    } finally {
      globalThis.IntersectionObserver = Real;
    }
  });
});

describe('kanban keys', () => {
  it('ArrowRight passes over empty stacks', async () => {
    const { page, table } = await projects();
    const status = table.fieldByName('Status');
    const [planning, , , done] = status.options.choices;
    // Only the first and last stacks have cards.
    table.ordered().forEach((r, i) => page.base.setCell(table.id, r.id, status.id, i % 2 ? done.id : planning.id));
    page.go(table.id, table.views.find((v) => v.type === 'kanban').id);
    await tick();
    const card = document.querySelector(`.stack[data-drop="${planning.id}"] .card`);
    card.focus();
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(document.querySelector(`.stack[data-drop="${done.id}"] .card`));
  });
});

describe('kanban stacked by a link', () => {
  it('shows only linked records with cards when the linked table is big', async () => {
    const { page, table } = await projects();
    const people = page.base.addTable('People');
    const ids = page.base.createRecords(people, Array.from({ length: 2000 }, (_, i) => ({ [page.base.table(people).primary.id]: `P${i}` })));
    const owner = page.base.addField(table.id, { name: 'Lead', type: 'link', options: { tableId: people, single: true } });
    page.base.setCell(table.id, table.ordered()[0].id, owner, [ids[5]]);
    const v = page.base.addView(table.id, 'kanban', 'By lead');
    page.base.updateView(table.id, v, { stackFieldId: owner });
    page.go(table.id, v);
    await tick();
    expect([...document.querySelectorAll('.stack[data-drop]')].map((s) => s.getAttribute('aria-label'))).toEqual(['Not linked', 'P5']);
  });
});

describe('calendar', () => {
  it('moves a record and its end date together', async () => {
    const { page, table } = await projects();
    const v = page.base.addView(table.id, 'calendar', 'Cal');
    const start = table.fieldByName('Start');
    const due = table.fieldByName('Due');
    page.base.updateView(table.id, v, { dateFieldId: start.id, endFieldId: due.id });
    page.go(table.id, v);
    await tick();
    const rec = table.ordered()[0];
    const s0 = rec.c[start.id];
    const d0 = rec.c[due.id];
    const key = dateKey(addDays(toDate(s0), 3));
    page.viewInst.drop({ id: rec.id, zone: key });
    expect(rec.c[start.id]).toBe(key);
    expect(rec.c[due.id]).toBe(dateKey(addDays(toDate(d0), 3)));
  });

  it('opens a record when its event is clicked', async () => {
    const { page, table } = await projects();
    const v = table.views.find((x) => x.type === 'calendar');
    const start = table.fieldByName(page.base.table(table.id).field(v.dateFieldId).name);
    const rec = table.ordered()[0];
    page.base.setCell(table.id, rec.id, start.id, dateKey(new Date()));
    page.go(table.id, v.id);
    await tick();
    let opened = null;
    page.openRecord = (id) => (opened = id);
    click(document.querySelector(`.event[data-id="${rec.id}"]`));
    expect(opened).toBe(rec.id);
  });

  it('Enter on a day with records focuses its first record', async () => {
    const { page, table } = await projects();
    const v = table.views.find((x) => x.type === 'calendar');
    const rec = table.ordered()[0];
    const today = dateKey(new Date());
    page.base.setCell(table.id, rec.id, v.dateFieldId, today);
    page.go(table.id, v.id);
    await tick();
    const count = table.records.size;
    const day = document.querySelector(`.day[data-drop="${today}"]`);
    day.focus();
    key(day, 'Enter');
    expect(table.records.size).toBe(count);
    expect(document.activeElement.classList.contains('event')).toBe(true);
  });

  it('moves a span by the day it was grabbed on', async () => {
    const { page, table } = await projects();
    const v = page.base.addView(table.id, 'calendar', 'Cal');
    const start = table.fieldByName('Start');
    const due = table.fieldByName('Due');
    page.base.updateView(table.id, v, { dateFieldId: start.id, endFieldId: due.id });
    page.go(table.id, v);
    await tick();
    const rec = table.ordered()[0];
    page.base.setCells(table.id, [{ id: rec.id, cells: { [start.id]: '2026-03-02', [due.id]: '2026-03-06' } }]);
    page.viewInst.drop({ id: rec.id, zone: '2026-03-06', from: '2026-03-05' });
    expect(rec.c[start.id]).toBe('2026-03-03');
    expect(rec.c[due.id]).toBe('2026-03-07');
  });

  it('places times shown in GMT on the day they show', async () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const { page, table } = await projects();
      const at = page.base.addField(table.id, { name: 'At', type: 'date', options: { includeTime: true, gmt: true } });
      const v = page.base.addView(table.id, 'calendar', 'GMT');
      page.base.updateView(table.id, v, { dateFieldId: at });
      const rec = table.ordered()[0];
      const now = new Date();
      const day = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 15, 2));
      page.base.setCell(table.id, rec.id, at, day.toISOString());
      page.go(table.id, v);
      await tick();
      const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
      const cell = document.querySelector(`.day[data-drop="${key}"]`);
      expect(cell.querySelector(`.event[data-id="${rec.id}"]`)).not.toBeNull();
      expect(cell.querySelector('.event-time').textContent).toBe('2a');
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it('shows long spans on every day they cover', async () => {
    const { page, table } = await projects();
    const v = page.base.addView(table.id, 'calendar', 'Cal');
    const start = table.fieldByName('Start');
    const due = table.fieldByName('Due');
    page.base.updateView(table.id, v, { dateFieldId: start.id, endFieldId: due.id });
    const rec = table.ordered()[0];
    const now = new Date();
    // Started four months ago, ends next month: covers all of this month.
    const s = dateKey(new Date(now.getFullYear(), now.getMonth() - 4, 1));
    const e = dateKey(new Date(now.getFullYear(), now.getMonth() + 1, 10));
    page.base.setCells(table.id, [{ id: rec.id, cells: { [start.id]: s, [due.id]: e } }]);
    page.go(table.id, v);
    await tick();
    const last = dateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    for (const k of [dateKey(new Date(now.getFullYear(), now.getMonth(), 1)), last]) {
      expect(document.querySelector(`.day[data-drop="${k}"] .event[data-id="${rec.id}"]`)).not.toBeNull();
    }
  });

  it('switches to a week', async () => {
    const { page, table } = await projects();
    const v = table.views.find((x) => x.type === 'calendar');
    page.go(table.id, v.id);
    await tick();
    page.base.updateView(table.id, v.id, { calMode: 'week' }, { undoable: false });
    expect(document.querySelectorAll('.day').length).toBe(7);
  });
});

describe('timeline', () => {
  async function timeline() {
    const { page, table } = await projects();
    const v = table.views.find((x) => x.type === 'timeline');
    page.go(table.id, v.id);
    await tick();
    return { page, table, v, start: table.field(v.dateFieldId), end: table.field(v.endFieldId) };
  }

  it('keeps the date at the left edge when the scale changes', async () => {
    const { page, table, v } = await timeline();
    const t = page.viewInst;
    const leftDate = () => addDays(t.origin, Math.round(t.pendingScroll.left / t.ppd)).getTime();
    page.base.updateView(table.id, v.id, { scale: 'week' }, { undoable: false });
    const before = leftDate();
    page.base.updateView(table.id, v.id, { scale: 'day' }, { undoable: false });
    expect(t.ppd).toBe(44);
    expect(leftDate()).toBe(before);
  });

  it('draws ticks around the visible dates only', async () => {
    const { page, table, v, start } = await timeline();
    page.base.updateView(table.id, v.id, { scale: 'day' }, { undoable: false });
    page.base.setCell(table.id, table.ordered()[0].id, start.id, '1926-01-01');
    const t0 = performance.now();
    page.viewInst.render(false);
    expect(performance.now() - t0).toBeLessThan(250);
    expect(document.querySelectorAll('.tl-tick').length).toBeLessThan(400);
    expect(document.querySelectorAll('.tl-weekend').length).toBeLessThan(100);
  });

  it('a touch swipe across a bar scrolls instead of moving it', async () => {
    const { table, start } = await timeline();
    const rec = table.ordered()[0];
    const before = rec.c[start.id];
    const bar = document.querySelector(`.tl-bar[data-id="${rec.id}"]`);
    const ev = (type, x) => {
      const e = new MouseEvent(type, { clientX: x, clientY: 10, button: 0, bubbles: true, cancelable: true });
      Object.defineProperty(e, 'pointerType', { value: 'touch' });
      return e;
    };
    bar.dispatchEvent(ev('pointerdown', 100));
    window.dispatchEvent(ev('pointermove', 300));
    window.dispatchEvent(ev('pointerup', 300));
    expect(rec.c[start.id]).toBe(before);
  });

  it('offers formulas that give dates as dates, not numbers', async () => {
    const { page, table } = await timeline();
    page.base.addField(table.id, { name: 'Number formula', type: 'formula', options: { formula: '1 + 1' } });
    page.base.addField(table.id, { name: 'Date formula', type: 'formula', options: { formula: 'TODAY()' } });
    await tick();
    click(document.querySelector('.tool-btn.t-dates'));
    const names = [...document.querySelectorAll('select[aria-label="Start date"] option')].map((o) => o.textContent);
    expect(names).toContain('Date formula');
    expect(names).not.toContain('Number formula');
  });

  it('lets the first date field be chosen when none is set', async () => {
    const { page, table, v } = await timeline();
    page.base.updateView(table.id, v.id, { dateFieldId: null });
    await tick();
    click(document.querySelector('.tool-btn.t-dates'));
    const select = document.querySelector('select[aria-label="Start date"]');
    expect(select.value).toBe('');
    select.value = select.querySelector('option:not([disabled])').value;
    select.dispatchEvent(new Event('change'));
    expect(v.dateFieldId).toBeTruthy();
  });

  it('keeps the start of a bar on or before its end', async () => {
    const { page, table, start, end } = await timeline();
    const rec = table.ordered()[0];
    page.base.setCells(table.id, [{ id: rec.id, cells: { [start.id]: '2026-03-02', [end.id]: '2026-03-06' } }]);
    page.viewInst.shiftRecord(rec.id, 10, 'start');
    expect(rec.c[start.id]).toBe('2026-03-06');
    page.viewInst.shiftRecord(rec.id, -10, 'end');
    expect(rec.c[end.id]).toBe('2026-03-06');
  });

  it('drags the end of a bar that has no end date', async () => {
    const { page, table, start, end } = await timeline();
    const rec = table.ordered()[0];
    page.base.setCells(table.id, [{ id: rec.id, cells: { [start.id]: '2026-03-02', [end.id]: null } }]);
    page.viewInst.shiftRecord(rec.id, 3, 'end');
    expect(rec.c[end.id]).toBe('2026-03-05');
  });

  it('shifts dates with the keyboard helper', async () => {
    const { page, table } = await projects();
    const v = table.views.find((x) => x.type === 'timeline');
    page.go(table.id, v.id);
    await tick();
    const rec = table.ordered()[1];
    const due = table.fieldByName('Due');
    const before = rec.c[due.id];
    page.viewInst.shiftRecord(rec.id, 2, 'end');
    expect(rec.c[due.id]).toBe(dateKey(addDays(toDate(before), 2)));
  });
});
