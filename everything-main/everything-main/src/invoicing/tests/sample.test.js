import { describe, it, expect, beforeEach } from 'vitest';
import { store, DEFAULT_SETTINGS } from '../src/lib/store.js';
import { sampleDataset, wipeSampleData } from '../src/lib/sample.js';

/* The same stand-in for Puter that backup.test.js uses, so the wipe can be
   exercised through the real store. */
const kv = new Map();
const files = new Map();
globalThis.puter = {
  auth: { getUser: async () => ({ username: 'test' }) },
  kv: {
    get: async (k) => (kv.has(k) ? kv.get(k) : null),
    set: async (k, v) => { kv.set(k, v); return true; },
  },
  fs: {
    read: async (path) => {
      if (!files.has(path)) {
        const err = new Error('not found');
        err.code = 'subject_does_not_exist';
        throw err;
      }
      return { text: async () => files.get(path) };
    },
    write: async (path, data) => { files.set(path, data); return { path }; },
    delete: async (path) => { files.delete(path); },
  },
};

beforeEach(() => {
  kv.clear();
  files.clear();
});

describe('wipeSampleData', () => {
  it('empties the account but keeps theme, currency, and the share site', async () => {
    await store.importAll({
      ...sampleDataset({ settings: { ...DEFAULT_SETTINGS } }),
      settings: {
        ...DEFAULT_SETTINGS, theme: 'dark', currency: 'EUR',
        share: { subdomain: 'inv-test' }, sampleData: true, onboarded: true,
      },
    });
    expect(store.docs().length).toBeGreaterThan(0);
    await wipeSampleData(store);
    expect(store.docs()).toEqual([]);
    expect(store.clients).toEqual([]);
    expect(store.recurring).toEqual([]);
    expect(store.settings.sampleData).toBe(false);
    expect(store.settings.onboarded).toBe(false);
    expect(store.settings.theme).toBe('dark');
    expect(store.settings.currency).toBe('EUR');
    expect(store.settings.share).toEqual({ subdomain: 'inv-test' });
  });

  it('takes a shared sample page offline before dropping its token', async () => {
    await store.importAll({
      app: 'invoicing',
      version: 1,
      settings: { ...DEFAULT_SETTINGS, sampleData: true, share: { subdomain: 'inv-test' } },
      clients: [],
      items: [],
      recurring: [],
      docs: {
        2026: [{
          id: 'd1', kind: 'invoice', number: 'INV-0001', clientId: '',
          issueDate: '2026-01-05', dueDate: '2026-01-19', currency: 'USD',
          items: [], payments: [], status: 'sent', shareToken: 'sampletoken123',
        }],
      },
    });
    files.set('invoicing-data/public/sampletoken123.html', '<!doctype html>');
    await wipeSampleData(store);
    expect(files.has('invoicing-data/public/sampletoken123.html')).toBe(false);
    expect(store.docs()).toEqual([]);
  });
});
