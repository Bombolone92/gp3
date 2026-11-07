// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.requestAnimationFrame ??= window.requestAnimationFrame;
});

const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('sync indicator', () => {
  it('says changes were not saved when the server refused one, while staying online', async () => {
    const { app } = await import('../src/app.js');
    const { createStore } = await import('../src/core/store.js');
    const { createMemoryBackend } = await import('../src/core/backend.js');
    const { buildShell } = await import('../src/ui/shell.js');
    app.demo = false;
    app.today = () => '2026-10-12';
    app.store = createStore({ backend: createMemoryBackend({}), flushDelay: 10 });
    await app.store.init();
    document.body.innerHTML = '';
    const shell = buildShell({});
    document.body.append(shell.root);
    const sync = () => shell.root.querySelector('.sync-status');
    expect(sync().textContent).toBe('Saved');

    // What the store records when the server permanently refuses a write.
    app.store.state.error = 'Some changes were rejected by the server and could not be saved.';
    app.store.put('clients', { firstName: 'Ada', lastName: 'Lovelace' });
    for (let i = 0; i < 50 && app.store.pendingCount(); i++) await settle();
    await settle();
    expect(app.store.state.online).toBe(true);
    expect(sync().textContent).not.toBe('Saved');
    expect(sync().title).toMatch(/rejected by the server/);
  });
});
