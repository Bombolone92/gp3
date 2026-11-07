// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore, makeCtx, mount, settle, byText } from './review2-checkin-env.js';
import { app } from '../src/app.js';
import { attendanceName, studentRecordId, statusOf, checkIn, moveRoom } from '../src/core/attendance.js';

const seed = {
  rooms: [{ id: 'r1', name: 'Bees', ratio: 4 }],
  students: [{ id: 's1', firstName: 'Ava', lastName: 'Chen', status: 'active', roomId: 'r1' }],
  guardians: [{ id: 'g1', firstName: 'Mia', lastName: 'Chen', pin: '1234', studentIds: ['s1'] }],
};

let ctx;
let store;
async function openKiosk() {
  store = await setupStore(seed);
  const { render } = await import('../src/views/kiosk.js');
  ctx = makeCtx();
  const out = render(ctx);
  mount(out);
  return out.node;
}

const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
async function typePin(pin) {
  for (const k of pin) key(k);
  await settle();
  await settle();
}

afterEach(() => ctx?.dispose());

describe('kiosk', () => {
  it('a double tap on a child does not check them in and straight back out', async () => {
    const root = await openKiosk();
    await typePin('1234');
    byText(root, 'button.kiosk-kid', 'Ava').click();
    await settle();
    // The second tap of a double tap lands on the redrawn card.
    byText(root, 'button.kiosk-kid', 'Ava').click();
    await settle();
    const rec = store.get(attendanceName(app.today()), studentRecordId('s1'));
    expect(statusOf(rec)).toBe('in');
    expect(rec.events).toHaveLength(1);
  });

  it('digits typed during a lockout are ignored instead of filling a stuck PIN', async () => {
    const root = await openKiosk();
    for (let i = 0; i < 5; i++) await typePin('9999');
    await typePin('12');
    expect(root.querySelectorAll('.pin-dots span.on')).toHaveLength(0);
  });

  it('does not nest a second <main> landmark inside the app main', async () => {
    const root = await openKiosk();
    expect(root.querySelector('main')).toBeNull();
  });

  it('keeps focus on a keypad key after pressing it, and keeps one live region', async () => {
    const root = await openKiosk();
    const live = root.querySelector('[aria-live]');
    const one = byText(root, 'button.key', '1');
    one.focus();
    one.click();
    expect(document.activeElement?.textContent).toBe('1');
    expect(live.isConnected).toBe(true);
    expect(live.textContent).toContain('1 of 4');
  });

  it('keeps focus on the child card that was tapped when the cards redraw', async () => {
    const root = await openKiosk();
    await typePin('1234');
    const card = byText(root, 'button.kiosk-kid', 'Ava');
    card.focus();
    card.click();
    await settle();
    expect(document.activeElement?.classList.contains('kiosk-kid')).toBe(true);
    expect(document.activeElement.textContent).toContain('Check out');
  });

  it('the exit PIN screen returns to the PIN pad when left alone', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    try {
      store = await setupStore(seed);
      await store.saveSettings({ kioskPinHash: 'x'.repeat(64) });
      const { render } = await import('../src/views/kiosk.js');
      ctx = makeCtx();
      const out = render(ctx);
      mount(out);
      byText(out.node, 'button', 'Exit kiosk').click();
      // The exit check hashes with WebCrypto, which runs on real time.
      for (let i = 0; i < 200 && !out.node.textContent.includes('Director PIN to exit'); i++) await new Promise((r) => setImmediate(r));
      expect(out.node.textContent).toContain('Director PIN to exit');
      await vi.advanceTimersByTimeAsync(60000);
      expect(out.node.textContent).not.toContain('Director PIN to exit');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a child card shows the room the child is in today', async () => {
    const root = await openKiosk();
    store.put('rooms', { id: 'r2', name: 'Owls' });
    checkIn(store, app.today(), 's1', { roomId: 'r1' });
    moveRoom(store, app.today(), 's1', 'r2');
    await typePin('1234');
    expect(byText(root, 'button.kiosk-kid', 'Ava').querySelector('.kiosk-kid-room').textContent).toBe('Owls');
  });
});
