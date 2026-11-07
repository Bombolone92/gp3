/**
 * Helpers shared by the property, unit, tenant and owner screens: portfolio
 * figures derived from the ledger, unit dialogs, and small editors.
 */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup, occupancyMap } from '../../app.js';
import { field, textInput, textarea, moneyInput } from '../../ui/components.js';
import { formDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { leaseStatus, monthlyRent, effectiveEnd } from '../../core/leases.js';
import { ACC } from '../../core/accounts.js';
import { addDays } from '../../core/dates.js';
import { incomeStatement, ownerStatement, propertyCash as financialCash } from '../../core/financials.js';

// ---- Figures ------------------------------------------------------------------------

/** Units, occupancy, rent and balance for a property, from today's leases. */
/**
 * What still points at a property or a unit, as plural nouns ("leases",
 * "work orders"). Deleting it would leave those records pointing at nothing.
 */
export function recordsUsing({ propertyId = null, unitId = null }) {
  const store = app.store;
  const on = (r) => (unitId ? r.unitId === unitId : r.propertyId === propertyId);
  const onTx = (t) => on(t) || t.lines.some(on);
  const uses = [];
  const check = (coll, label, pred = on) => store.all(coll).some(pred) && uses.push(label);
  check('leases', 'leases');
  check('transactions', 'transactions', onTx);
  check('workOrders', 'work orders');
  check('tasks', 'tasks');
  check('inspections', 'inspections');
  check('applicants', 'applicants');
  if (!unitId) {
    check('budgets', 'budgets');
    check('events', 'calendar events');
  }
  return uses;
}

/** "leases, tasks and inspections" */
export function listWords(words) {
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0] || '';
}

export function propertyFigures(propertyId) {
  const today = app.today();
  const units = lookup.unitsOf(propertyId);
  const occ = occupancyMap();
  const ledger = app.ledger();
  let occupied = 0;
  let rent = 0;
  for (const u of units) {
    const l = occ.get(u.id);
    if (l) {
      occupied++;
      rent += monthlyRent(l, today);
    }
  }
  let balance = 0;
  for (const l of app.store.all('leases')) if (l.propertyId === propertyId && !l.draft) balance += Math.max(0, ledger.lease(l.id).balance);
  const listed = units.filter((u) => !occ.get(u.id) && u.listing?.listed).length;
  return { units: units.length, occupied, vacant: units.length - occupied, listed, rent, balance, rate: units.length ? occupied / units.length : 0 };
}

/** Cash a property holds in bank accounts as of a date (end of day). */
export function propertyCash(propertyId, asOf = app.today()) {
  return financialCash(app.store, propertyId, asOf);
}

/**
 * Income and expenses by account for some properties in a date range
 * (accrual basis). Amounts are positive in their natural direction.
 */
export function incomeByAccount(propertyIds, from, to) {
  return incomeStatement(app.store, { from, to, propertyIds });
}

/** Owner's share of each property for a period: income, expenses, draws. */
export function ownerSummary(ownerId, from, to) {
  const st = ownerStatement(app.store, { ownerId, from, to });
  const rows = st.properties.map((r) => ({ ...r, property: app.store.get('properties', r.propertyId), net: r.income - r.expenses }));
  return { rows, totals: { ...st.totals, net: st.totals.income - st.totals.expenses } };
}

/** Leases a tenant is (or was) on, newest first. */
export function tenantLeases(tenantId) {
  return app.store
    .all('leases')
    .filter((l) => (l.tenantIds || []).includes(tenantId))
    .sort((a, b) => (a.start < b.start ? 1 : -1));
}

/** current | future | past | none, from the tenant's leases. */
export function tenantStatus(tenantId, today = app.today()) {
  const leases = tenantLeases(tenantId).filter((l) => !l.draft);
  const st = leases.map((l) => leaseStatus(l, today));
  if (st.includes('active')) return 'current';
  if (st.includes('future')) return 'future';
  if (st.includes('past')) return 'past';
  return 'none';
}

export const TENANT_STATUS = {
  current: { label: 'Current', tone: 'success' },
  future: { label: 'Future', tone: 'info' },
  past: { label: 'Past', tone: 'neutral' },
  none: { label: 'No lease', tone: 'neutral' },
};

export function tonePill(label, tone) {
  return h(`span.pill.${tone}`, label);
}

/** The lease to show first for a tenant: active, then future, then latest. */
export function primaryLease(tenantId) {
  const today = app.today();
  const leases = tenantLeases(tenantId).filter((l) => !l.draft);
  return leases.find((l) => leaseStatus(l, today) === 'active') || leases.find((l) => leaseStatus(l, today) === 'future') || leases[0] || null;
}

/** Leases ending within `days` on some units (for expiration lists). */
export function upcomingEnds(leases, days = 90) {
  const today = app.today();
  const limit = addDays(today, days);
  return leases
    .filter((l) => leaseStatus(l, today) === 'active')
    .map((l) => ({ lease: l, end: effectiveEnd(l) || (l.type !== 'at-will' ? l.end : null) }))
    .filter((x) => x.end && x.end >= today && x.end <= limit)
    .sort((a, b) => (a.end < b.end ? -1 : 1));
}

/** Occupancy bar: filled share of units. */
export function occupancyBar(occupied, total) {
  const pct = total ? Math.round((occupied / total) * 100) : 0;
  return h(
    'span.rn-occ',
    h('span.rn-occ-text', `${occupied}/${total}`),
    h('span.rn-occ-bar', { role: 'img', 'aria-label': `${pct}% occupied` }, h('span', { style: { width: `${pct}%` } })),
  );
}

// ---- Editors --------------------------------------------------------------------------

/** Chips editor for a list of strings (amenities). Mutates `list`. */
export function chipsEditor(list, { label = 'Add', placeholder = 'Type and press Enter' } = {}) {
  const wrap = h('div.rn-chips-editor');
  const input = h('input.rn-chip-input', { type: 'text', placeholder, 'aria-label': label });
  const draw = () => {
    wrap.replaceChildren(
      ...list.map((t, i) =>
        h(
          'span.tag.rn-chip',
          t,
          h(
            'button.rn-chip-x',
            {
              type: 'button',
              'aria-label': `Remove ${t}`,
              onClick: () => {
                list.splice(i, 1);
                draw();
                input.focus();
              },
            },
            icon('x', 12),
          ),
        ),
      ),
      input,
    );
  };
  const commit = () => {
    const v = input.value.replace(/,/g, '').trim();
    if (v && !list.includes(v)) list.push(v);
    input.value = '';
    draw();
    input.focus();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !input.value && list.length) {
      list.pop();
      draw();
      input.focus();
    }
  });
  input.addEventListener('blur', () => input.value.trim() && commit());
  wrap.addEventListener('click', (e) => e.target === wrap && input.focus());
  Object.defineProperty(wrap, 'id', { get: () => input.id, set: (v) => (input.id = v) });
  draw();
  return wrap;
}

const num = (v) => {
  const n = Number(String(v ?? '').trim());
  return String(v ?? '').trim() === '' || !Number.isFinite(n) ? null : n;
};

/** Add or edit one unit. Resolves the saved unit or null. */
/**
 * A single-family property shows as one place ("14 Linden Lane"); once it
 * has a second unit, each unit needs its own label.
 */
function unitsAdded(propertyId) {
  const p = app.store.get('properties', propertyId);
  if (p?.singleUnit && lookup.unitsOf(propertyId).length > 1) app.store.patch('properties', propertyId, { singleUnit: false });
}

export async function unitDialog(propertyId, unit = null) {
  const rent = moneyInput({ name: 'marketRent', cents: unit?.marketRent || 0 });
  let saved = null;
  await formDialog({
    title: unit ? `Edit unit ${unit.name}` : 'Add unit',
    submitLabel: unit ? 'Save unit' : 'Add unit',
    body: h(
      'div.form-grid',
      field('Unit name or number', textInput({ name: 'name', value: unit?.name || '', placeholder: 'e.g. 2B' }), { required: true }),
      field('Market rent', rent),
      field('Bedrooms', textInput({ name: 'beds', type: 'number', min: 0, step: 1, value: unit?.beds ?? '' })),
      field('Bathrooms', textInput({ name: 'baths', type: 'number', min: 0, step: 0.5, value: unit?.baths ?? '' })),
      field('Size (sq ft)', textInput({ name: 'sqft', type: 'number', min: 0, step: 1, value: unit?.sqft ?? '' })),
      field('Description', textarea({ name: 'description', value: unit?.description || '', rows: 2 }), { span2: true }),
    ),
    onSubmit: (fd) => {
      const name = String(fd.get('name') || '').trim();
      const clash = lookup.unitsOf(propertyId).some((u) => u.id !== unit?.id && u.name.toLowerCase() === name.toLowerCase());
      if (clash) {
        toast(`This property already has a unit named ${name}.`, { type: 'error' });
        return false;
      }
      saved = app.store.put('units', {
        ...(unit || { propertyId }),
        name,
        beds: num(fd.get('beds')),
        baths: num(fd.get('baths')),
        sqft: num(fd.get('sqft')),
        marketRent: rent.cents,
        description: String(fd.get('description') || '').trim(),
      });
      if (!unit) unitsAdded(propertyId);
      toast(unit ? 'Unit saved' : `Unit ${name} added`);
      return saved;
    },
  });
  return saved;
}

/**
 * Generate unit names: "101" x 4 -> 101, 102, 103, 104; "A" x 3 -> A, B, C;
 * "2A" x 3 -> 2A, 2B, 2C. Pure, unit tested.
 */
export function generateUnitNames(start, count) {
  const s = String(start || '').trim() || '1';
  const n = Math.max(0, Math.min(200, Math.floor(Number(count) || 0)));
  const out = [];
  const m = /^(.*?)(\d+)$/.exec(s);
  if (m) {
    const width = m[2].length;
    const base = Number(m[2]);
    for (let i = 0; i < n; i++) out.push(`${m[1]}${String(base + i).padStart(width, '0')}`);
    return out;
  }
  const l = /^(|.*[\d\s-])([A-Za-z])$/.exec(s);
  if (l) {
    const code = l[2].charCodeAt(0);
    const upper = l[2] === l[2].toUpperCase();
    for (let i = 0; i < n && i < 26; i++) {
      const c = code + i;
      if ((upper && c > 90) || (!upper && c > 122)) break;
      out.push(`${l[1]}${String.fromCharCode(c)}`);
    }
    return out;
  }
  for (let i = 0; i < n; i++) out.push(`${s} ${i + 1}`);
  return out;
}

/** Add several units at once. Resolves the number added. */
export async function bulkUnitsDialog(propertyId) {
  const rent = moneyInput({ name: 'marketRent' });
  const preview = h('p.subtle.rn-preview', { 'aria-live': 'polite' });
  let added = 0;
  const update = (form) => {
    const names = generateUnitNames(form.querySelector('[name=start]').value, form.querySelector('[name=count]').value);
    preview.textContent = names.length ? `Creates ${names.slice(0, 6).join(', ')}${names.length > 6 ? `, and ${names.length - 6} more` : ''}` : '';
  };
  await formDialog({
    title: 'Add several units',
    submitLabel: 'Add units',
    body: () => {
      const g = h(
        'div.form-grid',
        field('First unit name', textInput({ name: 'start', value: '101', onInput: (e) => update(e.target.form) }), { required: true, hint: 'Numbers and letters count up: 101, 102 or A, B' }),
        field('How many', textInput({ name: 'count', type: 'number', min: 1, max: 200, value: 4, onInput: (e) => update(e.target.form) }), { required: true }),
        field('Bedrooms', textInput({ name: 'beds', type: 'number', min: 0 })),
        field('Bathrooms', textInput({ name: 'baths', type: 'number', min: 0, step: 0.5 })),
        field('Size (sq ft)', textInput({ name: 'sqft', type: 'number', min: 0 })),
        field('Market rent', rent),
        h('div.span-2', preview),
      );
      queueMicrotask(() => g.closest('form') && update(g.closest('form')));
      return g;
    },
    onSubmit: (fd) => {
      const existing = new Set(lookup.unitsOf(propertyId).map((u) => u.name.toLowerCase()));
      const names = generateUnitNames(fd.get('start'), fd.get('count')).filter((n) => !existing.has(n.toLowerCase()));
      if (!names.length) {
        toast('Those units already exist.', { type: 'error' });
        return false;
      }
      app.store.bulkPut(
        'units',
        names.map((name) => ({ propertyId, name, beds: num(fd.get('beds')), baths: num(fd.get('baths')), sqft: num(fd.get('sqft')), marketRent: rent.cents })),
      );
      added = names.length;
      unitsAdded(propertyId);
      toast(`${added} units added`);
      return true;
    },
  });
  return added;
}

/** List a unit for rent or update its listing. */
export async function listingDialog(unit) {
  const l = unit.listing || {};
  const rent = moneyInput({ name: 'rent', cents: l.rent || unit.marketRent || 0 });
  let saved = null;
  await formDialog({
    title: l.listed ? `Edit listing for ${lookup.unitLabel(unit.id)}` : `List ${lookup.unitLabel(unit.id)} for rent`,
    submitLabel: l.listed ? 'Save listing' : 'List unit',
    body: h(
      'div.form-grid',
      field('Asking rent', rent, { required: true }),
      field('Available from', textInput({ name: 'available', type: 'date', value: l.available || app.today() })),
      field('Listing description', textarea({ name: 'description', rows: 4, value: l.description || unit.description || '', placeholder: 'What makes this unit a good home' }), { span2: true }),
    ),
    onSubmit: (fd) => {
      if (!rent.cents) {
        toast('Enter the asking rent.', { type: 'error' });
        return false;
      }
      saved = app.store.patch('units', unit.id, {
        listing: { listed: true, rent: rent.cents, available: String(fd.get('available') || ''), description: String(fd.get('description') || '').trim(), listedOn: (l.listed && l.listedOn) || app.today() },
      });
      toast(l.listed ? 'Listing updated' : 'Unit listed for rent');
      return saved;
    },
  });
  return saved;
}

export function unlistUnit(unit) {
  app.store.patch('units', unit.id, { listing: { ...(unit.listing || {}), listed: false } });
  toast('Listing removed');
}

/** Lazy loader for the transaction dialogs. */
export const tx = () => import('../transactions/dialogs.js');

export { ACC };
