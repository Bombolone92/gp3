/**
 * Service reminders and renewal reminders.
 *
 * A service reminder repeats a service task on a vehicle by time, by meter,
 * or by whichever comes first:
 *   { vehicleId, taskId, programId?,
 *     interval: { every, unit } | null, meterInterval: number | null,
 *     dueSoonDays, dueSoonMeter,           // thresholds, fall back to settings
 *     lastDate, lastMeter,                 // last completion (or the start)
 *     nextDate?, nextMeter?,               // manual override of the next due
 *     snoozedUntil?, history: [{ date, meter, entryId, onTime }] }
 *
 * A renewal reminder is a dated obligation on a vehicle (registration,
 * insurance) or a contact (driver license):
 *   { kind: 'vehicle' | 'contact', vehicleId | contactId, type, dueDate,
 *     dueSoonDays, repeat: { every, unit } | null, history: [...] }
 */
import { addInterval, diffDays, toISODate } from './dates.js';

/** Local day a record was created, or null. */
function createdDay(rec) {
  const d = rec.createdAt ? new Date(rec.createdAt) : null;
  return d && !Number.isNaN(d.getTime()) ? toISODate(d) : null;
}

/**
 * Next due date and meter for a service reminder. Without a last
 * completion date, the time interval counts from when it was added.
 */
export function reminderNextDue(rem) {
  const from = rem.lastDate || createdDay(rem);
  const nextDate = rem.nextDate || (rem.interval?.every && from ? addInterval(from, rem.interval) : null);
  const meterEvery = Number(rem.meterInterval) || 0;
  const nextMeter = rem.nextMeter != null && rem.nextMeter !== '' ? Number(rem.nextMeter) : meterEvery && rem.lastMeter != null && rem.lastMeter !== '' ? Number(rem.lastMeter) + meterEvery : null;
  return { nextDate, nextMeter };
}

/**
 * Where a reminder stands today:
 *   { status: 'overdue'|'due_soon'|'upcoming'|'snoozed', nextDate, nextMeter,
 *     daysLeft, meterLeft }
 * Overdue as soon as either the date or the meter is reached.
 */
export function reminderState(rem, vehicle, today, settings = {}) {
  const { nextDate, nextMeter } = reminderNextDue(rem);
  const meter = vehicle?.meter != null && vehicle.meter !== '' ? Number(vehicle.meter) : null;
  const daysLeft = nextDate ? diffDays(today, nextDate) : null;
  const meterLeft = nextMeter != null && meter != null ? nextMeter - meter : null;
  const soonDays = Number(rem.dueSoonDays ?? settings.dueSoon?.days ?? 14);
  const soonMeter = Number(rem.dueSoonMeter ?? settings.dueSoon?.meter ?? 500);
  let status = 'upcoming';
  if ((daysLeft != null && daysLeft < 0) || (meterLeft != null && meterLeft <= 0)) status = 'overdue';
  else if ((daysLeft != null && daysLeft <= soonDays) || (meterLeft != null && meterLeft <= soonMeter)) status = 'due_soon';
  if (rem.snoozedUntil && rem.snoozedUntil >= today && status !== 'upcoming') status = 'snoozed';
  return { status, nextDate, nextMeter, daysLeft, meterLeft };
}

/**
 * Record a completion: the schedule restarts from this date and meter.
 * Any manual next-due override and snooze are cleared.
 */
export function completeReminder(rem, { date, meter, entryId = null }, vehicle, settings) {
  const h = rem.history || [];
  const at = h.findIndex((x) => x.date > date);
  if (at >= 0) {
    // An older service entered after a newer completion: file it in date
    // order, graded against the completion before it, and leave the
    // schedule counting from the newer one.
    const prev = h[at - 1];
    const base = { ...rem, lastDate: prev?.date ?? rem.startDate ?? null, lastMeter: prev?.meter ?? rem.startMeter ?? null, nextDate: null, nextMeter: null, snoozedUntil: null };
    const st = reminderState(base, { meter: meter ?? null }, date, settings);
    const history = [...h.slice(0, at), { date, meter: meter ?? null, entryId, onTime: st.status !== 'overdue' }, ...h.slice(at)].slice(-50);
    return { ...rem, history };
  }
  // Judge on-time against the meter when the work was done, not today's.
  // Snoozing hides an overdue reminder; it does not make it on time.
  const before = reminderState({ ...rem, snoozedUntil: null }, { ...(vehicle || {}), meter: meter ?? vehicle?.meter ?? null }, date, settings);
  const history = [...(rem.history || []), { date, meter: meter ?? null, entryId, onTime: before.status !== 'overdue' }].slice(-50);
  return {
    ...rem,
    lastDate: date,
    lastMeter: meter ?? rem.lastMeter ?? null,
    nextDate: null,
    nextMeter: null,
    snoozedUntil: null,
    history,
  };
}

/** Share of completions done on time, 0..1, or null without history. */
export function compliance(rem) {
  const h = rem.history || [];
  if (!h.length) return null;
  return h.filter((x) => x.onTime).length / h.length;
}

export function describeSchedule(rem, meterUnit = 'mi') {
  const parts = [];
  if (rem.interval?.every) {
    const n = Number(rem.interval.every);
    const unit = rem.interval.unit || 'months';
    parts.push(`${n} ${n === 1 ? unit.replace(/s$/, '') : unit}`);
  }
  if (Number(rem.meterInterval)) parts.push(`${Number(rem.meterInterval).toLocaleString()} ${meterUnit}`);
  return parts.length ? `Every ${parts.join(' or ')}` : 'One time';
}

// ---- Renewals -------------------------------------------------------------

export function renewalState(ren, today, settings = {}) {
  if (!ren.dueDate) return { status: 'upcoming', daysLeft: null };
  const daysLeft = diffDays(today, ren.dueDate);
  const soon = Number(ren.dueSoonDays ?? settings.dueSoon?.days ?? 14);
  let status = daysLeft < 0 ? 'overdue' : daysLeft <= soon ? 'due_soon' : 'upcoming';
  if (ren.snoozedUntil && ren.snoozedUntil >= today && status !== 'upcoming') status = 'snoozed';
  return { status, daysLeft };
}

/**
 * Mark a renewal done; it rolls forward by its repeat interval if it has one.
 * Rolls count from where the series started (repeatAnchor), so a renewal
 * due on Jan 31 comes back on Mar 31 after Feb 28, not on Mar 28.
 */
export function completeRenewal(ren, { date, nextDue = null, cost = null }) {
  const history = [...(ren.history || []), { date, dueDate: ren.dueDate, cost }].slice(-50);
  let roll = null;
  if (ren.repeat?.every) {
    const from = ren.dueDate || date;
    // Start a new series when the due date or interval was changed by hand.
    const a = ren.repeatAnchor;
    const start = a?.date && addInterval(a.date, ren.repeat, a.n) === from ? a : { date: from, n: 0 };
    roll = { date: start.date, n: start.n + 1 };
  }
  const next = roll && addInterval(roll.date, ren.repeat, roll.n);
  const rolled = nextDue || next;
  return { ...ren, history, dueDate: rolled, repeatAnchor: roll && rolled === next ? roll : null, snoozedUntil: null, done: !rolled };
}
