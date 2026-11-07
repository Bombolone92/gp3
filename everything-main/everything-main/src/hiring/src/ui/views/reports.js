/** Reports: time to hire, stage conversion, days in stage, and sources. */
import { el } from '../../lib/dom.js';
import { emptyState, jobSelect, segmented, statCard } from '../components.js';
import {
  averageDaysInStage,
  offerOutcomes,
  scopeCandidates,
  sourceBreakdown,
  stageConversion,
  timeToHire,
} from '../../core/analytics.js';
import { stageLabel, stagesFrom } from '../../core/pipeline.js';
import { plural } from '../../lib/format.js';

const PERIODS = [
  { value: 'all', label: 'All time', days: null },
  { value: '90', label: '90 days', days: 90 },
  { value: '30', label: '30 days', days: 30 },
];

export function renderReports(ctx) {
  const { store, ui } = ctx;
  const { jobs, candidates, offers, settings } = store.state;
  const stageColor = new Map(stagesFrom(settings).map((s) => [s.key, s.color]));
  // Like the pipeline: a filter left pointing at a deleted job must fall
  // back to "All jobs" instead of silently scoping the report to nothing.
  const jobFilter = jobs.some((j) => j.id === ui.reportJob) ? ui.reportJob : '';
  const period = PERIODS.find((p) => p.value === (ui.reportPeriod ?? 'all')) ?? PERIODS[0];
  const nowIso = new Date().toISOString();
  const since = period.days ? new Date(Date.now() - period.days * 86400000).toISOString() : null;

  const scoped = scopeCandidates(candidates, { jobId: jobFilter || null, since });
  // Hire and offer stats are scoped by when the thing happened (the cards
  // promise "in the last N days"), not by when the candidate was added —
  // someone sourced months ago and hired yesterday is this period's hire,
  // and the offer they signed last week is this period's signature.
  const onThisJob = scopeCandidates(candidates, { jobId: jobFilter || null });
  const hires = timeToHire(onThisJob, { since });

  const jobsFilter = jobSelect(jobs, jobFilter, { allLabel: 'All jobs' });
  jobsFilter.classList.add('job-filter');
  jobsFilter.setAttribute('aria-label', 'Filter by job');
  jobsFilter.dataset.focusKey = 'reports-job-filter';
  jobsFilter.addEventListener('change', (e) => {
    ui.reportJob = e.target.value;
    ctx.refresh();
  });

  const header = el(
    'div',
    { class: 'view-header' },
    el(
      'div',
      {},
      el('h1', {}, 'Reports'),
      el('p', { class: 'subtitle' }, `${plural(scoped.length, 'candidate')} in scope`)
    ),
    el(
      'div',
      { class: 'view-actions' },
      jobsFilter,
      segmented(
        PERIODS.map((p) => ({ value: p.value, label: p.label })),
        period.value,
        (v) => {
          ui.reportPeriod = v;
          ctx.refresh();
        },
        'Period'
      )
    )
  );

  if (scoped.length === 0 && hires.count === 0) {
    // "No data yet" and "your filters excluded everything" are different
    // situations: the first-run copy on a filtered view suggests the data
    // is gone rather than out of scope.
    return [
      header,
      candidates.length === 0
        ? emptyState({
            iconName: 'chart',
            title: 'Nothing to report yet',
            message: 'Once candidates move through the pipeline, time to hire, conversion, and source numbers show up here.',
          })
        : emptyState({
            iconName: 'chart',
            title: 'Nothing in this scope',
            message: 'No candidates match the current job and period filters. Widen the period or switch jobs to see the numbers.',
          }),
    ];
  }

  const offerStats = offerOutcomes(offers, new Set(onThisJob.map((c) => c.id)), { since });
  // "No resolved offers yet" reads as "this account has never resolved
  // one", which is wrong under a period that simply has none in it.
  const noOutcomes = period.days ? `None signed or declined in the last ${period.days} days` : 'No resolved offers yet';

  const stats = el(
    'div',
    { class: 'stat-grid' },
    statCard({
      label: 'Median time to hire',
      value: hires.median === null ? '–' : `${Math.round(hires.median)}d`,
      sub: hires.count > 0 ? `across ${plural(hires.count, 'hire')}` : 'No hires in this scope yet',
      iconName: 'badge-check',
    }),
    statCard({
      label: 'Hires',
      value: String(hires.count),
      sub: period.days ? `in the last ${period.days} days` : 'all time',
      iconName: 'rocket',
    }),
    statCard({
      label: 'Offer acceptance',
      value: offerStats.acceptance === null ? '–' : `${Math.round(offerStats.acceptance * 100)}%`,
      sub: offerStats.acceptance === null ? noOutcomes : `${offerStats.signed} signed · ${offerStats.declined} declined`,
      iconName: 'signature',
    }),
    statCard({
      label: 'Candidates',
      value: String(scoped.length),
      sub: 'in the selected scope',
      iconName: 'users',
    })
  );

  /* Stage conversion */
  const conversion = stageConversion(scoped, settings);
  const conversionCard = el(
    'div',
    { class: 'card card-pad' },
    el('h2', { class: 'card-title' }, 'Stage conversion'),
    el('p', { class: 'muted small report-note' }, 'Of everyone who reached a stage, how many advanced past it.'),
    el(
      'div',
      { class: 'funnel' },
      conversion.map((step) =>
        el(
          'div',
          { class: 'funnel-row is-static' },
          el('span', { class: 'funnel-label' }, `${stageLabel(step.stage, settings)} to ${stageLabel(step.next, settings)}`),
          el(
            'span',
            { class: 'funnel-track' },
            el('span', {
              class: `funnel-bar${step.rate ? '' : ' is-empty'}`,
              style: { width: `${(step.rate ?? 0) * 100}%`, background: stageColor.get(step.stage) },
            })
          ),
          el(
            'span',
            { class: 'funnel-count tnum' },
            step.rate === null ? '–' : `${step.advanced}/${step.reached} · ${Math.round(step.rate * 100)}%`
          )
        )
      )
    )
  );

  /* Average days in stage (hired excluded: it is terminal) */
  const daysRows = averageDaysInStage(scoped, nowIso, settings).filter((r) => r.stage !== 'hired');
  const maxDays = Math.max(1, ...daysRows.map((r) => r.average ?? 0));
  const daysCard = el(
    'div',
    { class: 'card card-pad' },
    el('h2', { class: 'card-title' }, 'Average days in stage'),
    el('p', { class: 'muted small report-note' }, 'Where candidates wait the longest.'),
    el(
      'div',
      { class: 'funnel' },
      daysRows.map((row) =>
        el(
          'div',
          { class: 'funnel-row is-static' },
          el('span', { class: 'funnel-label' }, stageLabel(row.stage, settings)),
          el(
            'span',
            { class: 'funnel-track' },
            el('span', {
              class: `funnel-bar${row.average ? '' : ' is-empty'}`,
              style: { width: `${((row.average ?? 0) / maxDays) * 100}%`, background: stageColor.get(row.stage) },
            })
          ),
          el('span', { class: 'funnel-count tnum' }, row.average === null ? '–' : `${row.average.toFixed(1)}d`)
        )
      )
    )
  );

  /* Sources */
  const sources = sourceBreakdown(scoped);
  const sourcesCard = el(
    'div',
    { class: 'card card-pad' },
    el('h2', { class: 'card-title' }, 'Sources'),
    el('p', { class: 'muted small report-note' }, 'Which channels bring candidates, and which bring hires.'),
    el(
      'table',
      { class: 'report-table' },
      el(
        'thead',
        {},
        el('tr', {}, el('th', {}, 'Source'), el('th', { class: 'num' }, 'Candidates'), el('th', { class: 'num' }, 'Hires'), el('th', { class: 'num' }, 'Hire rate'))
      ),
      el(
        'tbody',
        {},
        sources.map((row) =>
          el(
            'tr',
            {},
            el('td', {}, row.source),
            el('td', { class: 'num tnum' }, String(row.total)),
            el('td', { class: 'num tnum' }, String(row.hired)),
            el('td', { class: 'num tnum' }, row.total > 0 ? `${Math.round((row.hired / row.total) * 100)}%` : '–')
          )
        )
      )
    )
  );

  /* Offer outcomes */
  const offersCard = el(
    'div',
    { class: 'card card-pad' },
    el('h2', { class: 'card-title' }, 'Offers'),
    el(
      'p',
      { class: 'muted small report-note' },
      period.days
        ? `Offers sent, signed, or declined in the last ${period.days} days, on candidates in scope.`
        : 'Outcomes for every offer to candidates in scope.'
    ),
    el(
      'dl',
      { class: 'detail-list' },
      el('dt', {}, 'Sent'),
      el('dd', { class: 'tnum' }, String(offerStats.sent)),
      el('dt', {}, 'Signed'),
      el('dd', { class: 'tnum' }, String(offerStats.signed)),
      el('dt', {}, 'Declined'),
      el('dd', { class: 'tnum' }, String(offerStats.declined)),
      el('dt', {}, 'Acceptance'),
      el('dd', { class: 'tnum' }, offerStats.acceptance === null ? noOutcomes : `${Math.round(offerStats.acceptance * 100)}%`)
    )
  );

  return [header, stats, el('div', { class: 'dash-grid' }, conversionCard, daysCard, sourcesCard, offersCard)];
}
