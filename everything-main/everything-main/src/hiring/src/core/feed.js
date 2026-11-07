/**
 * The subscribable interview calendar: one .ics file holding every
 * interview worth knowing about, hosted on the account's own public site.
 *
 * A subscription link has to be fetchable without credentials — there is
 * no server here to authenticate one — so the file's name carries the
 * secret and the payload is deliberately thin: when, for how long, who
 * (first name by default) and for which role. No panel names, no notes,
 * no meeting links, nothing an unlisted-but-public URL should not carry.
 */

import { buildCalendar } from '../lib/ics.js';
import { uid } from '../lib/id.js';
import { addDays, todayISO } from '../lib/dates.js';
import { interviewTypeInfo, isProposed } from './interviews.js';
import { onActiveCandidates } from './pipeline.js';

/** How far back the feed keeps interviews, so last week stays visible. */
export const FEED_PAST_DAYS = 21;

/** How often a subscribed calendar is asked to re-fetch the feed. */
export const FEED_REFRESH_HOURS = 1;

/** An unguessable file name; a new one is minted whenever sharing starts. */
export function newFeedFile() {
  return `interviews-${uid()}.ics`;
}

/** Is this a file name this app would have written? Guards restored data. */
export function isFeedFile(name) {
  return /^interviews-[A-Za-z0-9_-]{6,64}\.ics$/.test(String(name ?? ''));
}

/**
 * The interviews a subscribed calendar should show: confirmed ones for
 * candidates still in play, from a short trailing window into the future.
 * A proposal has no agreed time, and an archived candidate's interview is
 * kept only for cleanup — neither belongs in anyone's calendar.
 */
export function feedInterviews(state, { now = new Date(), pastDays = FEED_PAST_DAYS } = {}) {
  const from = addDays(todayISO(now), -pastDays);
  return onActiveCandidates(state.interviews, state.candidates)
    .filter((itv) => !isProposed(itv) && String(itv.date ?? '') >= from)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.start).localeCompare(String(b.start)));
}

const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0] || 'Candidate';

/** The .ics text for the whole feed. */
export function buildInterviewFeed(state, { now = new Date(), fullNames = false, pastDays = FEED_PAST_DAYS } = {}) {
  const candidates = new Map(state.candidates.map((c) => [c.id, c]));
  const jobs = new Map(state.jobs.map((j) => [j.id, j]));
  const company = String(state.settings?.companyName ?? '').trim();
  const events = feedInterviews(state, { now, pastDays }).map((itv) => {
    const candidate = candidates.get(itv.candidateId);
    const who = fullNames ? String(candidate?.name ?? 'Candidate').trim() : firstName(candidate?.name);
    const role = jobs.get(itv.jobId)?.title;
    return {
      title: `Interview: ${who}${role ? ` · ${role}` : ''}`,
      // The format is genuinely useful in a calendar (a phone screen and
      // an onsite are different commitments) and gives nothing away.
      description: interviewTypeInfo(itv.type).label,
      date: itv.date,
      start: itv.start,
      end: itv.end,
      timeZone: itv.timeZone ?? '',
      // Stable per interview, so a rescheduled one moves in subscribed
      // calendars instead of appearing twice.
      uid: `${itv.id}@hiring`,
    };
  });
  return buildCalendar(events, {
    name: company ? `Interviews · ${company}` : 'Interviews',
    now,
    // The app rewrites this file the moment anything changes, so the only
    // thing standing between a change and the subscriber's calendar is
    // how often their client asks. Say hourly.
    refreshHours: FEED_REFRESH_HOURS,
  });
}

/**
 * A short key for "would the feed come out different?" — checked on every
 * store notification, so it must not do the builder's work: buildCalendar
 * escapes, folds, and converts every event's zone (two Intl lookups
 * each), which at a full pipeline is milliseconds per render.
 */
export function feedFingerprint(state, feed) {
  if (!isFeedFile(feed?.file)) return '';
  const candidates = new Map(state.candidates.map((c) => [c.id, c.name]));
  const jobs = new Map(state.jobs.map((j) => [j.id, j.title]));
  const parts = [feed.file, feed.fullNames ? 'full' : 'first', String(state.settings?.companyName ?? '')];
  for (const itv of feedInterviews(state)) {
    parts.push(
      itv.id,
      itv.date,
      itv.start,
      itv.end,
      itv.timeZone ?? '',
      itv.type ?? '',
      String(candidates.get(itv.candidateId) ?? ''),
      String(jobs.get(itv.jobId) ?? '')
    );
  }
  return parts.join('\u0001');
}
