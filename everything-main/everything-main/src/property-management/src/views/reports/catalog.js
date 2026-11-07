/**
 * Every report: where it is listed, its parameters, and how to build its
 * sections (see table.js for the section shape).
 *
 * run(p, env) -> { summary?: [{ label, value, sub?, tone? }], sections }
 * env: { store, today, ledger, financials() } where financials() lazily
 * imports core/financials.js.
 */
import { h } from '../../ui/dom.js';
import { lookup } from '../../app.js';
import { statusPill } from '../../ui/components.js';
import { money, date, recordLink, tenantLink } from '../common.js';
import { pluralize, displayName } from '../../core/format.js';
import { kindLabel } from '../../core/ledger.js';
import { leaseTypeLabel } from '../../core/settings.js';
import { typeLabel } from '../../core/accounts.js';
import { statusLabel, taskKindLabel, WORK_ORDER_STATUSES, APPLICANT_STATUSES } from '../../core/status.js';
import * as R from '../../core/reports.js';

export const CATEGORIES = [
  { id: 'financial', label: 'Financial', icon: 'landmark' },
  { id: 'rentals', label: 'Rentals', icon: 'building' },
  { id: 'leasing', label: 'Leasing', icon: 'key' },
  { id: 'maintenance', label: 'Maintenance', icon: 'wrench' },
  { id: 'owners', label: 'Owners', icon: 'briefcase' },
];

// ---- Column helpers ---------------------------------------------------------------

const col = (id, label, value, extra = {}) => ({ id, label, value: typeof value === 'function' ? value : (r) => r[value], ...extra });
const moneyCol = (id, label, key = id, extra = {}) => col(id, label, key, { money: true, ...extra });
const dateCol = (id, label, key = id) => col(id, label, key, { render: (r) => (r[key] ? date(r[key]) : ''), csv: (r) => r[key] || '' });
const pct = (n) => `${Math.round((Number(n) || 0) * 100)}%`;

const leaseCol = (label = 'Lease') =>
  col('label', label, 'label', { render: (r) => (r.leaseId ? recordLink(`#/leases/${r.leaseId}`, r.label, { sub: r.tenants || null }) : r.label) });

const unitCol = (label = 'Unit') => col('label', label, 'label', { render: (r) => (r.unitId ? h('a', { href: `#/units/${r.unitId}` }, r.label) : r.label) });

const statusCol = (id = 'status', label = 'Status', key = id) => col(id, label, (r) => statusLabel(r[key]), { render: (r) => statusPill(r[key]) });

/** Rows for a statement block: group heading, account lines, subtotal. */
function block(title, rows, totalLabel, totalValue, { key = 'amount' } = {}) {
  return [{ _type: 'group', label: title }, ...rows.map((r) => ({ ...r, account: [r.number, r.name].filter(Boolean).join(' · ') })), { _type: 'subtotal', account: totalLabel, [key]: totalValue }];
}

const accountCol = col('account', 'Account', 'account', { render: (r) => (r.accountId ? h('a', { href: `#/accounts/${r.accountId}` }, r.account) : r.account) });

// ---- Reports --------------------------------------------------------------------------

export const REPORTS = [
  // Financial
  {
    id: 'income-statement',
    category: 'financial',
    title: 'Income statement',
    description: 'Income and expenses for a period, by account, with net income.',
    params: ['range', 'properties'],
    defaults: { preset: 'this-year' },
    async run(p, env) {
      const f = await env.financials();
      const s = f.incomeStatement(env.store, { from: p.from, to: p.to, propertyIds: p.propertyIds });
      return {
        summary: [
          { label: 'Income', value: money(s.totalIncome) },
          { label: 'Expenses', value: money(s.totalExpense) },
          { label: 'Net income', value: money(s.net), tone: s.net >= 0 ? 'success' : 'danger' },
        ],
        sections: [
          {
            caption: 'Income statement',
            columns: [accountCol, moneyCol('amount', 'Amount')],
            rows: [...block('Income', s.income, 'Total income', s.totalIncome), ...block('Expenses', s.expense, 'Total expenses', s.totalExpense)],
            totals: { label: 'Net income', amount: s.net },
          },
        ],
      };
    },
  },
  {
    id: 'balance-sheet',
    category: 'financial',
    title: 'Balance sheet',
    description: 'Assets, liabilities and equity on a date.',
    params: ['asOf', 'properties'],
    async run(p, env) {
      const f = await env.financials();
      const s = f.balanceSheet(env.store, { asOf: p.asOf, propertyIds: p.propertyIds });
      const le = s.totalLiabilities + s.totalEquity;
      return {
        summary: [
          { label: 'Total assets', value: money(s.totalAssets) },
          { label: 'Total liabilities', value: money(s.totalLiabilities) },
          { label: 'Total equity', value: money(s.totalEquity) },
        ],
        sections: [
          {
            caption: 'Balance sheet',
            columns: [accountCol, moneyCol('amount', 'Amount')],
            rows: [...block('Assets', s.assets, 'Total assets', s.totalAssets), ...block('Liabilities', s.liabilities, 'Total liabilities', s.totalLiabilities), ...block('Equity', s.equity, 'Total equity', s.totalEquity)],
            totals: { label: 'Total liabilities and equity', amount: le },
            note: le === s.totalAssets ? null : 'Assets and liabilities plus equity differ. Check for unbalanced journal entries.',
          },
        ],
      };
    },
  },
  {
    id: 'cash-flow',
    category: 'financial',
    title: 'Cash flow',
    description: 'Money in and out of bank accounts, from opening to closing balance.',
    params: ['range', 'properties'],
    defaults: { preset: 'this-month' },
    async run(p, env) {
      const f = await env.financials();
      const s = f.cashFlow(env.store, { from: p.from, to: p.to, propertyIds: p.propertyIds });
      const sumOf = (l) => l.reduce((t, r) => t + r.amount, 0);
      return {
        summary: [
          { label: 'Opening cash', value: money(s.opening) },
          { label: 'Net change', value: money(s.net), tone: s.net >= 0 ? 'success' : 'danger' },
          { label: 'Closing cash', value: money(s.closing) },
        ],
        sections: [
          {
            caption: 'Cash flow',
            columns: [col('label', 'Activity', 'label'), moneyCol('amount', 'Amount')],
            rows: [
              { _type: 'subtotal', label: 'Opening balance', amount: s.opening },
              { _type: 'group', label: 'Money in' },
              ...s.inflows,
              { _type: 'subtotal', label: 'Total money in', amount: sumOf(s.inflows) },
              { _type: 'group', label: 'Money out' },
              ...s.outflows.map((r) => ({ ...r, amount: -r.amount })),
              { _type: 'subtotal', label: 'Total money out', amount: -sumOf(s.outflows) },
            ],
            totals: { label: 'Closing balance', amount: s.closing },
          },
        ],
      };
    },
  },
  {
    id: 'trial-balance',
    category: 'financial',
    title: 'Trial balance',
    description: 'Account balances at the end of the period, with income and expenses for the period. Debits should equal credits.',
    params: ['range', 'properties'],
    defaults: { preset: 'this-year' },
    async run(p, env) {
      const f = await env.financials();
      const s = f.trialBalance(env.store, { from: p.from, to: p.to, propertyIds: p.propertyIds });
      return {
        sections: [
          {
            caption: 'Trial balance',
            columns: [col('number', 'Number', 'number'), col('name', 'Account', 'name', { render: (r) => h('a', { href: `#/accounts/${r.accountId}` }, r.name) }), col('type', 'Type', (r) => typeLabel(r.type)), moneyCol('debit', 'Debit'), moneyCol('credit', 'Credit')],
            rows: s.rows,
            totals: { label: 'Total', debit: s.totalDebit, credit: s.totalCredit },
            note: s.totalDebit === s.totalCredit ? null : 'Debits and credits are not equal.',
          },
        ],
      };
    },
  },
  {
    id: 'general-ledger',
    category: 'financial',
    title: 'General ledger',
    description: 'Every transaction by account, with opening and running balances.',
    params: ['range', 'account', 'properties'],
    defaults: { preset: 'this-month' },
    async run(p, env) {
      const f = await env.financials();
      const groups = f.generalLedger(env.store, { from: p.from, to: p.to, accountIds: p.account ? [p.account] : null, propertyIds: p.propertyIds });
      const columns = [
        dateCol('date', 'Date'),
        col('kind', 'Type', (r) => (r.tx ? kindLabel(r.tx.kind) : ''), { render: (r) => (r.tx ? h('a', { href: `#/transactions/${r.tx.id}` }, kindLabel(r.tx.kind)) : '') }),
        col('memo', 'Description', 'memo'),
        col('ref', 'Ref', (r) => r.tx?.ref || ''),
        col('property', 'Property', (r) => (r.line?.propertyId ? lookup.property(r.line.propertyId)?.name || '' : '')),
        moneyCol('amount', 'Amount'),
        moneyCol('balance', 'Balance'),
      ];
      return {
        summary: [{ label: 'Accounts', value: String(groups.length) }, { label: 'Entries', value: String(groups.reduce((s, g) => s + g.rows.length, 0)) }],
        sections: groups.map((g) => ({
          title: [g.account.number, g.account.name].filter(Boolean).join(' · '),
          caption: `${g.account.name} ledger`,
          columns,
          rows: [{ _type: 'muted', date: '', memo: 'Opening balance', balance: g.opening }, ...g.rows],
          totals: { label: 'Closing balance', balance: g.closing, amount: g.closing - g.opening },
        })),
        empty: 'No ledger activity for these settings.',
      };
    },
  },
  {
    id: 'budget-vs-actual',
    category: 'financial',
    title: 'Budget vs. actual',
    description: 'Compare a property budget with what was actually earned and spent.',
    params: ['budget', 'range'],
    defaults: { preset: 'this-year' },
    async run(p, env) {
      if (!p.budget) return { sections: [], empty: 'Create a budget under Accounting to compare it with actual results.' };
      const f = await env.financials();
      const s = f.budgetVsActual(env.store, { budgetId: p.budget, from: p.from, to: p.to });
      const rows = (type) => s.rows.filter((r) => r.type === type).map((r) => ({ ...r, account: [r.number, r.name].filter(Boolean).join(' · ') }));
      const columns = [accountCol, moneyCol('budget', 'Budget'), moneyCol('actual', 'Actual'), moneyCol('variance', 'Variance'), col('pct', '% of budget', (r) => (r.pct === null || r.pct === undefined ? '' : pct(r.pct)), { align: 'r' })];
      const t = s.totals;
      return {
        summary: [
          { label: 'Net budget', value: money(t.net.budget) },
          { label: 'Net actual', value: money(t.net.actual) },
          { label: 'Difference', value: money(t.net.actual - t.net.budget), tone: t.net.actual >= t.net.budget ? 'success' : 'danger' },
        ],
        sections: [
          {
            caption: 'Budget vs. actual',
            columns,
            rows: [
              { _type: 'group', label: 'Income' },
              ...rows('income'),
              { _type: 'subtotal', account: 'Total income', budget: t.income.budget, actual: t.income.actual, variance: t.income.actual - t.income.budget },
              { _type: 'group', label: 'Expenses' },
              ...rows('expense'),
              { _type: 'subtotal', account: 'Total expenses', budget: t.expense.budget, actual: t.expense.actual, variance: t.expense.budget - t.expense.actual },
            ],
            totals: { label: 'Net', budget: t.net.budget, actual: t.net.actual, variance: t.net.actual - t.net.budget },
            note: 'A positive variance is favorable: more income or less expense than budgeted.',
          },
        ],
      };
    },
  },
  {
    id: 'unpaid-bills',
    category: 'financial',
    title: 'Unpaid bills',
    description: 'Open vendor bills grouped by vendor, aged by due date.',
    params: ['asOf', 'vendor', 'properties'],
    async run(p, env) {
      const r = R.unpaidBills(env.store, { asOf: p.asOf, propertyIds: p.propertyIds, vendorId: p.vendor }, env);
      const rows = [];
      let current = null;
      let sub = 0;
      for (const b of r.rows) {
        if (b.vendorId !== current) {
          if (current !== null) rows.push({ _type: 'subtotal', ref: 'Vendor total', balance: sub });
          rows.push({ _type: 'group', label: b.vendor });
          current = b.vendorId;
          sub = 0;
        }
        rows.push(b);
        sub += b.balance;
      }
      if (current !== null) rows.push({ _type: 'subtotal', ref: 'Vendor total', balance: sub });
      return {
        summary: R.BILL_AGING.map((b) => ({ label: b.label, value: money(r.totals[b.id]), tone: b.id === 'current' || !r.totals[b.id] ? null : 'danger' })),
        sections: [
          {
            caption: 'Unpaid bills',
            columns: [
              col('ref', 'Bill', (x) => x.ref || x.memo || 'Bill', { render: (x) => recordLink(`#/bills/${x.billId}`, x.ref ? `Ref ${x.ref}` : 'Bill', { sub: x.memo || null }) }),
              dateCol('date', 'Bill date'),
              dateCol('dueDate', 'Due'),
              col('daysLate', 'Days late', (x) => (x.daysLate ? x.daysLate : ''), { align: 'r' }),
              moneyCol('total', 'Amount'),
              moneyCol('paid', 'Paid'),
              moneyCol('balance', 'Balance'),
            ],
            rows,
            totals: r.rows.length ? { label: `Total (${pluralize(r.totals.bills, 'bill')})`, total: r.totals.total, balance: r.totals.balance, paid: r.totals.total - r.totals.balance } : null,
            empty: 'No unpaid bills. Everything is paid up.',
          },
        ],
      };
    },
  },
  {
    id: 'deposits-held',
    category: 'financial',
    title: 'Security deposits held',
    description: 'Deposits held for each lease on a date.',
    params: ['asOf', 'properties'],
    run(p, env) {
      const r = R.depositsHeld(env.store, { asOf: p.asOf, propertyIds: p.propertyIds }, env);
      return {
        summary: [{ label: 'Deposits held', value: money(r.totals.amount) }, { label: 'Leases', value: String(r.totals.leases) }],
        sections: [
          {
            caption: 'Security deposits held',
            columns: [leaseCol(), statusCol(), dateCol('start', 'Start'), dateCol('end', 'End'), moneyCol('expected', 'Deposit on lease'), moneyCol('amount', 'Held')],
            rows: r.rows,
            totals: { label: 'Total', expected: r.totals.expected, amount: r.totals.amount },
          },
        ],
      };
    },
  },

  // Rentals
  {
    id: 'rent-roll',
    category: 'rentals',
    title: 'Rent roll',
    description: 'Every unit with its tenants, lease dates, rent, deposit and balance.',
    params: ['asOf', 'properties'],
    run(p, env) {
      const r = R.rentRoll(env.store, { asOf: p.asOf, propertyIds: p.propertyIds }, env);
      const t = r.totals;
      return {
        summary: [
          { label: 'Occupancy', value: pct(t.occupancy), sub: `${t.occupied} of ${pluralize(t.units, 'unit')}` },
          { label: 'Monthly rent', value: money(t.rent), sub: `${money(t.marketRent)} at market` },
          { label: 'Deposits held', value: money(t.deposit) },
          { label: 'Balances due', value: money(t.balance), tone: t.balance > 0 ? 'danger' : null },
        ],
        sections: [
          {
            caption: 'Rent roll',
            columns: [
              unitCol(),
              statusCol('status', 'Status'),
              col('tenants', 'Tenants', 'tenants', { render: (x) => (x.leaseId ? h('a', { href: `#/leases/${x.leaseId}` }, x.tenants || 'Lease') : '') }),
              dateCol('start', 'Lease start'),
              dateCol('end', 'Lease end'),
              moneyCol('marketRent', 'Market rent'),
              moneyCol('rent', 'Rent'),
              moneyCol('deposit', 'Deposit held'),
              moneyCol('balance', 'Balance'),
            ],
            rows: r.rows,
            totals: { label: `Total (${pluralize(t.units, 'unit')})`, marketRent: t.marketRent, rent: t.rent, deposit: t.deposit, balance: t.balance },
          },
        ],
      };
    },
  },
  {
    id: 'delinquency',
    category: 'rentals',
    title: 'Delinquency',
    description: 'Tenants who owe money, aged 0 to 30, 31 to 60, 61 to 90 and over 90 days.',
    params: ['asOf', 'properties'],
    run(p, env) {
      const r = R.delinquency(env.store, { asOf: p.asOf, propertyIds: p.propertyIds }, env);
      const t = r.totals;
      return {
        summary: [
          { label: 'Total owed', value: money(t.total), tone: t.total ? 'danger' : null, sub: pluralize(t.leases, 'lease') },
          ...R.AGING_BUCKETS.map((b) => ({ label: b.label, value: money(t[b.id]) })),
        ],
        sections: [
          {
            caption: 'Delinquent leases',
            columns: [
              leaseCol(),
              ...R.AGING_BUCKETS.map((b) => moneyCol(b.id, b.label.replace(' days', ''))),
              moneyCol('total', 'Total'),
              dateCol('lastPaymentDate', 'Last payment'),
            ],
            rows: r.rows,
            totals: r.rows.length ? { label: 'Total', ...t } : null,
            empty: 'Nobody is behind on rent.',
          },
        ],
      };
    },
  },
  {
    id: 'tenant-ledger',
    category: 'rentals',
    title: 'Tenant statement',
    description: 'Charges, payments and running balance for one lease.',
    params: ['lease', 'range'],
    defaults: { preset: 'this-year' },
    run(p, env) {
      if (!p.lease) return { sections: [], empty: 'Choose a lease to see its statement.' };
      const r = R.tenantLedger(env.store, { leaseId: p.lease, from: p.from, to: p.to });
      if (!r.lease) return { sections: [], empty: 'That lease no longer exists.' };
      return {
        summary: [
          { label: 'Opening balance', value: money(r.opening) },
          { label: 'Charges', value: money(r.totals.charges) },
          { label: 'Payments and credits', value: money(r.totals.credits) },
          { label: 'Closing balance', value: money(r.closing), tone: r.closing > 0 ? 'danger' : null },
        ],
        sections: [
          {
            title: `${r.label}${r.tenants ? ' · ' + r.tenants : ''}`,
            caption: 'Tenant statement',
            columns: [dateCol('date', 'Date'), col('kind', 'Type', (x) => (x.kind ? kindLabel(x.kind) : ''), { render: (x) => h('a', { href: `#/transactions/${x.txId}` }, kindLabel(x.kind)) }), col('memo', 'Description', 'memo'), col('ref', 'Ref', 'ref'), moneyCol('charge', 'Charges'), moneyCol('credit', 'Payments and credits'), moneyCol('balance', 'Balance')],
            rows: [{ _type: 'muted', memo: 'Opening balance', balance: r.opening }, ...r.rows],
            totals: { label: 'Closing balance', charge: r.totals.charges, credit: r.totals.credits, balance: r.closing },
          },
        ],
      };
    },
  },
  {
    id: 'vacancy',
    category: 'rentals',
    title: 'Vacancy',
    description: 'Vacant units, how long they have been empty and the rent lost so far.',
    params: ['asOf', 'properties'],
    run(p, env) {
      const r = R.vacancy(env.store, { asOf: p.asOf, propertyIds: p.propertyIds }, env);
      return {
        summary: [
          { label: 'Vacant units', value: String(r.totals.units), sub: `${r.totals.listed} listed` },
          { label: 'Market rent', value: money(r.totals.marketRent), sub: 'per month' },
          { label: 'Rent lost so far', value: money(r.totals.lostRent), tone: r.totals.lostRent ? 'danger' : null },
        ],
        sections: [
          {
            caption: 'Vacant units',
            columns: [
              unitCol(),
              dateCol('vacantSince', 'Vacant since'),
              col('days', 'Days vacant', 'days', { align: 'r' }),
              moneyCol('marketRent', 'Market rent'),
              moneyCol('lostRent', 'Rent lost'),
              col('listed', 'Listed', (x) => (x._type ? '' : x.listed ? 'Yes' : 'No')),
              col('nextMoveIn', 'Next move-in', (x) => x.nextMoveIn || '', { render: (x) => (x.nextMoveIn ? h('a', { href: `#/leases/${x.nextLeaseId}` }, date(x.nextMoveIn)) : '') }),
            ],
            rows: r.rows,
            totals: r.rows.length ? { label: 'Total', marketRent: r.totals.marketRent, lostRent: r.totals.lostRent } : null,
            empty: 'Every unit is occupied.',
          },
        ],
      };
    },
  },
  {
    id: 'current-tenants',
    category: 'rentals',
    title: 'Current tenants',
    description: 'Contact details for everyone on an active lease.',
    params: ['properties'],
    run(p, env) {
      const r = R.currentTenants(env.store, { propertyIds: p.propertyIds }, env);
      return {
        sections: [
          {
            caption: 'Current tenants',
            columns: [
              col('name', 'Name', 'name', { render: (x) => tenantLink(x.tenantId) }),
              col('label', 'Unit', 'label', { render: (x) => h('a', { href: `#/leases/${x.leaseId}` }, x.label) }),
              col('email', 'Email', 'email', { render: (x) => (x.email ? h('a', { href: `mailto:${x.email}` }, x.email) : '') }),
              col('phone', 'Phone', 'phone'),
              dateCol('start', 'Lease start'),
              dateCol('end', 'Lease end'),
            ],
            rows: r.rows,
            totals: null,
            note: pluralize(r.totals.tenants, 'tenant'),
          },
        ],
      };
    },
  },
  {
    id: 'tenant-vehicles',
    category: 'rentals',
    title: 'Tenant vehicles',
    description: 'Vehicles registered by current tenants, for parking and towing.',
    params: ['properties'],
    run(p, env) {
      const r = R.tenantVehicles(env.store, { propertyIds: p.propertyIds }, env);
      return {
        sections: [
          {
            caption: 'Tenant vehicles',
            columns: [col('name', 'Tenant', 'name', { render: (x) => tenantLink(x.tenantId) }), col('label', 'Unit', 'label'), col('vehicle', 'Vehicle', (x) => [x.year, x.make, x.model].filter(Boolean).join(' ')), col('color', 'Color', 'color'), col('plate', 'Plate', 'plate')],
            rows: r.rows,
            empty: 'No vehicles on file. Add them on a tenant page.',
          },
        ],
      };
    },
  },

  // Leasing
  {
    id: 'leases-ending',
    category: 'leasing',
    title: 'Leases ending',
    description: 'Leases whose term or move-out date falls in a period.',
    params: ['range', 'properties'],
    defaults: { preset: 'next-90' },
    future: true,
    run(p, env) {
      const r = R.leasesEnding(env.store, { from: p.from, to: p.to, propertyIds: p.propertyIds }, env);
      return {
        summary: [{ label: 'Leases ending', value: String(r.totals.leases) }, { label: 'Monthly rent at stake', value: money(r.totals.rent) }],
        sections: [
          {
            caption: 'Leases ending',
            columns: [leaseCol(), col('type', 'Type', (x) => leaseTypeLabel(x.type)), dateCol('end', 'Ends'), col('daysLeft', 'Days left', (x) => (x.daysLeft >= 0 ? x.daysLeft : 'Ended'), { align: 'r' }), moneyCol('rent', 'Rent'), statusCol('renewal', 'Renewal')],
            rows: r.rows,
            empty: 'No leases end in this period.',
          },
        ],
      };
    },
  },
  {
    id: 'renewal-status',
    category: 'leasing',
    title: 'Renewal status',
    description: 'Where each expiring lease stands: not started, offered, renewing or moving out.',
    params: ['days', 'properties'],
    daysLabel: 'Ending within',
    defaults: { days: 90 },
    run(p, env) {
      const r = R.renewalStatus(env.store, { days: p.days, propertyIds: p.propertyIds }, env);
      const c = r.totals.counts;
      return {
        summary: ['not-started', 'offered', 'accepted', 'declined'].map((s) => ({ label: statusLabel(s), value: String(c[s] || 0) })),
        sections: [
          {
            caption: 'Renewal status',
            columns: [leaseCol(), dateCol('end', 'Ends'), col('daysLeft', 'Days left', 'daysLeft', { align: 'r' }), moneyCol('rent', 'Current rent'), moneyCol('offerRent', 'Offered rent'), moneyCol('change', 'Change'), statusCol()],
            rows: r.rows,
            empty: 'No leases are coming up for renewal in this window.',
          },
        ],
      };
    },
  },
  {
    id: 'applicants',
    category: 'leasing',
    title: 'Applicants',
    description: 'Rental applications by status and lead source.',
    params: ['range', 'status', 'source'],
    defaults: { preset: 'last-90', status: '' },
    statusOptions: [{ value: '', label: 'Any status' }, ...APPLICANT_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))],
    run(p, env) {
      const r = R.applicantsReport(env.store, { from: p.from, to: p.to, status: p.status, source: p.source });
      const bySource = Object.entries(r.totals.bySource).sort((a, b) => b[1] - a[1]);
      return {
        summary: [{ label: 'Applications', value: String(r.totals.applicants) }, ...Object.entries(r.totals.byStatus).map(([s, n]) => ({ label: statusLabel(s), value: String(n) }))],
        sections: [
          {
            caption: 'Applicants',
            columns: [
              col('name', 'Applicant', 'name', { render: (x) => recordLink(`#/applicants/${x.applicantId}`, x.name, { sub: x.email || x.phone || null }) }),
              col('label', 'Unit', 'label'),
              dateCol('appliedOn', 'Applied'),
              dateCol('moveIn', 'Move-in'),
              moneyCol('income', 'Monthly income'),
              col('source', 'Source', 'source'),
              statusCol(),
            ],
            rows: r.rows,
            empty: 'No applications in this period.',
          },
          bySource.length
            ? { title: 'By lead source', caption: 'Applications by lead source', columns: [col('source', 'Source', 'source'), col('n', 'Applications', 'n', { align: 'r' })], rows: bySource.map(([source, n]) => ({ source, n })) }
            : null,
        ].filter(Boolean),
      };
    },
  },

  // Maintenance
  {
    id: 'work-orders',
    category: 'maintenance',
    title: 'Work orders',
    description: 'Work orders by status, vendor and property, with cost.',
    params: ['range', 'status', 'vendor', 'properties'],
    defaults: { preset: 'last-90', status: '' },
    statusOptions: [{ value: '', label: 'Any status' }, { value: 'open', label: 'Open' }, ...WORK_ORDER_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))],
    run(p, env) {
      const r = R.workOrdersReport(env.store, { from: p.from, to: p.to, status: p.status, vendorId: p.vendor, propertyIds: p.propertyIds }, env);
      return {
        summary: [
          { label: 'Work orders', value: String(r.totals.workOrders) },
          { label: 'Open', value: String(r.totals.open) },
          { label: 'Overdue', value: String(r.totals.overdue), tone: r.totals.overdue ? 'danger' : null },
          { label: 'Cost', value: money(r.totals.cost) },
        ],
        sections: [
          {
            caption: 'Work orders',
            columns: [
              col('number', 'Number', (x) => `WO-${x.number}`, { render: (x) => h('a', { href: `#/work-orders/${x.workOrderId}` }, `WO-${x.number}`) }),
              col('title', 'Title', 'title'),
              col('label', 'Unit', 'label'),
              col('vendor', 'Vendor', 'vendor'),
              statusCol('priority', 'Priority'),
              statusCol(),
              col('dueDate', 'Due', 'dueDate', { render: (x) => (x.dueDate ? h(`span${x.overdue ? '.rpt-overdue' : ''}`, date(x.dueDate)) : '') }),
              dateCol('completedOn', 'Completed'),
              moneyCol('cost', 'Cost'),
            ],
            rows: r.rows,
            totals: r.rows.length ? { label: 'Total', cost: r.totals.cost } : null,
            empty: 'No work orders match these settings.',
          },
        ],
      };
    },
  },
  {
    id: 'vendor-insurance',
    category: 'maintenance',
    title: 'Vendor insurance',
    description: 'Vendors whose insurance has expired, expires soon, or is not on file.',
    params: ['days', 'status'],
    daysLabel: 'Expiring within',
    statusLabel: 'Show',
    defaults: { days: 60, status: '' },
    statusOptions: [
      { value: '', label: 'Needs attention' },
      { value: 'all', label: 'All vendors' },
    ],
    run(p, env) {
      const r = R.vendorInsurance(env.store, { days: p.days, includeCurrent: p.status === 'all' }, env);
      const STATE = { expired: ['Expired', 'danger'], expiring: ['Expiring', 'warning'], missing: ['Not on file', 'neutral'], current: ['Current', 'success'] };
      return {
        summary: [
          { label: 'Expired', value: String(r.totals.expired), tone: r.totals.expired ? 'danger' : null },
          { label: 'Expiring soon', value: String(r.totals.expiring) },
          { label: 'Not on file', value: String(r.totals.missing) },
        ],
        sections: [
          {
            caption: 'Vendor insurance',
            columns: [
              col('name', 'Vendor', 'name', { render: (x) => h('a', { href: `#/vendors/${x.vendorId}` }, x.name) }),
              col('category', 'Category', 'category'),
              dateCol('expires', 'Expires'),
              col('daysLeft', 'Days left', (x) => (x.daysLeft === null ? '' : x.daysLeft), { align: 'r' }),
              col('state', 'Status', (x) => STATE[x.state][0], { render: (x) => h(`span.pill.${STATE[x.state][1]}`, STATE[x.state][0]) }),
              col('phone', 'Phone', 'phone'),
              col('email', 'Email', 'email'),
            ],
            rows: r.rows,
            empty: 'Every vendor has current insurance on file.',
          },
        ],
      };
    },
  },
  {
    id: 'open-tasks',
    category: 'maintenance',
    title: 'Open tasks',
    description: 'Tasks that are not finished, by due date and assignee.',
    params: ['assignee', 'properties'],
    run(p, env) {
      const r = R.openTasksReport(env.store, { assigneeId: p.assignee, propertyIds: p.propertyIds }, env);
      return {
        summary: [{ label: 'Open tasks', value: String(r.totals.tasks) }, { label: 'Overdue', value: String(r.totals.overdue), tone: r.totals.overdue ? 'danger' : null }],
        sections: [
          {
            caption: 'Open tasks',
            columns: [
              col('title', 'Task', 'title', { render: (x) => h('a', { href: `#/tasks/${x.taskId}` }, x.title) }),
              col('kind', 'Type', (x) => taskKindLabel(x.kind)),
              statusCol('priority', 'Priority'),
              statusCol(),
              col('dueDate', 'Due', 'dueDate', { render: (x) => (x.dueDate ? h(`span${x.overdue ? '.rpt-overdue' : ''}`, date(x.dueDate)) : '') }),
              col('assignee', 'Assigned to', 'assignee'),
              col('label', 'Property', 'label'),
            ],
            rows: r.rows,
            empty: 'No open tasks.',
          },
        ],
      };
    },
  },

  // Owners
  {
    id: 'owner-statement',
    category: 'owners',
    title: 'Owner statement',
    description: 'Cash, income, expenses and draws for one owner, by property.',
    params: ['owner', 'range'],
    defaults: { preset: 'last-month' },
    async run(p, env) {
      if (!p.owner) return { sections: [], empty: 'Add a rental owner to produce owner statements.' };
      const f = await env.financials();
      const s = f.ownerStatement(env.store, { ownerId: p.owner, from: p.from, to: p.to });
      const t = s.totals;
      const owner = lookup.owner(p.owner);
      return {
        summary: [
          { label: 'Income', value: money(t.income) },
          { label: 'Expenses', value: money(t.expenses) },
          { label: 'Net', value: money(t.income - t.expenses), tone: t.income - t.expenses >= 0 ? 'success' : 'danger' },
          { label: 'Ending cash', value: money(t.closing) },
        ],
        sections: [
          {
            title: owner ? displayName(owner) : 'Owner',
            caption: 'Owner statement',
            columns: [
              col('property', 'Property', (x) => lookup.property(x.propertyId)?.name || '', { render: (x) => h('a', { href: `#/properties/${x.propertyId}` }, lookup.property(x.propertyId)?.name || 'Property') }),
              col('pct', 'Share', (x) => (x.pct == null ? '' : `${x.pct}%`), { align: 'r' }),
              moneyCol('opening', 'Opening cash'),
              moneyCol('income', 'Income'),
              moneyCol('expenses', 'Expenses'),
              moneyCol('contributions', 'Contributions'),
              moneyCol('distributions', 'Distributions'),
              moneyCol('managementFee', 'Management fee'),
              moneyCol('closing', 'Closing cash'),
            ],
            rows: s.properties,
            totals: { label: 'Total', ...t },
            empty: 'This owner has no properties.',
            note: owner?.managementFee ? `Management fee estimated at ${owner.managementFee}% of rent collected.` : null,
          },
        ],
      };
    },
  },
  {
    id: 'owner-summary',
    category: 'owners',
    title: 'Owner summary',
    description: 'All owners side by side: properties, income, expenses and net.',
    params: ['range'],
    defaults: { preset: 'this-year' },
    run(p, env) {
      const r = R.ownerSummary(env.store, { from: p.from, to: p.to });
      return {
        summary: [{ label: 'Owners', value: String(r.totals.owners) }, { label: 'Income', value: money(r.totals.income) }, { label: 'Net', value: money(r.totals.net) }],
        sections: [
          {
            caption: 'Owner summary',
            columns: [
              col('name', 'Owner', 'name', { render: (x) => h('a', { href: `#/owners/${x.ownerId}` }, x.name) }),
              col('properties', 'Properties', 'properties', { align: 'r' }),
              col('units', 'Units', 'units', { align: 'r' }),
              moneyCol('income', 'Income'),
              moneyCol('expense', 'Expenses'),
              moneyCol('net', 'Net'),
              col('fee', 'Fee', (x) => (x.fee ? `${x.fee}%` : ''), { align: 'r' }),
            ],
            rows: r.rows,
            totals: r.rows.length ? { label: 'Total', income: r.totals.income, expense: r.totals.expense, net: r.totals.net } : null,
            empty: 'No rental owners yet.',
          },
        ],
      };
    },
  },
];

export const reportById = (id) => REPORTS.find((r) => r.id === id) || null;

