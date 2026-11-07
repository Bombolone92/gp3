/** Overview: key numbers, the funnel, what is coming up, what needs a nudge. */
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { avatar, emptyState, statCard, stageBadge, statusBadge } from '../components.js';
import { activeCandidates, daysInStage, funnelCounts, isHired, onActiveCandidates, stageLabel, stagesFrom, staleCandidates } from '../../core/pipeline.js';
import {
  interviewHasEnded,
  interviewTypeInfo,
  interviewZone,
  isProposed,
  PROPOSAL_NUDGE_DAYS,
  proposalsAwaitingReply,
  upcomingInterviews,
} from '../../core/interviews.js';
import { dueOnboardingTasks, onboardingProgress } from '../../core/onboard.js';
import { missingScorecards } from '../../core/reminders.js';
import { dueFollowups } from '../../core/followups.js';
import { expiringOffers, OFFER_STATUS } from '../../core/offers.js';
import { addDays, daysBetween, formatDate, formatTime, relativeDays, todayISO } from '../../lib/dates.js';
import { plural } from '../../lib/format.js';

/** How many "Needs attention" rows fit before the list is truncated. */
const ATTENTION_LIMIT = 5;

export function renderDashboard(ctx) {
  const { store, ui } = ctx;
  const { jobs, candidates, interviews, offers, settings } = store.state;
  const today = todayISO();

  const openJobs = jobs.filter((j) => j.status === 'open');
  const active = activeCandidates(candidates).filter((c) => c.stage !== 'hired');
  const weekAhead = addDays(today, 7);
  // An archived candidate's interview is kept only for rescheduling or
  // cleanup; the Interviews view lists it with a Rejected/Withdrawn flag,
  // but the overview's stat and upcoming list must not count it as live
  // work coming up. A sent offer is the same story: "Awaiting signature"
  // for someone the app refuses to record a signature for is a dead end.
  // Proposals are excluded from both the count and the list below: no time
  // has been agreed, so counting one as an interview coming up this week
  // would be a promise the calendar cannot keep.
  const liveInterviews = onActiveCandidates(interviews, candidates).filter((i) => !isProposed(i));
  const interviewsThisWeek = liveInterviews.filter((i) => i.date >= today && i.date < weekAhead);
  const awaiting = onActiveCandidates(offers, candidates).filter((o) => o.status === OFFER_STATUS.SENT);

  const stats = el(
    'div',
    { class: 'stat-grid' },
    statCard({
      label: 'Open jobs',
      value: String(openJobs.length),
      sub: jobs.length === 0 ? 'None yet' : jobs.length !== openJobs.length ? `${jobs.length} total` : 'All jobs are live',
      iconName: 'briefcase',
      onClick: () => ctx.navigate('jobs'),
    }),
    statCard({
      label: 'Candidates in play',
      value: String(active.length),
      sub: 'Active, not yet hired',
      iconName: 'users',
      onClick: () => ctx.navigate('pipeline'),
    }),
    statCard({
      label: 'Interviews · 7 days',
      value: String(interviewsThisWeek.length),
      sub: interviewsThisWeek.some((i) => i.date === today) ? 'Some are today' : 'Nothing today',
      iconName: 'calendar',
      onClick: () => ctx.navigate('interviews'),
    }),
    statCard({
      label: 'Offers out',
      value: String(awaiting.length),
      sub: 'Awaiting signature',
      iconName: 'signature',
      onClick: () => ctx.navigate('offers'),
    })
  );

  /* Funnel */
  const counts = funnelCounts(candidates, null, settings);
  const max = Math.max(1, ...Object.values(counts));
  const funnel = el(
    'div',
    { class: 'card card-pad' },
    el(
      'div',
      { class: 'card-title-row no-pad' },
      el('h2', { class: 'card-title' }, 'Pipeline'),
      el('button', { class: 'btn btn-ghost btn-sm', onClick: () => ctx.navigate('reports') }, icon('chart', 14), 'Reports')
    ),
    el(
      'div',
      { class: 'funnel' },
      stagesFrom(settings).map((s) =>
        el(
          'button',
          { class: 'funnel-row', onClick: () => ctx.navigate('pipeline') },
          el('span', { class: 'funnel-label' }, s.label),
          el(
            'span',
            { class: 'funnel-track' },
            el('span', {
              class: `funnel-bar${counts[s.key] ? '' : ' is-empty'}`,
              style: { width: `${(counts[s.key] / max) * 100}%`, background: s.color },
            })
          ),
          el('span', { class: 'funnel-count tnum' }, String(counts[s.key]))
        )
      )
    )
  );

  /* Upcoming interviews */
  // Coming up, not "today or later": an interview that finished this
  // morning stayed at the top of this list until midnight, so at five in
  // the afternoon the card led with a meeting that was already over and
  // pushed tomorrow's out of the five. The schedule still shows the whole
  // day — that is its job — and offers the scorecard there.
  const nextFive = upcomingInterviews(liveInterviews)
    .filter((itv) => !interviewHasEnded(itv, interviewZone(itv, settings)))
    .slice(0, 5);
  const upcoming = el(
    'div',
    { class: 'card' },
    el('h2', { class: 'card-title card-title-pad' }, 'Upcoming interviews'),
    nextFive.length === 0
      ? emptyState({
          iconName: 'calendar',
          title: 'Nothing scheduled',
          message: 'Interviews you schedule show up here with their calendar links.',
        })
      : el(
          'div',
          { class: 'row-list' },
          nextFive.map((itv) => {
            const candidate = candidates.find((c) => c.id === itv.candidateId);
            const job = jobs.find((j) => j.id === itv.jobId);
            return el(
              'div',
              {
                class: 'item-row is-clickable',
                role: 'link',
                tabindex: 0,
                onClick: () => ctx.navigate(`candidates/${itv.candidateId}`),
                onKeydown: (e) => e.key === 'Enter' && ctx.navigate(`candidates/${itv.candidateId}`),
              },
              el(
                'div',
                { class: 'when' },
                el('span', { class: 'when-day' }, itv.date === today ? 'Today' : formatDate(itv.date)),
                el('span', { class: 'when-time tnum' }, formatTime(itv.start))
              ),
              el(
                'div',
                { class: 'item-main' },
                el('div', { class: 'item-title' }, candidate?.name ?? 'Unknown candidate'),
                el('div', { class: 'item-sub' }, `${interviewTypeInfo(itv.type).label}${job ? ` · ${job.title}` : ''}`)
              ),
              icon('chevron-right', 15)
            );
          })
        )
  );

  /* Needs attention: expiring offers, stale candidates, unfinished onboarding */
  // An archived candidate's sent offer stays on the books, but its expiry
  // is no longer anyone's to-do — the reminder pipeline skips it too.
  const expiring = onActiveCandidates(expiringOffers(offers, { withinDays: 3 }), candidates);
  const staleAll = staleCandidates(candidates, { thresholdDays: 14 });
  // Every category is cut to the list's own cap rather than a smaller
  // number of its own: at most ATTENTION_LIMIT rows are ever shown, so a
  // tighter per-kind slice only removed rows from the count below without
  // removing anything from the screen.
  const stale = staleAll.slice(0, ATTENTION_LIMIT);
  // Plans are kept for every hire ever, so this loop is unbounded; index
  // candidates once instead of a linear find per plan.
  const candidatesById = new Map(candidates.map((c) => [c.id, c]));
  // A dated task that has come due says what to do; the generic
  // "3 of 9 done" row below only says that something is unfinished. Both
  // exist, but a plan with due work is represented by the work.
  const dueTasks = dueOnboardingTasks(store.state).filter(({ candidateId }) => {
    const candidate = candidatesById.get(candidateId);
    return candidate && isHired(candidate);
  });
  const dueByCandidate = new Set(dueTasks.map((d) => d.candidateId));
  const dueTaskRows = dueTasks.slice(0, ATTENTION_LIMIT).map(({ candidateId, task, dueDate, overdue }) => ({
    route: 'onboarding',
    title: candidatesById.get(candidateId)?.name ?? 'Unknown',
    sub: `${task.title} — ${overdue ? `was due ${formatDate(dueDate)}` : `due ${formatDate(dueDate)}`}`,
    iconName: 'rocket',
    onSelect: () => {
      ui.onboardingOpen = candidateId;
    },
  }));
  const onboardingRows = Object.entries(store.state.onboarding)
    .map(([id, plan]) => {
      const candidate = candidatesById.get(id);
      // Only current hires: a candidate moved back out of Hired, or
      // archived while on Hired (a renege), keeps their plan for a
      // possible return, but nagging about onboarding someone who is
      // not hired is noise.
      if (!candidate || !isHired(candidate)) return null;
      // Its due work is already listed above; two rows for one plan is
      // the list's cap spent twice on the same hire.
      if (dueByCandidate.has(id)) return null;
      const { done, total } = onboardingProgress(plan.tasks);
      if (total === 0 || done === total) return null;
      return {
        route: 'onboarding',
        title: candidate.name,
        sub: `Onboarding: ${done} of ${plural(total, 'task')} done`,
        iconName: 'rocket',
        // The row names one hire; landing on the view with somebody
        // else's checklist expanded (or everything collapsed) strands
        // the user. Every other attention row opens its exact record.
        onSelect: () => {
          ui.onboardingOpen = id;
        },
      };
    })
    .filter(Boolean);
  const feedbackAll = missingScorecards(store.state);
  const feedbackRows = feedbackAll.slice(0, ATTENTION_LIMIT).map((itv) => ({
    route: `candidates/${itv.candidateId}`,
    title: candidates.find((c) => c.id === itv.candidateId)?.name ?? 'Unknown',
    sub: `No scorecard for the ${formatDate(itv.date)} interview`,
    iconName: 'clipboard',
  }));
  // Proposals nobody has answered: an open loop that looks, from the
  // board, exactly like a candidate who never wrote back.
  const waitingAll = onActiveCandidates(
    proposalsAwaitingReply(interviews, { afterDays: PROPOSAL_NUDGE_DAYS }),
    candidates
  );
  const waitingRows = waitingAll.slice(0, ATTENTION_LIMIT).map((itv) => ({
    route: `candidates/${itv.candidateId}`,
    title: candidatesById.get(itv.candidateId)?.name ?? 'Unknown',
    sub: `Interview times sent ${relativeDays(itv.proposedAt ?? itv.createdAt)} — no reply yet`,
    iconName: 'calendar-clock',
  }));
  const followupsDue = dueFollowups(store.state);
  const followupRows = followupsDue.slice(0, ATTENTION_LIMIT).map(({ candidate, followup, overdue }) => ({
    route: `candidates/${candidate.id}`,
    title: candidate.name,
    // A follow-up that went past its time this morning is overdue today,
    // so name the time rather than a date the reader is living in.
    sub: overdue
      ? `Follow-up was due ${followup.dueDate === today && followup.dueTime ? formatTime(followup.dueTime) : formatDate(followup.dueDate)}: ${followup.text}`
      : `Follow-up due today: ${followup.text}`,
    iconName: 'calendar-check',
  }));
  const attentionRows = [
    // Dated work first — promises the user made, onboarding tasks with a
    // real deadline, offers about to lapse — then the outstanding replies,
    // and only then the inferences ("nobody has touched this in 35 days").
    ...followupRows,
    ...dueTaskRows,
    ...expiring.map((offer) => {
      const candidate = candidates.find((c) => c.id === offer.candidateId);
      const left = daysBetween(today, offer.expires);
      return { route: `candidates/${offer.candidateId}`, title: candidate?.name ?? 'Unknown', sub: left < 0 ? 'Offer expired' : left === 0 ? 'Offer expires today' : `Offer expires in ${plural(left, 'day')}`, iconName: 'hourglass' };
    }),
    ...waitingRows,
    ...stale.map((c) => ({ route: `candidates/${c.id}`, title: c.name, sub: `${plural(daysInStage(c), 'day')} in ${stageLabel(c.stage, settings)}`, iconName: 'clock', stage: c.stage })),
    ...feedbackRows,
    ...onboardingRows,
  ];
  // How much work there actually is, counted from the full lists rather
  // than the rows built above: those are capped per kind, so counting them
  // reported "5 of 7" while seven follow-ups, four expiring offers, and
  // nine stale candidates were waiting.
  const attentionTotal =
    followupsDue.length +
    waitingAll.length +
    expiring.length +
    staleAll.length +
    feedbackAll.length +
    dueTasks.length +
    onboardingRows.length;
  const attention = el(
    'div',
    { class: 'card' },
    // The list is capped, and what falls below the cut is whole kinds of
    // work: the rows are concatenated in priority order, so six due
    // follow-ups hid every expiring offer, every stale candidate, and
    // every missing scorecard with nothing on screen admitting it. Name
    // the total when there is more, the way the Jobs page counts its
    // candidates and the board counts its filtered ones.
    attentionTotal > ATTENTION_LIMIT
      ? el(
          'div',
          { class: 'card-title-row' },
          el('h2', { class: 'card-title' }, 'Needs attention'),
          el('span', { class: 'muted small tnum' }, `${ATTENTION_LIMIT} of ${attentionTotal}`)
        )
      : el('h2', { class: 'card-title card-title-pad' }, 'Needs attention'),
    attentionRows.length === 0
      ? emptyState({ iconName: 'circle-check', title: 'All clear', message: 'No stuck candidates, expiring offers, or unfinished onboarding.' })
      : el(
          'div',
          { class: 'row-list' },
          attentionRows.slice(0, ATTENTION_LIMIT).map((row) =>
            el(
              'div',
              {
                class: 'item-row is-clickable',
                role: 'link',
                tabindex: 0,
                onClick: () => {
                  row.onSelect?.();
                  ctx.navigate(row.route);
                },
                onKeydown: (e) => {
                  if (e.key !== 'Enter') return;
                  row.onSelect?.();
                  ctx.navigate(row.route);
                },
              },
              el('span', { class: 'attention-icon' }, icon(row.iconName, 16)),
              el(
                'div',
                { class: 'item-main' },
                el('div', { class: 'item-title' }, row.title),
                el('div', { class: 'item-sub' }, row.sub)
              ),
              row.stage ? stageBadge(row.stage, settings) : null
            )
          )
        )
  );

  /* Recent candidates */
  const recent = [...candidates].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const recentCard = el(
    'div',
    { class: 'card' },
    el('h2', { class: 'card-title card-title-pad' }, 'Recently added'),
    recent.length === 0
      ? emptyState({ iconName: 'user-plus', title: 'No candidates yet', message: 'New applicants land here as you add them.' })
      : el(
          'div',
          { class: 'row-list' },
          recent.map((c) => {
            const job = jobs.find((j) => j.id === c.jobId);
            return el(
              'div',
              {
                class: 'item-row is-clickable',
                role: 'link',
                tabindex: 0,
                onClick: () => ctx.navigate(`candidates/${c.id}`),
                onKeydown: (e) => e.key === 'Enter' && ctx.navigate(`candidates/${c.id}`),
              },
              avatar(c.name),
              el(
                'div',
                { class: 'item-main' },
                el('div', { class: 'item-title' }, c.name),
                el('div', { class: 'item-sub' }, `${job?.title ?? 'Unknown job'} · ${relativeDays(c.createdAt)}`)
              ),
              // The list is "recently added", not "recently added and still
              // in play": someone rejected the day they applied belongs
              // here, but a bare stage badge said "Screening" and made them
              // look live. statusBadge falls back to the stage for everyone
              // who still is — the same rule the archive, the Offers list,
              // and the Interviews list already follow.
              statusBadge(c, settings)
            );
          })
        )
  );

  return [
    el(
      'div',
      { class: 'view-header' },
      el(
        'div',
        {},
        el('h1', {}, 'Overview'),
        el('p', { class: 'subtitle' }, settings.companyName ? `Hiring at ${settings.companyName}` : 'Your hiring at a glance')
      )
    ),
    stats,
    el('div', { class: 'dash-grid' }, funnel, upcoming, attention, recentCard),
  ];
}
