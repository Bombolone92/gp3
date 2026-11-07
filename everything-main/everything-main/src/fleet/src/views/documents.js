/**
 * Every photo and document attached anywhere in the fleet, in one list.
 * Files live in the app's Puter folder; records hold small references.
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderList, fieldFilter } from '../ui/grid.js';
import { app, lookup } from '../app.js';
import { vehicleName, contactName, formatBytes } from '../core/format.js';
import { formatDate, toISODate } from '../core/dates.js';
import { isImage } from '../files.js';
import { recordFiles } from '../files.js';
import { openFile, loadImage, dash } from './common.js';

const SOURCES = {
  vehicles: { label: 'Vehicle', name: (r) => vehicleName(r), href: (r) => `#/vehicles/${r.id}?tab=files` },
  issues: { label: 'Issue', name: (r) => `#${r.number} ${r.summary}`, href: (r) => `#/issues/${r.id}` },
  serviceEntries: { label: 'Service entry', name: (r) => `Service on ${formatDate(r.date)}`, href: (r) => `#/service/${r.id}` },
  workOrders: { label: 'Work order', name: (r) => `Work order #${r.number}`, href: (r) => `#/work-orders/${r.id}` },
  inspections: { label: 'Inspection', name: (r) => `${r.formName} on ${formatDate(r.date)}`, href: (r) => `#/inspections/${r.id}` },
  fuel: { label: 'Fuel entry', name: (r) => `Fuel on ${formatDate(r.date)}`, href: (r) => `#/fuel/${r.id}` },
  expenses: { label: 'Expense', name: (r) => `${r.type} on ${formatDate(r.date)}`, href: () => '#/expenses' },
  contacts: { label: 'Contact', name: (r) => contactName(r), href: (r) => `#/contacts/${r.id}` },
  vendors: { label: 'Vendor', name: (r) => r.name, href: (r) => `#/vendors/${r.id}` },
  parts: { label: 'Part', name: (r) => r.description || r.number, href: (r) => `#/parts/${r.id}` },
  purchaseOrders: { label: 'Purchase order', name: (r) => `PO #${r.number}`, href: (r) => `#/purchase-orders/${r.id}` },
};

export function render(ctx) {
  const store = app.store;
  let key = null;
  let cache = [];
  const rows = () => {
    const lists = Object.keys(SOURCES).map((c) => store.all(c));
    if (key && key.every((l, i) => l === lists[i])) return cache;
    const out = [];
    const seen = new Set();
    for (const coll of Object.keys(SOURCES)) {
      for (const r of store.all(coll)) {
        for (const f of recordFiles(r)) {
          if (seen.has(f.path)) continue;
          seen.add(f.path);
          out.push({ id: f.path, file: f, coll, rec: r, vehicleId: r.vehicleId || (coll === 'vehicles' ? r.id : null), kind: isImage(f.type) ? 'image' : f.type === 'application/pdf' ? 'pdf' : 'other' });
        }
      }
    }
    key = lists;
    cache = out;
    return out;
  };
  return renderList(ctx, {
    key: 'documents',
    title: 'Documents',
    intro: 'Photos, receipts, and documents attached anywhere in your fleet. Add files from a vehicle, issue, work order, or other record.',
    rows,
    watch: Object.keys(SOURCES),
    tabs: [
      { id: 'all', label: 'All' },
      { id: 'images', label: 'Photos', filter: (x) => x.kind === 'image' },
      { id: 'docs', label: 'Documents', filter: (x) => x.kind !== 'image' },
    ],
    filters: [fieldFilter('source', 'Attached to', 'coll', () => Object.entries(SOURCES).map(([k, v]) => ({ value: k, label: v.label }))), fieldFilter('vehicle', 'Vehicle', (x) => x.vehicleId || '', () => store.all('vehicles').map((v) => ({ value: v.id, label: vehicleName(v) })))],
    defaultSort: { id: 'date', dir: 'desc' },
    search: (x) => [x.file.name, SOURCES[x.coll].name(x.rec), x.vehicleId ? vehicleName(lookup.vehicle(x.vehicleId)) : ''].join(' '),
    columns: [
      {
        id: 'name',
        label: 'Name',
        fixed: true,
        render: (x) => {
          const t = h('span.thumb.sm', icon(x.kind === 'image' ? 'image' : 'file', 15));
          if (x.kind === 'image') loadImage(t, x.file);
          return h('button.cell-vehicle.link-btn', { type: 'button', onClick: () => openFile(x.file) }, t, h('span.cell-title', x.file.name));
        },
        sort: (x) => x.file.name,
      },
      { id: 'source', label: 'Attached to', render: (x) => h('span.cell-text', h('a', { href: SOURCES[x.coll].href(x.rec) }, SOURCES[x.coll].name(x.rec)), h('span.cell-sub', SOURCES[x.coll].label)), sort: (x) => SOURCES[x.coll].label },
      { id: 'vehicle', label: 'Vehicle', render: (x) => (x.vehicleId ? vehicleName(lookup.vehicle(x.vehicleId)) : dash()), sort: (x) => (x.vehicleId ? vehicleName(lookup.vehicle(x.vehicleId)) : '') },
      { id: 'size', label: 'Size', align: 'r', render: (x) => formatBytes(x.file.size), sort: (x) => x.file.size || 0 },
      // createdAt is UTC; show the day it was where the viewer is.
      { id: 'date', label: 'Added', render: (x) => (x.file.createdAt ? formatDate(toISODate(new Date(x.file.createdAt))) : dash()), sort: (x) => x.file.createdAt || '' },
    ],
    mobile: (x) => h('div.grow', h('strong.truncate', x.file.name), h('div.subtle.truncate', `${SOURCES[x.coll].label}: ${SOURCES[x.coll].name(x.rec)}`)),
    empty: { icon: 'folder', title: 'No documents yet', text: 'Upload titles, registrations, insurance cards, receipts, and photos on any vehicle or record. They all show up here.' },
  });
}
