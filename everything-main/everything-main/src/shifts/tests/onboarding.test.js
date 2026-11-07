import { describe, it, expect, beforeEach } from 'vitest';
import { shouldOnboard } from '../src/ui/onboarding.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

let store;

beforeEach(async () => {
  store = createStore(createMemoryBackend());
  await store.init();
});

describe('shouldOnboard', () => {
  it('is true on a fresh, empty dataset', () => {
    expect(shouldOnboard(store)).toBe(true);
  });

  it('is false once onboarding was completed or skipped', async () => {
    await store.updateSettings({ onboarded: true });
    expect(shouldOnboard(store)).toBe(false);
  });

  it('is false while sample data is installed', async () => {
    await store.loadSampleData({ employees: [], shifts: [] });
    expect(shouldOnboard(store)).toBe(false);
  });

  it('is false as soon as there is real data, even without the flag', async () => {
    await store.addEmployee({ name: 'Ava' });
    expect(shouldOnboard(store)).toBe(false);
  });
});
