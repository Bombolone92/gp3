/** Settings > Data: backup and restore, CSV exports, sample data, delete all. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { field, textInput } from '../../ui/components.js';
import { openDialog, confirmDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { navigate } from '../../ui/router.js';
import { COLLECTIONS } from '../../core/store.js';
import { defaultSettings } from '../../core/settings.js';
import { ensureDefaults } from '../../core/bootstrap.js';
import { downloadText } from '../../core/csv.js';
import { exportBackup, importBackup, validateBackup, recordCounts } from '../../core/backup.js';
import { formatAddress, personName, displayName } from '../../core/format.js';
import { kindLabel, txTotal } from '../../core/ledger.js';
import { accountLabel } from '../../core/accounts.js';
import { propertyTypeLabel } from '../../core/settings.js';
import { exportCSV, csvMoney } from '../common.js';

const LABELS = {
  properties: 'Properties',
  units: 'Units',
  leases: 'Leases',
  tenants: 'Tenants',
  owners: 'Rental owners',
  vendors: 'Vendors',
  applicants: 'Applicants',
  workOrders: 'Work orders',
  tasks: 'Tasks',
  accounts: 'Accounts',
  reconciliations: 'Reconciliations',
  budgets: 'Budgets',
  inspections: 'Inspections',
  messages: 'Messages',
  events: 'Calendar events',
  team: 'Team members',
  transactions: 'Transactions',
};

export function dataSection() {
  const store = app.store;
  const s = app.settings();
  const counts = recordCounts(store);
  const total = Object.values(counts).reduce((a, n) => a + n, 0);
  const hasSample = COLLECTIONS.some((c) => store.all(c).some((r) => r.sample));

  const downloadBackup = async () => {
    // A backup is a safety net, so it is made even offline, with a warning.
    const current = await upToDate(null);
    const data = exportBackup(store);
    downloadText(`property-management-backup-${app.today()}.json`, JSON.stringify(data), 'application/json');
    if (current) toast('Backup downloaded');
    else toast('Backup downloaded from this device. Your account could not be reached, so changes made on other devices since this one last synced may be missing.', { type: 'info', duration: 9000 });
  };

  const restore = () => {
    const input = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        toast('That file is not a valid backup.', { type: 'error' });
        return;
      }
      const v = validateBackup(data);
      if (!v.ok) {
        toast(v.error, { type: 'error' });
        return;
      }
      chooseRestoreMode(data, v.count, total);
    });
    document.body.append(input);
    input.click();
  };

  const loadSample = async () => {
    if (total > store.all('accounts').length && !(await confirmDialog({ title: 'Add the sample portfolio?', message: 'Sample properties, tenants, leases and a year of transactions are added next to your own records. You can remove them later from here.', confirmLabel: 'Add sample portfolio' }))) return;
    const { buildSampleData } = await import('../../core/sample.js');
    const data = buildSampleData(app.today());
    for (const [c, recs] of Object.entries(data.collections)) store.bulkPut(c, recs.map((r) => (c === 'accounts' && store.get('accounts', r.id) ? store.get('accounts', r.id) : { ...r, sample: c !== 'accounts' })));
    store.saveSettings({ sampleData: true, onboarded: true, ...(s.company?.name ? {} : { company: data.settings.company }) });
    toast('Sample portfolio added');
  };

  const clearSample = async () => {
    if (!(await confirmDialog({ title: 'Remove the sample portfolio?', message: 'Only records that came from the sample portfolio are deleted. Your own records stay.', confirmLabel: 'Remove sample data', danger: true }))) return;
    // Sample records are flagged; ledger entries made later on sample
    // leases, properties or vendors (auto-posted rent, payments you tried
    // out) go with them so the books do not keep orphans.
    const gone = new Set();
    for (const c of COLLECTIONS) {
      if (c === 'transactions') continue;
      const ids = store.all(c).filter((r) => r.sample).map((r) => r.id);
      for (const id of ids) gone.add(id);
      if (ids.length) store.bulkRemove(c, ids);
    }
    const txs = store.all('transactions');
    const goneTx = new Set(txs.filter((t) => t.sample).map((t) => t.id));
    const touches = (t) =>
      [t.leaseId, t.propertyId, t.unitId, t.vendorId, t.ownerId].some((id) => id && gone.has(id)) ||
      (t.lines || []).some((l) => [l.leaseId, l.propertyId, l.vendorId, l.ownerId].some((id) => id && gone.has(id)));
    for (const t of txs) if (touches(t)) goneTx.add(t.id);
    // Bill payments for removed bills go too.
    for (const t of txs) if ((t.allocations || []).some((a) => goneTx.has(a.billId))) goneTx.add(t.id);
    if (goneTx.size) store.bulkRemove('transactions', [...goneTx]);
    store.saveSettings({ sampleData: false });
    toast('Sample data removed');
  };

  const exports = [
    { label: 'Tenants', icon: 'users', run: exportTenants },
    { label: 'Properties', icon: 'building', run: exportProperties },
    { label: 'Units', icon: 'door', run: exportUnits },
    { label: 'Vendors', icon: 'truck', run: exportVendors },
    { label: 'Transactions', icon: 'book', run: exportTransactions },
  ];

  return h(
    'div.stack.settings-stack',
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Your data')),
      h(
        'div.card-body.stack',
        h('p.muted', app.demo ? 'This is a demo. Nothing is saved to the cloud.' : 'Your records are stored in your own Puter account and kept on this device so the app opens instantly and works offline.'),
        total
          ? h(
              'dl.kv.data-counts',
              Object.entries(counts)
                .filter(([, n]) => n)
                .map(([c, n]) => [h('dt', LABELS[c] || c), h('dd.num', n.toLocaleString())]),
            )
          : h('p.subtle', 'No records yet.'),
      ),
    ),
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Backup and restore')),
      h(
        'div.card-body.stack',
        h('p.subtle', 'A backup is one file with your settings and every record, including the full ledger. Keep one before large changes.'),
        h('div.row.wrap', h('button.btn', { type: 'button', onClick: downloadBackup }, icon('download', 16), 'Download backup'), h('button.btn', { type: 'button', onClick: restore }, icon('upload', 16), 'Restore from backup')),
      ),
    ),
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Export to CSV')),
      h('div.card-body.stack', h('p.subtle', 'Spreadsheet-friendly lists. Every report can also be exported from its own page.'), h('div.row.wrap', exports.map((e) => h('button.btn', { type: 'button', onClick: e.run }, icon(e.icon, 16), e.label)))),
    ),
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Sample portfolio')),
      h(
        'div.card-body.stack',
        h('p.muted', 'Explore with five sample properties, their tenants and a year of rent history. Remove them when you are ready to start.'),
        // Adding it twice would double its ledger, so offer one or the other.
        h('div.row.wrap', hasSample ? h('button.btn', { type: 'button', onClick: clearSample }, icon('trash', 16), 'Remove sample data') : h('button.btn', { type: 'button', onClick: loadSample }, icon('sparkles', 16), 'Add sample portfolio')),
      ),
    ),
    h(
      'section.card.danger-zone',
      h('div.card-head', h('h2.grow', 'Danger zone')),
      h('div.card-body.row.wrap', h('p.grow.muted', 'Permanently delete every record, including the ledger, and reset settings.'), h('button.btn.danger', { type: 'button', onClick: () => deleteAll(total) }, 'Delete all data')),
    ),
  );
}

function chooseRestoreMode(data, count, current) {
  openDialog({
    title: 'Restore this backup?',
    size: 'narrow',
    body: h(
      'div.stack',
      h('p', `The backup has ${count.toLocaleString()} records${data.exportedAt ? `, saved ${new Date(data.exportedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}.`),
      h('p.subtle', `Replace removes the ${current.toLocaleString()} records you have now. Merge keeps them and adds or updates the records from the backup.`),
    ),
    footer: ({ close }) => [
      h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
      h('div.spacer'),
      h('button.btn', { type: 'button', onClick: () => (close(), run('merge')) }, 'Merge'),
      h('button.btn.danger', { type: 'button', onClick: () => (close(), run('replace')) }, 'Replace everything'),
    ],
  });
  const run = (mode) => restoreBackup(data, mode);
}

/**
 * Bring this device up to date with the account before acting on all of
 * it, so a restore, a delete or a backup covers records added on other
 * devices too. Says so and returns false when it cannot.
 */
async function upToDate(notDone) {
  const store = app.store;
  if (app.demo) return true;
  await store.sync();
  if (store.state.synced && store.state.online) return true;
  if (notDone) toast(`Your latest data could not be loaded, so ${notDone}. Check your connection and try again.`, { type: 'error' });
  return false;
}

export async function restoreBackup(data, mode) {
  if (mode === 'replace' && !(await upToDate('nothing was restored'))) return false;
  try {
    const { count: n } = importBackup(app.store, data, { mode });
    ensureDefaults(app.store);
    toast(`Restored ${n.toLocaleString()} records`);
    return true;
  } catch (err) {
    toast(err.message || 'The backup could not be restored.', { type: 'error' });
    return false;
  }
}

export async function deleteEverything() {
  if (!(await upToDate('nothing was deleted'))) return false;
  const store = app.store;
  for (const c of COLLECTIONS) {
    const ids = store.all(c).map((r) => r.id);
    if (ids.length) store.bulkRemove(c, ids);
  }
  store.saveSettings({ ...defaultSettings(), onboarded: true });
  ensureDefaults(store);
  toast('All data deleted');
  navigate('/');
  return true;
}

function deleteAll(total) {
  const input = textInput({ name: 'confirm', autocomplete: 'off', placeholder: 'DELETE' });
  openDialog({
    title: 'Delete all data?',
    size: 'narrow',
    body: h(
      'div.stack',
      h('p', `This permanently deletes all ${total.toLocaleString()} records and resets settings. Download a backup first if you might need anything.`),
      field('Type DELETE to confirm', input),
    ),
    footer: ({ close }) => {
      const btn = h(
        'button.btn.danger',
        {
          type: 'button',
          disabled: true,
          onClick: () => {
            if (input.value.trim() !== 'DELETE') return;
            close();
            deleteEverything();
          },
        },
        'Delete everything',
      );
      input.addEventListener('input', () => (btn.disabled = input.value.trim() !== 'DELETE'));
      return [h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'), btn];
    },
  });
}

// ---- CSV exports ---------------------------------------------------------------------

const join = (list) => (list || []).filter(Boolean).join('; ');

function exportTenants() {
  const rows = app.store.all('tenants');
  exportCSV(`tenants-${app.today()}`, [
    { label: 'First name', value: (t) => t.firstName || '' },
    { label: 'Last name', value: (t) => t.lastName || '' },
    { label: 'Company', value: (t) => t.company || '' },
    { label: 'Emails', value: (t) => join(t.emails) },
    { label: 'Phones', value: (t) => join(t.phones) },
    { label: 'Emergency contact', value: (t) => [t.emergency?.name, t.emergency?.relation, t.emergency?.phone].filter(Boolean).join(', ') },
  ], rows);
}

function exportProperties() {
  exportCSV(`properties-${app.today()}`, [
    { label: 'Name', value: (p) => p.name },
    { label: 'Type', value: (p) => propertyTypeLabel(p.type) },
    { label: 'Address', value: (p) => formatAddress(p.address) },
    { label: 'Units', value: (p) => app.store.all('units').filter((u) => u.propertyId === p.id).length },
    { label: 'Owners', value: (p) => (p.owners || []).map((o) => `${displayName(lookup.owner(o.ownerId))} (${o.pct}%)`).join('; ') },
    { label: 'Year built', value: (p) => p.yearBuilt || '' },
    { label: 'Active', value: (p) => (p.active === false ? 'No' : 'Yes') },
  ], app.store.all('properties'));
}

function exportUnits() {
  exportCSV(`units-${app.today()}`, [
    { label: 'Property', value: (u) => lookup.property(u.propertyId)?.name || '' },
    { label: 'Unit', value: (u) => u.name },
    { label: 'Bedrooms', value: (u) => u.beds ?? '' },
    { label: 'Bathrooms', value: (u) => u.baths ?? '' },
    { label: 'Square feet', value: (u) => u.sqft ?? '' },
    { label: 'Market rent', value: (u) => csvMoney(u.marketRent) },
    { label: 'Listed', value: (u) => (u.listing?.listed ? 'Yes' : 'No') },
  ], app.store.all('units'));
}

function exportVendors() {
  exportCSV(`vendors-${app.today()}`, [
    { label: 'Name', value: (v) => displayName(v) },
    { label: 'Contact', value: (v) => (v.company ? [v.firstName, v.lastName].filter(Boolean).join(' ') : personName(v)) },
    { label: 'Category', value: (v) => v.category || '' },
    { label: 'Emails', value: (v) => join(v.emails) },
    { label: 'Phones', value: (v) => join(v.phones) },
    { label: 'Insurance expires', value: (v) => v.insuranceExpires || '' },
    { label: 'Active', value: (v) => (v.active === false ? 'No' : 'Yes') },
  ], app.store.all('vendors'));
}

/** One row per transaction line, so the export balances in a spreadsheet. */
function exportTransactions() {
  const rows = [];
  const txs = [...app.store.all('transactions')].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const tx of txs) for (const line of tx.lines) rows.push({ tx, line });
  exportCSV(`transactions-${app.today()}`, [
    { label: 'Date', value: (r) => r.tx.date },
    { label: 'Type', value: (r) => kindLabel(r.tx.kind) },
    { label: 'Transaction', value: (r) => r.tx.id },
    { label: 'Reference', value: (r) => r.tx.ref || '' },
    { label: 'Memo', value: (r) => r.line.memo || r.tx.memo || '' },
    { label: 'Account', value: (r) => accountLabel(lookup.account(r.line.accountId)) },
    { label: 'Property', value: (r) => lookup.property(r.line.propertyId)?.name || '' },
    { label: 'Unit', value: (r) => lookup.unit(r.line.unitId)?.name || '' },
    { label: 'Debit', value: (r) => (r.line.amount > 0 ? csvMoney(r.line.amount) : '') },
    { label: 'Credit', value: (r) => (r.line.amount < 0 ? csvMoney(-r.line.amount) : '') },
    { label: 'Transaction total', value: (r) => csvMoney(txTotal(r.tx)) },
    { label: 'Void', value: (r) => (r.tx.voided ? 'Yes' : '') },
  ], rows);
}
