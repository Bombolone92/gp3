// @vitest-environment jsdom
/** The line item editor shared by service entries and work orders. */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.requestAnimationFrame ??= window.requestAnimationFrame;
  Element.prototype.scrollIntoView ??= function () {};
});

let app;
let store;
beforeEach(async () => {
  ({ app } = await import('../src/app.js'));
  const { createStore } = await import('../src/core/store.js');
  const { createMemoryBackend } = await import('../src/core/backend.js');
  const { bucketOf } = await import('../src/core/schema.js');
  app.demo = true;
  app.team = null;
  app.today = () => '2026-10-12';
  store = createStore({ backend: createMemoryBackend({}, { bucketOf }), flushDelay: 0 });
  await store.init();
  app.store = store;
  document.body.innerHTML = '';
});

async function editor(items) {
  const { lineItemsEditor } = await import('../src/views/line-items.js');
  const node = lineItemsEditor(items);
  document.body.append(node);
  return node;
}
const button = (label) => document.querySelector(`button[aria-label="${label}"]`);

describe('line item editor', () => {
  it('shows stock on hand rounded, not as a long float', async () => {
    store.put('parts', { id: 'p1', number: 'ATF', description: 'Transmission fluid', unit: 'quart', locations: [{ location: 'A', qty: 0.1 }, { location: 'B', qty: 0.2 }] });
    await editor([{ id: 'l1', taskId: null, custom: true, parts: [{ id: 'x', partId: 'p1', name: 'Transmission fluid', qty: 1, unitCost: 0 }] }]);
    expect(document.querySelector('.li-part .cell-sub').textContent).toBe('ATF · 0.3 in stock');
  });

  it('keeps keyboard focus in the editor when a line is removed', async () => {
    await editor([
      { id: 'l1', taskId: null, custom: true, description: 'One', parts: [] },
      { id: 'l2', taskId: null, custom: true, description: 'Two', parts: [] },
    ]);
    button('Remove line 1').focus();
    button('Remove line 1').click();
    expect(document.activeElement).toBe(button('Remove line 1'));
    expect(document.querySelectorAll('.li-row')).toHaveLength(1);
    button('Remove line 1').click();
    expect(document.activeElement?.textContent).toContain('Add service task');
  });

  it('keeps keyboard focus in the line when a part is removed', async () => {
    await editor([{ id: 'l1', taskId: null, custom: true, parts: [{ id: 'a', partId: null, name: 'Bolt', qty: 1, unitCost: 0 }, { id: 'b', partId: null, name: 'Nut', qty: 1, unitCost: 0 }] }]);
    button('Remove Bolt').click();
    expect(document.activeElement).toBe(button('Remove Nut'));
    button('Remove Nut').click();
    expect(document.activeElement.getAttribute('aria-label')).toMatch(/^Add a part/);
  });
});
