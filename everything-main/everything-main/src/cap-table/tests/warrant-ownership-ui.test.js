// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/util.js', async (original) => ({ ...await original(), downloadFile: vi.fn() }));
import { store } from '../src/lib/store.js';
import { downloadFile } from '../src/lib/util.js';
import { capTableView } from '../src/views/captable.js';
import { puterBackend } from './helpers/puter-kv.js';

let warrant;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-10T12:00:00'));
  puterBackend().install();
  await store.init();
  const cls = await store.addClass({ name: 'Common', kind: 'common' });
  const holder = await store.addStakeholder({ name: 'Holder' });
  warrant = await store.addSecurity({ kind: 'warrant', classId: cls.id, stakeholderId: holder.id,
    quantity: 100, strike: 2, date: '2024-01-01', expires: '2027-01-01' });
});
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.clearAllMocks(); });
const button = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const row = (view, label) => [...view.querySelectorAll('.no-print tbody tr')].find((r) => r.textContent.includes(label));
const numbers = (row) => [...row.querySelectorAll('td.num')].map((c) => c.textContent);
const show = () => { const view = capTableView(); document.body.append(view); return view; };
const asOf = (view, date) => {
  const input = view.querySelector('.asof-input');
  input.value = date;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('warrant rows reconcile to ownership totals', () => {
  it('nets partial exercises and cancellations on screen, in CSV and in the printed report', async () => {
    const certificate = await store.exerciseWarrant(warrant.id, { quantity: 40, date: '2025-01-01' });
    await store.cancelWarrant(warrant.id, { quantity: 20, date: '2025-03-01' });
    const view = show();
    expect(numbers(row(view, warrant.label))).toEqual(['40', '50.00%']);
    expect(numbers(row(view, certificate.label))).toEqual(['40', '50.00%']);
    expect(view.textContent).toContain('Warrants · 40');
    button(view, 'Export CSV').click();
    const csv = downloadFile.mock.calls.at(-1)[1];
    expect(csv.split('\r\n').find((r) => r.includes(warrant.label))).toContain(',40,2,,50.0000');
    window.dispatchEvent(new Event('beforeprint'));
    const print = view.querySelector('.print-only');
    const printedWarrants = [...print.querySelectorAll('tr')].find((r) => r.textContent.startsWith('Warrants'));
    expect(printedWarrants.textContent).toContain('40');
    expect(printedWarrants.textContent).toContain('50.00%');
  });

  it.each(['exercised', 'cancelled', 'expired'])('omits a warrant with no rights left after it is %s', async (state) => {
    if (state === 'exercised') await store.exerciseWarrant(warrant.id, { quantity: 100, date: '2025-01-01' });
    if (state === 'cancelled') await store.cancelWarrant(warrant.id, { quantity: 100, date: '2025-01-01' });
    if (state === 'expired') await store.updateSecurity(warrant.id, { expires: '2025-12-31' });
    const view = show();
    expect(row(view, warrant.label)).toBeUndefined();
    expect(view.textContent).not.toContain('Warrants ·');
    if (state !== 'exercised') {
      expect(view.textContent).toContain('Nothing outstanding');
      expect(button(view, 'Export CSV').disabled).toBe(true);
      expect(button(view, 'Print report').disabled).toBe(true);
    }
  });

  it('shows the rights on the selected date, including the last day before expiration', async () => {
    await store.exerciseWarrant(warrant.id, { quantity: 40, date: '2025-01-01' });
    await store.cancelWarrant(warrant.id, { quantity: 20, date: '2025-03-01' });
    await store.updateSecurity(warrant.id, { expires: '2025-12-31' });
    const view = show();
    for (const [date, expected] of [
      ['2024-12-31', ['100', '100.00%']], ['2025-01-01', ['60', '60.00%']],
      ['2025-03-01', ['40', '50.00%']], ['2025-12-31', ['40', '50.00%']],
    ]) {
      asOf(view, date);
      expect(numbers(row(view, warrant.label))).toEqual(expected);
    }
    asOf(view, '2026-01-01');
    expect(row(view, warrant.label)).toBeUndefined();
  });
});
