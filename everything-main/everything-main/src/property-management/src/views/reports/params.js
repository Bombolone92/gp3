/**
 * Report parameters: read from and written to the query string so a report
 * link reproduces the same report.
 */
import { h, uniqueId } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { select, textInput } from '../../ui/components.js';
import { openPopover } from '../../ui/menu.js';
import { setQuery } from '../../ui/router.js';
import { addDays, addMonths, startOfMonth, endOfMonth, formatDate } from '../../core/dates.js';
import { displayName } from '../../core/format.js';
import { accountLabel, compareAccounts } from '../../core/accounts.js';
import { leasePicker, leaseOptionLabel } from '../common.js';

export const PRESETS = [
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'this-quarter', label: 'This quarter' },
  { id: 'last-quarter', label: 'Last quarter' },
  { id: 'this-year', label: 'Year to date' },
  { id: 'last-year', label: 'Last year' },
  { id: 'last-12', label: 'Last 12 months' },
  { id: 'last-90', label: 'Last 90 days' },
  { id: 'next-30', label: 'Next 30 days' },
  { id: 'next-90', label: 'Next 90 days' },
  { id: 'custom', label: 'Custom dates' },
];

/** [from, to] for a preset relative to today. */
export function presetRange(id, today) {
  const y = Number(today.slice(0, 4));
  const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  const qStart = (yy, qq) => `${yy}-${String(qq * 3 + 1).padStart(2, '0')}-01`;
  switch (id) {
    case 'this-month':
      return [startOfMonth(today), endOfMonth(today)];
    case 'last-month': {
      const s = startOfMonth(addMonths(startOfMonth(today), -1));
      return [s, endOfMonth(s)];
    }
    case 'this-quarter': {
      const s = qStart(y, q);
      return [s, endOfMonth(addMonths(s, 2))];
    }
    case 'last-quarter': {
      const s = q ? qStart(y, q - 1) : qStart(y - 1, 3);
      return [s, endOfMonth(addMonths(s, 2))];
    }
    case 'this-year':
      return [`${y}-01-01`, today];
    case 'last-year':
      return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    case 'last-12':
      return [startOfMonth(addMonths(today, -11)), endOfMonth(today)];
    case 'last-90':
      return [addDays(today, -89), today];
    case 'next-30':
      return [today, addDays(today, 30)];
    case 'next-90':
      return [today, addDays(today, 90)];
    default:
      return [startOfMonth(today), endOfMonth(today)];
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve the report's parameters from the query string and its defaults.
 * Returns a plain object: { from, to, preset, asOf, propertyIds, ... }.
 */
export function readParams(report, query, today) {
  const d = report.defaults || {};
  const p = {};
  const has = (k) => report.params.includes(k);
  if (has('range')) {
    const preset = PRESETS.some((x) => x.id === query.preset) ? query.preset : ISO.test(query.from || '') && ISO.test(query.to || '') ? 'custom' : d.preset || 'this-month';
    let [from, to] = presetRange(preset, today);
    if (preset === 'custom') {
      from = ISO.test(query.from || '') ? query.from : from;
      to = ISO.test(query.to || '') ? query.to : to;
      if (from > to) [from, to] = [to, from];
    }
    Object.assign(p, { preset, from, to });
  }
  if (has('asOf')) p.asOf = ISO.test(query.asOf || '') ? query.asOf : today;
  if (has('properties')) {
    const known = new Set(app.store.all('properties').map((x) => x.id));
    p.propertyIds = String(query.p || '')
      .split(',')
      .filter((id) => known.has(id));
  }
  for (const k of ['owner', 'lease', 'account', 'vendor', 'budget', 'assignee']) if (has(k)) p[k] = query[k] || d[k] || '';
  if (has('status')) p.status = query.status ?? d.status ?? '';
  if (has('source')) p.source = query.source || '';
  if (has('days')) p.days = Number(query.days) || d.days || 60;
  if (has('owner') && !p.owner) p.owner = app.store.all('owners').slice().sort((a, b) => displayName(a).localeCompare(displayName(b)))[0]?.id || '';
  if (has('budget') && !p.budget) p.budget = app.store.all('budgets').slice().sort((a, b) => Number(b.year) - Number(a.year))[0]?.id || '';
  return p;
}

/** Human-readable parameter summary for the report header and CSV. */
export function describeParams(report, p) {
  const out = [];
  const fmt = (d) => formatDate(d, { month: 'short', day: 'numeric', year: 'numeric' });
  if (p.from) out.push(`${fmt(p.from)} to ${fmt(p.to)}`);
  if (p.asOf) out.push(`As of ${fmt(p.asOf)}`);
  if (p.propertyIds) out.push(p.propertyIds.length ? p.propertyIds.map((id) => lookup.property(id)?.name).filter(Boolean).join(', ') : 'All properties');
  if (p.owner) out.push(displayName(lookup.owner(p.owner)));
  if (p.lease) {
    const l = lookup.lease(p.lease);
    if (l) out.push(leaseOptionLabel(l));
  }
  if (p.vendor) out.push(displayName(lookup.vendor(p.vendor)));
  if (p.account) out.push(accountLabel(lookup.account(p.account)));
  if (p.assignee) out.push(lookup.member(p.assignee)?.name || '');
  if (p.status) out.push((report.statusOptions || []).find((o) => o.value === p.status)?.label || p.status);
  if (p.source) out.push(p.source);
  if (report.params.includes('days')) out.push(`Within ${p.days} days`);
  return out.filter(Boolean);
}

function labelled(label, control) {
  const id = control.id || uniqueId('rp');
  control.id = id;
  return h('div.rp-field', h('label', { for: id }, label), control);
}

/** The parameter bar. onChange() is called after the query string is updated. */
export function paramBar(report, p, onChange) {
  const today = app.today();
  const fields = [];
  const set = (patch, query) => {
    Object.assign(p, patch);
    setQuery(query);
    onChange();
  };

  if (report.params.includes('range')) {
    const presets = PRESETS.filter((x) => (report.future ? true : !x.id.startsWith('next-')));
    const from = textInput({ type: 'date', value: p.from, 'aria-label': 'From' });
    const to = textInput({ type: 'date', value: p.to, 'aria-label': 'To' });
    const preset = select({ value: p.preset, options: presets.map((x) => ({ value: x.id, label: x.label })) });
    const custom = h('div.rp-dates', { hidden: p.preset !== 'custom' }, from, h('span.subtle', 'to'), to);
    preset.addEventListener('change', () => {
      const id = preset.value;
      custom.hidden = id !== 'custom';
      if (id === 'custom') return set({ preset: id }, { preset: '', from: p.from, to: p.to });
      const [f, t] = presetRange(id, today);
      from.value = f;
      to.value = t;
      set({ preset: id, from: f, to: t }, { preset: id, from: '', to: '' });
    });
    const onDate = () => {
      if (!ISO.test(from.value) || !ISO.test(to.value)) return;
      const [f, t] = from.value <= to.value ? [from.value, to.value] : [to.value, from.value];
      set({ preset: 'custom', from: f, to: t }, { preset: '', from: f, to: t });
    };
    from.addEventListener('change', onDate);
    to.addEventListener('change', onDate);
    fields.push(h('div.rp-field.rp-range', h('label', { for: (preset.id = uniqueId('rp')) }, 'Period'), h('div.rp-range-controls', preset, custom)));
  }

  if (report.params.includes('asOf')) {
    const input = textInput({ type: 'date', value: p.asOf });
    input.addEventListener('change', () => ISO.test(input.value) && set({ asOf: input.value }, { asOf: input.value === today ? '' : input.value }));
    fields.push(labelled('As of', input));
  }

  if (report.params.includes('properties')) fields.push(propertyFilter(p, (ids) => set({ propertyIds: ids }, { p: ids.join(',') })));

  if (report.params.includes('owner')) {
    const owners = app.store.all('owners').slice().sort((a, b) => displayName(a).localeCompare(displayName(b)));
    const s = select({ value: p.owner, options: owners.length ? owners.map((o) => ({ value: o.id, label: displayName(o) })) : [{ value: '', label: 'No owners yet' }] });
    s.addEventListener('change', () => set({ owner: s.value }, { owner: s.value }));
    fields.push(labelled('Owner', s));
  }

  if (report.params.includes('lease')) {
    const current = p.lease ? lookup.lease(p.lease) : null;
    const picker = leasePicker({ value: current, onSelect: (l) => set({ lease: l.id }, { lease: l.id }) });
    fields.push(h('div.rp-field.rp-wide', h('label', { for: (picker.input.id = uniqueId('rp')) }, 'Lease'), picker));
  }

  if (report.params.includes('account')) {
    const accounts = app.store.all('accounts').slice().sort(compareAccounts);
    const s = select({ value: p.account, options: [{ value: '', label: 'All accounts' }, ...accounts.map((a) => ({ value: a.id, label: accountLabel(a) }))] });
    s.addEventListener('change', () => set({ account: s.value }, { account: s.value }));
    fields.push(labelled('Account', s));
  }

  if (report.params.includes('vendor')) {
    const vendors = app.store.all('vendors').slice().sort((a, b) => displayName(a).localeCompare(displayName(b)));
    const s = select({ value: p.vendor, options: [{ value: '', label: 'All vendors' }, ...vendors.map((v) => ({ value: v.id, label: displayName(v) }))] });
    s.addEventListener('change', () => set({ vendor: s.value }, { vendor: s.value }));
    fields.push(labelled('Vendor', s));
  }

  if (report.params.includes('assignee')) {
    const s = select({ value: p.assignee, options: [{ value: '', label: 'Everyone' }, ...app.store.all('team').map((m) => ({ value: m.id, label: m.name }))] });
    s.addEventListener('change', () => set({ assignee: s.value }, { assignee: s.value }));
    fields.push(labelled('Assigned to', s));
  }

  if (report.params.includes('budget')) {
    const budgets = app.store.all('budgets').slice().sort((a, b) => Number(b.year) - Number(a.year));
    const s = select({ value: p.budget, options: budgets.length ? budgets.map((b) => ({ value: b.id, label: `${lookup.property(b.propertyId)?.name || 'Property'} ${b.year}` })) : [{ value: '', label: 'No budgets yet' }] });
    s.addEventListener('change', () => set({ budget: s.value }, { budget: s.value }));
    fields.push(labelled('Budget', s));
  }

  if (report.params.includes('status')) {
    const s = select({ value: p.status, options: report.statusOptions });
    s.addEventListener('change', () => set({ status: s.value }, { status: s.value }));
    fields.push(labelled(report.statusLabel || 'Status', s));
  }

  if (report.params.includes('source')) {
    const sources = [...new Set([...(app.settings().lists?.leadSources || []), ...app.store.all('applicants').map((a) => a.source).filter(Boolean)])];
    const s = select({ value: p.source, options: [{ value: '', label: 'All sources' }, ...sources.map((x) => ({ value: x, label: x }))] });
    s.addEventListener('change', () => set({ source: s.value }, { source: s.value }));
    fields.push(labelled('Source', s));
  }

  if (report.params.includes('days')) {
    const s = select({ value: String(p.days), options: [30, 60, 90, 120, 180].map((n) => ({ value: String(n), label: `${n} days` })) });
    s.addEventListener('change', () => set({ days: Number(s.value) }, { days: s.value }));
    fields.push(labelled(report.daysLabel || 'Within', s));
  }

  return h('div.report-params', { role: 'group', 'aria-label': 'Report settings' }, fields);
}

/** "All properties" button that opens a checklist. */
function propertyFilter(p, onChange) {
  const props = app.store
    .all('properties')
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const id = uniqueId('rp');
  const label = () => (!p.propertyIds.length ? 'All properties' : p.propertyIds.length === 1 ? lookup.property(p.propertyIds[0])?.name || '1 property' : `${p.propertyIds.length} properties`);
  const text = h('span.truncate', label());
  const btn = h('button.select.rp-multi', { type: 'button', id, 'aria-haspopup': 'dialog' }, text);
  btn.addEventListener('click', () => {
    const chosen = new Set(p.propertyIds);
    openPopover(
      btn,
      ({ close }) => {
        const boxes = props.map((x) =>
          h('label.check.rp-check', h('input', { type: 'checkbox', value: x.id, checked: chosen.has(x.id) }), h('span.truncate', x.name), x.active === false ? h('span.subtle', ' (inactive)') : null),
        );
        const apply = () => {
          const ids = boxes.map((b) => b.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
          close();
          text.textContent = '';
          onChange(ids.length === props.length ? [] : ids);
          text.textContent = label();
        };
        return h(
          'div.rp-pop',
          h('div.rp-pop-list', boxes.length ? boxes : h('p.subtle', 'No properties yet.')),
          h(
            'div.rp-pop-foot',
            h('button.btn.sm.ghost', { type: 'button', onClick: () => boxes.forEach((b) => (b.querySelector('input').checked = false)) }, 'Clear'),
            h('div.spacer'),
            h('button.btn.sm.primary', { type: 'button', onClick: apply }, icon('check', 14), 'Apply'),
          ),
        );
      },
      { label: 'Choose properties', width: 280 },
    );
  });
  return h('div.rp-field', h('label', { for: id }, 'Properties'), btn);
}
