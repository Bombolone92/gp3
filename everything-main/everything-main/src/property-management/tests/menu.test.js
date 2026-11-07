// @vitest-environment jsdom
/** Menus and popovers: keyboard, focus and cleanup. */
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
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

async function go(hash) {
  const before = ctx.main.firstElementChild;
  location.hash = hash;
  for (let i = 0; i < 250; i++) {
    await settle();
    const now = ctx.main.firstElementChild;
    if (now && now !== before && ctx.main.querySelector('h1')) break;
  }
  await settle();
}

const key = (target, k) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const openMore = async () => {
  const btn = ctx.main.querySelector('button[aria-label="More actions"]');
  btn.click();
  await settle();
  return btn;
};

describe('menus', () => {
  beforeAll(async () => {
    ctx = await boot();
  });

  it('letters typed in a menu jump within it and trigger no shortcut', async () => {
    await go(`#/leases/${ctx.app.store.all('leases')[0].id}`);
    await openMore();
    const item = document.activeElement;
    expect(item.getAttribute('role')).toBe('menuitem');
    key(item, 'g');
    key(document.activeElement, 'p');
    await settle();
    expect(location.hash).not.toBe('#/properties');
    key(document.activeElement, 'n');
    await settle();
    expect(document.querySelectorAll('.popover').length).toBe(1);
    key(document.activeElement, 'Escape');
  });

  it('Ctrl+K does not open search over another dialog', async () => {
    const { openDialog } = await import('../src/ui/dialog.js');
    const api = openDialog({ title: 'Edit tenant', body: () => document.createElement('div') });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    await settle();
    expect(document.querySelector('dialog.palette')).toBe(null);
    api.close();
    await settle();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    await settle();
    expect(document.querySelector('dialog.palette[open]')).toBeTruthy();
    document.querySelector('dialog.palette').close();
    document.querySelector('dialog.palette').remove();
  });

  it('choosing a menu item returns focus to the menu button', async () => {
    const { openMenu } = await import('../src/ui/menu.js');
    const btn = document.createElement('button');
    ctx.main.append(btn);
    let ran = false;
    openMenu(btn, [{ label: 'Archive', run: () => (ran = true) }]);
    expect(document.activeElement.getAttribute('role')).toBe('menuitem');
    document.activeElement.click();
    expect(ran).toBe(true);
    expect(document.activeElement).toBe(btn);
    btn.remove();
  });

  it('a menu left open is closed when the page changes', async () => {
    await go(`#/leases/${ctx.app.store.all('leases')[1].id}`);
    const btn = await openMore();
    expect(document.querySelectorAll('.popover').length).toBe(1);
    await go('#/properties');
    expect(document.querySelectorAll('.popover').length).toBe(0);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    // Escape reaches the new page again (a search box clears).
    const search = ctx.main.querySelector('input[type=search]');
    search.value = 'x';
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    search.dispatchEvent(esc);
    expect(search.value).toBe('');
  });

  it('arrow keys reach unavailable items, which do nothing when chosen', async () => {
    const { openMenu } = await import('../src/ui/menu.js');
    const btn = document.createElement('button');
    ctx.main.append(btn);
    let ran = 0;
    openMenu(btn, [{ label: 'Edit', run: () => ran++ }, { label: 'Delete', disabled: true, description: 'Has leases', run: () => ran++ }, { label: 'Archive', run: () => ran++ }]);
    const items = [...document.querySelectorAll('.popover [role=menuitem]')];
    key(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    expect(items[1].getAttribute('aria-disabled')).toBe('true');
    expect(items[1].disabled).toBe(false);
    items[1].click();
    expect(ran).toBe(0);
    expect(document.querySelectorAll('.popover').length).toBe(1);
    key(document.activeElement, 'Escape');
    btn.remove();
  });

  it('"More actions" buttons say they open a menu before they are used', async () => {
    await go(`#/properties/${ctx.app.store.all('properties')[2].id}`);
    const btn = ctx.main.querySelector('button[aria-label="More actions"]');
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it("a report's property picker takes focus when it opens", async () => {
    await go('#/reports/rent-roll');
    const btn = ctx.main.querySelector('button.rp-multi');
    btn.click();
    await settle();
    const pop = document.querySelector('.popover');
    expect(pop.contains(document.activeElement)).toBe(true);
    expect(document.activeElement.matches('input[type=checkbox]')).toBe(true);
    key(document.activeElement, 'Escape');
    expect(document.activeElement).toBe(btn);
  });

  it('a field flagged invalid is unflagged once it is edited', async () => {
    const { formDialog } = await import('../src/ui/dialog.js');
    const input = document.createElement('input');
    input.required = true;
    input.name = 'x';
    const done = formDialog({ title: 'T', body: input, onSubmit: () => true });
    const form = input.closest('form');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    input.value = 'ok';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await done;
  });

  it('a toast raised in a dialog shows inside it, and stays when the dialog closes', async () => {
    const { openDialog } = await import('../src/ui/dialog.js');
    const { toast } = await import('../src/ui/toast.js');
    const api = openDialog({ title: 'Edit', body: () => document.createElement('div') });
    toast('Enter the asking rent.', { type: 'error' });
    const region = document.querySelector('.toast-region');
    expect(api.dialog.contains(region)).toBe(true);
    toast('Saved');
    api.close();
    expect(document.body.contains(region)).toBe(true);
    expect(region.textContent).toContain('Saved');
  });

  it('the message area is in the page before the first message, and Undo waits while focused', async () => {
    const { toast } = await import('../src/ui/toast.js');
    // The live region was created with the app, before any message.
    expect(document.querySelector('.toast-region[aria-live]')).toBeTruthy();
    toast('Tenant deleted', { action: { label: 'Undo', run: () => {} }, duration: 50 });
    const undo = [...document.querySelectorAll('.toast-action')].pop();
    undo.focus();
    await settle(120);
    expect(undo.isConnected).toBe(true);
    undo.click();
  });

  it('"Show more" keeps its rows when data changes, and focus moves to the new rows', async () => {
    const { buildCharge } = await import('../src/core/ledger.js');
    await go('#/ledger');
    const rows = () => ctx.main.querySelectorAll('.table-wrap tbody tr').length;
    expect(rows()).toBe(100);
    ctx.main.querySelector('.show-more button').click();
    expect(rows()).toBe(200);
    const focusedRow = document.activeElement.closest('tr');
    expect([...ctx.main.querySelectorAll('.table-wrap tbody tr')].indexOf(focusedRow)).toBe(100);
    const lease = ctx.app.store.all('leases')[0];
    ctx.app.store.put('transactions', buildCharge({ lease, date: '2026-10-12', items: [{ accountId: 'acc-late-fees', amount: 100 }] }));
    await settle(60);
    expect(rows()).toBeGreaterThanOrEqual(200);
  });

  it('a popover never puts focus on an option outside the tab order', async () => {
    const { openPopover } = await import('../src/ui/menu.js');
    const anchor = document.createElement('button');
    ctx.main.append(anchor);
    const group = document.createElement('div');
    group.innerHTML = '<button role="radio" tabindex="-1">System</button><button role="radio" aria-checked="true" tabindex="0">Dark</button>';
    const api = openPopover(anchor, group);
    expect(document.activeElement.textContent).toBe('Dark');
    api.close();
    anchor.remove();
  });
});
