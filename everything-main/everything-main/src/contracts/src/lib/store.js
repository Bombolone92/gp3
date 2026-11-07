/**
 * Data layer on top of Puter.
 *
 * Storage design:
 *
 *  KV (small, hot, single-key reads — never kv.list() scans):
 *    cm:settings:v1   { theme, currency, noticeDefault, onboarded, sampleData }
 *
 *  FS (grows with use — one JSON file per collection, docs as real files):
 *    contract-manager/contracts.json          [contract, ...]
 *    contract-manager/contacts.json           [contact, ...]
 *    contract-manager/docs/<contractId>/<file>  uploaded documents
 *
 * Contract metadata (including obligations and document pointers) lives in
 * one file so a boot is exactly three reads; uploaded documents are streamed
 * to the FS and only referenced from the contract.
 */

import { uid } from './util.js';
import {
  todayISO, renewalInfo, isValidISO, daysBetween, addMonths, completedTerms, nextTermEnd,
  agreementEnd, DECISION_KINDS, ENDING_DECISIONS,
} from './dates.js';
import { normalizeCurrency } from './money.js';

const KV_SETTINGS = 'cm:settings:v1';
const DATA_DIR = 'contract-manager';
const CONTRACTS_PATH = `${DATA_DIR}/contracts.json`;
const CONTACTS_PATH = `${DATA_DIR}/contacts.json`;
const docDir = (contractId) => `${DATA_DIR}/docs/${contractId}`;

export const CONTRACT_TYPES = [
  { value: 'service', label: 'Service agreement', icon: 'handshake' },
  { value: 'vendor', label: 'Vendor / supplier', icon: 'package' },
  { value: 'nda', label: 'NDA', icon: 'shield' },
  { value: 'employment', label: 'Employment', icon: 'briefcase' },
  { value: 'lease', label: 'Lease', icon: 'building' },
  { value: 'license', label: 'License / SaaS', icon: 'key' },
  { value: 'other', label: 'Other', icon: 'file-text' },
];

export const CONTRACT_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'terminated', label: 'Terminated' },
];

export const BILLING_PERIODS = [
  { value: 'one-time', label: 'One-time', perYear: 0 },
  { value: 'monthly', label: 'Monthly', perYear: 12 },
  { value: 'quarterly', label: 'Quarterly', perYear: 4 },
  { value: 'annual', label: 'Annual', perYear: 1 },
];

export const OBLIGATION_OWNERS = ['us', 'them', 'mutual'];

/**
 * How often an obligation repeats. Contracts deal in months, so these are all
 * month counts — no weekly cadence, no arbitrary rules.
 */
export const REPEAT_OPTIONS = [
  { value: 'none', label: 'Does not repeat', months: 0 },
  { value: 'monthly', label: 'Monthly', months: 1 },
  { value: 'quarterly', label: 'Quarterly', months: 3 },
  { value: 'annually', label: 'Annually', months: 12 },
];

export function repeatMonths(every) {
  return REPEAT_OPTIONS.find((o) => o.value === every)?.months || 0;
}

export function repeatLabel(every) {
  return REPEAT_OPTIONS.find((o) => o.value === every)?.label.toLowerCase() || '';
}

export function typeInfo(type) {
  return CONTRACT_TYPES.find((t) => t.value === type) || CONTRACT_TYPES[CONTRACT_TYPES.length - 1];
}

/* ------------------------------------------------------------------ */
/* Pure helpers (exported for tests and views)                         */
/* ------------------------------------------------------------------ */

/** Contract value normalized to a yearly figure; 0 for one-time or unpriced. */
export function annualizedValue(contract) {
  const v = Number(contract.value);
  if (!Number.isFinite(v) || v <= 0) return 0;
  const period = BILLING_PERIODS.find((p) => p.value === contract.billing);
  return v * (period ? period.perYear : 0);
}

/** Case-insensitive search over title, tags, notes, and counterparty name. */
export function searchContracts(contracts, query, contactsById = new Map()) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return contracts;
  return contracts.filter((c) => {
    const contact = contactsById.get(c.contactId);
    const hay = [
      c.title, c.notes,
      ...(c.tags || []),
      contact?.name, contact?.company,
      typeInfo(c.type).label,
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
}

/**
 * Active contracts whose next term end falls within `days`, nearest first.
 * Each entry carries its renewalInfo so views never recompute it.
 */
export function upcomingRenewals(contracts, { days = 90, today = todayISO() } = {}) {
  return contracts
    .map((contract) => ({ contract, info: renewalInfo(contract, today) }))
    .filter(({ info }) => info.date && info.daysLeft !== null
      && info.daysLeft >= 0 && info.daysLeft <= days)
    .sort((a, b) => a.info.daysLeft - b.info.daysLeft);
}

/* ------------------------------------------------------------------ */
/* Recurring obligations                                               */
/* ------------------------------------------------------------------ */

/**
 * A repeating obligation is one record with one live occurrence, not twelve
 * rows: the contract list stays readable and the open-obligation count stays
 * honest. Completed occurrences are kept underneath as history.
 *
 * Every occurrence is measured from the anchor rather than from the previous
 * one, so a month-end schedule (Jan 31 → Feb 28 → Mar 31) never drifts.
 *
 * The invariant that keeps a series consistent:
 *   occurrenceDue(ob.repeat, ob.history.length) === ob.due
 * i.e. the live occurrence is the one right after the completed ones.
 */
export function occurrenceDue(repeat, index) {
  return addMonths(repeat.anchor, repeatMonths(repeat.every) * index);
}

/**
 * The anchor that puts `due` at occurrence number `completed`.
 *
 * Given the schedule the obligation already has, its anchor is kept whenever
 * it still puts `due` where it is. A month-end anchor cannot be rebuilt from
 * a clamped occurrence — Jan 31 became Feb 28 became "the 28th of every month
 * from here on" — so saving an edit to the wording of a rent payment used to
 * walk the rest of its series off the end of the month.
 */
export function repeatAnchor(due, every, completed = 0, existing = null) {
  if (existing?.every === every && isValidISO(existing.anchor)
    && addMonths(existing.anchor, repeatMonths(every) * completed) === due) {
    return existing.anchor;
  }
  return completed > 0 ? addMonths(due, -repeatMonths(every) * completed) : due;
}

/** Whether occurrence `index` (0-based) is still inside the series' end. */
export function withinSeries(repeat, index, contract = null) {
  if (index < 0) return false;
  if (Number.isFinite(repeat.count) && repeat.count !== null && index >= repeat.count) return false;
  const due = occurrenceDue(repeat, index);
  if (repeat.until && due > repeat.until) return false;
  if (repeat.contractEnd && contract) {
    // "When the contract ends" — not "at the next renewal". Measuring against
    // the term end instead closed a monthly invoice series on an auto-renewing
    // contract the moment it reached the renewal date: ticking off that month
    // marked the whole duty done, and the payment nobody was reminded about
    // was the one after it.
    const end = agreementEnd(contract);
    if (end && due > end) return false;
  }
  return true;
}

/** Tick off the live occurrence: record it and schedule the next one. */
export function advanceOccurrence(contract, ob) {
  const history = [...(ob.history || []), { due: ob.due, doneAt: Date.now() }];
  const next = history.length;
  if (!withinSeries(ob.repeat, next, contract)) {
    // The series is finished; the obligation itself is now done.
    return { ...ob, done: true, history };
  }
  return { ...ob, done: false, due: occurrenceDue(ob.repeat, next), history };
}

/**
 * A finished series that an edit has given room again — a bigger count, a
 * later end date, the contract's own end moved out — gets its next
 * occurrence back. Left alone it stayed under Completed with occurrences
 * still to run, and the only way to wake it was to un-tick and re-tick the
 * last one it did.
 */
export function reopenedSeries(contract, ob) {
  if (!ob.done || !ob.repeat) return ob;
  const completed = (ob.history || []).length;
  if (!withinSeries(ob.repeat, completed, contract)) return ob;
  return { ...ob, done: false, due: occurrenceDue(ob.repeat, completed) };
}

/** Un-tick: bring the most recently completed occurrence back to the front. */
export function rewindOccurrence(ob) {
  const history = [...(ob.history || [])];
  const last = history.pop();
  if (!last) return { ...ob, done: false };
  return { ...ob, done: false, due: last.due ?? ob.due, history };
}

/**
 * Every obligation on the active contracts, as { contract, obligation,
 * daysLeft }, most urgent first with undated ones last. `daysLeft` is null
 * when there is no due date.
 *
 * This is the whole list; `dueObligations` is the near-term slice of it that
 * the dashboard and its counters use.
 */
export function allObligations(contracts, { today = todayISO(), includeDone = false } = {}) {
  const out = [];
  for (const contract of contracts) {
    if (contract.status !== 'active') continue;
    for (const ob of contract.obligations || []) {
      if (ob.done && !includeDone) continue;
      out.push({
        contract,
        obligation: ob,
        daysLeft: isValidISO(ob.due) ? daysBetween(today, ob.due) : null,
      });
    }
  }
  return out.sort((a, b) => {
    // Completed items sink; undated ones sit after everything dated.
    if (!!a.obligation.done !== !!b.obligation.done) return a.obligation.done ? 1 : -1;
    if (a.daysLeft === null || b.daysLeft === null) {
      if (a.daysLeft === b.daysLeft) return 0;
      return a.daysLeft === null ? 1 : -1;
    }
    return a.daysLeft - b.daysLeft;
  });
}

/** Open obligations that are overdue or due within `days`, most urgent first. */
export function dueObligations(contracts, { days = 30, today = todayISO() } = {}) {
  return allObligations(contracts, { today })
    .filter(({ daysLeft }) => daysLeft !== null && daysLeft <= days);
}

/**
 * Yearly value grouped by the currency each contract is denominated in:
 * { USD: 84000, EUR: 19200 }. Never a single summed figure — see money.js.
 */
export function annualByCurrency(contracts) {
  const out = {};
  for (const c of contracts) {
    const value = annualizedValue(c);
    if (!value) continue;
    const code = normalizeCurrency(c.currency);
    out[code] = (out[code] || 0) + value;
  }
  return out;
}

/** Dashboard numbers, one pass. */
export function contractStats(contracts, today = todayISO()) {
  const stats = {
    active: 0, expiring60: 0, openObligations: 0, annualByCurrency: {}, expired: 0,
  };
  for (const c of contracts) {
    const info = renewalInfo(c, today);
    if (info.phase === 'expired') stats.expired += 1;
    if (c.status !== 'active') continue;
    // A term running out does not settle what is still owed under it. The
    // Obligations view lists these (it asks only that the contract be active)
    // and the nav badge counts the overdue ones, so the tile sitting next to
    // "Obligations due soon" cannot be the one place they vanish.
    for (const ob of c.obligations || []) if (!ob.done) stats.openObligations += 1;
    if (info.phase === 'expired') continue;
    stats.active += 1;
    const value = annualizedValue(c);
    if (value) {
      const code = normalizeCurrency(c.currency);
      stats.annualByCurrency[code] = (stats.annualByCurrency[code] || 0) + value;
    }
    if (info.daysLeft !== null && info.daysLeft <= 60) stats.expiring60 += 1;
  }
  return stats;
}

/**
 * A contract's id names a folder in the user's cloud (`docs/<id>/`), so it has
 * to be a single safe path segment. `contracts.json` is normally written only
 * by this app, but a restored export is a file the user was handed: an id of
 * `../..` would aim a purge's recursive delete at their whole Puter home.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const safeId = (id) => (SAFE_ID.test(String(id ?? '')) ? String(id) : uid());

/**
 * Document pointers, kept only when they point where this app puts documents.
 * A pointer is a path the app reads, hands to the browser as a download, and —
 * on a permanent delete — removes; one aimed anywhere else in the user's cloud
 * is not a document of this contract, so it is dropped rather than followed.
 *
 * The rest of the record is normalized for the same reason every other stored
 * record is: a mangled `size` or `addedAt` reaches the document row, and a
 * `deletedAt` that is not a timestamp makes the trash unreadable.
 */
function normalizeDocuments(data, contractId) {
  if (!Array.isArray(data)) return [];
  const dir = `${docDir(contractId)}/`;
  const out = [];
  for (const d of data) {
    if (!d || typeof d.path !== 'string' || !d.path.startsWith(dir)) continue;
    const filename = d.path.slice(dir.length);
    if (!filename || filename === '.' || filename === '..' || /[/\\]/.test(filename)) continue;
    const size = Number(d.size);
    out.push({
      id: d.id || uid(),
      name: String(d.name || '').trim() || filename,
      path: d.path,
      size: Number.isFinite(size) && size >= 0 ? Math.round(size) : 0,
      mime: String(d.mime || ''),
      addedAt: Number(d.addedAt) || Date.now(),
      deletedAt: deletedStamp(d.deletedAt),
    });
  }
  return out;
}

function normalizeContract(data) {
  const id = safeId(data.id);
  return {
    id,
    title: String(data.title || '').trim() || 'Untitled contract',
    contactId: data.contactId || null,
    type: CONTRACT_TYPES.some((t) => t.value === data.type) ? data.type : 'other',
    status: CONTRACT_STATUSES.some((s) => s.value === data.status) ? data.status : 'active',
    value: Number.isFinite(Number(data.value)) && data.value !== '' && data.value !== null
      ? Number(data.value) : null,
    // A contract keeps the currency it was written in: a later change to the
    // default must never re-denominate an existing agreement.
    currency: normalizeCurrency(data.currency),
    billing: BILLING_PERIODS.some((b) => b.value === data.billing) ? data.billing : 'one-time',
    startDate: isValidISO(data.startDate) ? data.startDate : null,
    endDate: isValidISO(data.endDate) ? data.endDate : null,
    autoRenew: !!data.autoRenew,
    termMonths: Number.isFinite(Number(data.termMonths)) && Number(data.termMonths) >= 1
      ? Math.round(Number(data.termMonths)) : 12,
    noticeDays: Math.max(0, Number(data.noticeDays) || 0),
    tags: Array.isArray(data.tags) ? data.tags.filter(Boolean).map(String) : [],
    notes: String(data.notes || ''),
    // Obligations were passed through untouched before repeats existed; they
    // are normalized here so old records gain the new fields on first write.
    obligations: Array.isArray(data.obligations)
      ? data.obligations.filter((ob) => ob && String(ob.text || '').trim()).map(normalizeObligation)
      : [],
    documents: normalizeDocuments(data.documents, id),
    decision: normalizeDecision(data.decision),
    termHistory: normalizeTermHistory(data.termHistory),
    createdAt: data.createdAt || Date.now(),
    updatedAt: Date.now(),
    deletedAt: deletedStamp(data.deletedAt),
  };
}

/* ------------------------------------------------------------------ */
/* Renewal decisions and term history                                  */
/* ------------------------------------------------------------------ */

export const TERM_ENDINGS = ['renewed', 'notice-given', 'expired', 'terminated'];

export const TERM_ENDING_LABELS = {
  renewed: 'Renewed',
  'notice-given': 'Notice given',
  expired: 'Ran to the end',
  terminated: 'Terminated',
};

/**
 * The day a closed-out contract actually ended.
 *
 * `endDate` is where the *first* term ended — the anchor every renewal is
 * counted from — so on an auto-renewing contract that rolled for two years
 * before notice was given it is two years out of date. The term history
 * records each term as it closes, and the last of those is the one the
 * contract ended on. Null when nothing is known: an evergreen agreement
 * closed out by hand has no date to give.
 */
export function endedOn(contract) {
  const history = Array.isArray(contract.termHistory) ? contract.termHistory : [];
  const last = history.length ? history[history.length - 1].end : null;
  const end = isValidISO(contract.endDate) ? contract.endDate : null;
  if (isValidISO(last) && (!end || last >= end)) return last;
  return end;
}

function normalizeDecision(data) {
  if (!data || !DECISION_KINDS.includes(data.kind)) return null;
  const decision = {
    kind: data.kind,
    date: isValidISO(data.date) ? data.date : todayISO(),
    note: String(data.note || '').trim().slice(0, 500),
    forTermEnd: isValidISO(data.forTermEnd) ? data.forTermEnd : null,
  };
  // A snooze without a date is not a decision, it is a dismissal.
  if (data.kind === 'snoozed') {
    if (!isValidISO(data.until)) return null;
    decision.until = data.until;
  }
  return decision;
}

function normalizeTermHistory(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter((t) => t && isValidISO(t.end))
    .map((t) => ({
      start: isValidISO(t.start) ? t.start : null,
      end: t.end,
      ended: TERM_ENDINGS.includes(t.ended) ? t.ended : 'expired',
      value: Number.isFinite(Number(t.value)) && t.value !== null ? Number(t.value) : null,
      currency: normalizeCurrency(t.currency),
      note: String(t.note || '').trim().slice(0, 500),
      recordedAt: Number(t.recordedAt) || Date.now(),
    }))
    .sort((a, b) => a.end.localeCompare(b.end))
    .slice(-80);
}

/**
 * What has to change on a contract because time passed: terms that ended get
 * recorded, a contract whose notice was given is closed out on its term end
 * date instead of rolling forward, and a decision whose term is over is
 * cleared so the next term starts clean.
 *
 * Pure, so the whole thing is testable without a clock or a network.
 * Returns null when there is nothing to do.
 */
export function termReconciliation(contract, today = todayISO()) {
  if (contract.status !== 'active') return null;
  const done = completedTerms(contract, today);
  if (!done.length) return null;

  const decision = contract.decision?.kind ? contract.decision : null;
  const history = normalizeTermHistory(contract.termHistory);
  const known = new Set(history.map((t) => t.end));
  const additions = [];
  let endsHere = false;

  for (const term of done) {
    const byDecision = !!decision && decision.forTermEnd === term.end
      && ENDING_DECISIONS.includes(decision.kind);
    if (byDecision) endsHere = true;
    if (!known.has(term.end)) {
      additions.push({
        start: term.start,
        end: term.end,
        ended: byDecision
          ? (decision.kind === 'notice-given' ? 'notice-given' : 'expired')
          : (contract.autoRenew ? 'renewed' : 'expired'),
        value: contract.value,
        currency: contract.currency,
        note: byDecision ? decision.note || '' : '',
        recordedAt: Date.now(),
      });
    }
    if (byDecision) break;
  }

  // A decision goes stale when the contract has moved past the term it was
  // about — not merely because that term is over. A fixed term that lapsed
  // still ends on the same date, so "renewing" or a snooze recorded against it
  // is still the answer to the question on screen; dropping it there would put
  // the contract straight back in the attention list the decision just left.
  const staleDecision = !!decision && !!decision.forTermEnd
    && done.some((t) => t.end === decision.forTermEnd)
    && (endsHere || nextTermEnd(contract, today) !== decision.forTermEnd);
  if (!additions.length && !endsHere && !staleDecision) return null;

  const patch = {};
  if (additions.length) patch.termHistory = [...history, ...additions];
  if (endsHere) patch.status = 'terminated';
  if (staleDecision) patch.decision = null;
  return patch;
}

/** Completed occurrences kept per obligation; the oldest fall off the front. */
const MAX_OCCURRENCE_HISTORY = 120;

function normalizeObligation(data) {
  const due = isValidISO(data.due) ? data.due : null;
  const all = Array.isArray(data.history)
    ? data.history
      .filter((h) => h && (isValidISO(h.due) || Number(h.doneAt)))
      .map((h) => ({ due: isValidISO(h.due) ? h.due : null, doneAt: Number(h.doneAt) || Date.now() }))
    : [];
  const history = all.slice(-MAX_OCCURRENCE_HISTORY);
  const repeat = normalizeRepeat(data.repeat, due);

  /*
   * An occurrence's number in the series is its position in the history, so
   * dropping the oldest completions walks the whole series backwards by as
   * many places — which exactly cancelled out the step forward. Past 120 ticks
   * a monthly duty stopped moving: every tick recorded another completion
   * against the same date, for good.
   *
   * Re-anchoring on what survived keeps the invariant this all rests on,
   * occurrenceDue(repeat, history.length) === due. The live occurrence is the
   * one after the completed ones, except on a finished series, where `due` is
   * the last one completed.
   */
  if (repeat && due && all.length > history.length) {
    const liveIndex = data.done && history.length ? history.length - 1 : history.length;
    repeat.anchor = repeatAnchor(due, repeat.every, liveIndex);
  }

  return {
    id: data.id || uid(),
    text: String(data.text || '').trim().slice(0, 200),
    owner: OBLIGATION_OWNERS.includes(data.owner) ? data.owner : 'us',
    due,
    done: !!data.done,
    repeat,
    history,
    createdAt: data.createdAt || Date.now(),
  };
}

/**
 * A repeat needs a cadence and a first date to count from; without either it
 * is not a schedule, so it is dropped rather than half-kept. Exactly one end
 * condition survives — a date, a number of occurrences, or the contract's own
 * end — because two would contradict each other.
 */
function normalizeRepeat(data, due) {
  if (!data) return null;
  const every = REPEAT_OPTIONS.find((o) => o.value === data.every && o.months > 0)?.value;
  if (!every) return null;
  const anchor = isValidISO(data.anchor) ? data.anchor : due;
  if (!anchor) return null;
  const repeat = { every, anchor, until: null, count: null, contractEnd: false };
  const count = Number(data.count);
  if (isValidISO(data.until)) repeat.until = data.until;
  else if (Number.isFinite(count) && count >= 1) repeat.count = Math.min(240, Math.round(count));
  else if (data.contractEnd) repeat.contractEnd = true;
  return repeat;
}

function normalizeContact(data) {
  return {
    id: data.id || uid(),
    name: String(data.name || '').trim() || 'Unnamed contact',
    company: String(data.company || '').trim(),
    role: String(data.role || '').trim(),
    email: String(data.email || '').trim(),
    phone: String(data.phone || '').trim(),
    notes: String(data.notes || ''),
    createdAt: data.createdAt || Date.now(),
    updatedAt: Date.now(),
    deletedAt: deletedStamp(data.deletedAt),
  };
}

/* ------------------------------------------------------------------ */
/* Soft deletion                                                       */
/* ------------------------------------------------------------------ */

/** Days a deleted record waits in the trash before it is really gone. */
export const TRASH_DAYS = 30;

function deletedStamp(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const isLive = (record) => !record.deletedAt;

/** Documents still attached to a contract — the deleted ones sit in the trash. */
export function liveDocuments(contract) {
  return (contract?.documents || []).filter(isLive);
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

const DEFAULT_SETTINGS = {
  theme: 'system',
  currency: 'USD',
  noticeDefault: 30,
  onboarded: false,
  sampleData: false,
  // Standing permission to send the pages of a text-less scan to the AI, so
  // the question is asked once rather than per document. Withdrawable in
  // Settings, because a consent that cannot be taken back is not one.
  ocrConsent: false,
  // Optional single-figure reporting: a currency plus hand-entered rates
  // ({ EUR: { rate: 1.08, at: '2026-08-06' } }, read as 1 EUR = 1.08 <code>).
  reportingCurrency: null,
  rates: {},
  // Published calendar feed, when the user has asked for one:
  // { subdomain, url, createdAt }.
  feed: null,
};

/**
 * Settings arrive from KV or from a restored export, so they are as
 * untrustworthy as any other stored record. The currency code in particular
 * reaches Intl.NumberFormat, which throws on anything that is not one.
 */
function normalizeSettings(data) {
  const settings = { ...DEFAULT_SETTINGS, ...(data || {}) };
  settings.currency = normalizeCurrency(settings.currency);
  settings.reportingCurrency = normalizeCurrency(settings.reportingCurrency, '') || null;
  return settings;
}

/** fs rejections for missing paths, as opposed to transport failures. */
export function isMissingFileError(err) {
  const code = err?.code ?? err?.error?.code;
  if (typeof code === 'string' && /does_not_exist|not_found/.test(code)) return true;
  const msg = String(err?.message ?? err?.error?.message ?? '');
  return /no such file|not found|does not exist/i.test(msg);
}

async function readJSON(path, fallback) {
  try {
    const blob = await puter.fs.read(path);
    const text = await blob.text();
    return text.trim() ? JSON.parse(text) : fallback;
  } catch (err) {
    if (isMissingFileError(err)) return fallback;
    throw err;
  }
}

export class Store extends EventTarget {
  settings = { ...DEFAULT_SETTINGS };
  user = null;

  /*
   * Every record ever written, deleted ones included. The getters below are
   * the only door the rest of the app uses, so no read path — search, stats,
   * renewals, obligations, contact links — has to remember to exclude the
   * trash. The live lists are cached so a render pass that reads
   * store.contracts five times gets the same array five times.
   */
  #contracts = [];
  #contacts = [];
  #liveContractCache = null;
  #liveContactCache = null;

  /* Writes to one file must not interleave: chain them. */
  #writeQueues = new Map();

  get contracts() {
    return (this.#liveContractCache ??= this.#contracts.filter(isLive));
  }

  get contacts() {
    return (this.#liveContactCache ??= this.#contacts.filter(isLive));
  }

  #setContracts(list) {
    this.#contracts = list;
    this.#liveContractCache = null;
  }

  #setContacts(list) {
    this.#contacts = list;
    this.#liveContactCache = null;
  }

  async init() {
    const [settings, contractList, contactList, user] = await Promise.all([
      puter.kv.get(KV_SETTINGS),
      readJSON(CONTRACTS_PATH, []),
      readJSON(CONTACTS_PATH, []),
      Promise.resolve(puter.auth.getUser()).catch(() => null),
    ]);
    this.settings = normalizeSettings(settings);
    this.#setContracts(Array.isArray(contractList) ? contractList : []);
    this.#setContacts(Array.isArray(contactList) ? contactList : []);
    this.user = user;
    // Boot doesn't wait on housekeeping, and a failure here is not the user's
    // problem: the work simply happens on the next boot instead.
    this.purgeExpiredTrash().catch(() => {});
    this.reconcileTerms().catch(() => {});
  }

  #emit() {
    this.dispatchEvent(new Event('change'));
  }

  #enqueue(path, task) {
    const prev = this.#writeQueues.get(path) || Promise.resolve();
    const next = prev.catch(() => {}).then(task);
    this.#writeQueues.set(path, next);
    return next;
  }

  /**
   * Writes are queued per file, and each one serializes the list as it stands
   * when its turn comes — not as it stood when it was queued. Two edits can be
   * in flight at once (a ticked checkbox, then a saved form), and if the first
   * fails it is rolled back in memory: a snapshot taken at queue time would
   * carry that rolled-back edit into the file the second write lands, leaving
   * storage holding a change the app had already taken back and the user had
   * already been told did not save.
   */
  #persist(path, read) {
    return this.#enqueue(path, () =>
      puter.fs.write(path, JSON.stringify(read()), { createMissingParents: true }));
  }

  /* Deleted records are part of the file: the trash outlives a reload. */
  #saveContracts() {
    return this.#persist(CONTRACTS_PATH, () => this.#contracts);
  }

  #saveContacts() {
    return this.#persist(CONTACTS_PATH, () => this.#contacts);
  }

  /*
   * All writes are optimistic: memory changes and the UI updates first, then
   * the write is awaited. When it fails, the change is rolled back (narrowly,
   * so concurrent edits to other records survive) and the error rethrown —
   * otherwise "Could not save" would leave phantom state behind the form and
   * a retry would duplicate the record.
   */

  async updateSettings(patch) {
    const prev = this.settings;
    const next = { ...this.settings, ...patch };
    this.settings = next;
    this.#emit();
    try {
      await puter.kv.set(KV_SETTINGS, this.settings);
    } catch (err) {
      if (this.settings === next) {
        this.settings = prev;
        this.#emit();
      }
      throw err;
    }
  }

  /* --- contracts --- */

  contractById(id) {
    return this.contracts.find((c) => c.id === id) || null;
  }

  async addContract(data) {
    const contract = normalizeContract(data);
    this.#setContracts([contract, ...this.#contracts]);
    this.#emit();
    try {
      await this.#saveContracts();
    } catch (err) {
      this.#setContracts(this.#contracts.filter((c) => c !== contract));
      this.#emit();
      throw err;
    }
    return contract;
  }

  async updateContract(id, patch) {
    const existing = this.contractById(id);
    if (!existing) throw new Error(`No contract ${id}`);
    const updated = normalizeContract({ ...existing, ...patch, id, createdAt: existing.createdAt });
    this.#setContracts(this.#contracts.map((c) => (c === existing ? updated : c)));
    this.#emit();
    try {
      await this.#saveContracts();
    } catch (err) {
      // Restore only if no newer update replaced it meanwhile.
      this.#setContracts(this.#contracts.map((c) => (c === updated ? existing : c)));
      this.#emit();
      throw err;
    }
    return updated;
  }

  /**
   * Deleting a contract moves it to the trash: it leaves every list, count
   * and query at once, but its documents stay in Puter FS so a restore brings
   * the signed agreement back with it.
   */
  deleteContract(id) {
    return this.#setContractDeleted(id, Date.now());
  }

  restoreContract(id) {
    return this.#setContractDeleted(id, null);
  }

  async #setContractDeleted(id, deletedAt) {
    const existing = this.#contracts.find((c) => c.id === id);
    if (!existing || !!existing.deletedAt === !!deletedAt) return null;
    const next = { ...existing, deletedAt, updatedAt: Date.now() };
    this.#setContracts(this.#contracts.map((c) => (c === existing ? next : c)));
    this.#emit();
    try {
      await this.#saveContracts();
    } catch (err) {
      this.#setContracts(this.#contracts.map((c) => (c === next ? existing : c)));
      this.#emit();
      throw err;
    }
    return next;
  }

  /* --- renewal decisions --- */

  /**
   * Record what the user decided about the renewal in front of them. The
   * decision is keyed to the term end it answers, so it clears the contract
   * from the attention list now and stops applying once that term is over.
   */
  async recordDecision(contractId, { kind, note = '', until = null } = {}) {
    const contract = this.contractById(contractId);
    if (!contract) throw new Error(`No contract ${contractId}`);
    if (!DECISION_KINDS.includes(kind)) throw new Error(`Unknown decision ${kind}`);
    const decision = {
      kind, note, until,
      date: todayISO(),
      forTermEnd: renewalInfo(contract).date,
    };
    // Deciding about a term that is already over closes it out immediately,
    // rather than leaving the contract nagging until the next boot.
    const reconciled = termReconciliation({ ...contract, decision }) || {};
    return this.updateContract(contractId, { decision, ...reconciled });
  }

  clearDecision(contractId) {
    return this.updateContract(contractId, { decision: null });
  }

  /**
   * Housekeeping for terms that ended while the app was closed: record the
   * completed term, close out contracts whose notice was given, and drop
   * decisions whose term is over.
   */
  async reconcileTerms(today = todayISO()) {
    const before = this.#contracts;
    let changed = false;
    const next = before.map((c) => {
      if (c.deletedAt) return c;
      const patch = termReconciliation(c, today);
      if (!patch) return c;
      changed = true;
      return { ...c, ...patch, updatedAt: Date.now() };
    });
    if (!changed) return;
    this.#setContracts(next);
    this.#emit();
    try {
      await this.#saveContracts();
    } catch (err) {
      this.#setContracts(before);
      this.#emit();
      throw err;
    }
  }

  /* --- obligations (stored inline on their contract) --- */

  async addObligations(contractId, list) {
    const contract = this.contractById(contractId);
    if (!contract) throw new Error(`No contract ${contractId}`);
    const cleaned = list
      .filter((ob) => String(ob.text || '').trim())
      .map((ob) => normalizeObligation({ ...ob, id: uid(), done: false, history: [], createdAt: Date.now() }));
    if (!cleaned.length) return [];
    await this.updateContract(contractId, {
      obligations: [...(contract.obligations || []), ...cleaned],
    });
    return cleaned;
  }

  async setObligation(contractId, obligationId, patch) {
    const contract = this.contractById(contractId);
    if (!contract) throw new Error(`No contract ${contractId}`);
    await this.updateContract(contractId, {
      obligations: (contract.obligations || []).map((ob) => {
        if (ob.id !== obligationId) return ob;
        // Ticking a repeating duty completes this occurrence and schedules the
        // next; it does not close the series. Only the checkbox sends a bare
        // { done }, so the edit form's patches still apply literally.
        if (ob.repeat && Object.keys(patch).length === 1 && patch.done !== undefined) {
          return patch.done ? advanceOccurrence(contract, ob) : rewindOccurrence(ob);
        }
        return reopenedSeries(contract, { ...ob, ...patch, id: ob.id });
      }),
    });
  }

  /**
   * Obligations are not kept in the trash — they are small and always live on
   * a contract — so the deletion returns what it removed and where from,
   * which is everything an undo needs.
   */
  async deleteObligation(contractId, obligationId) {
    const contract = this.contractById(contractId);
    if (!contract) return null;
    const list = contract.obligations || [];
    const index = list.findIndex((ob) => ob.id === obligationId);
    if (index === -1) return null;
    const obligation = list[index];
    await this.updateContract(contractId, {
      obligations: list.filter((ob) => ob.id !== obligationId),
    });
    return { obligation, index };
  }

  /** Undo a deleted obligation: same record, same place in the list. */
  async restoreObligation(contractId, obligation, index = null) {
    const contract = this.contractById(contractId);
    if (!contract) throw new Error(`No contract ${contractId}`);
    const list = [...(contract.obligations || [])];
    if (list.some((ob) => ob.id === obligation.id)) return;
    const at = index === null ? list.length : Math.min(Math.max(0, index), list.length);
    list.splice(at, 0, obligation);
    await this.updateContract(contractId, { obligations: list });
  }

  /* --- documents --- */

  async attachDocument(contractId, file) {
    if (!this.contractById(contractId)) throw new Error(`No contract ${contractId}`);
    const safeName = file.name.replace(/[/\\]/g, '_');
    const path = `${docDir(contractId)}/${Date.now()}-${safeName}`;
    await puter.fs.write(path, file, { createMissingParents: true });
    // Re-read after the upload: another attach may have landed during the
    // await, and building on the stale snapshot would drop its pointer.
    const contract = this.contractById(contractId);
    if (!contract) {
      // Deleted while uploading; don't leave the file orphaned.
      puter.fs.delete(path).catch(() => {});
      throw new Error(`No contract ${contractId}`);
    }
    const doc = {
      id: uid(), name: safeName, path,
      size: file.size, mime: file.type || '', addedAt: Date.now(), deletedAt: null,
    };
    try {
      await this.updateContract(contractId, {
        documents: [...(contract.documents || []), doc],
      });
    } catch (err) {
      // The pointer was never saved; don't leave the uploaded file orphaned.
      puter.fs.delete(path).catch(() => {});
      throw err;
    }
    return doc;
  }

  async readDocument(doc) {
    return puter.fs.read(doc.path);
  }

  /** To the trash, file included: the only copy of a signed PDF may be here. */
  deleteDocument(contractId, docId) {
    return this.#setDocumentDeleted(contractId, docId, Date.now());
  }

  restoreDocument(contractId, docId) {
    return this.#setDocumentDeleted(contractId, docId, null);
  }

  async #setDocumentDeleted(contractId, docId, deletedAt) {
    const contract = this.contractById(contractId);
    const doc = (contract?.documents || []).find((d) => d.id === docId);
    if (!doc || !!doc.deletedAt === !!deletedAt) return null;
    await this.updateContract(contractId, {
      documents: contract.documents.map((d) => (d.id === docId ? { ...d, deletedAt } : d)),
    });
    return doc;
  }

  /* --- contacts --- */

  contactById(id) {
    return this.contacts.find((c) => c.id === id) || null;
  }

  contactsById() {
    return new Map(this.contacts.map((c) => [c.id, c]));
  }

  contractsForContact(contactId) {
    return this.contracts.filter((c) => c.contactId === contactId);
  }

  async addContact(data) {
    const contact = normalizeContact(data);
    this.#setContacts([contact, ...this.#contacts]);
    this.#emit();
    try {
      await this.#saveContacts();
    } catch (err) {
      this.#setContacts(this.#contacts.filter((c) => c !== contact));
      this.#emit();
      throw err;
    }
    return contact;
  }

  async updateContact(id, patch) {
    const existing = this.contactById(id);
    if (!existing) throw new Error(`No contact ${id}`);
    const updated = normalizeContact({ ...existing, ...patch, id, createdAt: existing.createdAt });
    this.#setContacts(this.#contacts.map((c) => (c === existing ? updated : c)));
    this.#emit();
    try {
      await this.#saveContacts();
    } catch (err) {
      this.#setContacts(this.#contacts.map((c) => (c === updated ? existing : c)));
      this.#emit();
      throw err;
    }
    return updated;
  }

  /**
   * A deleted contact drops out of its contracts' views (contactById stops
   * finding it) but the link itself is left alone, so restoring the contact
   * restores every link too. Only a permanent delete detaches for real.
   */
  deleteContact(id) {
    return this.#setContactDeleted(id, Date.now());
  }

  restoreContact(id) {
    return this.#setContactDeleted(id, null);
  }

  async #setContactDeleted(id, deletedAt) {
    const existing = this.#contacts.find((c) => c.id === id);
    if (!existing || !!existing.deletedAt === !!deletedAt) return null;
    const next = { ...existing, deletedAt, updatedAt: Date.now() };
    this.#setContacts(this.#contacts.map((c) => (c === existing ? next : c)));
    this.#emit();
    try {
      await this.#saveContacts();
    } catch (err) {
      this.#setContacts(this.#contacts.map((c) => (c === next ? existing : c)));
      this.#emit();
      throw err;
    }
    return next;
  }

  /* --- trash --- */

  /**
   * What is in the trash, newest deletion first. Documents are listed only
   * for contracts that are still live: a deleted contract carries its
   * documents with it, and restoring it brings them back.
   */
  trashEntries() {
    const out = [];
    for (const c of this.#contracts) {
      if (c.deletedAt) {
        const docs = (c.documents || []).length;
        out.push({
          kind: 'contract', id: c.id, title: c.title, deletedAt: c.deletedAt,
          detail: docs ? `${docs} document${docs === 1 ? '' : 's'}` : '',
        });
        continue;
      }
      for (const d of c.documents || []) {
        if (!d.deletedAt) continue;
        out.push({
          kind: 'document', id: d.id, contractId: c.id, title: d.name,
          deletedAt: d.deletedAt, detail: c.title,
        });
      }
    }
    for (const c of this.#contacts) {
      if (!c.deletedAt) continue;
      out.push({
        kind: 'contact', id: c.id, title: c.name, deletedAt: c.deletedAt,
        detail: c.company || '',
      });
    }
    return out.sort((a, b) => b.deletedAt - a.deletedAt);
  }

  trashCount() {
    return this.trashEntries().length;
  }

  restoreTrashEntry(entry) {
    if (entry.kind === 'contract') return this.restoreContract(entry.id);
    if (entry.kind === 'contact') return this.restoreContact(entry.id);
    return this.restoreDocument(entry.contractId, entry.id);
  }

  purgeTrashEntry(entry) {
    if (entry.kind === 'contract') {
      const contract = this.#contracts.find((c) => c.id === entry.id);
      return contract ? this.#purge({ contracts: [contract] }) : Promise.resolve();
    }
    if (entry.kind === 'contact') {
      const contact = this.#contacts.find((c) => c.id === entry.id);
      return contact ? this.#purge({ contacts: [contact] }) : Promise.resolve();
    }
    const contract = this.#contracts.find((c) => c.id === entry.contractId);
    const doc = (contract?.documents || []).find((d) => d.id === entry.id);
    return doc ? this.#purge({ documents: [{ contract, doc }] }) : Promise.resolve();
  }

  emptyTrash() {
    return this.#purge(this.#trashed());
  }

  /** Records whose 30 days are up, cleared out at boot. */
  purgeExpiredTrash(now = Date.now()) {
    return this.#purge(this.#trashed(now - TRASH_DAYS * 86400000));
  }

  /** Everything soft-deleted (optionally only what was deleted before `before`). */
  #trashed(before = Infinity) {
    const gone = (r) => r.deletedAt && r.deletedAt < before;
    const documents = [];
    for (const c of this.#contracts) {
      if (c.deletedAt) continue;
      for (const d of c.documents || []) if (gone(d)) documents.push({ contract: c, doc: d });
    }
    return {
      contracts: this.#contracts.filter(gone),
      contacts: this.#contacts.filter(gone),
      documents,
    };
  }

  /**
   * Remove records for good. Pointers are written first and files deleted
   * after: a failed write leaves a restorable record, while a failed file
   * delete leaves only an unreferenced file behind.
   */
  async #purge({ contracts = [], contacts = [], documents = [] }) {
    if (!contracts.length && !contacts.length && !documents.length) return;
    const contractIds = new Set(contracts.map((c) => c.id));
    const contactIds = new Set(contacts.map((c) => c.id));
    const docIds = new Set(documents.map((d) => d.doc.id));

    const contractsBefore = this.#contracts;
    const contactsBefore = this.#contacts;

    let keptContracts = contractsBefore.filter((c) => !contractIds.has(c.id));
    if (docIds.size) {
      keptContracts = keptContracts.map((c) =>
        (c.documents || []).some((d) => docIds.has(d.id))
          ? { ...c, documents: c.documents.filter((d) => !docIds.has(d.id)) }
          : c);
    }
    // A contact removed for good takes its links with it; a trashed one keeps
    // them so a restore can put everything back.
    if (contactIds.size) {
      keptContracts = keptContracts.map((c) =>
        (contactIds.has(c.contactId) ? { ...c, contactId: null, updatedAt: Date.now() } : c));
    }
    const keptContacts = contactsBefore.filter((c) => !contactIds.has(c.id));
    const contractsChanged = keptContracts.length !== contractsBefore.length
      || keptContracts.some((c, i) => c !== contractsBefore[i]);

    this.#setContracts(keptContracts);
    this.#setContacts(keptContacts);
    this.#emit();
    try {
      if (contractsChanged) await this.#saveContracts();
      if (contactIds.size) await this.#saveContacts();
    } catch (err) {
      this.#setContracts(contractsBefore);
      this.#setContacts(contactsBefore);
      this.#emit();
      throw err;
    }
    for (const c of contracts) {
      if ((c.documents || []).length) {
        puter.fs.delete(docDir(c.id), { recursive: true }).catch(() => {});
      }
    }
    for (const { doc } of documents) puter.fs.delete(doc.path).catch(() => {});
  }

  /* --- bulk (sample data, export) --- */

  exportAll() {
    // The feed's URL is the only thing keeping that calendar off the open web,
    // so it is a credential, not a preference. An export is a file people mail
    // to themselves and drop in cloud folders; a copy of the link has no
    // business travelling in it.
    const { feed, ...settings } = this.settings;
    return {
      app: 'contract-manager',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      // The trash is not part of your data: it is on its way out.
      contracts: this.contracts.map((c) => ({ ...c, documents: liveDocuments(c) })),
      contacts: this.contacts,
    };
  }

  /**
   * Replace everything (a restore, or the sample dataset) or add to what is
   * already there (a spreadsheet import). Replace is the only mode that
   * touches settings — an import brings contracts, not preferences.
   */
  async importAll({ settings, contracts, contacts }, { mode = 'replace' } = {}) {
    // A restored file is one the user was handed, and a hand-edited backup can
    // hold a null or a bare string where a record belongs. Normalizing that
    // threw before anything was written, which was safe — but it surfaced as
    // "check your connection", and one bad line kept every good one out.
    const records = (list) => (Array.isArray(list)
      ? list.filter((r) => r && typeof r === 'object' && !Array.isArray(r)) : []);
    // Deliberately not called `newContracts`/`newContacts`: one letter apart
    // is one typo away from writing the wrong list to the wrong file.
    const agreements = records(contracts).map(normalizeContract);
    const people = records(contacts).map(normalizeContact);

    if (mode === 'merge') {
      const agreementsBefore = this.#contracts;
      const peopleBefore = this.#contacts;
      this.#setContracts([...agreements, ...agreementsBefore]);
      this.#setContacts([...people, ...peopleBefore]);
      this.#emit();
      try {
        await Promise.all([this.#saveContracts(), this.#saveContacts()]);
      } catch (err) {
        this.#setContracts(agreementsBefore);
        this.#setContacts(peopleBefore);
        this.#emit();
        throw err;
      }
      await this.reconcileTerms().catch(() => {});
      return { contracts: agreements, contacts: people };
    }

    // A replace is the one write that throws the previous data away, so it
    // rolls back like every other one: a restore that half-failed used to
    // leave the app showing the backup while storage still held the original.
    const settingsBefore = this.settings;
    const agreementsBefore = this.#contracts;
    const peopleBefore = this.#contacts;
    // Whether a feed is published is a fact about this account's storage, not
    // something a backup can restore. Taking the file's would resurrect a URL
    // that no longer resolves, or — the dangerous way round — forget a live
    // one, leaving it serving deadlines with nothing left on screen to revoke
    // it with.
    this.settings = normalizeSettings({ ...settings, feed: settingsBefore.feed });
    this.#setContracts(agreements);
    this.#setContacts(people);
    this.#emit();
    try {
      await Promise.all([
        puter.kv.set(KV_SETTINGS, this.settings),
        this.#saveContracts(),
        this.#saveContacts(),
      ]);
    } catch (err) {
      this.settings = settingsBefore;
      this.#setContracts(agreementsBefore);
      this.#setContacts(peopleBefore);
      this.#emit();
      throw err;
    }
    // Imported contracts can carry terms that ended long ago; record them now
    // rather than leaving the history blank until the next boot.
    await this.reconcileTerms().catch(() => {});
    return { contracts: agreements, contacts: people };
  }
}

export const store = new Store();
