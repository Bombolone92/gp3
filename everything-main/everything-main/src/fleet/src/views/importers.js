/**
 * CSV import: pick a file, preview how columns map, then add the rows.
 * Each importer lists its fields with header aliases and a parser.
 */
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { app } from '../app.js';
import { parseCSV, findColumn, toCSV, downloadText } from '../core/csv.js';
import { parseMoney } from '../core/money.js';
import { cleanVin, vehicleName } from '../core/format.js';
import { recordMeter, recomputeVehicleMeter } from '../core/actions.js';
import { fuelTotal } from '../core/fuel.js';

const num = (s) => {
  const n = Number(String(s || '').replace(/[^0-9.-]/g, ''));
  return String(s || '').trim() === '' || !Number.isFinite(n) ? null : n;
};
const text = (s) => String(s || '').trim();
/** Accepts 2026-10-12, 10/12/2026, 12.10.2026 (day first when unambiguous). */
export function parseDate(s) {
  const t = text(s);
  let y;
  let month;
  let day;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) [, y, month, day] = m;
  else {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t);
    if (!m) return null;
    [, month, day, y] = m;
    if (y.length === 2) y = `20${y}`;
    if (Number(month) > 12) [month, day] = [day, month];
  }
  // Only real calendar dates: no month 13, no February 30.
  const d = new Date(Date.UTC(Number(y), Number(month) - 1, Number(day)));
  if (y.length !== 4 || d.getUTCMonth() !== Number(month) - 1 || d.getUTCDate() !== Number(day)) return null;
  return `${y}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Text of a picked file. Excel saves UTF-8 (with a byte order mark),
 * UTF-16 with a byte order mark ("Unicode text"), or, in older versions,
 * Windows-1252, which is not valid UTF-8 once it has accents.
 */
export async function readText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Comma, semicolon (Excel in many locales), or tab: whichever the header row uses most. */
export function sniffDelimiter(text) {
  const head = String(text).replace(/"[^"]*"/g, '').split(/\r?\n/, 1)[0];
  const count = (c) => head.split(c).length - 1;
  return [';', '\t'].reduce((best, c) => (count(c) > count(best) ? c : best), ',');
}

/** Skipped rows shown in the preview; the rest are in the downloadable report. */
const SHOW_SKIPPED = 10;

function importDialog({ title, fields, hint, check = () => () => null, onImport }) {
  const input = h('input', { type: 'file', accept: '.csv,text/csv', id: 'imp-file', class: 'input' });
  const preview = h('div.import-preview', { 'aria-live': 'polite' });
  let parsed = null;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const content = await readText(file);
    const rows = parseCSV(content, sniffDelimiter(content));
    if (rows.length < 2) {
      preview.replaceChildren(h('div.notice.warning', icon('warning'), h('span', 'The file has no data rows.')));
      parsed = null;
      return;
    }
    const headers = rows[0];
    const map = fields.map((f) => ({ f, idx: findColumn(headers, [f.id, f.label, ...(f.aliases || [])].map((a) => a.toLowerCase())) }));
    // One problem per row, or null when the row will be imported. Row
    // numbers count the header as row 1, as a spreadsheet shows them.
    const problemOf = check();
    const valid = [];
    const skipped = [];
    rows.slice(1).forEach((r, i) => {
      const out = {};
      for (const { f, idx } of map) out[f.id] = idx >= 0 ? (f.parse || text)(r[idx]) : null;
      const missing = fields.find((f) => f.required && (out[f.id] === null || out[f.id] === ''));
      const problem = missing ? `Missing or unreadable ${missing.label.toLowerCase()}` : problemOf(out, i + 2);
      if (problem) skipped.push({ row: i + 2, problem, cells: r });
      else valid.push(out);
    });
    parsed = valid;
    const total = rows.length - 1;
    const report = () => downloadText(`skipped-rows-${app.today()}.csv`, toCSV([['Row', 'Problem', ...headers], ...skipped.map((x) => [x.row, x.problem, ...x.cells])]));
    mount(
      preview,
      h('p', h('strong', `${valid.length} of ${total} rows`), ' will be imported.'),
      h(
        'ul.import-map',
        map.map(({ f, idx }) => h('li', idx >= 0 ? icon('check', 15) : icon('minus', 15), h('span', f.label), h('span.subtle', idx >= 0 ? `from "${headers[idx]}"` : f.required ? 'missing (required)' : 'not found'))),
      ),
      skipped.length
        ? h(
            'div.notice.warning.import-skipped',
            icon('warning'),
            h(
              'div.grow',
              h('p', `${skipped.length} row${skipped.length === 1 ? '' : 's'} will be skipped:`),
              h('ul.import-map', skipped.slice(0, SHOW_SKIPPED).map((x) => h('li', `Row ${x.row}: ${x.problem}`))),
              skipped.length > SHOW_SKIPPED ? h('p.subtle', `And ${skipped.length - SHOW_SKIPPED} more.`) : null,
              h('button.btn.sm', { type: 'button', onClick: report }, icon('download', 15), 'Download skipped rows'),
            ),
          )
        : null,
    );
  });
  openDialog({
    title,
    body: h('div.stack', h('p.muted', hint), h('div.field', h('label', { for: 'imp-file' }, 'CSV file'), input), preview),
    footer: ({ close }) => [
      h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
      h(
        'button.btn.primary',
        {
          type: 'button',
          onClick: async () => {
            if (!parsed?.length) return toast(parsed ? 'None of the rows can be imported.' : 'Choose a CSV file with data first.', { type: 'error' });
            const n = await onImport(parsed);
            close();
            toast(`Imported ${n} record${n === 1 ? '' : 's'}`);
          },
        },
        'Import',
      ),
    ],
  });
}

/** The fleet's own spelling of a listed value ("van" -> "Van"), or the value as written. */
const fromList = (list, value) => list.find((x) => x.toLowerCase() === value.toLowerCase()) || value;

export function importVehicles() {
  const s = app.settings();
  importDialog({
    title: 'Import vehicles',
    hint: 'Use a CSV with a header row. Columns are matched by name, for example Name, VIN, License plate, Year, Make, Model, Type, Meter.',
    fields: [
      { id: 'name', label: 'Name', aliases: ['vehicle', 'unit', 'asset', 'vehicle name'] },
      { id: 'vin', label: 'VIN', aliases: ['vin/sn', 'serial', 'serial number'], parse: cleanVin },
      { id: 'plate', label: 'License plate', aliases: ['plate', 'license'] },
      { id: 'year', label: 'Year', parse: num },
      { id: 'make', label: 'Make' },
      { id: 'model', label: 'Model' },
      { id: 'trim', label: 'Trim' },
      { id: 'type', label: 'Type', aliases: ['vehicle type'] },
      { id: 'fuelType', label: 'Fuel type', aliases: ['fuel'] },
      { id: 'color', label: 'Color' },
      { id: 'meter', label: 'Meter', aliases: ['odometer', 'current meter', 'mileage'], parse: num },
    ],
    check: () => {
      // A VIN belongs to one vehicle: skip rows that repeat one already in
      // the fleet or earlier in the file (importing the same file twice).
      const fleet = new Map(app.store.all('vehicles').filter((v) => v.vin).map((v) => [cleanVin(v.vin), v]));
      const inFile = new Map();
      return (r, row) => {
        if (!r.name && !r.vin && !r.make) return 'Needs a name, VIN, or make';
        // The same limits as the vehicle form.
        if (r.year != null && (r.year < 1900 || r.year > new Date().getFullYear() + 2)) return `Year ${r.year} is not a model year`;
        if (r.meter != null && r.meter < 0) return 'Meter cannot be negative';
        if (r.vin) {
          if (fleet.has(r.vin)) return `VIN ${r.vin} is already used by ${vehicleName(fleet.get(r.vin))}`;
          if (inFile.has(r.vin)) return `Same VIN as row ${inFile.get(r.vin)}`;
          inFile.set(r.vin, row);
        }
        return null;
      };
    },
    onImport: (rows) => {
      const recs = rows.map((r) => ({
        name: r.name || vehicleName(r),
        vin: r.vin || '',
        plate: r.plate || '',
        year: r.year,
        make: r.make || '',
        model: r.model || '',
        trim: r.trim || '',
        type: r.type ? fromList(s.vehicleTypes, r.type) : s.vehicleTypes[0],
        fuelType: r.fuelType ? fromList(s.fuelTypes, r.fuelType) : null,
        color: r.color || '',
        status: s.vehicleStatuses[0]?.id || 'active',
        meterUnit: s.units.distance,
        ownership: 'owned',
        labels: [],
        attachments: [],
        archived: false,
      }));
      const added = app.store.bulkPut('vehicles', recs);
      rows.forEach((r, i) => r.meter != null && added[i] && recordMeter(app.store, { vehicleId: added[i].id, value: r.meter, date: app.today() }));
      return added.length;
    },
  });
}

export function importContacts() {
  importDialog({
    title: 'Import contacts',
    hint: 'Columns are matched by name: First name, Last name, Email, Phone, Job title, Employee number.',
    fields: [
      { id: 'firstName', label: 'First name', aliases: ['first', 'given name'] },
      { id: 'lastName', label: 'Last name', aliases: ['last', 'surname', 'family name'] },
      { id: 'name', label: 'Name', aliases: ['full name'] },
      { id: 'email', label: 'Email', aliases: ['e-mail', 'email address'] },
      { id: 'phone', label: 'Phone', aliases: ['mobile', 'phone number'] },
      { id: 'jobTitle', label: 'Job title', aliases: ['title', 'position'] },
      { id: 'employeeNumber', label: 'Employee number', aliases: ['employee id', 'employee #'] },
    ],
    check: () => (r) => {
      if (!r.firstName && !r.lastName && !r.name && !r.email) return 'Needs a name or email';
      // The same check as the contact form.
      if (r.email && !/^\S+@\S+\.\S+$/.test(r.email)) return `Email "${r.email}" is not a valid address`;
      return null;
    },
    onImport: (rows) => {
      const recs = rows.map((r) => {
        let { firstName, lastName } = r;
        if (!firstName && !lastName && r.name) [firstName, ...lastName] = r.name.split(/\s+/);
        return { firstName: firstName || '', lastName: Array.isArray(lastName) ? lastName.join(' ') : lastName || '', email: r.email || '', phone: r.phone || '', jobTitle: r.jobTitle || '', employeeNumber: r.employeeNumber || '', roles: ['employee'], archived: false, attachments: [] };
      });
      return app.store.bulkPut('contacts', recs).length;
    },
  });
}

export function importParts() {
  importDialog({
    title: 'Import parts',
    hint: 'Columns are matched by name: Part number, Description, Category, Manufacturer, Unit cost, Quantity.',
    fields: [
      { id: 'number', label: 'Part number', aliases: ['part', 'part #', 'sku', 'number'], required: true },
      { id: 'description', label: 'Description', aliases: ['name'] },
      { id: 'category', label: 'Category' },
      { id: 'manufacturer', label: 'Manufacturer', aliases: ['brand'] },
      { id: 'mpn', label: 'Manufacturer part number', aliases: ['mpn'] },
      { id: 'unitCost', label: 'Unit cost', aliases: ['cost', 'price'], parse: (v) => parseMoney(v) },
      { id: 'qty', label: 'Quantity', aliases: ['qty', 'on hand', 'stock'], parse: num },
    ],
    check: () => {
      const key = (n) => String(n || '').trim().toLowerCase();
      const fleet = new Set(app.store.all('parts').map((p) => key(p.number)));
      const inFile = new Map();
      return (r, row) => {
        const k = key(r.number);
        if (fleet.has(k)) return `Part number ${r.number} already exists`;
        if (inFile.has(k)) return `Same part number as row ${inFile.get(k)}`;
        inFile.set(k, row);
        return null;
      };
    },
    onImport: (rows) => {
      const loc = app.settings().partLocations[0] || 'Main shop';
      const recs = rows.map((r) => ({ number: r.number, description: r.description || '', category: r.category || '', manufacturer: r.manufacturer || '', mpn: r.mpn || '', unit: 'each', unitCost: r.unitCost || 0, locations: [{ location: loc, qty: r.qty || 0, aisle: '', reorderPoint: null }], archived: false, attachments: [] }));
      return app.store.bulkPut('parts', recs).length;
    },
  });
}

export function importFuel() {
  const byName = () => new Map(app.store.all('vehicles').flatMap((v) => [[vehicleName(v).toLowerCase(), v], [String(v.vin || '').toLowerCase(), v], [String(v.plate || '').toLowerCase(), v]]));
  importDialog({
    title: 'Import fuel entries',
    hint: 'Each row needs a vehicle (name, VIN, or plate), a date, a volume, and a total or a price per unit. Odometer is also matched.',
    fields: [
      { id: 'vehicle', label: 'Vehicle', aliases: ['vehicle name', 'unit', 'asset', 'vin', 'plate'], required: true },
      { id: 'date', label: 'Date', required: true, parse: parseDate },
      { id: 'meter', label: 'Odometer', aliases: ['meter', 'mileage'], parse: num },
      { id: 'volume', label: 'Volume', aliases: ['gallons', 'liters', 'quantity'], parse: num },
      { id: 'price', label: 'Price per unit', aliases: ['price', 'unit price', 'ppg'], parse: num },
      { id: 'total', label: 'Total', aliases: ['cost', 'amount'], parse: (v) => parseMoney(v) },
    ],
    check: () => {
      const vs = byName();
      const today = app.today();
      // The same rules as the fuel form.
      return (r) => {
        if (!vs.has(r.vehicle.toLowerCase())) return `No vehicle matches "${r.vehicle}"`;
        if (r.date > today) return `The date ${r.date} is in the future`;
        if (r.volume === null) return 'Missing volume';
        if (r.volume < 0 || (r.meter !== null && r.meter < 0)) return 'Volume and odometer cannot be negative';
        if (r.total === null && r.price === null) return 'Needs a total or a price';
        return null;
      };
    },
    onImport: (rows) => {
      const vs = byName();
      const entries = [];
      for (const r of rows) {
        const v = vs.get(r.vehicle.toLowerCase());
        if (!v) continue;
        const total = r.total ?? fuelTotal(r.volume, r.price);
        const price = r.price ?? (r.volume ? Math.round((total / 100 / r.volume) * 1000) / 1000 : null);
        entries.push({ vehicleId: v.id, date: r.date, meter: r.meter, volume: r.volume, price, total, kind: v.fuelType === 'Electric' ? 'charge' : 'fuel', fuelType: v.fuelType, partial: false, reset: false, attachments: [] });
      }
      // Add the entries and their odometer readings in two batches, then
      // settle each vehicle's meter once. Saving them one at a time looks
      // up every existing reading per row, which froze large imports.
      const added = app.store.bulkPut('fuel', entries);
      const readings = added.filter((f) => f.meter !== null).map((f) => ({ vehicleId: f.vehicleId, value: Number(f.meter), date: f.date, source: { type: 'fuel', id: f.id }, note: '', void: false }));
      app.store.bulkPut('meters', readings);
      for (const vid of new Set(readings.map((m) => m.vehicleId))) recomputeVehicleMeter(app.store, vid);
      return added.length;
    },
  });
}
