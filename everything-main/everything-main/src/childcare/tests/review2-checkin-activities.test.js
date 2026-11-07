// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { setupStore, makeCtx, mount, settle, byText } from './review2-checkin-env.js';
import { app } from '../src/app.js';
import { addDays } from '../src/core/dates.js';
import { logActivity, activityName } from '../src/core/activities.js';

const seed = () => ({
  rooms: [{ id: 'r1', name: 'Bees', ratio: 4 }],
  students: [
    { id: 's1', firstName: 'Ava', lastName: 'Chen', status: 'active', roomId: 'r1' },
    { id: 's2', firstName: 'Ben', lastName: 'Ode', status: 'active', roomId: 'r1' },
  ],
});

let ctx;
let store;
async function openActivities(query = {}, data = seed()) {
  store = data ? await setupStore(data) : app.store;
  const { render } = await import('../src/views/activities.js');
  ctx = makeCtx(query);
  const node = render(ctx);
  mount(node);
  await settle();
  return node;
}

afterEach(() => {
  ctx?.dispose();
  vi.useRealTimers();
  document.querySelectorAll('dialog').forEach((d) => d.remove());
});

describe('activities', () => {
  it('a screen left open overnight logs the morning entries on the new day', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 12, 23, 58));
    const page = await openActivities();
    vi.setSystemTime(new Date(2026, 9, 13, 7, 30));
    vi.advanceTimersByTime(61000);
    await settle();
    byText(page, 'button.quick-type', 'Meal').click();
    expect(document.querySelector('dialog input[type=date]').value).toBe('2026-10-13');
  });

  it('a click on a screen that missed midnight does not log on yesterday', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 12, 23, 58));
    const page = await openActivities();
    vi.setSystemTime(new Date(2026, 9, 13, 7, 30));
    byText(page, 'button.quick-type', 'Meal').click();
    expect(document.querySelector('dialog input[type=date]')).toBeNull();
    byText(page, 'button.quick-type', 'Meal').click();
    expect(document.querySelector('dialog input[type=date]').value).toBe('2026-10-13');
  });

  it('selecting a child with the keyboard keeps focus on their tile', async () => {
    const page = await openActivities();
    const only = page.querySelector('input[data-key="only-in"]');
    only.focus();
    only.click();
    expect(document.activeElement?.dataset.key).toBe('only-in');
    const tile = byText(page, 'label.kid-tile', 'Ava').querySelector('input');
    tile.focus();
    tile.click();
    const now = byText(page, 'label.kid-tile', 'Ava');
    expect(now.classList.contains('on')).toBe(true);
    expect(document.activeElement).toBe(now.querySelector('input'));
  });

  it('"Everyone is up" never ends a nap before it started', async () => {
    await setupStore(seed());
    const day = addDays(app.today(), -1);
    const [late] = logActivity(app.store, { type: 'nap', day, at: '15:30', studentIds: ['s1'], details: { start: '15:30' } });
    const [early] = logActivity(app.store, { type: 'nap', day, at: '13:00', studentIds: ['s2'], details: { start: '13:00' } });
    const page = await openActivities({ date: day }, null);
    byText(page, '.nap-bar button', 'Everyone is up').click();
    expect(app.store.get(activityName(day), late.id).details.end).toBe('15:30');
    expect(app.store.get(activityName(day), early.id).details.end).toBe('15:00');
  });
});
