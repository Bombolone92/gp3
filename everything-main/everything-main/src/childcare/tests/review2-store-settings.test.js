/**
 * Second review: two devices changing different settings.
 */
import { describe, it, expect, vi } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

describe('settings changed on two devices', () => {
  it('keeps both changes when one device was offline (the retry sends without syncing first)', async () => {
    vi.useFakeTimers();
    try {
      const backend = createMemoryBackend();
      const office = createStore({ backend, flushDelay: 0 });
      const tablet = createStore({ backend, flushDelay: 0 });
      await office.init();
      await tablet.init();
      backend.setFailing(true);
      tablet.saveSettings({ mealTypes: ['Breakfast', 'Lunch'] });
      await vi.advanceTimersByTimeAsync(10);
      expect(tablet.state.online).toBe(false);
      backend.setFailing(false);
      // Meanwhile the director sets a new kiosk PIN at the office.
      office.saveSettings({ kioskPinHash: 'new-pin' });
      await office.flush();
      await vi.advanceTimersByTimeAsync(3000); // the tablet's retry
      expect(tablet.pendingCount()).toBe(0);
      const saved = await backend.loadSettings();
      expect(saved.kioskPinHash).toBe('new-pin');
      expect(saved.mealTypes).toEqual(['Breakfast', 'Lunch']);
      await vi.advanceTimersByTimeAsync(10);
      expect(tablet.state.settings.kioskPinHash).toBe('new-pin');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the other device\'s change when a sync lands while a change here is unsent', async () => {
    const backend = createMemoryBackend();
    const office = createStore({ backend, flushDelay: 0 });
    const tablet = createStore({ backend, flushDelay: 60_000 });
    await office.init();
    await tablet.init();
    tablet.saveSettings({ billing: { dueDays: 14 } });
    office.saveSettings({ school: { name: 'Acorn' } });
    await office.flush();
    await tablet.sync();
    expect(tablet.state.settings.school.name).toBe('Acorn');
    expect(tablet.state.settings.billing.dueDays).toBe(14);
    await tablet.flush();
    const saved = await backend.loadSettings();
    expect(saved.school.name).toBe('Acorn');
    expect(saved.billing.dueDays).toBe(14);
  });

  it('replays an unsent settings change from the offline cache on top of newer server settings', async () => {
    let snap = null;
    const cache = { load: async () => snap, save: async (s) => void (snap = structuredClone(s)) };
    const backend = createMemoryBackend();
    const office = createStore({ backend, flushDelay: 0 });
    await office.init();
    backend.setFailing(true);
    const tablet = createStore({ backend, cache, flushDelay: 0 });
    await tablet.init();
    tablet.saveSettings({ weekStart: 1 });
    await new Promise((r) => setTimeout(r, 700));
    backend.setFailing(false);
    office.saveSettings({ school: { name: 'Acorn' } });
    await office.flush();
    const reopened = createStore({ backend, cache, flushDelay: 0 });
    await reopened.init();
    await reopened.flush();
    const saved = await backend.loadSettings();
    expect(saved.weekStart).toBe(1);
    expect(saved.school.name).toBe('Acorn');
  });
});
