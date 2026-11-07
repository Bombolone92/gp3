import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { formPage } from '../ui/form.js';
import { app, canEdit } from '../app.js';
import { navigate, back } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { OWNERSHIP } from '../core/status.js';
import { checkVin, cleanVin, vinYear, vehicleName, METER_UNITS } from '../core/format.js';
import { recordMeter } from '../core/actions.js';
import { decodeVin } from '../core/vin.js';
import { options, emptyPage, loadImage, noPermissionPage } from './common.js';
import { saveFile, deleteFile, isImage } from '../files.js';

export function render(ctx) {
  const store = app.store;
  const s = app.settings();
  const id = ctx.params.id;
  const existing = id ? store.get('vehicles', id) : null;
  if (id && !existing) return emptyPage('Vehicle not found', 'It may have been deleted.');
  if (!canEdit('vehicles')) return noPermissionPage('vehicles');
  const rec = existing || {
    status: s.vehicleStatuses[0]?.id || 'active',
    type: s.vehicleTypes[0],
    ownership: 'owned',
    meterUnit: s.units.distance,
    labels: [],
    groupId: ctx.query.group || null,
  };
  let photo = rec.photo || null;
  let meterU = rec.meterUnit || s.units.distance;
  const unit = () => METER_UNITS[meterU]?.short || 'mi';

  // Photo picker: a square preview that uploads on choose.
  const photoBox = h('span.photo-pick-preview', icon('camera', 26));
  if (photo) loadImage(photoBox, photo);
  const photoInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const pickBtn = h('button.photo-pick-btn', { type: 'button', onClick: () => photoInput.click() }, photoBox);
  const pickText = h('div.photo-pick-text');
  // Redrawn when a photo is added or removed, so the buttons match.
  function drawPhotoControls() {
    pickBtn.setAttribute('aria-label', photo ? 'Change photo' : 'Add a photo');
    const add = h('button.btn.sm', { type: 'button', onClick: () => photoInput.click() }, icon('upload', 15), photo ? 'Change photo' : 'Add photo');
    const remove = () => {
      photo = null;
      photoBox.replaceChildren(icon('camera', 26));
      drawPhotoControls();
      pickText.querySelector('button')?.focus();
    };
    mount(pickText, add, photo ? h('button.link-btn', { type: 'button', onClick: remove }, 'Remove') : null, h('span.hint', 'JPG or PNG. Resized automatically.'));
  }
  drawPhotoControls();
  const photoField = h('div.photo-pick', pickBtn, pickText, photoInput);
  photoInput.addEventListener('change', async () => {
    const f = photoInput.files?.[0];
    photoInput.value = '';
    if (!f) return;
    if (!isImage(f.type) && !/^image\/hei[cf]$/i.test(f.type)) return toast('Choose an image file.', { type: 'error' });
    photoBox.replaceChildren(icon('loader', 22, 'spin'));
    try {
      const saved = await saveFile(f, 'files/vehicles');
      // A HEIC photo this browser could not convert would show as a broken image.
      if (!isImage(saved.type)) {
        deleteFile(saved).catch(() => {});
        throw new Error('This browser cannot read HEIC photos. Choose a JPG or PNG.');
      }
      photo = saved;
      loadImage(photoBox, photo);
      drawPhotoControls();
    } catch (err) {
      photoBox.replaceChildren(icon('camera', 26));
      toast(err.message || 'Could not upload the photo.', { type: 'error' });
    }
  });

  const vinHint = h('span');
  const sections = [
    {
      id: 'details',
      title: 'Details',
      icon: 'file',
      fields: [
        { id: 'name', label: 'Vehicle name', required: true, hint: 'A short name your team uses, like a unit number.', placeholder: 'e.g. 104 or Ford Transit 3' },
        {
          id: 'vin',
          label: 'VIN or serial number',
          get: (r) => r.vin || '',
          maxlength: 32,
          validate: (v) => {
            const c = cleanVin(v);
            if (!c) return null;
            const res = checkVin(c);
            if (c.length === 17 && res === 'invalid') return 'This VIN contains letters that are never used (I, O, Q).';
            // A VIN saved before duplicates were refused may stay as it is.
            const dup = c !== cleanVin(existing?.vin || '') && store.all('vehicles').find((x) => x.id !== existing?.id && x.vin && cleanVin(x.vin) === c);
            if (dup) return `This VIN is already used by ${vehicleName(dup)}.`;
            return null;
          },
        },
        { id: 'plate', label: 'License plate' },
        { id: 'registrationState', label: 'Registration state or province' },
        { id: 'type', label: 'Type', type: 'select', required: true, options: () => s.vehicleTypes },
        { id: 'fuelType', label: 'Fuel type', type: 'select', options: () => s.fuelTypes, placeholder: 'Not set' },
        { id: 'year', label: 'Year', type: 'number', min: 1900, max: new Date().getFullYear() + 2 },
        { id: 'make', label: 'Make', placeholder: 'e.g. Ford' },
        { id: 'model', label: 'Model', placeholder: 'e.g. Transit 250' },
        { id: 'trim', label: 'Trim' },
        { id: 'color', label: 'Color' },
        { id: 'labels', label: 'Labels', type: 'tags', options: () => [...new Set(store.all('vehicles').flatMap((v) => v.labels || []))] },
        { id: 'photo', label: 'Photo', type: 'custom', span: 2, render: () => Object.defineProperty(photoField, 'value', { get: () => photo, configurable: true }), get: () => photo },
      ],
    },
    {
      id: 'classification',
      title: 'Status and assignment',
      icon: 'circle-dot',
      fields: [
        { id: 'status', label: 'Status', type: 'select', required: true, options: () => s.vehicleStatuses.map((x) => ({ value: x.id, label: x.label })) },
        { id: 'groupId', label: 'Group', type: 'picker', options: options.groups(), placeholder: 'No group', hint: s.groups?.length ? null : 'Add groups such as depots or departments in Settings.' },
        { id: 'ownership', label: 'Ownership', type: 'select', required: true, options: () => OWNERSHIP.map((o) => ({ value: o.id, label: o.label })) },
        { id: 'meterUnit', label: 'Primary meter', type: 'select', required: true, options: () => Object.entries(METER_UNITS).map(([k, u]) => ({ value: k, label: u.long[0].toUpperCase() + u.long.slice(1) })) },
        existing ? null : { id: 'startMeter', label: 'Current meter reading', type: 'number', min: 0, unit, hint: 'Recorded as the first meter reading.' },
      ].filter(Boolean),
    },
    {
      id: 'lifecycle',
      title: 'Lifecycle',
      icon: 'calendar',
      intro: 'Used for replacement planning and cost per mile over the vehicle life.',
      fields: [
        { id: 'inServiceDate', label: 'In-service date', type: 'date' },
        { id: 'inServiceMeter', label: 'In-service meter', type: 'number', min: 0, unit },
        { id: 'estServiceLifeMonths', label: 'Estimated service life', type: 'number', min: 0, unit: 'months' },
        { id: 'estServiceLifeMeter', label: 'Estimated service life meter', type: 'number', min: 0, unit },
        { id: 'estResaleValue', label: 'Estimated resale value', type: 'money' },
        { id: 'outOfServiceDate', label: 'Out-of-service date', type: 'date', validate: (v, vals) => (v && vals.inServiceDate && v < vals.inServiceDate ? 'The out-of-service date must be on or after the in-service date.' : null) },
        { id: 'outOfServiceMeter', label: 'Out-of-service meter', type: 'number', min: 0, unit },
      ],
    },
    {
      id: 'purchase',
      title: 'Purchase',
      icon: 'cash',
      fields: [
        { id: 'purchaseVendor', label: 'Purchased from', get: (r) => r.purchase?.vendorName || '' },
        { id: 'purchaseDate', label: 'Purchase date', type: 'date', get: (r) => r.purchase?.date || '' },
        { id: 'purchasePrice', label: 'Purchase price', type: 'money', get: (r) => r.purchase?.price ?? null },
        { id: 'purchaseMeter', label: 'Meter at purchase', type: 'number', min: 0, unit, get: (r) => r.purchase?.meter ?? null },
        { id: 'loanPayment', label: 'Monthly loan or lease payment', type: 'money', get: (r) => r.purchase?.monthlyPayment ?? null },
        { id: 'loanEnd', label: 'Loan or lease ends', type: 'date', get: (r) => r.purchase?.endDate || '' },
        { id: 'purchaseNotes', label: 'Notes', type: 'textarea', span: 2, get: (r) => r.purchase?.notes || '' },
      ],
    },
    {
      id: 'specs',
      title: 'Specifications',
      icon: 'sliders',
      fields: [
        { id: 'fuelCapacity', label: 'Fuel tank capacity', type: 'number', min: 0, step: '0.1', unit: () => (s.units.volume === 'L' ? 'L' : 'gal'), get: (r) => r.specs?.fuelCapacity ?? null },
        { id: 'engine', label: 'Engine', get: (r) => r.specs?.engine || '' },
        { id: 'transmission', label: 'Transmission', get: (r) => r.specs?.transmission || '' },
        { id: 'oilCapacity', label: 'Oil capacity', get: (r) => r.specs?.oilCapacity || '' },
        { id: 'tireSize', label: 'Tire size', get: (r) => r.specs?.tireSize || '' },
        { id: 'curbWeight', label: 'Curb weight', get: (r) => r.specs?.curbWeight || '' },
        { id: 'gvwr', label: 'Gross vehicle weight rating', get: (r) => r.specs?.gvwr || '' },
        { id: 'towing', label: 'Towing capacity', get: (r) => r.specs?.towing || '' },
      ],
    },
    { id: 'notes', title: 'Notes', icon: 'message', fields: [{ id: 'notes', label: 'Notes', type: 'textarea', span: 2, rows: 4 }] },
  ];

  const page = formPage({
    title: existing ? `Edit ${vehicleName(existing)}` : 'New vehicle',
    crumbs: [{ label: 'Vehicles', href: '#/vehicles' }, existing ? { label: vehicleName(existing), href: `#/vehicles/${existing.id}` } : { label: 'New' }],
    sections,
    record: rec,
    saveLabel: existing ? 'Save vehicle' : 'Add vehicle',
    onCancel: () => back(existing ? `/vehicles/${existing.id}` : '/vehicles'),
    onChange: (vals, fid) => {
      if (fid === 'meterUnit') meterU = vals.meterUnit;
      if (fid !== 'vin') return;
      const c = cleanVin(vals.vin);
      const res = c.length === 17 ? checkVin(c) : null;
      vinHint.textContent = res === 'ok' ? `Valid VIN${vinYear(c) ? `, model year ${vinYear(c)}` : ''}.` : res === 'checkdigit' ? 'The check digit does not match. That is normal for vehicles built outside North America; otherwise check for a typo.' : '';
      const yr = res === 'ok' && vinYear(c);
      if (yr && !vals.year) page.form.set('year', yr);
    },
    onSave: (v) => {
      // Build on the stored vehicle, not the one the form opened with:
      // its meter, operator, and files may have changed meanwhile.
      const cur = existing && store.get('vehicles', existing.id);
      if (existing && !cur) {
        toast('This vehicle was deleted, so the changes were not saved.', { type: 'error' });
        return false;
      }
      const data = {
        ...(cur || {}),
        name: v.name,
        vin: cleanVin(v.vin),
        plate: v.plate,
        registrationState: v.registrationState,
        type: v.type,
        fuelType: v.fuelType || null,
        year: v.year,
        make: v.make,
        model: v.model,
        trim: v.trim,
        color: v.color,
        labels: v.labels,
        photo,
        status: v.status,
        groupId: v.groupId || null,
        ownership: v.ownership,
        meterUnit: v.meterUnit,
        inServiceDate: v.inServiceDate || null,
        inServiceMeter: v.inServiceMeter,
        estServiceLifeMonths: v.estServiceLifeMonths,
        estServiceLifeMeter: v.estServiceLifeMeter,
        estResaleValue: v.estResaleValue,
        outOfServiceDate: v.outOfServiceDate || null,
        outOfServiceMeter: v.outOfServiceMeter,
        purchase: { vendorName: v.purchaseVendor, date: v.purchaseDate || null, price: v.purchasePrice, meter: v.purchaseMeter, monthlyPayment: v.loanPayment, endDate: v.loanEnd || null, notes: v.purchaseNotes },
        specs: { ...(cur?.specs || {}), fuelCapacity: v.fuelCapacity, engine: v.engine, transmission: v.transmission, oilCapacity: v.oilCapacity, tireSize: v.tireSize, curbWeight: v.curbWeight, gvwr: v.gvwr, towing: v.towing },
        notes: v.notes,
        attachments: cur?.attachments || [],
        archived: cur?.archived || false,
      };
      if (!existing) {
        data.operatorId = null;
        data.meter = null;
        data.meterDate = null;
      }
      const saved = store.put('vehicles', data);
      if (!existing && v.startMeter !== null && v.startMeter !== undefined) recordMeter(store, { vehicleId: saved.id, value: v.startMeter, date: app.today(), note: 'Starting reading' });
      page.form.markClean();
      toast(existing ? 'Vehicle saved' : 'Vehicle added');
      navigate(`/vehicles/${saved.id}`, { replace: !existing });
    },
  });
  // Decode fills the fields that are still empty from the public VIN database.
  const decodeBtn = h('button.btn.sm', { type: 'button', onClick: decode }, icon('scan', 15), 'Decode VIN');
  async function decode() {
    const vals = page.form.values();
    decodeBtn.disabled = true;
    vinHint.textContent = 'Looking up the VIN...';
    try {
      const d = await decodeVin(vals.vin);
      const filled = [];
      const fill = (id, value, label) => {
        if (value === undefined || value === null || value === '') return;
        const cur = page.form.values()[id];
        if (cur !== null && cur !== undefined && cur !== '' && !(id === 'type' && !existing && cur === s.vehicleTypes[0])) return;
        if (id === 'type' && !s.vehicleTypes.includes(value)) return;
        if (id === 'fuelType' && !s.fuelTypes.includes(value)) return;
        page.form.set(id, value);
        filled.push(label);
      };
      fill('year', d.year, 'year');
      fill('make', d.make, 'make');
      fill('model', d.model, 'model');
      fill('trim', d.trim, 'trim');
      fill('type', d.type, 'type');
      fill('fuelType', d.fuelType, 'fuel type');
      fill('engine', d.engine, 'engine');
      fill('transmission', d.transmission, 'transmission');
      fill('gvwr', d.gvwr, 'weight rating');
      if (!page.form.values().name && d.make) page.form.set('name', [d.year, d.make, d.model].filter(Boolean).join(' '));
      vinHint.textContent = filled.length ? `Decoded: ${[d.year, d.make, d.model, d.trim].filter(Boolean).join(' ')}. Filled ${filled.join(', ')}.` : `Decoded: ${[d.year, d.make, d.model].filter(Boolean).join(' ')}. Fields that already had values were kept.`;
    } catch (err) {
      vinHint.textContent = err.message;
    } finally {
      decodeBtn.disabled = false;
    }
  }
  page.form.wrapper('vin')?.append(h('div.row.vin-tools', decodeBtn, h('span.hint.grow', { 'aria-live': 'polite' }, vinHint)));
  return { node: page.node, title: existing ? 'Edit vehicle' : 'New vehicle', dirty: () => page.form.dirty() };
}
