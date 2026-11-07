// @vitest-environment jsdom
/**
 * Regression tests for the UI layer running inside the booted app shell
 * on the sample fleet: view host, list grid, and shell.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

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
  HTMLCanvasElement.prototype.getContext ??= () => null;
});

const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const key = (target, k, init = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

let ctx;
async function boot() {
  const { app } = await import('../src/app.js');
  const { createStore } = await import('../src/core/store.js');
  const { createMemoryBackend } = await import('../src/core/backend.js');
  const { bucketOf } = await import('../src/core/schema.js');
  const { buildSampleData } = await import('../src/core/sample.js');
  const { buildShell } = await import('../src/ui/shell.js');
  const { startViews } = await import('../src/ui/viewhost.js');
  app.demo = true;
  app.today = () => '2026-10-12';
  app.store = createStore({ backend: createMemoryBackend(buildSampleData('2026-10-12'), { bucketOf }) });
  await app.store.init();
  document.body.innerHTML = '<div id="app"></div>';
  const shell = buildShell({});
  document.getElementById('app').append(shell.root);
  startViews(shell.main);
  return { app, main: shell.main };
}

/** Navigate by hash and wait for the new view's heading. */
async function go(hash) {
  const before = ctx.main.firstElementChild;
  location.hash = hash;
  for (let i = 0; i < 200; i++) {
    await tick();
    const now = ctx.main.firstElementChild;
    if (now && now !== before && ctx.main.querySelector('h1')) break;
  }
  await tick();
}

beforeAll(async () => {
  ctx = await boot();
});

const heading = () => ctx.main.querySelector('h1')?.textContent;
const openDialogs = () => [...document.querySelectorAll('dialog[open]')];
const clickButton = (root, re) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent)).click();

describe('view host', () => {
  it('keeps responding to navigation after "Keep editing" on a link to the same page', async () => {
    const { navigate } = await import('../src/ui/router.js');
    await go('#/issues/new');
    const summary = ctx.main.querySelector('input[name="summary"]');
    summary.value = 'Brake noise';
    summary.dispatchEvent(new Event('input', { bubbles: true }));
    // Quick add (or the palette) pointing at the page you are already on.
    navigate('/issues/new');
    await tick();
    expect(openDialogs()).toHaveLength(1);
    clickButton(openDialogs()[0], /Keep editing/);
    await tick(30);
    expect(heading()).toBe('New issue');
    // Discard via the prompt, then a normal link must still work.
    location.hash = '#/vehicles';
    await tick(30);
    clickButton(openDialogs()[0], /Discard/);
    for (let i = 0; i < 100 && heading() !== 'Vehicles'; i++) await tick();
    expect(heading()).toBe('Vehicles');
  });

  it('asks once when Back is pressed twice on a page with unsaved changes', async () => {
    await go('#/issues/new');
    const summary = ctx.main.querySelector('input[name="summary"]');
    summary.value = 'Brake noise';
    summary.dispatchEvent(new Event('input', { bubbles: true }));
    location.hash = '#/vehicles';
    await tick(30);
    location.hash = '#/parts';
    await tick(30);
    expect(openDialogs()).toHaveLength(1);
    clickButton(openDialogs()[0], /Discard/);
    for (let i = 0; i < 100 && heading() !== 'Parts'; i++) await tick();
    expect(heading()).toBe('Parts');
    expect(openDialogs()).toHaveLength(0);
  });
});

describe('shell', () => {
  it('does not re-announce an unchanged save status on every edit', async () => {
    await go('#/vehicles');
    const status = document.querySelector('.sync-status');
    expect(status.textContent).toBe('Demo');
    const mutations = [];
    const mo = new MutationObserver((m) => mutations.push(...m));
    mo.observe(status, { childList: true, characterData: true, subtree: true });
    const v = ctx.app.store.all('vehicles')[0];
    ctx.app.store.patch('vehicles', v.id, { notes: 'checked' });
    await tick(30);
    mo.disconnect();
    expect(mutations).toHaveLength(0);
  });
});

describe('search palette', () => {
  it('acts on what was typed when Enter comes before the results refresh', async () => {
    await go('#/vehicles');
    const { openSearch } = await import('../src/ui/search.js');
    openSearch();
    const input = document.querySelector('dialog.palette input');
    input.value = 'purchase orders';
    input.dispatchEvent(new Event('input'));
    key(input, 'Enter');
    for (let i = 0; i < 100 && heading() !== 'Purchase orders'; i++) await tick();
    expect(heading()).toBe('Purchase orders');
    expect(openDialogs()).toHaveLength(0);
  });

  it('does not open over another dialog with Ctrl+K', async () => {
    await go('#/assignments');
    const { openAssignmentDialog } = await import('../src/views/assignments.js');
    openAssignmentDialog({});
    await tick();
    const form = openDialogs()[0];
    key(form.querySelector('input, button'), 'k', { ctrlKey: true });
    expect(document.querySelector('dialog.palette')).toBeNull();
    clickButton(form.querySelector('.dialog-foot'), /Cancel/);
    // With nothing open it still works.
    key(document.body, 'k', { ctrlKey: true });
    expect(document.querySelector('dialog.palette')).not.toBeNull();
    key(document.querySelector('dialog.palette input'), 'Escape');
  });

  it('leaves Enter to the IME while composing', async () => {
    const { openSearch } = await import('../src/ui/search.js');
    openSearch();
    const input = document.querySelector('dialog.palette input');
    input.value = 'parts';
    input.dispatchEvent(new Event('input'));
    await tick(100);
    key(input, 'Enter', { isComposing: true });
    expect(document.querySelector('dialog.palette')).not.toBeNull();
    key(input, 'Escape');
    expect(document.querySelector('dialog.palette')).toBeNull();
  });
});

describe('menus', () => {
  it('closes an open menu when the page changes underneath it', async () => {
    await go('#/vehicles');
    const add = document.querySelector('.add-btn');
    add.click();
    expect(add.getAttribute('aria-expanded')).toBe('true');
    // Browser Back (Alt+Left) while the menu is open.
    await go('#/issues');
    expect(document.querySelector('.popover')).toBeNull();
    expect(add.getAttribute('aria-expanded')).toBe('false');
    // The next Escape is not swallowed by the stale menu.
    const e = key(document.body, 'Escape');
    expect(e.defaultPrevented).toBe(false);
  });

  it('keeps letters typed in an open menu away from the page shortcuts', async () => {
    await go('#/vehicles');
    ctx.main.querySelector('[aria-label="More actions"]').click();
    const menu = document.querySelector('.popover [role="menu"]');
    expect(menu.contains(document.activeElement)).toBe(true);
    // J is "next row" on a list page; G then S is "go to Service".
    for (const k of ['j', 'g', 's']) key(document.activeElement, k);
    await tick(30);
    expect(heading()).toBe('Vehicles');
    expect(ctx.main.querySelector('tr.kbd-focus')).toBeNull();
    expect(document.querySelector('.popover [role="menu"]')).toBe(menu);
    key(document.activeElement, 'Escape');
  });
});
