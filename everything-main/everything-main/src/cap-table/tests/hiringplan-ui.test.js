import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { openHireForm } from '../src/ui/hiringplan.js';
import { store } from '../src/lib/store.js';
import { puterBackend } from './helpers/puter-kv.js';

let dom;
beforeEach(async () => {
  dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/#/classes', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'location', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'requestAnimationFrame']) {
    vi.stubGlobal(name, dom.window[name]);
  }
  puterBackend().install();
  await store.init();
  const cls = await store.addClass({ name: 'Common', kind: 'common' });
  const holder = await store.addStakeholder({ name: 'Founder', kind: 'founder' });
  await store.addSecurity({ kind: 'shares', stakeholderId: holder.id, classId: cls.id, quantity: 100_000, pricePerShare: 1, date: '2024-01-01' });
  await store.addPlan({ name: 'Plan', adopted: '2024-01-01', classId: cls.id, reserve: 40_000 });
});
afterEach(async () => {
  for (const sheet of [...document.querySelectorAll('.modal-root:not(.closing)')].reverse()) {
    sheet.querySelector('button[aria-label="Close"]')?.click();
  }
  await vi.waitFor(() => expect(document.querySelectorAll('.modal-root')).toHaveLength(0));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  dom.window.close();
});
const dialog = () => [...document.querySelectorAll('.modal-root')].at(-1);

describe('the hire sheet names the base a percentage is measured against', () => {
  it('says when records dated ahead are in the figure', async () => {
    openHireForm();
    expect(dialog().textContent).toContain('Measured against the 140,000 fully diluted shares on record');
    expect(dialog().textContent).not.toContain('dated after today');
    dialog().querySelector('button[aria-label="Close"]').click();
    const future = new Date(Date.now() + 20 * 86400e3).toISOString().slice(0, 10);
    const holder = store.stakeholders[0];
    await store.addSecurity({ kind: 'option', stakeholderId: holder.id, planId: store.plans[0].id, quantity: 8_000, strike: 1, date: future, vestingMonths: 0 });
    openHireForm();
    // The grant draws the plan on its date, so the fully diluted figure does not move; the words say what is in it.
    expect(dialog().textContent).toContain('140,000 fully diluted shares on record, one dated after today included');
    expect(dialog().textContent).not.toContain('today’s');
  });
});
