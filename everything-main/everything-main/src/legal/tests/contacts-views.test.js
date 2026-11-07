// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { buildSampleData } from '../src/core/sample.js';
import { today } from '../src/core/dates.js';

function ctxFor(params = {}, query = {}) {
  return { params, query, route: {}, watch() {}, onDispose() {}, live: (fn) => fn() };
}

beforeAll(async () => {
  globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
  app.demo = true;
  app.store = createStore({ backend: createMemoryBackend(buildSampleData(today())), flushDelay: 0 });
  await app.store.init();
});

describe('contacts list', () => {
  it('renders every contact with type counts', async () => {
    const { render } = await import('../src/views/contacts.js');
    const out = render(ctxFor());
    document.body.replaceChildren(out.node);
    const total = app.store.all('contacts').length;
    expect(out.title).toBe('Contacts');
    expect(out.node.textContent).toContain(`All${total}`);
    expect(out.node.querySelector('[aria-label="Contact type"]')).toBeTruthy();
    // Mobile rows render the full (paged) list.
    expect(out.node.querySelectorAll('.dt-mobile li').length).toBeGreaterThan(0);
  });

  it('filters to companies from the query', async () => {
    const { render } = await import('../src/views/contacts.js');
    const out = render(ctxFor({}, { type: 'company' }));
    const companies = app.store.all('contacts').filter((c) => c.type === 'company').length;
    expect(out.node.querySelector('.dt-foot').textContent).toContain(`${companies} contacts`);
  });
});

describe('contact detail', () => {
  it('shows overview, billing, and matters for a client', async () => {
    const { render } = await import('../src/views/contact-detail.js');
    const out = render(ctxFor({ id: 'p-0' }));
    expect(out.node.textContent).toContain('Amara Lopez');
    expect(out.node.textContent).toContain('Trust held');
    expect(out.node.textContent).toContain('Lopez v. Kestrel Motors');
    expect(out.node.querySelector('[role=tablist]')).toBeTruthy();
  });

  it('renders each tab without errors', async () => {
    const { render } = await import('../src/views/contact-detail.js');
    for (const tab of ['matters', 'bills', 'communications', 'notes']) {
      const out = render(ctxFor({ id: 'c-0' }, { tab }));
      expect(out.node.querySelector('.tab-panel').children.length).toBe(1);
    }
  });

  it('shows a not-found state for a missing contact', async () => {
    const { render } = await import('../src/views/contact-detail.js');
    const out = render(ctxFor({ id: 'nope' }));
    expect(out.node.textContent).toContain('Contact not found');
  });
});

describe('contact form', () => {
  it('creates a person and is dirty only after edits', async () => {
    location.hash = '#/contacts/new';
    const { render } = await import('../src/views/contact-form.js');
    const out = render(ctxFor({}, { type: 'person' }));
    document.body.replaceChildren(out.node);
    expect(out.dirty()).toBe(false);
    out.node.querySelector('input[name=firstName]').value = 'Zelda';
    out.node.querySelector('input[name=lastName]').value = 'Quill';
    expect(out.dirty()).toBe(true);
    const before = app.store.all('contacts').length;
    out.node.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(app.store.all('contacts').length).toBe(before + 1);
    const saved = app.store.all('contacts').find((c) => c.lastName === 'Quill');
    expect(saved).toMatchObject({ type: 'person', firstName: 'Zelda' });
    expect(location.hash).toBe(`#/contacts/${saved.id}`);
    expect(out.dirty()).toBe(false);
  });

  it('refuses to save a person without a name', async () => {
    const { render } = await import('../src/views/contact-form.js');
    const out = render(ctxFor());
    document.body.replaceChildren(out.node);
    const before = app.store.all('contacts').length;
    out.node.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(app.store.all('contacts').length).toBe(before);
    expect(out.node.querySelector('.error-text').hidden).toBe(false);
  });

  it('edits an existing company', async () => {
    const { render } = await import('../src/views/contact-form.js');
    const out = render(ctxFor({ id: 'c-1' }));
    document.body.replaceChildren(out.node);
    const name = out.node.querySelector('input[name=companyName]');
    expect(name.value).toBe('Bluefin Software Inc.');
    name.value = 'Bluefin Software Corp.';
    out.node.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(app.store.get('contacts', 'c-1').companyName).toBe('Bluefin Software Corp.');
  });
});

describe('communications', () => {
  it('lists logs and filters by type', async () => {
    const { render } = await import('../src/views/communications.js');
    const all = render(ctxFor());
    const n = app.store.all('communications').length;
    expect(all.node.querySelector('.dt-foot').textContent).toContain(`${n} logs`);
    const phones = render(ctxFor({}, { kind: 'phone' }));
    const p = app.store.all('communications').filter((c) => c.kind === 'phone').length;
    expect(phones.node.querySelector('.dt-foot').textContent).toContain(`${p} log`);
  });
});
