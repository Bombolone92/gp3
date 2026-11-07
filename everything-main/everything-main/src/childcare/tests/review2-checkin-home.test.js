// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { setupStore, makeCtx, mount, settle } from './review2-checkin-env.js';
import { app } from '../src/app.js';

const seed = () => ({
  rooms: [{ id: 'r1', name: 'Bees', ratio: 4 }],
  students: [{ id: 's1', firstName: 'Ava', lastName: 'Chen', status: 'active', roomId: 'r1' }],
});

let ctx;
async function openHome(query = {}) {
  await setupStore(seed());
  const { render } = await import('../src/views/home.js');
  ctx = makeCtx(query);
  const node = render(ctx);
  mount(node);
  await settle();
  return node;
}

afterEach(() => {
  ctx?.dispose();
  vi.useRealTimers();
});

describe('home', () => {
  it('the greeting and date move on with the clock', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 12, 23, 58));
    const page = await openHome();
    expect(page.querySelector('h1').textContent).toBe('Good evening');
    vi.setSystemTime(new Date(2026, 9, 13, 8, 0));
    vi.advanceTimersByTime(60000);
    expect(page.querySelector('h1').textContent).toBe('Good morning');
    expect(page.querySelector('.page-header .subtitle').textContent).toContain('13');
  });

  it('the family child switch is a set of toggle buttons that keep focus', async () => {
    await setupStore({ students: [{ id: 's1', firstName: 'Ava', status: 'active' }, { id: 's2', firstName: 'Ben', status: 'active' }] });
    Object.assign(app, { demoRole: 'family', me: { guardianId: null, staffId: null, studentIds: ['s1', 's2'] } });
    const { render } = await import('../src/views/home.js');
    ctx = makeCtx();
    const page = render(ctx);
    mount(page);
    await settle();
    const sw = page.querySelector('.child-switch');
    // Tabs need tab panels and arrow keys; these are plain toggles.
    expect(sw.querySelector('[role=tab]')).toBeNull();
    const ben = [...sw.querySelectorAll('button')].find((b) => b.textContent.includes('Ben'));
    ben.focus();
    ben.click();
    const now = [...page.querySelectorAll('.child-switch button')].find((b) => b.textContent.includes('Ben'));
    expect(now.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(now);
  });
});
