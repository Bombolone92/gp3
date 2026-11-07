/**
 * Records: what has been played, how fast, and how long the daily streak is.
 *
 * `mergeStats` is the interesting function. The same account can be played on
 * a phone and a laptop, and neither knows what the other did, so a merge has
 * to be commutative and lossless in the only direction that matters: it takes
 * the better of every field. That means counts can drift high if the two
 * devices overlap on the same game, which is a fair trade against a sync that
 * silently deletes a personal best.
 */

export const STATS_VERSION = 1;

const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'];

const emptyRecord = () => ({
  played: 0,
  solved: 0,
  flawless: 0,
  bestMs: null,
  totalMs: 0,
});

export function emptyStats() {
  const byDifficulty = {};
  for (const id of DIFFICULTIES) byDifficulty[id] = emptyRecord();
  return {
    v: STATS_VERSION,
    byDifficulty,
    daily: { current: 0, best: 0, lastDate: null },
    ts: 0,
  };
}

/** Fill in anything a stored blob is missing, and drop anything unexpected. */
export function normalizeStats(raw) {
  const base = emptyStats();
  if (!raw || typeof raw !== 'object' || raw.v !== STATS_VERSION) return base;

  for (const id of DIFFICULTIES) {
    const record = raw.byDifficulty?.[id];
    if (!record || typeof record !== 'object') continue;
    const target = base.byDifficulty[id];
    target.played = nonNegative(record.played);
    target.solved = nonNegative(record.solved);
    target.flawless = nonNegative(record.flawless);
    target.totalMs = nonNegative(record.totalMs);
    target.bestMs = Number.isFinite(record.bestMs) && record.bestMs > 0 ? record.bestMs : null;
  }
  base.daily.current = nonNegative(raw.daily?.current);
  base.daily.best = nonNegative(raw.daily?.best);
  base.daily.lastDate = typeof raw.daily?.lastDate === 'string' ? raw.daily.lastDate : null;
  base.ts = nonNegative(raw.ts);
  return base;
}

const nonNegative = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

const bestOf = (a, b) => {
  const values = [a, b].filter((v) => Number.isFinite(v) && v > 0);
  return values.length ? Math.min(...values) : null;
};

/**
 * Combine two stats blobs, keeping the better of each field.
 * Commutative, so it does not matter which side is "local".
 */
export function mergeStats(left, right) {
  const a = normalizeStats(left);
  const b = normalizeStats(right);
  const merged = emptyStats();

  for (const id of DIFFICULTIES) {
    merged.byDifficulty[id] = {
      played: Math.max(a.byDifficulty[id].played, b.byDifficulty[id].played),
      solved: Math.max(a.byDifficulty[id].solved, b.byDifficulty[id].solved),
      flawless: Math.max(a.byDifficulty[id].flawless, b.byDifficulty[id].flawless),
      bestMs: bestOf(a.byDifficulty[id].bestMs, b.byDifficulty[id].bestMs),
      totalMs: Math.max(a.byDifficulty[id].totalMs, b.byDifficulty[id].totalMs),
    };
  }

  // The streak belongs to whichever side played the daily more recently; the
  // best-ever is a high-water mark and simply takes the larger.
  const newer = (a.daily.lastDate ?? '') >= (b.daily.lastDate ?? '') ? a : b;
  merged.daily = {
    current: newer.daily.current,
    best: Math.max(a.daily.best, b.daily.best),
    lastDate: newer.daily.lastDate,
  };
  merged.ts = Math.max(a.ts, b.ts);
  return merged;
}

/** Count a game as begun. */
export function recordStart(stats, difficulty, now = Date.now()) {
  const next = normalizeStats(stats);
  if (!next.byDifficulty[difficulty]) return next;
  next.byDifficulty[difficulty].played++;
  next.ts = now;
  return next;
}

/**
 * Count a solved game.
 * @param {object} stats
 * @param {object} result
 * @param {string} result.difficulty
 * @param {number} result.elapsedMs
 * @param {boolean} [result.flawless] Solved with no hints and no flagged mistakes.
 * @param {string|null} [result.dailyDate] ISO date when this was the daily puzzle.
 * @param {number} [now]
 */
export function recordSolved(stats, { difficulty, elapsedMs, flawless = false, dailyDate = null }, now = Date.now()) {
  const next = normalizeStats(stats);
  const record = next.byDifficulty[difficulty];
  if (record) {
    record.solved++;
    record.totalMs += Math.max(0, Math.round(elapsedMs) || 0);
    record.bestMs = bestOf(record.bestMs, Math.round(elapsedMs));
    if (flawless) record.flawless++;
  }
  if (dailyDate) applyDaily(next.daily, dailyDate);
  next.ts = now;
  return next;
}

/**
 * Advance the daily streak for `date`.
 *
 * A streak survives consecutive calendar days and resets on a gap. Solving the
 * same day's puzzle twice must not double-count it, which is why this compares
 * against the stored date rather than just incrementing.
 */
function applyDaily(daily, date) {
  if (daily.lastDate === date) return;
  daily.current = daily.lastDate && isPreviousDay(daily.lastDate, date) ? daily.current + 1 : 1;
  daily.lastDate = date;
  daily.best = Math.max(daily.best, daily.current);
}

/** Whether `earlier` is the calendar day directly before `later`. */
export function isPreviousDay(earlier, later) {
  const a = Date.parse(`${earlier}T00:00:00Z`);
  const b = Date.parse(`${later}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return b - a === 86400000;
}

/**
 * A daily streak goes stale once a day has been missed: the number stored is
 * still the one that was reached, so display asks about `date` rather than
 * assuming today is still part of it.
 */
export function dailyStreakOn(stats, date) {
  const { daily } = normalizeStats(stats);
  if (!daily.lastDate) return 0;
  if (daily.lastDate === date || isPreviousDay(daily.lastDate, date)) return daily.current;
  return 0;
}

/** Every difficulty id the stats cover, in display order. */
export const STAT_DIFFICULTIES = DIFFICULTIES;
