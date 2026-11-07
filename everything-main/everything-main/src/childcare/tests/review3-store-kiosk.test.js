// @vitest-environment jsdom
/**
 * Third review: a kiosk that survives reloads must still let the director
 * out when the school server cannot be reached.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { setupStore, makeCtx, mount, settle, byText } from './review2-checkin-env.js';
import { app, restoreKioskLock } from '../src/app.js';
import { sha256Hex } from '../src/views/kiosk.js';

vi.mock('../src/ui/router.js', async (importOriginal) => ({ ...(await importOriginal()), navigate: vi.fn() }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
const { navigate } = await import('../src/ui/router.js');
const { toast } = await import('../src/ui/toast.js');

let ctx;
const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

async function openKiosk(role) {
  const store = await setupStore({});
  store.saveSettings({ kioskPinHash: role === 'staff' ? '' : await sha256Hex('4321') });
  Object.assign(app, { demo: false, user: { username: 'director', uuid: 'u1' }, team: { url: 'https://school.puter.work', role } });
  globalThis.puter = { workers: { exec: async () => Promise.reject(new TypeError('Failed to fetch')) } };
  const { render } = await import('../src/views/kiosk.js');
  ctx = makeCtx();
  const out = render(ctx);
  mount(out);
  return out.node;
}

async function exitWith(root, pin) {
  byText(root, 'button', 'Exit kiosk').click();
  // The button first asks whether a PIN is needed at all.
  for (let i = 0; i < 500 && !root.textContent.includes('Director PIN to exit'); i++) await settle();
  navigate.mockClear();
  toast.mockClear();
  for (const k of pin) key(k);
  // Until the PIN is answered: leaving navigates, anything else shows a toast.
  for (let i = 0; i < 500 && !navigate.mock.calls.length && !toast.mock.calls.length; i++) await settle();
}

afterEach(() => {
  ctx?.dispose();
  delete globalThis.puter;
  localStorage.clear();
});

describe('kiosk exit with the school server unreachable', () => {
  it('lets the director out with the exit PIN', async () => {
    const root = await openKiosk('owner');
    await exitWith(root, '4321');
    expect(app.kioskLock).toBe(false);
    expect(restoreKioskLock()).toBe(false);
  });

  it('still refuses a wrong PIN', async () => {
    const root = await openKiosk('owner');
    await exitWith(root, '1111');
    expect(app.kioskLock).toBe(true);
  });

  it('keeps staff in, whose devices never hold the PIN', async () => {
    const root = await openKiosk('staff');
    await exitWith(root, '4321');
    expect(app.kioskLock).toBe(true);
  });
});

describe('kiosk lock and turning on staff and family access', () => {
  it('keeps the director\'s tablet locked once their school runs through its server', async () => {
    Object.assign(app, { demo: false, user: { username: 'director', uuid: 'u1' }, team: null });
    const { setKioskLock } = await import('../src/app.js');
    setKioskLock(true);
    // Access turned on from the director's laptop; the tablet reloads.
    app.team = { url: 'https://school.puter.work', role: 'owner' };
    expect(restoreKioskLock()).toBe(true);
  });
});

describe('kiosk lock for someone who is now a family member there', () => {
  it('is not restored, since families cannot open the kiosk and could never leave it', async () => {
    Object.assign(app, { demo: false, user: { username: 'sam', uuid: 'u7' }, team: { url: 'https://school.puter.work', role: 'staff' } });
    const { setKioskLock } = await import('../src/app.js');
    setKioskLock(true);
    // Removed as staff, then invited back to the same school as a parent.
    app.team = { url: 'https://school.puter.work', role: 'parent' };
    expect(restoreKioskLock()).toBe(false);
  });
});
