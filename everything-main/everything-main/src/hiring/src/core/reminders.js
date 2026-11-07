/**
 * Reminders, computed on demand. There is no server: browser notifications
 * fire while a tab is open, and the same items feed the dashboard digest.
 * Every reminder carries a stable key so it never notifies twice.
 */

import { todayISO, toISODate, addDays, daysSince, formatDate } from '../lib/dates.js';
import { expiringOffers } from './offers.js';
import { interviewTimeLabel, interviewTypeInfo, isProposed, NEARBY_DAYS, PROPOSAL_NUDGE_DAYS, proposalsAwaitingReply } from './interviews.js';
import { zonedInstant } from '../lib/zones.js';
import { dueFollowups } from './followups.js';
import { dueOnboardingTasks } from './onboard.js';
import { STATUS } from './pipeline.js';
import { safeHttpUrl } from '../lib/url.js';

/**
 * Candidates by id. Everything below reaches for a candidate once per
 * record it considers — per offer, per interview, per reminder title —
 * and it all runs on every Overview render and every notification tick,
 * so a linear find per lookup made the work records × candidates.
 */
const indexCandidates = (candidates) => new Map(candidates.map((c) => [c.id, c]));

/** Rejected or withdrawn — records kept for the books, not for nudging. */
function isArchived(candidate) {
  return candidate ? candidate.status === STATUS.REJECTED || candidate.status === STATUS.WITHDRAWN : false;
}

export const REMINDER_DEFAULTS = {
  browser: false,
  interviews: true,
  proposals: true,
  offers: true,
  scorecards: true,
  followups: true,
  onboarding: true,
};

/** Minutes before an interview starts that the nudge fires. */
export const INTERVIEW_LEAD_MINUTES = 30;

/** How long a finished interview keeps nudging for a missing scorecard. */
const SCORECARD_WINDOW_DAYS = 14;

export function reminderSettings(settings) {
  return { ...REMINDER_DEFAULTS, ...(settings?.reminders ?? {}) };
}

/** Every reminder due right now: { key, kind, title, body, route }. */
export function computeReminders(state, now = new Date()) {
  const prefs = reminderSettings(state.settings);
  const today = todayISO(now);
  const reminders = [];
  const byId = indexCandidates(state.candidates);
  const candidateName = (id) => byId.get(id)?.name ?? 'a candidate';

  if (prefs.interviews) {
    // Wall-clock minutes are not comparable across zones: a 09:00 in Tokyo
    // is this evening here, and "today" is not even the same day. Narrow
    // by date first (cheap), then compare the real instants — NEARBY_DAYS
    // is how far apart two calendar dates can be and still name the same
    // hour.
    const from = addDays(today, -NEARBY_DAYS);
    const to = addDays(today, NEARBY_DAYS);
    for (const itv of state.interviews) {
      // A proposal has no agreed time yet; its own nudge is below.
      if (isProposed(itv) || itv.date < from || itv.date > to) continue;
      // An archived candidate's interview is kept only so it can be
      // rescheduled or cleaned up: the overview leaves it out of both the
      // week's count and the upcoming list, the shared calendar feed skips
      // it, and the row itself hides the invitation. Announcing "Interview
      // in 20 min" for someone the app has already recorded as rejected is
      // the one place that record still reads as live work — and the same
      // rule every other reminder kind here already follows.
      if (isArchived(byId.get(itv.candidateId))) continue;
      const startsAt = zonedInstant(itv.date, itv.start, itv.timeZone);
      if (!startsAt) continue;
      const delta = Math.round((startsAt.getTime() - now.getTime()) / 60000);
      if (delta > INTERVIEW_LEAD_MINUTES || delta < -10) continue;
      reminders.push({
        // The slot is part of the key so a rescheduled interview, whose old
        // key was already consumed by the dedupe store, notifies again.
        key: `interview-${itv.id}-${itv.date}-${itv.start}`,
        kind: 'interview',
        title: delta <= 0 ? `Interview starting: ${candidateName(itv.candidateId)}` : `Interview in ${delta} min: ${candidateName(itv.candidateId)}`,
        // Same safeHttpUrl gate as the profile's Join button: promising a
        // call link the renderer refuses to display sends the user hunting.
        body: `${interviewTypeInfo(itv.type).label} at ${interviewTimeLabel(itv, itv.start, state.settings)}${safeHttpUrl(itv.meetingLink) ? ' with a call link on the profile' : ''}`,
        route: `candidates/${itv.candidateId}`,
      });
    }
  }

  if (prefs.proposals) {
    for (const itv of proposalsAwaitingReply(state.interviews, { now, afterDays: PROPOSAL_NUDGE_DAYS })) {
      const candidate = byId.get(itv.candidateId);
      // A candidate who left the process is not owed a chase, and the
      // confirm action is hidden for them anyway.
      if (!candidate || isArchived(candidate)) continue;
      const waiting = daysSince(itv.proposedAt ?? itv.createdAt, now);
      reminders.push({
        // Once a day while it stays unanswered: the nudge is the wait
        // itself, so a key fixed at send time would fire once and never
        // mention it again.
        key: `proposal-${itv.id}-${today}`,
        kind: 'proposal',
        title: `No reply on times: ${candidate.name}`,
        body: `${interviewTypeInfo(itv.type).label} times sent ${waiting} days ago. Nudge them, or pick a time yourself.`,
        route: `candidates/${itv.candidateId}`,
      });
    }
  }

  if (prefs.offers) {
    for (const offer of expiringOffers(state.offers, { withinDays: 3, now })) {
      // An archived candidate's sent offer is kept for the record, but
      // nudging about it points at an action the UI refuses to offer
      // (recording a signature is hidden once the candidate is archived).
      // Follow-ups stay unfiltered on purpose: they are promises the user
      // made, and re-engaging archived talent-pool members is a workflow.
      if (isArchived(byId.get(offer.candidateId))) continue;
      const expired = offer.expires < today;
      reminders.push({
        // The state is part of the key: "expiring" and "expired" are two
        // different nudges, and the first consuming the key in the dedupe
        // store must not swallow the second.
        key: `offer-${offer.id}-${offer.expires}-${expired ? 'expired' : 'soon'}`,
        kind: 'offer',
        title: `${expired ? 'Offer expired' : 'Offer expiring'}: ${candidateName(offer.candidateId)}`,
        body: expired ? `It lapsed on ${formatDate(offer.expires, now)}. Follow up or withdraw.` : `Open until ${formatDate(offer.expires, now)}.`,
        route: `candidates/${offer.candidateId}`,
      });
    }
  }

  if (prefs.followups) {
    for (const { candidate, followup, overdue } of dueFollowups(state, now)) {
      reminders.push({
        // The due date (and time) is part of the key so a rescheduled
        // follow-up notifies again.
        key: `followup-${followup.id}-${followup.dueDate}${followup.dueTime ? `-${followup.dueTime}` : ''}`,
        kind: 'followup',
        title: `${overdue ? 'Overdue follow-up' : 'Follow up'}: ${candidate.name}`,
        body: followup.text,
        route: `candidates/${candidate.id}`,
      });
    }
  }

  if (prefs.onboarding) {
    for (const { candidateId, task, dueDate, overdue } of dueOnboardingTasks(state, { now })) {
      const candidate = byId.get(candidateId);
      // The plan is kept for a hire who fell through, but nudging about
      // ordering a laptop for someone who never started is noise.
      if (!candidate || isArchived(candidate) || candidate.stage !== 'hired') continue;
      reminders.push({
        // The due date is in the key: a task whose start date moved is a
        // different nudge, and the old one is already spent.
        key: `onboarding-${task.id}-${dueDate}`,
        kind: 'onboarding',
        title: `${overdue ? 'Onboarding overdue' : 'Onboarding due'}: ${candidate.name}`,
        body: `${task.title} — ${overdue ? `was due ${formatDate(dueDate, now)}` : `due ${formatDate(dueDate, now)}`}.`,
        route: 'onboarding',
      });
    }
  }

  if (prefs.scorecards) {
    reminders.push(...missingScorecards(state, now).map((itv) => ({
      key: `scorecard-${itv.id}`,
      kind: 'scorecard',
      title: `No feedback yet: ${candidateName(itv.candidateId)}`,
      body: `The ${formatDate(itv.date, now)} interview has no scorecard.`,
      route: `candidates/${itv.candidateId}`,
    })));
  }

  return reminders;
}

/** Interviews that ended over a day ago and still have no scorecard. */
export function missingScorecards(state, now = new Date()) {
  const yesterday = addDays(todayISO(now), -1);
  const horizon = addDays(todayISO(now), -SCORECARD_WINDOW_DAYS);
  const byId = indexCandidates(state.candidates);
  const covered = new Set(state.scorecards.map((s) => s.interviewId).filter(Boolean));
  // Feedback added from the profile carries no interview link (and a
  // linked scorecard whose interview was deleted has its link nulled).
  // Treat such a scorecard as covering the candidate's interviews held
  // before it was written: nagging for two weeks past feedback that is
  // visible on the very screen the reminder opens would be noise.
  const unlinkedUpTo = new Map();
  for (const s of state.scorecards) {
    if (s.interviewId) continue;
    // The scorecard timestamp is UTC; itv.date is the local day from the
    // date picker. Slicing the timestamp would compare the UTC day —
    // tomorrow's date every evening west of UTC, yesterday's every
    // morning east of it — mis-covering interviews by a day either way.
    const created = new Date(s.createdAt ?? NaN);
    const day = Number.isNaN(created.getTime()) ? '' : toISODate(created);
    if (day > (unlinkedUpTo.get(s.candidateId) ?? '')) unlinkedUpTo.set(s.candidateId, day);
  }
  return state.interviews
    // A proposal nobody accepted never happened, so it owes no feedback.
    .filter((itv) => !isProposed(itv))
    .filter((itv) => itv.date < yesterday && itv.date >= horizon && !covered.has(itv.id))
    .filter((itv) => itv.date > (unlinkedUpTo.get(itv.candidateId) ?? ''))
    // Deleted candidates take their interviews' relevance with them, and
    // archived ones no longer need evaluating — the decision was made.
    .filter((itv) => {
      const candidate = byId.get(itv.candidateId);
      return Boolean(candidate) && !isArchived(candidate);
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
