import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { formPage } from '../ui/form.js';
import { app, lookup, myName, canEdit, canDelete } from '../app.js';
import { navigate, back } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { vehicleName, formatDecimal, formatEconomy } from '../core/format.js';
import { fuelTotal, unitPrice, fuelWarnings, fuelDerived } from '../core/fuel.js';
import { saveFuel, deleteFuel, meterWarnings } from '../core/actions.js';
import { centsToInput } from '../core/money.js';
import { confirmDialog } from '../ui/dialog.js';
import { options, emptyPage, meterUnitLabel, attachmentsPanel, money } from './common.js';

export function render(ctx) {
  const store = app.store;
  const existing = ctx.params.id ? store.get('fuel', ctx.params.id) : null;
  if (ctx.params.id && !existing) return emptyPage('Fuel entry not found', 'It may have been deleted.');
  const s = app.settings();
  const now = new Date();
  const v0 = lookup.vehicle(existing?.vehicleId || ctx.query.vehicle);
  const rec = existing || {
    vehicleId: v0?.id || null,
    date: app.today(),
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    fuelType: v0?.fuelType || null,
    kind: v0?.fuelType === 'Electric' ? 'charge' : 'fuel',
    partial: false,
    reset: false,
    by: myName(),
  };
  let veh = v0;
  const volUnit = (k) => (k === 'charge' ? 'kWh' : s.units.volume === 'L' ? 'L' : 'gal');
  const warn = h('div.form-warning', { role: 'status', 'aria-live': 'polite' });
  const calc = h('p.calc-line', { 'aria-live': 'polite' });
  // The two of volume, price, and total edited last decide the third. An
  // existing entry starts from volume and price, so fixing the price
  // recalculates the total rather than the volume.
  let lastEdited = existing ? ['volume', 'price'] : [];

  const page = formPage({
    title: existing ? 'Fuel entry' : 'New fuel entry',
    crumbs: [{ label: 'Fuel and energy', href: '#/fuel' }, { label: existing ? vehicleName(lookup.vehicle(existing.vehicleId)) : 'New' }],
    record: { ...rec, totalCents: rec.total ?? null },
    saveLabel: existing ? 'Save entry' : 'Add fuel entry',
    extraActions: existing && canDelete('fuel')
      ? h('button.btn.subtle-danger', {
          type: 'button',
          onClick: async () => {
            if (!(await confirmDialog({ title: 'Delete fuel entry?', message: 'Its meter reading is removed too.', confirmLabel: 'Delete', danger: true }))) return;
            deleteFuel(store, existing.id);
            page.form.markClean();
            toast('Fuel entry deleted');
            navigate('/fuel');
          },
        }, icon('trash', 15), 'Delete')
      : null,
    sections: [
      {
        id: 'entry',
        title: 'Details',
        fields: [
          { id: 'vehicleId', label: 'Vehicle', type: 'picker', required: true, options: options.vehicles({ keep: rec.vehicleId }), span: 2 },
          { id: 'date', label: 'Date', type: 'date', required: true, validate: (v) => (v > app.today() ? 'The date cannot be in the future.' : null) },
          { id: 'time', label: 'Time', type: 'time' },
          { id: 'meter', label: 'Odometer', type: 'number', min: 0, unit: () => meterUnitLabel(veh), hint: 'Needed for fuel economy and cost per mile.' },
          { id: 'kind', label: 'Type', type: 'select', required: true, options: () => [{ value: 'fuel', label: 'Fuel fill-up' }, { value: 'charge', label: 'Electric charging' }] },
          { id: 'volume', label: 'Volume', type: 'number', required: true, min: 0, step: '0.001', unit: (vals) => volUnit(vals?.kind || rec.kind) },
          { id: 'price', label: 'Price per unit', type: 'number', min: 0, step: '0.001', unit: () => s.currency },
          { id: 'totalCents', label: 'Total cost', type: 'money', required: true, hint: 'Enter any two of volume, price, and total.' },
          { id: 'fuelType', label: 'Fuel type', type: 'select', options: () => s.fuelTypes, placeholder: 'Not set' },
          { id: 'vendorId', label: 'Vendor', type: 'picker', options: options.vendors('fuel', rec.vendorId), placeholder: 'No vendor' },
          { id: 'partial', label: 'Partial', type: 'checkbox', checkLabel: 'Partial fill-up (tank not filled)' },
          { id: 'reset', label: 'Missed', type: 'checkbox', checkLabel: 'Previous fill-up was not recorded' },
          { id: 'reference', label: 'Reference', placeholder: 'Receipt or card transaction number' },
          { id: 'by', label: 'Entered by' },
          { id: 'notes', label: 'Notes', type: 'textarea', span: 2, rows: 2 },
        ],
        after: h('div', calc, warn),
      },
    ],
    onChange: (vals, fid) => {
      if (fid === 'vehicleId') {
        veh = lookup.vehicle(vals.vehicleId);
        if (veh?.fuelType && !existing) {
          page.form.set('fuelType', veh.fuelType);
          page.form.set('kind', veh.fuelType === 'Electric' ? 'charge' : 'fuel');
        }
      }
      // Fill the third of volume, price, and total from the two edited last.
      if (['volume', 'price', 'totalCents'].includes(fid)) {
        // A cleared field no longer counts as one of the two given, so the
        // next edit can work it out again.
        const cleared = !Number(vals[fid]);
        lastEdited = cleared ? lastEdited.filter((x) => x !== fid) : [fid, ...lastEdited.filter((x) => x !== fid)].slice(0, 2);
        const vol = Number(vals.volume) || 0;
        const price = Number(vals.price) || 0;
        const total = Number(vals.totalCents) || 0;
        const missing = lastEdited.length === 2 && ['volume', 'price', 'totalCents'].find((x) => !lastEdited.includes(x));
        if (missing === 'totalCents' && vol && price) page.form.set('totalCents', fuelTotal(vol, price));
        else if (missing === 'price' && vol && total) page.form.set('price', unitPrice(total, vol));
        else if (missing === 'volume' && price && total) page.form.set('volume', Math.round((total / 100 / price) * 1000) / 1000);
      }
      refresh();
    },
    onCancel: () => back('/fuel'),
    onSave: (v) => {
      // Build on the stored record, not the one the form opened with: files
      // and other changes may have arrived meanwhile.
      const cur = existing && store.get('fuel', existing.id);
      if (existing && !cur) {
        toast('This fuel entry was deleted, so the changes were not saved.', { type: 'error' });
        return false;
      }
      const data = { ...(cur || { attachments: [] }), vehicleId: v.vehicleId, date: v.date, time: v.time, meter: v.meter, kind: v.kind, volume: v.volume, price: v.price ?? unitPrice(v.totalCents, v.volume), total: v.totalCents, fuelType: v.fuelType || null, vendorId: v.vendorId || null, partial: v.partial, reset: v.reset, reference: v.reference, by: v.by, notes: v.notes };
      const saved = saveFuel(store, data);
      page.form.markClean();
      toast(existing ? 'Fuel entry saved' : 'Fuel entry added');
      navigate(existing ? `/fuel/${saved.id}` : '/fuel', { replace: true });
    },
  });

  function refresh() {
    const vals = page.form.values();
    // The meter reading checks cover earlier fill-ups too (each one records
    // a reading), so only the tank check is taken from the fuel warnings.
    const w = [
      ...fuelWarnings({ ...vals, meter: null, id: existing?.id }, veh, [], { volumeUnit: volUnit(vals.kind) }),
      ...meterWarnings(store, { vehicleId: vals.vehicleId, value: vals.meter, date: vals.date, ignoreSource: existing ? { type: 'fuel', id: existing.id } : null }),
    ];
    warn.replaceChildren(...[...new Set(w)].map((t) => h('p', icon('warning', 15), t)));
    // Preview what this fill-up does to economy.
    if (veh && vals.meter != null && vals.volume) {
      const others = store.all('fuel').filter((f) => f.vehicleId === veh.id && f.id !== existing?.id && (f.kind === 'charge') === (vals.kind === 'charge'));
      const tmp = { id: '__new', meter: vals.meter, volume: vals.volume, total: vals.totalCents, date: vals.date, partial: vals.partial, reset: vals.reset };
      const d = fuelDerived([...others, tmp], veh.meterUnit || s.units.distance, volUnit(vals.kind)).get('__new');
      calc.textContent = [d?.usage != null ? `${formatDecimal(d.usage, 0)} ${meterUnitLabel(veh)} since the last fill-up` : '', d?.economy ? formatEconomy(d.economy, veh.meterUnit || s.units.distance, volUnit(vals.kind)) : '', d?.costPerMeter != null ? `${money(d.costPerMeter)} per ${meterUnitLabel(veh)}` : ''].filter(Boolean).join(' · ');
    } else calc.textContent = '';
  }
  refresh();

  const node = existing ? h('div', page.node, h('div.page.form-page.after-form', attachmentsPanel('fuel', existing.id, { title: 'Receipt' }))) : page.node;
  return { node, title: existing ? 'Fuel entry' : 'New fuel entry', dirty: () => page.form.dirty() };
}

export { centsToInput };
