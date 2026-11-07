/**
 * Side-by-side comparison of 2–4 finalists on one job: scorecard
 * averages per rating dimension, per-interviewer recommendations,
 * interview count, days in process, source, and offer terms. A read-only
 * view over data other modules already compute — and print-friendly, so
 * it doubles as a debrief document.
 */
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { avatar, badge, emptyState, jobSelect, ratingStars, recommendationBadge, stageBadge, statusBadge } from '../components.js';
import { openModal } from '../modal.js';
import { toast } from '../toast.js';
import { isActive, stageIndex } from '../../core/pipeline.js';
import { isProposed } from '../../core/interviews.js';
import { averageRating, ratingFieldsForJob, summarizeScorecards } from '../../core/scorecards.js';
import { stageVisits } from '../../core/analytics.js';
import { answerFor, isYesAnswer, screeningQuestionsForJob } from '../../core/screening.js';
import { isOpenOffer, OFFER_STATUS_LABELS } from '../../core/offers.js';
import { formatDate, formatTimestamp, relativeDays } from '../../lib/dates.js';
import { formatMoney, plural } from '../../lib/format.js';

const MAX_COMPARE = 4;
/* Spelled out, because the copy that names it also spells "two": "Pick
   two to 4 candidates" read like a half-finished sentence. */
const MAX_COMPARE_WORD = 'four';

/** Pick a job and 2–4 of its candidates, then jump to the comparison. */
export function openCompareDialog(ctx, jobId = null) {
  const { store } = ctx;
  const comparableJobs = store.state.jobs.filter(
    (j) => store.state.candidates.filter((c) => c.jobId === j.id && isActive(c)).length >= 2
  );
  if (comparableJobs.length === 0) {
    toast('Comparison needs a job with at least two active candidates.', 'error');
    return;
  }

  // Named by the visible <label for="cmp-job"> below, not by an
  // aria-label: the two disagreed, so the screen read "Job" while a
  // screen reader said "Job to compare candidates on".
  const job = jobSelect(comparableJobs, comparableJobs.some((j) => j.id === jobId) ? jobId : comparableJobs[0].id);
  const list = el('div', { class: 'row-list compare-pick' });
  const picked = new Set();

  const go = el('button', { class: 'btn btn-primary', disabled: true }, icon('users', 15), 'Compare');
  go.addEventListener('click', () => {
    modal.close();
    ctx.navigate(`compare/${[...picked].join(',')}`);
  });

  /* Only the ceiling changes as boxes are ticked, so update the boxes in
     place. Rebuilding the list destroyed the checkbox that was just
     activated, which dropped keyboard focus onto <body> — the dialog's
     Tab trap then restarted at the top of the dialog, once per pick. */
  const boxes = [];
  const syncLimit = () => {
    for (const box of boxes) box.disabled = !box.checked && picked.size >= MAX_COMPARE;
  };

  function renderList() {
    // Late-stage candidates first — the decision moment this exists for.
    const settings = store.state.settings;
    const candidates = store.state.candidates
      .filter((c) => c.jobId === job.value && isActive(c))
      .sort((a, b) => stageIndex(b.stage, settings) - stageIndex(a.stage, settings) || b.stageChangedAt.localeCompare(a.stageChangedAt));
    boxes.length = 0;
    list.replaceChildren(
      ...candidates.map((c) => {
        const reviews = store.state.scorecards.filter((s) => s.candidateId === c.id).length;
        const check = el('input', {
          type: 'checkbox',
          class: 'task-check',
          checked: picked.has(c.id),
          onChange: () => {
            if (check.checked) picked.add(c.id);
            else picked.delete(c.id);
            go.disabled = picked.size < 2;
            syncLimit();
          },
        });
        boxes.push(check);
        return el(
          'label',
          { class: 'item-row compare-pick-row' },
          check,
          avatar(c.name, 'avatar-sm'),
          el(
            'div',
            { class: 'item-main' },
            el('div', { class: 'item-title' }, c.name),
            el('div', { class: 'item-sub' }, reviews > 0 ? plural(reviews, 'review') : 'No reviews yet')
          ),
          stageBadge(c.stage, settings)
        );
      })
    );
    syncLimit();
  }
  job.addEventListener('change', () => {
    picked.clear();
    go.disabled = true;
    renderList();
  });
  renderList();

  const modal = openModal({
    title: 'Compare candidates',
    content: [
      el('p', { class: 'confirm-message' }, `Pick two to ${MAX_COMPARE_WORD} candidates for a side-by-side of their feedback, interviews, and offer.`),
      el('div', { class: 'field' }, el('label', { for: 'cmp-job' }, 'Job'), job),
      list,
    ],
    footer: [el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), go],
  });
  job.id = 'cmp-job';
}

export function renderCompare(ctx, param) {
  const { store } = ctx;
  const settings = store.state.settings;
  const ids = String(param ?? '').split(',').filter(Boolean).slice(0, MAX_COMPARE);
  const candidates = ids.map((id) => store.state.candidates.find((c) => c.id === id)).filter(Boolean);

  if (candidates.length < 2) {
    return emptyState({
      iconName: 'users',
      title: 'Nothing to compare',
      message: 'Pick at least two candidates from the pipeline’s Compare action.',
      actions: [el('button', { class: 'btn', onClick: () => ctx.navigate('pipeline') }, 'Back to pipeline')],
    });
  }

  const job = store.state.jobs.find((j) => j.id === candidates[0].jobId);
  const fields = ratingFieldsForJob(job);
  // The job's questions, as it asks them today: answers were snapshotted
  // per candidate, so a question added after someone applied simply has
  // no answer from them, and one since dropped stops taking a row.
  const questions = screeningQuestionsForJob(job);
  const nowIso = new Date().toISOString();

  const columns = candidates.map((c) => {
    const cards = store.state.scorecards
      .filter((s) => s.candidateId === c.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const offers = store.state.offers.filter((o) => o.candidateId === c.id);
    return {
      candidate: c,
      cards,
      summary: summarizeScorecards(cards, fields),
      // Interviews held, not times offered: a proposal sits in this list
      // with its date mirroring the earliest option, so counting it made a
      // finalist whose reply has not arrived look one interview further
      // along than a finalist who had actually been through the same
      // number. The row is read next to their ratings, at the moment the
      // decision gets made.
      interviews: store.state.interviews.filter((i) => i.candidateId === c.id && !isProposed(i)).length,
      daysInProcess: Math.round(stageVisits(c, nowIso).reduce((total, v) => total + v.days, 0)),
      offer: offers.find(isOpenOffer) ?? offers.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null,
    };
  });

  const th = (content) => el('th', { scope: 'col' }, content);
  const rowHead = (label) => el('th', { scope: 'row', class: 'compare-row-label' }, label);
  const row = (label, render) => el('tr', {}, rowHead(label), columns.map((col) => el('td', {}, render(col))));
  const num = (value) => (value === null || value === undefined ? el('span', { class: 'muted' }, '–') : el('span', { class: 'tnum' }, value));

  const table = el(
    'table',
    { class: 'compare-table' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        th(''),
        columns.map(({ candidate }) =>
          th(
            el(
              'button',
              { class: 'compare-person link-button', onClick: () => ctx.navigate(`candidates/${candidate.id}`) },
              avatar(candidate.name, 'avatar-sm'),
              el('span', { class: 'compare-person-name' }, candidate.name),
              statusBadge(candidate, settings)
            )
          )
        )
      )
    ),
    el(
      'tbody',
      {},
      row('Overall rating', (col) =>
        col.summary.average === null
          ? el('span', { class: 'muted' }, '–')
          : el(
              'span',
              { class: 'compare-rating' },
              ratingStars(col.summary.average),
              el('span', { class: 'tnum' }, col.summary.average.toFixed(1)),
              col.summary.leaning
                ? badge(
                    col.summary.leaning === 'hire' ? 'Leaning hire' : col.summary.leaning === 'no_hire' ? 'Leaning no' : 'Split',
                    col.summary.leaning === 'hire' ? 'success' : col.summary.leaning === 'no_hire' ? 'danger' : ''
                  )
                : null
            )
      ),
      fields.map((field) =>
        row(field.label, (col) => num(col.summary.byField[field.key]?.toFixed(1) ?? null))
      ),
      row('Recommendations', (col) =>
        col.cards.length === 0
          ? el('span', { class: 'muted' }, 'None yet')
          : el(
              'div',
              { class: 'compare-recs' },
              col.cards.map((sc) =>
                el(
                  'div',
                  { class: 'compare-rec' },
                  el('span', { class: 'compare-rec-author' }, sc.author),
                  recommendationBadge(sc.recommendation),
                  averageRating(sc) !== null ? el('span', { class: 'tnum muted small' }, averageRating(sc).toFixed(1)) : null
                )
              )
            )
      ),
      questions.map((question) =>
        row(question.label, (col) => {
          const answer = answerFor(col.candidate, question);
          if (answer === null) return el('span', { class: 'muted' }, 'No answer');
          const mismatch = question.mustHave && !isYesAnswer(answer);
          return el('span', { class: mismatch ? 'compare-answer is-flagged' : 'compare-answer' }, answer);
        })
      ),
      row('Interviews', (col) => num(String(col.interviews))),
      row('Days in process', (col) => num(`${col.daysInProcess}d`)),
      row('Applied', (col) => `${formatTimestamp(col.candidate.createdAt)} (${relativeDays(col.candidate.createdAt)})`),
      row('Source', (col) => col.candidate.source || el('span', { class: 'muted' }, 'Unknown')),
      row('Offer', (col) =>
        col.offer
          ? el(
              'div',
              { class: 'compare-offer' },
              el('span', { class: 'tnum' }, `${formatMoney(col.offer.salary, col.offer.currency)} / year`),
              el('span', { class: 'muted small' }, [
                col.offer.bonus ? `${formatMoney(col.offer.bonus, col.offer.currency)} bonus` : null,
                col.offer.equity || null,
                `starts ${formatDate(col.offer.startDate)}`,
              ]
                .filter(Boolean)
                .join(' · ')),
              badge(OFFER_STATUS_LABELS[col.offer.status] ?? col.offer.status)
            )
          : el('span', { class: 'muted' }, '–')
      )
    )
  );

  return [
    el('button', { class: 'btn btn-ghost back-link', onClick: () => ctx.navigate('pipeline') }, icon('arrow-left', 15), 'Pipeline'),
    el(
      'div',
      { class: 'view-header' },
      el(
        'div',
        {},
        el('h1', {}, 'Compare'),
        el('p', { class: 'subtitle' }, job ? `${job.title} · ${plural(candidates.length, 'finalist')}` : plural(candidates.length, 'candidate'))
      ),
      el(
        'div',
        { class: 'view-actions' },
        el('button', { class: 'btn', onClick: () => window.print() }, icon('printer', 15), 'Print'),
        el(
          'button',
          { class: 'btn', onClick: () => openCompareDialog(ctx, candidates[0].jobId) },
          icon('users', 15),
          'Change selection'
        )
      )
    ),
    el('div', { class: 'card compare-card' }, el('div', { class: 'table-scroll' }, table)),
  ];
}

/* Rating dimension rows reuse the job rubric of the first candidate; the
   compare dialog only offers candidates from one job, so they agree. */
