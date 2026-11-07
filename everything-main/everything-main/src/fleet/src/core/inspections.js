/**
 * Inspection forms and submissions.
 *
 * Form: { name, description, color, items: [Item], vehicleIds: [] (empty =
 *   every vehicle), schedule: { every, unit } | null, archived }
 * Item: { id, type, label, help, required, options?, passOption?, min?, max? }
 *
 * Item types:
 *   section    a heading that groups the items after it
 *   passfail   Pass / Fail (Fail can carry a note and photo)
 *   choice     pick one option; any option not marked as passing fails
 *   text       free text
 *   number     a number, optionally with a passing range
 *   meter      odometer or hour reading, recorded on the vehicle
 *   date       a date
 *   photo      one or more photos
 *   signature  drawn signature
 *
 * Submission: { formId, formName, vehicleId, date, startedAt, submittedAt,
 *   meter, by, results: [{ itemId, value, note, photos }], failed: n }
 */
import { toISODate } from './dates.js';

export const ITEM_TYPES = [
  { id: 'passfail', label: 'Pass / Fail', icon: 'circle-check' },
  { id: 'choice', label: 'Multiple choice', icon: 'list' },
  { id: 'number', label: 'Number', icon: 'hash' },
  { id: 'meter', label: 'Meter reading', icon: 'gauge' },
  { id: 'text', label: 'Free text', icon: 'text' },
  { id: 'date', label: 'Date', icon: 'calendar' },
  { id: 'photo', label: 'Photo', icon: 'camera' },
  { id: 'signature', label: 'Signature', icon: 'signature' },
  { id: 'section', label: 'Section heading', icon: 'heading' },
];

export function itemTypeMeta(type) {
  return ITEM_TYPES.find((t) => t.id === type) || ITEM_TYPES[0];
}

/** Items that take an answer (sections do not). */
export function answerable(form) {
  return (form?.items || []).filter((it) => it.type !== 'section');
}

const empty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);

/**
 * Pass/fail outcome for one answer: true (pass), false (fail), or null
 * (the item has no pass condition, or was left blank).
 */
export function evaluate(item, value) {
  if (empty(value)) return null;
  switch (item.type) {
    case 'passfail':
      return value === 'pass' ? true : value === 'fail' ? false : null;
    case 'choice': {
      const passing = item.passOptions;
      if (!Array.isArray(passing) || !passing.length) return null;
      return passing.includes(value);
    }
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      const hasMin = item.min !== undefined && item.min !== null && item.min !== '';
      const hasMax = item.max !== undefined && item.max !== null && item.max !== '';
      if (!hasMin && !hasMax) return null;
      return (!hasMin || n >= Number(item.min)) && (!hasMax || n <= Number(item.max));
    }
    default:
      return null;
  }
}

/** Required items without an answer, in form order. */
export function missingRequired(form, answers) {
  return answerable(form).filter((it) => it.required && empty(answers[it.id]?.value) && !(it.type === 'photo' && answers[it.id]?.photos?.length));
}

/** Build the stored results from the answers map. */
export function buildResults(form, answers) {
  return answerable(form).map((it) => {
    const a = answers[it.id] || {};
    const pass = evaluate(it, a.value);
    return {
      itemId: it.id,
      label: it.label,
      type: it.type,
      value: a.value ?? null,
      pass,
      note: a.note || '',
      photos: a.photos || [],
    };
  });
}

export function failedResults(sub) {
  return (sub?.results || []).filter((r) => r.pass === false);
}

/** Vehicles a form applies to. */
export function formAppliesTo(form, vehicleId) {
  return !form.vehicleIds?.length || form.vehicleIds.includes(vehicleId);
}

/** Local calendar day of a record's createdAt timestamp, or null. */
function createdDay(rec) {
  const d = rec?.createdAt ? new Date(rec.createdAt) : null;
  return d && !Number.isNaN(d.getTime()) ? toISODate(d) : null;
}

/**
 * Scheduled inspections that are due: for each form with a schedule and
 * each vehicle it applies to, the most recent submission sets the next due.
 * A vehicle never inspected on the form was due when the schedule first
 * applied to it (the later of the form's and the vehicle's creation).
 * Returns [{ form, vehicle, lastDate, dueDate, overdue }].
 */
export function inspectionsDue(forms, vehicles, submissions, today, addInterval) {
  const latest = new Map();
  for (const s of submissions) {
    const k = `${s.formId}|${s.vehicleId}`;
    if (!latest.has(k) || latest.get(k) < s.date) latest.set(k, s.date);
  }
  const out = [];
  for (const f of forms) {
    if (f.archived || !f.schedule?.every) continue;
    for (const v of vehicles) {
      if (v.archived || !formAppliesTo(f, v.id)) continue;
      const last = latest.get(`${f.id}|${v.id}`) || null;
      const since = [createdDay(f), createdDay(v)].filter(Boolean).sort().pop();
      const dueDate = last ? addInterval(last, f.schedule) : since && since < today ? since : today;
      out.push({ form: f, vehicle: v, lastDate: last, dueDate, overdue: dueDate < today });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** A ready-to-use pre-trip inspection form (driver vehicle inspection). */
export function starterForm(newId) {
  const it = (type, label, extra = {}) => ({ id: newId(), type, label, help: '', required: type !== 'section' && type !== 'photo', ...extra });
  return {
    name: 'Pre-trip vehicle inspection',
    description: 'Daily walk-around before the vehicle goes out.',
    color: 'blue',
    vehicleIds: [],
    schedule: { every: 1, unit: 'days' },
    items: [
      it('meter', 'Odometer reading'),
      it('section', 'Exterior'),
      it('passfail', 'Lights and reflectors'),
      it('passfail', 'Tires, wheels, and lug nuts'),
      it('passfail', 'Mirrors and windshield'),
      it('passfail', 'Wipers and washer fluid'),
      it('passfail', 'Body damage or leaks'),
      it('section', 'In the cab'),
      it('passfail', 'Horn'),
      it('passfail', 'Brakes and parking brake'),
      it('passfail', 'Seat belts'),
      it('passfail', 'Gauges and warning lights'),
      it('passfail', 'Fire extinguisher and safety kit'),
      it('choice', 'Fuel level', { options: ['Full', '3/4', '1/2', '1/4', 'Empty'], passOptions: ['Full', '3/4', '1/2', '1/4'] }),
      it('photo', 'Photos of any damage', { required: false }),
      it('text', 'Other remarks', { required: false }),
      it('signature', 'Driver signature'),
    ],
  };
}
