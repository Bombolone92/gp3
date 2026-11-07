// @vitest-environment jsdom
/** First-run setup and the sample fleet. */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { polyfill, freshStore, settle } from './review-vehicles-setup.js';
import { app } from '../src/app.js';
import { maybeOnboard } from '../src/views/onboarding.js';

beforeAll(polyfill);

describe('first-run units follow the browser locale', () => {
  const setLang = (l) => Object.defineProperty(navigator, 'language', { value: l, configurable: true });
  afterEach(() => setLang('en-US'));

  const units = async (lang) => {
    setLang(lang);
    await freshStore();
    maybeOnboard();
    await settle();
    const dlg = document.querySelector('dialog[open]');
    return [dlg.querySelector('#ob-dist').value, dlg.querySelector('#ob-vol').value];
  };

  it('suggests kilometers and liters in Germany', async () => {
    expect(await units('de-DE')).toEqual(['km', 'L']);
  });

  it('suggests miles and liters in the UK', async () => {
    expect(await units('en-GB')).toEqual(['mi', 'L']);
  });

  it('suggests miles and gallons in the US', async () => {
    expect(await units('en-US')).toEqual(['mi', 'gal']);
  });
});

describe('adding and removing the sample fleet', () => {
  let sd;
  beforeEach(async () => {
    await freshStore({ demo: false });
    sd = await import('../src/views/sample-data.js');
  });

  it('numbers sample issues, work orders, and purchase orders after the fleet\'s own', () => {
    for (const n of [1, 2, 3]) app.store.put('issues', { number: n, summary: `Mine ${n}`, status: 'open' });
    app.store.put('workOrders', { number: 7, status: 'open' });
    app.store.put('purchaseOrders', { number: 2, status: 'draft' });
    sd.loadSampleData();
    for (const coll of ['issues', 'workOrders', 'purchaseOrders']) {
      const nums = app.store.all(coll).map((r) => r.number);
      expect(new Set(nums).size, coll).toBe(nums.length);
    }
    expect(Math.min(...app.store.all('issues').filter((r) => r.sample).map((r) => r.number))).toBe(4);
    expect(Math.min(...app.store.all('workOrders').filter((r) => r.sample).map((r) => r.number))).toBe(8);
  });

  it('removes only sample records, keeping the fleet\'s own', () => {
    const mine = app.store.put('vehicles', { name: 'My truck', archived: false });
    sd.loadSampleData();
    expect(sd.sampleCount()).toBeGreaterThan(50);
    sd.removeSampleData();
    expect(sd.sampleCount()).toBe(0);
    expect(app.store.all('vehicles').map((v) => v.id)).toEqual([mine.id]);
  });

  it('takes away the sample groups and fleet name it added, unless they are in use', () => {
    app.store.saveSettings({ groups: [{ id: 'g-mine', name: 'Depot' }] });
    sd.loadSampleData();
    expect(app.settings().company.name).toBe('Riverside Logistics');
    expect(app.settings().groups.length).toBe(4);
    // One of the fleet's own vehicles was put in a sample group meanwhile.
    app.store.put('vehicles', { name: 'My truck', groupId: 'g-south', archived: false });
    sd.removeSampleData();
    expect(app.settings().groups.map((g) => g.id)).toEqual(['g-mine', 'g-south']);
    expect(app.settings().company.name).toBe('');
  });

  it('keeps a fleet name the user chose', () => {
    app.store.saveSettings({ company: { name: 'Acme Haulage' } });
    sd.loadSampleData();
    sd.removeSampleData();
    expect(app.settings().company.name).toBe('Acme Haulage');
  });
});
