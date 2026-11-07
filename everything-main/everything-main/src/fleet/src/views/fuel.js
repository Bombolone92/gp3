import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderList, fieldFilter } from '../ui/grid.js';
import { app, lookup, canEdit, canDelete } from '../app.js';
import { vehicleName, formatDecimal, formatEconomy } from '../core/format.js';
import { formatDate, formatTime, addDays } from '../core/dates.js';
import { fuelDerivedAll, fuelSummary } from '../core/fuel.js';
import { deleteFuel } from '../core/actions.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { pill } from '../ui/components.js';
import { vehicleCell, vendorCell, money, options, meterText, dash } from './common.js';
import { importFuel } from './importers.js';
import { stat } from './service.js';

export function render(ctx) {
  const store = app.store;
  const s = () => app.settings();
  const today = app.today();
  let derived = null;
  let derivedKey = null;
  const d = () => {
    const key = [store.all('fuel'), store.all('vehicles')];
    if (!derivedKey || key[0] !== derivedKey[0] || key[1] !== derivedKey[1]) {
      derived = fuelDerivedAll(store.all('fuel'), (id) => lookup.vehicle(id), s().units.volume);
      derivedKey = key;
    }
    return derived;
  };
  const unitOf = (f) => (f.kind === 'charge' ? 'kWh' : s().units.volume);
  const editable = canEdit('fuel');
  return renderList(ctx, {
    key: 'fuel',
    title: 'Fuel and energy',
    coll: 'fuel',
    watch: ['vehicles', 'vendors'],
    csvName: 'fuel-history',
    actions: editable ? [h('a.btn.primary', { href: '#/fuel/new' }, icon('plus', 16), 'Add fuel entry')] : [],
    more: editable ? [{ label: 'Import from CSV', icon: 'upload', run: importFuel }] : [],
    tabs: [
      { id: '30', label: 'Last 30 days', count: false, filter: (f) => f.date >= addDays(today, -29) },
      { id: '90', label: 'Last 90 days', count: false, filter: (f) => f.date >= addDays(today, -89) },
      { id: 'year', label: 'This year', count: false, filter: (f) => f.date >= `${today.slice(0, 4)}-01-01` },
      { id: 'all', label: 'All time', count: false },
    ],
    filters: [
      fieldFilter('vehicle', 'Vehicle', 'vehicleId', options.vehicles({ includeArchived: true })),
      fieldFilter('kind', 'Type', (f) => f.kind || 'fuel', () => [
        { value: 'fuel', label: 'Fuel' },
        { value: 'charge', label: 'Charging' },
      ]),
      fieldFilter('vendor', 'Vendor', (f) => f.vendorId || '', () => options.vendors('fuel')()),
      fieldFilter('group', 'Vehicle group', (f) => lookup.vehicle(f.vehicleId)?.groupId || '', () => (app.settings().groups || []).map((g) => ({ value: g.id, label: g.name }))),
    ],
    defaultSort: { id: 'date', dir: 'desc' },
    search: (f) => [vehicleName(lookup.vehicle(f.vehicleId)), lookup.vendorName(f.vendorId), f.reference, f.notes, f.by].join(' '),
    rowHref: (f) => `#/fuel/${f.id}`,
    summary: (rows) => {
      const fuelRows = rows.filter((f) => f.kind !== 'charge');
      const sum = fuelSummary(fuelRows, d(), { meterUnit: s().units.distance, volumeUnit: s().units.volume });
      const all = rows.reduce((a, f) => a + (Number(f.total) || 0), 0);
      const kwh = rows.filter((f) => f.kind === 'charge').reduce((a, f) => a + (Number(f.volume) || 0), 0);
      return h(
        'div.summary-stats',
        stat('Total cost', money(all)),
        stat('Fuel volume', h('span', formatDecimal(sum.volume, 1), h('small', ` ${s().units.volume}`))),
        kwh ? stat('Energy', h('span', formatDecimal(kwh, 1), h('small', ' kWh'))) : null,
        stat('Average economy', sum.avgEconomy ? formatEconomy(sum.avgEconomy, s().units.distance, s().units.volume) : '-'),
        stat('Average price', sum.avgPrice ? h('span', money(Math.round(sum.avgPrice * 100)), h('small', ` / ${s().units.volume}`)) : '-'),
      );
    },
    columns: [
      { id: 'vehicle', label: 'Vehicle', render: (f) => vehicleCell(f.vehicleId, { sub: false }), sort: (f) => vehicleName(lookup.vehicle(f.vehicleId)), csv: (f) => vehicleName(lookup.vehicle(f.vehicleId)) },
      { id: 'date', label: 'Date', render: (f) => h('span', formatDate(f.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }), f.time ? h('span.cell-sub', formatTime(f.time)) : null), sort: (f) => `${f.date} ${f.time || ''}`, csv: (f) => f.date },
      { id: 'vendor', label: 'Vendor', render: (f) => (f.vendorId ? vendorCell(f.vendorId) : dash()), sort: (f) => lookup.vendorName(f.vendorId) },
      { id: 'meter', label: 'Meter', align: 'r', render: (f) => (f.meter != null ? h('span.num', meterText(f.meter, lookup.vehicle(f.vehicleId))) : dash()), sort: (f) => (f.meter == null ? null : Number(f.meter)) },
      { id: 'usage', label: 'Usage', align: 'r', render: (f) => (d().get(f.id)?.usage != null ? h('span.num', meterText(d().get(f.id).usage, lookup.vehicle(f.vehicleId))) : dash()), sort: (f) => d().get(f.id)?.usage ?? null, csv: (f) => d().get(f.id)?.usage ?? '' },
      { id: 'volume', label: 'Volume', align: 'r', render: (f) => h('span.cell-text', h('span.num', `${formatDecimal(f.volume, 3)} ${unitOf(f)}`), f.partial ? h('span.cell-sub', 'Partial') : f.reset ? h('span.cell-sub', 'Missed fill-up') : null), sort: (f) => Number(f.volume) || 0 },
      { id: 'total', label: 'Total', align: 'r', render: (f) => h('span.cell-text', h('span.money', money(f.total)), f.price ? h('span.cell-sub', `${money(Math.round(f.price * 1000) / 10)} / ${unitOf(f)}`) : null), sort: (f) => Number(f.total) || 0, csv: (f) => (Number(f.total) / 100).toFixed(2) },
      { id: 'economy', label: 'Economy', align: 'r', render: (f) => { const e = d().get(f.id)?.economy; const v = lookup.vehicle(f.vehicleId); return e ? h('span.num', formatEconomy(e, v?.meterUnit || s().units.distance, unitOf(f))) : dash(); }, sort: (f) => d().get(f.id)?.economy ?? null, csv: (f) => d().get(f.id)?.economy?.toFixed(2) ?? '' },
      { id: 'cpm', label: 'Cost per meter', align: 'r', render: (f) => { const c = d().get(f.id)?.costPerMeter; return c != null ? h('span.money', `${money(c)}/${lookup.vehicle(f.vehicleId)?.meterUnit || s().units.distance}`) : dash(); }, sort: (f) => d().get(f.id)?.costPerMeter ?? null, csv: (f) => (d().get(f.id)?.costPerMeter != null ? (d().get(f.id).costPerMeter / 100).toFixed(2) : '') },
      { id: 'fuelType', label: 'Fuel type', hidden: true, render: (f) => f.fuelType || dash(), sort: (f) => f.fuelType || '' },
      { id: 'by', label: 'Entered by', hidden: true, render: (f) => f.by || dash(), sort: (f) => f.by || '' },
      { id: 'kind', label: 'Type', hidden: true, render: (f) => (f.kind === 'charge' ? pill('Charging', 'teal') : pill('Fuel', 'gray')), sort: (f) => f.kind || 'fuel' },
    ],
    mobile: (f) => h('div.grow', h('div.row', h('strong.grow.truncate', vehicleName(lookup.vehicle(f.vehicleId))), h('span.money', money(f.total))), h('div.subtle.truncate', `${formatDate(f.date)} · ${formatDecimal(f.volume, 2)} ${unitOf(f)}${f.meter != null ? ` · ${meterText(f.meter, lookup.vehicle(f.vehicleId))}` : ''}`)),
    bulk: canDelete('fuel')
      ? [
          {
            label: 'Delete',
            icon: 'trash',
            danger: true,
            run: async (rows) => {
              const many = rows.length === 1 ? 'this fuel entry' : `${rows.length} fuel entries`;
              if (!(await confirmDialog({ title: `Delete ${many}?`, message: 'Their meter readings are removed too. This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return false;
              rows.forEach((f) => deleteFuel(store, f.id));
              toast(`${rows.length} fuel ${rows.length === 1 ? 'entry' : 'entries'} deleted`);
            },
          },
        ]
      : null,
    empty: { icon: 'fuel', title: 'No fuel entries', text: 'Log fill-ups and charging sessions to track fuel economy, spending, and cost per mile.', action: () => h('a.btn.primary', { href: '#/fuel/new' }, icon('plus', 16), 'Add fuel entry') },
  });
}
