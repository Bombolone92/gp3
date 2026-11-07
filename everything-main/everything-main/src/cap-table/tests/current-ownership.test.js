// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/util.js', async (original) => ({ ...await original(), downloadFile: vi.fn() }));
vi.mock('../src/ui/securityform.js', () => ({ openSecurityForm: vi.fn(), ensureShareClass: vi.fn() }));
vi.mock('../src/ui/grantactions.js', async (original) => ({ ...await original(), openGrantActions: vi.fn(), openRsuActions: vi.fn() }));
import { Store, store } from '../src/lib/store.js';
import { stakeholderView } from '../src/views/stakeholder.js';
import { stakeholdersView } from '../src/views/stakeholders.js';
import { dashboardView } from '../src/views/dashboard.js';
import { capTableView } from '../src/views/captable.js';
import { downloadFile } from '../src/lib/util.js';
import { openSecurityForm } from '../src/ui/securityform.js';
import { openGrantActions } from '../src/ui/grantactions.js';

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-10T12:00:00'));
  document.body.replaceChildren(); location.hash = '#/stakeholders';
  store.company = Store.defaultCompany(); store.activity = []; store.hiring = [];
  store.stakeholders = Store.sanitizeStakeholders([{ id: 'founder', name: 'Founder', kind: 'founder' }, { id: 'employee', name: 'Employee', kind: 'employee' }]);
  store.classes = Store.sanitizeClasses([{ id: 'common', name: 'Common', kind: 'common' }]);
  store.securities = Store.sanitizeSecurities([
    { id: 'now', label: 'CS-NOW', kind: 'shares', stakeholderId: 'founder', classId: 'common', quantity: 1000, pricePerShare: 1, date: '2024-01-01' },
    { id: 'later', label: 'CS-LATER', kind: 'shares', stakeholderId: 'employee', classId: 'common', quantity: 1000, pricePerShare: 2, date: '2026-10-10' },
  ], store);
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); document.body.replaceChildren(); });
const options = { navigate: vi.fn() };
const tile = (view, label) => [...view.querySelectorAll('.stat-tile')].find((n) => n.querySelector('.stat-label').textContent === label)?.querySelector('.stat-value').textContent;
const button = (view, text) => [...view.querySelectorAll('button')].find((n) => n.textContent.trim() === text);

describe('ownership as of today', () => {
  it('uses confirmed cash in the dashboard and printed cap table', () => {
    store.securities[0].cashInvested = 975;
    expect(tile(dashboardView(options), 'Capital raised')).toBe('$975');
    const view = capTableView();
    document.body.append(view);
    window.dispatchEvent(new Event('beforeprint'));
    const cash = [...view.querySelectorAll('.print-only .round-metric')]
      .find((r) => r.textContent.startsWith('Capital raised'));
    expect(cash.textContent).toContain('$975');
  });

  it('reconciles dashboard, ownership chart, stakeholder list, statement and cap table', () => {
    const dashboard = dashboardView(options);
    expect(tile(dashboard, 'Outstanding shares')).toBe('1,000');
    expect(tile(dashboard, 'Capital raised')).toBe('$1,000');
    button(dashboard, 'By holder').click();
    expect(dashboard.querySelector('.own-legend').textContent).toContain('Founder');
    expect(dashboard.querySelector('.own-legend').textContent).not.toContain('Employee');
    const list = stakeholdersView(options);
    const founderRow = [...list.querySelectorAll('tbody tr')].find((n) => n.textContent.includes('Founder'));
    expect(founderRow.textContent).toContain('100.00%');
    // The clipped name cell carries the whole name for hover.
    expect(founderRow.querySelector('.holder-cell .t').title).toBe('Founder');
    const statement = stakeholderView({ ...options, id: 'founder' });
    expect(tile(statement, 'Outstanding')).toBe('100.00%');
    expect(statement.querySelector('.statement-meta').textContent).toContain('Sep 10, 2026');
    const capTable = capTableView();
    expect(capTable.textContent).toContain('CS-NOW');
    expect(capTable.textContent).not.toContain('CS-LATER');
  });

  it('excludes future holdings from the printed statement and downloaded CSV, keeping records available', () => {
    const statement = stakeholderView({ ...options, id: 'employee' });
    expect(tile(statement, 'Outstanding')).toBe('0.00%');
    expect(statement.querySelector('a[href="#/securities"]')).not.toBeNull();
    expect(statement.textContent).not.toContain('CS-LATER');
    button(statement, 'Export CSV').click();
    const [, csv] = downloadFile.mock.calls.at(-1);
    expect(csv).toContain('as of 2026-09-10');
    expect(csv).not.toContain('CS-LATER');
    expect(store.security('later').quantity).toBe(1000);
  });

  it('rewinds future transfers without passing a rewound record to an edit form', () => {
    store.securities = Store.sanitizeSecurities([
      { ...store.security('now'), closedAt: '2026-10-10', closedReason: 'transfer' },
      { ...store.security('later'), fromTransferId: 'now' },
    ], store);
    const view = stakeholderView({ ...options, id: 'founder' });
    expect(tile(view, 'Outstanding')).toBe('100.00%');
    expect(view.textContent).not.toContain('Transferred Oct');
    view.querySelector('button[aria-label="Edit CS-NOW"]').click();
    expect(openSecurityForm.mock.calls.at(-1)[0].existing.closedAt).toBe('2026-10-10');
  });

  it('rewinds future grant cancellations for reporting but uses the complete grant for lifecycle actions', () => {
    store.securities = Store.sanitizeSecurities([{ id: 'option', label: 'OPT-1', kind: 'option', stakeholderId: 'employee',
      quantity: 1000, strike: 1, date: '2024-01-01', grantDate: '2024-01-01', vestingMonths: 48,
      cancelled: 500, cancelledDate: '2026-10-10' }], store);
    const view = stakeholderView({ ...options, id: 'employee' });
    expect(tile(view, 'Unvested')).toBe('334');
    view.querySelector('button[aria-label="Lifecycle actions for OPT-1"]').click();
    expect(openGrantActions.mock.calls.at(-1)[0].cancelled).toBe(500);
    expect(openGrantActions.mock.calls.at(-1)[0].cancelledDate).toBe('2026-10-10');
    expect(tile(dashboardView(options), 'Fully diluted shares')).toBe('1,000');
  });

  it('nets a warrant on the statement against today\'s certificates, as its tiles and the cap table do', () => {
    store.securities = Store.sanitizeSecurities([
      ...store.securities,
      { id: 'warrant', label: 'W-1', kind: 'warrant', stakeholderId: 'employee', classId: 'common',
        quantity: 100, strike: 2, date: '2024-06-01', expires: '2030-01-01' },
      { id: 'exercise', label: 'CS-W', kind: 'shares', stakeholderId: 'employee', classId: 'common',
        quantity: 40, pricePerShare: 2, date: '2026-10-20', fromWarrantId: 'warrant' },
    ], store);
    const view = stakeholderView({ ...options, id: 'employee' });
    const row = [...view.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('W-1'));
    expect(row.querySelector('td.num').textContent).toBe('100');
    expect(row.textContent).not.toContain('exercised');
    const diluted = [...view.querySelectorAll('.stat-tile')].find((n) => n.querySelector('.stat-label').textContent === 'Fully diluted');
    expect(diluted.textContent).toContain('100 of 1,100 shares');
    button(view, 'Export CSV').click();
    const [, csv] = downloadFile.mock.calls.at(-1);
    expect(csv.split('\r\n').find((r) => r.startsWith('W-1'))).toContain(',100,2,,Expires 2030-01-01');
    const capTable = capTableView();
    const capRow = [...capTable.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('W-1'));
    expect(capRow.querySelector('td.num').textContent).toBe('100');
  });

  it('shows an exercised grant at what it still puts in the diluted base, so the rows sum to the tile', async () => {
    store.securities = Store.sanitizeSecurities([
      ...store.securities,
      { id: 'grant', label: 'OPT-1', kind: 'option', stakeholderId: 'founder', quantity: 120000, strike: 1,
        date: '2024-01-01', grantDate: '2024-01-01', vestingMonths: 0, exercised: 10000 },
      { id: 'ex', label: 'CS-3', kind: 'shares', stakeholderId: 'founder', classId: 'common', quantity: 10000, pricePerShare: 1,
        date: '2025-01-01', fromOptionId: 'grant' },
    ], store);
    const statement = stakeholderView({ ...options, id: 'founder' });
    const rows = [...statement.querySelectorAll('.holdings-table tbody tr, tbody tr')];
    const grantRow = rows.find((r) => r.textContent.includes('OPT-1'));
    expect(grantRow.querySelector('td.num > div > div').textContent).toBe('110,000');
    expect(grantRow.textContent).toContain('10,000 exercised');
    expect(grantRow.textContent).not.toContain('without a certificate');
    const diluted = [...statement.querySelectorAll('.stat-tile')].find((n) => n.querySelector('.stat-label').textContent === 'Fully diluted');
    // 1,000 (CS-NOW) + 10,000 (CS-3) + 110,000 (OPT-1) = 121,000, the tile's figure.
    expect(diluted.textContent).toContain('121,000 of 121,000 shares');
    button(statement, 'Export CSV').click();
    const [, csv] = downloadFile.mock.calls.at(-1);
    expect(csv.split('\r\n').find((r) => r.startsWith('OPT-1'))).toContain(',110000,');
    // An exercise the counter records with no certificate yet stays on the grant, and the line says so.
    store.securities = Store.sanitizeSecurities(store.securities.map((s) => (s.id === 'grant' ? { ...s, exercised: 15000 } : s)), store);
    const again = stakeholderView({ ...options, id: 'founder' });
    const row = [...again.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('OPT-1'));
    expect(row.querySelector('td.num > div > div').textContent).toBe('110,000');
    expect(row.textContent).toContain('15,000 exercised, 5,000 without a certificate');
  });

  it('prints a repurchase\'s consideration to the cent in the holdings CSV', async () => {
    store.securities = Store.sanitizeSecurities([
      { ...store.security('now'), closedAt: '2026-05-01', closedReason: 'repurchase', repurchasedQty: 3, repurchasePricePerShare: 0.07 },
    ], store);
    const statement = stakeholderView({ ...options, id: 'founder' });
    expect(statement.textContent).toContain('Repurchased May 1, 2026 · 3 for $0.21');
    button(statement, 'Export CSV').click();
    const [, csv] = downloadFile.mock.calls.at(-1);
    expect(csv).toContain('Repurchased 2026-05-01 · 3 shares for 0.21');
    expect(csv).not.toContain('0.21000000000000002');
  });

  it('includes same-day issuances and naturally includes future records when their date arrives', () => {
    store.securities[1].date = '2026-09-10';
    expect(tile(stakeholderView({ ...options, id: 'founder' }), 'Outstanding')).toBe('50.00%');
    store.securities[1].date = '2026-10-10';
    vi.setSystemTime(new Date('2026-10-10T12:00:00'));
    expect(tile(stakeholderView({ ...options, id: 'founder' }), 'Outstanding')).toBe('50.00%');
  });
});
