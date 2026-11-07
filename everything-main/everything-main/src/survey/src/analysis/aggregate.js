/**
 * Question summaries: counts, percentages and statistics per question, from
 * a list of responses. Pure functions over plain data, so they run the same
 * on the main thread, in a Web Worker (aggregate.worker.js), and in tests.
 *
 * Percentages are of the people who answered the question, not of everyone
 * who took the survey, which is how readers expect "45% chose B" to read.
 * Answers that point at choices removed since (the survey was edited after
 * responses arrived) are kept and labeled, never silently dropped.
 */
import { OTHER_ID, NONE_ID, isAnswerable, ratingMax, sliderBounds, fieldsOf } from '../shared/runtime.js';
import { choiceLabel, fitsType, hasAnswer, hiddenFieldLabel, pickedIds, REMOVED_CHOICE, REMOVED_ROW } from './answers.js';

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const pct = (n, d) => (d ? (n / d) * 100 : 0);

function answeredOf(q, responses) {
  const out = [];
  for (const r of responses) {
    const v = r.answers ? r.answers[q.id] : undefined;
    // Answers left from before a change of type do not count here.
    if (hasAnswer(v) && fitsType(q, v)) out.push({ r, v });
  }
  return out;
}

/** Choice questions: one row per choice in survey order, then Other, None,
 *  and any removed choices that still have answers. */
function summarizeChoice(q, responses) {
  const got = answeredOf(q, responses);
  const counts = new Map();
  const otherTexts = [];
  for (const { r, v } of got) {
    for (const id of new Set(pickedIds(v))) counts.set(id, (counts.get(id) || 0) + 1);
    if (pickedIds(v).includes(OTHER_ID) && v.t) otherTexts.push({ key: r.key, at: r.at, text: v.t });
  }
  const rows = [];
  const seen = new Set();
  const push = (id, label, extra = {}) => {
    seen.add(id);
    const count = counts.get(id) || 0;
    rows.push({ id, label, count, pct: pct(count, got.length), ...extra });
  };
  for (const c of q.choices || []) {
    if (!(c.label || '').trim() && !counts.get(c.id)) continue;
    push(c.id, c.label || '(blank choice)');
  }
  if ((q.other && q.other.enabled) || counts.get(OTHER_ID)) push(OTHER_ID, choiceLabel(q, OTHER_ID), { other: true });
  if ((q.none && q.none.enabled) || counts.get(NONE_ID)) push(NONE_ID, choiceLabel(q, NONE_ID));
  for (const [id] of counts) if (!seen.has(id)) push(id, REMOVED_CHOICE, { removed: true });
  otherTexts.sort((a, b) => b.at - a.at);
  return { kind: 'choice', multi: q.type === 'multi', answered: got.length, rows, otherTexts };
}

function mean(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

/** The median of numbers sorted ascending: the mean of the middle two
 *  when there is an even count. */
export function median(sorted) {
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarizeRating(q, responses) {
  const max = ratingMax(q);
  const nums = answeredOf(q, responses).map(({ v }) => Number(v)).filter((n) => Number.isFinite(n));
  // Values outside the current scale (it was shortened, or the question
  // was another type) are counted apart: an average of 8 "of 5" means
  // nothing.
  const inScale = nums.filter((n) => Number.isInteger(n) && n >= 1 && n <= max);
  const rows = [];
  for (let i = 1; i <= max; i++) {
    const count = inScale.filter((n) => n === i).length;
    rows.push({ id: String(i), label: String(i), count, pct: pct(count, inScale.length) });
  }
  return { kind: 'rating', answered: nums.length, max, avg: mean(inScale), rows, outOfScale: nums.length - inScale.length };
}

const roundHalfAway = (x) => Math.sign(x) * Math.round(Math.abs(x)) || 0;

/** 0-10 recommendation: promoters answer 9-10, passives 7-8, detractors
 *  0-6; the score is % promoters minus % detractors, from -100 to 100. */
export function npsBreakdown(nums) {
  const n = nums.length;
  const promoters = nums.filter((v) => v >= 9).length;
  const detractors = nums.filter((v) => v <= 6).length;
  const passives = n - promoters - detractors;
  return {
    promoters,
    passives,
    detractors,
    // Halves round away from zero, the same for negative scores as positive.
    score: n ? roundHalfAway(((promoters - detractors) * 100) / n) : null,
  };
}

function summarizeNps(q, responses) {
  const all = answeredOf(q, responses).map(({ v }) => Number(v)).filter((n) => Number.isFinite(n));
  // Only whole numbers 0 to 10 count; others are left from before the
  // question became a 0 to 10 one.
  const nums = all.filter((n) => Number.isInteger(n) && n >= 0 && n <= 10);
  const rows = [];
  for (let i = 0; i <= 10; i++) {
    const count = nums.filter((n) => n === i).length;
    rows.push({ id: String(i), label: String(i), count, pct: pct(count, nums.length) });
  }
  return { kind: 'nps', answered: all.length, avg: mean(nums), rows, ...npsBreakdown(nums), outOfScale: all.length - nums.length };
}

// Rounds away float noise in bin edges (0.1 * 3 = 0.30000000000000004).
const tidy = (n) => Math.round(n * 1e9) / 1e9;

/** One bar per value on a short scale (up to 10 values), else 10 even bins
 *  across the slider's range. */
function summarizeSlider(q, responses) {
  const { min, max, step } = sliderBounds(q);
  const all = answeredOf(q, responses)
    .map(({ v }) => Number(v))
    .filter((n) => Number.isFinite(n));
  // Values outside the current range were given before it changed.
  const nums = all.filter((n) => n >= min && n <= max).sort((a, b) => a - b);
  const span = max - min;
  // The values the slider can take: min, min + step, … up to max.
  const values = Math.floor(tidy(span / step)) + 1;
  // Answers given before the step changed may sit between steps: then
  // ranges, which hold any value.
  const onSteps = nums.every((n) => Number.isInteger(tidy((n - min) / step)));
  let bins;
  let binOf;
  if (values <= 10 && onSteps) {
    bins = Array.from({ length: values }, (_, i) => ({ from: tidy(min + i * step), to: tidy(min + i * step), count: 0 }));
    binOf = (n) => Math.round((n - min) / step);
  } else {
    const width = span / 10;
    bins = Array.from({ length: 10 }, (_, i) => ({ from: tidy(min + i * width), to: tidy(min + (i + 1) * width), count: 0 }));
    binOf = (n) => Math.floor(tidy((n - min) / width));
  }
  for (const n of nums) bins[Math.min(bins.length - 1, Math.max(0, binOf(n)))].count++;
  return {
    kind: 'numeric',
    answered: all.length,
    mean: mean(nums),
    median: median(nums),
    min: nums.length ? nums[0] : null,
    max: nums.length ? nums[nums.length - 1] : null,
    bins,
    outOfScale: all.length - nums.length,
  };
}

/** Grids: per row, the share of that row's answers in each column, and a
 *  weighted average from the column weights (1..n by default). */
function summarizeMatrix(q, responses) {
  const got = answeredOf(q, responses).filter(({ v }) => isObj(v));
  const columns = (q.columns || [])
    .filter((c) => (c.label || '').trim())
    .map((c, i) => ({ id: c.id, label: c.label, weight: Number.isFinite(Number(c.weight)) ? Number(c.weight) : i + 1 }));
  // Columns picked but not listed (removed since, or label cleared): their
  // answers still count, with no weight, as rows do.
  const allCols = new Set((q.columns || []).map((c) => c.id));
  const listedCols = new Set(columns.map((c) => c.id));
  for (const { v } of got) {
    for (const pick of Object.values(v)) {
      for (const c of Array.isArray(pick) ? pick : [pick]) {
        if (typeof c !== 'string' || listedCols.has(c)) continue;
        listedCols.add(c);
        columns.push(allCols.has(c) ? { id: c, label: '(blank column)', weight: null, removed: true } : { id: c, label: REMOVED_CHOICE, weight: null, removed: true });
      }
    }
  }
  const colIndex = new Map(columns.map((c, i) => [c.id, i]));
  const rowDefs = (q.rows || []).filter((r) => (r.label || '').trim()).map((r) => ({ id: r.id, label: r.label }));
  const known = new Set(rowDefs.map((r) => r.id));
  // Rows answered but not listed: removed since, or with their label cleared.
  const blankRows = new Set((q.rows || []).map((r) => r.id));
  for (const { v } of got) {
    for (const rid of Object.keys(v)) {
      if (known.has(rid)) continue;
      known.add(rid);
      rowDefs.push(blankRows.has(rid) ? { id: rid, label: '(blank row)' } : { id: rid, label: REMOVED_ROW, removed: true });
    }
  }
  const rows = rowDefs.map((row) => {
    const counts = columns.map(() => 0);
    let answered = 0;
    let wSum = 0;
    let wN = 0;
    for (const { v } of got) {
      if (!Object.prototype.hasOwnProperty.call(v, row.id)) continue;
      const picks = Array.isArray(v[row.id]) ? v[row.id] : [v[row.id]];
      let any = false;
      for (const c of picks) {
        const i = colIndex.get(c);
        if (i == null) continue;
        counts[i]++;
        if (columns[i].weight != null) {
          wSum += columns[i].weight;
          wN++;
        }
        any = true;
      }
      if (any) answered++;
    }
    return {
      ...row,
      answered,
      cells: counts.map((count) => ({ count, pct: pct(count, answered) })),
      weightedAvg: wN ? wSum / wN : null,
    };
  });
  return { kind: 'matrix', multi: !!q.multi, answered: got.length, columns, rows };
}

/** Ranking: average position (1 = top) and a score where first place earns
 *  n points and last earns 1, averaged; higher is better. Sorted best first. */
function summarizeRanking(q, responses) {
  const got = answeredOf(q, responses).filter(({ v }) => Array.isArray(v));
  const items = new Map();
  for (const c of q.choices || []) if ((c.label || '').trim()) items.set(c.id, { id: c.id, label: c.label, ranks: [] });
  for (const { v } of got) {
    v.forEach((id, i) => {
      if (!items.has(id)) {
        const exists = (q.choices || []).some((c) => c.id === id);
        items.set(id, exists ? { id, label: '(blank choice)', ranks: [] } : { id, label: REMOVED_CHOICE, removed: true, ranks: [] });
      }
      items.get(id).ranks.push({ rank: i + 1, of: v.length });
    });
  }
  const n = items.size;
  const out = [...items.values()].map((it) => {
    const positions = Array.from({ length: n }, () => 0);
    for (const { rank } of it.ranks) if (rank <= n) positions[rank - 1]++;
    return {
      id: it.id,
      label: it.label,
      removed: !!it.removed,
      count: it.ranks.length,
      avgRank: it.ranks.length ? mean(it.ranks.map((x) => x.rank)) : null,
      score: it.ranks.length ? mean(it.ranks.map((x) => x.of - x.rank + 1)) : null,
      positions,
    };
  });
  out.sort((a, b) => (a.avgRank == null) - (b.avgRank == null) || (a.avgRank ?? 0) - (b.avgRank ?? 0));
  return { kind: 'ranking', answered: got.length, items: out };
}

const STOPWORDS = new Set(
  ('a about above after again against all am an and any are as at be because been before being below between both but by ' +
    'can could did do does doing down during each few for from further had has have having he her here hers herself him ' +
    'himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other ' +
    'our ours ourselves out over own same she should so some such than that the their theirs them themselves then there ' +
    'these they this those through to too under until up very was we were what when where which while who whom why will ' +
    'with would you your yours yourself yourselves also im ive dont didnt cant wont its thats really much many get got ' +
    'like one would could make made us please thanks thank')
    .split(' '),
);

/** The most frequent meaningful words across `texts`. */
export function topWords(texts, limit = 12) {
  const counts = new Map();
  for (const t of texts) {
    const seen = new Set();
    for (const raw of String(t).toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}']+/u)) {
      const w = raw.replace(/^'+|'+$/g, '').replace(/'/g, '');
      if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w) || seen.has(w)) continue;
      // Count each word once per response: one long answer should not
      // outweigh many short ones.
      seen.add(w);
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n > 1 || counts.size <= limit)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

function summarizeText(q, responses) {
  const got = answeredOf(q, responses);
  const entries = got
    .map(({ r, v }) => ({ key: r.key, at: r.at, text: String(v) }))
    .sort((a, b) => b.at - a.at);
  const words = q.type === 'text' || q.type === 'textarea' ? topWords(entries.map((e) => e.text)) : [];
  return { kind: 'text', answered: got.length, entries, words };
}

function summarizeFields(q, responses) {
  const got = answeredOf(q, responses).filter(({ v }) => isObj(v));
  const fields = fieldsOf(q).map((f) => ({ id: f.id, label: f.label }));
  // Fields answered but no longer shown (turned off, or removed) still list.
  const listed = new Set(fields.map((f) => f.id));
  for (const { v } of got) {
    for (const [id, text] of Object.entries(v)) {
      if (text && !listed.has(id)) {
        listed.add(id);
        fields.push({ id, label: hiddenFieldLabel(q, id) });
      }
    }
  }
  const entries = got.map(({ r, v }) => ({ key: r.key, at: r.at, values: v })).sort((a, b) => b.at - a.at);
  return { kind: 'fields', answered: got.length, fields, entries };
}

const BY_TYPE = {
  single: summarizeChoice,
  multi: summarizeChoice,
  dropdown: summarizeChoice,
  rating: summarizeRating,
  nps: summarizeNps,
  slider: summarizeSlider,
  matrix: summarizeMatrix,
  ranking: summarizeRanking,
  text: summarizeText,
  textarea: summarizeText,
  datetime: summarizeText,
  multitext: summarizeFields,
  contact: summarizeFields,
};

export function summarizeQuestion(q, responses) {
  const fn = BY_TYPE[q.type];
  if (!fn) return null;
  const s = fn(q, responses);
  s.skipped = responses.length - s.answered;
  return s;
}

/** Summaries for every answerable question, keyed by question id. */
export function summarize(survey, responses) {
  const out = {};
  for (const page of survey.pages || []) {
    for (const q of page.questions || []) {
      if (isAnswerable(q)) out[q.id] = summarizeQuestion(q, responses);
    }
  }
  return { total: responses.length, questions: out };
}

/* ---- Responses over time ---- */

function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Response counts per local day, week, month or year, whichever keeps
 * the series at 60 buckets or fewer. Days with no responses are included as
 * zeros so the gaps show.
 */
export function responsesOverTime(responses, maxBuckets = 60) {
  if (!responses.length) return { unit: 'day', buckets: [] };
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of responses) {
    if (r.at < lo) lo = r.at;
    if (r.at > hi) hi = r.at;
  }
  const first = startOfDay(lo);
  const days = Math.round((startOfDay(hi) - first) / 86_400_000) + 1;
  let unit = 'day';
  if (days > maxBuckets) unit = days / 7 > maxBuckets ? (days / 30.44 > maxBuckets ? 'year' : 'month') : 'week';

  const bucketStart = (t) => {
    const d = new Date(startOfDay(t));
    if (unit === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
    if (unit === 'month') d.setDate(1);
    if (unit === 'year') d.setMonth(0, 1);
    return d.getTime();
  };
  // Steps go by calendar date, from noon: where clocks change at midnight a
  // day starts at 01:00, and adding days to that would drift off the
  // bucket starts. Counts are keyed by calendar day for the same reason.
  const next = (t) => {
    const d = new Date(t);
    if (unit === 'year') return bucketStart(new Date(d.getFullYear() + 1, 0, 1, 12).getTime());
    const step = unit === 'day' ? [0, 1] : unit === 'week' ? [0, 7] : [1, 0];
    return bucketStart(new Date(d.getFullYear(), d.getMonth() + step[0], unit === 'month' ? 1 : d.getDate() + step[1], 12).getTime());
  };
  const counts = new Map();
  for (const r of responses) {
    const k = dayKey(bucketStart(r.at));
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const buckets = [];
  const end = bucketStart(hi);
  for (let t = bucketStart(lo); t <= end; t = next(t)) {
    buckets.push({ start: t, key: dayKey(t), count: counts.get(dayKey(t)) || 0 });
  }
  return { unit, buckets };
}
