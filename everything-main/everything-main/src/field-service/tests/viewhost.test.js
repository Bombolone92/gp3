// @vitest-environment jsdom
/**
 * Page changes away from a form with unsaved changes: the "Discard unsaved
 * changes?" prompt, and what happens on the way out of it.
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

describe('leaving a page with unsaved changes', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await bootDemo();
  });

  const heading = () => ctx.main.querySelector('h1')?.textContent || '';
  const waitFor = async (fn) => {
    for (let i = 0; i < 100 && !fn(); i++) await settle();
    await settle();
  };
  // jsdom fires hashchange itself when the hash changes.
  const go = (hash) => {
    location.hash = hash;
  };
  const makeDirty = () => {
    const input = ctx.main.querySelector('input[type="text"], input:not([type])');
    input.value = 'Someone';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const confirmButton = (label) => [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === label);

  it('still changes page after Keep editing on a link to the same form', async () => {
    const { navigate } = await import('../src/ui/router.js');
    await go('#/clients/new');
    await waitFor(() => /New client/.test(heading()));
    makeDirty();
    navigate('/clients/new');
    await waitFor(() => confirmButton('Keep editing'));
    expect(confirmButton('Keep editing')).toBeTruthy();
    confirmButton('Keep editing').click();
    await settle();
    expect(heading()).toMatch(/New client/);

    await go('#/clients');
    await waitFor(() => heading() === 'Clients' || document.querySelector('dialog[open]'));
    // The form is still dirty, so leaving asks first.
    confirmButton('Discard changes')?.click();
    await waitFor(() => heading() === 'Clients');
    expect(heading()).toBe('Clients');
  }, 15000);

  it('asks once when the page changes again while it is asking, and goes to the last page asked for', async () => {
    await go('#/clients/new');
    await waitFor(() => /New client/.test(heading()) && !document.querySelector('dialog[open]'));
    makeDirty();
    go('#/clients');
    await waitFor(() => confirmButton('Discard changes'));
    // Browser Back pressed again before answering.
    go('#/jobs');
    await settle(60);
    expect(document.querySelectorAll('dialog[open]').length).toBe(1);
    confirmButton('Discard changes').click();
    await waitFor(() => heading() === 'Jobs');
    expect(heading()).toBe('Jobs');
    expect(location.hash).toBe('#/jobs');
  }, 15000);

  it('stays on the form after Keep editing when the page changed twice while asking', async () => {
    await go('#/clients/new');
    await waitFor(() => /New client/.test(heading()) && !document.querySelector('dialog[open]'));
    makeDirty();
    go('#/clients');
    await waitFor(() => confirmButton('Keep editing'));
    go('#/jobs');
    await settle(60);
    confirmButton('Keep editing').click();
    await settle(60);
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(location.hash).toBe('#/clients/new');
    expect(heading()).toMatch(/New client/);
  }, 15000);
});
