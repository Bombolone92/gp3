/**
 * Account types and the default chart of accounts.
 *
 * `cls` is the statement class, `sign` the normal balance (+1 debit, -1
 * credit). Balances are kept as debit-positive sums of postings; a report
 * multiplies by `sign` so an income account with credits shows positive.
 */
export const ACCOUNT_TYPES = {
  bank: { label: 'Bank', cls: 'asset', group: 'currentAssets', sign: 1, order: 10, register: true },
  ar: { label: 'Accounts receivable (A/R)', cls: 'asset', group: 'currentAssets', sign: 1, order: 20 },
  otherCurrentAsset: { label: 'Other current assets', cls: 'asset', group: 'currentAssets', sign: 1, order: 30, register: true },
  fixedAsset: { label: 'Fixed assets', cls: 'asset', group: 'fixedAssets', sign: 1, order: 40, register: true },
  otherAsset: { label: 'Other assets', cls: 'asset', group: 'otherAssets', sign: 1, order: 50, register: true },
  ap: { label: 'Accounts payable (A/P)', cls: 'liability', group: 'currentLiabilities', sign: -1, order: 60 },
  creditCard: { label: 'Credit card', cls: 'liability', group: 'currentLiabilities', sign: -1, order: 70, register: true },
  otherCurrentLiability: { label: 'Other current liabilities', cls: 'liability', group: 'currentLiabilities', sign: -1, order: 80, register: true },
  longTermLiability: { label: 'Long-term liabilities', cls: 'liability', group: 'longTermLiabilities', sign: -1, order: 90, register: true },
  equity: { label: 'Equity', cls: 'equity', group: 'equity', sign: -1, order: 100, register: true },
  income: { label: 'Income', cls: 'income', group: 'income', sign: -1, order: 110 },
  otherIncome: { label: 'Other income', cls: 'income', group: 'otherIncome', sign: -1, order: 120 },
  cogs: { label: 'Cost of goods sold', cls: 'expense', group: 'cogs', sign: 1, order: 130 },
  expense: { label: 'Expenses', cls: 'expense', group: 'expenses', sign: 1, order: 140 },
  otherExpense: { label: 'Other expense', cls: 'expense', group: 'otherExpenses', sign: 1, order: 150 },
};

export const TYPE_KEYS = Object.keys(ACCOUNT_TYPES);

export function typeInfo(type) {
  return ACCOUNT_TYPES[type] || ACCOUNT_TYPES.expense;
}

export function isBalanceSheet(type) {
  const c = typeInfo(type).cls;
  return c === 'asset' || c === 'liability' || c === 'equity';
}

export function isProfitAndLoss(type) {
  return !isBalanceSheet(type);
}

/** Accounts money can be paid from: bank and credit card (plus cash-like assets). */
export function isPaymentAccount(type) {
  return type === 'bank' || type === 'creditCard' || type === 'otherCurrentAsset';
}

export function isBankLike(type) {
  return type === 'bank' || type === 'creditCard';
}

/**
 * Roles mark the accounts the bookkeeping engine itself depends on. There is
 * exactly one of each; the user can rename them but not delete them.
 */
export const ROLES = {
  ar: 'Accounts Receivable',
  ap: 'Accounts Payable',
  undeposited: 'Undeposited Funds',
  salesTax: 'Sales Tax Payable',
  openingBalance: 'Opening Balances',
  retainedEarnings: 'Retained Earnings',
  inventory: 'Inventory Asset',
  cogs: 'Cost of Goods Sold',
  sales: 'Sales',
  uncategorizedIncome: 'Uncategorized Income',
  uncategorizedExpense: 'Uncategorized Expense',
  uncategorizedAsset: 'Uncategorized Asset',
  reconDiscrepancy: 'Reconciliation Adjustments',
  discounts: 'Discounts Given',
};

/** [number, name, type, role?, description?] */
export const DEFAULT_CHART = [
  ['1000', 'Checking', 'bank', null, 'Primary business checking account'],
  ['1010', 'Savings', 'bank'],
  ['1100', 'Accounts Receivable', 'ar', 'ar', 'Amounts customers owe you'],
  ['1200', 'Undeposited Funds', 'otherCurrentAsset', 'undeposited', 'Payments received but not yet deposited'],
  ['1300', 'Inventory Asset', 'otherCurrentAsset', 'inventory'],
  ['1400', 'Prepaid Expenses', 'otherCurrentAsset'],
  ['1499', 'Uncategorized Asset', 'otherCurrentAsset', 'uncategorizedAsset'],
  ['1500', 'Furniture and Equipment', 'fixedAsset'],
  ['1590', 'Accumulated Depreciation', 'fixedAsset'],
  ['2000', 'Accounts Payable', 'ap', 'ap', 'Amounts you owe vendors'],
  ['2100', 'Credit Card', 'creditCard'],
  ['2200', 'Sales Tax Payable', 'otherCurrentLiability', 'salesTax', 'Sales tax collected and owed to tax agencies'],
  ['2300', 'Payroll Liabilities', 'otherCurrentLiability'],
  ['2700', 'Loans Payable', 'longTermLiability'],
  ['3000', 'Opening Balances', 'equity', 'openingBalance'],
  ['3100', "Owner's Investment", 'equity'],
  ['3200', "Owner's Draw", 'equity'],
  ['3900', 'Retained Earnings', 'equity', 'retainedEarnings'],
  ['4000', 'Sales', 'income', 'sales', 'Income from selling products and services'],
  ['4100', 'Services', 'income'],
  ['4200', 'Discounts Given', 'income', 'discounts'],
  ['4900', 'Uncategorized Income', 'income', 'uncategorizedIncome'],
  ['5000', 'Cost of Goods Sold', 'cogs', 'cogs'],
  ['6000', 'Advertising and Marketing', 'expense'],
  ['6010', 'Bank Charges and Fees', 'expense'],
  ['6020', 'Car and Truck', 'expense'],
  ['6030', 'Contractors', 'expense'],
  ['6040', 'Depreciation', 'expense'],
  ['6050', 'Insurance', 'expense'],
  ['6060', 'Interest Paid', 'expense'],
  ['6070', 'Legal and Professional Services', 'expense'],
  ['6080', 'Meals', 'expense'],
  ['6090', 'Office Supplies and Software', 'expense'],
  ['6100', 'Payroll Expenses', 'expense'],
  ['6110', 'Rent and Lease', 'expense'],
  ['6120', 'Repairs and Maintenance', 'expense'],
  ['6130', 'Taxes and Licenses', 'expense'],
  ['6140', 'Travel', 'expense'],
  ['6150', 'Utilities', 'expense'],
  ['6999', 'Uncategorized Expense', 'expense', 'uncategorizedExpense'],
  ['7000', 'Interest Earned', 'otherIncome'],
  ['7100', 'Other Income', 'otherIncome'],
  ['8000', 'Reconciliation Adjustments', 'otherExpense', 'reconDiscrepancy'],
];

/** Build account records for a new company. `makeId` supplies ids. */
export function defaultAccounts(makeId, now = Date.now()) {
  return DEFAULT_CHART.map(([number, name, type, role, description]) => ({
    id: makeId(),
    number,
    name,
    type,
    role: role || null,
    description: description || '',
    parentId: null,
    active: true,
    createdAt: now,
  }));
}

/** "1000 Checking" or "Checking", with the parent path: "Utilities:Electric". */
export function accountLabel(account, byId, { withNumber = true } = {}) {
  if (!account) return '';
  const names = [account.name];
  let p = account.parentId && byId ? byId.get(account.parentId) : null;
  let guard = 0;
  while (p && guard++ < 10) {
    names.unshift(p.name);
    p = p.parentId ? byId.get(p.parentId) : null;
  }
  const full = names.join(':');
  return withNumber && account.number ? `${account.number} ${full}` : full;
}

/**
 * Accounts in chart order: by type order, then number, then name, with each
 * sub-account directly under its parent. Returns [{ account, depth }].
 */
export function sortChart(accounts) {
  const byParent = new Map();
  const ids = new Set(accounts.map((a) => a.id));
  for (const a of accounts) {
    const parent = a.parentId && ids.has(a.parentId) ? a.parentId : null;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(a);
  }
  const cmp = (a, b) =>
    typeInfo(a.type).order - typeInfo(b.type).order ||
    (a.number || '').localeCompare(b.number || '', undefined, { numeric: true }) ||
    a.name.localeCompare(b.name);
  for (const list of byParent.values()) list.sort(cmp);
  const out = [];
  const walk = (parent, depth) => {
    for (const a of byParent.get(parent) || []) {
      out.push({ account: a, depth });
      if (depth < 8) walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Ids of an account and all its descendants. */
export function descendantIds(accountId, accounts) {
  const out = new Set([accountId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of accounts) {
      if (a.parentId && out.has(a.parentId) && !out.has(a.id)) {
        out.add(a.id);
        grew = true;
      }
    }
  }
  return out;
}
