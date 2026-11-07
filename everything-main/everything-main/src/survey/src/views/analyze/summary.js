/**
 * Question summaries: an overview (response totals and volume over time)
 * and one card per answerable question with a chart, the numbers as a
 * table, and the typed-in answers where there are any.
 */
import { h, append, replace, debounce } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { openDialog } from '../../lib/ui.js';
import { fmtNum, fmtDate, fmtDateTime, fmtDuration, plural } from '../../lib/format.js';
import { questionNumbers, isAnswerable, sliderBounds } from '../../shared/runtime.js';
import { allQuestions, TYPE_BY_ID } from '../../model/survey.js';
import { responsesOverTime, median } from '../../analysis/aggregate.js';
import { answerText } from '../../analysis/answers.js';
import { hbarChart, columnChart, donutChart, stackedRows, segmentBar, fmtPctShort } from './charts.js';

const PAGE = 10;

const fmtStat = (v, digits = 2) => (v == null ? '-' : Number.isInteger(v) ? fmtNum(v) : v.toFixed(digits));

function statTiles(items) {
  return h('dl', { class: 'an-stats' }, items.map(([label, value, sub]) => h('div', { class: 'an-stat' }, h('dt', null, label), h('dd', null, value), sub ? h('dd', { class: 'an-stat-sub' }, sub) : null)));
}

function table(head, rows, { caption = '', numericFrom = 1 } = {}) {
  return h(
    'div',
    { class: 'an-table-wrap' },
    h(
      'table',
      // Wide (a grid with many columns): printed at the page's width.
      { class: head.length > 9 ? 'an-table an-table-wide' : 'an-table' },
      caption ? h('caption', { class: 'sr-only' }, caption) : null,
      h('thead', null, h('tr', null, head.map((c, i) => h('th', { scope: 'col', class: i >= numericFrom ? 'num' : '' }, c)))),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => (i === 0 ? h('th', { scope: 'row' }, c) : h('td', { class: i >= numericFrom ? 'num' : '' }, c)))))),
    ),
  );
}

/* ---- Overview ---- */

export function overviewCard(responses, total) {
  const complete = responses.filter((r) => (r.outcome || 'complete') === 'complete').length;
  const times = responses.map((r) => r.at - r.st).filter((d) => d > 0).sort((a, b) => a - b);
  const medianTime = median(times) || 0;
  const { unit, buckets } = responsesOverTime(responses);
  const unitLabel = { day: 'day', week: 'week', month: 'month', year: 'year' }[unit];
  const fmtBucket = (t) =>
    unit === 'year'
      ? String(new Date(t).getFullYear())
      : unit === 'month'
        ? new Date(t).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
        : fmtDate(t);
  const peak = buckets.reduce((m, b) => (b.count > m.count ? b : m), { count: 0 });
  let chart = null;
  if (buckets.length > 1) {
    const mid = buckets[Math.floor(buckets.length / 2)];
    chart = h(
      'figure',
      { class: 'an-timeline' },
      h('figcaption', null, `Responses per ${unitLabel}`),
      columnChart(
        buckets.map((b) => ({ label: fmtBucket(b.start), value: b.count, tip: `${unit === 'week' ? 'Week of ' : ''}${fmtBucket(b.start)}: ${plural(b.count, 'response')}` })),
        {
          label: `Responses per ${unitLabel} from ${fmtBucket(buckets[0].start)} to ${fmtBucket(buckets[buckets.length - 1].start)}. Busiest: ${fmtBucket(peak.start)} with ${plural(peak.count, 'response')}.`,
          capLimit: 0,
          height: 72,
          axisLabels: [fmtBucket(buckets[0].start), buckets.length > 4 ? fmtBucket(mid.start) : '', fmtBucket(buckets[buckets.length - 1].start)],
        },
      ),
    );
  }
  return h(
    'section',
    { class: 'an-card an-overview', 'aria-label': 'Overview' },
    statTiles([
      ['Responses', fmtNum(responses.length), responses.length !== total ? `of ${fmtNum(total)} in total` : null],
      ['Completed', fmtNum(complete), responses.length ? `${fmtPctShort((complete / responses.length) * 100)} of responses` : null],
      ['Typical time', medianTime ? fmtDuration(medianTime) : '-', medianTime ? 'median' : null],
      // A loop, not Math.max(...): spreading 100k+ values exceeds the engine's argument limit.
      ['Latest', responses.length ? fmtDate(responses.reduce((m, r) => Math.max(m, r.at || 0), 0)) : '-', null],
    ]),
    chart,
  );
}

/* ---- Per-type bodies ---- */

function choiceBody(q, s, view, onView) {
  const rows = s.rows;
  const answered = s.answered;
  const label = `${TYPE_BY_ID[q.type].label} results for ${q.title || 'this question'}: ${rows.map((r) => `${r.label} ${fmtPctShort(r.pct)}`).join(', ')}.`;
  // A donut shows parts of one whole: only for single answers, and only
  // while there are few enough slices to tell apart.
  const donutOk = !s.multi && rows.length <= 6 && rows.length > 1;
  // Columns: labels go under each column, unreadable past about a dozen.
  const columnOk = rows.length <= 12;
  const kind = (view === 'donut' && !donutOk) || (view === 'column' && !columnOk) ? 'bar' : view || 'bar';
  let chart;
  if (!answered) chart = noAnswers();
  else if (kind === 'column') chart = columnChart(rows.map((r) => ({ label: r.label, value: r.pct, tip: `${r.label}: ${fmtPctShort(r.pct)} (${fmtNum(r.count)})` })), { label, fmt: fmtPctShort });
  else if (kind === 'donut') chart = donutChart(rows, { label, centerTop: fmtNum(answered), centerBottom: 'answered' });
  else chart = hbarChart(rows, { label });

  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Chart type' });
  for (const [id, text, ic] of [['bar', 'Bars', 'chartBar'], ['column', 'Columns', 'chartColumn'], ['donut', 'Donut', 'chartPie']]) {
    if ((id === 'donut' && !donutOk) || (id === 'column' && !columnOk)) continue;
    seg.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(kind === id), 'aria-label': text, title: text, onclick: () => onView(id) }, icon(ic, { size: 14 })));
  }

  const otherBtn = s.otherTexts.length
    ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => textListDialog(`${q.title || 'Question'}: ${(q.other && q.other.label) || 'Other'}`, s.otherTexts) }, icon('comment', { size: 14 }), `View ${plural(s.otherTexts.length, 'typed answer')}`)
    : null;
  return {
    tools: answered ? seg : null,
    body: [
      chart,
      answered
        ? table(['Answer choice', 'Responses', 'Count'], rows.map((r) => [r.label, fmtPctShort(r.pct), fmtNum(r.count)]), { caption: q.title })
        : null,
      s.multi && answered ? h('p', { class: 'an-note' }, 'People could pick more than one answer, so the percentages add up to more than 100%.') : null,
      otherBtn,
    ],
  };
}

/** How many answers a summary left out for being outside the scale. */
function outOfScaleNote(s, scale) {
  if (!s.outOfScale) return null;
  return h('p', { class: 'an-note' }, `${plural(s.outOfScale, 'answer')} outside the current scale (${scale}), given before the question changed, ${s.outOfScale === 1 ? 'is' : 'are'} not included.`);
}

function ratingBody(q, s) {
  if (!s.answered) return { body: noAnswers() };
  const rows = s.rows.slice().reverse().map((r) => ({ ...r, label: `${r.label} of ${s.max}` }));
  return {
    body: [
      statTiles([['Average rating', `${fmtStat(s.avg)} of ${s.max}`, null]]),
      hbarChart(rows, { label: `Rating distribution. Average ${fmtStat(s.avg)} of ${s.max}.` }),
      table(['Rating', 'Responses', 'Count'], rows.map((r) => [r.label, fmtPctShort(r.pct), fmtNum(r.count)]), { caption: q.title }),
      outOfScaleNote(s, `1 to ${s.max}`),
    ],
  };
}

function npsBody(q, s) {
  if (!s.answered) return { body: noAnswers() };
  const parts = [
    { label: 'Detractors (0 to 6)', count: s.detractors, color: 'var(--danger)' },
    { label: 'Passives (7 to 8)', count: s.passives, color: 'var(--text-3)' },
    { label: 'Promoters (9 to 10)', count: s.promoters, color: 'var(--success)' },
  ];
  // No score when no answer is on the 0 to 10 scale (all given before the
  // question changed).
  const score = s.score == null ? '-' : s.score > 0 ? `+${s.score}` : String(s.score);
  return {
    body: [
      statTiles([
        ['Recommendation score', score, 'from -100 to +100'],
        ['Promoters', fmtNum(s.promoters), null],
        ['Passives', fmtNum(s.passives), null],
        ['Detractors', fmtNum(s.detractors), null],
      ]),
      segmentBar(parts, { label: `${s.score == null ? 'No recommendation score: no answers on the 0 to 10 scale' : `Recommendation score ${score}`}. ${parts.map((p) => `${p.label}: ${p.count}`).join(', ')}.` }),
      columnChart(s.rows.map((r) => ({ label: r.label, value: r.count, tip: `${r.label}: ${fmtNum(r.count)} (${fmtPctShort(r.pct)})` })), { label: 'Answers from 0 to 10.', height: 110 }),
      table(['Score', 'Responses', 'Count'], s.rows.map((r) => [r.label, fmtPctShort(r.pct), fmtNum(r.count)]), { caption: q.title }),
      h('p', { class: 'an-note' }, 'The score is the share of promoters minus the share of detractors.'),
      outOfScaleNote(s, '0 to 10'),
    ],
  };
}

function sliderBody(q, s) {
  if (!s.answered) return { body: noAnswers() };
  const fmtEdge = (v) => String(Number(v.toFixed(2)));
  const { step } = sliderBounds(q);
  // A range holds its start but not its end (the last holds both), so
  // "0 to 10" then "10 to 20" would read as overlapping: name the last
  // value a range can hold when it falls on the slider's steps.
  const range = (b, i) => {
    if (b.from === b.to) return fmtEdge(b.from);
    if (i === s.bins.length - 1) return `${fmtEdge(b.from)} to ${fmtEdge(b.to)}`;
    const onSteps = Number.isInteger(Number(((b.to - b.from) / step).toFixed(9))) && Number.isInteger(Number(((b.from - sliderBounds(q).min) / step).toFixed(9)));
    if (!onSteps) return `${fmtEdge(b.from)} to under ${fmtEdge(b.to)}`;
    const last = b.to - step;
    return fmtEdge(last) === fmtEdge(b.from) ? fmtEdge(b.from) : `${fmtEdge(b.from)} to ${fmtEdge(last)}`;
  };
  return {
    body: [
      statTiles([
        ['Average', fmtStat(s.mean), null],
        ['Median', fmtStat(s.median), null],
        ['Lowest', fmtStat(s.min), null],
        ['Highest', fmtStat(s.max), null],
      ]),
      columnChart(s.bins.map((b, i) => ({ label: range(b, i), value: b.count })), {
        label: `Distribution of answers. Average ${fmtStat(s.mean)}.`,
        height: 110,
        capLimit: 10,
      }),
      table([s.bins.every((b) => b.from === b.to) ? 'Answer' : 'Range', 'Count'], s.bins.map((b, i) => [range(b, i), fmtNum(b.count)]), { caption: q.title }),
      outOfScaleNote(s, `${fmtEdge(sliderBounds(q).min)} to ${fmtEdge(sliderBounds(q).max)}`),
    ],
  };
}

function matrixBody(q, s) {
  if (!s.answered) return { body: noAnswers() };
  const head = ['', ...s.columns.map((c) => c.label), 'Answered', 'Weighted average'];
  return {
    body: [
      stackedRows(s.rows, s.columns, { label: `Grid results for ${q.title || 'this question'}, one bar per row.` }),
      table(
        head,
        s.rows.map((r) => [
          r.label,
          ...r.cells.map((c) => (r.answered ? `${fmtPctShort(c.pct)} (${fmtNum(c.count)})` : '-')),
          fmtNum(r.answered),
          r.weightedAvg == null ? '-' : r.weightedAvg.toFixed(2),
        ]),
        { caption: q.title },
      ),
      h('p', { class: 'an-note' }, `Weighted average uses column weights ${s.columns.filter((c) => c.weight != null).map((c) => c.weight).join(', ')} (left to right)${s.columns.some((c) => c.weight == null) ? '; answers in removed columns are counted but not weighted' : ''}.`),
    ],
  };
}

function rankingBody(q, s) {
  if (!s.answered) return { body: noAnswers() };
  const maxScore = Math.max(...s.items.map((i) => i.score || 0), 1);
  return {
    body: [
      h(
        'div',
        { class: 'an-hbars', role: 'img', 'aria-label': `Ranking results, best first: ${s.items.map((i) => i.label).join(', ')}.` },
        s.items.map((i, k) =>
          h(
            'div',
            { class: 'an-hbar', 'data-tip': `${i.label}: score ${fmtStat(i.score)}` },
            h('span', { class: `an-hbar-label${i.removed ? ' faint' : ''}`, 'aria-hidden': 'true' }, `${k + 1}. ${i.label}`),
            h('span', { class: 'an-hbar-track', 'aria-hidden': 'true' }, h('span', { class: 'an-hbar-fill', style: { width: `${((i.score || 0) / maxScore) * 100}%` } })),
            h('span', { class: 'an-hbar-value', 'aria-hidden': 'true' }, fmtStat(i.score)),
          ),
        ),
      ),
      table(['Item', 'Average position', 'Score'], s.items.map((i) => [i.label, i.avgRank == null ? '-' : i.avgRank.toFixed(2), i.score == null ? '-' : i.score.toFixed(2)]), { caption: q.title }),
      h('p', { class: 'an-note' }, 'Score: first place earns the most points and last place earns one, averaged over everyone who ranked. Higher is better.'),
    ],
  };
}

/** Text as frequent words count it: "Staff's" is the word "staffs". */
const wordForm = (t) => String(t).toLowerCase().normalize('NFKC').replace(/'/g, '');

// Search text and page of each question's answer list, so a redraw (new
// responses arriving) does not throw away what the reader was doing.
const listStates = new Map();

/** A searchable, paged list of typed answers. */
function textList(entries, { render, search, words = [], key = '' }) {
  const host = h('div', { class: 'an-texts' });
  const saved = (key && listStates.get(key)) || {};
  let query = saved.query || '';
  let page = saved.page || 0;
  // data-an-key lets the results screen give focus back after a redraw.
  const input = h('input', { class: 'input input-sm', type: 'search', placeholder: 'Search answers', 'aria-label': 'Search answers', value: saved.typed ?? query, 'data-an-key': key && `search:${key}` });
  const list = h('div');
  const status = h('p', { class: 'faint an-note', 'aria-live': 'polite' });
  const pager = h('div', { class: 'an-pager' });
  // A frequent word picked from its button matches that whole word, as it
  // was counted; typed text matches anywhere.
  let wholeWord = !!saved.wholeWord;
  const draw = () => {
    if (key) listStates.set(key, { query, page, wholeWord, typed: input.value });
    const q = wordForm(query);
    const re = wholeWord && q ? new RegExp(`(^|[^\\p{L}\\p{N}])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u') : null;
    const items = q ? entries.filter((e) => (re ? re.test(wordForm(search(e))) : wordForm(search(e)).includes(q))) : entries;
    const pages = Math.max(1, Math.ceil(items.length / PAGE));
    page = Math.min(page, pages - 1);
    const slice = items.slice(page * PAGE, page * PAGE + PAGE);
    replace(list, slice.length ? h('ul', { class: 'an-text-list' }, slice.map((e) => h('li', null, render(e), h('span', { class: 'faint an-text-date' }, fmtDateTime(e.at))))) : h('p', { class: 'faint an-none' }, 'No matching answers.'));
    status.textContent = items.length ? `Showing ${page * PAGE + 1} to ${page * PAGE + slice.length} of ${fmtNum(items.length)}` : '';
    replace(
      pager,
      pages > 1
        ? [
            h('button', { type: 'button', class: 'btn btn-sm', disabled: page === 0, 'data-pg': 'newer', 'data-an-key': key && `newer:${key}`, onclick: () => turn(-1, 'newer') }, icon('chevLeft', { size: 14 }), 'Newer'),
            h('span', { class: 'faint' }, `Page ${page + 1} of ${pages}`),
            h('button', { type: 'button', class: 'btn btn-sm', disabled: page >= pages - 1, 'data-pg': 'older', 'data-an-key': key && `older:${key}`, onclick: () => turn(1, 'older') }, 'Older', icon('chevRight', { size: 14 })),
          ]
        : null,
    );
  };
  // Paging redraws the pager: stay on the button used, or the other one
  // once the first or last page is reached.
  const turn = (delta, which) => {
    page += delta;
    draw();
    const btn = pager.querySelector(`[data-pg="${which}"]`);
    (btn && !btn.disabled ? btn : pager.querySelector('button:not(:disabled)'))?.focus();
  };
  // Kept on every key, ahead of the debounced filtering.
  input.addEventListener('input', () => key && listStates.set(key, { ...listStates.get(key), typed: input.value }));
  input.addEventListener('input', debounce(() => ((query = input.value.trim()), (wholeWord = false), (page = 0), draw()), 150));
  // Not host.append, which would write each skipped part as "null".
  append(host, [
    words.length
      ? h('div', { class: 'an-words' }, h('span', { class: 'faint' }, 'Frequent words:'),
          words.map((w) => h('button', { type: 'button', class: 'an-word', onclick: () => ((input.value = w.word), (query = w.word), (wholeWord = true), (page = 0), draw()), 'aria-label': `Search for ${w.word}, used in ${w.count} answers` }, w.word, h('span', { class: 'faint' }, String(w.count)))))
      : null,
    // Shown whenever word buttons are, since they fill it in: it is also
    // how to clear what they picked.
    entries.length > PAGE || words.length ? input : null,
    list,
    h('div', { class: 'an-list-foot' }, status, pager),
  ]);
  draw();
  return host;
}

function textBody(q, s) {
  if (!s.answered) return { body: noAnswers() };
  return {
    body: textList(s.entries, {
      render: (e) => h('span', { class: 'an-text' }, q.type === 'datetime' ? answerText(q, e.text) : e.text),
      // Dates are found by what is shown ("Mar 18, 2026") as well as stored.
      search: (e) => (q.type === 'datetime' ? `${answerText(q, e.text)} ${e.text}` : e.text),
      words: s.words,
      key: q.id,
    }),
  };
}

function fieldsBody(q, s) {
  if (!s.answered) return { body: noAnswers() };
  return {
    body: textList(s.entries, {
      render: (e) =>
        h('dl', { class: 'an-fields' }, s.fields.filter((f) => e.values[f.id]).map((f) => h('div', null, h('dt', null, f.label), h('dd', null, e.values[f.id])))),
      search: (e) => Object.values(e.values).join(' '),
      key: q.id,
    }),
  };
}

export function textListDialog(title, entries) {
  openDialog({
    title,
    wide: true,
    build: () => textList(entries, { render: (e) => h('span', { class: 'an-text' }, e.text), search: (e) => e.text }),
  });
}

const BODIES = { choice: choiceBody, rating: ratingBody, nps: npsBody, numeric: sliderBody, matrix: matrixBody, ranking: rankingBody, text: textBody, fields: fieldsBody };

/**
 * All question cards. `views` remembers each choice question's chart type
 * across re-renders (filters change, new responses arrive).
 */
// What a card says when no response answered it: with filters on, that is
// about the filters, not the survey. Set for each render.
let noneText = 'No answers yet.';
const noAnswers = () => h('p', { class: 'faint an-none' }, noneText);

export function renderSummaries(host, { survey, summary, views, filtered = false }) {
  noneText = filtered ? 'No answers match the filters.' : 'No answers yet.';
  const nums = questionNumbers(survey);
  const cards = [];
  for (const q of allQuestions(survey)) {
    if (!isAnswerable(q)) continue;
    const s = summary.questions[q.id];
    if (!s) continue;
    const card = h('section', { class: 'an-card an-q', 'aria-labelledby': `aq-${q.id}` });
    const draw = () => {
      const fn = BODIES[s.kind];
      const { tools = null, body } = fn(q, s, views.get(q.id), (v) => {
        views.set(q.id, v);
        draw();
        card.querySelector('.seg [aria-checked="true"]')?.focus();
      });
      replace(
        card,
        h(
          'header',
          { class: 'an-q-head' },
          h('div', null,
            h('h2', { id: `aq-${q.id}` }, h('span', { class: 'an-qnum' }, `Q${nums[q.id]}`), q.title || 'Untitled question'),
            h('p', { class: 'faint' }, `Answered ${fmtNum(s.answered)}, skipped ${fmtNum(s.skipped)}`)),
          tools,
        ),
        body,
      );
    };
    draw();
    cards.push(card);
  }
  replace(host, cards.length ? cards : h('div', { class: 'empty' }, h('h2', null, 'No questions to summarize'), h('p', null, 'Add questions to the survey to see their results here.')));
}
