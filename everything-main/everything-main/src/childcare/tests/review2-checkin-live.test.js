// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { setupStore, settle } from './review2-checkin-env.js';
import { app } from '../src/app.js';
import { checkIn } from '../src/core/attendance.js';

const seed = {
  rooms: [{ id: 'r1', name: 'Bees', ratio: 4 }],
  students: [
    { id: 's1', firstName: 'Ava', lastName: 'Chen', status: 'active', roomId: 'r1' },
    { id: 's2', firstName: 'Ben', lastName: 'Ode', status: 'active', roomId: 'r1' },
  ],
};

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let main;

beforeAll(async () => {
  await setupStore(seed);
  const { startViews } = await import('../src/ui/viewhost.js');
  main = document.createElement('main');
  document.body.append(main);
  location.hash = '#/attendance';
  startViews(main);
  // The view is a lazily imported module; a busy run can take a while.
  for (let i = 0; i < 500 && !main.querySelector('.checkin-list'); i++) await wait(10);
});

describe('live regions', () => {
  it('typing in the check-in search keeps focus in the search box', async () => {
    const input = main.querySelector('input[type=search]');
    input.focus();
    input.value = 'Av';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);
    const now = main.querySelector('input[type=search]');
    expect(document.activeElement).toBe(now);
    expect(now.value).toBe('Av');
    expect(main.querySelectorAll('.checkin-row')).toHaveLength(1);
  });

  it('a check in from another device does not take focus off the board', async () => {
    main.querySelector('input[type=search]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(200);
    const more = main.querySelector('button[aria-label="More for Ben Ode"]');
    more.focus();
    checkIn(app.store, app.today(), 's1', { roomId: 'r1' });
    await settle();
    await frame();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('More for Ben Ode');
  });

  it("checking a child in keeps focus on that child's row", async () => {
    const row = [...main.querySelectorAll('.checkin-row')].find((r) => r.textContent.includes('Ben'));
    const btn = row.querySelector('button.checkin');
    btn.focus();
    btn.click();
    await settle();
    await frame();
    const now = [...main.querySelectorAll('.checkin-row')].find((r) => r.textContent.includes('Ben'));
    expect(now.contains(document.activeElement)).toBe(true);
    expect(document.activeElement.textContent).toContain('Check out');
  });
});
