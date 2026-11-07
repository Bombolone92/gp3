// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { setupStore, makeCtx, mount, settle, byText } from './review2-checkin-env.js';
import { app } from '../src/app.js';
import { attendanceName, studentRecordId, checkIn, checkOut, moveRoom, currentRoom } from '../src/core/attendance.js';

const seed = {
  rooms: [{ id: 'r1', name: 'Bees' }, { id: 'r2', name: 'Owls' }],
  students: [{ id: 's1', firstName: 'Ava', lastName: 'Chen', status: 'active', roomId: 'r1' }],
  guardians: [{ id: 'g1', firstName: 'Mia', lastName: 'Chen', pin: '1234', studentIds: ['s1'] }],
};

let ctx;
afterEach(() => ctx?.dispose());

describe('kiosk child card room', () => {
  it('shows the room "Check in again" will put the child in', async () => {
    const store = await setupStore(seed);
    const day = app.today();
    checkIn(store, day, 's1', { roomId: 'r1', at: '08:00' });
    moveRoom(store, day, 's1', 'r2', { at: '09:00' });
    checkOut(store, day, 's1', { at: '12:00' });
    const { render } = await import('../src/views/kiosk.js');
    ctx = makeCtx();
    const out = render(ctx);
    mount(out);
    for (const k of '1234') document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    await settle();
    await settle();
    const card = byText(out.node, 'button.kiosk-kid', 'Ava');
    const shown = card.querySelector('.kiosk-kid-room').textContent;
    card.click();
    const room = store.get('rooms', currentRoom(store.get(attendanceName(day), studentRecordId('s1'))));
    expect(shown).toBe(room.name);
  });
});
