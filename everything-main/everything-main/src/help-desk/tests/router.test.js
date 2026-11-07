import { describe, it, expect } from 'vitest';
import { onRoute, guardLeave, go } from '../src/ui/router.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
// Stepping back through history is a task of its own, which can take a
// while when the machine is busy: wait for it rather than a fixed time.
async function until(fn, timeout = 2000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('Timed out');
    await tick(10);
  }
}
const dialogButton = (label) => [...document.querySelectorAll('dialog[open] .dialog-foot .btn')].find((b) => b.textContent === label);

describe('leaving with unsaved changes', () => {
  it('asks first, and stays or leaves as chosen', async () => {
    go('/admin/general');
    await tick(20);
    const seen = [];
    const off = onRoute((r) => seen.push(r.hash));
    let dirty = true;
    const unguard = guardLeave(() => dirty);
    location.hash = '#/home';
    await until(() => document.querySelector('dialog[open]') && location.hash === '#/admin/general');
    expect(seen).toEqual([]);
    dialogButton('Keep editing').click();
    await tick(30);
    expect(location.hash).toBe('#/admin/general');
    expect(seen).toEqual([]);
    location.hash = '#/home';
    await until(() => dialogButton('Discard') && location.hash === '#/admin/general');
    dialogButton('Discard').click();
    await until(() => location.hash === '#/home');
    expect(seen.at(-1)).toBe('#/home');
    // Nothing to lose: no question.
    dirty = false;
    location.hash = '#/views';
    await tick(30);
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(seen.at(-1)).toBe('#/views');
    unguard();
    off();
  });
});
