import { describe, it, expect } from 'vitest';
import { mountApp, openBase, tick, click, key } from './helpers/app.js';
import { TEMPLATES, buildTemplate } from '../src/data/templates.js';
import { enableCardDrag } from '../src/views/drag.js';

async function rsvpForm() {
  const { app, store } = await mountApp();
  const tpl = TEMPLATES.find((t) => t.id === 'events');
  const built = buildTemplate(tpl);
  const id = await store.createBase({ name: tpl.name, doc: built.doc, records: built.records });
  const page = await openBase(app, id);
  const guests = page.base.tableList()[1];
  page.go(guests.id, guests.views.find((v) => v.type === 'form').id);
  await tick();
  return { page, guests };
}

async function openForm() {
  click([...document.querySelectorAll('.form-bar .btn')].find((b) => b.textContent.includes('Open form')));
  await tick();
}

// The form reports every keystroke as a change, as typing does.
function type(input, text) {
  input.value = '';
  for (const ch of text) {
    input.value += ch;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

const submit = () => document.querySelector('form.form-fill').dispatchEvent(new Event('submit', { cancelable: true }));

describe('form fill', () => {
  it('does not submit a field marked invalid with its last valid value', async () => {
    const { guests } = await rsvpForm();
    await openForm();
    const name = document.getElementById(`form-${guests.primary.id}`);
    type(name, 'Dee');
    const plus = document.getElementById(`form-${guests.fieldByName('Plus ones').id}`);
    type(plus, '1,5');
    expect(plus.classList.contains('invalid')).toBe(true);
    const before = guests.records.size;
    submit();
    await tick(5);
    expect(guests.records.size).toBe(before);
    expect(plus.closest('.form-q').querySelector('.field-error').textContent).toMatch(/Enter a valid/);
    expect(document.activeElement).toBe(plus);
  });
});

async function projects() {
  const { app, store } = await mountApp();
  const tpl = TEMPLATES.find((t) => t.id === 'projects');
  const built = buildTemplate(tpl);
  const id = await store.createBase({ name: tpl.name, doc: built.doc, records: built.records });
  const page = await openBase(app, id);
  return { page, table: page.table, base: page.base };
}

describe('kanban stack field', () => {
  it('stops stacking by a link field once it allows several links', async () => {
    const { page, base } = await projects();
    const tasks = base.tableList()[1];
    const link = tasks.fieldByName('Project');
    base.updateField(tasks.id, link.id, { options: { ...link.options, single: true } });
    const v = base.addView(tasks.id, 'kanban', 'By project');
    base.updateView(tasks.id, v, { stackFieldId: link.id });
    page.go(tasks.id, v);
    await tick();
    expect(document.querySelectorAll('.stack[data-drop]').length).toBeGreaterThan(1);
    base.updateField(tasks.id, link.id, { options: { ...tasks.field(link.id).options, single: false } });
    await tick();
    expect(document.querySelector('.stack[data-drop]')).toBeNull();
    expect(document.querySelector('.kanban .empty h2').textContent).toBe('Choose how to stack records');
    // The toolbar agrees with the board.
    expect(document.querySelector('.tool-btn.t-stack').getAttribute('aria-label')).toBe('Choose a stack field');
    // A drop (from a menu opened before the change) leaves the links alone.
    const [p1, p2] = base.tableList()[0].ordered();
    const rec = tasks.ordered()[0];
    base.setCell(tasks.id, rec.id, link.id, [p1.id, p2.id]);
    page.viewInst.drop({ id: rec.id, zone: p2.id, beforeId: null });
    expect(rec.c[link.id]).toEqual([p1.id, p2.id]);
  });

  it('shows how to choose a stack field when the field can no longer stack', async () => {
    const { page, table, base } = await projects();
    page.go(table.id, table.views.find((v) => v.type === 'kanban').id);
    await tick();
    base.updateField(table.id, table.fieldByName('Status').id, { type: 'text' });
    await tick();
    expect(document.querySelector('.kanban .empty h2').textContent).toBe('Choose how to stack records');
  });
});

describe('kanban board', () => {
  it('stacked by a checkbox has no stray text after the stacks', async () => {
    const { page, base } = await projects();
    const tasks = base.tableList()[1];
    const v = base.addView(tasks.id, 'kanban', 'By done');
    base.updateView(tasks.id, v, { stackFieldId: tasks.fieldByName('Done').id });
    page.go(tasks.id, v);
    await tick();
    const board = document.querySelector('.kanban');
    expect([...board.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE)).toEqual([]);
  });
});

describe('form builder', () => {
  it('brings a field back after undoing the change that made it computed', async () => {
    const { page, guests } = await rsvpForm();
    const plus = guests.fieldByName('Plus ones');
    expect(page.view.form.fields.some((x) => x.id === plus.id)).toBe(true);
    page.base.updateField(guests.id, plus.id, { type: 'formula', options: { formula: '1', format: 'auto', precision: 0 } });
    await tick();
    expect(document.querySelector(`[aria-label="Label for Plus ones"]`)).toBeNull();
    page.undo();
    await tick();
    expect(page.view.form.fields.some((x) => x.id === plus.id)).toBe(true);
    expect(document.querySelector(`[aria-label="Label for Plus ones"]`)).not.toBeNull();
  });
});

describe('moving GMT times across a clock change', () => {
  // New York leaves summer time on November 1, 2026.
  async function withTz(fn) {
    const tz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      await fn();
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  }
  async function setup(type) {
    const { page, table, base } = await projects();
    const when = base.addField(table.id, { name: 'When', type: 'date', options: { includeTime: true, gmt: true } });
    const rec = table.ordered()[0];
    base.setCell(table.id, rec.id, when, '2026-10-30T23:30:00.000Z');
    const v = base.addView(table.id, type, type);
    base.updateView(table.id, v, { dateFieldId: when, endFieldId: null });
    page.go(table.id, v);
    await tick();
    return { page, rec, when };
  }

  it('keeps the GMT time when a calendar event moves', () => withTz(async () => {
    const { page, rec, when } = await setup('calendar');
    page.viewInst.drop({ id: rec.id, zone: '2026-11-02', from: '2026-10-30' });
    expect(rec.c[when]).toBe('2026-11-02T23:30:00.000Z');
  }));

  it('keeps the GMT time when a timeline bar moves', () => withTz(async () => {
    const { page, rec, when } = await setup('timeline');
    page.viewInst.shiftRecord(rec.id, 3, 'both');
    expect(rec.c[when]).toBe('2026-11-02T23:30:00.000Z');
  }));
});

async function bigList(n = 200) {
  const { page, table, base } = await projects();
  const status = table.fieldByName('Status');
  const planning = status.options.choices.find((c) => c.name === 'Planning').id;
  base.createRecords(table.id, Array.from({ length: n }, (_, i) => ({ [table.primary.id]: `Item ${i}`, [status.id]: planning })));
  const v = base.addView(table.id, 'list', 'List');
  page.go(table.id, v);
  await tick();
  return { page, table, base, status, planning, v };
}

describe('list show more', () => {
  it('is not offered when the rest are in collapsed groups', async () => {
    const { page, table, base, status, planning, v } = await bigList();
    base.updateView(table.id, v, { groups: [{ fieldId: status.id, dir: 'asc' }] });
    await tick();
    expect(document.querySelector('.list-more')).not.toBeNull();
    base.updateView(table.id, v, { collapsed: [planning] }, { undoable: false });
    await tick();
    expect(document.querySelector('.list-more')).toBeNull();
    void page;
  });
});

async function viewOf(type, n) {
  const { page, table, base } = await projects();
  base.createRecords(table.id, Array.from({ length: n }, (_, i) => ({ [table.primary.id]: `Item ${i}` })));
  const v = base.addView(table.id, type, type);
  page.go(table.id, v);
  await tick();
  return { page, table, base, v };
}

function findText(page, text) {
  page.openFind();
  const input = page.find.input;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  return () => document.querySelector('.find-count').textContent;
}

for (const [type, item] of [['gallery', '.gallery .card[data-id]'], ['list', '.list-row']]) {
  describe(`find in ${type}`, () => {
    it('counts every match but draws only up to the current one, and shrinks back after', async () => {
      const { page } = await viewOf(type, 1000);
      const drawn = () => document.querySelectorAll(item).length;
      const before = drawn();
      const count = findText(page, 'Item');
      expect(count()).toBe('1 of 1000');
      expect(drawn()).toBe(before);
      page.closeFind();
      expect(drawn()).toBe(before);
      const count2 = findText(page, 'Item 700');
      expect(count2()).toBe('1 of 1');
      expect(drawn()).toBeGreaterThan(700);
      expect(drawn()).toBeLessThan(1004);
      page.closeFind();
      expect(drawn()).toBe(before);
    });

    it('keeps the current match when a record changes, drawing once', async () => {
      const { page, table, base } = await viewOf(type, 30);
      const count = findText(page, 'Item');
      page.find.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      page.find.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(count()).toBe('3 of 30');
      let renders = 0;
      const render = page.viewInst.render.bind(page.viewInst);
      page.viewInst.render = () => {
        renders++;
        render();
      };
      base.setCell(table.id, table.ordered()[0].id, table.fieldByName('Owner').id, 'Zed');
      expect(count()).toBe('3 of 30');
      expect(renders).toBe(1);
    });

    it('stays on the same record when an earlier match goes away', async () => {
      const { page, table, base } = await viewOf(type, 30);
      const count = findText(page, 'Item');
      page.find.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      page.find.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      const current = page.viewInst.hits[page.viewInst.hitIndex];
      expect(base.recordName(table.id, current)).toBe('Item 2');
      const first = table.ordered().find((r) => r.c[table.primary.id] === 'Item 0');
      base.setCell(table.id, first.id, table.primary.id, 'Zed');
      expect(count()).toBe('2 of 29');
      expect(page.viewInst.hits[page.viewInst.hitIndex]).toBe(current);
    });
  });
}

describe('find in kanban', () => {
  it('finds cards beyond those drawn in a stack and draws down to them', async () => {
    const { page, table, base, status, planning } = await bigList(100);
    page.go(table.id, table.views.find((x) => x.type === 'kanban').id);
    await tick();
    const stack = document.querySelector(`.stack[data-drop="${planning}"]`);
    expect(stack.querySelectorAll('.card').length).toBe(60);
    const count = findText(page, 'Item 80');
    expect(count()).toBe('1 of 1');
    const card = document.querySelector('.card.search-hit');
    expect(card?.textContent).toContain('Item 80');
    page.find.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(document.activeElement.textContent).toContain('Item 80');
    void base;
    void status;
  });

  it('keeps the current match when a record changes, drawing once', async () => {
    const { page, table, base } = await bigList(30);
    page.go(table.id, table.views.find((x) => x.type === 'kanban').id);
    await tick();
    const count = findText(page, 'Item');
    page.find.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    page.find.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(count()).toBe('3 of 30');
    let renders = 0;
    const render = page.viewInst.render.bind(page.viewInst);
    page.viewInst.render = () => {
      renders++;
      render();
    };
    base.setCell(table.id, table.ordered()[0].id, table.fieldByName('Owner').id, 'Zed');
    expect(count()).toBe('3 of 30');
    expect(renders).toBe(1);
  });
});

describe('find in calendar', () => {
  async function calendar() {
    const { page, table, base } = await projects();
    page.go(table.id, table.views.find((x) => x.type === 'calendar').id);
    await tick();
    return { page, table, base };
  }

  it('finds a record in another month and goes there', async () => {
    const { page, table, base } = await calendar();
    const far = new Date();
    far.setDate(1);
    far.setMonth(far.getMonth() + 4);
    const key = `${far.getFullYear()}-${String(far.getMonth() + 1).padStart(2, '0')}-10`;
    base.createRecords(table.id, [{ [table.primary.id]: 'Faraway', [table.fieldByName('Due').id]: key }]);
    await tick();
    const count = findText(page, 'Faraway');
    expect(count()).toBe('1 of 1');
    expect(document.querySelector('.event.search-hit')?.textContent).toContain('Faraway');
    page.find.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(document.activeElement.classList.contains('event')).toBe(true);
    expect(document.activeElement.textContent).toContain('Faraway');
  });

  it('keeps the current match when a record changes', async () => {
    const { page, table, base } = await calendar();
    const t = new Date();
    const day = (n) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
    base.createRecords(table.id, [{ [table.primary.id]: 'Zeta one', [table.fieldByName('Due').id]: day(10) }, { [table.primary.id]: 'Zeta two', [table.fieldByName('Due').id]: day(12) }]);
    const count = findText(page, 'Zeta');
    page.find.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(count()).toBe('2 of 2');
    base.setCell(table.id, table.ordered()[0].id, table.fieldByName('Owner').id, 'Zed');
    expect(count()).toBe('2 of 2');
  });

  it('counts a record spanning several days once', async () => {
    const { page, table, base } = await calendar();
    base.updateView(table.id, page.view.id, { dateFieldId: table.fieldByName('Start').id, endFieldId: table.fieldByName('Due').id });
    await tick();
    const count = findText(page, 'Website refresh');
    expect(count()).toBe('1 of 1');
  });
});

describe('find in timeline', () => {
  it('highlights matching bars and steps to them', async () => {
    const { page, table } = await projects();
    page.go(table.id, table.views.find((x) => x.type === 'timeline').id);
    await tick();
    page.openFind();
    expect(page.find).not.toBeNull();
    const count = findText(page, 'Office');
    expect(count()).toBe('1 of 1');
    const bar = document.querySelector('.tl-bar.search-hit');
    expect(bar?.textContent).toContain('Office move');
    page.find.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(document.activeElement).toBe(bar);
    page.closeFind();
    expect(document.querySelector('.tl-bar.search-hit')).toBeNull();
  });
});

describe('timeline bars', () => {
  it('a short bar keeps its resize handles outside it', async () => {
    const { page, table, base } = await projects();
    const v = table.views.find((x) => x.type === 'timeline');
    const rec = table.ordered()[0];
    base.setCell(table.id, rec.id, table.fieldByName('Due').id, rec.c[table.fieldByName('Start').id]);
    page.go(table.id, v.id);
    await tick();
    const bar = document.querySelector(`.tl-bar[data-id="${rec.id}"]`);
    expect(parseFloat(bar.style.width)).toBeLessThan(24);
    expect(bar.classList.contains('short')).toBe(true);
    expect(document.querySelector('.tl-bar:not(.short)')).not.toBeNull();
  });
});

describe('form required checkbox', () => {
  it('must be checked', async () => {
    const { page, guests } = await rsvpForm();
    const agree = page.base.addField(guests.id, { name: 'Agree', type: 'checkbox' });
    page.base.updateView(guests.id, page.view.id, { form: { ...page.view.form, fields: [...page.view.form.fields, { id: agree, required: true, label: '', help: '' }] } });
    await openForm();
    type(document.getElementById(`form-${guests.primary.id}`), 'Gus');
    const before = guests.records.size;
    submit();
    await tick(5);
    expect(guests.records.size).toBe(before);
    const cb = document.getElementById(`form-${agree}`);
    expect(cb.closest('.form-q').querySelector('.field-error').textContent).toBe('Agree must be checked.');
    expect(document.activeElement).toBe(cb);
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    submit();
    await tick(5);
    expect(guests.records.size).toBe(before + 1);
    expect(guests.ordered().at(-1).c[agree]).toBe(true);
  });
});

describe('form accessibility', () => {
  it('names pickers by the form label and describes them by help and errors', async () => {
    const { page, guests } = await rsvpForm();
    const rsvp = guests.fieldByName('RSVP');
    const stars = page.base.addField(guests.id, { name: 'Stars', type: 'rating' });
    const fields = page.view.form.fields.map((x) => (x.id === rsvp.id ? { ...x, label: 'Your answer', help: 'Pick one', required: true } : x));
    page.base.updateView(guests.id, page.view.id, { form: { ...page.view.form, fields: [...fields, { id: stars, required: true, label: '', help: '' }] } });
    await openForm();
    const box = document.getElementById(`form-${rsvp.id}`);
    expect(box.hasAttribute('aria-label')).toBe(false);
    const name = box.getAttribute('aria-labelledby').split(' ').map((id) => document.getElementById(id).textContent).join(' ');
    expect(name).toContain('Your answer');
    expect(name).toContain('(required)');
    const desc = box.getAttribute('aria-describedby').split(' ');
    expect(desc.map((id) => document.getElementById(id)?.textContent)).toContain('Pick one');
    type(document.getElementById(`form-${guests.primary.id}`), 'Hal');
    submit();
    await tick(5);
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(desc.map((id) => document.getElementById(id)?.textContent)).toContain('Your answer is required.');
    const group = document.getElementById(`form-${stars}`);
    expect(group.hasAttribute('aria-label')).toBe(false);
    expect(group.getAttribute('aria-labelledby')).toBeTruthy();
  });

  it('focuses the first star of an empty required rating', async () => {
    const { page, guests } = await rsvpForm();
    const stars = page.base.addField(guests.id, { name: 'Stars', type: 'rating' });
    page.base.updateView(guests.id, page.view.id, { form: { ...page.view.form, fields: [{ id: stars, required: true, label: '', help: '' }] } });
    await openForm();
    submit();
    await tick(5);
    expect(document.activeElement).toBe(document.getElementById(`form-${stars}`).querySelector('button'));
  });
});

describe('form image previews', () => {
  async function pickImage() {
    const { page, guests } = await rsvpForm();
    const files = page.base.addField(guests.id, { name: 'Photo', type: 'attachment' });
    page.base.updateView(guests.id, page.view.id, { form: { ...page.view.form, fields: [...page.view.form.fields, { id: files, required: false, label: '', help: '' }] } });
    await openForm();
    type(document.getElementById(`form-${guests.primary.id}`), 'Ivy');
    const urls = [];
    const create = URL.createObjectURL;
    URL.createObjectURL = () => {
      urls.push(`blob:preview-${urls.length}`);
      return urls.at(-1);
    };
    const box = document.getElementById(`form-${files}`);
    click(box);
    const input = document.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'cat.png', { type: 'image/png' })] });
    input.dispatchEvent(new Event('change'));
    URL.createObjectURL = create;
    const revoked = [];
    const revoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (u) => revoked.push(u);
    // jsdom can't encode a thumbnail: upload without one.
    const bitmap = globalThis.createImageBitmap;
    globalThis.createImageBitmap = undefined;
    return { page, guests, urls, revoked, restore: () => {
      URL.revokeObjectURL = revoke;
      globalThis.createImageBitmap = bitmap;
    } };
  }

  it('are let go after submitting', async () => {
    const { guests, urls, revoked, restore } = await pickImage();
    try {
      expect(urls.length).toBe(1);
      const before = guests.records.size;
      submit();
      await tick(20);
      expect(guests.records.size).toBe(before + 1);
      expect(revoked).toContain(urls[0]);
    } finally {
      restore();
    }
  });

  it('are let go when going back to editing', async () => {
    const { urls, revoked, restore } = await pickImage();
    try {
      click([...document.querySelectorAll('.form-bar .btn')].find((b) => b.textContent.includes('Back to editing')));
      expect(revoked).toContain(urls[0]);
    } finally {
      restore();
    }
  });
});

describe('timeline names', () => {
  it('a focused name scrolls the bars to it, and the wheel over names scrolls the bars', async () => {
    const { page, table, base } = await projects();
    const start = table.fieldByName('Start').id;
    base.createRecords(table.id, Array.from({ length: 60 }, (_, i) => ({ [table.primary.id]: `Item ${i}`, [start]: '2026-10-01' })));
    page.go(table.id, table.views.find((x) => x.type === 'timeline').id);
    await tick();
    const scroller = document.querySelector('.tl-scroll');
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 52 + 36 * 10 });
    const names = [...document.querySelectorAll('.tl-name')];
    names[40].focus();
    expect(scroller.scrollTop).toBe(41 * 36 - 360);
    names[2].focus();
    expect(scroller.scrollTop).toBe(72);
    document.querySelector('.tl-names-clip').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true }));
    expect(scroller.scrollTop).toBe(172);
  });
});

describe('timeline bar text', () => {
  it('is dark on yellow bars', async () => {
    const { page, table, base } = await projects();
    const status = table.fieldByName('Status');
    base.updateField(table.id, status.id, { options: { ...status.options, choices: status.options.choices.map((c) => ({ ...c, color: c.name === 'Done' ? 'yellow' : c.color })) } });
    const v = table.views.find((x) => x.type === 'timeline');
    base.updateView(table.id, v.id, { color: { type: 'select', fieldId: status.id } });
    page.go(table.id, v.id);
    await tick();
    const done = table.ordered().find((r) => base.recordName(table.id, r.id) === 'Customer survey');
    const bar = document.querySelector(`.tl-bar[data-id="${done.id}"]`);
    expect(bar.style.getPropertyValue('--bar-fg')).toBe('#1d1d1d');
    const blue = document.querySelector(`.tl-bar:not([data-id="${done.id}"])`);
    expect(blue.style.getPropertyValue('--bar-fg')).toBe('#ffffff');
  });
});

describe('keyboard focus after redrawing', () => {
  it('kanban "Show more" focuses the first card it shows', async () => {
    const { page, table, planning } = await bigList(100);
    page.go(table.id, table.views.find((x) => x.type === 'kanban').id);
    await tick();
    const stack = () => document.querySelector(`.stack[data-drop="${planning}"]`);
    const more = stack().querySelector('.show-more');
    more.focus();
    click(more);
    expect(document.activeElement).toBe(stack().querySelectorAll('.card')[60]);
  });

  it('list "Show more" focuses the first row it shows', async () => {
    await bigList(200);
    const more = document.querySelector('.list-more');
    more.focus();
    click(more);
    expect(document.activeElement).toBe(document.querySelectorAll('.list-row')[150]);
  });

  it('a timeline bar that can not change keeps focus', async () => {
    const { page, table, base } = await projects();
    const rec = table.ordered()[0];
    base.setCell(table.id, rec.id, table.fieldByName('Due').id, rec.c[table.fieldByName('Start').id]);
    page.go(table.id, table.views.find((x) => x.type === 'timeline').id);
    await tick();
    const bar = document.querySelector(`.tl-bar[data-id="${rec.id}"]`);
    bar.focus();
    key(bar, 'ArrowLeft', { altKey: true, shiftKey: true });
    await tick(5);
    expect(document.activeElement?.dataset.id).toBe(rec.id);
    expect(document.activeElement).not.toBe(bar);
  });
});

describe('kanban drop in place', () => {
  it('changes nothing and adds no undo step', async () => {
    const { page, table, base } = await projects();
    page.go(table.id, table.views.find((x) => x.type === 'kanban').id);
    await tick();
    const status = table.fieldByName('Status');
    base.createRecords(table.id, [{ [status.id]: status.options.choices[0].id }, { [status.id]: status.options.choices[0].id }]);
    const stack = page.viewInst.shownStacks.find((s) => s.key === status.options.choices[0].id);
    const [a, b] = stack.records;
    let applied = 0;
    const apply = base.apply.bind(base);
    base.apply = (...args) => {
      applied++;
      return apply(...args);
    };
    page.viewInst.drop({ id: a.id, zone: stack.key, beforeId: b.id });
    page.viewInst.drop({ id: stack.records.at(-1).id, zone: stack.key, beforeId: null });
    expect(applied).toBe(0);
  });

  it('in a stack showing only its first cards, the last card shown stays put', async () => {
    const { page, table, base, planning } = await bigList(100);
    page.go(table.id, table.views.find((x) => x.type === 'kanban').id);
    await tick();
    const kanban = page.viewInst;
    const stack = kanban.shownStacks.find((s) => s.key === planning);
    const last = stack.records[59];
    const undo = base.undoStack.length;
    kanban.drop({ id: last.id, zone: planning, beforeId: null });
    expect(base.undoStack.length).toBe(undo);
    // A card dropped at the end of what is shown lands there, still shown.
    const first = stack.records[0];
    kanban.drop({ id: first.id, zone: planning, beforeId: null });
    expect([...document.querySelectorAll(`.stack[data-drop="${planning}"] .card`)].map((c) => c.dataset.id)).toContain(first.id);
  });
});

describe('card dragging', () => {
  // Two stacks side by side, 300px wide, from y 100 to 600.
  function board() {
    const root = document.createElement('div');
    const stacks = [0, 1].map((i) => {
      const s = document.createElement('div');
      s.dataset.drop = String(i);
      s.innerHTML = `<div data-cards><div data-id="c${i}">Card ${i}</div></div>`;
      s.getBoundingClientRect = () => new DOMRect(i * 300, 100, 300, 500);
      root.append(s);
      return s;
    });
    root.getBoundingClientRect = () => new DOMRect(0, 60, 600, 600);
    document.body.replaceChildren(root);
    const dropped = [];
    const clicked = [];
    enableCardDrag(root, { onDrop: (d) => dropped.push(d), onClick: (id) => clicked.push(id), scrollers: () => stacks });
    document.elementFromPoint = (x) => stacks[x < 300 ? 0 : 1];
    return { root, stacks, dropped, clicked };
  }
  const pointer = (type, x, y, target = window) => {
    const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    target.dispatchEvent(e);
  };

  it('scrolls only the stack under the pointer near its edge', async () => {
    const { stacks } = board();
    pointer('pointerdown', 50, 300, stacks[0].querySelector('[data-id]'));
    pointer('pointermove', 400, 590);
    await tick(30);
    pointer('pointerup', 400, 590);
    expect(stacks[1].scrollTop).toBeGreaterThan(0);
    expect(stacks[0].scrollTop).toBe(0);
  });

  it('Escape cancels a drag, and the release after it is not a click', async () => {
    const { stacks, dropped, clicked } = board();
    const card = stacks[0].querySelector('[data-id]');
    pointer('pointerdown', 50, 300, card);
    pointer('pointermove', 400, 300);
    expect(document.querySelector('.drag-ghost')).not.toBeNull();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(document.querySelector('.drag-ghost')).toBeNull();
    pointer('pointerup', 50, 300, card);
    click(card);
    expect(dropped).toEqual([]);
    expect(clicked).toEqual([]);
    await tick(5);
    click(card);
    expect(clicked).toEqual(['c0']);
  });
});

describe('moving by keyboard', () => {
  it('Alt+Arrow keys move a calendar event by a day or a week', async () => {
    const { page, table, base } = await projects();
    page.go(table.id, table.views.find((x) => x.type === 'calendar').id);
    await tick();
    const due = table.fieldByName('Due').id;
    const t = new Date();
    const key10 = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-10`;
    const [id] = base.createRecords(table.id, [{ [table.primary.id]: 'Keyed', [due]: key10 }]);
    await tick();
    const ev = () => document.querySelector(`.event[data-id="${id}"]`);
    ev().focus();
    key(ev(), 'ArrowRight', { altKey: true });
    expect(table.record(id).c[due]).toBe(key10.replace(/10$/, '11'));
    expect(document.activeElement).toBe(ev());
    expect(document.activeElement.closest('.day').dataset.drop).toBe(key10.replace(/10$/, '11'));
    key(ev(), 'ArrowDown', { altKey: true });
    expect(table.record(id).c[due]).toBe(key10.replace(/10$/, '18'));
    expect(document.activeElement).toBe(ev());
    // Plain arrows still do nothing to the record.
    key(ev(), 'ArrowLeft');
    expect(table.record(id).c[due]).toBe(key10.replace(/10$/, '18'));
  });

  it('Alt+Arrow keys move a kanban card within and between stacks', async () => {
    const { page, table } = await projects();
    page.go(table.id, table.views.find((x) => x.type === 'kanban').id);
    await tick();
    const status = table.fieldByName('Status');
    const [planning, progress] = status.options.choices;
    page.base.createRecords(table.id, [{ [table.primary.id]: 'A', [status.id]: planning.id }, { [table.primary.id]: 'B', [status.id]: planning.id }]);
    const names = (key) => [...document.querySelectorAll(`.stack[data-drop="${key}"] .card`)].map((c) => c.getAttribute('aria-label'));
    const before = names(planning.id);
    const card = () => [...document.querySelectorAll(`.stack[data-drop="${planning.id}"] .card`)].find((c) => c.getAttribute('aria-label') === before[0]);
    card().focus();
    key(card(), 'ArrowDown', { altKey: true });
    expect(names(planning.id).slice(0, 2)).toEqual([before[1], before[0]]);
    expect(document.activeElement.getAttribute('aria-label')).toBe(before[0]);
    key(document.activeElement, 'ArrowUp', { altKey: true });
    expect(names(planning.id)).toEqual(before);
    key(document.activeElement, 'ArrowRight', { altKey: true });
    expect(names(progress.id)).toContain(before[0]);
    expect(document.activeElement.getAttribute('aria-label')).toBe(before[0]);
    expect(document.activeElement.closest('.stack').dataset.drop).toBe(progress.id);
  });
});

describe('calendar double click', () => {
  it('on a day "more" button adds no record', async () => {
    const { page, table, base } = await projects();
    page.go(table.id, table.views.find((x) => x.type === 'calendar').id);
    await tick();
    const t = new Date();
    const day = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-15`;
    base.createRecords(table.id, Array.from({ length: 6 }, () => ({ [table.fieldByName('Due').id]: day })));
    await tick();
    page.openRecord = () => {};
    const before = table.records.size;
    const more = document.querySelector(`.day[data-drop="${day}"] .day-more`);
    more.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(table.records.size).toBe(before);
    document.querySelector(`.day[data-drop="${day}"]`).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(table.records.size).toBe(before + 1);
  });
});

describe('card covers', () => {
  async function covered(atts) {
    const { page, table, base } = await projects();
    const photo = base.addField(table.id, { name: 'Photo', type: 'attachment' });
    const rec = table.ordered()[0];
    base.setCell(table.id, rec.id, photo, atts);
    const v = table.views.find((x) => x.type === 'kanban');
    base.updateView(table.id, v.id, { coverFieldId: photo });
    page.store.readFile = async () => new Blob(['x'], { type: 'image/png' });
    page.go(table.id, v.id);
    await tick(5);
    return document.querySelector(`.card[data-id="${rec.id}"] .card-cover`);
  }

  it('show a file icon for images browsers may not show', async () => {
    const box = await covered([{ id: 'a1', name: 'logo.svg', type: 'image/svg+xml', size: 1, path: 'p/logo.svg' }, { id: 'a2', name: 'pic.heic', type: 'image/heic', size: 1, path: 'p/pic.heic' }]);
    expect(box.querySelector('img')).toBeNull();
    expect(box.querySelector('.card-cover-empty')).not.toBeNull();
  });

  it('show images with an odd type by their name', async () => {
    const box = await covered([{ id: 'a1', name: 'pic.png', type: 'image/x-png', size: 1, path: 'p/pic.png' }]);
    expect(box.querySelector('img')).not.toBeNull();
  });

  it('fall back to a file icon when the image fails to load', async () => {
    const box = await covered([{ id: 'a1', name: 'pic.png', type: 'image/png', size: 1, path: 'p/pic.png' }]);
    const img = box.querySelector('img');
    expect(img).not.toBeNull();
    img.dispatchEvent(new Event('error'));
    expect(box.querySelector('img')).toBeNull();
    expect(box.querySelector('.card-cover-empty')).not.toBeNull();
  });
});
