// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { setupStore, makeCtx, mount, settle, byText } from './review2-checkin-env.js';
import { attendanceName, studentRecordId, statusOf, checkIn, checkOut } from '../src/core/attendance.js';
import { app } from '../src/app.js';
import { addDays } from '../src/core/dates.js';

const undoButton = () => [...document.querySelectorAll('.toast-action')].at(-1);

const seed = () => ({
  rooms: [{ id: 'r1', name: 'Bees', ratio: 4 }],
  students: [
    { id: 's1', firstName: 'Ava', lastName: 'Chen', status: 'active', roomId: 'r1' },
    { id: 's2', firstName: 'Ben', lastName: 'Ode', status: 'active', roomId: 'r1' },
  ],
  guardians: [
    { id: 'g1', firstName: 'Mia', lastName: 'Chen', studentIds: ['s1'], canPickup: true },
    { id: 'g2', firstName: 'Leo', lastName: 'Chen', studentIds: ['s1'], canPickup: true },
  ],
  staff: [{ id: 't1', firstName: 'Tess', lastName: 'Lee' }],
});

let ctx;
let store;
async function openBoard(query = {}) {
  store = await setupStore(seed());
  const { render } = await import('../src/views/attendance.js');
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

describe('check-in board', () => {
  it('a board left open overnight records the morning check-ins on the new day', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 12, 23, 58));
    const page = await openBoard();
    vi.setSystemTime(new Date(2026, 9, 13, 7, 30));
    vi.advanceTimersByTime(61000);
    await settle();
    byText(page, '.checkin-row', 'Ava').querySelector('button.checkin').click();
    await settle();
    expect(store.get(attendanceName('2026-10-12'), studentRecordId('s1'))).toBeNull();
    const rec = store.get(attendanceName('2026-10-13'), studentRecordId('s1'));
    expect(rec?.events?.[0]).toMatchObject({ type: 'in', at: '07:31' });
  });

  it('a click on a board that missed midnight does not act on yesterday', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 12, 23, 58));
    const page = await openBoard();
    // The laptop slept: no timer ran before the first click of the morning.
    vi.setSystemTime(new Date(2026, 9, 13, 7, 30));
    byText(page, '.checkin-row', 'Ava').querySelector('button.checkin').click();
    await settle();
    expect(store.get(attendanceName('2026-10-12'), studentRecordId('s1'))).toBeNull();
  });

  it('Undo after moving to another day does not remove an event from that day', async () => {
    const page = await openBoard();
    const today = app.today();
    const yesterday = addDays(today, -1);
    checkIn(store, yesterday, 's1', { roomId: 'r1', at: '08:00' });
    checkOut(store, yesterday, 's1', { at: '16:00' });
    byText(page, '.checkin-row', 'Ava').querySelector('button.checkin').click();
    const undo = undoButton();
    page.querySelector('button[aria-label="Previous day"]').click();
    await settle();
    undo.click();
    await settle();
    expect(store.get(attendanceName(yesterday), studentRecordId('s1')).events).toHaveLength(2);
    expect(store.get(attendanceName(today), studentRecordId('s1'))).toBeNull();
  });

  it('Undo of a check in does not remove a later check out instead', async () => {
    const page = await openBoard();
    const today = app.today();
    byText(page, '.checkin-row', 'Ava').querySelector('button.checkin').click();
    const undo = undoButton();
    checkOut(store, today, 's1', { at: '23:59' });
    undo.click();
    await settle();
    const rec = store.get(attendanceName(today), studentRecordId('s1'));
    expect(rec.events.map((e) => e.type)).toEqual(['out']);
  });

  it('choosing who picks up keeps focus on the chosen person, and arrows move the choice', async () => {
    const page = await openBoard();
    checkIn(store, app.today(), 's1', { roomId: 'r1', at: '08:00' });
    await settle();
    byText(page, '.checkin-row', 'Ava').querySelector('button.checkout').click();
    const options = [...document.querySelectorAll('dialog .pickup-option')];
    expect(options).toHaveLength(2);
    options[0].focus();
    options[0].click();
    expect(document.activeElement).toBe(options[0]);
    expect(options[0].getAttribute('aria-checked')).toBe('true');
    options[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(options[1]);
    expect(options[1].getAttribute('aria-checked')).toBe('true');
    expect(options[0].getAttribute('aria-checked')).toBe('false');
    byText(document, 'dialog .dialog-foot button', 'Check out').click();
    expect(store.get(attendanceName(app.today()), studentRecordId('s1')).events.at(-1)).toMatchObject({ type: 'out', person: options[1].querySelector('.person-name').textContent });
  });

  it('a bulk action that changes nothing still clears the selection on screen', async () => {
    const page = await openBoard();
    checkIn(store, app.today(), 's1', { roomId: 'r1', at: '08:00' });
    checkIn(store, app.today(), 's2', { roomId: 'r1', at: '08:00' });
    await settle();
    for (const name of ['Ava', 'Ben']) byText(page, '.checkin-row', name).querySelector('input[type=checkbox]').click();
    expect(page.querySelector('.bulk-bar')).not.toBeNull();
    byText(page, '.bulk-bar button', 'Check in').click();
    await settle();
    expect(page.querySelector('.bulk-bar')).toBeNull();
    expect([...page.querySelectorAll('.checkin-row input[type=checkbox]')].some((c) => c.checked)).toBe(false);
  });

  it('correcting a time keeps focus in the time field', async () => {
    const page = await openBoard();
    checkIn(store, app.today(), 's1', { roomId: 'r1', at: '08:00' });
    checkOut(store, app.today(), 's1', { at: '16:00' });
    await settle();
    byText(page, '.checkin-row', 'Ava').querySelector('button[aria-label="More for Ava Chen"]').click();
    byText(document, '.menu-item', 'Edit times').click();
    const input = document.querySelector('dialog .event-row input');
    input.focus();
    input.value = '08:04';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.activeElement).toBe(input);
    input.value = '08:45';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.get(attendanceName(app.today()), studentRecordId('s1')).events.map((e) => e.at)).toEqual(['08:45', '16:00']);
  });

  it('time fields in the corrections dialog are named like their rows', async () => {
    const page = await openBoard();
    checkIn(store, app.today(), 's1', { roomId: 'r1', at: '08:00' });
    checkOut(store, app.today(), 's1', { at: '16:00' });
    await settle();
    byText(page, '.checkin-row', 'Ava').querySelector('button[aria-label="More for Ava Chen"]').click();
    byText(document, '.menu-item', 'Edit times').click();
    const labels = [...document.querySelectorAll('dialog .event-row input')].map((i) => i.getAttribute('aria-label'));
    expect(labels).toEqual(['Check in time', 'Check out time']);
    const removes = [...document.querySelectorAll('dialog .event-row button')].map((b) => b.getAttribute('aria-label'));
    expect(removes).toEqual(['Remove check in', 'Remove check out']);
  });
});
