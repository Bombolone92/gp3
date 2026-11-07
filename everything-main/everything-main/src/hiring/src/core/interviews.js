/** Interview validation, ordering, and interviewer conflict detection. */

import { addDays, daysSince, formatDateLong, formatTime, parseISODate, toMinutes, todayISO } from '../lib/dates.js';
import { browserTimeZone, formatTimeInZone, isValidTimeZone, normalizeTimeZone, zoneAbbreviation, zonedInstant } from '../lib/zones.js';
import { onActiveCandidates } from './pipeline.js';

export const INTERVIEW_TYPES = [
  { value: 'phone', label: 'Phone screen', icon: 'phone-call' },
  { value: 'video', label: 'Video call', icon: 'video' },
  { value: 'onsite', label: 'Onsite', icon: 'building' },
];

export function interviewTypeInfo(value) {
  return INTERVIEW_TYPES.find((t) => t.value === value) ?? INTERVIEW_TYPES[0];
}

/* ---- Proposals ---------------------------------------------------------- */

export const MIN_PROPOSAL_SLOTS = 2;
export const MAX_PROPOSAL_SLOTS = 4;

/** How long a proposal waits before it counts as needing a nudge. */
export const PROPOSAL_NUDGE_DAYS = 3;

/** An interview waiting for the candidate to pick one of its slots. */
export function isProposed(interview) {
  return interview?.status === 'proposed';
}

/**
 * The interviews that are real commitments, and therefore the only ones a
 * new booking can clash with or has to be scheduled around: a confirmed
 * time, for someone still in play.
 *
 * A proposal is a question, not a booking — `interviewConflicts` and
 * `suggestSlots` already skip those. An archived candidate's interview is
 * the same kind of non-commitment: the app treats it as kept for
 * rescheduling or cleanup only, so the row hides the invitation, the
 * shared calendar leaves it out, the overview does not count it, and no
 * reminder mentions it. Counting it as a booking flagged a live interview
 * as a double-booking against a rejected candidate's stale record, and
 * let it block an open window in "Suggest open times".
 *
 * An interview whose candidate is gone entirely is kept: it is orphaned,
 * not archived, and the views still list it.
 */
export function committedInterviews(interviews, candidates) {
  return onActiveCandidates(interviews, candidates).filter((itv) => !isProposed(itv));
}

/**
 * The working window open slots are suggested inside. Weekday numbers are
 * JS's (0 = Sunday); the defaults are the ordinary office week.
 */
export const DEFAULT_WORKING_HOURS = { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] };

export function workingHours(settings) {
  const stored = settings?.workingHours;
  const start = toMinutes(stored?.start) === null ? DEFAULT_WORKING_HOURS.start : stored.start;
  const end = toMinutes(stored?.end) === null ? DEFAULT_WORKING_HOURS.end : stored.end;
  const days = Array.isArray(stored?.days)
    ? [...new Set(stored.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : DEFAULT_WORKING_HOURS.days;
  // An empty (or inverted) window would make every suggestion impossible;
  // fall back rather than silently offering nothing.
  if (days.length === 0 || toMinutes(end) <= toMinutes(start)) return { ...DEFAULT_WORKING_HOURS };
  return { start, end, days };
}

/** Clean a proposed-slot list: usable ranges only, in time order, deduped. */
export function normalizeSlots(slots) {
  const seen = new Set();
  const out = [];
  for (const slot of Array.isArray(slots) ? slots : []) {
    const date = String(slot?.date ?? '');
    const start = toMinutes(slot?.start);
    const end = toMinutes(slot?.end);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || start === null || end === null || end <= start) continue;
    const key = `${date} ${slot.start} ${slot.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date, start: String(slot.start), end: String(slot.end) });
    if (out.length >= MAX_PROPOSAL_SLOTS) break;
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (toMinutes(a.start) ?? 0) - (toMinutes(b.start) ?? 0));
}

/**
 * Has this proposed option already gone by? Compared as a real instant in
 * the zone the option is read in, not as a calendar date: options are
 * usually offered for the next day or two — today included — and an
 * 11:00 slot looked at over lunch is as gone as one from last week.
 * Confirming it stays allowed (a candidate may say yes late), but the
 * button must not present a time that has passed as if it were still on
 * the table: confirmed, it becomes a past interview, and a day later the
 * app starts asking for feedback on a meeting nobody held.
 */
export function slotHasPassed(slot, timeZone = '', now = new Date()) {
  const start = zonedInstant(slot?.date, slot?.start, timeZone);
  return start ? start.getTime() < now.getTime() : false;
}

/**
 * Is this interview over? Compared as a real instant on the clock it is
 * read in, because the calendar date alone keeps an interview that
 * finished this morning "upcoming" until midnight — which is exactly the
 * hour someone wants to write the scorecard, and long past the point
 * where offering to email the invitation makes sense. A proposal is
 * never over: its date mirrors the earliest option, and nobody has
 * agreed to it.
 */
export function interviewHasEnded(interview, timeZone = '', now = new Date()) {
  if (isProposed(interview)) return false;
  const end = zonedInstant(interview?.date, interview?.end, timeZone);
  return end ? end.getTime() <= now.getTime() : false;
}

/** Human-readable problems with a proposal's slots; empty when valid. */
export function validateSlots(slots) {
  const clean = normalizeSlots(slots);
  const given = Array.isArray(slots) ? slots.length : 0;
  const errors = [];
  if (clean.length < given) errors.push('Every option needs a date and an end time after its start.');
  if (clean.length < MIN_PROPOSAL_SLOTS) {
    errors.push(`Offer at least ${MIN_PROPOSAL_SLOTS} different times — a single one is an invitation, not a choice.`);
  }
  return errors;
}

/**
 * Open windows inside the working week, avoiding what is already booked.
 * Suggestions are spread over days rather than stacked in one afternoon:
 * the point is to offer a candidate a real choice.
 */
export function suggestSlots(
  interviews,
  { now = new Date(), settings = null, timeZone = '', duration = 60, count = 3, horizonDays = 14, leadMinutes = 120, perDay = 2 } = {}
) {
  const hours = workingHours(settings);
  const windowStart = toMinutes(hours.start);
  const windowEnd = toMinutes(hours.end);
  // Proposals are not commitments, so only confirmed interviews block a
  // suggestion — otherwise the second candidate this week gets pushed to
  // next week by times nobody has accepted.
  const booked = interviews.filter((itv) => !isProposed(itv));
  // Every candidate window is checked against what is booked, and each
  // check costs zone arithmetic (two Intl lookups per instant). Narrowing
  // to the days that could possibly overlap turns a whole schedule into a
  // handful of records per window — the same NEARBY_DAYS reasoning the
  // conflict check below uses.
  const byDate = new Map();
  for (const itv of booked) {
    const list = byDate.get(itv.date);
    if (list) list.push(itv);
    else byDate.set(itv.date, [itv]);
  }
  const earliest = new Date(now.getTime() + leadMinutes * 60_000);
  const out = [];
  for (let offset = 0; offset <= horizonDays && out.length < count; offset++) {
    const date = addDays(todayISO(now), offset);
    if (!hours.days.includes(parseISODate(date).getDay())) continue;
    // Worked out once per day, not once per candidate window: each
    // booking's instants cost two Intl lookups, and the loop below tries
    // up to eighteen windows against the same handful of bookings.
    const nearby = nearbyDates(date)
      .flatMap((d) => byDate.get(d) ?? [])
      .map(interviewBounds)
      .filter(Boolean);
    let today = 0;
    for (let minute = windowStart; minute + duration <= windowEnd && out.length < count && today < perDay; minute += 30) {
      const slot = {
        date,
        start: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`,
        end: `${String(Math.floor((minute + duration) / 60)).padStart(2, '0')}:${String((minute + duration) % 60).padStart(2, '0')}`,
      };
      const draft = { ...slot, timeZone };
      const bounds = interviewBounds(draft);
      if (!bounds || bounds[0] < earliest.getTime()) continue;
      if (nearby.some((booked) => boundsOverlap(bounds, booked))) continue;
      out.push(slot);
      today += 1;
      // Leave the rest of that block alone: two options an hour apart are
      // one option as far as the candidate's diary is concerned.
      minute += duration;
    }
  }
  return out;
}

/**
 * The numbered list of options for the proposal email. Each line names its
 * zone, because the candidate is reading it on a different clock.
 */
export function slotOptionsText(interview, settings = null) {
  return normalizeSlots(interview?.slots)
    .map((slot, i) => {
      // The zone sits at the end, where it covers the whole range rather
      // than reading as a property of the start time alone.
      const at = { date: slot.date, start: slot.start, end: slot.end, timeZone: interview?.timeZone ?? '' };
      return `${i + 1}. ${formatDateLong(slot.date)} — ${formatTime(slot.start)} to ${interviewTimeWithZone(at, slot.end, settings)}`;
    })
    .join('\n');
}

/** Proposals still waiting, oldest first; `afterDays` filters fresh ones out. */
export function proposalsAwaitingReply(interviews, { now = new Date(), afterDays = 0 } = {}) {
  return interviews
    .filter((itv) => isProposed(itv) && daysSince(itv.proposedAt ?? itv.createdAt, now) >= afterDays)
    .sort((a, b) => String(a.proposedAt ?? '').localeCompare(String(b.proposedAt ?? '')));
}

/** Returns a list of human-readable problems; empty when valid. */
export function validateInterview({ date, start, end, type, timeZone }) {
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) errors.push('Pick a date.');
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  if (startMin === null || endMin === null) errors.push('Set a start and end time.');
  else if (endMin <= startMin) errors.push('The end time must be after the start time.');
  if (type && !INTERVIEW_TYPES.some((t) => t.value === type)) errors.push('Unknown interview type.');
  // A zone this browser cannot resolve would render as no zone at all, so
  // the invitation and the .ics would quietly disagree with the record.
  if (timeZone && !isValidTimeZone(timeZone)) errors.push('That time zone isn’t one this browser knows.');
  return errors;
}

/**
 * The two absolute instants an interview spans, or null when its date or
 * times are unusable. An interview with no zone is read on the local
 * clock — which is exactly what "floating time" meant before zones.
 */
export function interviewBounds(interview) {
  const start = zonedInstant(interview?.date, interview?.start, interview?.timeZone);
  const end = zonedInstant(interview?.date, interview?.end, interview?.timeZone);
  return start && end ? [start.getTime(), end.getTime()] : null;
}

/**
 * How far either side of a date another interview's own date can sit and
 * still be the same hour.
 *
 * Zones span 26 hours (UTC-12 to UTC+14), and a local day is only 24 —
 * so the same instant can fall on calendar dates two apart, not one. A
 * 22:00-23:59 in Niue (UTC-11) is the small hours of the day *after
 * next* in Kiritimati (UTC+14), and both places are inhabited. Narrowing
 * to ±1 day is what makes checking a draft against a full schedule cheap
 * (a string compare instead of four Intl lookups), but at ±1 that pair
 * of bookings was silently declared free of each other.
 */
export const NEARBY_DAYS = 2;

/** The window of dates worth comparing against `date`, inclusive. */
export function nearbyDates(date) {
  const out = [];
  for (let offset = -NEARBY_DAYS; offset <= NEARBY_DAYS; offset++) out.push(addDays(date, offset));
  return out;
}

/**
 * Do two interviews overlap? Compared as absolute instants, so a 14:00
 * in Berlin and an 08:00 in San Francisco are recognized as the same
 * hour — comparing local minutes made a genuine double-booking across
 * zones invisible.
 */
export function overlaps(a, b) {
  return boundsOverlap(interviewBounds(a), interviewBounds(b));
}

/** The same test, for callers that already hold the instants. */
function boundsOverlap(first, second) {
  if (!first || !second) return false;
  return first[0] < second[1] && second[0] < first[1];
}

const norm = (name) => String(name).trim().toLowerCase();

/**
 * Other interviews that overlap this one and share an interviewer (or the
 * same candidate). Used to warn while scheduling, not to hard-block.
 */
export function interviewConflicts(interview, all) {
  const people = new Set((interview.interviewers ?? []).map(norm));
  // Worked out once, not per record: the editor re-runs this on every
  // keystroke, and each instant costs two Intl lookups.
  const bounds = interviewBounds(interview);
  if (!bounds) return [];
  // Narrow by date before doing any zone arithmetic: nothing further out
  // than NEARBY_DAYS can overlap, and a string comparison costs nothing
  // next to an Intl lookup. Checking a draft against a full schedule ran
  // to 9 ms a keystroke without this.
  const from = addDays(interview.date, -NEARBY_DAYS);
  const to = addDays(interview.date, NEARBY_DAYS);
  return all.filter((other) => {
    // A proposal is a question, not a booking: warning about one would
    // make every second candidate look double-booked.
    if (isProposed(other)) return false;
    if (other.id === interview.id) return false;
    const date = String(other.date ?? '');
    if (date < from || date > to) return false;
    if (!boundsOverlap(bounds, interviewBounds(other))) return false;
    if (other.candidateId === interview.candidateId) return true;
    return (other.interviewers ?? []).some((name) => people.has(norm(name)));
  });
}

export function sortByDateTime(interviews) {
  return [...interviews].sort(
    (a, b) => a.date.localeCompare(b.date) || (toMinutes(a.start) ?? 0) - (toMinutes(b.start) ?? 0)
  );
}

/** Interviews today or later, soonest first. */
export function upcomingInterviews(interviews, now = new Date()) {
  const today = todayISO(now);
  return sortByDateTime(interviews.filter((i) => i.date >= today));
}

/** Interviews before today: most recent day first, chronological within a day. */
export function pastInterviews(interviews, now = new Date()) {
  const today = todayISO(now);
  return interviews
    .filter((i) => i.date < today)
    .sort((a, b) => b.date.localeCompare(a.date) || (toMinutes(a.start) ?? 0) - (toMinutes(b.start) ?? 0));
}

/** Parse a comma-separated interviewer list into clean names. */
export function parseInterviewers(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text ?? '').split(',')) {
    const name = raw.replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/* ---- Time zones --------------------------------------------------------- */

/**
 * The zone an interview's clock times are in: its own, else the account
 * default, else this browser's. Never empty in practice, but callers must
 * cope with '' (an engine that will not name its zone).
 */
export function interviewZone(interview, settings = null) {
  return (
    normalizeTimeZone(interview?.timeZone) || normalizeTimeZone(settings?.timeZone) || browserTimeZone()
  );
}

/** Is this interview's zone a different clock from the reader's own? */
export function isForeignZone(timeZone, reference = browserTimeZone()) {
  const zone = normalizeTimeZone(timeZone);
  if (!zone || !reference || zone === reference) return false;
  const bounds = new Date();
  return zoneAbbreviation(zone, bounds) !== zoneAbbreviation(reference, bounds);
}

/**
 * '2:00 PM GMT+1' — the wall-clock time as written, always named with its
 * zone. For anything the candidate reads: they are not on our clock, so
 * "14:00" alone is the ambiguity this whole feature exists to remove.
 */
export function interviewTimeWithZone(interview, time = interview?.start, settings = null) {
  const clock = formatTime(time);
  const zone = interviewZone(interview, settings);
  if (!zone) return clock;
  const abbr = zoneAbbreviation(zone, zonedInstant(interview?.date, time, zone) ?? new Date());
  return abbr ? `${clock} ${abbr}` : clock;
}

/**
 * The same, for what we read ourselves: the zone is left off when it is
 * our own clock, where naming it would only be noise.
 */
export function interviewTimeLabel(interview, time = interview?.start, settings = null) {
  return isForeignZone(interviewZone(interview, settings))
    ? interviewTimeWithZone(interview, time, settings)
    : formatTime(time);
}

/** The same moment read on another clock: '8:00 AM', or '' when it can't be. */
export function interviewTimeIn(interview, timeZone, time = interview?.start) {
  const zone = normalizeTimeZone(timeZone);
  if (!zone) return '';
  const instant = zonedInstant(interview?.date, time, interviewZone(interview));
  return instant ? formatTimeInZone(instant, zone) : '';
}

/**
 * How an interview reads on a second clock — the candidate's, or the
 * account's when the interview keeps its own zone: '8:00 AM PDT'. Empty
 * when there is no second clock worth showing.
 */
export function secondReading(interview, timeZone, settings = null) {
  const zone = normalizeTimeZone(timeZone);
  const own = interviewZone(interview, settings);
  if (!zone || !own || zone === own) return '';
  const instant = zonedInstant(interview?.date, interview?.start, own);
  if (!instant) return '';
  const clock = formatTimeInZone(instant, zone);
  const abbr = zoneAbbreviation(zone, instant);
  return abbr ? `${clock} ${abbr}` : clock;
}
