import { describe, it, expect } from 'vitest';
import axe from 'axe-core';
import { mountApp, openBase, tick, click } from './helpers/app.js';
import { TEMPLATES, buildTemplate } from '../src/data/templates.js';

async function a11y(root) {
  const res = await axe.run(root, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

describe('app shell', () => {
  it('shows home with quick starts and an empty state', async () => {
    const { root } = await mountApp();
    expect(root.querySelector('h1').textContent).toBe('Home');
    expect(root.textContent).toContain('Start from scratch');
    expect(root.textContent).toContain('No bases yet');
    expect(await a11y(root)).toEqual([]);
  });

  it('offers sign out on the web but not inside the Puter desktop', async () => {
    const web = await mountApp({ env: 'web' });
    click(web.root.querySelector('.account-btn'));
    await tick();
    expect(document.body.textContent).toContain('Sign out');
    const desktop = await mountApp({ env: 'app', onSignOut: null });
    click(desktop.root.querySelector('.account-btn'));
    await tick();
    expect(document.body.textContent).not.toContain('Sign out');
  });

  it('shows the preview notice once', async () => {
    await mountApp();
    await tick(700);
    const notice = document.querySelector('.notice');
    expect(notice?.textContent).toContain('Early preview');
    click(notice.querySelector('.btn'));
    expect(document.querySelector('.notice')).toBeNull();
    expect(JSON.parse(localStorage.getItem('records:prefs')).noticeSeen).toBe(true);
  });

  it('links to the source code', async () => {
    const { root } = await mountApp();
    expect(root.querySelector('a.repo-link').href).toBe('https://github.com/HeyPuter/everything');
  });

  it('creates, lists and trashes bases from home', async () => {
    const { app, store, root } = await mountApp();
    const id = await store.createBase({ name: 'Inventory' });
    await tick();
    expect(root.textContent).toContain('Inventory');
    store.trashBase(id);
    await tick();
    expect(root.querySelector('.base-card')).toBeNull();
    app.navigate('trash');
    await app.route();
    expect(app.root.textContent).toContain('Inventory');
  });
});

describe('base page', () => {
  async function withTemplate(tplId = 'projects') {
    const ctx = await mountApp();
    const tpl = TEMPLATES.find((t) => t.id === tplId);
    const built = buildTemplate(tpl);
    const id = await ctx.store.createBase({ name: tpl.name, doc: built.doc, records: built.records });
    const page = await openBase(ctx.app, id);
    return { ...ctx, page, id };
  }

  it('renders tables, views, the toolbar and the grid', async () => {
    const { page, root } = await withTemplate();
    expect([...root.querySelectorAll('[role=tab]')].map((t) => t.textContent)).toEqual(['Projects', 'Tasks']);
    expect([...root.querySelectorAll('.view-item .view-name')].map((t) => t.textContent)).toEqual(['Grid view', 'By status', 'Deadlines', 'Timeline']);
    expect(root.querySelector('.grid-scroller').getAttribute('role')).toBe('grid');
    expect(page.viewInst.layout.records.length).toBe(4);
    expect(await a11y(root.querySelector('.viewbar'))).toEqual([]);
  });

  it('switches tables, views and keeps the address in step', async () => {
    const { page, root } = await withTemplate();
    const tasks = page.base.tableList()[1];
    click(root.querySelectorAll('[role=tab]')[1]);
    await tick();
    expect(page.tableId).toBe(tasks.id);
    expect(location.hash).toContain(tasks.id);
    click(root.querySelectorAll('[role=tab]')[0]);
    const kanban = page.table.views.find((v) => v.type === 'kanban');
    page.go(page.tableId, kanban.id);
    await tick();
    expect(root.querySelector('.kanban')).toBeTruthy();
    expect(root.querySelectorAll('.card').length).toBe(4);
  });

  it('mounts every view type without errors', async () => {
    const { page, root } = await withTemplate();
    for (const type of ['grid', 'calendar', 'gallery', 'kanban', 'timeline', 'list', 'form']) {
      page.createView(type);
      await tick();
      expect(page.view.type).toBe(type);
      expect(root.querySelector('.view-host').children.length).toBeGreaterThan(0);
    }
  });

  it('undoes and redoes from the top bar', async () => {
    const { page, root } = await withTemplate();
    const t = page.table;
    page.base.setCell(t.id, t.ordered()[0].id, t.primary.id, 'Renamed');
    await tick();
    click(root.querySelector('[aria-label=Undo]'));
    expect(t.ordered()[0].c[t.primary.id]).toBe('Website refresh');
    click(root.querySelector('[aria-label=Redo]'));
    expect(t.ordered()[0].c[t.primary.id]).toBe('Renamed');
  });

  it('opens a record with prev and next', async () => {
    const { page } = await withTemplate();
    const ids = page.viewInst.recordOrder();
    page.openRecord(ids[1]);
    await tick();
    const dlg = document.querySelector('dialog.record-dialog');
    expect(dlg.querySelector('.record-title').textContent).toBe('Mobile app beta');
    expect(dlg.querySelector('.record-pos').textContent).toBe('2 of 4');
    click(dlg.querySelector('[aria-label="Next record"]'));
    expect(dlg.querySelector('.record-title').textContent).toBe('Customer survey');
    expect(location.hash).toContain(ids[2]);
    // Edit a field from the dialog.
    const input = dlg.querySelector(`#rf-${page.table.fieldByName('Owner').id}`);
    input.value = 'Pat';
    input.dispatchEvent(new Event('change'));
    expect(page.table.record(ids[2]).c[page.table.fieldByName('Owner').id]).toBe('Pat');
    // Comments.
    const ta = dlg.querySelector('.comment-input');
    ta.value = 'Looks good';
    click(dlg.querySelector('.comment-compose .btn'));
    expect(page.table.record(ids[2]).cm[0].text).toBe('Looks good');
    expect(dlg.textContent).toContain('Looks good');
  });

  it('adds a filter from the toolbar', async () => {
    const { page, root } = await withTemplate();
    click(root.querySelector('.tool-btn.t-filter'));
    await tick();
    const panel = document.querySelector('.filter-panel');
    click([...panel.querySelectorAll('.link-btn')].find((b) => b.textContent.includes('Add condition')));
    const input = document.querySelector('.filter-panel input.filter-value');
    input.value = 'move';
    input.dispatchEvent(new Event('input'));
    await tick(400);
    expect(page.view.filters.conditions[0].value).toBe('move');
    expect(page.viewInst.layout.records.length).toBe(1);
    expect(root.querySelector('.tool-btn.t-filter').textContent).toContain('Filtered by Name');
  });
});
