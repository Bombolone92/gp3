/**
 * Daily activity logs. One record per child per entry, in the day's
 * partition "activities:YYYY-MM-DD", so a family's view filters by child
 * and a classroom's view reads a single small partition. Logging the same
 * thing for several children at once creates one record each, sharing a
 * groupId (and the same photo files).
 *
 *   { id, type, studentId, roomId, day, at: 'HH:MM', details: {...},
 *     note, media: [attachment], staffOnly, by, byId, groupId }
 */
import { partition } from './keys.js';
import { newId } from './ids.js';
import { formatTime, timeToMinutes } from './dates.js';

export const activityName = (day) => partition('activities', day);

export const ACTIVITY_TYPES = [
  { id: 'photo', label: 'Photo', icon: 'camera', tone: 'violet', verb: 'Photo' },
  { id: 'meal', label: 'Meal', icon: 'utensils', tone: 'green', verb: 'Meal' },
  { id: 'nap', label: 'Nap', icon: 'moon', tone: 'indigo', verb: 'Nap' },
  { id: 'toilet', label: 'Diaper or potty', short: 'Diaper', icon: 'baby', tone: 'sky', verb: 'Diaper' },
  { id: 'note', label: 'Note', icon: 'notebook-pen', tone: 'teal', verb: 'Note' },
  { id: 'mood', label: 'Mood', icon: 'smile', tone: 'amber', verb: 'Mood' },
  { id: 'kudos', label: 'Kudos', icon: 'award', tone: 'pink', verb: 'Kudos' },
  { id: 'observation', label: 'Learning', icon: 'sprout', tone: 'lime', verb: 'Learning' },
  { id: 'meds', label: 'Medication', icon: 'pill', tone: 'orange', verb: 'Medication' },
  { id: 'health', label: 'Health check', icon: 'stethoscope', tone: 'rose', verb: 'Health check' },
  { id: 'incident', label: 'Incident', icon: 'bandage', tone: 'red', verb: 'Incident' },
];

export const TYPE = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.id, t]));

export const MEAL_AMOUNTS = [
  { id: 'all', label: 'All' },
  { id: 'most', label: 'Most' },
  { id: 'some', label: 'Some' },
  { id: 'none', label: 'None' },
];

export const BOTTLE_CONTENTS = ['Formula', 'Breast milk', 'Milk', 'Water', 'Other'];
export const MOODS = [
  { id: 'happy', label: 'Happy' },
  { id: 'calm', label: 'Calm' },
  { id: 'energetic', label: 'Energetic' },
  { id: 'tired', label: 'Tired' },
  { id: 'fussy', label: 'Fussy' },
  { id: 'sad', label: 'Sad' },
];
export const KUDOS = ['Kindness', 'Sharing', 'Helping', 'Listening', 'Creativity', 'Persistence', 'Teamwork', 'Trying something new'];
export const DOMAINS = ['Social and emotional', 'Language and literacy', 'Cognitive', 'Math', 'Science', 'Physical', 'Creative arts', 'Self-care'];
export const MILESTONE_LEVELS = [
  { id: 'emerging', label: 'Emerging' },
  { id: 'developing', label: 'Developing' },
  { id: 'proficient', label: 'Proficient' },
];

/**
 * Create one record per child. Returns the records. `details` carries the
 * type's fields; empty strings are dropped.
 */
export function logActivity(store, { type, day, at, studentIds, roomOf = () => null, details = {}, note = '', media = [], staffOnly = false, by = '', byId = '' }) {
  if (!TYPE[type]) throw new Error(`Unknown activity type: ${type}`);
  const name = activityName(day);
  const groupId = studentIds.length > 1 ? newId() : undefined;
  const cleanDetails = compact(details);
  return studentIds.map((studentId) =>
    store.put(name, compact({ type, studentId, roomId: roomOf(studentId) || undefined, day, at, details: cleanDetails, note: note.trim(), media: media.length ? media : undefined, staffOnly: staffOnly || undefined, by, byId, groupId })),
  );
}

export function updateActivity(store, rec, changes) {
  return store.put(activityName(rec.day), compact({ ...rec, ...changes, details: compact({ ...(rec.details || {}), ...(changes.details || {}) }) }));
}

export function deleteActivity(store, rec) {
  return store.remove(activityName(rec.day), rec.id);
}

function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === '' || v === null || v === undefined || (Array.isArray(v) && !v.length && k !== 'media')) continue;
    out[k] = v;
  }
  return out;
}

export function sortActivities(list, dir = -1) {
  return [...list].sort((a, b) => dir * (timeToMinutes(a.at) - timeToMinutes(b.at)) || dir * String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

const amountLabel = (id) => MEAL_AMOUNTS.find((m) => m.id === id)?.label.toLowerCase() || '';

/** A one-line, human description of an entry, used in feeds and reports. */
export function describe(a) {
  const d = a.details || {};
  switch (a.type) {
    case 'meal': {
      if (d.kind === 'bottle') {
        const amount = d.amount ? `${d.amount} ${d.unit || 'oz'}` : '';
        return join([d.meal, ['Bottle', amount, d.contents ? `of ${d.contents.toLowerCase()}` : ''].filter(Boolean).join(' ')]);
      }
      return join([d.meal, d.amount ? `Ate ${amountLabel(d.amount)}` : '', d.items]);
    }
    case 'nap': {
      if (d.start && d.end) return `Slept ${formatTime(d.start)} to ${formatTime(d.end)} (${durationLabel(timeToMinutes(d.end) - timeToMinutes(d.start))})`;
      if (d.start) return `Fell asleep at ${formatTime(d.start)}`;
      return 'Nap';
    }
    case 'toilet': {
      const kind = d.kind === 'potty' ? 'Potty' : d.kind === 'accident' ? 'Accident' : 'Diaper';
      const what = [d.wet && 'wet', d.bm && 'BM', d.dry && 'dry'].filter(Boolean).join(', ');
      return join([what ? `${kind}: ${what}` : kind, d.cream ? 'Cream applied' : '']);
    }
    case 'mood':
      return MOODS.find((m) => m.id === d.mood)?.label || 'Mood';
    case 'kudos':
      return d.category ? `Kudos for ${d.category.toLowerCase()}` : 'Kudos';
    case 'observation':
      return join([d.domain, d.level ? MILESTONE_LEVELS.find((l) => l.id === d.level)?.label : '', d.skill]);
    case 'meds':
      return join([d.medication, d.dose]) || 'Medication given';
    case 'health': {
      const temp = d.temperature ? `Temperature ${d.temperature}${d.tempUnit === 'C' ? ' C' : ' F'}` : '';
      return join([d.result === 'concern' ? 'Needs attention' : 'Healthy', temp, d.symptoms]);
    }
    case 'incident':
      return join([d.kind, d.location ? `at ${d.location}` : '']) || 'Incident';
    case 'photo':
      return a.media?.length > 1 ? `${a.media.length} photos` : 'Photo';
    default:
      return TYPE[a.type]?.label || 'Note';
  }
}

function join(parts) {
  return parts.filter((p) => p && String(p).trim()).join(' · ');
}

export function durationLabel(min) {
  const m = Math.max(0, Math.round(min || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}

/** Counts by type for a list of entries: [{ type, count }], in type order. */
export function countByType(list) {
  const counts = new Map();
  for (const a of list) counts.set(a.type, (counts.get(a.type) || 0) + 1);
  return ACTIVITY_TYPES.filter((t) => counts.has(t.id)).map((t) => ({ type: t, count: counts.get(t.id) }));
}

/**
 * The day at a glance for one child, grouped the way a family reads it:
 * meals, naps (with total sleep), diapers, and the rest in time order.
 */
export function dailyReport(list) {
  const sorted = sortActivities(list, 1);
  const naps = sorted.filter((a) => a.type === 'nap');
  const sleep = naps.reduce((sum, a) => (a.details?.start && a.details?.end ? sum + Math.max(0, timeToMinutes(a.details.end) - timeToMinutes(a.details.start)) : sum), 0);
  return {
    meals: sorted.filter((a) => a.type === 'meal'),
    naps,
    sleepMinutes: sleep,
    toilet: sorted.filter((a) => a.type === 'toilet'),
    photos: sorted.filter((a) => a.media?.length),
    other: sorted.filter((a) => !['meal', 'nap', 'toilet'].includes(a.type)),
    total: sorted.length,
  };
}

/** Naps that have started but not ended. */
export function openNaps(list) {
  return list.filter((a) => a.type === 'nap' && a.details?.start && !a.details?.end);
}
