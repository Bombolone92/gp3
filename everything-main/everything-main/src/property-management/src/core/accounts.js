/**
 * Chart of accounts. Every amount in the ledger posts to one of these.
 *
 * Accounts with a `role` are the ones the app posts to by itself (rent,
 * receivables, deposits held, payables, ...). They have fixed ids so two
 * devices that create the default chart at the same time write the same
 * records instead of duplicates. Users can rename them but not delete them.
 */

export const ACCOUNT_TYPES = [
  { id: 'asset', label: 'Asset', normal: 1 },
  { id: 'liability', label: 'Liability', normal: -1 },
  { id: 'equity', label: 'Equity', normal: -1 },
  { id: 'income', label: 'Income', normal: -1 },
  { id: 'expense', label: 'Expense', normal: 1 },
];

export const TYPE_ORDER = ['asset', 'liability', 'equity', 'income', 'expense'];

export function typeLabel(type) {
  return ACCOUNT_TYPES.find((t) => t.id === type)?.label || '';
}

/** +1 for debit-normal accounts (assets, expenses), -1 for credit-normal. */
export function normalSign(type) {
  return ACCOUNT_TYPES.find((t) => t.id === type)?.normal ?? 1;
}

/** Well-known account ids used by the posting logic. */
export const ACC = {
  operating: 'acc-operating',
  depositsBank: 'acc-deposits',
  ar: 'acc-ar',
  ap: 'acc-ap',
  depositsHeld: 'acc-deposits-held',
  prepaid: 'acc-prepaid',
  contributions: 'acc-contributions',
  distributions: 'acc-distributions',
  retained: 'acc-retained',
  rent: 'acc-rent',
  lateFees: 'acc-late-fees',
  applicationFees: 'acc-application-fees',
  repairs: 'acc-repairs',
  managementFees: 'acc-management-fees',
};

// [id, number, name, type, extra]
const DEFAULTS = [
  [ACC.operating, '1000', 'Operating bank account', 'asset', { bank: true, role: 'bank', description: 'Rent and operating funds' }],
  [ACC.depositsBank, '1010', 'Security deposit bank account', 'asset', { bank: true, role: 'bank', description: 'Tenant security deposits' }],
  [ACC.ar, '1200', 'Accounts receivable', 'asset', { role: 'ar', description: 'What tenants owe' }],
  ['acc-prepaid-expenses', '1300', 'Prepaid expenses', 'asset', {}],
  ['acc-buildings', '1500', 'Buildings and improvements', 'asset', {}],
  [ACC.ap, '2000', 'Accounts payable', 'liability', { role: 'ap', description: 'Unpaid vendor bills' }],
  [ACC.depositsHeld, '2100', 'Security deposits held', 'liability', { role: 'deposits', description: 'Deposits owed back to tenants' }],
  [ACC.prepaid, '2200', 'Prepaid rent', 'liability', { role: 'prepaid' }],
  ['acc-mortgage', '2500', 'Mortgage payable', 'liability', {}],
  [ACC.contributions, '3000', 'Owner contributions', 'equity', { role: 'contributions' }],
  [ACC.distributions, '3100', 'Owner distributions', 'equity', { role: 'distributions' }],
  [ACC.retained, '3900', 'Retained earnings', 'equity', { role: 'retained' }],
  [ACC.rent, '4000', 'Rent income', 'income', { role: 'rent' }],
  [ACC.lateFees, '4100', 'Late fee income', 'income', { role: 'late-fees' }],
  [ACC.applicationFees, '4200', 'Application fee income', 'income', {}],
  ['acc-pet-fees', '4300', 'Pet fee income', 'income', {}],
  ['acc-parking', '4400', 'Parking income', 'income', {}],
  ['acc-utility-income', '4500', 'Utility reimbursements', 'income', {}],
  ['acc-chargebacks', '4600', 'Repair and damage charges', 'income', {}],
  ['acc-other-income', '4900', 'Other income', 'income', {}],
  [ACC.repairs, '5000', 'Repairs and maintenance', 'expense', {}],
  ['acc-utilities', '5100', 'Utilities', 'expense', {}],
  ['acc-insurance', '5200', 'Insurance', 'expense', {}],
  ['acc-property-tax', '5300', 'Property taxes', 'expense', {}],
  ['acc-landscaping', '5400', 'Landscaping and snow removal', 'expense', {}],
  ['acc-cleaning', '5500', 'Cleaning and turnover', 'expense', {}],
  ['acc-advertising', '5600', 'Advertising', 'expense', {}],
  ['acc-legal', '5700', 'Legal and professional fees', 'expense', {}],
  [ACC.managementFees, '5800', 'Management fees', 'expense', {}],
  ['acc-supplies', '5900', 'Supplies', 'expense', {}],
  ['acc-mortgage-interest', '6000', 'Mortgage interest', 'expense', {}],
  ['acc-hoa', '6100', 'HOA dues', 'expense', {}],
  ['acc-bank-fees', '6200', 'Bank fees', 'expense', {}],
  ['acc-other-expense', '6900', 'Other expenses', 'expense', {}],
];

export function defaultAccounts() {
  return DEFAULTS.map(([id, number, name, type, extra]) => ({
    id,
    number,
    name,
    type,
    active: true,
    system: !!extra.role,
    ...extra,
  }));
}

export function accountLabel(acc) {
  if (!acc) return 'Unknown account';
  return acc.number ? `${acc.number} · ${acc.name}` : acc.name;
}

/** Sort by type order, then number, then name. */
export function compareAccounts(a, b) {
  const t = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
  if (t) return t;
  return String(a.number || '').localeCompare(String(b.number || ''), undefined, { numeric: true }) || a.name.localeCompare(b.name);
}

export function bankAccounts(accounts) {
  return accounts.filter((a) => a.bank && a.active !== false).sort(compareAccounts);
}

/** Accounts a lease charge can be for: income accounts plus deposits held. */
export function chargeableAccounts(accounts) {
  return accounts.filter((a) => a.active !== false && (a.type === 'income' || a.role === 'deposits' || a.role === 'prepaid')).sort(compareAccounts);
}

export function expenseAccounts(accounts) {
  return accounts.filter((a) => a.active !== false && (a.type === 'expense' || (a.type === 'asset' && !a.bank && !a.role))).sort(compareAccounts);
}

/** Group accounts for <select> option groups: [{ label, accounts }]. */
export function groupAccounts(accounts) {
  return TYPE_ORDER.map((t) => ({ label: `${typeLabel(t)} accounts`, type: t, accounts: accounts.filter((a) => a.type === t).sort(compareAccounts) })).filter((g) => g.accounts.length);
}
