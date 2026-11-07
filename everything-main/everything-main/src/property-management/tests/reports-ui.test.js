// @vitest-environment jsdom
/**
 * Smoke test: boot the demo and render the reports index, every report,
 * and every settings section, failing on any exception or missing heading.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { REPORTS } from '../src/views/reports/catalog.js';
import { SECTIONS } from '../src/views/settings.js';

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

const settle = () => new Promise((r) => setTimeout(r, 20));

async function bootDemo() {
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
  return { app, main: shell.main };
}

describe('reports and settings render on demo data', () => {
  let ctx;
  const errors = [];
  beforeAll(async () => {
    const orig = console.error;
    console.error = (...a) => {
      errors.push(a.map(String).join(' '));
      orig(...a);
    };
    ctx = await bootDemo();
  });

  const go = async (hash, ready = () => true) => {
    const before = ctx.main.firstElementChild;
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    for (let i = 0; i < 250; i++) {
      await settle();
      const now = ctx.main.firstElementChild;
      if (now && now !== before && ctx.main.querySelector('h1') && ready()) break;
    }
    await settle();
  };

  it('renders the reports index with every report', async () => {
    await go('#/reports');
    expect(ctx.main.querySelector('h1').textContent).toBe('Reports');
    expect(ctx.main.querySelectorAll('.report-row').length).toBe(REPORTS.length);
  });

  for (const r of REPORTS) {
    it(`renders the ${r.id} report`, async () => {
      errors.length = 0;
      await go(`#/reports/${r.id}`, () => ctx.main.querySelector('.report-sheet')?.getAttribute('aria-busy') !== 'true');
      expect(ctx.main.querySelector('h1').textContent).toBe(r.title);
      const sheet = ctx.main.querySelector('.report-sheet');
      expect(sheet).toBeTruthy();
      expect(sheet.getAttribute('aria-busy')).toBe(null);
      expect(sheet.querySelector('.report-title').textContent).toBe(r.title);
      // Either a table, an empty message, or a friendly error state; never a crash.
      expect(sheet.querySelector('table, .report-empty, .empty')).toBeTruthy();
      expect(errors.filter((e) => e.includes('[reports]'))).toEqual([]);
    });
  }

  it('the rent roll lists every unit', async () => {
    await go('#/reports/rent-roll', () => !!ctx.main.querySelector('.report-table'));
    const rows = ctx.main.querySelectorAll('.report-table tbody tr');
    expect(rows.length).toBe(ctx.app.store.all('units').length);
  });

  it('keeps parameters in the address', async () => {
    await go('#/reports/delinquency?asOf=2026-09-30', () => !!ctx.main.querySelector('.report-table, .report-empty'));
    expect(ctx.main.querySelector('.report-meta').textContent).toContain('2026');
    expect(ctx.main.querySelector('input[type=date]').value).toBe('2026-09-30');
  });

  const followLink = async (text) => {
    const a = [...ctx.main.querySelectorAll('a')].find((x) => x.textContent.trim() === text);
    expect(a).toBeTruthy();
    await go(a.getAttribute('href'), () => !!ctx.main.querySelector('.report-meta'));
    return ctx.main.querySelector('.report-meta').textContent;
  };

  it("an owner's statement link opens that owner's statement", async () => {
    const { displayName } = await import('../src/core/format.js');
    const owners = ctx.app.store.all('owners').slice().sort((a, b) => displayName(a).localeCompare(displayName(b)));
    const owner = owners[owners.length - 1];
    await go(`#/owners/${owner.id}`);
    const meta = await followLink('Owner statement report');
    expect(meta).toContain(displayName(owner));
    expect(meta).not.toContain(displayName(owners[0]));
  });

  it("Financials' full report links keep the period and property", async () => {
    const prop = ctx.app.store.all('properties').find((x) => x.id === 'pr-maple') || ctx.app.store.all('properties')[0];
    await go(`#/financials?period=last-year&property=${prop.id}`);
    const card = (title) => [...ctx.main.querySelectorAll('.card')].find((c) => c.querySelector('h2, .card-title')?.textContent.trim() === title);
    let meta = await followLink('Full report');
    expect(meta).toContain('Jan 1, 2025 to Dec 31, 2025');
    expect(meta).toContain(prop.name);
    await go(`#/financials?period=last-year&property=${prop.id}`);
    const bsLink = card('Balance sheet').querySelector('a');
    await go(bsLink.getAttribute('href'), () => !!ctx.main.querySelector('.report-meta'));
    meta = ctx.main.querySelector('.report-meta').textContent;
    expect(meta).toContain('As of Dec 31, 2025');
    expect(meta).toContain(prop.name);
  });

  it("a property's income statement link keeps the property and period", async () => {
    const prop = ctx.app.store.all('properties')[1];
    await go(`#/properties/${prop.id}?tab=financials&period=ytd`);
    const meta = await followLink('Full report');
    expect(meta).toContain(prop.name);
    expect(meta).toContain('Jan 1, 2026 to Oct 12, 2026');
  });

  it('prints a report after a receipt was printed', async () => {
    const { printNode } = await import('../src/views/transactions/dialogs.js');
    const print = window.print;
    window.print = () => {};
    try {
      printNode(document.createElement('div'), 'Receipt');
      window.dispatchEvent(new Event('afterprint'));
    } finally {
      window.print = print;
    }
    await go('#/reports/rent-roll', () => !!ctx.main.querySelector('.report-table'));
    expect(document.body.classList.contains('print-sheet')).toBe(false);
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.querySelector('#print-root .report-sheet')).toBeTruthy();
    expect(document.body.classList.contains('print-sheet')).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.getElementById('print-root')).toBe(null);
    expect(document.body.classList.contains('print-sheet')).toBe(false);
  });

  it('printing an ordinary page (Ctrl+P) prints its content, not a blank page', async () => {
    const fs = await import('node:fs');
    const css = fs.readFileSync(`${process.cwd()}/src/styles/print.css`, 'utf8');
    // Everything but the print sheet is hidden only while a sheet is printed.
    expect(css).not.toMatch(/^\s*body > \*:not\(#print-root\)/m);
    expect(css).toMatch(/body\.print-sheet > \*:not\(#print-root\)/);
  });

  it('exports CSV that Excel reads as UTF-8', async () => {
    const { downloadText } = await import('../src/core/csv.js');
    const create = URL.createObjectURL;
    const blobs = [];
    const click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (b) => (blobs.push(b), 'blob:test');
    URL.revokeObjectURL ??= () => {};
    HTMLAnchorElement.prototype.click = () => {};
    try {
      downloadText('x.csv', 'Name\r\nJosé · 1A\r\n');
      downloadText('x.json', '{}', 'application/json');
    } finally {
      URL.createObjectURL = create;
      HTMLAnchorElement.prototype.click = click;
    }
    const bytes = (blob) =>
      new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve([...new Uint8Array(r.result)]);
        r.readAsArrayBuffer(blob);
      });
    expect((await bytes(blobs[0])).slice(0, 3)).toEqual([0xef, 0xbb, 0xbf]);
    expect((await bytes(blobs[1]))[0]).toBe('{'.charCodeAt(0));
  });

  it('total rows leave per-row columns blank, on screen and in CSV', async () => {
    const { REPORTS: all } = await import('../src/views/reports/catalog.js');
    const { sectionsToCSV } = await import('../src/views/reports/table.js');
    const env = { store: ctx.app.store, today: '2026-10-12', ledger: ctx.app.ledger(), financials: () => import('../src/core/financials.js') };
    for (const [id, p] of [['vacancy', {}], ['owner-statement', { owner: 'ow-1', from: '2026-01-01', to: '2026-10-12' }]]) {
      await go(`#/reports/${id}`, () => !!ctx.main.querySelector('.report-table tfoot'));
      const cells = [...ctx.main.querySelectorAll('.report-table tfoot td')].map((td) => td.textContent);
      expect(cells.filter((t) => /undefined|^No$/.test(t))).toEqual([]);
      const report = all.find((r) => r.id === id);
      const csv = sectionsToCSV((await report.run({ ...p }, env)).sections);
      const total = csv.trim().split('\r\n').pop();
      expect(total).not.toMatch(/undefined|,No,/);
    }
  });

  it('sorts blank cells last in both directions', async () => {
    await go('#/reports/rent-roll', () => !!ctx.main.querySelector('.report-table'));
    const headers = () => [...ctx.main.querySelectorAll('.report-table thead th')];
    const idx = headers().findIndex((th) => /tenant/i.test(th.textContent));
    const firstCell = () => ctx.main.querySelector('.report-table tbody tr').children[idx].textContent.trim();
    const sortBtn = () => headers()[idx].querySelector('button');
    sortBtn().click();
    expect(firstCell()).not.toBe('');
    sortBtn().click();
    expect(headers()[idx].getAttribute('aria-sort')).toBe('descending');
    expect(firstCell()).not.toBe('');
  });

  it('shows a not-found state for an unknown report', async () => {
    await go('#/reports/nope');
    expect(ctx.main.querySelector('h1').textContent).toBe('Report not found');
  });

  for (const s of [{ id: '' }, ...SECTIONS]) {
    it(`renders settings ${s.id || '(default)'}`, async () => {
      await go(s.id ? `#/settings/${s.id}` : '#/settings');
      expect(ctx.main.querySelector('h1').textContent).toBe('Settings');
      expect(ctx.main.querySelector('.settings-nav [aria-current="page"]')).toBeTruthy();
    });
  }

  it('saves company details on change', async () => {
    await go('#/settings/company');
    const input = ctx.main.querySelector('input[name=name]');
    input.value = 'Harbor Rentals';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(ctx.app.store.state.settings.company.name).toBe('Harbor Rentals');
  });

  it('saves the late fee policy', async () => {
    await go('#/settings/late-fees');
    const grace = ctx.main.querySelector('input[name=graceDays]');
    grace.value = '3';
    grace.dispatchEvent(new Event('change', { bubbles: true }));
    expect(ctx.app.store.state.settings.lateFee.graceDays).toBe(3);
    expect(ctx.main.querySelector('.late-example').textContent).toContain('late fee');
  });
});
