/**
 * Operations that touch more than one collection. Each takes the store as
 * its first argument so it can be unit tested against a memory backend.
 */
import { newId } from './ids.js';
import { completeReminder } from './reminders.js';
import { partsUsed } from './totals.js';
import { buildResults, failedResults } from './inspections.js';
import { formatMeter } from './format.js';
import { formatDate } from './dates.js';

const hasValue = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

// ---- Meters ---------------------------------------------------------------------

/** The newest reading wins: later date, or the higher value on the same date. */
function newer(a, b) {
  if (!b) return true;
  if (a.date !== b.date) return a.date > b.date;
  return Number(a.value) >= Number(b.value);
}

/** Recompute vehicle.meter and meterDate from its readings. */
export function recomputeVehicleMeter(store, vehicleId) {
  const v = store.get('vehicles', vehicleId);
  if (!v) return null;
  let best = null;
  for (const r of store.all('meters')) if (r.vehicleId === vehicleId && !r.void && hasValue(r.value) && newer(r, best)) best = r;
  const meter = best ? Number(best.value) : (v.inServiceMeter ?? null);
  const meterDate = best ? best.date : null;
  if (v.meter !== meter || v.meterDate !== meterDate) store.patch('vehicles', vehicleId, { meter, meterDate });
  return meter;
}

/**
 * Record a meter reading. When it comes from another record (a fuel entry,
 * a service entry, an inspection) that record's existing reading is updated
 * instead of adding a second one. `fresh` says the source record was just
 * created, so it has no reading yet and the search for one is skipped.
 */
export function recordMeter(store, { vehicleId, value, date, source = null, note = '', fresh = false }) {
  const existing = source && !fresh ? store.all('meters').find((m) => m.source?.type === source.type && m.source?.id === source.id) : null;
  if (!hasValue(value) || !vehicleId || !date) {
    if (existing) {
      store.remove('meters', existing.id);
      recomputeVehicleMeter(store, existing.vehicleId);
    }
    return null;
  }
  // A reading someone voided stays void until its value changes.
  const keepVoid = Boolean(existing?.void) && Number(existing.value) === Number(value);
  const reading = store.put('meters', { ...(existing || {}), vehicleId, value: Number(value), date, source, note: note || existing?.note || '', void: keepVoid });
  if (existing && existing.vehicleId !== vehicleId) recomputeVehicleMeter(store, existing.vehicleId);
  const v = store.get('vehicles', vehicleId);
  if (keepVoid) {
    recomputeVehicleMeter(store, vehicleId);
  } else if (v && newer(reading, v.meterDate ? { date: v.meterDate, value: v.meter } : null)) {
    store.patch('vehicles', vehicleId, { meter: Number(value), meterDate: date });
  } else if (existing) {
    recomputeVehicleMeter(store, vehicleId);
  }
  return reading;
}

/** Remove the reading a record made. Returns it (for an undo), or null. */
export function removeMeterFor(store, type, id) {
  const m = store.all('meters').find((r) => r.source?.type === type && r.source?.id === id);
  if (!m) return null;
  store.remove('meters', m.id);
  recomputeVehicleMeter(store, m.vehicleId);
  return m;
}

/** Warnings for a new reading: lower than an earlier one, or a big jump. */
export function meterWarnings(store, { vehicleId, value, date, ignoreId = null, ignoreSource = null }) {
  if (!hasValue(value) || !vehicleId) return [];
  const n = Number(value);
  const out = [];
  let prev = null;
  let next = null;
  for (const r of store.all('meters')) {
    if (r.vehicleId !== vehicleId || r.void || !hasValue(r.value) || r.id === ignoreId) continue;
    if (ignoreSource && r.source?.type === ignoreSource.type && r.source?.id === ignoreSource.id) continue;
    if (r.date <= date && (!prev || r.date > prev.date || (r.date === prev.date && Number(r.value) > Number(prev.value)))) prev = r;
    if (r.date > date && (!next || r.date < next.date || (r.date === next.date && Number(r.value) < Number(next.value)))) next = r;
  }
  // Readable like the rest of the app: "12,000 km on Oct 1, 2026".
  const unit = store.get('vehicles', vehicleId)?.meterUnit || store.state?.settings?.units?.distance || 'mi';
  const at = (r) => `${formatMeter(Number(r.value), unit)} on ${formatDate(r.date)}`;
  if (prev && n < Number(prev.value)) out.push(`This is lower than the reading of ${at(prev)}.`);
  if (next && n > Number(next.value)) out.push(`This is higher than the later reading of ${at(next)}.`);
  if (prev && n - Number(prev.value) > 5000) out.push(`This is ${formatMeter(n - Number(prev.value), unit)} more than the previous reading. Check for a typo.`);
  return out;
}

// ---- Fuel -------------------------------------------------------------------------

export function saveFuel(store, entry) {
  const fresh = !store.get('fuel', entry.id);
  const rec = store.put('fuel', entry);
  recordMeter(store, { vehicleId: rec.vehicleId, value: rec.meter, date: rec.date, source: { type: 'fuel', id: rec.id }, fresh });
  return rec;
}

export function deleteFuel(store, id) {
  const rec = store.remove('fuel', id);
  if (rec) removeMeterFor(store, 'fuel', id);
  return rec;
}

// ---- Issues ---------------------------------------------------------------------

export async function createIssue(store, data) {
  const number = await store.nextNumber('issues');
  return store.put('issues', { status: 'open', priority: 'none', labels: [], attachments: [], ...data, number });
}

export function resolveIssues(store, ids, resolution) {
  for (const id of ids || []) {
    const issue = store.get('issues', id);
    if (!issue || issue.status !== 'open') continue;
    store.put('issues', { ...issue, status: 'resolved', resolvedAt: resolution.date, resolution });
  }
}

// ---- Service ----------------------------------------------------------------------

/** Open reminders on a vehicle that a set of line items would complete. */
export function matchingReminders(store, vehicleId, lineItems) {
  const tasks = new Set((lineItems || []).map((li) => li.taskId).filter(Boolean));
  return store.all('reminders').filter((r) => r.vehicleId === vehicleId && !r.archived && tasks.has(r.taskId));
}

/**
 * Save a service entry and apply what it did: record the meter, resolve the
 * chosen issues, and restart the chosen service reminders from this date.
 */
export function saveServiceEntry(store, entry, settings) {
  const rec = store.put('serviceEntries', entry);
  recordMeter(store, { vehicleId: rec.vehicleId, value: rec.meter, date: rec.date, source: { type: 'service', id: rec.id } });
  // An edit: issues this entry resolved follow its date, and reopen when unlinked.
  for (const issue of store.all('issues')) {
    if (issue.status !== 'resolved' || issue.resolution?.type !== 'service' || issue.resolution.id !== rec.id) continue;
    if (!(rec.issueIds || []).includes(issue.id)) store.put('issues', { ...issue, status: 'open', resolvedAt: null, resolution: null });
    else if (issue.resolvedAt !== rec.date) store.put('issues', { ...issue, resolvedAt: rec.date, resolution: { ...issue.resolution, date: rec.date } });
  }
  resolveIssues(store, rec.issueIds, { type: 'service', id: rec.id, date: rec.date });
  const vehicle = store.get('vehicles', rec.vehicleId);
  const meter = hasValue(rec.meter) ? Number(rec.meter) : null;
  // An edit: when this entry made a reminder's latest completion, move that
  // completion to the corrected date and meter, or undo it if the reminder
  // is no longer linked.
  for (const rem of store.all('reminders')) {
    const last = (rem.history || []).at(-1);
    if (last?.entryId !== rec.id) continue;
    const linked = (rec.reminderIds || []).includes(rem.id) && rem.vehicleId === rec.vehicleId;
    if (!linked) store.put('reminders', undoLastCompletion(rem));
    else if (last.date !== rec.date || (last.meter ?? null) !== meter) store.put('reminders', completeReminder(undoLastCompletion(rem), { date: rec.date, meter, entryId: rec.id }, vehicle, settings));
  }
  for (const rid of rec.reminderIds || []) {
    const rem = store.get('reminders', rid);
    if (!rem) continue;
    // Completing the same entry twice (an edit) must not add history twice.
    if ((rem.history || []).some((h) => h.entryId === rec.id)) continue;
    store.put('reminders', completeReminder(rem, { date: rec.date, meter, entryId: rec.id }, vehicle, settings));
  }
  return rec;
}

/** A reminder as it was before its latest completion. */
function undoLastCompletion(rem) {
  const h = rem.history || [];
  const prev = h[h.length - 2];
  return { ...rem, history: h.slice(0, -1), lastDate: prev?.date ?? rem.startDate ?? null, lastMeter: prev?.meter ?? rem.startMeter ?? null };
}

export function deleteServiceEntry(store, id) {
  const rec = store.remove('serviceEntries', id);
  if (!rec) return null;
  removeMeterFor(store, 'service', id);
  // Undo the reminder completion this entry made, if it is the latest one.
  for (const rem of store.all('reminders')) {
    const h = rem.history || [];
    if (h.length && h[h.length - 1].entryId === id) store.put('reminders', undoLastCompletion(rem));
  }
  return rec;
}

// ---- Parts and inventory ------------------------------------------------------------

/**
 * Change stock at a location by delta (negative to use parts). Without a
 * location the part's first location is used; a location the part is not
 * stocked at yet is added.
 */
export function adjustStock(store, partId, location, delta) {
  const part = store.get('parts', partId);
  if (!part || !delta) return null;
  const locs = [...(part.locations || [])];
  let i = location ? locs.findIndex((l) => l.location === location) : locs.length ? 0 : -1;
  if (i < 0) {
    locs.push({ location: location || 'Main shop', qty: 0, aisle: '', reorderPoint: null });
    i = locs.length - 1;
  }
  locs[i] = { ...locs[i], qty: Math.round(((Number(locs[i].qty) || 0) + delta) * 1000) / 1000 };
  return store.put('parts', { ...part, locations: locs });
}

export function stockOnHand(part) {
  return (part?.locations || []).reduce((s, l) => s + (Number(l.qty) || 0), 0);
}

export function lowStock(part) {
  return (part?.locations || []).some((l) => l.reorderPoint !== null && l.reorderPoint !== '' && l.reorderPoint !== undefined && (Number(l.qty) || 0) <= Number(l.reorderPoint));
}

/** Receive purchase order items into stock. received: { [itemId]: qty } */
export function receivePurchaseOrder(store, po, received, date) {
  const items = (po.items || []).map((it) => {
    const qty = Number(received[it.id]) || 0;
    if (qty > 0 && it.partId) adjustStock(store, it.partId, po.location, qty);
    if (qty > 0 && it.partId) {
      const part = store.get('parts', it.partId);
      if (part && it.unitCost) store.put('parts', { ...part, unitCost: it.unitCost });
    }
    return { ...it, received: (Number(it.received) || 0) + qty };
  });
  const complete = items.every((it) => (Number(it.received) || 0) >= (Number(it.qty) || 0));
  // Nothing received yet (an empty receipt) leaves the order as it was.
  const any = items.some((it) => (Number(it.received) || 0) > 0);
  return store.put('purchaseOrders', { ...po, items, status: complete ? 'received' : any ? 'partial' : po.status, receivedDate: complete ? date : po.receivedDate || null });
}

// ---- Work orders ------------------------------------------------------------------

/**
 * Complete a work order: it becomes a service entry in the vehicle's
 * history, resolves its issues and reminders, and takes its parts out of
 * stock. Returns the service entry.
 */
export function completeWorkOrder(store, wo, { date, meter }, settings) {
  const existing = wo.serviceEntryId ? store.get('serviceEntries', wo.serviceEntryId) : null;
  const entry = saveServiceEntry(
    store,
    {
      ...(existing || {}),
      vehicleId: wo.vehicleId,
      date,
      startDate: wo.startDate || wo.issueDate || date,
      // A cleared meter records no reading: the work order's own meter was
      // read when it was opened and would roll the vehicle back.
      meter: hasValue(meter) ? Number(meter) : null,
      vendorId: wo.vendorId || null,
      repairClass: wo.repairClass || 'scheduled',
      reference: wo.number ? `Work order #${wo.number}` : '',
      workOrderId: wo.id,
      lineItems: structuredClone(wo.lineItems || []),
      discount: wo.discount || null,
      taxPercent: wo.taxPercent || 0,
      issueIds: wo.issueIds || [],
      reminderIds: wo.reminderIds || [],
      notes: wo.notes || '',
      attachments: existing?.attachments || [],
    },
    settings,
  );
  // Take parts out of stock. On a second completion (after a reopen and
  // edits), only the difference from what was already taken out moves.
  const used = Object.fromEntries(partsUsed(wo));
  const before = wo.stockUsed || (wo.stockDeducted ? used : {});
  for (const partId of new Set([...Object.keys(used), ...Object.keys(before)])) {
    const delta = (used[partId] || 0) - (before[partId] || 0);
    if (delta) adjustStock(store, partId, null, -delta);
  }
  store.put('workOrders', { ...wo, status: 'completed', completedDate: date, meter: entry.meter, serviceEntryId: entry.id, stockDeducted: true, stockUsed: used });
  return entry;
}

/** Re-open a completed work order (its service entry stays until deleted). */
export function reopenWorkOrder(store, wo) {
  return store.put('workOrders', { ...wo, status: 'in_progress', completedDate: null });
}

// ---- Inspections --------------------------------------------------------------------

/**
 * Save a submitted inspection: record the meter reading and open an issue
 * for each failed item (when the fleet has that turned on).
 */
export async function submitInspection(store, { form, vehicleId, answers, date, startedAt, by, location = null }, settings) {
  const results = buildResults(form, answers);
  const meterItem = results.find((r) => r.type === 'meter' && hasValue(r.value));
  const sub = store.put('inspections', {
    formId: form.id,
    formName: form.name,
    vehicleId,
    date,
    startedAt,
    submittedAt: new Date().toISOString(),
    by: by || '',
    meter: meterItem ? Number(meterItem.value) : null,
    results,
    failed: results.filter((r) => r.pass === false).length,
    location,
  });
  if (meterItem) recordMeter(store, { vehicleId, value: meterItem.value, date, source: { type: 'inspection', id: sub.id } });
  const issueIds = [];
  if (settings?.issues?.fromInspections !== false) {
    for (const r of failedResults(sub)) {
      const issue = await createIssue(store, {
        vehicleId,
        summary: `${r.label}${r.type === 'passfail' ? ' failed inspection' : `: ${r.value}`}`,
        description: r.note || '',
        priority: 'medium',
        reportedDate: date,
        reportedBy: by || '',
        source: { type: 'inspection', id: sub.id, itemId: r.itemId },
        attachments: r.photos || [],
      });
      issueIds.push(issue.id);
    }
  }
  if (issueIds.length) store.patch('inspections', sub.id, { issueIds });
  return store.get('inspections', sub.id);
}

// ---- Assignments ----------------------------------------------------------------------

export function activeAssignment(store, vehicleId, today) {
  return store
    .all('assignments')
    .filter((a) => a.vehicleId === vehicleId && a.start <= today && (!a.end || a.end >= today))
    .sort((a, b) => b.start.localeCompare(a.start))[0] || null;
}

/** Keep vehicle.operatorId in step with its current assignment. */
export function syncOperator(store, vehicleId, today) {
  const v = store.get('vehicles', vehicleId);
  if (!v) return;
  const a = activeAssignment(store, vehicleId, today);
  const operatorId = a?.contactId || null;
  if ((v.operatorId || null) !== operatorId) store.patch('vehicles', vehicleId, { operatorId });
}

/**
 * Assign a vehicle to an operator. Any open-ended assignment of the vehicle
 * that started earlier ends the day before.
 */
export function assignVehicle(store, data, today) {
  if (!data.id) {
    for (const a of store.all('assignments')) {
      if (a.vehicleId === data.vehicleId && !a.end && a.start < data.start) {
        const d = new Date(`${data.start}T00:00:00`);
        d.setDate(d.getDate() - 1);
        const end = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        store.put('assignments', { ...a, end: end < a.start ? a.start : end });
      }
    }
  }
  const rec = store.put('assignments', { id: data.id || newId(), ...data });
  syncOperator(store, rec.vehicleId, today);
  return rec;
}

export function endAssignment(store, id, date, today) {
  const a = store.get('assignments', id);
  if (!a) return;
  store.put('assignments', { ...a, end: date });
  syncOperator(store, a.vehicleId, today);
}

// ---- Service programs -----------------------------------------------------------------

/**
 * Make a vehicle's reminders match its service programs: add a reminder for
 * each program schedule it lacks, update the interval of program reminders
 * that changed, and remove program reminders whose schedule or vehicle is
 * gone. Manually created reminders are never touched.
 */
export function syncProgramReminders(store, program, today) {
  const vehicles = new Set(program.vehicleIds || []);
  const schedules = new Map((program.schedules || []).map((s) => [s.id, s]));
  const existing = store.all('reminders').filter((r) => r.programId === program.id);
  const have = new Set();
  for (const r of existing) {
    const s = schedules.get(r.scheduleId);
    if (!s || !vehicles.has(r.vehicleId) || program.archived) {
      store.remove('reminders', r.id);
      continue;
    }
    have.add(`${r.vehicleId}|${s.id}`);
    const changed = r.taskId !== s.taskId || JSON.stringify(r.interval || null) !== JSON.stringify(s.interval || null) || Number(r.meterInterval || 0) !== Number(s.meterInterval || 0);
    if (changed) store.put('reminders', { ...r, taskId: s.taskId, interval: s.interval || null, meterInterval: s.meterInterval || null });
  }
  if (program.archived) return;
  for (const vid of vehicles) {
    const v = store.get('vehicles', vid);
    if (!v) continue;
    for (const s of schedules.values()) {
      if (have.has(`${vid}|${s.id}`)) continue;
      store.put('reminders', {
        vehicleId: vid,
        taskId: s.taskId,
        programId: program.id,
        scheduleId: s.id,
        interval: s.interval || null,
        meterInterval: s.meterInterval || null,
        lastDate: today,
        lastMeter: v.meter ?? null,
        startDate: today,
        startMeter: v.meter ?? null,
        history: [],
      });
    }
  }
}

export function removeProgram(store, program, today) {
  syncProgramReminders(store, { ...program, archived: true }, today);
  store.remove('servicePrograms', program.id);
}
