import { describe, it, expect } from 'vitest';
import { mountApp, openBase, tick, click } from './helpers/app.js';
import { TEMPLATES, buildTemplate } from '../src/data/templates.js';

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

describe('form view', () => {
  it('builds: adds, labels and requires fields', async () => {
    const { page, guests } = await rsvpForm();
    const form = () => page.view.form;
    expect(form().fields.length).toBe(guests.fields.length);
    // Remove a field, then add it back from the side list.
    const first = form().fields.length;
    click(document.querySelector('[aria-label="Remove Email from the form"]'));
    expect(form().fields.length).toBe(first - 1);
    click([...document.querySelectorAll('.form-add-field')].find((b) => b.textContent.includes('Email')));
    expect(form().fields.at(-1).id).toBe(guests.fieldByName('Email').id);
    const req = document.querySelector('[aria-label="Email is required"]');
    req.checked = true;
    req.dispatchEvent(new Event('change'));
    expect(form().fields.at(-1).required).toBe(true);
  });

  it('checks required fields, then adds a record', async () => {
    const { page, guests } = await rsvpForm();
    click([...document.querySelectorAll('.form-bar .btn')].find((b) => b.textContent.includes('Open form')));
    await tick();
    const before = guests.records.size;
    const formEl = document.querySelector('form.form-fill');
    formEl.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect(guests.records.size).toBe(before);
    expect(document.querySelector('.form-q .field-error').textContent).toContain('required');
    const name = document.getElementById(`form-${guests.primary.id}`);
    name.value = 'Dee';
    name.dispatchEvent(new Event('change'));
    const plus = document.getElementById(`form-${guests.fieldByName('Plus ones').id}`);
    plus.value = '2';
    plus.dispatchEvent(new Event('change'));
    formEl.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick(5);
    expect(guests.records.size).toBe(before + 1);
    const rec = guests.ordered().at(-1);
    expect(rec.c[guests.primary.id]).toBe('Dee');
    expect(rec.c[guests.fieldByName('Plus ones').id]).toBe(2);
    expect(document.querySelector('.form-sheet.done').textContent).toContain('Thanks');
    void page;
  });

  it('updates the builder after a button that took focus changes the form', async () => {
    const { page } = await rsvpForm();
    const count = () => document.querySelectorAll('.form-field-card').length;
    const before = count();
    const remove = document.querySelector('[aria-label="Remove Email from the form"]');
    remove.focus();
    click(remove);
    expect(page.view.form.fields.length).toBe(before - 1);
    expect(count()).toBe(before - 1);
    const down = document.querySelector('.form-field-card [aria-label^="Move"][aria-label$="down"]');
    const label = down.getAttribute('aria-label');
    down.focus();
    click(down);
    expect(document.activeElement.getAttribute('aria-label')).toBe(label);
  });

  it('leaves out a required field that became computed', async () => {
    const { page, guests } = await rsvpForm();
    const plus = guests.fieldByName('Plus ones');
    page.base.updateView(guests.id, page.view.id, { form: { ...page.view.form, fields: page.view.form.fields.map((x) => (x.id === plus.id ? { ...x, required: true } : x)) } });
    page.base.updateField(guests.id, plus.id, { type: 'formula', options: { formula: '1', format: 'auto', precision: 0 } });
    click([...document.querySelectorAll('.form-bar .btn')].find((b) => b.textContent.includes('Open form')));
    await tick();
    expect(document.getElementById(`form-${plus.id}`)).toBeNull();
    const name = document.getElementById(`form-${guests.primary.id}`);
    name.value = 'Fay';
    name.dispatchEvent(new Event('change'));
    const before = guests.records.size;
    document.querySelector('form.form-fill').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick(5);
    expect(guests.records.size).toBe(before + 1);
  });

  it('picked files can be removed before submitting', async () => {
    const { page, guests } = await rsvpForm();
    const files = page.base.addField(guests.id, { name: 'Files', type: 'attachment' });
    page.base.updateView(guests.id, page.view.id, { form: { ...page.view.form, fields: [...page.view.form.fields, { id: files, required: false, label: '', help: '' }] } });
    click([...document.querySelectorAll('.form-bar .btn')].find((b) => b.textContent.includes('Open form')));
    await tick();
    const box = document.getElementById(`form-${files}`);
    click(box);
    const input = document.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'notes.txt', { type: 'text/plain' })] });
    input.dispatchEvent(new Event('change'));
    expect(box.querySelector('.att-chip-name').textContent).toBe('notes.txt');
    click(box.querySelector('[aria-label="Remove notes.txt"]'));
    expect(box.querySelector('.att-chip')).toBeNull();
  });

  it('reads a typed date once it is complete', async () => {
    const { page, guests } = await rsvpForm();
    const arrive = page.base.addField(guests.id, { name: 'Arrive', type: 'date' });
    page.base.updateView(guests.id, page.view.id, { form: { ...page.view.form, fields: [...page.view.form.fields, { id: arrive, required: false, label: '', help: '' }] } });
    click([...document.querySelectorAll('.form-bar .btn')].find((b) => b.textContent.includes('Open form')));
    await tick();
    const name = document.getElementById(`form-${guests.primary.id}`);
    name.value = 'Eve';
    name.dispatchEvent(new Event('change'));
    const date = document.getElementById(`form-${arrive}`);
    for (const ch of '3/15/2026') {
      date.value += ch;
      date.dispatchEvent(new Event('input', { bubbles: true }));
    }
    expect(date.value).toBe('3/15/2026');
    const before = guests.records.size;
    document.querySelector('form.form-fill').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick(5);
    expect(guests.records.size).toBe(before + 1);
    expect(guests.ordered().at(-1).c[arrive]).toBe('2026-03-15');
  });
});
