// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { setupStore, makeCtx, mount, settle, byText } from './review2-checkin-env.js';
import { attendanceName, studentRecordId, staffRecordId, statusOf, markAbsent } from '../src/core/attendance.js';
import { app } from '../src/app.js';

const undoButton = () => [...document.querySelectorAll('.toast-action')].at(-1);

const seed = () => ({
  rooms: [{ id: 'r1', name: 'Bees', ratio: 4 }],
  students: [{ id: 's1', firstName: 'Ava', lastName: 'Chen', status: 'active', roomId: 'r1' }],
  staff: [{ id: 't1', firstName: 'Tess', lastName: 'Lee' }],
});

let ctx;
let store;
async function openBoard(query = {}, before) {
  store = await setupStore(seed());
  before?.();
  const { render } = await import('../src/views/attendance.js');
  ctx = makeCtx(query);
  const node = render(ctx);
  mount(node);
  await settle();
  return node;
}

async function clockIn(page) {
  byText(page, '.checkin-row', 'Tess').querySelector('button.checkin').click();
  byText(document, '[role=menuitem]', 'Clock in to Bees').click();
  await settle();
}

afterEach(() => {
  ctx?.dispose();
  document.querySelectorAll('dialog, .menu, [role=menu]').forEach((d) => d.remove());
});

describe('staff clock in and out', () => {
  it('a second press right after clocking in does not clock straight back out', async () => {
    const page = await openBoard({ tab: 'staff' });
    await clockIn(page);
    byText(page, '.checkin-row', 'Tess').querySelector('button.checkout').click();
    await settle();
    const rec = store.get(attendanceName(app.today()), staffRecordId('t1'));
    expect(statusOf(rec)).toBe('in');
    expect(rec.events).toHaveLength(1);
  });

  it('clocking in and out can be undone from the toast', async () => {
    const page = await openBoard({ tab: 'staff' });
    await clockIn(page);
    undoButton().click();
    await settle();
    expect(store.get(attendanceName(app.today()), staffRecordId('t1'))).toBeNull();
  });
});

describe('check-in Undo', () => {
  it('puts back the absence that the check in cleared', async () => {
    const page = await openBoard({}, () => markAbsent(store, app.today(), 's1', { reason: 'Sick' }));
    byText(page, '.checkin-row', 'Ava').querySelector('button.checkin').click();
    await settle();
    expect(statusOf(store.get(attendanceName(app.today()), studentRecordId('s1')))).toBe('in');
    undoButton().click();
    await settle();
    const rec = store.get(attendanceName(app.today()), studentRecordId('s1'));
    expect(statusOf(rec)).toBe('absent');
    expect(rec.absent.reason).toBe('Sick');
  });
});
