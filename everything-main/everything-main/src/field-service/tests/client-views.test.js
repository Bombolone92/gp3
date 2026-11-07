// @vitest-environment jsdom
/**
 * Clients, client pages, settings and home: behaviour checks rendered
 * against the demo data.
 */
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.requestAnimationFrame ??= window.requestAnimationFrame;
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
  Element.prototype.scrollIntoView ??= function () {};
});

const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));

let ctx;
async function boot() {
  if (ctx) return ctx;
  const { app } = await import('../src/app.js');
  const { createStore } = await import('../src/core/store.js');
  const { createMemoryBackend } = await import('../src/core/backend.js');
  const { buildSampleData } = await import('../src/core/sample.js');
  const { buildShell } = await import('../src/ui/shell.js');
  const { startViews } = await import('../src/ui/viewhost.js');
  app.demo = true;
  app.today = () => '2026-10-12';
  app.store = createStore({ backend: createMemoryBackend(buildSampleData('2026-10-12')) });
  await app.store.init();
  document.body.innerHTML = '<div id="app"></div>';
  const shell = buildShell({});
  document.getElementById('app').append(shell.root);
  startViews(shell.main);
  const main = shell.main;
  const go = async (hash) => {
    const before = main.firstElementChild;
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    for (let i = 0; i < 250; i++) {
      await settle();
      const now = main.firstElementChild;
      if (now && now !== before && main.querySelector('h1')) break;
    }
    await settle();
  };
  ctx = { app, main, go };
  return ctx;
}

describe('clients list', () => {
  it('shows the same statuses and balance as the per-client logic', async () => {
    const { app, main, go } = await boot();
    const { clientStatus } = await import('../src/core/status.js');
    const { clientBalance } = await import('../src/core/workflow.js');
    const { formatMoney } = await import('../src/core/money.js');
    await go('#/clients');
    const store = app.store;
    const jobs = store.all('jobs');
    const invoices = store.all('invoices');
    const statuses = store.all('clients').map((c) => clientStatus(c, { jobs, invoices }));
    const chip = (label) => [...main.querySelectorAll('.chip')].find((b) => b.firstChild.textContent === label).querySelector('.chip-count').textContent;
    expect(chip('Leads')).toBe(String(statuses.filter((s) => s === 'lead').length));
    expect(chip('Active')).toBe(String(statuses.filter((s) => s === 'client_active').length));
    expect(chip('Archived')).toBe(String(statuses.filter((s) => s === 'archived').length));
    const owed = store.all('clients').reduce((s, c) => s + clientBalance(store, c.id), 0);
    expect(owed).toBeGreaterThan(0);
    const stat = [...main.querySelectorAll('.stat')].find((s) => s.textContent.startsWith('Outstanding balance'));
    expect(stat.querySelector('.stat-value').textContent).toBe(formatMoney(owed, app.settings().currency));
  });
});

describe('settings', () => {
  const leave = async (go, main, hash) => {
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await settle(60);
    return document.querySelector('dialog[open]');
  };

  for (const [section, pick] of [
    ['business', (main) => main.querySelector('input[name=name]')],
    ['documents', (main) => main.querySelector('textarea[name=qMessage]')],
  ]) {
    it(`warns before leaving unsaved ${section} settings, but not after saving`, async () => {
      const { main, go } = await boot();
      await go(`#/settings/${section}`);
      const input = pick(main);
      input.value += ' changed';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const dlg = await leave(go, main, '#/clients');
      expect(dlg?.textContent).toMatch(/Discard unsaved changes/);
      [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Keep editing').click();
      await settle(60);
      expect(location.hash).toBe(`#/settings/${section}`);
      main.querySelector('form').requestSubmit();
      await go('#/clients');
      expect(document.querySelector('dialog[open]')).toBeNull();
      expect(main.querySelector('h1').textContent).toBe('Clients');
    });
  }

  it('warns before leaving unsaved lists', async () => {
    const { main, go } = await boot();
    await go('#/settings/lists');
    const input = main.querySelector('.tag-input input');
    input.value = 'Billboard';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const dlg = await leave(go, main, '#/clients');
    expect(dlg?.textContent).toMatch(/Discard unsaved changes/);
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Discard changes').click();
    await settle(60);
  });
});

describe('client page', () => {
  it('selects the first tab for an unknown tab in the link', async () => {
    const { app, main, go } = await boot();
    const c = app.store.all('clients')[0];
    await go(`#/clients/${c.id}?tab=bogus`);
    const selected = main.querySelector('[role=tab][aria-selected=true]');
    expect(selected?.id).toBe('tab-active');
    expect(selected.tabIndex).toBe(0);
    expect(main.querySelector('[role=tabpanel]').getAttribute('aria-labelledby')).toBe('tab-active');
  });
});

describe('client form', () => {
  it('shows a lead source that is not (or no longer) in the settings list', async () => {
    const { app, main, go } = await boot();
    const c = app.store.all('clients')[0];
    app.store.patch('clients', c.id, { leadSource: 'Yelp' });
    await go(`#/clients/${c.id}/edit`);
    const sel = [...main.querySelectorAll('.field')].find((f) => f.textContent.startsWith('Lead source')).querySelector('select');
    expect(sel.value).toBe('Yelp');
  });
});

describe('client import', () => {
  it('says why rows were skipped', async () => {
    const { main, go } = await boot();
    await go('#/clients');
    let input;
    const click = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file') input = this;
      else click.call(this);
    };
    main.querySelector('button[aria-label="More actions"]').click();
    [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Import clients')).click();
    HTMLInputElement.prototype.click = click;
    const file = { name: 'c.csv', text: async () => 'Name,Email\nPat Lee,pat@example.com\n,nobody@example.com\n' };
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await settle(50);
    const toasts = [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ');
    expect(toasts).toMatch(/Imported 1 client, skipped 1 row with no name or company/);
  });
});

describe('clients list filters', () => {
  it('keeps announcing the result count from the same live region', async () => {
    const { main, go } = await boot();
    await go('#/');
    await go('#/clients');
    const region = main.querySelector('.list-card [role=status]');
    const before = region.textContent;
    [...main.querySelectorAll('.chip')].find((b) => b.firstChild.textContent === 'Archived').click();
    const after = main.querySelector('.list-card [role=status]');
    expect(after).toBe(region);
    expect(after.isConnected).toBe(true);
    expect(after.textContent).not.toBe(before);
  });

  it('shows a tag filter from the link even when no client has that tag any more', async () => {
    const { main, go } = await boot();
    await go('#/clients?tag=Gone');
    expect(main.querySelector('.empty-state, .empty')?.textContent || main.textContent).toMatch(/No matching clients/);
    const sel = main.querySelector('select[aria-label="Filter by tag"]');
    expect(sel?.value).toBe('Gone');
  });
});

describe('sample data', () => {
  const freshStore = async (app) => {
    const { createStore } = await import('../src/core/store.js');
    const { createMemoryBackend } = await import('../src/core/backend.js');
    const store = createStore({ backend: createMemoryBackend({}) });
    await store.init();
    return store;
  };

  it('is loaded once when the welcome button is clicked twice', async () => {
    const { app } = await boot();
    const { buildSampleData } = await import('../src/core/sample.js');
    const { openOnboarding } = await import('../src/views/onboarding.js');
    const real = app.store;
    app.store = await freshStore(app);
    try {
      openOnboarding();
      const btn = [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Load sample data');
      btn.click();
      btn.click();
      await settle(50);
      expect(app.store.all('clients').length).toBe(buildSampleData('2026-10-12').collections.clients.length);
    } finally {
      app.store = real;
    }
  });

  it('is added once when Add sample data is clicked twice', async () => {
    const { app, main, go } = await boot();
    const { buildSampleData } = await import('../src/core/sample.js');
    const real = app.store;
    app.store = await freshStore(app);
    try {
      await go('#/settings/data');
      const btn = [...main.querySelectorAll('button')].find((b) => b.textContent === 'Add sample data');
      btn.click();
      btn.click();
      await settle(50);
      expect(app.store.all('clients').length).toBe(buildSampleData('2026-10-12').collections.clients.length);
    } finally {
      app.store = real;
    }
  });
});

describe('delete all data', () => {
  it('also deletes attached files and receipts', async () => {
    const { app, main, go } = await boot();
    const { saveFile, fileUrl } = await import('../src/files.js');
    const realStore = app.store;
    const { createStore } = await import('../src/core/store.js');
    const { createMemoryBackend } = await import('../src/core/backend.js');
    const { buildSampleData } = await import('../src/core/sample.js');
    app.store = createStore({ backend: createMemoryBackend(buildSampleData('2026-10-12')) });
    await app.store.init();
    const create = URL.createObjectURL;
    URL.createObjectURL = () => 'blob:x';
    try {
      const file = (name) => Object.assign(new Blob(['hello'], { type: 'text/plain' }), { name });
      const att = await saveFile(file('a.txt'), 'files/clients');
      const receipt = await saveFile(file('r.txt'), 'files/expenses');
      app.store.patch('clients', app.store.all('clients')[0].id, { attachments: [att] });
      app.store.patch('expenses', app.store.all('expenses')[0].id, { receipt });
      await go('#/');
      await go('#/settings/data');
      [...main.querySelectorAll('button')].find((b) => b.textContent === 'Delete all data').click();
      await settle();
      [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'Delete everything').click();
      await settle(50);
      expect(app.store.all('clients').length).toBe(0);
      await expect(fileUrl(att)).rejects.toThrow();
      await expect(fileUrl(receipt)).rejects.toThrow();
    } finally {
      URL.createObjectURL = create;
      app.store = realStore;
    }
  });
});

describe('home attention list', () => {
  it("shows a client's new name after a rename", async () => {
    const { app, main, go } = await boot();
    await go('#/clients');
    await go('#/');
    const card = () => [...main.querySelectorAll('section.card')].find((s) => s.querySelector('h2')?.textContent === 'Needs attention');
    const { lookup } = await import('../src/app.js');
    const { clientName } = await import('../src/core/format.js');
    const first = card().querySelector('a.list-item');
    const href = first.getAttribute('href');
    const [, coll, id] = href.match(/#\/(\w+)\/(.+)/);
    const client = lookup.client(app.store.get(coll, id).clientId);
    expect(first.textContent).toContain(clientName(client));
    app.store.patch('clients', client.id, { firstName: 'Renamed', lastName: 'Person', useCompanyName: false });
    await settle(60);
    expect(card().querySelector(`a.list-item[href="${href}"]`).textContent).toContain('Renamed Person');
  });
});

describe('reports', () => {
  it('counts a visit done by two people once in the visits total', async () => {
    const { app, main, go } = await boot();
    const ids = app.store.all('team').slice(0, 2).map((m) => m.id);
    const job = app.store.all('jobs')[0];
    app.store.patch('jobs', job.id, (j) => ((j.visits = [...(j.visits || []), { id: 'vv1', date: '2026-10-01', start: '09:00', end: '10:00', assignees: ids, completedAt: '2026-10-01T10:00:00Z' }]), j));
    await go('#/reports?range=12m');
    let visits = 0;
    for (const j of app.store.all('jobs')) for (const v of j.visits || []) if (v.completedAt && v.date && v.date >= '2025-11-01' && v.date <= '2026-10-12') visits++;
    const card = main.querySelector('#rep-visits').closest('section');
    expect(card.querySelector('.card-head').textContent).toBe(`Visits completed${visits}`);
  });

  it("shows a team member's new name as soon as it changes", async () => {
    const { app, main, go } = await boot();
    await go('#/reports?range=12m');
    const card = () => main.querySelector('#rep-visits').closest('section');
    const m = app.store.all('team').find((x) => card().textContent.includes(x.name));
    app.store.patch('team', m.id, { name: 'Renamed Person' });
    await settle(50);
    expect(card().textContent).toContain('Renamed Person');
  });
});

describe('attachments', () => {
  it('still says files are uploading after the page redraws', async () => {
    const { app, main, go } = await boot();
    const job = app.store.all('jobs')[1];
    await go(`#/jobs/${job.id}`);
    const slow = globalThis.createImageBitmap;
    globalThis.createImageBitmap = () => new Promise((_, reject) => setTimeout(() => reject(new Error('no decoder')), 150));
    try {
      const input = main.querySelector('.att-card input[type=file]');
      Object.defineProperty(input, 'files', { value: [new File(['x'], 'photo.png', { type: 'image/png' })], configurable: true });
      input.dispatchEvent(new Event('change'));
      await settle();
      expect(main.querySelector('.att-card .card-head').textContent).toMatch(/Uploading 1 file/);
      app.store.patch('jobs', job.id, { instructions: 'Ring the bell' });
      await settle(40);
      expect(main.textContent).toMatch(/Ring the bell/);
      expect(main.querySelector('.att-card .card-head').textContent).toMatch(/Uploading 1 file/);
      await settle(200);
      expect(main.querySelector('.att-card .card-head').textContent).not.toMatch(/Uploading/);
      expect(app.store.get('jobs', job.id).attachments.at(-1).name).toBe('photo.png');
    } finally {
      globalThis.createImageBitmap = slow;
    }
  });
});

describe('new client form', () => {
  it('clears the missing name message once a name is typed', async () => {
    const { main, go } = await boot();
    await go('#/clients/new');
    main.querySelector('form').requestSubmit();
    const err = [...main.querySelectorAll('.error-text')].find((e) => /first name/.test(e.textContent));
    expect(err.hidden).toBe(false);
    const company = main.querySelector('input[autocomplete=organization]');
    company.value = 'Acme';
    company.dispatchEvent(new Event('input', { bubbles: true }));
    expect(err.hidden).toBe(true);
    company.value = '';
    company.dispatchEvent(new Event('input', { bubbles: true }));
  });
});

describe('client form lists', () => {
  it('keeps keyboard focus when adding or removing phones and properties', async () => {
    const { main, go } = await boot();
    await go('#/clients/new');
    const btn = (text) => [...main.querySelectorAll('button')].find((b) => b.textContent === text);
    btn('Add phone number').click();
    main.querySelector('button[aria-label="Remove phone number 2"]').click();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Phone number 1');

    btn('Add another property').click();
    expect(document.activeElement?.getAttribute('autocomplete')).toMatch(/section-prop1 .*address-line1/);
    const remove = main.querySelector('button[aria-label="Remove property 2"]');
    expect(remove).not.toBeNull();
    remove.click();
    expect(document.activeElement?.getAttribute('autocomplete')).toMatch(/section-prop0 .*address-line1/);
  });
});

describe('settings forms save only what was changed', () => {
  const type = (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('keeps a change made elsewhere to another field of the same section', async () => {
    const { app, main, go } = await boot();
    await go('#/');
    await go('#/settings/business');
    // Another device changes the phone number while this form is open.
    app.store.saveSettings({ company: { phone: '555-0199' }, workday: { end: '17:00' } });
    type(main.querySelector('input[name=name]'), 'Renamed Business');
    main.querySelector('form').requestSubmit();
    expect(app.settings().company.name).toBe('Renamed Business');
    expect(app.settings().company.phone).toBe('555-0199');
    expect(app.settings().workday.end).toBe('17:00');

    await go('#/settings/documents');
    app.store.saveSettings({ quotes: { disclaimer: 'New terms' }, numbering: { invoice: 900 } });
    type(main.querySelector('textarea[name=qMessage]'), 'Thanks!');
    main.querySelector('form').requestSubmit();
    expect(app.settings().quotes.message).toBe('Thanks!');
    expect(app.settings().quotes.disclaimer).toBe('New terms');
    expect(app.settings().numbering.invoice).toBe(900);

    await go('#/settings/lists');
    app.store.saveSettings({ expenseCategories: ['Fuel', 'Tolls'] });
    const input = main.querySelector('.tag-input input');
    type(input, 'Billboard');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    [...main.querySelectorAll('button')].find((b) => b.textContent === 'Save lists').click();
    expect(app.settings().leadSources).toContain('Billboard');
    expect(app.settings().expenseCategories).toEqual(['Fuel', 'Tolls']);
  });
});

describe('tag fields', () => {
  it('are named by their field label, not all "Add a tag"', async () => {
    const { main, go } = await boot();
    await go('#/');
    await go('#/settings/lists');
    const names = [...main.querySelectorAll('.tag-input input')].map((i) => i.getAttribute('aria-label') || main.querySelector(`label[for="${i.id}"]`)?.textContent);
    expect(names).toEqual(['Lead sources', 'Expense categories']);
  });
});

describe('home revenue card', () => {
  it('draws the months as boxes that keep their labels upright at any width', async () => {
    const { main, go } = await boot();
    await go('#/clients');
    await go('#/');
    const chart = main.querySelector('.mini-chart');
    expect(chart.querySelector('svg[preserveAspectRatio="none"]')).toBeNull();
    const bars = chart.querySelectorAll('.mini-bar');
    expect(bars.length).toBe(6);
    expect([...bars].map((b) => b.querySelector('.mini-bar-label').textContent)).toEqual(['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']);
    for (const b of bars) expect(parseFloat(b.querySelector('.mini-bar-fill').style.height)).toBeLessThanOrEqual(100);
  });
});

describe('clients list controls', () => {
  it('keep keyboard focus after picking a status filter or sorting', async () => {
    const { main, go } = await boot();
    await go('#/');
    await go('#/clients');
    const chip = [...main.querySelectorAll('.chip')].find((b) => b.firstChild.textContent === 'Leads');
    chip.focus();
    chip.click();
    expect(document.activeElement?.classList.contains('chip')).toBe(true);
    expect(document.activeElement.isConnected).toBe(true);
    expect(document.activeElement.getAttribute('aria-pressed')).toBe('true');
    [...main.querySelectorAll('.chip')].find((b) => b.firstChild.textContent === 'Leads and active').click();
    const sort = [...main.querySelectorAll('button.sort')].find((b) => b.textContent.includes('Name'));
    sort.focus();
    sort.click();
    expect(document.activeElement?.matches('button.sort')).toBe(true);
    expect(document.activeElement.isConnected).toBe(true);
    expect(document.activeElement.textContent).toContain('Name');
  });
});
