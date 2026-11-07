// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../src/lib/store.js';
import { securitiesView } from '../src/views/securities.js';
import { puterBackend } from './helpers/puter-kv.js';

let warrant;
let grant;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-10T12:00:00'));
  puterBackend().install();
  await store.init();
  const cls = await store.addClass({ name: 'Common', kind: 'common' });
  const holder = await store.addStakeholder({ name: 'Holder' });
  warrant = await store.addSecurity({ kind: 'warrant', classId: cls.id, stakeholderId: holder.id, quantity: 100, strike: 2, date: '2024-01-01', expires: '2030-01-01' });
  grant = await store.addSecurity({ kind: 'option', stakeholderId: holder.id, quantity: 100, strike: 1, grantDate: '2024-01-01', vestingMonths: 0, cliffMonths: 0 });
});
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });
// By the label cell: an exercise certificate's row names the warrant it came off too.
const row = (view, label) => [...view.querySelectorAll('tbody tr')].find((r) => r.querySelector('td').textContent.startsWith(label));
const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();

describe('the register and exercises dated ahead', () => {
  it('keeps the tense of an exercise the cap table does not count yet', async () => {
    await store.exerciseWarrant(warrant.id, { quantity: 40, date: '2025-01-01' });
    await store.exerciseWarrant(warrant.id, { quantity: 25, date: '2026-10-10' });
    await store.exerciseOption(grant.id, { quantity: 20, date: '2026-10-10', classId: store.classes[0].id });
    const view = securitiesView();
    expect(text(row(view, warrant.label))).toContain('40 exercised');
    expect(text(row(view, warrant.label))).toContain('25 exercised as of Oct 10, 2026');
    const opt = text(row(view, grant.label));
    expect(opt).toContain('20 exercised as of Oct 10, 2026');
    expect(opt).toContain('Partially exercised as of Oct 10, 2026');
    expect(opt).not.toMatch(/(^|\D)20 exercised(?! as of)/);
  });

  it('says a warrant is fully exercised as of a day still ahead', async () => {
    await store.exerciseWarrant(warrant.id, { quantity: 100, date: '2026-10-10' });
    const view = securitiesView();
    expect(text(row(view, warrant.label))).toContain('Fully exercised as of Oct 10, 2026');
    await store.exerciseOption(grant.id, { quantity: 100, date: '2025-01-01', classId: store.classes[0].id });
    const again = securitiesView();
    expect(text(row(again, grant.label))).toContain('100 exercised');
    expect(text(row(again, grant.label))).toContain('Fully exercised');
    expect(text(row(again, grant.label))).not.toContain('as of');
  });
});
