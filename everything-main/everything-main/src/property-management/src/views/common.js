/**
 * Helpers shared by many screens: formatting, links to records, pickers,
 * contact and address editors, notes, tabs, CSV export.
 */
import { h, uniqueId } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, occupancyMap } from '../app.js';
import { field, textInput, textarea, select, tabs, combobox, statusPill } from '../ui/components.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { setQuery, currentRoute } from '../ui/router.js';
import { formatMoney } from '../core/money.js';
import { formatDate } from '../core/dates.js';
import { displayName, formatAddress, matches, personName, initials } from '../core/format.js';
import { accountLabel, groupAccounts, bankAccounts } from '../core/accounts.js';
import { leaseStatus, tenantName, unitLabel } from '../core/leases.js';
import { toCSV, downloadText } from '../core/csv.js';
import { newId } from '../core/ids.js';

export { field, openDialog, statusPill };

// ---- Formatting -------------------------------------------------------------------

export const money = (c) => formatMoney(c, app.settings().currency);

/** Money in a table cell: tabular figures, negatives (credits) marked. */
export function moneyCell(cents, { credit = false, zero = '' } = {}) {
  if (!cents && zero) return h('span.subtle', zero);
  return h(`span.num${cents < 0 || credit ? '.credit' : ''}`, money(cents));
}

/** A balance: red when owed, green when in credit. */
export function balanceCell(cents) {
  if (!cents) return h('span.num.subtle', money(0));
  return h(`span.num${cents > 0 ? '.owed' : '.credit'}`, money(cents));
}

export const date = (iso, opts) => (iso ? formatDate(iso, opts) : '');
export const shortDate = (iso) => (iso ? formatDate(iso, { month: 'short', day: 'numeric' }) : '');

// ---- Links -------------------------------------------------------------------------

export function recordLink(href, text, { sub } = {}) {
  return h('a.record-link', { href }, h('span.record-title', text), sub ? h('span.record-sub', sub) : null);
}

export function propertyLink(id) {
  const p = lookup.property(id);
  return p ? h('a', { href: `#/properties/${p.id}` }, p.name) : h('span.subtle', 'No property');
}

export function unitLink(unitId) {
  const u = lookup.unit(unitId);
  if (!u) return h('span.subtle', 'No unit');
  return h('a', { href: `#/units/${u.id}` }, lookup.unitLabel(u.id));
}

export function leaseLink(lease, { withTenants = true } = {}) {
  if (!lease) return h('span.subtle', 'No lease');
  const names = lookup.tenantNames(lease);
  return recordLink(`#/leases/${lease.id}`, lookup.leaseLabel(lease), { sub: withTenants ? names || 'No tenants' : null });
}

export function tenantLink(id) {
  const t = lookup.tenant(id);
  return t ? h('a', { href: `#/tenants/${t.id}` }, tenantName(t)) : h('span.subtle', 'Unknown tenant');
}

export function ownerLink(id) {
  const o = lookup.owner(id);
  return o ? h('a', { href: `#/owners/${o.id}` }, displayName(o)) : h('span.subtle', 'Unknown owner');
}

export function vendorLink(id) {
  const v = lookup.vendor(id);
  return v ? h('a', { href: `#/vendors/${v.id}` }, displayName(v)) : h('span.subtle', 'No vendor');
}

export function accountName(id) {
  return accountLabel(lookup.account(id));
}

export function accountLink(id) {
  const a = lookup.account(id);
  return a ? h('a', { href: `#/accounts/${a.id}` }, a.name) : h('span.subtle', 'Unknown account');
}

/** Circle with initials, for people lists. */
export function personAvatar(p, { size = '' } = {}) {
  return h(`span.avatar${size ? '.' + size : ''}.client`, { 'aria-hidden': 'true' }, initials(personName(p)));
}

// ---- Selects and pickers ------------------------------------------------------------

/**
 * Account <select> with option groups by type.
 * filter(account) narrows the list; `empty` adds a leading blank option.
 */
export function accountSelect({ name = 'accountId', value = '', filter = () => true, empty = null, ...rest } = {}) {
  // The current value stays listed even when inactive, so editing an old
  // record keeps its account instead of saving an empty one.
  const accounts = app.store.all('accounts').filter((a) => a.id === value || (a.active !== false && filter(a)));
  const s = h(
    'select.select',
    { name, ...rest },
    empty !== null ? h('option', { value: '' }, empty) : null,
    groupAccounts(accounts).map((g) => h('optgroup', { label: g.label }, g.accounts.map((a) => h('option', { value: a.id }, accountLabel(a))))),
  );
  s.value = value || (empty !== null ? '' : accounts[0]?.id || '');
  return s;
}

/**
 * The first of `ids` that is an active bank account; otherwise the default
 * bank, or the first one. Settings and properties can point at a bank that
 * was since deactivated or deleted.
 */
export function usableBank(...ids) {
  const banks = bankAccounts(app.store.all('accounts'));
  const ok = (id) => id && banks.some((a) => a.id === id);
  return [...ids, app.settings().accounting?.defaultBankId].find(ok) || banks[0]?.id || '';
}

export function bankSelect({ name = 'bankAccountId', value = '', ...rest } = {}) {
  const all = app.store.all('accounts');
  const banks = bankAccounts(all);
  // An inactive bank stays listed when it is the current value (an old record).
  const current = all.find((a) => a.id === value && a.bank && a.active === false);
  if (current) banks.push(current);
  return select({ name, required: true, value: current ? value : usableBank(value), options: banks.map((a) => ({ value: a.id, label: a.name })), ...rest });
}

export function propertySelect({ name = 'propertyId', value = '', empty = 'Select a property', includeInactive = false, ...rest } = {}) {
  const props = app.store
    .all('properties')
    .filter((p) => includeInactive || p.active !== false || p.id === value)
    .sort((a, b) => a.name.localeCompare(b.name));
  return select({ name, value, options: [...(empty !== null ? [{ value: '', label: empty }] : []), ...props.map((p) => ({ value: p.id, label: p.name }))], ...rest });
}

export function unitSelect({ name = 'unitId', propertyId, value = '', empty = 'Whole property', ...rest } = {}) {
  const units = propertyId ? lookup.unitsOf(propertyId).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) : [];
  return select({ name, value, options: [...(empty !== null ? [{ value: '', label: empty }] : []), ...units.map((u) => ({ value: u.id, label: u.name }))], ...rest });
}

/** A property select and a unit select that follows it. Returns { node, property, unit }. */
export function propertyUnitFields({ propertyId = '', unitId = '', unitEmpty = 'Whole property', required = false, onChange } = {}) {
  const property = propertySelect({ value: propertyId, empty: required ? 'Select a property' : 'None' });
  let unit = unitSelect({ propertyId, value: unitId, empty: unitEmpty });
  const unitField = field('Unit', unit);
  property.addEventListener('change', () => {
    const next = unitSelect({ propertyId: property.value, value: '', empty: unitEmpty });
    next.id = unit.id;
    unit.replaceWith(next);
    unit = next;
    unit.addEventListener('change', () => onChange?.());
    onChange?.();
  });
  unit.addEventListener('change', () => onChange?.());
  const out = {
    node: [field('Property', property, { required }), unitField],
    get propertyId() {
      return property.value || null;
    },
    get unitId() {
      return unit.value || null;
    },
    property,
  };
  return out;
}

export function vendorSelect({ name = 'vendorId', value = '', empty = 'Select a vendor', ...rest } = {}) {
  const vendors = app.store
    .all('vendors')
    .filter((v) => v.active !== false || v.id === value)
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  return select({ name, value, options: [...(empty !== null ? [{ value: '', label: empty }] : []), ...vendors.map((v) => ({ value: v.id, label: displayName(v) }))], ...rest });
}

export function memberSelect({ name = 'assigneeId', value = '', empty = 'Unassigned', ...rest } = {}) {
  const team = app.store.all('team').filter((m) => m.active !== false || m.id === value);
  return select({ name, value, options: [...(empty !== null ? [{ value: '', label: empty }] : []), ...team.map((m) => ({ value: m.id, label: m.name }))], ...rest });
}

/** "Maple Court · 1A · Maya Alvarez" for lease pickers. */
export function leaseOptionLabel(lease) {
  const names = lookup.tenantNames(lease);
  return `${lookup.leaseLabel(lease)}${names ? ' · ' + names : ''}`;
}

/**
 * Type-ahead lease picker. Lists active and future leases first, then past
 * leases with a balance. onSelect(lease).
 */
export function leasePicker({ value = null, onSelect, placeholder = 'Search by unit or tenant', label = 'Lease', includePast = true } = {}) {
  const today = app.today();
  const ledger = app.ledger();
  const rank = (l) => ({ active: 0, future: 1, draft: 3, past: 2 })[leaseStatus(l, today)];
  const items = () =>
    app.store
      .all('leases')
      .filter((l) => !l.draft && (includePast || leaseStatus(l, today) !== 'past' || ledger.lease(l.id).balance))
      .sort((a, b) => rank(a) - rank(b) || leaseOptionLabel(a).localeCompare(leaseOptionLabel(b), undefined, { numeric: true }));
  const cb = combobox({
    label,
    placeholder,
    value: value ? leaseOptionLabel(value) : '',
    items,
    itemLabel: leaseOptionLabel,
    filter: (l, q) => matches(leaseOptionLabel(l), q),
    renderItem: (l) =>
      h(
        'span.combo-item',
        h('span.grow', h('span.combo-title', lookup.leaseLabel(l)), h('span.combo-sub', lookup.tenantNames(l) || 'No tenants')),
        leaseStatus(l, today) !== 'active' ? statusPill(leaseStatus(l, today)) : null,
      ),
    onSelect: (l) => {
      cb.input.value = leaseOptionLabel(l);
      onSelect?.(l);
    },
  });
  return cb;
}

/** Type-ahead tenant picker with an optional "Create" action. */
export function tenantPicker({ onSelect, exclude = [], placeholder = 'Search tenants', onCreate } = {}) {
  const cb = combobox({
    label: 'Tenant',
    placeholder,
    items: () => app.store.all('tenants').filter((t) => !exclude.includes(t.id)),
    itemLabel: tenantName,
    filter: (t, q) => matches(`${tenantName(t)} ${(t.emails || []).join(' ')} ${(t.phones || []).join(' ')}`, q),
    renderItem: (t) => h('span.combo-item', personAvatar(t, { size: 'sm' }), h('span.grow', h('span.combo-title', tenantName(t)), h('span.combo-sub', (t.emails || [])[0] || (t.phones || [])[0] || ''))),
    onSelect: (t) => {
      cb.input.value = '';
      onSelect?.(t);
    },
    footerAction: onCreate ? { label: (q) => (q ? `Add "${q}" as a new tenant` : 'Add a new tenant'), run: (q) => onCreate(q) } : null,
  });
  return cb;
}

// ---- Contact and address editors ------------------------------------------------------

/**
 * Editable list of strings (emails or phones). `.values` returns the
 * non-empty entries.
 */
export function listEditor({ values = [], type = 'email', label = 'Email', addLabel = 'Add another' } = {}) {
  const wrap = h('div.list-editor');
  const rows = h('div.stack.sm');
  const add = (v = '') => {
    const input = textInput({ type: type === 'email' ? 'email' : 'tel', value: v, autocomplete: type === 'email' ? 'email' : 'tel', 'aria-label': label });
    const row = h('div.row', input, h('button.icon-btn', { type: 'button', 'aria-label': `Remove ${label.toLowerCase()}`, onClick: () => (row.remove(), rows.children.length || add()) }, icon('x', 16)));
    rows.append(row);
    return input;
  };
  (values.length ? values : ['']).forEach((v) => add(v));
  wrap.append(rows, h('button.btn.ghost.sm', { type: 'button', onClick: () => add().focus() }, icon('plus', 14), addLabel));
  Object.defineProperty(wrap, 'values', { get: () => [...rows.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean) });
  return wrap;
}

/** Address fields. Returns { node: [...fields], value() }. */
export function addressFields(address = {}, { required = false, prefix = '' } = {}) {
  const street = textInput({ name: `${prefix}street`, value: address.street, autocomplete: 'address-line1' });
  const street2 = textInput({ name: `${prefix}street2`, value: address.street2, autocomplete: 'address-line2' });
  const city = textInput({ name: `${prefix}city`, value: address.city, autocomplete: 'address-level2' });
  const state = textInput({ name: `${prefix}state`, value: address.state, autocomplete: 'address-level1' });
  const zip = textInput({ name: `${prefix}zip`, value: address.zip, autocomplete: 'postal-code' });
  return {
    node: [field('Street address', street, { span2: true, required }), field('Apartment, suite, etc.', street2, { span2: true }), field('City', city, { required }), h('div.field-pair', field('State or region', state), field('Postal code', zip))],
    value: () => ({ street: street.value.trim(), street2: street2.value.trim(), city: city.value.trim(), state: state.value.trim(), zip: zip.value.trim() }),
  };
}

export function addressBlock(address) {
  const text = formatAddress(address, { multiline: true });
  return text ? h('address.address', text) : h('span.subtle', 'No address');
}

// ---- Detail page pieces ----------------------------------------------------------------

/** Definition list from [[label, value], ...]; rows with an empty value are skipped. */
export function kvList(rows) {
  return h(
    'dl.kv',
    rows.filter((r) => r && r[1] !== null && r[1] !== undefined && r[1] !== '').map(([k, v]) => [h('dt', k), h('dd', v)]),
  );
}

/**
 * Tabs for a detail page. The selected tab lives in ?tab= so it survives
 * reloads and back navigation. Returns { node, region, selected() }.
 * renderTab(id) returns the tab content; it re-runs when the record changes
 * if the caller wraps it in ctx.live.
 */
export function detailTabs(ctx, items, renderTab, { label = 'Sections' } = {}) {
  const list = () => (typeof items === 'function' ? items() : items);
  // Read the live route, not ctx.query: setQuery updates the route without
  // re-rendering the view, so a redraw inside ctx.live keeps the tab.
  const wanted = currentRoute().query.tab ?? ctx.query.tab;
  let selected = list().some((t) => t.id === wanted) ? wanted : list()[0].id;
  const panelId = uniqueId('panel');
  const bar = h('div.detail-tabs');
  const panel = h('div.tab-panel', { id: panelId, role: 'tabpanel' });
  const draw = () => {
    bar.replaceChildren(
      tabs({
        label,
        items: list(),
        selected,
        onSelect: (id) => {
          selected = id;
          setQuery({ tab: id === list()[0].id ? '' : id });
          draw();
          bar.querySelector('[aria-selected="true"]')?.focus();
        },
      }),
    );
    panel.setAttribute('aria-labelledby', `tab-${selected}`);
    panel.replaceChildren(renderTab(selected));
  };
  draw();
  return { node: h('div', bar, panel), redraw: draw, selected: () => selected };
}

/**
 * Notes timeline on any record: newest first, with author and time.
 * Stored on the record as notes: [{ id, text, at, by }].
 */
export function notesCard(coll, record, { title = 'Notes' } = {}) {
  const store = app.store;
  const notes = [...(Array.isArray(record.notes) ? record.notes : record.notes ? [{ id: 'legacy', text: String(record.notes), at: record.createdAt }] : [])].sort((a, b) => (a.at < b.at ? 1 : -1));
  const ta = textarea({ placeholder: 'Add a note', rows: 2, 'aria-label': 'New note' });
  const addNote = () => {
    const text = ta.value.trim();
    if (!text) return;
    store.patch(coll, record.id, (r) => {
      const list = Array.isArray(r.notes) ? r.notes : r.notes ? [{ id: 'legacy', text: String(r.notes), at: r.createdAt }] : [];
      r.notes = [...list, { id: newId(), text, at: new Date().toISOString(), by: app.user?.username || (app.demo ? 'Demo user' : '') }];
      return r;
    });
    ta.value = '';
  };
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      addNote();
    }
  });
  return h(
    'section.card.notes-card',
    h('div.card-head', h('h2.grow', title, notes.length ? h('span.count', ` ${notes.length}`) : null)),
    h(
      'div.card-body.stack',
      h('div.note-compose', ta, h('div.row', h('span.subtle.grow', { style: { fontSize: '12px' } }, 'Only visible to your team'), h('button.btn.sm', { type: 'button', onClick: addNote }, 'Add note'))),
      notes.length
        ? h(
            'ul.notes',
            notes.map((n) =>
              h(
                'li',
                h('p.note-text', n.text),
                h(
                  'div.note-meta',
                  h('span', [n.by, n.at ? new Date(n.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''].filter(Boolean).join(' · ')),
                  h(
                    'button.link-btn',
                    {
                      type: 'button',
                      onClick: () => store.patch(coll, record.id, (r) => ((r.notes = (r.notes || []).filter((x) => x.id !== n.id)), r)),
                    },
                    'Delete',
                  ),
                ),
              ),
            ),
          )
        : null,
    ),
  );
}

export function sectionEmpty(text, action) {
  return h('div.section-empty', h('span', text), action || null);
}

/** Delete a record after confirming, with an Undo toast. */
export async function deleteWithUndo(coll, record, { title, message, label = 'Deleted', after } = {}) {
  const ok = await confirmDialog({ title: title || 'Delete this record?', message: message || 'This cannot be undone after you leave this page.', confirmLabel: 'Delete', danger: true });
  if (!ok) return false;
  const removed = app.store.remove(coll, record.id);
  after?.();
  toast(label, { action: { label: 'Undo', run: () => app.store.restore(coll, removed) } });
  return true;
}

/** Simple sort-state persistence per list in sessionStorage. */
export function rememberSort(key, initial) {
  try {
    const v = JSON.parse(sessionStorage.getItem(`pm.sort.${key}`) || 'null');
    if (v?.id) return v;
  } catch {}
  return initial;
}

export function saveSort(key, sort) {
  try {
    sessionStorage.setItem(`pm.sort.${key}`, JSON.stringify(sort));
  } catch {}
}

/** Export rows to CSV. columns: [{ label, value(row) }] */
export function exportCSV(filename, columns, rows) {
  const data = [columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => c.value(r) ?? ''))];
  downloadText(filename.endsWith('.csv') ? filename : `${filename}.csv`, toCSV(data));
}

/** Cents as a plain number string for CSV ("1234.50", "-12.00"). */
export const csvMoney = (c) => ((c || 0) / 100).toFixed(2);

/** Occupancy status of a unit today: occupied, vacant, or listed. */
export function unitStatus(unit) {
  if (occupancyMap().get(unit.id)) return 'occupied';
  return unit.listing?.listed ? 'listed' : 'vacant';
}

export { unitLabel, tenantName, personName, displayName };
