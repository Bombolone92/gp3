/** An Admin section whose code cannot be loaded (offline, or after an update). */
import { describe, it, expect, vi } from 'vitest';
import { app } from '../src/app.js';

vi.mock('../src/views/admin-settings.js', () => {
  throw new TypeError('Failed to fetch dynamically imported module');
});

describe('admin sections', () => {
  it('say when one could not be loaded, and offer to reload', async () => {
    const r = new EventTarget();
    Object.assign(r, { meta: { name: 'Acme' }, members: {}, cfg: {}, me: { uuid: 'u1', role: 'owner' }, isAdmin: () => true });
    app.replica = r;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { mount } = await import('../src/views/admin.js');
    const main = document.createElement('main');
    document.body.append(main);
    mount(main, { sub: 'general', route: { path: ['admin', 'general'] } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(main.textContent).toContain('General could not be loaded');
    expect(main.textContent).not.toContain('still being built');
    expect([...main.querySelectorAll('button')].some((b) => b.textContent === 'Reload')).toBe(true);
  });
});
