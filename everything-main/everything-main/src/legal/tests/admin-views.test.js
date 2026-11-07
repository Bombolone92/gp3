// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { app } from '../src/app.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { buildSampleData } from '../src/core/sample.js';
import { today } from '../src/core/dates.js';

function ctxFor(params = {}, query = {}) {
  return {
    params,
    query,
    route: {},
    watch() {},
    onDispose() {},
    live(fn) {
      const node = document.createElement('div');
      node.replaceChildren(...[].concat(fn() || []).filter(Boolean));
      return node;
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeAll(() => {
  globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
  }
  location.hash = '#/';
});

beforeEach(async () => {
  document.body.replaceChildren();
  app.demo = true;
  app.team = null;
  app.store = createStore({ backend: createMemoryBackend(buildSampleData(today())), flushDelay: 0 });
  await app.store.init();
});

const view = (out) => (out instanceof Node ? out : out.node);

describe('documents', () => {
  it('lists every document and filters by matter', async () => {
    const { render } = await import('../src/views/documents.js');
    const node = view(render(ctxFor({}, {})));
    document.body.append(node);
    const names = [...node.querySelectorAll('.doc-name')].map((b) => b.textContent);
    expect(names.length).toBe(app.store.all('documents').length);
    document.body.replaceChildren();
    const one = view(render(ctxFor({}, { matter: 'm-1' })));
    expect(one.querySelectorAll('.doc-name').length).toBe(app.store.all('documents').filter((d) => d.matterId === 'm-1').length);
  });

  it('uploads files as documents on a matter', async () => {
    const { uploadFiles } = await import('../src/views/docs-upload.js');
    const before = app.store.all('documents').length;
    const saved = await uploadFiles([new File(['hello'], 'Letter.txt', { type: 'text/plain' })], { matterId: 'm-2', category: 'Correspondence' });
    expect(saved).toHaveLength(1);
    expect(app.store.all('documents')).toHaveLength(before + 1);
    expect(saved[0]).toMatchObject({ matterId: 'm-2', name: 'Letter.txt', category: 'Correspondence' });
    const { readFile } = await import('../src/files.js');
    expect((await readFile(saved[0].file)).size).toBe(5);
  });

  it('shows templates on the templates tab and fills them for a matter', async () => {
    const { render } = await import('../src/views/documents.js');
    const node = view(render(ctxFor({ tab: 'templates' })));
    expect(node.querySelectorAll('.tpl-card').length).toBe(app.store.all('templates').length);
    const { valuesFor } = await import('../src/views/docs-generate.js');
    const v = valuesFor('m-1');
    expect(v['matter.number']).toBe(app.store.get('matters', 'm-1').displayNumber);
    expect(v['firm.name']).toBe(app.settings().firm.name);
  });

  it('classifies previews by file type', async () => {
    const { previewKind } = await import('../src/views/docs-actions.js');
    expect(previewKind({ type: 'application/pdf' })).toBe('pdf');
    expect(previewKind({ type: 'image/png' })).toBe('image');
    expect(previewKind({ type: 'text/html', name: 'x.html' })).toBe('html');
    expect(previewKind({ type: '', name: 'notes.md' })).toBe('text');
    expect(previewKind({ type: 'application/zip', name: 'a.zip' })).toBe('none');
  });
});

describe('reports', () => {
  const ids = ['revenue', 'aging', 'ledger', 'hours', 'categories', 'matters-area', 'matters-month', 'profitability', 'trust-balances', 'trust-ledger'];
  it('lists every report on the index', async () => {
    const { render } = await import('../src/views/reports.js');
    const node = view(render(ctxFor()));
    const links = [...node.querySelectorAll('a.report-card')].map((a) => a.getAttribute('href').replace('#/reports/', ''));
    expect(links.sort()).toEqual([...ids].sort());
  });

  it.each(ids)('renders the %s report', async (id) => {
    const { render } = await import('../src/views/reports.js');
    const query = id === 'ledger' ? { client: 'c-0', range: 'all' } : { range: 'all' };
    const node = view(render(ctxFor({ report: id }, query)));
    document.body.append(node);
    await tick();
    expect(node.querySelector('h1').textContent.length).toBeGreaterThan(3);
    expect(node.querySelector('.report-table, .empty')).not.toBeNull();
  });
});

describe('settings', () => {
  const sections = ['firm', 'users', 'billing', 'practice', 'categories', 'tasks', 'lists', 'team', 'appearance', 'data'];
  it.each(sections)('renders the %s section', async (section) => {
    const { render } = await import('../src/views/settings.js');
    const out = render(ctxFor({ section }));
    expect(out.node.querySelector('.settings-section-title')).not.toBeNull();
    expect(out.node.querySelector('[aria-current="page"]').getAttribute('href')).toBe(`#/settings/${section}`);
  });

  it('saves firm details as you type', async () => {
    const { render } = await import('../src/views/settings.js');
    const out = render(ctxFor({ section: 'firm' }));
    const input = out.node.querySelector('input[name="name"]');
    input.value = 'Rivera Law';
    input.dispatchEvent(new Event('change'));
    expect(app.settings().firm.name).toBe('Rivera Law');
  });

  it('counts references before a user can be deleted', async () => {
    const { userReferences } = await import('../src/views/settings-users.js');
    expect(userReferences(app.store, 'u-hartley')).toBeGreaterThan(10);
    expect(userReferences(app.store, 'nobody')).toBe(0);
  });

  it('reorders and renames practice areas', async () => {
    const { render } = await import('../src/views/settings.js');
    const out = render(ctxFor({ section: 'practice' }));
    document.body.append(out.node);
    const first = app.settings().practiceAreas[0];
    out.node.querySelector(`button[aria-label="Move ${first.name} down"]`).click();
    expect(app.settings().practiceAreas[1].id).toBe(first.id);
    const input = out.node.querySelector('.le-name');
    input.value = 'Business law';
    input.dispatchEvent(new Event('change'));
    expect(app.settings().practiceAreas[0].name).toBe('Business law');
  });
});

describe('restoring a backup', () => {
  it('describes how firm settings are restored the way they are', async () => {
    const { vi } = await import('vitest');
    const { dataSection } = await import('../src/views/settings-data.js');
    app.store.saveSettings({ firm: { name: 'Rivera Law', phone: '555-0100' } });
    const node = dataSection();
    document.body.append(node);
    let input;
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function () {
      input = this;
    });
    [...node.querySelectorAll('button')].find((b) => b.textContent.includes('Restore from backup')).click();
    click.mockRestore();
    const backup = { app: 'legal', version: 1, settings: { firm: { name: 'Old Name LLP' } }, collections: {} };
    Object.defineProperty(input, 'files', { value: [{ text: async () => JSON.stringify(backup) }] });
    input.dispatchEvent(new Event('change'));
    for (let i = 0; i < 20 && !document.querySelector('dialog[open]'); i++) await tick();
    const dlg = document.querySelector('dialog[open]');
    expect(dlg.textContent).not.toContain('Firm settings are replaced');
    [...dlg.querySelectorAll('.dialog-foot button')].find((b) => b.textContent === 'Restore').click();
    await tick();
    // Settings the backup includes replace the current ones; the rest stay.
    expect(app.settings().firm).toMatchObject({ name: 'Old Name LLP', phone: '555-0100' });
    expect(dlg.textContent).toContain('settings it does not include stay as they are');
  });
});

describe('onboarding', () => {
  it('creates the first user and default accounts', async () => {
    app.store = createStore({ backend: createMemoryBackend(), flushDelay: 0 });
    await app.store.init();
    app.user = { username: 'ada', uuid: 'u-ada' };
    const { setUpFirm } = await import('../src/views/onboarding.js');
    setUpFirm({ firmName: 'Lovelace Law', currency: 'GBP', name: 'Ada Lovelace', role: 'lawyer', rateCents: 30000 });
    const [u] = app.store.all('users');
    expect(u).toMatchObject({ name: 'Ada Lovelace', puterUsername: 'ada', rateCents: 30000 });
    expect(
      app.store
        .all('accounts')
        .map((a) => a.type)
        .sort(),
    ).toEqual(['operating', 'trust']);
    expect(app.settings()).toMatchObject({ currency: 'GBP', onboarded: true, firm: { name: 'Lovelace Law' } });
    app.user = null;
  });
});

describe('stages board', () => {
  it('shows a column per stage with open matters only', async () => {
    const { render } = await import('../src/views/stages.js');
    const node = view(render(ctxFor()));
    const cols = node.querySelectorAll('.board-col');
    expect(cols.length).toBeGreaterThanOrEqual(app.settings().stages.length);
    const cards = node.querySelectorAll('.board-card').length;
    expect(cards).toBe(app.store.all('matters').filter((m) => m.status !== 'closed').length);
  });
});
