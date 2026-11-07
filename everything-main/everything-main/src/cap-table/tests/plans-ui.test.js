import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { classesView, openClassForm } from '../src/views/classes.js';
import { openSecurityForm } from '../src/ui/securityform.js';
import { openCloseRound } from '../src/ui/closeround.js';
import { openSplitForm } from '../src/ui/split.js';
import { modelRound, grantVested } from '../src/lib/captable.js';
import { openPlanForm, openPlanLedger, openTransferReserveForm } from '../src/ui/planform.js';
import { openExerciseForm, openCertifyForm, openCancelForm, openGrantActions } from '../src/ui/grantactions.js';
import { openDepartureFlow } from '../src/ui/departure.js';
import { store } from '../src/lib/store.js';
import { puterBackend } from './helpers/puter-kv.js';

let dom;
let holder;
let old;
let next;
beforeEach(async () => {
  dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/#/classes', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'location', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'requestAnimationFrame']) {
    vi.stubGlobal(name, dom.window[name]);
  }
  puterBackend().install();
  await store.init();
  const cls = await store.addClass({ name: 'Common Stock', kind: 'common' });
  holder = await store.addStakeholder({ name: 'Grace', kind: 'employee' });
  old = await store.addPlan({ name: '2024 Equity Incentive Plan', adopted: '2024-01-01', classId: cls.id, reserve: 100_000 });
  next = await store.addPlan({ name: '2026 Equity Incentive Plan', adopted: '2026-01-01', classId: cls.id, reserve: 50_000 });
  await store.addSecurity({ kind: 'option', stakeholderId: holder.id, planId: old.id, quantity: 40_000, strike: 1, date: '2024-07-01', vestingMonths: 0 });
});
afterEach(async () => {
  // Close through the UI so subscriptions are removed, and let exit animations
  // finish before destroying the document their callbacks still use.
  for (const sheet of [...document.querySelectorAll('.modal-root:not(.closing)')].reverse()) {
    sheet.querySelector('button[aria-label="Close"]')?.click();
  }
  await vi.waitFor(() => expect(document.querySelectorAll('.modal-root')).toHaveLength(0));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  dom.window.close();
});

const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();
const byLabel = (root, label) => {
  const l = [...root.querySelectorAll('.field-label')].find((x) => x.textContent.trim() === label);
  return l ? document.getElementById(l.htmlFor) : null;
};
const dialog = () => [...document.querySelectorAll('.modal-root')].at(-1);

describe('closing a round with equity plans', () => {
  it('offers RSU-only plans as destinations for a reserve top-up', async () => {
    await store.updatePlan(next.id, { awardTypes: ['rsu'] });
    const terms = { preMoney: 1_000_000, investment: 100_000, poolPct: 0.8, asOf: '2026-03-01' };
    const result = modelRound(store.db, terms);
    expect(result.poolAdd).toBeGreaterThan(0);
    openCloseRound({ terms, result });
    const select = byLabel(dialog(), 'Pool top-up goes into');
    expect(select).not.toBeNull();
    expect([...select.options].map((option) => option.value)).toEqual([old.id, next.id]);
    expect(select.value).toBe(next.id);
  });

  it.each(['retirement', 'outside award'])('refuses a stale model after %s changes fully diluted shares', async (change) => {
    const terms = { preMoney: 1_000_000, investment: 100_000, poolPct: 0, asOf: '2026-03-01' };
    openCloseRound({ terms, result: modelRound(store.db, terms) });
    const sheet = dialog();
    if (change === 'retirement') await store.retirePlan(next.id, { date: '2026-02-01' });
    else await store.updateSecurity(store.securities.find((s) => s.kind === 'option').id, { outsidePlan: true });
    [...sheet.querySelectorAll('button')].find((b) => b.textContent.includes('Review')).click();
    expect(sheet.classList.contains('closing')).toBe(true);
  });
});

describe('equity plans on the Share classes page', () => {
  it('shows the correct split reserve after a zero-reserve plan', async () => {
    await store.updateSecurity(store.securities.find((s) => s.kind === 'option').id, { outsidePlan: true });
    await store.resizePlanReserve(old.id, { size: 0, date: '2026-02-01' });
    openSplitForm();
    const row = [...dialog().querySelectorAll('.round-metric')].find((r) => r.textContent.includes(next.name));
    expect(text(row)).toContain('50,000 → 500,000');
  });

  it('preserves an existing recycling destination after the destination is retired', async () => {
    await store.updatePlan(old.id, { recycling: { cancellation: next.id } });
    await store.retirePlan(next.id, { date: '2026-02-01' });
    openPlanForm(store.plan(old.id));
    const sheet = dialog();
    expect(byLabel(sheet, 'Cancellation').value).toBe(next.id);
    byLabel(sheet, 'Name').value = 'Renamed plan';
    sheet.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(store.plan(old.id).name).toBe('Renamed plan'));
    await vi.waitFor(() => expect(sheet.classList.contains('closing')).toBe(true));
    expect(store.plan(old.id).recycling.cancellation).toBe(next.id);
  });

  it('lists every plan with its balances, the aggregate, and the actions that keep them', () => {
    const root = classesView({ navigate: () => {} });
    document.querySelector('#app').append(root);
    const table = root.querySelector('[aria-label="Equity plans table"]');
    const rows = [...table.querySelectorAll('tbody tr')].map((r) => [...r.children].slice(0, 5).map(text));
    expect(rows[0].slice(1)).toEqual(['Active', '100,000', '40,0001 award', '60,000']);
    expect(rows[0][0]).toContain('2024 Equity Incentive Plan');
    expect(rows[0][0]).toContain('Adopted Jan 1, 2024');
    expect(rows[1].slice(1)).toEqual(['Active', '50,000', '0', '50,000']);
    expect([...table.querySelectorAll('tfoot td')].map(text)).toEqual(['All plans', '150,000', '40,000', '110,000', '']);
    expect(text(root.querySelector('.view-sub'))).toBe('Common, preferred, and the equity plans');
    const card = [...root.querySelectorAll('.card')].find((c) => c.querySelector('.card-title')?.textContent === 'Equity plans');
    expect(text(card.querySelector('.card-sub'))).toBe('150,000 reserved · 40,000 committed · 110,000 unallocated');
    for (const label of ['Movements of 2024 Equity Incentive Plan', 'Resize the reserve of 2024 Equity Incentive Plan',
      'Retire 2024 Equity Incentive Plan', 'Edit 2024 Equity Incentive Plan']) {
      expect(root.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    }
    // A plan with awards cannot be deleted from the row; the empty one can.
    expect(root.querySelector('[aria-label="Delete 2024 Equity Incentive Plan"]').disabled).toBe(true);
    expect(root.querySelector('[aria-label="Delete 2026 Equity Incentive Plan"]').disabled).toBe(false);
    expect([...root.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Move shares')).toBe(true);
  });

  it('refuses an unnamed plan on the adopt sheet before anything is written', () => {
    const root = classesView({ navigate: () => {} });
    document.querySelector('#app').append(root);
    [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add plan').click();
    const sheet = dialog();
    expect(sheet.querySelector('[role="dialog"]').getAttribute('aria-label')).toBe('Adopt an equity plan');
    expect([...sheet.querySelectorAll('.field-label')].map((l) => l.textContent)).toEqual(expect.arrayContaining(
      ['Name', 'Adopted', 'Expires', 'Underlying share class', 'Shares reserved', 'Cancellation', 'Transfer']));
    // The cancellation rule offers the two standing choices and each other plan.
    expect([...byLabel(sheet, 'Cancellation').options].map((o) => o.textContent)).toEqual([
      'Return to this plan', 'Leave the reserve for good', 'Pour over into 2024 Equity Incentive Plan', 'Pour over into 2026 Equity Incentive Plan',
    ]);
    const before = store.company.plans.length;
    sheet.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    expect(byLabel(sheet, 'Name').getAttribute('aria-invalid')).toBe('true');
    expect(store.company.plans).toHaveLength(before);
  });

  it('explains a plan’s balances as an opening figure and dated movements that reconcile', () => {
    openPlanLedger(store.plan(old.id));
    const sheet = dialog();
    expect(text(sheet)).toContain('Opening 0 authorized and 0 committed, plus every movement below, comes to exactly the 100,000 authorized and 40,000 committed');
    const rows = [...sheet.querySelectorAll('tbody tr')].map((r) => [...r.children].map(text));
    expect(rows).toEqual([
      ['Jan 1, 2024', 'Reserve at adoption', 'Reserve', '+100,000', '', '100,000'],
      ['Jul 1, 2024', 'OPT-1: grantedDrawn from the plan', 'Grant', '', '+40,000', '60,000'],
    ]);
  });

  it('offers a transfer between plans and says what the source can spare', () => {
    openTransferReserveForm({ from: store.plan(old.id) });
    const sheet = dialog();
    expect(text(sheet)).toContain('2024 Equity Incentive Plan has 60,000 available today');
    expect([...byLabel(sheet, 'To').options].map((o) => o.textContent)).toEqual(['2024 Equity Incentive Plan', '2026 Equity Incentive Plan']);
  });
});

describe('the exercise sheets and the plan’s share class', () => {
  it.each([
    ['exercise', openExerciseForm],
    ['certificate', openCertifyForm],
  ])('proposes the class the grant’s plan names on the %s sheet, and common for a grant outside any plan', async (_, open) => {
    const grant = store.securities.find((s) => s.kind === 'option');
    const classB = await store.addClass({ name: 'Class B Common', kind: 'common' });
    await store.updatePlan(old.id, { classId: classB.id });
    open(store.security(grant.id));
    expect(byLabel(dialog(), 'Share class').value).toBe(classB.id);
    dialog().querySelector('.icon-btn')?.click();
    // A grant drawing no plan keeps the first common class.
    await store.updateSecurity(grant.id, { outsidePlan: true });
    open(store.security(grant.id));
    expect(byLabel(dialog(), 'Share class').value).toBe(store.classes.find((c) => c.kind === 'common').id);
  });
});

describe('the cancel sheet and the plan’s rules', () => {
  it('keeps a partially cancelled grant vesting and permits its later exercise through the forms', async () => {
    const grant = await store.addSecurity({ kind: 'option', stakeholderId: holder.id, planId: old.id,
      quantity: 4800, strike: 1, date: '2024-01-01', vestingMonths: 48, cliffMonths: 12 });
    openCancelForm(store.security(grant.id));
    const cancelSheet = dialog();
    expect(text(cancelSheet)).toContain('Partial cancellations remove the last unvested installments');
    byLabel(cancelSheet, 'Cancellation date').value = '2025-01-01';
    byLabel(cancelSheet, 'Options cancelled').value = '100';
    byLabel(cancelSheet, 'Options cancelled').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(text(cancelSheet)).toContain('4,700 stay outstanding');
    cancelSheet.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(store.security(grant.id).cancelled).toBe(100));
    await vi.waitFor(() => expect(cancelSheet.isConnected).toBe(false));
    expect(grantVested(store.security(grant.id), '2026-01-01')).toBe(2400);
    openExerciseForm(store.security(grant.id));
    const exerciseSheet = dialog();
    byLabel(exerciseSheet, 'Options exercised').value = '2000';
    byLabel(exerciseSheet, 'Exercise date').value = '2026-01-01';
    exerciseSheet.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(store.security(grant.id).exercised).toBe(2000));
    expect(store.securities.find((s) => s.fromOptionId === grant.id).quantity).toBe(2000);
    await vi.waitFor(() => expect(exerciseSheet.isConnected).toBe(false));
  });

  it('names the expiration rule on the day the window closed and the cancellation rule on any other day', async () => {
    await store.updatePlan(old.id, { recycling: { expiration: 'return', cancellation: 'retire' } });
    const grant = await store.addSecurity({
      kind: 'option', stakeholderId: holder.id, planId: old.id, quantity: 1000, strike: 1, date: '2024-07-01', vestingMonths: 0, expires: '2025-01-01',
    });
    openCancelForm(store.security(grant.id));
    const sheet = dialog();
    const summary = () => [...sheet.querySelectorAll('p.field-hint')].map(text).find((s) => s.includes('stay outstanding'));
    expect(byLabel(sheet, 'Cancellation date').value).toBe('2025-01-01');
    expect(summary()).toContain('return to 2024 Equity Incentive Plan');
    byLabel(sheet, 'Cancellation date').value = '2024-12-01';
    byLabel(sheet, 'Cancellation date').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(summary()).toContain('stay drawn from 2024 Equity Incentive Plan');
  });
});

describe('sheets that forfeit shares say where the plan sends them', () => {
  it('reads the plan’s rule on the grant actions sheet and the departure sheet', async () => {
    await store.updatePlan(old.id, { recycling: { cancellation: next.id } });
    const grant = store.securities.find((s) => s.kind === 'option');
    openGrantActions(store.security(grant.id));
    expect(text(dialog())).toContain('Unvested options pour over into 2026 Equity Incentive Plan');
    dialog().querySelector('.icon-btn')?.click();
    await store.addSecurity({
      kind: 'option', stakeholderId: holder.id, planId: old.id, quantity: 4800, strike: 1, date: '2024-07-01', vestingMonths: 48, cliffMonths: 0,
    });
    openDepartureFlow(holder);
    expect(text(dialog())).toContain('are cancelled and pour over into 2026 Equity Incentive Plan');
    expect(text(dialog())).not.toContain('to the pool');
    dialog().querySelector('.icon-btn')?.click();
    await store.updateSecurity(grant.id, { outsidePlan: true });
    openGrantActions(store.security(grant.id));
    expect(text(dialog())).toContain('Unvested options return to no reserve, as the grant is outside any plan');
  });
});

describe('the award sheet’s plan picker', () => {
  it('refuses enlarging an old grant into a reserve that was not available on its date', async () => {
    const grant = store.securities.find((s) => s.kind === 'option');
    await store.resizePlanReserve(old.id, { size: 200_000, date: '2025-01-01' });
    openSecurityForm({ existing: store.security(grant.id) });
    const save = vi.spyOn(store, 'updateSecurity');
    const sheet = dialog();
    byLabel(sheet, 'Options granted').value = '150,000';
    sheet.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    expect(byLabel(sheet, 'Options granted').getAttribute('aria-invalid')).toBe('true');
    expect(save).not.toHaveBeenCalled();
    expect(store.security(grant.id).quantity).toBe(40_000);
  });

  it('does not treat retired cancellations as available when enlarging an award', async () => {
    const grant = store.securities.find((s) => s.kind === 'option');
    await store.updatePlan(old.id, { recycling: { cancellation: 'retire' } });
    await store.updateSecurity(grant.id, { cancellations: [{ quantity: 20_000, date: '2026-02-01' }] });
    await store.resizePlanReserve(old.id, { size: 40_000, date: '2026-03-01' });
    openSecurityForm({ existing: store.security(grant.id) });
    const save = vi.spyOn(store, 'updateSecurity').mockResolvedValue(store.security(grant.id));
    const sheet = dialog();
    byLabel(sheet, 'Options granted').value = '60,000';
    sheet.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    expect(byLabel(sheet, 'Options granted').getAttribute('aria-invalid')).toBe('true');
    expect(save).not.toHaveBeenCalled();
    expect(store.security(grant.id).quantity).toBe(40_000);
  });

  it('allows an enlarged award to use shares returned by exercise', async () => {
    const grant = store.securities.find((s) => s.kind === 'option');
    await store.updatePlan(old.id, { recycling: { exercise: 'return' } });
    await store.exerciseOption(grant.id, { quantity: 20_000, date: '2026-02-01', classId: old.classId });
    await store.resizePlanReserve(old.id, { size: 40_000, date: '2026-03-01' });
    openSecurityForm({ existing: store.security(grant.id) });
    const sheet = dialog();
    byLabel(sheet, 'Options granted').value = '60,000';
    sheet.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    expect(byLabel(sheet, 'Options granted').getAttribute('aria-invalid')).not.toBe('true');
    await vi.waitFor(() => expect(store.security(grant.id).quantity).toBe(60_000));
    await vi.waitFor(() => expect(sheet.classList.contains('closing')).toBe(true));
  });

  it('lists the plans that could hold the award on its date, proposes the newest, and follows the date', () => {
    openSecurityForm({ kind: 'option' });
    const sheet = dialog();
    const plan = byLabel(sheet, 'Plan');
    expect([...plan.options].map((o) => o.textContent + (o.selected ? '*' : ''))).toEqual([
      '2024 Equity Incentive Plan', '2026 Equity Incentive Plan*', 'Outside any plan',
    ]);
    expect(text(sheet)).toContain('50,000 of 50,000 available in this plan');
    // Dated before the 2026 plan was adopted, only the 2024 plan could hold it.
    const date = byLabel(sheet, 'Grant date');
    date.value = '2025-03-01';
    date.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect([...plan.options].map((o) => o.textContent + (o.selected ? '*' : ''))).toEqual([
      '2024 Equity Incentive Plan*', 'Outside any plan',
    ]);
    expect(text(sheet)).toContain('60,000 of 100,000 available in this plan');
    plan.value = '';
    plan.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(text(sheet)).toContain('draws no plan reserve');
  });

  it('holds a new award to its plan’s available reserve before saving', async () => {
    openSecurityForm({ kind: 'option' });
    const sheet = dialog();
    byLabel(sheet, 'Stakeholder').value = holder.id;
    byLabel(sheet, 'Options granted').value = '50,001';
    byLabel(sheet, 'Vesting (months)').value = '0';
    const before = store.securities.length;
    sheet.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(byLabel(sheet, 'Options granted').getAttribute('aria-invalid')).toBe('true');
    expect(store.securities).toHaveLength(before);
    byLabel(sheet, 'Options granted').value = '50,000';
    sheet.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 100 && store.securities.length === before; i++) await new Promise((r) => setTimeout(r, 5));
    expect(store.securities).toHaveLength(before + 1);
    expect(store.securities.at(-1).planId).toBe(next.id);
    await vi.waitFor(() => expect(sheet.classList.contains('closing')).toBe(true));
  });
});

describe('the classes page and records dated ahead', () => {
  it('pluralizes "security" as securities', async () => {
    for (const date of ['2027-01-01', '2027-02-01']) {
      await store.addSecurity({ kind: 'option', stakeholderId: holder.id, planId: next.id, quantity: 10, strike: 1, date, vestingMonths: 0 });
    }
    const view = classesView({ navigate: vi.fn() });
    expect(view.textContent).toContain('2 securities are dated after today');
    expect(view.textContent).not.toContain('securitys');
  });
});

describe('the class form and the shares already issued', () => {
  it('says when the authorized count typed is under what the class has issued', async () => {
    const cls = store.classes[0];
    await store.updateClass(cls.id, { authorized: 5000 });
    await store.addSecurity({ kind: 'shares', stakeholderId: holder.id, classId: cls.id, quantity: 3400, pricePerShare: 1, date: '2024-01-01' });
    openClassForm(store.shareClass(cls.id));
    const sheet = dialog();
    const warning = () => [...sheet.querySelectorAll('.field-hint.warn[role="status"]')].find((n) => n.textContent.includes('issued'));
    expect(warning()).toBeUndefined();
    const auth = byLabel(sheet, 'Authorized shares');
    auth.value = '100';
    auth.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const note = warning();
    expect(note.style.display).toBe('');
    expect(text(note)).toBe('Common Stock has 3,400 shares issued, 3,300 more than this count. They read as over authorized until the count is raised; that is what a charter amendment is for.');
    auth.value = '3,400';
    auth.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(note.style.display).toBe('none');
    expect(note.textContent).toBe('');
  });
});
