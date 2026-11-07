import { describe, it, expect } from 'vitest';
import { ACC } from '../src/core/accounts.js';
import { buildSampleData } from '../src/core/sample.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { computeIndex, buildCharge, buildPayment, buildBill, buildBillPayment } from '../src/core/ledger.js';
import { leaseStatus } from '../src/core/leases.js';
import {
  rentRoll,
  delinquency,
  agingFor,
  vacancy,
  leasesEnding,
  depositsHeld,
  unpaidBills,
  workOrdersReport,
  vendorInsurance,
  applicantsReport,
  currentTenants,
  tenantVehicles,
  tenantLedger,
  ownerSummary,
  renewalStatus,
  openTasksReport,
} from '../src/core/reports.js';
import { exportBackup, importBackup, validateBackup, recordCounts } from '../src/core/backup.js';

const TODAY = '2026-10-12';

async function storeFrom(seed) {
  const store = createStore({ backend: createMemoryBackend(seed), flushDelay: 0, timeoutMs: 0 });
  await store.init();
  return store;
}

/** A tiny hand-built portfolio: one property, two units, one lease. */
function handBuilt() {
  const lease = { id: 'L1', number: 1, propertyId: 'P1', unitId: 'U1', tenantIds: ['T1'], type: 'fixed', start: '2026-01-01', end: '2026-11-30', deposit: 100000, recurring: [{ id: 'r', accountId: ACC.rent, amount: 100000, day: 1, start: '2026-01-01' }] };
  const past = { id: 'L0', number: 0, propertyId: 'P1', unitId: 'U2', tenantIds: ['T2'], type: 'fixed', start: '2025-01-01', end: '2025-12-31', recurring: [] };
  const txs = [
    buildCharge({ lease, id: 'dep', date: '2026-01-01', items: [{ accountId: ACC.depositsHeld, amount: 100000 }] }),
    buildPayment({ lease, id: 'depPay', date: '2026-01-01', amount: 100000, allocations: [{ accountId: ACC.depositsHeld, amount: 100000 }] }),
    buildCharge({ lease, id: 'c7', date: '2026-07-01', items: [{ accountId: ACC.rent, amount: 100000 }] }),
    buildCharge({ lease, id: 'c8', date: '2026-08-01', items: [{ accountId: ACC.rent, amount: 100000 }] }),
    buildCharge({ lease, id: 'c9', date: '2026-09-01', items: [{ accountId: ACC.rent, amount: 100000 }] }),
    buildCharge({ lease, id: 'c10', date: '2026-10-01', items: [{ accountId: ACC.rent, amount: 100000 }] }),
    buildPayment({ lease, id: 'p1', date: '2026-07-03', amount: 150000, allocations: [{ accountId: ACC.rent, amount: 150000 }] }),
  ];
  const bill = buildBill({ id: 'B1', vendorId: 'V1', date: '2026-08-01', dueDate: '2026-08-31', items: [{ accountId: ACC.repairs, amount: 20000, propertyId: 'P1' }] });
  const bill2 = buildBill({ id: 'B2', vendorId: 'V1', date: '2026-10-01', dueDate: '2026-10-30', items: [{ accountId: ACC.repairs, amount: 5000, propertyId: 'P1' }] });
  const pay = buildBillPayment({ vendorId: 'V1', id: 'BP', date: '2026-09-15', allocations: [{ billId: 'B1', amount: 5000 }], bills: { B1: bill } });
  return {
    settings: null,
    collections: {
      properties: [{ id: 'P1', name: 'Alder House', type: 'multi-family', owners: [{ ownerId: 'O1', pct: 50 }, { ownerId: 'O2', pct: 50 }], active: true }],
      units: [
        { id: 'U1', propertyId: 'P1', name: '1', marketRent: 110000 },
        { id: 'U2', propertyId: 'P1', name: '2', marketRent: 90000 },
      ],
      leases: [lease, past],
      tenants: [
        { id: 'T1', firstName: 'Ana', lastName: 'Reyes', emails: ['ana@example.com'], phones: ['555'], vehicles: [{ make: 'Kia', model: 'Soul', plate: 'ABC123' }] },
        { id: 'T2', firstName: 'Ben', lastName: 'Ode' },
      ],
      owners: [
        { id: 'O1', kind: 'person', firstName: 'Olga', lastName: 'One' },
        { id: 'O2', kind: 'company', company: 'Two LLC' },
      ],
      vendors: [
        { id: 'V1', company: 'Pipe Co', insuranceExpires: '2026-10-01' },
        { id: 'V2', company: 'Fresh Co', insuranceExpires: '2027-09-01' },
        { id: 'V3', company: 'No Cert Co' },
      ],
      accounts: [
        { id: ACC.rent, name: 'Rent income', type: 'income' },
        { id: ACC.repairs, name: 'Repairs', type: 'expense' },
        { id: ACC.ar, name: 'AR', type: 'asset' },
        { id: ACC.ap, name: 'AP', type: 'liability' },
        { id: ACC.depositsHeld, name: 'Deposits', type: 'liability' },
        { id: ACC.operating, name: 'Bank', type: 'asset', bank: true },
      ],
      workOrders: [
        { id: 'W1', number: 1, title: 'Leak', propertyId: 'P1', unitId: 'U1', vendorId: 'V1', status: 'new', dueDate: '2026-10-05' },
        { id: 'W2', number: 2, title: 'Paint', propertyId: 'P1', unitId: 'U2', status: 'completed', dueDate: '2026-09-01', cost: 40000 },
      ],
      tasks: [
        { id: 'K1', number: 1, title: 'Call', status: 'new', dueDate: '2026-10-01' },
        { id: 'K2', number: 2, title: 'Done', status: 'completed' },
      ],
      applicants: [
        { id: 'A1', firstName: 'Cy', lastName: 'Dee', status: 'new', appliedOn: '2026-10-10', source: 'Website' },
        { id: 'A2', firstName: 'Di', lastName: 'Eff', status: 'approved', appliedOn: '2026-09-01', source: 'Website' },
        { id: 'A3', firstName: 'Ed', lastName: 'Gee', status: 'new', appliedOn: '2026-01-01', source: 'Sign' },
      ],
      transactions: [...txs, bill, bill2, pay],
    },
  };
}

describe('aging', () => {
  it('settles the oldest charges first and buckets the rest by age', () => {
    const lines = [
      { date: '2026-07-01', amount: 100000 },
      { date: '2026-07-03', amount: -150000 },
      { date: '2026-08-01', amount: 100000 },
      { date: '2026-09-01', amount: 100000 },
      { date: '2026-10-01', amount: 100000 },
    ].sort((a, b) => (a.date < b.date ? -1 : 1));
    const a = agingFor({ lines }, TODAY);
    expect(a.total).toBe(250000);
    expect(a.b0).toBe(100000); // Oct 1 is 11 days old
    expect(a.b31).toBe(100000); // Sep 1 is 41 days old
    expect(a.b61).toBe(50000); // half of Aug 1, 72 days old
    expect(a.b91).toBe(0);
    expect(a.oldest).toBe('2026-08-01');
  });
});

describe('operational reports on hand-built data', () => {
  let store;
  let ledger;
  const ctx = () => ({ today: TODAY, ledger });
  it('sets up', async () => {
    store = await storeFrom(handBuilt());
    ledger = computeIndex(store.all('transactions'));
  });

  it('rent roll lists every unit with totals', () => {
    const r = rentRoll(store, {}, ctx());
    expect(r.rows).toHaveLength(2);
    expect(r.totals).toMatchObject({ units: 2, occupied: 1, vacant: 1, marketRent: 200000, rent: 100000, deposit: 100000, balance: 250000 });
    expect(r.rows.find((x) => x.unitId === 'U1').tenants).toBe('Ana Reyes');
  });

  it('delinquency matches the lease balance and aging', () => {
    const r = delinquency(store, {}, ctx());
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ total: 250000, b0: 100000, b31: 100000, b61: 50000, lastPaymentDate: '2026-07-03' });
    expect(r.totals.total).toBe(ledger.lease('L1').balance);
    // As of an earlier date, only what was owed then.
    expect(delinquency(store, { asOf: '2026-08-15' }, ctx()).totals.total).toBe(50000);
  });

  it('rent roll and delinquency as of a past date use what was true then', async () => {
    const data = handBuilt();
    const lease = data.collections.leases[0];
    data.collections.transactions.push(
      buildCharge({ lease, id: 'dep2', date: '2026-09-01', items: [{ accountId: ACC.depositsHeld, amount: 20000 }] }),
      buildPayment({ lease, id: 'p2', date: '2026-10-05', amount: 70000, allocations: [{ accountId: ACC.depositsHeld, amount: 20000 }, { accountId: ACC.rent, amount: 50000 }] }),
    );
    const s = await storeFrom(data);
    const c = { today: TODAY, ledger: computeIndex(s.all('transactions')) };
    const now = rentRoll(s, {}, c).rows.find((x) => x.leaseId === 'L1');
    expect(now).toMatchObject({ balance: 200000, deposit: 120000 });
    const then = rentRoll(s, { asOf: '2026-09-15' }, c).rows.find((x) => x.leaseId === 'L1');
    // Jul to Sep rent less the July payment, plus the unpaid deposit top-up;
    // only the first deposit had been collected.
    expect(then).toMatchObject({ balance: 170000, deposit: 100000 });
    expect(delinquency(s, { asOf: '2026-09-15' }, c).rows[0].lastPaymentDate).toBe('2026-07-03');
    expect(delinquency(s, {}, c).rows[0].lastPaymentDate).toBe('2026-10-05');
  });

  it('includes an inactive property when it is picked in the filter', async () => {
    const data = handBuilt();
    data.collections.properties[0].active = false;
    const s = await storeFrom(data);
    const c = { today: TODAY, ledger: computeIndex(s.all('transactions')) };
    expect(rentRoll(s, {}, c).rows).toHaveLength(0);
    expect(rentRoll(s, { propertyIds: ['P1'] }, c).rows).toHaveLength(2);
    expect(vacancy(s, { propertyIds: ['P1'] }, c).rows).toHaveLength(1);
  });

  it('vacancy counts days since the last lease ended', () => {
    const r = vacancy(store, {}, ctx());
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ unitId: 'U2', vacantSince: '2026-01-01', days: 284 });
    expect(r.rows[0].lostRent).toBe(Math.round((90000 * 284 * 12) / 365));
  });

  it('leases ending respects the range', () => {
    expect(leasesEnding(store, { from: '2026-11-01', to: '2026-11-30' }, ctx()).rows.map((x) => x.leaseId)).toEqual(['L1']);
    expect(leasesEnding(store, { from: '2026-12-01', to: '2027-12-31' }, ctx()).rows).toEqual([]);
    expect(leasesEnding(store, { from: '2025-01-01', to: '2025-12-31' }, ctx()).rows.map((x) => x.leaseId)).toEqual(['L0']);
  });

  it('deposits held equal the deposits account', () => {
    const r = depositsHeld(store, {}, ctx());
    expect(r.totals.amount).toBe(100000);
    expect(r.totals.amount).toBe(-ledger.account(ACC.depositsHeld));
  });

  it('unpaid bills age by due date and apply payments', () => {
    const r = unpaidBills(store, {}, ctx());
    expect(r.rows.map((x) => [x.billId, x.balance, x.bucket])).toEqual([
      ['B1', 15000, 'd31'],
      ['B2', 5000, 'current'],
    ]);
    expect(r.totals.balance).toBe(20000);
    expect(unpaidBills(store, { asOf: '2026-09-01' }, ctx()).rows.map((x) => x.balance)).toEqual([20000]);
  });

  it('unpaid bills filtered by property count only that property\'s share', async () => {
    const data = handBuilt();
    data.collections.properties.push({ id: 'P2', name: 'Birch', active: true });
    const shared = buildBill({ id: 'B3', vendorId: 'V1', date: '2026-10-01', dueDate: '2026-10-30', items: [{ accountId: ACC.repairs, amount: 30000, propertyId: 'P1' }, { accountId: ACC.repairs, amount: 10000, propertyId: 'P2' }] });
    const part = buildBillPayment({ vendorId: 'V1', id: 'BP3', date: '2026-10-05', allocations: [{ billId: 'B3', amount: 20000 }], bills: { B3: shared } });
    data.collections.transactions.push(shared, part);
    const s = await storeFrom(data);
    const c = { today: TODAY, ledger: computeIndex(s.all('transactions')) };
    expect(unpaidBills(s, {}, c).rows.find((x) => x.billId === 'B3')).toMatchObject({ total: 40000, paid: 20000, balance: 20000 });
    expect(unpaidBills(s, { propertyIds: ['P2'] }, c).rows).toEqual([expect.objectContaining({ billId: 'B3', total: 10000, paid: 5000, balance: 5000 })]);
    const p1 = unpaidBills(s, { propertyIds: ['P1'] }, c);
    expect(p1.rows.find((x) => x.billId === 'B3')).toMatchObject({ total: 30000, paid: 15000, balance: 15000 });
    // The filtered balances add up to the property's payables.
    expect(p1.totals.balance).toBe(-c.ledger.account(ACC.ap) - 5000);
  });

  it('a bill paid in full is not unpaid on any one property', async () => {
    const data = handBuilt();
    data.collections.properties.push({ id: 'P2', name: 'Birch', active: true }, { id: 'P3', name: 'Cedar', active: true });
    const bill = buildBill({ id: 'B4', vendorId: 'V1', date: '2026-10-01', dueDate: '2026-10-30', items: [{ accountId: ACC.repairs, amount: 3333, propertyId: 'P1' }, { accountId: ACC.repairs, amount: 3333, propertyId: 'P2' }, { accountId: ACC.repairs, amount: 3334, propertyId: 'P3' }] });
    // Two halves, each split by the bill's proportions (as payments were before).
    const half = (id) => buildBillPayment({ vendorId: 'V1', id, date: '2026-10-05', allocations: [{ billId: 'B4', amount: 5000 }], bills: { B4: bill } });
    data.collections.transactions.push(bill, half('H1'), half('H2'));
    const s = await storeFrom(data);
    const c = { today: TODAY, ledger: computeIndex(s.all('transactions')) };
    for (const p of ['P1', 'P2', 'P3']) expect(unpaidBills(s, { propertyIds: [p] }, c).rows.some((x) => x.billId === 'B4'), p).toBe(false);
  });

  it('work orders filter by status and flag overdue ones', () => {
    const all = workOrdersReport(store, {}, ctx());
    expect(all.rows).toHaveLength(2);
    expect(all.totals.overdue).toBe(1);
    expect(all.totals.cost).toBe(40000);
    expect(workOrdersReport(store, { status: 'open' }, ctx()).rows.map((x) => x.workOrderId)).toEqual(['W1']);
  });

  it('vendor insurance lists expired, then expiring and missing', () => {
    const r = vendorInsurance(store, { days: 60 }, ctx());
    expect(r.rows.map((x) => [x.vendorId, x.state])).toEqual([
      ['V1', 'expired'],
      ['V3', 'missing'],
    ]);
    expect(vendorInsurance(store, { includeCurrent: true }, ctx()).rows).toHaveLength(3);
  });

  it('applicants filter by date and count by status and source', () => {
    const r = applicantsReport(store, { from: '2026-09-01', to: TODAY });
    expect(r.rows.map((x) => x.applicantId)).toEqual(['A1', 'A2']);
    expect(r.totals.byStatus).toEqual({ new: 1, approved: 1 });
    expect(r.totals.bySource).toEqual({ Website: 2 });
  });

  it('current tenants and vehicles come from active leases', () => {
    expect(currentTenants(store, {}, ctx()).rows.map((x) => x.name)).toEqual(['Ana Reyes']);
    expect(tenantVehicles(store, {}, ctx()).rows[0]).toMatchObject({ plate: 'ABC123', name: 'Ana Reyes' });
  });

  it('tenant ledger has an opening balance and a running balance', () => {
    const r = tenantLedger(store, { leaseId: 'L1', from: '2026-09-01', to: TODAY });
    expect(r.opening).toBe(50000);
    expect(r.rows.map((x) => x.balance)).toEqual([150000, 250000]);
    expect(r.closing).toBe(250000);
    const all = tenantLedger(store, { leaseId: 'L1' });
    expect(all.closing).toBe(ledger.lease('L1').balance);
  });

  it('owner summary splits by ownership share', () => {
    const r = ownerSummary(store, { from: '2026-01-01', to: TODAY });
    const one = r.rows.find((x) => x.ownerId === 'O1');
    expect(one).toMatchObject({ properties: 1, units: 2, income: 200000, expense: 12500, net: 187500 });
    expect(r.totals.income).toBe(400000);
  });

  it('renewal status lists leases near their end', () => {
    expect(renewalStatus(store, { days: 60 }, ctx()).rows.map((x) => x.leaseId)).toEqual(['L1']);
    expect(renewalStatus(store, { days: 10 }, ctx()).rows).toEqual([]);
  });

  it('open tasks skip finished ones and flag overdue', () => {
    const r = openTasksReport(store, {}, ctx());
    expect(r.rows.map((x) => x.taskId)).toEqual(['K1']);
    expect(r.totals.overdue).toBe(1);
  });
});

describe('reports on the sample portfolio', () => {
  let store;
  let ledger;
  const ctx = () => ({ today: TODAY, ledger });
  it('sets up', async () => {
    store = await storeFrom(buildSampleData(TODAY));
    ledger = computeIndex(store.all('transactions'));
  });

  it('rent roll covers every active unit and agrees with occupancy', () => {
    const r = rentRoll(store, {}, ctx());
    expect(r.totals.units).toBe(store.all('units').length);
    const active = new Set(store.all('leases').filter((l) => leaseStatus(l, TODAY) === 'active').map((l) => l.unitId));
    expect(r.totals.occupied).toBe(active.size);
    expect(r.totals.rent).toBeGreaterThan(0);
  });

  it('delinquency total equals the sum of positive lease balances', () => {
    const r = delinquency(store, {}, ctx());
    const owed = store.all('leases').reduce((s, l) => s + Math.max(0, ledger.lease(l.id).balance), 0);
    expect(r.totals.total).toBe(owed);
    expect(r.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('deposits held equal the deposits account balance', () => {
    expect(depositsHeld(store, {}, ctx()).totals.amount).toBe(-ledger.account(ACC.depositsHeld));
  });

  it('vacancy plus occupied equals all units', () => {
    expect(vacancy(store, {}, ctx()).totals.units + rentRoll(store, {}, ctx()).totals.occupied).toBe(store.all('units').length);
  });

  it('unpaid bills match open bill balances', () => {
    const open = store.all('transactions').filter((t) => t.kind === 'bill').reduce((s, b) => s + Math.max(0, ledger.bill(b.id).balance), 0);
    expect(unpaidBills(store, {}, ctx()).totals.balance).toBe(open);
  });

  it('property filters narrow every report', () => {
    const one = ['pr-linden'];
    expect(rentRoll(store, { propertyIds: one }, ctx()).rows).toHaveLength(1);
    expect(currentTenants(store, { propertyIds: one }, ctx()).rows.every((r) => r.label === '14 Linden Lane')).toBe(true);
  });
});

describe('backup', () => {
  it('round trips every record and the settings', async () => {
    const a = await storeFrom(buildSampleData(TODAY));
    const json = JSON.parse(JSON.stringify(exportBackup(a)));
    expect(Object.keys(json.collections).some((k) => k.startsWith('tx.'))).toBe(true);
    const v = validateBackup(json);
    expect(v.ok).toBe(true);

    const b = await storeFrom({});
    b.put('tenants', { id: 'stray', firstName: 'Old' });
    const { count } = importBackup(b, json, { mode: 'replace' });
    expect(count).toBe(Object.values(recordCounts(a)).reduce((s, n) => s + n, 0));
    expect(recordCounts(b)).toEqual(recordCounts(a));
    expect(b.get('tenants', 'stray')).toBe(null);
    expect(b.state.settings.company.name).toBe(a.state.settings.company.name);
    expect(computeIndex(b.all('transactions')).account(ACC.operating)).toBe(computeIndex(a.all('transactions')).account(ACC.operating));
  });

  it('merges without removing existing records', async () => {
    const a = await storeFrom(handBuilt());
    const b = await storeFrom({});
    b.put('tenants', { id: 'keep', firstName: 'Kept' });
    importBackup(b, exportBackup(a), { mode: 'merge' });
    expect(b.get('tenants', 'keep')).toBeTruthy();
    expect(b.get('tenants', 'T1')).toBeTruthy();
  });

  it('rejects files that are not backups', () => {
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup({ format: 'other' }).ok).toBe(false);
    expect(validateBackup({ format: 'property-management-backup', version: 99, collections: {} }).ok).toBe(false);
    expect(validateBackup({ format: 'property-management-backup', version: 1, collections: { tenants: 'nope' } }).ok).toBe(false);
    expect(validateBackup({ format: 'property-management-backup', version: 1, collections: { transactions: [{ id: 'x', date: 'bad' }] } }).ok).toBe(false);
  });

  it('refuses a backup the store could not take, before replacing anything', async () => {
    const backup = (extra) => ({ format: 'property-management-backup', version: 1, collections: { tenants: [{ id: 'bt', firstName: 'B' }], ...extra } });
    const badMonth = backup({ transactions: [{ id: 'x1', date: '2026-13-01', lines: [] }] });
    const badId = backup({ tenants: [{ id: 'imported.legacy:1', firstName: 'L' }] });
    for (const data of [badMonth, badId]) {
      expect(validateBackup(data).ok).toBe(false);
      const b = await storeFrom(handBuilt());
      const before = recordCounts(b);
      expect(() => importBackup(b, data, { mode: 'replace' })).toThrow();
      expect(recordCounts(b)).toEqual(before);
    }
  });

  it('ignores unknown collections', () => {
    const v = validateBackup({ format: 'property-management-backup', version: 1, collections: { clients: [{ id: 'c' }], tenants: [{ id: 't' }] } });
    expect(v.ok).toBe(true);
    expect(v.count).toBe(1);
  });
});
