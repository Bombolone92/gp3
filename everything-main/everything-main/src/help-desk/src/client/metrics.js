/**
 * Report metrics, computed from the local copy in one pass over the tickets.
 * Everything here is pure: tickets and options in, numbers out. Days and
 * hours are in the viewer's local time, which is what a team reading a
 * report expects ("Monday" means their Monday).
 */
import { DEFAULT_SLA } from '../shared/rules.js';

const DAY = 86400000;
const UNSOLVED = new Set(['new', 'open', 'pending', 'hold']);
export const BACKLOG_STATUSES = ['new', 'open', 'pending', 'hold'];
export const CHANNELS = ['web', 'portal', 'email', 'phone', 'chat', 'api'];
export const PRIORITY_KEYS = ['urgent', 'high', 'normal', 'low', 'none'];

/** Midnight (local) of the day containing `ts`. */
export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Midnight (local) `n` calendar days after the day of `ts` (DST safe). */
export function addDays(ts, n) {
  const d = new Date(startOfDay(ts));
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** Monday (local) of the week containing `ts`. */
export function startOfWeek(ts) {
  const d = new Date(startOfDay(ts));
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Number of local calendar days in [from, to). */
export function daysBetween(from, to) {
  let n = 0;
  for (let t = startOfDay(from); t < to; t = addDays(t, 1)) n++;
  return n;
}

/**
 * Resolve a range preset to [from, to) in local time. `to` is the start of
 * tomorrow so today is included. The previous period has the same number of
 * days and ends where this one starts.
 */
export function resolveRange(preset, now = Date.now(), custom = {}) {
  const tomorrow = addDays(now, 1);
  let from;
  let to = tomorrow;
  switch (preset) {
    case '7d':
      from = addDays(now, -6);
      break;
    case '90d':
      from = addDays(now, -89);
      break;
    case 'month': {
      const d = new Date(startOfDay(now));
      d.setDate(1);
      from = d.getTime();
      break;
    }
    case 'custom': {
      const a = parseDay(custom.from);
      const b = parseDay(custom.to);
      if (a !== null && b !== null) {
        from = Math.min(a, b);
        to = addDays(Math.max(a, b), 1);
      } else from = addDays(now, -29);
      break;
    }
    default:
      from = addDays(now, -29);
  }
  const days = daysBetween(from, to);
  return { from, to, days, prevFrom: addDays(from, -days), prevTo: from };
}

/** 'YYYY-MM-DD' to local midnight, or null. */
export function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function ratio(a, b) {
  return b > 0 ? a / b : null;
}

/** Whether a ticket counts at all, and passes the report filters. */
export function included(t, filters = {}) {
  if (!t || t.deleted || t.spam || t.mergedInto) return false;
  if (filters.group && (t.group || '') !== filters.group) return false;
  if (filters.agent && (t.assignee || '') !== filters.agent) return false;
  if (filters.channel && t.via !== filters.channel) return false;
  if (filters.priority && (t.priority || 'none') !== filters.priority) return false;
  return true;
}

/** First reply target in ms for a ticket, or null when none applies. */
/**
 * When the first reply clock started: the request, or for a ticket an agent
 * opened with a public message, the customer's answer to it (null when the
 * agent wrote again first). It matches the target shown on the ticket.
 */
function replyClock(t) {
  return t.firstReplyFrom === undefined ? t.createdAt : t.firstReplyFrom;
}

/** The time to a first reply, or null when there was nothing to reply to. */
function firstReplyTime(t) {
  const from = replyClock(t);
  return t.firstReplyAt && from !== null && t.firstReplyAt >= from ? t.firstReplyAt - from : null;
}

/** An agent's message nobody answered: no first reply was ever due. */
function noReplyDue(t) {
  if (t.firstReplyAt) return replyClock(t) === null;
  return !!t.lastAgentReplyAt && !(t.lastCustomerAt > t.lastAgentReplyAt);
}

export function firstReplyTarget(t, sla) {
  const policy = sla || DEFAULT_SLA;
  if (policy.enabled === false) return null;
  const minutes = policy.targets?.[t.priority || 'normal']?.first;
  return minutes ? minutes * 60000 : null;
}

function emptyPeriod() {
  return {
    created: 0,
    solved: 0,
    firstReply: [],
    resolution: [],
    oneTouch: 0,
    oneTouchBase: 0,
    good: 0,
    bad: 0,
    slaMet: 0,
    slaBase: 0,
  };
}

function finishPeriod(p) {
  const rated = p.good + p.bad;
  return {
    created: p.created,
    solved: p.solved,
    medianFirstReply: median(p.firstReply),
    medianResolution: median(p.resolution),
    oneTouchRate: ratio(p.oneTouch, p.oneTouchBase),
    csat: { good: p.good, bad: p.bad, rated, score: ratio(p.good, rated) },
    slaRate: ratio(p.slaMet, p.slaBase),
    slaBase: p.slaBase,
  };
}

function agentRow(uuid) {
  return { uuid, assigned: 0, solved: 0, open: 0, firstReply: [], resolution: [], good: 0, bad: 0 };
}

/**
 * Compute every report number for a range and the period before it.
 * opts: { from, to, prevFrom, prevTo, filters, sla, now }
 */
export function computeReport(tickets, opts) {
  const { from, to, prevFrom, prevTo, filters = {}, sla = null } = opts;
  const cur = emptyPeriod();
  const prev = emptyPeriod();
  const dayCount = daysBetween(from, to);
  const dayIndex = new Map();
  const daily = [];
  for (let i = 0, t = startOfDay(from); i < dayCount; i++, t = addDays(t, 1)) {
    dayIndex.set(dayKey(t), i);
    daily.push({ day: t, created: 0, solved: 0 });
  }
  const weekIndex = new Map();
  const weekly = [];
  for (let w = startOfWeek(from); w < to; w = addDays(w, 7)) {
    weekIndex.set(w, weekly.length);
    weekly.push({ week: w, good: 0, bad: 0 });
  }
  const backlog = Object.fromEntries(BACKLOG_STATUSES.map((s) => [s, 0]));
  const byChannel = {};
  const byPriority = Object.fromEntries(PRIORITY_KEYS.map((p) => [p, 0]));
  const byGroup = {};
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const tags = new Map();
  const agents = new Map();
  const agent = (uuid) => {
    if (!agents.has(uuid)) agents.set(uuid, agentRow(uuid));
    return agents.get(uuid);
  };
  const inCur = (ts) => ts >= from && ts < to;
  const inPrev = (ts) => prevFrom !== undefined && ts >= prevFrom && ts < prevTo;

  for (const t of tickets) {
    if (!included(t, filters)) continue;
    const solvedAt = t.solvedAt && (t.status === 'solved' || t.status === 'closed') ? t.solvedAt : null;
    if (UNSOLVED.has(t.status)) {
      backlog[t.status]++;
      if (t.assignee) agent(t.assignee).open++;
    }
    for (const [period, test, isCur] of [[cur, inCur, true], [prev, inPrev, false]]) {
      if (test(t.createdAt)) {
        period.created++;
        if (firstReplyTime(t) !== null) period.firstReply.push(firstReplyTime(t));
        if (isCur) {
          const di = dayIndex.get(dayKey(t.createdAt));
          if (di !== undefined) daily[di].created++;
          byChannel[t.via] = (byChannel[t.via] || 0) + 1;
          byPriority[t.priority || 'none']++;
          const g = t.group || '';
          byGroup[g] = (byGroup[g] || 0) + 1;
          const d = new Date(t.createdAt);
          heat[(d.getDay() + 6) % 7][d.getHours()]++;
          for (const tag of t.tags || []) tags.set(tag, (tags.get(tag) || 0) + 1);
          if (t.assignee) {
            const a = agent(t.assignee);
            a.assigned++;
            if (firstReplyTime(t) !== null) a.firstReply.push(firstReplyTime(t));
          }
        }
      }
      if (solvedAt && test(solvedAt)) {
        period.solved++;
        period.resolution.push(Math.max(0, solvedAt - t.createdAt));
        if (t.firstReplyAt) {
          period.oneTouchBase++;
          if (!t.lastAgentReplyAt || t.lastAgentReplyAt === t.firstReplyAt) period.oneTouch++;
        }
        const target = noReplyDue(t) ? null : firstReplyTarget(t, sla);
        if (target) {
          period.slaBase++;
          if (firstReplyTime(t) !== null && firstReplyTime(t) <= target) period.slaMet++;
        }
        if (isCur) {
          const di = dayIndex.get(dayKey(solvedAt));
          if (di !== undefined) daily[di].solved++;
          if (t.assignee) {
            const a = agent(t.assignee);
            a.solved++;
            a.resolution.push(Math.max(0, solvedAt - t.createdAt));
          }
        }
      }
      if (t.csat?.at && test(t.csat.at)) {
        const good = t.csat.score === 'good';
        if (good) period.good++;
        else period.bad++;
        if (isCur) {
          const wi = weekIndex.get(startOfWeek(t.csat.at));
          if (wi !== undefined) weekly[wi][good ? 'good' : 'bad']++;
          if (t.assignee) agent(t.assignee)[good ? 'good' : 'bad']++;
        }
      }
    }
  }

  const agentRows = [...agents.values()].map((a) => ({
    uuid: a.uuid,
    assigned: a.assigned,
    solved: a.solved,
    open: a.open,
    medianFirstReply: median(a.firstReply),
    medianResolution: median(a.resolution),
    rated: a.good + a.bad,
    csat: ratio(a.good, a.good + a.bad),
  }));

  return {
    current: { ...finishPeriod(cur), backlog: BACKLOG_STATUSES.reduce((s, k) => s + backlog[k], 0) },
    previous: finishPeriod(prev),
    daily,
    weekly: weekly.map((w) => ({ ...w, rated: w.good + w.bad, score: ratio(w.good, w.good + w.bad) })),
    backlog,
    byChannel,
    byPriority,
    byGroup,
    heat,
    tags: [...tags.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    agents: agentRows,
  };
}

/** Articles by views with their helpful share. */
export function articleStats(articles) {
  return [...articles]
    .filter((a) => a && a.status === 'published')
    .map((a) => ({ id: a.id, title: a.title, views: a.views || 0, up: a.up || 0, down: a.down || 0, helpful: ratio(a.up || 0, (a.up || 0) + (a.down || 0)) }))
    .sort((a, b) => b.views - a.views || (b.up - a.up));
}

/**
 * Change from the previous period. `better` says which direction is good
 * ('up' or 'down'). Returns null when there is nothing to compare with.
 */
export function delta(cur, prev, better = 'up') {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return null;
  const diff = cur - prev;
  const pct = prev !== 0 ? diff / Math.abs(prev) : null;
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const good = dir === 'flat' || !better ? null : dir === better;
  return { diff, pct, dir, good };
}

/** Quote a CSV cell. */
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Text that a spreadsheet would run as a formula is kept as text.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) || s.startsWith("'") ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export const _internal = { DAY };
