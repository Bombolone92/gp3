/**
 * Helpers shared by the maintenance and leasing screens: printing, the
 * email composer, filter selects and work order math.
 */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { app } from '../../app.js';
import { OPEN_WORK_ORDER } from '../../core/counts.js';
import { displayName } from '../../core/format.js';
import { addDays } from '../../core/dates.js';

// The composer is built separately; glob keeps the build working until it lands.
const composeModules = import.meta.glob('../compose.js');

/** Open the shared email composer, or say why it is unavailable. */
export async function openCompose(options) {
  const load = composeModules['../compose.js'];
  if (!load) {
    toast('Email is not available yet.', { type: 'error' });
    return null;
  }
  const mod = await load();
  return mod.composeEmail(options);
}

export const txDialogs = () => import('../transactions/dialogs.js');

/** Print a node on its own sheet (the rest of the page is hidden by print CSS). */
export function printNode(node, title) {
  let root = document.getElementById('print-root');
  if (!root) {
    root = h('div#print-root', { 'aria-hidden': 'true' });
    document.body.append(root);
  }
  root.replaceChildren(node);
  document.body.classList.add('print-sheet');
  const prevTitle = document.title;
  if (title) document.title = title;
  const cleanup = () => {
    document.title = prevTitle;
    // Remove the container, so a later print of a report (or the browser's
    // own print) is not hidden behind an empty sheet.
    root.remove();
    document.body.classList.remove('print-sheet');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

/** Header block for printed sheets: company name and contact details. */
export function printHeader(title, sub) {
  const c = app.settings().company || {};
  return h(
    'header.print-head',
    h('div', h('div.print-company', c.name || 'Property Management'), h('div.print-contact', [c.phone, c.email].filter(Boolean).join(' · '))),
    h('div.print-title', h('h1', title), sub ? h('div.print-sub', sub) : null),
  );
}

export const isOpenWorkOrder = (w) => OPEN_WORK_ORDER.has(w.status);

export function workOrderTotal(wo) {
  return (wo.items || []).reduce((s, it) => s + Math.round((Number(it.qty) || 0) * (Number(it.amount) || 0)), 0);
}

export const ENTRY_LABEL = {
  allowed: 'Entry allowed',
  call: 'Call before entering',
  'not-allowed': 'Do not enter without the tenant',
};

/** <select> used in list toolbars; calls onChange(value). */
export function filterSelect({ label, value, options, onChange }) {
  const s = h(
    'select.select.sm.filter-select',
    { 'aria-label': label, onChange: (e) => onChange(e.target.value) },
    options.map((o) => h('option', { value: o.value }, o.label)),
  );
  s.value = value || '';
  return s;
}

export function propertyOptions(all = 'All properties') {
  return [{ value: '', label: all }, ...app.store.all('properties').slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.name }))];
}

export function vendorOptions(all = 'All vendors') {
  return [{ value: '', label: all }, ...app.store.all('vendors').slice().sort((a, b) => displayName(a).localeCompare(displayName(b))).map((v) => ({ value: v.id, label: displayName(v) }))];
}

export function memberOptions(all = 'Anyone') {
  return [{ value: '', label: all }, ...app.store.all('team').map((m) => ({ value: m.id, label: m.name }))];
}

/** Two-button list/board (or grid) toggle. */
export function viewToggle({ value, items, onChange, label = 'View' }) {
  return h(
    'div.btn-group.view-toggle',
    { role: 'group', 'aria-label': label },
    items.map((it) =>
      h(
        'button.btn.sm',
        { type: 'button', 'aria-pressed': String(it.value === value), title: it.label, onClick: () => onChange(it.value) },
        icon(it.icon, 15),
        h('span.vt-label', it.label),
      ),
    ),
  );
}

/** Insurance state for a vendor: null, 'expired' or 'soon' (within 30 days). */
export function insuranceState(vendor, today) {
  if (!vendor?.insuranceExpires) return null;
  if (vendor.insuranceExpires < today) return 'expired';
  return vendor.insuranceExpires <= addDays(today, 30) ? 'soon' : null;
}

export const STANDARD_AREAS = ['Living room', 'Kitchen', 'Bedrooms', 'Bathrooms', 'Exterior'];

export const CONDITIONS = [
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'damaged', label: 'Damaged' },
];

const RANK = { good: 0, fair: 1, poor: 2, damaged: 3 };

/**
 * Compare two inspections area by area (matched by name, case-insensitive).
 * Returns [{ name, before, after, change: 'worse'|'better'|'same'|'new' }].
 */
export function compareInspections(previous, current) {
  const prev = new Map((previous?.areas || []).map((a) => [a.name.trim().toLowerCase(), a]));
  return (current?.areas || []).map((a) => {
    const p = prev.get(a.name.trim().toLowerCase());
    if (!p || !p.condition) return { name: a.name, before: null, after: a.condition || null, change: 'new' };
    if (!a.condition) return { name: a.name, before: p.condition, after: null, change: 'same' };
    const d = RANK[a.condition] - RANK[p.condition];
    return { name: a.name, before: p.condition, after: a.condition, change: d > 0 ? 'worse' : d < 0 ? 'better' : 'same' };
  });
}

export const INSPECTION_TYPES = [
  { value: 'move-in', label: 'Move-in' },
  { value: 'move-out', label: 'Move-out' },
  { value: 'routine', label: 'Routine' },
];

export function inspectionTypeLabel(t) {
  return INSPECTION_TYPES.find((x) => x.value === t)?.label || 'Inspection';
}
