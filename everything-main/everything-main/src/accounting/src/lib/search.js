/**
 * Global search over the in-memory books. The haystack strings are built
 * once per store version; a query is a linear scan with early exit, which
 * is well under a frame for tens of thousands of transactions.
 */
import { typeLabel, TXN_TYPES } from './txn.js';
import { parseMoney } from './money.js';
import { REPORTS } from './reports.js';

function norm(s) {
  return String(s || '').toLowerCase();
}

function index(store) {
  return store.memo('searchIndex', () => {
    const txns = [];
    for (const t of store.txnList()) {
      txns.push({
        t,
        hay: norm([typeLabel(t.type), t.num, store.contactName(t.contactId), t.memo, t.ref, ...(t.lines || []).map((l) => l.desc)].filter(Boolean).join(' ')),
        num: norm(t.num),
        total: store.total(t),
      });
    }
    const contacts = [...store.contacts.values()].map((c) => ({ c, hay: norm([c.displayName, c.company, c.email, c.phone].join(' ')) }));
    const accounts = store.chart().map(({ account: a }) => ({ a, hay: norm(`${a.number || ''} ${a.name} ${a.description || ''}`) }));
    const items = store.itemsList().map((i) => ({ i, hay: norm(`${i.name} ${i.sku || ''} ${i.desc || ''}`) }));
    return { txns, contacts, accounts, items };
  });
}

export const PAGES = [
  ['Home', 'home', 'dashboard overview'],
  ['Banking', 'banking', 'bank transactions review import statement'],
  ['Reconcile', 'reconcile', 'statement'],
  ['Bank rules', 'rules', 'categorize automatically'],
  ['Chart of accounts', 'accounts', 'ledger'],
  ['Recurring transactions', 'recurring', 'schedule templates'],
  ['All sales', 'sales', 'sales transactions'],
  ['Invoices', 'invoices', 'unpaid overdue'],
  ['Estimates', 'estimates', 'quotes'],
  ['Customers', 'customers', 'clients'],
  ['Products and services', 'items', 'items price list'],
  ['All purchases', 'expenses', 'expenses spending'],
  ['Bills', 'bills', 'unpaid payable'],
  ['Vendors', 'vendors', 'suppliers'],
  ['Reports', 'reports', 'financial statements'],
  ['Sales tax', 'sales-tax', 'tax rates'],
  ['Settings', 'settings', 'company preferences'],
  ['Audit log', 'audit', 'history changes'],
];

/**
 * Returns [{ group, items: [{ label, sub, route, kind }] }].
 */
export function search(store, query, { limit = 8 } = {}) {
  const q = norm(query).trim();
  if (!q) return [];
  const ix = index(store);
  const groups = [];
  const words = q.split(/\s+/);
  const hit = (hay) => words.every((w) => hay.includes(w));

  const pages = PAGES.filter(([label, , extra]) => hit(norm(`${label} ${extra}`))).slice(0, 4)
    .map(([label, route]) => ({ label, sub: 'Go to page', route, kind: 'page' }));
  const reports = REPORTS.filter((r) => hit(norm(`${r.title} ${r.group}`))).slice(0, 4)
    .map((r) => ({ label: r.title, sub: 'Report', route: `report/${r.id}`, kind: 'report' }));

  const amount = /^[\d$.,()-]+$/.test(q) ? Math.abs(parseMoney(q)) : 0;
  const txns = [];
  for (const e of ix.txns) {
    const numMatch = e.num && (e.num === q || e.num.startsWith(q));
    const amtMatch = amount && Math.abs(e.total) === amount;
    if (numMatch || amtMatch || hit(e.hay)) {
      txns.push({ e, rank: numMatch ? 0 : amtMatch ? 1 : 2 });
      if (txns.length > 200) break;
    }
  }
  txns.sort((a, b) => a.rank - b.rank);
  const txnItems = txns.slice(0, limit).map(({ e }) => ({
    label: `${typeLabel(e.t.type)}${e.t.num ? ` ${e.t.num}` : ''}`,
    sub: [e.t.date, store.contactName(e.t.contactId)].filter(Boolean).join(' · '),
    amount: e.total,
    route: `txn/${e.t.id}`,
    kind: 'txn',
    txnType: e.t.type,
  }));

  const contacts = ix.contacts.filter((x) => hit(x.hay)).slice(0, limit).map(({ c }) => ({
    label: c.displayName, sub: c.kind === 'vendor' ? 'Vendor' : 'Customer', route: `${c.kind === 'vendor' ? 'vendor' : 'customer'}/${c.id}`, kind: 'contact',
  }));
  const accounts = ix.accounts.filter((x) => hit(x.hay)).slice(0, 5).map(({ a }) => ({
    label: store.accountName(a.id), sub: 'Account', route: `register/${a.id}`, kind: 'account',
  }));
  const items = ix.items.filter((x) => hit(x.hay)).slice(0, 5).map(({ i }) => ({
    label: i.name, sub: 'Item', route: `items?edit=${i.id}`, kind: 'item',
  }));

  const create = Object.entries(TXN_TYPES)
    .filter(([, m]) => hit(norm(`new create ${m.label} add`)))
    .slice(0, 3)
    .map(([type, m]) => ({ label: `New ${m.label.toLowerCase()}`, sub: 'Create', route: `new/${m.route}`, kind: 'create', txnType: type }));

  if (create.length && words.some((w) => ['new', 'create', 'add'].includes(w))) groups.push({ group: 'Create', items: create });
  if (txnItems.length) groups.push({ group: 'Transactions', items: txnItems });
  if (contacts.length) groups.push({ group: 'Contacts', items: contacts });
  if (accounts.length) groups.push({ group: 'Accounts', items: accounts });
  if (items.length) groups.push({ group: 'Products and services', items });
  if (reports.length) groups.push({ group: 'Reports', items: reports });
  if (pages.length) groups.push({ group: 'Pages', items: pages });
  if (create.length && !groups.some((g) => g.group === 'Create')) groups.push({ group: 'Create', items: create });
  return groups;
}
