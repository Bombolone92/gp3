/** Interview schedule: upcoming and past, grouped by day. */
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { badge, emptyState, iconButton, segmented } from '../components.js';
import { openModal } from '../modal.js';
import { confirmDialog } from '../modal.js';
import { openInterviewEditor } from '../editors/interview.js';
import { openScorecardEditor } from '../editors/scorecard.js';
import { openGuideView } from '../guides.js';
import { findGuide } from '../../core/guides.js';
import { confirmSlot, downloadICS, inviteVars, slotLabel, slotVars } from './candidate.js';
import { composeEmail } from '../email.js';
import {
  committedInterviews,
  interviewConflicts,
  interviewHasEnded,
  interviewTypeInfo,
  interviewZone,
  isForeignZone,
  isProposed,
  nearbyDates,
  normalizeSlots,
  pastInterviews,
  secondReading,
  slotHasPassed,
  upcomingInterviews,
} from '../../core/interviews.js';
import { zoneAbbreviation, zonedInstant } from '../../lib/zones.js';
import { isActive } from '../../core/pipeline.js';
import { formatDateLong, formatTime, relativeDays, todayISO } from '../../lib/dates.js';
import { safeHttpUrl } from '../../lib/url.js';
import { plural } from '../../lib/format.js';

export function renderInterviews(ctx) {
  const { store, ui } = ctx;
  const { interviews, candidates, jobs } = store.state;
  const tab = ui.interviewTab ?? 'upcoming';
  const upcoming = upcomingInterviews(interviews);
  const list = tab === 'upcoming' ? upcoming : pastInterviews(interviews);
  const today = todayISO();

  const header = el(
    'div',
    { class: 'view-header' },
    el(
      'div',
      {},
      el('h1', {}, 'Interviews'),
      el('p', { class: 'subtitle' }, `${plural(upcoming.length, 'upcoming interview')}`)
    ),
    el(
      'div',
      { class: 'view-actions' },
      segmented(
        [
          { value: 'upcoming', label: 'Upcoming' },
          { value: 'past', label: 'Past' },
        ],
        tab,
        (v) => {
          ui.interviewTab = v;
          ctx.refresh();
        },
        'Time range'
      ),
      el('button', { class: 'btn btn-primary', onClick: () => openInterviewEditor(ctx) }, icon('calendar-plus', 15), 'Schedule')
    )
  );

  if (list.length === 0) {
    return [
      header,
      emptyState({
        iconName: 'calendar',
        title: tab === 'upcoming' ? 'Nothing scheduled' : 'No past interviews',
        message:
          tab === 'upcoming'
            ? 'Schedule interviews here; every one exports as a calendar invite and can carry a video link.'
            : 'Once interviews happen they move here, ready for scorecards.',
        actions:
          tab === 'upcoming'
            ? [el('button', { class: 'btn btn-primary', onClick: () => openInterviewEditor(ctx) }, icon('calendar-plus', 15), 'Schedule interview')]
            : [],
      }),
    ];
  }

  /* Group by date, preserving list order. */
  const groups = new Map();
  for (const itv of list) {
    if (!groups.has(itv.date)) groups.set(itv.date, []);
    groups.get(itv.date).push(itv);
  }

  // Checking each row against every interview ever scheduled turns the
  // view quadratic, so each one is compared against its own day and the
  // NEARBY_DAYS either side of it: zones put as much as 26 hours between
  // two wall-clock dates, so a 22:00 in Tokyo and a 01:00 the next day in
  // Auckland are the same hour — a same-day-only pool called that pair
  // free while the editor (which compares against everything) warned
  // about it. Only real commitments count (see committedInterviews).
  const byDate = new Map();
  for (const itv of committedInterviews(interviews, candidates)) {
    if (!byDate.has(itv.date)) byDate.set(itv.date, []);
    byDate.get(itv.date).push(itv);
  }
  const nearby = (date) => nearbyDates(date).flatMap((d) => byDate.get(d) ?? []);

  const sections = [...groups.entries()].map(([date, items]) => {
    // Every row in a section shares its date, so the pool is built once.
    const pool = nearby(date);
    return el(
      'section',
      {},
      el('h2', { class: 'section-title' }, date === today ? `Today · ${formatDateLong(date)}` : formatDateLong(date)),
      el(
        'div',
        { class: 'card row-list' },
        items.map((itv) => interviewRow(ctx, itv, { candidates, jobs, past: tab === 'past', pool }))
      )
    );
  });

  return [header, sections];
}

function interviewRow(ctx, itv, { candidates, jobs, past, pool }) {
  const { store } = ctx;
  const candidate = candidates.find((c) => c.id === itv.candidateId);
  const job = jobs.find((j) => j.id === itv.jobId);
  const type = interviewTypeInfo(itv.type);
  const guide = findGuide(store.state.settings, itv.guideId);
  const proposed = isProposed(itv);
  const zone = interviewZone(itv, store.state.settings);
  const zoneChip = isForeignZone(zone) ? zoneAbbreviation(zone, zonedInstant(itv.date, itv.start, zone) ?? new Date()) : '';
  // "Past" is which tab you are on — a calendar day — and an interview
  // that finished this morning is still on the Upcoming one. Whether it
  // is over is a question about the clock, and it decides both actions
  // below: feedback is written straight after the call, and there is
  // nothing left to invite anyone to.
  const ended = interviewHasEnded(itv, zone);
  // What the same moment reads as where the candidate is — the number
  // they will be looking at when they join.
  const theirs = secondReading(itv, candidate?.timeZone, store.state.settings);
  // Archiving blocks new interviews but keeps existing ones for cleanup;
  // without a flag this row is indistinguishable from a live one.
  const archived = candidate && !isActive(candidate);
  // A double-booking warning is about a commitment of your own. This row
  // has none to defend when it is a proposal (nobody has agreed to the
  // mirrored option, and the confirm dialog checks each one at the moment
  // it becomes real) or when its candidate has left the process.
  const clashes = proposed || archived ? [] : interviewConflicts(itv, pool);

  return el(
    'div',
    { class: 'item-row interview-row' },
    el(
      'div',
      { class: 'when' },
      el('span', { class: 'when-time tnum' }, formatTime(itv.start)),
      el('span', { class: 'when-sub tnum' }, formatTime(itv.end)),
      // Only when the slot is not on our own clock: naming our own zone on
      // every row would be noise, and its absence is what makes a foreign
      // one stand out.
      zoneChip
        ? el('span', { class: 'when-zone', title: interviewZone(itv, store.state.settings) }, zoneChip)
        : null
    ),
    // The schedule is the one listing that does not spell the format out
    // in text — the overview and the profile both put it in the sub-line,
    // and here the sub-line carries the job, the panel, and the room. So
    // the icon is the only thing saying whether this is a phone screen or
    // an onsite, and its svg is aria-hidden with the label in a title
    // that only ever surfaces on hover. Name it, the way the conflict
    // flag below is named for exactly the same reason.
    el(
      'span',
      { class: 'itv-type-icon', role: 'img', 'aria-label': type.label, title: type.label },
      icon(type.icon, 16)
    ),
    el(
      'div',
      { class: 'item-main' },
      el(
        'button',
        { class: 'link-button item-title', onClick: () => ctx.navigate(`candidates/${itv.candidateId}`) },
        candidate?.name ?? 'Unknown candidate'
      ),
      el(
        'div',
        { class: 'item-sub' },
        [
          job?.title,
          // A proposal's row sits at its earliest option; say so, and say
          // how long the reply has been outstanding.
          proposed ? `${plural(normalizeSlots(itv.slots).length, 'option')} sent ${relativeDays(itv.proposedAt ?? itv.createdAt)}, no reply` : null,
          theirs ? `${theirs} for ${(candidate?.name ?? '').split(' ')[0] || 'the candidate'}` : null,
          itv.interviewers.length ? `with ${itv.interviewers.join(', ')}` : null,
          itv.location || null,
        ]
          .filter(Boolean)
          .join(' · ')
      )
    ),
    archived ? badge(candidate.status === 'rejected' ? 'Rejected' : 'Withdrawn', candidate.status === 'rejected' ? 'danger' : '') : null,
    proposed ? badge('Proposed', 'warning') : null,
    clashes.length > 0
      ? el(
          'span',
          {
            class: 'conflict-flag',
            // The icon is aria-hidden and title is hover-only; the label
            // makes the double-booking audible to screen readers too.
            role: 'img',
            'aria-label': `Overlaps ${plural(clashes.length, 'other interview')}`,
            title: `Overlaps ${plural(clashes.length, 'other interview')}`,
          },
          icon('warning', 15)
        )
      : null,
    el(
      'div',
      { class: 'item-actions' },
      safeHttpUrl(itv.meetingLink)
        ? el(
            'a',
            {
              class: 'btn btn-ghost btn-icon btn-sm',
              href: safeHttpUrl(itv.meetingLink),
              target: '_blank',
              rel: 'noreferrer',
              'aria-label': 'Join video call',
              title: 'Join video call',
            },
            icon('video', 15)
          )
        : null,
      // A proposal's one job is to become a booking; that is the action.
      proposed && candidate && !archived
        ? el(
            'button',
            { class: 'btn btn-sm btn-primary', onClick: () => openSlotPicker(ctx, itv, candidate) },
            icon('check', 14),
            'Confirm a time'
          )
        : null,
      (past || ended) && candidate && !proposed
        ? el(
            'button',
            { class: 'btn btn-sm', onClick: () => openScorecardEditor(ctx, { candidate, interviewId: itv.id }) },
            icon('clipboard', 14),
            'Scorecard'
          )
        : null,
      // No invitation email for an archived candidate: the interview is
      // kept only so it can be rescheduled or cleaned up. Nor for one
      // that is over — the only thing left to send is a follow-up.
      !past && !ended && !archived && candidate?.email
        ? iconButton({
            name: 'mail',
            label: proposed ? 'Email the options again' : 'Email the invitation',
            onClick: () =>
              proposed
                ? composeEmail(ctx, 'slots', candidate, slotVars(itv, job, store.state.settings))
                : composeEmail(ctx, 'invite', candidate, inviteVars(itv, job, candidate, store.state.settings)),
          })
        : null,
      // The schedule is the screen that is open when the call starts, and
      // it was the one place the guide could not be reached from: the
      // profile row for the same interview offers it, and a question set
      // meant to be read during the interview should not need a detour
      // through the candidate's profile to open.
      guide
        ? iconButton({
            name: 'list-checks',
            label: `Open the ${guide.name} guide`,
            onClick: () => openGuideView(ctx, guide, { candidate, interview: itv }),
          })
        : null,
      candidate && !proposed
        ? iconButton({ name: 'calendar-plus', label: 'Download calendar invite', onClick: () => downloadICS(itv, candidate, job) })
        : null,
      iconButton({ name: 'pencil', label: 'Edit interview', onClick: () => openInterviewEditor(ctx, itv) }),
      iconButton({
        name: 'trash',
        label: 'Delete interview',
        danger: true,
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'Delete this interview?',
            message: 'Any scorecards written for it are kept.',
            confirmLabel: 'Delete',
            danger: true,
          });
          if (ok) await store.deleteInterview(itv.id);
        },
      })
    )
  );
}

/**
 * The options a proposal is waiting on, one click each. Conflicts are
 * checked per option and shown beside it — the warning the fixed-time
 * editor gives, at the moment it finally means something.
 */
function openSlotPicker(ctx, interview, candidate) {
  const { store } = ctx;
  const settings = store.state.settings;
  const slots = normalizeSlots(interview.slots);
  const rows = slots.map((slot, i) => {
    const draft = { ...slot, id: interview.id, candidateId: interview.candidateId, timeZone: interview.timeZone ?? '', interviewers: interview.interviewers ?? [] };
    const clashes = interviewConflicts(draft, committedInterviews(store.state.interviews, store.state.candidates));
    const theirs = secondReading(draft, candidate?.timeZone, settings);
    return el(
      'div',
      { class: 'item-row' },
      el(
        'div',
        { class: 'item-main' },
        el('div', { class: 'item-title tnum' }, slotLabel(interview, slot, settings)),
        el(
          'div',
          { class: 'item-sub' },
          [
            // Same reading as the profile's own option buttons: a time
            // that has gone by is still confirmable, but it is not on the
            // table any more and the dialog has to say so.
            slotHasPassed(slot, interviewZone(interview, settings)) ? 'already passed' : null,
            theirs ? `${theirs} their time` : null,
            clashes.length > 0 ? `overlaps ${plural(clashes.length, 'other interview')}` : null,
          ]
            .filter(Boolean)
            .join(' · ')
        )
      ),
      clashes.length > 0
        ? el(
            'span',
            { class: 'conflict-flag', role: 'img', 'aria-label': `Overlaps ${plural(clashes.length, 'other interview')}` },
            icon('warning', 15)
          )
        : null,
      el(
        'button',
        {
          class: 'btn btn-sm btn-primary',
          onClick: async () => {
            modal.close();
            await confirmSlot(ctx, interview, i);
          },
        },
        icon('check', 14),
        'Confirm'
      )
    );
  });

  const modal = openModal({
    title: `Which time did ${(candidate?.name ?? 'they').split(' ')[0]} pick?`,
    content: [
      el('p', { class: 'confirm-message' }, 'Confirming turns this proposal into a scheduled interview, with its calendar file and invitation.'),
      el('div', { class: 'row-list' }, rows),
    ],
    footer: [el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel')],
  });
}
