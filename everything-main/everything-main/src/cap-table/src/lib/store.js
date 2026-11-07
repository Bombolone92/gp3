/**
 * Data layer on top of Puter KV.
 *
 * A cap table is small, hot data - tens to a few hundred records - so every
 * collection is read by key (never a kv.list() scan). kv.js conditionally
 * publishes immutable revisions behind each key. One account can hold several
 * companies; every company
 * collection is namespaced by its company id, with a registry naming them:
 *
 *   captable:settings:v1               { theme }  (account-wide)
 *   captable:companies:v1              { activeId, companies: [{ id, label,
 *                                        createdAt }] }
 *   captable:<id>:settings:v1          { onboarded, sampleData }
 *   captable:<id>:company:v1           { name, entityType, jurisdiction,
 *                                        currency, incorporated,
 *                                        plans (the equity incentive plans
 *                                        and their dated reserves - see the
 *                                        plans section of lib/captable.js),
 *                                        poolAuthorized, poolHistory (the
 *                                        plans' aggregate, kept for readers
 *                                        written before plans existed),
 *                                        valuations, splits,
 *                                        reporting: { volatility,
 *                                        riskFreeRate, expectedTermYears,
 *                                        attribution, fiscalYearEnd,
 *                                        totalAssets } }
 *   captable:<id>:classes:v1           [{ id, name, kind, authorized, ... }]
 *   captable:<id>:stakeholders:v1      [{ id, name, email, kind, departed?,
 *                                        formerNames? }]
 *   captable:<id>:securities:v1        [ see lib/captable.js header ]
 *   captable:<id>:scenarios:v1         [{ id, name, preMoney, investment }]
 *   captable:<id>:exits:v1             [{ id, name, exitValue }]
 *   captable:<id>:hiring:v1            [{ id, role, headcount, shares|pct,
 *                                        startMonth }] planned grants
 *   captable:<id>:activity:v1          [{ id, at, text, icon }] newest first
 *   captable:<id>:restorePoints:v1     [{ id, at, label, data }] newest first
 *
 * Accounts created before the registry existed hold the same collections at
 * un-namespaced keys (captable:company:v1, ...); the first load migrates
 * them transparently into company #1.
 *
 * Writes are optimistic: state mutates and emits immediately, then persists;
 * a failed write rolls back and rethrows so callers can surface it.
 */

import { AuditJournal, AUDIT_FIELDS, AuditRecoveryError, auditChanges, pruneProvenance } from './audit.js';
import { uid, tidy, todayISO, NUM_MAX } from './util.js';
import { normalizeCurrency } from './format.js';
import { getKV, readKV, compareAndSetKV, deleteKV, KVConflictError, KVReadError } from './kv.js';
import {
  validatePreferred, validateProRata, validateMFN, validateDividendEvents, validateBasis, validateFinancing,
  appendOnly, capTableDigest, transferredEconomics, electMFN, termDate, dividendAccrual, FinancingError,
  ALLOCATION_TOLERANCE, assertUniqueTermIds, originalIssueDate,
} from './financing.js';
import {
  modelRound, topUpReserve, nextLabel, labelSequence, grantOutstanding, grantExercised, grantVested, vestingStartDate,
  rsuOutstanding, rsuSettled, rsuVested, vestedQuantity, exerciseCutoff,
  cancellationHistory, certifiedByGrant, certifiedByRsu, warrantExercised,
  vestingScheduleLimit, vestingCeiling, vestingStopDate, exerciseAheadOfVesting, exerciseRoom, exerciseVestingSchedule, MAX_VESTING_MONTHS,
  STAKEHOLDER_NAME_MAX, CLASS_NAME_MAX, EMAIL_MAX, poolDrawn,
  plansOf, planReserve, scalePlanReserve, planAccepts, planRefusal, resolvePlan, awardPlanId, planBalances, planIsOpen, planCapacityError, reserveShortfall,
  planLastActivity, securityDate, dbAsOf, unsplitFactor, adjustedAfter,
  LEGACY_PLAN_NAME, PLAN_NAME_MAX, PLAN_REASON_MAX, RECYCLING_EVENTS, DEFAULT_RECYCLING,
} from './captable.js';

const GLOBAL_SETTINGS_KEY = 'captable:settings:v1';
const REGISTRY_KEY = 'captable:companies:v1';
// An allocated exercise may need one installment per supported vesting month.
export const MAX_VESTING_TRANCHES = MAX_VESTING_MONTHS;
/* Hires per planned role. The sanitizer held the row to this quietly, so a
   1,200-hire role saved as 500 under a toast saying it was added; the form
   refuses it now. */
export const HIRING_HEADCOUNT_MAX = 500;
export const MAX_STOCK_SPLITS = 40;
/* Pool resizes kept for the as-of view: a round close or a pool edit each
   write one, so this is decades of either. */
export const MAX_POOL_HISTORY = 400;
/* Equity incentive plans one company keeps: a plan a year for a generation. */
export const MAX_PLANS = 40;
/* What a plan's reserve history entry can be about. */
const RESERVE_KINDS = new Set(['adoption', 'resize', 'top-up', 'transfer', 'split', 'retirement']);

/** Finish every write before reporting failure, so a late success cannot
 *  overwrite the rollback or a subsequent commit. */
async function finishWrites(writes) {
  const results = await Promise.allSettled(writes);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
}

/** The per-company collections, as key suffixes. */
const COMPANY_FIELDS = ['company', 'classes', 'stakeholders', 'securities', 'scenarios', 'exits', 'hiring', 'activity', 'restorePoints'];

/** The collections a restore point snapshots - the dataset itself. */
const DATA_FIELDS = ['company', 'classes', 'stakeholders', 'securities', 'scenarios', 'exits', 'hiring', 'activity'];

/** Where each collection lived before companies were namespaced. */
const LEGACY_KEYS = {
  company: 'captable:company:v1',
  classes: 'captable:classes:v1',
  stakeholders: 'captable:stakeholders:v1',
  securities: 'captable:securities:v1',
  scenarios: 'captable:scenarios:v1',
  exits: 'captable:exits:v1',
  activity: 'captable:activity:v1',
};

/**
 * A stored value exists but cannot be read. Distinct from a missing one,
 * which is ordinary: the app must not treat damage as an empty collection
 * and then persist that emptiness over whatever is really there.
 */
export class CorruptDataError extends Error {
  constructor(key) {
    super(`The data stored at ${key} could not be read.`);
    this.name = 'CorruptDataError';
    this.key = key;
  }
}

/**
 * A write would land on a value that has changed since this session last
 * read it - another tab, another device, the same account.
 *
 * Collections are persisted by replacing them whole, so an overwrite is
 * total: a second tab that loaded before the first one's save would put its
 * own stale copy of the list straight over it, both saves reporting success
 * and one of them simply gone. Refusing keeps the confirmed record.
 */
export class StaleWriteError extends Error {
  constructor(key) {
    super('This cap table changed somewhere else, so nothing was saved.');
    this.name = 'StaleWriteError';
    this.key = key;
  }
}

/**
 * A record cannot be added because its list is full.
 *
 * The bounded lists here are sanitized by sorting and slicing, so an addition
 * past the limit dropped whatever now sorted last - a 409A the reports still
 * quote, a planned role the forecast still counts - while the write itself
 * reported success. Refusing says which list is full and leaves the user to
 * decide what comes out of it, the way every other refusal in this file does.
 */
export class ListFullError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ListFullError';
  }
}

/**
 * A write composed against one company arriving after the store has moved to
 * another.
 *
 * Switching moves the pointer that decides which keys every write lands on
 * before the new company's data has been read, and for the length of that
 * read the screen still shows the company being left. A form filled in from
 * what is on screen and saved in that window wrote one company's record into
 * the other's keys - the company being opened took the name of the one being
 * left, and neither was what the user typed against.
 */
export class CompanyChangedError extends Error {
  constructor() {
    super('The open company changed, so nothing was saved.');
    this.name = 'CompanyChangedError';
  }
}

/**
 * Whether an error is the store declining a write - a rule about the records,
 * said in a sentence written for the user - rather than a write that failed
 * to land. A refusal is thrown inside apply(), before anything is persisted,
 * and #commitNow marks it; the typed errors above are refusals by nature.
 *
 * The forms mirror most of the store's rules and point at the field before
 * saving, but not every rule has a mirror, and a refusal that reached a
 * form's catch read as "Couldn't save. Check your connection" - a sentence
 * about the network, over a record the store had declined for a reason it
 * had already put into words. Everything else in a catch really is a failed
 * write: the platform's own error, whose message means nothing to the user.
 */
export function isRefusal(err) {
  return err instanceof ListFullError || err instanceof CompanyChangedError
    || err instanceof StaleWriteError || err?.refused === true;
}

const ACTIVITY_MAX = 60;
export const VALUATIONS_MAX = 40;
/* How many stakeholders and securities one company keeps. The JSON import is
   bounded by bytes, and a minimal record is a few dozen of them, so a 20 MB
   backup brought in 250,000 securities: stored across 140 parts and
   rewritten whole on every later edit, with the securities view rendering
   every row. Past these the app is the wrong tool, and it says so. */
export const MAX_STAKEHOLDERS = 10_000;
export const MAX_SECURITIES = 25_000;
const fmtCount = (n) => n.toLocaleString('en-US');
const roomFor = (what, have, adding, max) => (have + adding > max
  ? `This company would hold ${fmtCount(have + adding)} ${what}, more than the ${fmtCount(max)} it can keep.`
  : null);
/** How many earlier names a stakeholder record keeps. */
const FORMER_NAMES_MAX = 10;
const HIRING_MAX = 100;
/* How many saved round scenarios, and how many saved exits, a company keeps.
   Each is a chip on its strip and a row in the search index, and every one
   of them is rebuilt on each store change while its view is up; a backup
   carrying ten thousand made the round page a half-second render. Only a
   file can bring that many: they are refused at the import, like the record
   ceilings, and the strip refuses a new one past the cap. */
export const SCENARIOS_MAX = 200;
/* What a certificate's financing evidence may hold. The app writes a few
   fields a few levels deep; a file can carry anything, and one nested past
   what the journal's clone can walk blew the stack there - after the import
   had accepted it - and was read as a connection problem. */
const EVIDENCE_DEPTH_MAX = 8;
const EVIDENCE_CHARS_MAX = 50_000;
function boundedEvidence(raw) {
  const depth = (v, d) => {
    if (!v || typeof v !== 'object') return d;
    if (d > EVIDENCE_DEPTH_MAX) return Infinity;
    return Math.max(d, ...Object.values(v).map((x) => depth(x, d + 1)));
  };
  if (depth(raw, 1) > EVIDENCE_DEPTH_MAX) throw new FinancingError('Financing evidence nests too deeply.');
  const text = JSON.stringify(raw);
  if (text.length > EVIDENCE_CHARS_MAX) throw new FinancingError('Financing evidence is too large.');
  return JSON.parse(text);
}

/** How many restore points a company keeps; the oldest drops off. */
const RESTORE_MAX = 5;

/* All five snapshots ride in one logical value - and Puter caps a KV value at
   400 KB, so the set is trimmed oldest-first until it fits under that with
   room to spare, and the newest is always kept. Measured in bytes of the
   UTF-8 the value is sent as, not in string length: a budget of 1.5 MB
   counted in UTF-16 units built a value four times what the platform takes,
   and the write of the snapshot - which every guarded operation makes first
   and refuses to go on without - failed for good once a 100 KB cap table
   had three or four points behind it. Every transfer, departure, split,
   round close and import then died with "check your connection", and the
   retry carried the same payload. */
const RESTORE_BUDGET_BYTES = 350_000;

/** The size of a piece of text as the KV store receives it. */
const textBytes = (text) => new TextEncoder().encode(text).length;

/** The size of a value as the KV store receives it. */
const byteLength = (value) => textBytes(JSON.stringify(value));

/* Puter takes at most 400 KB in one KV value (docs.puter.com/KV/set), and a
   restore point is the one value that carries the whole dataset at once -
   every collection of a cap table whose collections each fit comfortably.
   Trimming the set cannot bring that under the limit, because the set is
   already down to the single snapshot the operation about to run needs, so a
   cap table of a few hundred KB could not be transferred, split, closed,
   imported over, or even wiped: every guarded operation writes its snapshot
   first and will not go on without it. A value over the limit is written
   across numbered part keys with a marker left in its place. Sized with room
   for the marker and for a backend that counts a little differently. */
const KV_VALUE_MAX_BYTES = 380_000;

/** The one directory attachments may live in, in the user's Puter cloud. */
const ATTACHMENT_ROOT = 'captable-attachments';
/** How many files one record carries. */
const ATTACHMENTS_MAX = 20;

/**
 * Why a closed certificate cannot go while the certificates a transfer drew
 * off it stand, and the way through: deleting a leg undoes the transfer (see
 * Store.transferOf), so the message points at the leg rather than at a
 * cleanup that would lose the shares. Shared with the securities list, which
 * says the same before the press.
 */
export function successorsStand(source, legs, { subject = source.label } = {}) {
  const repurchase = source.closedReason === 'repurchase';
  const labels = legs.map((c) => c.label).join(', ');
  /* A leg that has since closed itself - a buyer's shares bought back - is
     history rather than a live leg, and deleting it deletes it alone (see
     Store.transferOf), so the message must not promise that it undoes the
     transfer. */
  const open = legs.some((c) => !c.closedAt);
  if (legs.length === 1) {
    return `${subject} was ${repurchase ? 'repurchased, leaving' : 'transferred into'} ${labels}. `
      + `Delete that certificate first${open ? `, which undoes the ${repurchase ? 'repurchase' : 'transfer'}` : ''}.`;
  }
  return `${subject} was transferred into ${labels}. `
    + (open ? 'Delete one of those certificates first, which undoes the transfer.' : 'Delete those certificates first.');
}

/**
 * Why a leg a repurchase has since closed in full cannot go on its own while
 * the certificate it came off still stands closed. A transfer closes its
 * source against the legs it issued, and deleting a leg undoes the transfer
 * by reopening the source at its full size (see Store.transferOf) - so a
 * closed leg deleted alone left the source closed against fewer shares than
 * it held, and the next delete of a sibling reopened it whole: the 40 shares
 * the company had paid to retire were outstanding again. The way back is the
 * restore point the repurchase took, which is the answer the sibling already
 * gets. Shared with the securities list, which says it before the press.
 */
export function retiredLegStands(leg, source, { holder = null, inPart = false } = {}) {
  const event = source.closedReason === 'repurchase' ? 'repurchase' : 'transfer';
  const subject = holder ? `${holder}’s ${leg.label}` : leg.label;
  return `${subject} came off ${source.label} in a ${event} and was since repurchased in ${inPart ? 'part' : 'full'}, so it can’t be `
    + `deleted on its own: ${source.label} would stay closed against fewer shares than it held. `
    + 'Restore the point taken before the repurchase instead.';
}

/* Every figure is held inside a range arithmetic stays exact in: a count is
   a safe integer, and a money or per-share figure sits under a quadrillion.
   A backup carrying a quantity of 1e308 imported as written, and every total
   read as Infinity from then on. */
/* And total over anything JSON can hold: String() and Number() throw on an
   object built to defeat them ({"toString": 1}), and a backup carrying one
   in any field took the import down with a TypeError read as a connection
   problem. An object or an array where a figure or a text belongs is
   nothing usable, and reads as the fallback. */
const scalar = (v) => v === null || v === undefined || typeof v === 'object' ? null : v;
const num = (v, fallback = 0) => (scalar(v) !== null && Number.isFinite(Number(v))
  ? Math.max(-NUM_MAX, Math.min(NUM_MAX, Number(v)))
  : fallback);
const int = (v, fallback = 0) => Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(num(v, fallback))));
// A schedule's length in months, held to the longest one a record keeps.
const months = (v) => Math.min(MAX_VESTING_MONTHS, int(v));
const str = (v) => (scalar(v) === null ? '' : String(v).trim());
/**
 * A record id as it is stored, and as every reference to it is stored: one
 * length, so a reference always equals the id it names. Ids are kept as they
 * arrive in a backup while references were cut to 40 characters, so a grant
 * imported under a 64-character id never matched the `fromOptionId` its
 * exercise certificate carried - the grant could be deleted under a standing
 * certificate, and the exercise was offered for certifying a second time.
 */
const rid = (v) => str(v).slice(0, 40);
/**
 * One record per id within a collection. A backup carrying two records under
 * one id kept both, and every edit or delete of that id then touched both -
 * an undo restoring one of them. The second gets an id of its own instead;
 * references keep naming the first, which is the only one they ever could.
 */
const uniqueIds = () => {
  const seen = new Set();
  return (raw) => {
    let id = rid(raw) || uid();
    if (seen.has(id)) id = uid();
    seen.add(id);
    return id;
  };
};
/* A refusal thrown before a write is queued - a limit, a missing record, a
   ratio that makes no sense - marked the way #commitNow marks one thrown
   inside apply(), so the forms tell it apart from a failed write. */
const refusal = (message) => Object.assign(new Error(message), { refused: true });
/** Every kind of security a record can be. */
const SECURITY_KINDS = new Set(['shares', 'option', 'rsu', 'warrant', 'safe', 'note']);
/** A calendar date as the records store one: YYYY-MM-DD, naming a day that exists. */
const isISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s))
  && new Date(s).toISOString().slice(0, 10) === s;
/**
 * A share count typed into a lifecycle write: a positive whole number. The
 * sanitizer rounds, which is right for a stored record and wrong for input -
 * 10.5 options exercised became 11 under a "saved" toast.
 */
const wholeCount = (value, empty) => {
  const n = Number(value);
  if (!(n > 0)) throw new Error(empty);
  if (!Number.isSafeInteger(n)) throw new Error('Enter the quantity in whole shares.');
  return n;
};
/**
 * The day a reserve shortfall names. An award with no date - a record kept
 * from before dates were required - draws before every recorded day, and
 * the sweep reports its day as nothing; said as "on ," the refusal read as
 * a typo.
 */
const drawnDay = (hit) => (hit.date ? `on ${hit.date}` : 'with no recorded date');
const heldDay = (hit) => (hit.date ? 'as of that day' : 'on any day');
/**
 * A figure the reserve sweep read on a day, in the shares a resize or a
 * transfer is typed in: today's. The sweep reads each day in its own units,
 * and a day before a split is in that day's shares, so the floor it quoted
 * for a June day since split 3-for-1 - "800 committed" - sent the user to
 * type 800 into a table where those shares are 2,400, and be refused again.
 * The smallest count in today's shares that reads at least the day's; the
 * same count when nothing has split since, or the day is not recorded.
 */
const inTodaysShares = (company, hit, count) => {
  const f = hit.date ? unsplitFactor(company, hit.date) : 1;
  return f === 1 ? count : Math.ceil(count / f - 1e-9);
};
/** "80 shares committed under it on 2024-06-01" - and what those are today, when that differs. */
const restatedNote = (day, today) => (today === day ? '' : `, ${fmtCount(today)} in today’s shares`);

export class Store extends EventTarget {
  settings = { theme: 'system' };
  company = Store.defaultCompany();
  classes = [];
  stakeholders = [];
  securities = [];
  scenarios = [];
  exits = [];
  /**
   * Planned grants - the hiring plan the option pool has to cover. Deliberately
   * its own collection rather than securities: nothing planned may reach the
   * cap table, the diluted base, or the pool draw.
   */
  hiring = [];
  activity = [];
  /**
   * Snapshots taken immediately before an operation that rewrites the whole
   * dataset, newest first. The undo closures elsewhere in this file can't
   * cover those - see #dataEpoch - so this is what stands in their place.
   */
  restorePoints = [];
  user = null;
  /** The account's companies (registry entries) and which one is loaded. */
  companies = [];
  activeCompanyId = null;
  /**
   * The stand-in holders the last load made for securities whose own holder
   * record was missing - see recoverHolders. Empty on a clean load.
   */
  recoveredHolders = [];
  /**
   * Bumped whenever the loaded dataset stops being the one an outstanding
   * undo closure was built against: another company's data swapped in, a
   * split restating every quantity, an import replacing the world. An undo
   * from before the bump would re-insert records into a dataset they don't
   * belong to (or in the wrong units), so it refuses instead.
   */
  #dataEpoch = 0;

  /**
   * Set once a write has been refused for landing on someone else's change.
   * Everything this session holds is behind from that moment on, so the shell
   * says so and offers a reload rather than letting the user keep typing into
   * a copy that can no longer be saved.
   */
  #stale = false;

  get isStale() {
    return this.#stale;
  }

  emit() {
    this.dispatchEvent(new Event('change'));
  }

  /** The equity incentive plans of the loaded company - see plansOf. */
  get plans() {
    return plansOf(this.company);
  }

  /** Snapshot consumed by the pure math in lib/captable.js. */
  get db() {
    return {
      company: this.company,
      classes: this.classes,
      stakeholders: this.stakeholders,
      securities: this.securities,
    };
  }

  /**
   * Reads #dataEpoch: a counter of "the loaded dataset is no longer the one
   * you were looking at". Views hold state that describes a particular
   * dataset - the cap table's as-of date, a half-typed round - and that state
   * has to be dropped when the dataset underneath it is replaced.
   */
  get dataEpoch() {
    return this.#dataEpoch;
  }

  static defaultCompany() {
    return {
      name: '',
      entityType: 'C-Corp',
      jurisdiction: 'Delaware',
      /* Every figure on a cap table is money, and not every company banks in
         dollars. USD is the default, so datasets written before the field
         existed read back exactly as they always did - and nothing is ever
         converted between currencies. */
      currency: 'USD',
      incorporated: '',
      plans: [],
      poolAuthorized: 0,
      poolHistory: [],
      valuations: [],
      splits: [],
      reporting: Store.defaultReporting(),
    };
  }

  /**
   * The assumptions the Reports view runs on: what values an option
   * (volatility, rate, expected term), how its cost is attributed, when the
   * fiscal year ends, and the total assets Rule 701 measures against. Zero
   * volatility means "not set yet", which is what a company written before
   * the field existed reads as - the report asks for the inputs rather than
   * valuing anything at a made-up number.
   */
  static defaultReporting() {
    return {
      volatility: 0,
      riskFreeRate: 0,
      expectedTermYears: 0,
      attribution: 'straight',
      fiscalYearEnd: 12,
      totalAssets: 0,
    };
  }

  /* ---------- Sanitizers (pure, also used by import) ---------- */

  static sanitizeCompany(raw) {
    const base = Store.defaultCompany();
    if (!raw || typeof raw !== 'object') return base;
    /* The plans are the reserves; `poolAuthorized` is their sum, kept for
       everything that reads the one pool. A record with a pool and no plans
       was written before plans existed: its pool becomes the one plan, with
       the pool's history as the plan's, so nothing it reported changes - see
       legacyPlan in captable.js, which reads such a record the same way
       until it is next saved. */
    const poolHistory = Store.sanitizePoolHistory(raw.poolHistory);
    let plans = Store.sanitizePlans(raw.plans);
    let poolAuthorized = int(raw.poolAuthorized);
    if (!plans.length) {
      const legacy = plansOf({ poolAuthorized, poolHistory })[0];
      if (legacy) plans = Store.sanitizePlans([legacy]);
    }
    if (plans.length) poolAuthorized = plans.reduce((a, plan) => a + plan.reserve, 0);
    return {
      name: str(raw.name).slice(0, 120),
      /* The defaults stand in for a field the record never had - a company
         written before it existed, a hand-built import - not for one the
         user emptied: neither is required on the profile form, and a cleared
         jurisdiction came back as "Delaware" under a toast saying the profile
         was saved. */
      entityType: raw.entityType === undefined ? base.entityType : str(raw.entityType).slice(0, 40),
      jurisdiction: raw.jurisdiction === undefined ? base.jurisdiction : str(raw.jurisdiction).slice(0, 60),
      currency: normalizeCurrency(raw.currency),
      incorporated: str(raw.incorporated).slice(0, 10),
      plans,
      poolAuthorized,
      poolHistory,
      valuations: Store.sanitizeValuations(raw.valuations),
      splits: Store.sanitizeSplits(raw.splits),
      reporting: Store.sanitizeReporting(raw.reporting),
    };
  }

  /**
   * Resizes of the authorized option pool in the order they were recorded:
   * the size before and after each, effective a date, in the share units of
   * the day it was recorded. A round's top-up and an edit in the pool sheet
   * both write one, so a snapshot of an earlier date can read the pool at the
   * size it actually had (see poolAsOf in captable.js). `seq` is the number
   * the resize was recorded under, in the sequence it shares with the splits
   * that restate the same pool. Only the most recent are kept past the cap;
   * dates before the oldest kept entry read the pool as it stood before it.
   */
  static sanitizePoolHistory(raw) {
    return (Array.isArray(raw) ? raw : [])
      .filter((c) => c && typeof c === 'object' && str(c.date) && int(c.before) !== int(c.after))
      .map((c) => {
        const change = { date: str(c.date).slice(0, 10), before: int(c.before), after: int(c.after) };
        if (int(c.seq) > 0) change.seq = int(c.seq);
        return change;
      })
      .slice(-MAX_POOL_HISTORY);
  }

  /**
   * The next number in the order the pool's events are recorded. Splits and
   * resizes share the one sequence, because the as-of view walks the two back
   * together - a resize after a split is in post-split units, and only their
   * order says so.
   */
  static nextPoolSeq(company) {
    const splits = company?.splits || [];
    const changes = company?.poolHistory || [];
    const entries = (company?.plans || []).flatMap((plan) => plan.reserveHistory || []);
    return Math.max(
      splits.length + changes.length,
      ...splits.map((sp) => int(sp.seq)),
      ...changes.map((c) => int(c.seq)),
      ...entries.map((e) => int(e.seq)),
    ) + 1;
  }

  /**
   * The company with its one pool set to `size` as of `date`: the way the
   * pool was resized before plans existed, kept for the callers that still
   * speak of the pool. It resizes the company's one plan, or adopts one when
   * the company has none, and refuses a company with several - each of those
   * has its own reserve to resize. The same company back when nothing moved:
   * saving the size the pool already has is not an event.
   */
  static poolResized(company, size, date, { kind = 'resize', reason = '' } = {}) {
    const plans = company.plans || [];
    if (plans.length > 1) {
      throw refusal('This company has several equity plans. Resize each plan’s reserve under Share classes.');
    }
    if (!plans.length) {
      if (int(size) === 0) return company;
      /* Adopted on no recorded date, like the pool it stands in for: the
         date is when the reserve took effect, and a grant backfilled from
         before it was always the pool's to hold. */
      const plan = Store.sanitizePlans([{ id: uid(), name: LEGACY_PLAN_NAME, createdAt: Date.now() }])[0];
      return Store.planResized({ ...company, plans: [plan] }, plan.id, size, date, { kind: 'adoption', reason });
    }
    return Store.planResized(company, plans[0].id, int(size), date, { kind, reason });
  }

  /**
   * The company with one plan's reserve set to `size` as of `date`, the
   * change written into the plan's history under the next sequence number -
   * and mirrored into the company's aggregate pool history, which every
   * reader written before plans existed still reads. `extra` carries what
   * the entry is about: a transfer's id and the other plan, a split's id.
   * The same company back when nothing moved.
   */
  static planResized(company, planId, size, date, { kind = 'resize', reason = '', mirror = true, ...extra } = {}) {
    const plans = company.plans || [];
    const plan = plans.find((p) => p.id === planId);
    if (!plan) throw refusal('That plan is gone.');
    const before = planReserve(plan);
    // A transfer can spend recycled inflows as well as the plan's own reserve.
    // Keep the resulting debit: clamping it to zero would create shares.
    const after = kind === 'transfer' || kind === 'split' || kind === 'top-up' ? Math.round(num(size)) : int(size);
    if (after === before && kind !== 'split') return company;
    const seq = int(extra.seq) || Store.nextPoolSeq(company);
    const entry = { date: str(date).slice(0, 10), before, after, seq, kind: RESERVE_KINDS.has(kind) ? kind : 'resize' };
    if (str(reason)) entry.reason = str(reason).slice(0, PLAN_REASON_MAX);
    if (str(extra.transferId)) entry.transferId = rid(extra.transferId);
    if (str(extra.counterpartyId)) entry.planId = rid(extra.counterpartyId);
    if (str(extra.splitId)) entry.splitId = rid(extra.splitId);
    const aggregateBefore = int(company.poolAuthorized);
    const aggregateAfter = aggregateBefore - before + after;
    return Store.sanitizeCompany({
      ...company,
      plans: plans.map((p) => (p.id === planId
        ? { ...p, reserve: after, reserveHistory: [...(p.reserveHistory || []), entry] }
        : p)),
      poolAuthorized: aggregateAfter,
      poolHistory: mirror && kind !== 'split' && aggregateAfter !== aggregateBefore
        ? [...(company.poolHistory || []), { date: entry.date, before: aggregateBefore, after: aggregateAfter, seq }]
        : company.poolHistory,
    });
  }

  /**
   * The equity incentive plans on a company record - see the plans section
   * of lib/captable.js for the shape. A plan with no name is not one; a
   * recycling rule naming a plan not on the list, or the plan itself, falls
   * back to the convention the one pool followed.
   */
  static sanitizePlans(raw) {
    const idOf = uniqueIds();
    const plans = (Array.isArray(raw) ? raw : [])
      .filter((p) => p && typeof p === 'object' && str(p.name))
      .map((p) => {
        const plan = {
          id: idOf(p.id),
          name: str(p.name).slice(0, PLAN_NAME_MAX),
          adopted: str(p.adopted).slice(0, 10),
          classId: rid(p.classId),
          status: p.status === 'retired' && str(p.retiredAt) ? 'retired' : 'active',
          awardTypes: [...new Set((Array.isArray(p.awardTypes) ? p.awardTypes : []).filter((t) => t === 'option' || t === 'rsu'))],
          reserve: planReserve(p),
          reserveHistory: Store.sanitizeReserveHistory(p.reserveHistory),
          recycling: Store.sanitizeRecycling(p.recycling),
          createdAt: num(p.createdAt, Date.now()),
        };
        if (!plan.awardTypes.length) plan.awardTypes = ['option', 'rsu'];
        if (plan.status === 'retired') plan.retiredAt = str(p.retiredAt).slice(0, 10);
        if (str(p.expires)) plan.expires = str(p.expires).slice(0, 10);
        return plan;
      })
      .slice(0, MAX_PLANS);
    const ids = new Set(plans.map((p) => p.id));
    for (const plan of plans) {
      for (const { value: event } of RECYCLING_EVENTS) {
        const rule = plan.recycling[event];
        if (rule !== 'return' && rule !== 'retire' && (!ids.has(rule) || rule === plan.id)) {
          plan.recycling[event] = DEFAULT_RECYCLING[event];
        }
      }
    }
    return plans;
  }

  /** A plan's recycling rules: 'return', 'retire', or a plan id, one per event. */
  static sanitizeRecycling(raw) {
    const out = {};
    for (const { value: event } of RECYCLING_EVENTS) {
      const rule = rid(raw && typeof raw === 'object' ? raw[event] : '');
      out[event] = rule || DEFAULT_RECYCLING[event];
    }
    return out;
  }

  /**
   * A plan's dated reserve changes in the order recorded, in the units of
   * each one's day. An entry that moves nothing is not one, unless it is a
   * split's restatement, which can round to the same figure and still
   * anchors the as-of walk. Only the most recent are kept past the cap.
   */
  static sanitizeReserveHistory(raw) {
    return (Array.isArray(raw) ? raw : [])
      .filter((e) => e && typeof e === 'object' && str(e.date) && (Math.round(num(e.before)) !== Math.round(num(e.after)) || str(e.splitId)))
      .map((e) => {
        const entry = {
          date: str(e.date).slice(0, 10), before: Math.round(num(e.before)), after: Math.round(num(e.after)),
          kind: RESERVE_KINDS.has(e.kind) ? e.kind : 'resize',
        };
        if (int(e.seq) > 0) entry.seq = int(e.seq);
        if (str(e.reason)) entry.reason = str(e.reason).slice(0, PLAN_REASON_MAX);
        if (str(e.transferId)) entry.transferId = rid(e.transferId);
        if (str(e.planId)) entry.planId = rid(e.planId);
        if (str(e.splitId)) entry.splitId = rid(e.splitId);
        return entry;
      })
      .slice(-MAX_POOL_HISTORY);
  }

  static sanitizeReporting(raw) {
    const base = Store.defaultReporting();
    if (!raw || typeof raw !== 'object') return base;
    const bounded = (v, min, max) => Math.min(max, Math.max(min, num(v)));
    const fye = Math.round(num(raw.fiscalYearEnd, 12));
    return {
      // Percentages, whole numbers: 60 is 60%. Nothing real sits outside these.
      volatility: bounded(raw.volatility, 0, 500),
      // Rates have gone below zero; the bound keeps a typo from doing worse.
      riskFreeRate: bounded(raw.riskFreeRate, -10, 100),
      expectedTermYears: bounded(raw.expectedTermYears, 0, 50),
      attribution: raw.attribution === 'graded' ? 'graded' : 'straight',
      fiscalYearEnd: fye >= 1 && fye <= 12 ? fye : base.fiscalYearEnd,
      totalAssets: Math.max(0, num(raw.totalAssets)),
    };
  }

  /**
   * Stock splits, oldest first: N new shares for D old, effective a date.
   *
   * A split that had to round the option pool also carries the pool as it
   * stood on either side of it (`poolBefore`, `poolAfter`) - a restated
   * count cannot be divided back into the one it came from, and this is what
   * lets a snapshot of an earlier date read the pool it actually had. The
   * pair is read only while the pool still stands at `poolAfter`: resized
   * since, the pool is a new number the split never saw.
   *
   * `seq` is the order the split was recorded in, which is the order it was
   * applied to the records - not always its date order, since a historical
   * split can be entered behind one already on file. The as-of view walks
   * the splits back in that order (see splitsApplied in captable.js).
   */
  static sanitizeSplits(raw) {
    const splits = (Array.isArray(raw) ? raw : [])
      .filter((s) => s && typeof s === 'object' && str(s.date) && int(s.num) > 0 && int(s.den) > 0)
      .map((s) => {
        const split = {
          id: rid(s.id) || uid(),
          date: str(s.date).slice(0, 10),
          num: int(s.num),
          den: int(s.den),
        };
        if (int(s.poolBefore) > 0 && int(s.poolAfter) > 0) {
          split.poolBefore = int(s.poolBefore);
          split.poolAfter = int(s.poolAfter);
        }
        if (int(s.seq) > 0) split.seq = int(s.seq);
        return split;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    if (splits.length > MAX_STOCK_SPLITS) {
      throw new ListFullError(`A company can keep at most ${MAX_STOCK_SPLITS} stock splits.`);
    }
    return splits;
  }

  /**
   * Attachment references on a record: the file itself lives in the user's
   * Puter cloud; the record keeps only the path and a display name.
   *
   * A path is only ever written by #attachmentPath, so anything outside that
   * directory arrived through an imported backup - and the app both reads
   * those paths and deletes them on the user's say-so. Confining them here
   * keeps a hand-edited import from pointing "Signed SPA.pdf" at an unrelated
   * file in the user's own cloud.
   */
  static sanitizeAttachments(raw) {
    return (Array.isArray(raw) ? raw : [])
      .filter((a) => a && typeof a === 'object' && str(a.path) && str(a.name))
      .filter((a) => Store.isAttachmentPath(a.path))
      .map((a) => ({
        id: rid(a.id) || uid(),
        name: str(a.name).slice(0, 120),
        path: str(a.path).slice(0, 400),
        size: int(a.size),
        addedAt: num(a.addedAt, Date.now()),
      }))
      .slice(0, ATTACHMENTS_MAX);
  }

  /**
   * Whether a path is one #attachmentPath could have written: the app's
   * directory, a company, a record, a file - four segments, none empty or a
   * dot. Not just "under the directory": the store hands these paths to
   * fs.delete, which removes a directory with everything in it, and an
   * imported reference reading `captable-attachments/` or naming a company's
   * folder passed the old prefix check - so removing that one "attachment"
   * would have taken every file of every company with it.
   */
  static isAttachmentPath(path) {
    const parts = str(path).split('/');
    return parts.length === 4 && parts[0] === ATTACHMENT_ROOT
      && parts.every((p) => p && p !== '.' && p !== '..');
  }

  /** 409A history, newest first. A valuation with no price is not one. */
  static sanitizeValuations(raw) {
    const idOf = uniqueIds();
    return (Array.isArray(raw) ? raw : [])
      .filter((v) => v && typeof v === 'object' && str(v.date) && num(v.fmvPerShare) > 0)
      .map((v) => {
        const out = {
          id: idOf(v.id),
          date: str(v.date).slice(0, 10),
          fmvPerShare: num(v.fmvPerShare),
          note: str(v.note).slice(0, 120),
        };
        const attachments = Store.sanitizeAttachments(v.attachments);
        if (attachments.length) out.attachments = attachments;
        return out;
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, VALUATIONS_MAX);
  }

  static sanitizeClasses(raw) {
    const idOf = uniqueIds();
    return (Array.isArray(raw) ? raw : [])
      .filter((c) => {
        if (c?.preferredTerms !== undefined && !str(c.name)) {
          throw new FinancingError('A class with financing terms must have a name.');
        }
        return c && typeof c === 'object' && str(c.name);
      })
      .map((c) => {
        const preferred = c.kind === 'preferred';
        const cls = {
          id: idOf(c.id),
          name: str(c.name).slice(0, CLASS_NAME_MAX),
          kind: preferred ? 'preferred' : 'common',
          authorized: int(c.authorized),
          pricePerShare: Math.max(0, num(c.pricePerShare)),
          liquidationMultiple: preferred ? Math.max(0, num(c.liquidationMultiple, 1)) : 0,
          participating: !!c.participating,
          seniority: int(c.seniority),
          createdAt: num(c.createdAt, Date.now()),
        };
        /* Conversion-price protection, and the conversion price a down round
           has already lowered. Both are opt-in and only meaningful on
           preferred, so a class written before they existed - or a common
           class - carries neither and means exactly what it always did. */
        if (preferred && (c.antiDilution === 'broad' || c.antiDilution === 'ratchet')) {
          cls.antiDilution = c.antiDilution;
        }
        const converted = preferred ? Math.max(0, num(c.conversionPrice)) : 0;
        // Equal to the issue price is the unadjusted state, which is absence.
        if (converted > 0 && converted !== cls.pricePerShare) cls.conversionPrice = converted;
        /* Dated participation-cap and dividend amendments. Refused, not
           dropped, when they cannot stand: a class that lost its cap on
           import would pay out more than its charter allows. */
        if (c.preferredTerms !== undefined) {
          if (!preferred) throw new FinancingError('Preferred terms require a preferred class.');
          cls.preferredTerms = validatePreferred(c.preferredTerms);
          if (!c.participating && cls.preferredTerms.some((t) => t.cap)) throw new FinancingError('Participation caps require participating preferred.');
        }
        return cls;
      });
  }

  static sanitizeStakeholders(raw) {
    const idOf = uniqueIds();
    return (Array.isArray(raw) ? raw : [])
      .filter((h) => h && typeof h === 'object' && str(h.name))
      .map((h) => {
        const out = {
          id: idOf(h.id),
          name: str(h.name).slice(0, STAKEHOLDER_NAME_MAX),
          email: str(h.email).slice(0, EMAIL_MAX),
          kind: ['founder', 'investor', 'employee', 'advisor', 'entity'].includes(h.kind) ? h.kind : 'employee',
          createdAt: num(h.createdAt, Date.now()),
        };
        // Set by the departure flow; absent means still around.
        if (str(h.departed)) out.departed = str(h.departed).slice(0, 10);
        /* The names this holder went by before a rename - see
           updateStakeholder. Never the current one, never twice, and only as
           many as a record could plausibly collect. */
        const seen = new Set([out.name.toLowerCase()]);
        const former = (Array.isArray(h.formerNames) ? h.formerNames : [])
          .map((n) => str(n).slice(0, 120))
          .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
          .slice(0, FORMER_NAMES_MAX);
        if (former.length) out.formerNames = former;
        return out;
      });
  }

  /**
   * An award's forfeiture history: dated, positive, chronological, and never
   * cancelling more than the award holds. Entries past that ceiling are
   * truncated newest-first, so the earliest forfeitures - the ones every
   * later snapshot depends on - survive the clamp.
   *
   * `cancelled`/`cancelledDate` are the one-entry spelling of the same
   * thing, so a record written before the list existed reads back unchanged.
   */
  static sanitizeCancellations(raw, { cancelled, cancelledDate, quantity, fallbackDate }) {
    const list = Array.isArray(raw) && raw.length
      ? raw
      : (int(cancelled) > 0 ? [{ quantity: int(cancelled), date: cancelledDate }] : []);
    const sorted = list
      .filter((c) => c && typeof c === 'object' && int(c.quantity) > 0)
      .map((c) => ({ date: str(c.date).slice(0, 10) || fallbackDate, quantity: int(c.quantity) }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 120);
    const out = [];
    let total = 0;
    for (const c of sorted) {
      const room = quantity - total;
      if (room <= 0) break;
      out.push({ quantity: Math.min(c.quantity, room), date: c.date });
      total += out[out.length - 1].quantity;
    }
    return out;
  }

  /** Custom vesting tranches: dated, positive, chronological. */
  static sanitizeTranches(raw) {
    const tranches = (Array.isArray(raw) ? raw : [])
      .filter((t) => t && typeof t === 'object' && str(t.date) && int(t.quantity) > 0)
      .map((t) => ({ date: str(t.date).slice(0, 10), quantity: int(t.quantity) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (tranches.length > MAX_VESTING_TRANCHES) {
      throw new ListFullError(`A vesting schedule can hold at most ${MAX_VESTING_TRANCHES} tranches. Combine or remove a tranche first.`);
    }
    return tranches;
  }

  /**
   * A tranche schedule resized for part of a position. Copying the absolute
   * quantities onto a smaller certificate would hit the clamp at the
   * certificate's size and read fully vested at the first tranche - a
   * 400k early exercise of a 1M grant split 500k/500k must vest 200k/200k.
   * Scaling the cumulative totals (rather than each tranche independently)
   * keeps the certificate exactly pro-rata at every boundary with no
   * rounding drift.
   */
  static scaleTranches(tranches, part, whole) {
    if (!Array.isArray(tranches) || !(part > 0) || !(whole > 0) || part >= whole) {
      return tranches;
    }
    let cum = 0;
    let scaledCum = 0;
    return tranches.map((t) => {
      cum += int(t.quantity);
      const next = Math.round((cum * part) / whole);
      const quantity = next - scaledCum;
      scaledCum = next;
      return { date: t.date, quantity };
    });
  }

  /**
   * What a record held before each split that had to round it.
   *
   * A split restates every holding, and a reverse split rounds - so the
   * number a record holds afterwards is not the number it held before,
   * divided. Multiplying it back is the only way a historical view could
   * read it, and that reconstruction is wrong by exactly what the rounding
   * moved: 15 shares reversed 1-for-10 into 2 read back as 20 for every date
   * before the split, and the capital paid for them read $40 instead of $30.
   * So the split writes down what it rounded, once per split that rounded
   * this record, and history reads the number rather than deriving it.
   *
   * The same for the other share counts a record carries: an award's
   * forfeiture history (`cancellations`, dated as it stood) and the position
   * a repurchase remainder's schedule is measured against (`vestingBase`).
   * Each rounds on its own, and each was being divided back - so 10 options
   * cancelled before a 1-for-3 reverse split (3 after it) read as 9 on every
   * date before it, and the as-of cap table counted an option the grant had
   * forfeited.
   */
  static sanitizeSplitHistory(raw) {
    const seen = new Set();
    return (Array.isArray(raw) ? raw : [])
      .filter((e) => e && typeof e === 'object' && str(e.id) && int(e.quantity) > 0)
      .map((e) => {
        const entry = { id: str(e.id).slice(0, 40), quantity: int(e.quantity) };
        const tranches = Store.sanitizeTranches(e.vestingTranches);
        if (tranches.length) entry.vestingTranches = tranches;
        const forfeits = Store.sanitizeCancellations(e.cancellations, { quantity: entry.quantity, fallbackDate: '' })
          .filter((c) => c.date);
        if (forfeits.length) entry.cancellations = forfeits;
        if (int(e.vestingBase) > 0) entry.vestingBase = int(e.vestingBase);
        if (int(e.vestingOffset) > 0) entry.vestingOffset = int(e.vestingOffset);
        if (int(e.repurchasedQty) > 0) entry.repurchasedQty = int(e.repurchasedQty);
        return entry;
      })
      .filter((e) => (seen.has(e.id) ? false : seen.add(e.id)))
      .slice(0, MAX_STOCK_SPLITS);
  }

  /* Acceleration only means something on a security that vests, so the
     fields ride along with a schedule and vanish with it. */
  static #applyAcceleration(record, s) {
    if (s.accelTrigger !== 'single' && s.accelTrigger !== 'double') return;
    record.accelTrigger = s.accelTrigger;
    record.accelPct = Math.min(100, Math.max(1, Math.round(num(s.accelPct, 100))));
  }

  static sanitizeSecurities(raw, { classes = [], stakeholders = [], plans = null } = {}) {
    const classIds = new Set(classes.map((c) => c.id));
    const holderIds = new Set(stakeholders.map((h) => h.id));
    const out = [];
    const idOf = uniqueIds();
    /* Which plan an award draws from. Given the plans, a reference to one
       of them stands, a reference to none is dropped, and an award that
       names nothing takes the plan the rules resolve it to - the one plan,
       or the only one that could hold it - so every award the store holds
       says where it draws from (see resolvePlan). Without the plans - a
       caller sanitizing rows on their own - the reference is kept as written
       for the store to check. An award that says it sits outside every plan
       keeps saying so. */
    const planOf = (award, s) => {
      const planId = rid(s.planId);
      if (!plans) {
        if (planId) award.planId = planId;
        else if (s.outsidePlan === true) award.outsidePlan = true;
        return;
      }
      if (planId && plans.some((p) => p.id === planId)) award.planId = planId;
      else if (s.outsidePlan === true) award.outsidePlan = true;
      else {
        const resolved = resolvePlan({ ...award, planId: '' }, plans).planId;
        if (resolved) award.planId = resolved;
      }
    };
    for (const s of Array.isArray(raw) ? raw : []) {
      if (!s || typeof s !== 'object' || !holderIds.has(rid(s.stakeholderId))) {
        if (s?.proRata || s?.mfn || s?.dividendEvents || s?.economicBasis) throw new FinancingError('A security with financing terms must name an existing holder.');
        continue;
      }
      if ((s.proRata || s.mfn || s.dividendEvents || s.economicBasis) && !['shares', 'option', 'rsu', 'warrant', 'safe', 'note'].includes(s.kind)) throw new FinancingError('Unsupported security kind with financing terms.');
      const classId = rid(s.classId);
      const base = {
        id: idOf(s.id),
        label: str(s.label).slice(0, 24) || 'SEC-0',
        stakeholderId: rid(s.stakeholderId),
        date: str(s.date).slice(0, 10),
        createdAt: num(s.createdAt, Date.now()),
      };
      /* Negotiated terms and the evidence a modeled close leaves behind. Each
         is validated strictly - see financing.js - and a record whose terms
         cannot stand fails the whole sanitize, so an import that would lose a
         right is refused rather than taken without it. */
      if (s.proRata !== undefined) base.proRata = validateProRata(s.proRata);
      if (s.mfn !== undefined) {
        if (s.kind !== 'safe' && s.kind !== 'note') throw new FinancingError('MFN terms require a SAFE or note.');
        base.mfn = validateMFN(s.mfn);
        if (base.mfn.elections.some((e) => e.sourceDate <= base.date)) throw new FinancingError('MFN sources must be later than the original instrument.');
        if (s.kind !== 'safe' && base.mfn.scope.includes('safeType')) throw new FinancingError('Notes cannot elect a SAFE convention.');
      }
      if (s.dividendEvents !== undefined) {
        if (s.kind !== 'shares') throw new FinancingError('Dividend events require a share certificate.');
        base.dividendEvents = validateDividendEvents(s.dividendEvents);
      }
      if (s.economicBasis !== undefined) {
        if (s.kind !== 'shares') throw new FinancingError('Original dividend basis requires shares.');
        base.economicBasis = validateBasis(s.economicBasis);
      }
      if (s.roundId !== undefined) {
        if (typeof s.roundId !== 'string' || !s.roundId || s.roundId.length > 2000) throw new FinancingError('Invalid financing ID.');
        base.roundId = s.roundId;
      }
      if (s.cashInvested !== undefined) {
        if (!Number.isFinite(s.cashInvested) || s.cashInvested < 0) throw new FinancingError('Invalid confirmed investment.');
        base.cashInvested = s.cashInvested;
      }
      if (s.financingEvidence !== undefined) {
        if (!s.roundId || !s.financingEvidence || typeof s.financingEvidence !== 'object' || Array.isArray(s.financingEvidence)) throw new FinancingError('Invalid financing evidence.');
        base.financingEvidence = boundedEvidence(s.financingEvidence);
      }
      if ((s.kind === 'option' || s.kind === 'rsu') && s.vestingStoppedAt) {
        base.vestingStoppedAt = termDate(s.vestingStoppedAt, 'Vesting stop date');
      } else if (s.kind === 'option' && s.exerciseBy) {
        // Older departures stored the service date on the holder and only
        // the exercise deadline on the grant. Preserve that service stop
        // even when the forfeiture left some unvested options outstanding.
        const departed = stakeholders.find((h) => h.id === base.stakeholderId)?.departed;
        if (departed && departed >= (s.grantDate || base.date)) base.vestingStoppedAt = departed;
      }
      // Attachment references ride on every kind of security.
      const attachments = Store.sanitizeAttachments(s.attachments);
      if (attachments.length) base.attachments = attachments;
      /* What the splits that rounded this record left behind, so a date
         before one of them reads the holding it actually had. Only a
         quantity-bearing kind ever collects any. */
      const preSplit = Store.sanitizeSplitHistory(s.preSplit);
      if (preSplit.length) base.preSplit = preSplit;
      if (s.kind === 'shares') {
        if (!classIds.has(classId) || int(s.quantity) <= 0) {
          if (s.economicBasis || s.dividendEvents || s.proRata) throw new FinancingError('A security with financing terms must have a valid class, holder and positive quantity.');
          continue;
        }
        /* A certificate in a class with dividend terms accrues on its
           original money, so one written before the terms existed takes its
           quantity x price (or the cash a close recorded) as that basis once,
           and keeps it through every later split and transfer. A transfer's
           successor is dated at the purchase it continues, not at the
           transfer - see originalIssueDate. */
        if (!base.economicBasis && classes.find((c) => c.id === classId)?.preferredTerms?.length) {
          base.economicBasis = validateBasis({
            principal: s.cashInvested ?? int(s.quantity) * Math.max(0, num(s.pricePerShare)),
            date: originalIssueDate(s, Array.isArray(raw) ? raw : []) || base.date,
          });
        }
        const cert = {
          ...base, kind: 'shares', classId, quantity: int(s.quantity),
          pricePerShare: Math.max(0, num(s.pricePerShare)),
        };
        // Provenance for certificates issued by exercising a grant, by
        // converting a SAFE/note, or by a transfer. Kept as plain references:
        // if the source is later deleted the certificate and its shares
        // survive, which is what actually happened in real life.
        if (str(s.fromOptionId)) cert.fromOptionId = str(s.fromOptionId).slice(0, 40);
        if (str(s.fromRsuId)) cert.fromRsuId = str(s.fromRsuId).slice(0, 40);
        if (str(s.fromWarrantId)) cert.fromWarrantId = str(s.fromWarrantId).slice(0, 40);
        /* Minted by an anti-dilution adjustment rather than bought. It carries
           no invested capital, so the class's liquidation preference stays put
           while its as-converted count rises - which is what a lowered
           conversion price does. */
        if (s.antiDilution === true) cert.antiDilution = true;
        if (str(s.fromConvertibleId)) cert.fromConvertibleId = str(s.fromConvertibleId).slice(0, 40);
        if (str(s.fromTransferId)) {
          cert.fromTransferId = str(s.fromTransferId).slice(0, 40);
          if (num(s.transferPricePerShare) > 0) cert.transferPricePerShare = num(s.transferPricePerShare);
        }
        // Set when a transfer or repurchase closed this certificate: it
        // stays for history but stops counting anywhere current.
        if (str(s.closedAt)) {
          cert.closedAt = str(s.closedAt).slice(0, 10);
          cert.closedReason = s.closedReason === 'repurchase' ? 'repurchase' : 'transfer';
          /* A sale records its terms on the buyer's certificate, but a
             repurchase issues none - the shares are retired. Without these
             the entered consideration was accepted, previewed, and then
             dropped: nothing on the cap table, and nothing in an export,
             said what the company paid. */
          if (cert.closedReason === 'repurchase') {
            if (int(s.repurchasedQty) > 0) {
              cert.repurchasedQty = Math.min(cert.quantity, int(s.repurchasedQty));
            }
            if (num(s.repurchasePricePerShare) > 0) {
              cert.repurchasePricePerShare = num(s.repurchasePricePerShare);
            }
          }
        }
        // Vesting on a certificate is opt-in (founder restricted stock); the
        // fields are only written when a schedule exists, so plain
        // certificates keep the exact shape - and meaning - they had before.
        // A custom tranche list is a complete schedule of its own and wins
        // over the time-based fields.
        const certTranches = Store.sanitizeTranches(s.vestingTranches);
        if (certTranches.length) {
          cert.vestingTranches = certTranches;
        } else if (int(s.vestingMonths) > 0) {
          cert.vestingMonths = months(s.vestingMonths);
          cert.cliffMonths = Math.min(cert.vestingMonths, int(s.cliffMonths));
          cert.vestingStart = str(s.vestingStart).slice(0, 10) || base.date;
          if (s.vestingFrequency === 'quarterly' || s.vestingFrequency === 'annual') {
            cert.vestingFrequency = s.vestingFrequency;
          }
          /* The position the schedule is measured against, when a repurchase
             took shares out of its unvested tail. Only written when it is
             larger than what the certificate now holds - equal to its own size
             is the ordinary state, which is absence, so every certificate
             written before this field existed means exactly what it always
             did. */
          const vestingBase = int(s.vestingBase);
          if (vestingBase > cert.quantity) cert.vestingBase = vestingBase;
          if (int(s.vestingOffset) > 0) {
            cert.vestingOffset = int(s.vestingOffset);
            cert.vestingBase = Math.max(vestingBase, cert.quantity + cert.vestingOffset);
          }
        }
        if (certTranches.length || cert.vestingMonths) {
          Store.#applyAcceleration(cert, s);
          // The 83(b) filing date only exists on restricted stock - the one
          // kind of certificate the election applies to.
          if (str(s.filed83b)) cert.filed83b = str(s.filed83b).slice(0, 10);
          /* Recorded when the holder confirms no election was filed: the
             window is closed either way, and the app should say so once
             rather than keep asking. */
          if (s.missed83b === true && !str(s.filed83b)) cert.missed83b = true;
        }
        /* A transfer remainder continues its source's purchase; its 83(b)
           window ran from that original date, not the transfer's. Kept
           whether or not the certificate vests right now: it is provenance,
           and dropped with the schedule it came back as a fresh 30-day window
           dated the transfer when the schedule was ticked on again - an open
           deadline, then a missed-election item, on shares whose election
           had been filed a year before. */
        if (str(s.date83b)) cert.date83b = str(s.date83b).slice(0, 10);
        if (cert.dividendEvents?.length) {
          const cls = classes.find((c) => c.id === cert.classId);
          if (cls?.kind !== 'preferred' || !cls.preferredTerms?.some((t) => t.dividends)) throw new FinancingError('Record preferred dividend terms before entering dividend cash events.');
          const last = cert.dividendEvents.reduce((date, e) => e.date > date ? e.date : date, cert.date);
          dividendAccrual(cert, cls, last);
        }
        out.push(cert);
      } else if (s.kind === 'option') {
        if (int(s.quantity) <= 0) {
          if (s.proRata !== undefined) throw new FinancingError('An award with financing terms must have a positive quantity.');
          continue;
        }
        const quantity = int(s.quantity);
        const forfeits = Store.sanitizeCancellations(s.cancellations, {
          cancelled: s.cancelled, cancelledDate: s.cancelledDate, quantity, fallbackDate: base.date,
        });
        const cancelled = forfeits.reduce((a, c) => a + c.quantity, 0);
        const grant = {
          ...base, kind: 'option', quantity,
          strike: Math.max(0, num(s.strike)),
          grantDate: str(s.grantDate).slice(0, 10) || base.date,
          vestingMonths: months(s.vestingMonths),
          // A cliff past the end of the schedule is nonsense - it would mean
          // the grant vests fully before its own cliff is reached.
          cliffMonths: Math.min(months(s.vestingMonths), int(s.cliffMonths)),
          // Exercised and cancelled options are disjoint: you can't cancel
          // what has already been bought.
          exercised: Math.min(quantity - cancelled, int(s.exercised)),
        };
        if (cancelled > 0) {
          grant.cancelled = cancelled;
          // The first forfeiture dates the cancellation history.
          grant.cancelledDate = forfeits[0].date;
          if (forfeits.length > 1) grant.cancellations = forfeits;
        }
        if (str(s.expires)) grant.expires = str(s.expires).slice(0, 10);
        // The post-termination exercise deadline a departure set.
        if (str(s.exerciseBy)) grant.exerciseBy = str(s.exerciseBy).slice(0, 10);
        // ISO is opt-in; absent means NSO, so records written before the
        // field existed keep meaning exactly what they meant.
        if (s.optionType === 'iso') grant.optionType = 'iso';
        // Early exercise is a plan/agreement term the user asserts.
        if (s.earlyExercise === true) grant.earlyExercise = true;
        // Same schedule shapes as certificates: custom tranches win, and a
        // time-based schedule may step quarterly or annually.
        const grantTranches = Store.sanitizeTranches(s.vestingTranches);
        if (grantTranches.length) {
          grant.vestingTranches = grantTranches;
          grant.vestingMonths = 0;
          grant.cliffMonths = 0;
        } else if (grant.vestingMonths > 0
          && (s.vestingFrequency === 'quarterly' || s.vestingFrequency === 'annual')) {
          grant.vestingFrequency = s.vestingFrequency;
        }
        if (!grantTranches.length && grant.vestingMonths > 0 && str(s.vestingStart)) {
          const start = str(s.vestingStart).slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(start))
            || new Date(start).toISOString().slice(0, 10) !== start) throw new Error('Invalid vesting start date.');
          grant.vestingStart = start;
        }
        if (grantTranches.length || grant.vestingMonths > 0) Store.#applyAcceleration(grant, s);
        planOf(grant, s);
        out.push(grant);
      } else if (s.kind === 'rsu') {
        /* A unit is a promise of a share in a particular class, so the class
           is as load-bearing as it is on a warrant. */
        if (!classIds.has(classId) || int(s.quantity) <= 0) {
          if (s.proRata !== undefined) throw new FinancingError('An award with financing terms must have a valid class and positive quantity.');
          continue;
        }
        const quantity = int(s.quantity);
        const forfeits = Store.sanitizeCancellations(s.cancellations, {
          cancelled: s.cancelled, cancelledDate: s.cancelledDate, quantity, fallbackDate: base.date,
        });
        const cancelled = forfeits.reduce((a, c) => a + c.quantity, 0);
        const award = {
          ...base, kind: 'rsu', classId, quantity,
          grantDate: str(s.grantDate).slice(0, 10) || base.date,
          vestingMonths: months(s.vestingMonths),
          cliffMonths: Math.min(months(s.vestingMonths), int(s.cliffMonths)),
          // Settled and forfeited units are disjoint: what became shares can
          // never be handed back to the pool.
          settled: Math.min(quantity - cancelled, int(s.settled)),
        };
        if (cancelled > 0) {
          award.cancelled = cancelled;
          award.cancelledDate = forfeits[0].date;
          if (forfeits.length > 1) award.cancellations = forfeits;
        }
        // Opt-in, like every other flag here: an award written before the
        // field existed settles on vesting alone, which is what it meant.
        if (s.liquidityCondition === true) award.liquidityCondition = true;
        // The same schedule shapes as grants: custom tranches win, and a
        // time-based schedule may step quarterly or annually.
        const awardTranches = Store.sanitizeTranches(s.vestingTranches);
        if (awardTranches.length) {
          award.vestingTranches = awardTranches;
          award.vestingMonths = 0;
          award.cliffMonths = 0;
        } else if (award.vestingMonths > 0
          && (s.vestingFrequency === 'quarterly' || s.vestingFrequency === 'annual')) {
          award.vestingFrequency = s.vestingFrequency;
        }
        if (!awardTranches.length && award.vestingMonths > 0 && str(s.vestingStart)) {
          const start = str(s.vestingStart).slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(start))
            || new Date(start).toISOString().slice(0, 10) !== start) throw new Error('Invalid vesting start date.');
          award.vestingStart = start;
        }
        if (awardTranches.length || award.vestingMonths > 0) Store.#applyAcceleration(award, s);
        planOf(award, s);
        out.push(award);
      } else if (s.kind === 'warrant') {
        if (!classIds.has(classId) || int(s.quantity) <= 0) {
          if (s.proRata !== undefined) throw new FinancingError('An award with financing terms must have a valid class and positive quantity.');
          continue;
        }
        const warrant = {
          ...base, kind: 'warrant', classId, quantity: int(s.quantity),
          strike: Math.max(0, num(s.strike)),
          expires: str(s.expires).slice(0, 10),
        };
        const forfeits = Store.sanitizeCancellations(s.cancellations, {
          cancelled: s.cancelled, cancelledDate: s.cancelledDate,
          quantity: warrant.quantity, fallbackDate: base.date,
        });
        if (forfeits.length) {
          warrant.cancelled = forfeits.reduce((n, c) => n + c.quantity, 0);
          warrant.cancelledDate = forfeits[0].date;
          if (forfeits.length > 1) warrant.cancellations = forfeits;
        }
        out.push(warrant);
      } else if (s.kind === 'safe' || s.kind === 'note') {
        if (num(s.principal) <= 0) {
          if (s.mfn || s.proRata) throw new FinancingError('A convertible with rights needs a positive principal.');
          continue;
        }
        const conv = {
          ...base, kind: s.kind,
          principal: num(s.principal),
          valuationCap: Math.max(0, num(s.valuationCap)),
          discount: Math.min(99, Math.max(0, num(s.discount))),
        };
        // Post-money is opt-in on the way in: a record written before the
        // field existed meant a pre-money cap, and must keep meaning that.
        // The form defaults new SAFEs to post-money (the YC standard).
        if (s.kind === 'safe') conv.safeType = s.safeType === 'post' ? 'post' : 'pre';
        // Set once a round converts the instrument. The record stays for
        // history; it just stops counting as an outstanding convertible.
        if (str(s.convertedAt)) {
          conv.convertedAt = str(s.convertedAt).slice(0, 10);
          conv.convertedToId = str(s.convertedToId).slice(0, 40);
        }
        if (s.kind === 'note') {
          conv.interestRate = Math.min(50, Math.max(0, num(s.interestRate)));
          if (str(s.maturityDate)) conv.maturityDate = str(s.maturityDate).slice(0, 10);
          /* Set when maturity was dealt with outside the app - repaid,
             extended in writing, or rolled into a round. The instrument is
             untouched; this records that the date was handled. */
          if (str(s.maturedAt)) conv.maturedAt = str(s.maturedAt).slice(0, 10);
        }
        out.push(conv);
      }
    }
    assertUniqueTermIds(out);
    return out;
  }

  /* ---------- KV helpers ---------- */

  /**
   * A stored value, or the fallback when the key is simply absent.
   *
   * Everything this app writes goes through JSON.stringify, so a stored
   * string that won't parse is damage, not an empty collection - and the two
   * must not be confused. Reading damage as "absent" is what turns it into
   * loss: an unreadable registry would look like a fresh account and be
   * overwritten with an empty one, orphaning every company; an unreadable
   * securities list would load as [] and be cemented there by the next write.
   * The read fails loudly instead and leaves the stored bytes alone.
   */
  static #decode(raw, fallback, key) {
    if (raw === null || raw === undefined) return fallback;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { throw new CorruptDataError(key); }
    }
    return raw;
  }

  /** The stored bytes of a value, however the backend hands them back. */
  static #bytes(raw) {
    if (raw === null || raw === undefined) return null;
    return typeof raw === 'string' ? raw : JSON.stringify(raw);
  }

  /** Where a value too large for one KV entry keeps its nth part. */
  static #partKey(key, n, generation = '') {
    return `${key}${generation ? `:generation:${generation}` : ''}:part${n}`;
  }

  /**
   * Remove a key, and the numbered parts behind it when what it holds is the
   * marker for a value written across several.
   *
   * Deleting the key alone left the parts - the whole of a large collection,
   * and every restore point that stood behind one - in the user's cloud with
   * nothing pointing at them: a company deleted from the registry took its
   * markers with it and left megabytes of its data behind. Best-effort, like
   * every cleanup here; a part that survives is unreachable, not corruption.
   */
  static async #deleteParts(key, raw) {
    let marker;
    try { marker = Store.#decode(raw, null, key); } catch { return; }
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return;
    await Promise.allSettled(Array.from({ length: int(marker.__parts) }, (_, i) =>
      puter.kv.del?.(Store.#partKey(key, i + 1, marker.generation))));
  }

  static async #kvDelete(key) {
    await Store.#deleteParts(key, await deleteKV(key));
  }

  /**
   * Text cut into pieces that each fit one KV value.
   *
   * Cut by bytes rather than by characters, since that is what the limit is
   * counted in, and never between the two halves of a surrogate pair - a
   * broken pair would come back as replacement characters and the rejoined
   * JSON would not parse.
   */
  static chunkText(text, limit) {
    const out = [];
    const whole = (at) => {
      const code = text.charCodeAt(at - 1);
      return !(code >= 0xd800 && code <= 0xdbff);
    };
    let start = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + limit);
      while (end > start + 1 && !whole(end)) end -= 1;
      // One UTF-16 unit is at most three UTF-8 bytes, so this converges fast.
      while (end > start + 1 && textBytes(text.slice(start, end)) > limit) {
        end = start + Math.max(1, Math.floor((end - start) * 0.8));
        while (end > start + 1 && !whole(end)) end -= 1;
      }
      out.push(text.slice(start, end));
      start = end;
    }
    return out;
  }

  /**
   * A short digest of a value's text, carried on the marker that stands in
   * for a chunked value. The stale-write guard compares the bytes stored at
   * a key against the bytes this session last saw there, and a marker that
   * said only how many parts there are would read as unchanged while the
   * parts underneath it had been rewritten by another tab.
   */
  static #digest(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${text.length.toString(36)}.${h.toString(36)}`;
  }

  /**
   * What this session last saw at each key it has read or written.
   *
   * Refuses edits composed against an older collection. The conditional
   * publication in kv.js also refuses a writer overtaken AFTER this check,
   * including two sessions that read the same value at the same time.
   */
  #seen = new Map();

  /**
   * The value stored at a key, decoded from what the backend handed back.
   *
   * A marker standing in for a value too large for one entry is followed to
   * its parts, which are read back and rejoined. A missing part leaves JSON
   * that will not parse, which is damage and fails loudly rather than
   * reading as empty. Every read of a collection comes through here - the
   * load, and the check a write makes against a collection it does not
   * itself write - so that a collection stored in parts reads the same
   * whichever of the two is asking.
   */
  static async #stored(key, raw, fallback) {
    if (raw === null || raw === undefined) return fallback;
    const value = Store.#decode(raw, fallback, key);
    if (!(value && typeof value === 'object' && !Array.isArray(value) && int(value.__parts) > 0)) {
      return value;
    }
    /* All at once: the parts are immutable and independent, and fetched one
       after another a three-part collection cost three sequential round
       trips on every load and on every write's check of it. */
    const parts = await Promise.all(Array.from({ length: int(value.__parts) }, (_, i) =>
      puter.kv.get(Store.#partKey(key, i + 1, value.generation)).then((raw) => Store.#bytes(raw))));
    if (parts.some((part) => part === null)) throw new CorruptDataError(key);
    const text = parts.join('');
    if (value.digest && Store.#digest(text) !== value.digest) throw new CorruptDataError(key);
    return Store.#decode(text, fallback, key);
  }

  /**
   * Whether the value stored at a key is exactly `text` - read through its
   * parts when it is written across several. Compared on the bytes at the
   * key alone, a collection too large for one entry never matched the value
   * memory went back to, and every failed save of one rewrote the whole
   * collection under a fresh generation to put back what was already there.
   */
  static async #holds(key, raw, text) {
    if (Store.#bytes(raw) === text) return true;
    let marker;
    try { marker = Store.#decode(raw, null, key); } catch { return false; }
    if (!(marker && typeof marker === 'object' && !Array.isArray(marker) && int(marker.__parts) > 0)) return false;
    if (marker.digest && marker.digest !== Store.#digest(text)) return false;
    try { return JSON.stringify(await Store.#stored(key, raw, null)) === text; } catch { return false; }
  }

  /** A reader whose old generation was cleaned up retries the new root. */
  static async #readStored(key, fallback) {
    const read = async () => {
      try { return await getKV(key); } catch (err) {
        if (err instanceof KVReadError) throw new CorruptDataError(key);
        throw err;
      }
    };
    let raw = await read();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return { raw, value: await Store.#stored(key, raw, fallback) };
      } catch (err) {
        if (!(err instanceof CorruptDataError)) throw err;
        const latest = await read();
        if (Store.#bytes(latest) === Store.#bytes(raw)) throw err;
        raw = latest;
      }
    }
    throw new CorruptDataError(key);
  }

  async #kvGet(key, fallback, { lenient = false, array = Array.isArray(fallback) } = {}) {
    try {
      const { raw, value } = await Store.#readStored(key, fallback);
      this.#seen.set(key, Store.#bytes(raw));
      if (raw === null || raw === undefined) return fallback;
      // Valid JSON can still be damaged data: an object in place of a list
      // would otherwise be sanitized to [], then saved over on the next edit.
      if (value === null || typeof value !== 'object' || Array.isArray(value) !== array) {
        throw new CorruptDataError(key);
      }
      return value;
    } catch (err) {
      // Only for values that carry no user data and can be safely rebuilt.
      if (lenient && err instanceof CorruptDataError) return fallback;
      throw err;
    }
  }

  /**
   * Every value this session has sent to a key and not yet seen acknowledged.
   * A set can land and still reject - the connection dropping after the
   * server committed it - and the write that follows then finds the key
   * holding exactly what this session sent, which is not another tab's
   * change. Before this, a multi-key commit whose second set landed without
   * its acknowledgement had its compensating rewrite refused as stale: one
   * collection was stored with the change applied and the other without,
   * and the next load dropped every certificate of a holder the stakeholders
   * key no longer named.
   *
   * Every such value, not only the last: the rewrite is a send too, and when
   * it also rejected - the connection still down - it took the place of the
   * record of the first, so the retry found the first's bytes at the key
   * and refused them as someone else's.
   */
  #attempted = new Map();

  /** The keys the commit being persisted has sent a value to - see #commitNow. */
  #sent = new Set();

  #assertSeen(key, raw) {
    /* Only for a key this session has already seen: a key it has never read
       (a company being created, a legacy migration) has nothing to be stale
       against. */
    if (this.#seen.has(key)) {
      const current = Store.#bytes(raw);
      if (current !== this.#seen.get(key) && !this.#attempted.get(key)?.has(current)) {
        this.#stale = true;
        this.dispatchEvent(new Event('stale'));
        throw new StaleWriteError(key);
      }
    }
  }

  /** A value is about to be sent: from here on the key may hold it. */
  #sending(key, text) {
    if (!this.#attempted.has(key)) this.#attempted.set(key, new Set());
    this.#attempted.get(key).add(text);
    this.#sent.add(key);
  }

  /** The server confirmed the key holds this value; nothing else is owed to it. */
  #acknowledged(key, text) {
    this.#seen.set(key, text);
    this.#attempted.delete(key);
    this.#settle(key);
  }

  /**
   * Values this session owes storage.
   *
   * A commit that fails part-way is rolled back in memory and its stored
   * copies are rewritten to match. But the connection that failed the commit
   * can fail the rewrite too, and the rewrite's failure used to be swallowed:
   * memory showed the rollback, storage held one collection with the change
   * applied and another without, and the next load resolved the two the
   * only way it could - a stakeholder delete that had written its holders
   * and lost its securities came back with neither.
   *
   * Memory is right, so it is kept. Each value the rollback could not write
   * is held here against its key and written again until it lands: when the
   * shell sees the connection return, on its timer meanwhile, and on demand.
   * A value that lands, or is displaced by a later save of the same key, is
   * settled. One refused as stale is dropped - the key has moved on, and the
   * stale flag says so. Reloading while anything is owed would load the
   * half-applied commit, which the shell warns about.
   */
  #owed = new Map();

  /**
   * Whether anything is unfinished: a rollback this session still owes
   * storage, or a transaction - this session's or another's - whose durable
   * intent has not reached a decision. Both are shown with the recovery
   * banner; only the first needs this tab to stay open, see owesStorage.
   */
  get unsaved() {
    return this.#owed.size > 0 || this.#auditOwed.size > 0;
  }

  /**
   * Whether this session holds a value storage lacks. Only a rollback of a
   * key outside the journal (settings, activity, restore points) lives in
   * memory alone; a journaled transaction's before-state is durable and any
   * later load recovers it, so leaving the page loses nothing. Keyed on
   * `unsaved`, the leave-page prompt also stopped a reader that had merely
   * loaded while another tab was mid-save, over a change that was not its
   * own and needed nothing from it.
   */
  get owesStorage() {
    return this.#owed.size > 0;
  }

  #owe(key, value) {
    const was = this.unsaved;
    this.#owed.set(key, value);
    if (!was) this.dispatchEvent(new Event('unsaved'));
  }

  #settle(key) {
    if (!this.#owed.delete(key)) return;
    if (!this.unsaved) this.dispatchEvent(new Event('unsaved'));
  }

  /** Write every owed value once; what does not land stays owed. */
  async #flushOwed() {
    await Promise.allSettled([...this.#owed].map(([key, value]) => this.#kvSet(key, value, { owed: true })));
  }

  /**
   * Write what is owed to storage. Resolves true once nothing is: every
   * value landed, or was dropped because its key has changed elsewhere,
   * which `isStale` reports. Nothing is thrown; what did not land stays owed.
   */
  async retryUnsaved({ recoverPending = true } = {}) {
    if (!this.unsaved) return true;
    await this.#enqueue(async () => {
      await this.#flushOwed();
      for (const [id, pending] of this.#auditOwed) {
        try {
          const decision = (await new AuditJournal(pending.companyId).decision(id)).value;
          if (decision?.status === 'pending' && !recoverPending && !this.#auditLocalFailures.has(id)) continue;
          await new AuditJournal(pending.companyId).recover(pending, (write) => this.#restoreAuditWrite(write));
          this.#auditOwed.delete(id);
          this.#auditLocalFailures.delete(id);
          if (pending.companyId === this.#loadedCompanyId && (await new AuditJournal(pending.companyId).decision(id)).value?.status === 'completed') {
            await this.#loadCompany(); this.emit();
          }
        } catch { /* Durable intent remains pending for the next retry/reload. */ }
      }
      if (!this.unsaved) this.dispatchEvent(new Event('unsaved'));
    });
    return !this.unsaved;
  }

  /**
   * Store a value at a key. With `owed`, the value is one memory went back to
   * after a failed commit and the key may hold whatever that commit sent:
   * found already holding the value - the commit never reached it, or did and
   * was undone by an earlier rewrite - there is nothing to write.
   */
  /**
   * What a publication that may have landed left unresolved, per key: the
   * value the key held before it, whose parts are dead once anything else is
   * current, and the marker it tried to publish, whose parts are dead unless
   * it is current. An append can land with its acknowledgement lost, and at
   * that moment neither can be removed - the one is live if the other did
   * not land - so the answer waits for the next read of the key, which says
   * which of the two the key holds. Left unresolved, every such failure on a
   * collection written across parts kept a whole copy of it for good.
   */
  #superseded = new Map();

  /**
   * Remove whichever remembered generations the current value shows are dead.
   *
   * Nothing goes while the key still holds what it held: that says the
   * append has not landed, not that it never will. An append the client gave
   * up on can be committed by the server moments later - the very failure
   * the generation was kept for - and read here in between, the key's
   * unchanged head was taken as proof that it never would be and the new
   * parts deleted, so the marker then landed pointing at parts that were
   * gone, and the next load threw CorruptDataError over the whole account.
   * The entry waits instead, and is settled by the first read that finds
   * another value current: whatever did not win is dead by then, since a
   * publication is a conditional append that one value wins outright.
   */
  async #resolveSuperseded(key, current) {
    const pending = this.#superseded.get(key);
    if (!pending) return;
    const now = Store.#bytes(current);
    if (now === Store.#bytes(pending.previous)) return;
    this.#superseded.delete(key);
    const dead = [pending.previous, ...pending.attempted.filter((raw) => raw !== now)];
    await Promise.allSettled(dead.map((raw) => Store.#deleteParts(key, raw)));
  }

  /**
   * Bookkeeping for a publication that failed. One kv.js marks as unsent
   * never reached the append: the key still holds what it held, so nothing
   * is owed to it and nothing was superseded. One the server refused as
   * stale has a winner whose own cleanup takes the generation it replaced.
   * Anything else may have landed, and leaves the two candidates above to
   * the next read.
   */
  #noteFailure(key, text, err, previous, attempted) {
    if (err?.unsent) {
      this.#attempted.get(key)?.delete(text);
      this.#sent.delete(key);
      return;
    }
    if (err instanceof StaleWriteError) return;
    if (previous !== null && previous !== undefined || attempted) {
      // Added to what an earlier failure on the same key left waiting, not
      // over it: each attempted generation is a set of parts to account for.
      const pending = this.#superseded.get(key);
      this.#superseded.set(key, {
        previous: previous ?? null,
        attempted: [...(pending?.attempted ?? []), ...(attempted ? [attempted] : [])],
      });
    }
  }

  async #kvSet(key, value, { owed = false, auditExpected = null, auditRevision = null } = {}) {
    const text = JSON.stringify(value);
    let previous;
    let expected;
    try {
      const intent = !owed && !auditExpected ? this.#auditActive?.writes.find((w) => w.key === key) : null;
      expected = auditExpected || intent?.expected || await readKV(key);
      auditRevision ||= intent?.revision || null;
      previous = expected.raw;
      /* A key that reads as deleted, or a first write into a company the
         registry no longer names, belongs to a company another session has
         deleted since this one loaded it. Every key of a deleted company is
         tombstoned - and one never written has no tombstone to collide with,
         so the registry is asked on a key's first write, the one moment it
         is not already known. Written anyway, the save reported success and
         left live keys under a company nothing names: gone on reload. It is
         refused as stale instead - the banner says the cap table moved
         elsewhere, and a reload lands on a company that exists. The theme
         and the registry are not a company's; the activity log judges for
         itself (#persistActivity); a migration in progress has no registry
         yet and is left alone. */
      const companyId = Store.#companyOf(key);
      if (companyId && !key.endsWith(':activity:v1')) {
        let gone = !!expected.deleted;
        if (!gone && (previous === null || previous === undefined)) {
          const registry = Store.sanitizeRegistry(await Store.#readStored(REGISTRY_KEY, null).then((r) => r.value, () => null));
          gone = !!registry && !registry.companies.some((c) => c.id === companyId);
        }
        if (gone) {
          this.#stale = true;
          this.dispatchEvent(new Event('stale'));
          throw new StaleWriteError(key);
        }
      }
      await this.#resolveSuperseded(key, previous);
      if (owed && await Store.#holds(key, previous, text)) {
        this.#acknowledged(key, Store.#bytes(previous));
        return;
      }
      /* The theme is the one value with nothing to merge and nothing to lose:
         whichever device set it last is right. Refusing a collision on it
         would flag the session as behind - "your last change wasn't saved" -
         over a light-or-dark toggle made on a phone an hour earlier. */
      /* The same for a company's own flags (onboarded, sampleData): they
         describe the dataset, whose keys carry their own guards in the same
         commit, and a flag flipped in another tab cannot disagree with data.
         Held to the guard, a second tab closing the Welcome sheet made this
         tab's backup import refuse as stale - every data key rewritten empty,
         the session flagged behind - over a flag the import was about to write
         to the very same value. */
      /* And the activity log, whose collisions are merged rather than refused
         everywhere else (see #persistActivity): a whole-dataset commit - an
         import, a wipe, a restore - replaces the log along with the data, and
         a line another tab had appended to it meanwhile refused the whole
         operation as stale and marked the session behind, over a log the
         operation was about to replace. The data keys in the same commit keep
         their own guards, so a real foreign change still refuses it. */
      const lastWriterWins = key === GLOBAL_SETTINGS_KEY || key.endsWith(':settings:v1') || key.endsWith(':activity:v1');
      if (!lastWriterWins && !auditExpected) this.#assertSeen(key, previous);
    } catch (err) {
      // An owed value refused for the key having moved on can never land now.
      if (owed && err instanceof StaleWriteError) this.#settle(key);
      throw err;
    }
    if (textBytes(text) <= KV_VALUE_MAX_BYTES) {
      this.#sending(key, text);
      try {
        await this.#publish(key, expected, text, { owed, revision: auditRevision });
      } catch (err) {
        this.#noteFailure(key, text, err, previous, null);
        throw err;
      }
      this.#acknowledged(key, text);
      await Store.#deleteParts(key, previous);
      return;
    }
    // Each write owns immutable part keys. The root publishes them together;
    // overwriting shared part keys would expose half of each generation.
    const parts = Store.chunkText(text, KV_VALUE_MAX_BYTES);
    const marker = { __parts: parts.length, digest: Store.#digest(text), generation: crypto.randomUUID() };
    /* Whether the marker's publication was attempted. An append can land and
       still reject - the connection dropping after the server committed it -
       and cleaning the new parts up on that rejection left the stored marker
       pointing at parts that were gone: the key read back as damaged, the
       next load threw CorruptDataError, and the whole account was locked
       behind a reload button. A generation left behind by a marker that
       never landed is a leak; a marker whose parts are gone is corruption,
       so once the marker may have been published its parts stay. A failure
       kv.js marks as unsent never reached the append (the marker's own
       upload failed), so nothing can point at those parts and they go. */
    const encoded = JSON.stringify(marker);
    let published = false;
    try {
      /* Together, and settled together: written one after another the parts
         cost one round trip each, and a failure raced to before the others
         had settled could leave a late one landing after the cleanup below. */
      await finishWrites(parts.map((part, i) => puter.kv.set(Store.#partKey(key, i + 1, marker.generation), part)));
      this.#sending(key, encoded);
      published = true;
      await this.#publish(key, expected, encoded, { owed, revision: auditRevision });
      this.#acknowledged(key, encoded);
    } catch (err) {
      if (!published || err?.unsent || err instanceof StaleWriteError) await Store.#deleteParts(key, marker);
      if (published) this.#noteFailure(key, encoded, err, previous, encoded);
      throw err;
    }
    // Readers already on the old generation can retry if cleanup overtakes
    // them. Legacy unversioned markers are read and cleaned up the same way.
    await Store.#deleteParts(key, previous);
  }

  /** Publish against exactly the revision checked above, never a later one. */
  async #publish(key, expected, text, { owed, revision }) {
    const preference = key === GLOBAL_SETTINGS_KEY || key.endsWith(':settings:v1') || key.endsWith(':activity:v1');
    for (;;) {
      try {
        await compareAndSetKV(key, expected, text, revision ? { revision } : {});
        return;
      } catch (err) {
        if (!(err instanceof KVConflictError)) throw err;
        if (preference) {
          expected = await readKV(key);
          continue;
        }
        // The server positively refused this publication. It must not count
        // as an ambiguous send: rollback would otherwise be allowed to undo
        // a winner that happened to publish the same bytes as this loser.
        this.#attempted.get(key)?.delete(text);
        this.#sent.delete(key);
        if (owed) this.#settle(key);
        this.#stale = true;
        this.dispatchEvent(new Event('stale'));
        throw new StaleWriteError(key);
      }
    }
  }

  /** The KV key a collection lives at for a company. */
  #companyKey(field, companyId = this.activeCompanyId) {
    return `captable:${companyId}:${field}:v1`;
  }

  /** The company a key belongs to, or null for the account-wide keys (theme, registry, legacy singletons). */
  static #companyOf(key) {
    const parts = String(key).split(':');
    return parts.length === 4 && parts[0] === 'captable' ? parts[1] : null;
  }

  /**
   * The key/value pairs persisting one state field writes. Settings split
   * across two keys: the theme is account-wide, everything else (onboarded,
   * sampleData) belongs to the company it describes.
   *
   * With `every`, both settings keys are named whether or not their value
   * has changed - for the rollback of a commit that sent to them.
   */
  #fieldWrites(field, { every = false } = {}) {
    if (field !== 'settings') return [[this.#companyKey(field), this[field]]];
    const { theme, ...companyBits } = this.settings;
    /* The theme goes out only when it has changed from what this session
       last saw stored. Written along with every settings save, it landed
       on the account-wide key whenever onboarding finished, sample data
       loaded, or a backup was imported - and if another tab or device had
       switched the theme meanwhile, that write was refused as stale and
       the whole session marked behind, over a preference the save never
       meant to touch. Left out, the other device's choice also stands
       instead of being put back to this session's older one. */
    const writes = [];
    if (every || this.#settingsChanged(GLOBAL_SETTINGS_KEY, { theme })) {
      writes.push([GLOBAL_SETTINGS_KEY, { theme }]);
    }
    /* And the same the other way round: a theme toggle wrote this
       company's flags back too, so a tab that had never touched them
       found the key changed under it the next time it did. */
    if (every || this.#settingsChanged(this.#companyKey('settings'), companyBits)) {
      writes.push([this.#companyKey('settings'), companyBits]);
    }
    return writes;
  }

  /** Persist one state field. */
  async #persistField(field) {
    await finishWrites(this.#fieldWrites(field).map(([key, value]) => this.#kvSet(key, value)));
  }

  /** Whether a settings value differs from what this session last saw stored
   *  at its key. A key that was never written and an empty object say the
   *  same thing, so neither is a change from the other. */
  #settingsChanged(key, value) {
    const encoded = JSON.stringify(value);
    const stored = this.#seen.get(key);
    if (stored === encoded) return false;
    return !((stored === null || stored === undefined) && encoded === '{}');
  }

  /**
   * Writes run one at a time, in arrival order. #commit's rollback assumes
   * its snapshot describes the only change in flight - overlapping commits
   * would restore over each other's confirmed saves - and #activate moves
   * the company pointer that decides which keys every later write lands on.
   * Neither survives interleaving, so every KV write joins this queue.
   */
  #writeQueue = Promise.resolve();

  #enqueue(task) {
    const run = this.#writeQueue.then(task);
    // The queue outlives a failed write; only its own caller sees the error.
    this.#writeQueue = run.then(() => {}, () => {});
    return run;
  }

  /**
   * Optimistic write: `apply()` mutates state; on failure the saved fields are
   * restored and the error rethrown for the caller's toast.
   *
   * `apply()` runs when the write queue reaches this commit, not at call
   * time - so it reads the state every earlier commit left behind, never a
   * snapshot that an in-flight rollback could contradict.
   *
   * `apply()` is inside the rollback too, not just the persist. A multi-record
   * apply like closeRound writes several fields before it can discover that
   * one record is unissuable, and bailing out at that point would otherwise
   * leave half a round in memory - unpersisted, and contradicting the
   * "nothing was changed" the caller reports.
   *
   * A multi-key commit is several independent kv.set calls, so one can land
   * while another fails. Restoring memory alone would leave the stored copies
   * disagreeing with each other, which the sanitizers resolve destructively on
   * the next load: a half-saved stakeholder delete leaves securities pointing
   * at a holder that is gone, and sanitizeSecurities drops every one of them.
   * So a failed persist re-writes the restored state over whatever landed.
   *
   * Every write is pinned to the company it was composed against. A switch
   * queued behind a write in flight has not moved the pointer yet when the
   * next save is made: the shell is not inert, the old company is on screen,
   * and `switching` is still false - so a stakeholder, a class, a 409A or a
   * scenario saved in that window ran after the switch and landed under the
   * other company's keys, every call reporting success. The pin turns that
   * into the refusal updateCompany already made for its own form.
   *
   * The theme is the one setting that belongs to the account rather than a
   * company, so a save that touches only it goes through whichever company
   * is loaded by then.
   */
  async #commit(operation, fields, apply, keys, depends = [], { pinned = true } = {}) {
    const company = this.activeCompanyId;
    return this.#enqueue(() => {
      if (pinned && this.activeCompanyId !== company) throw new CompanyChangedError();
      return this.#commitNow(fields, apply, keys, depends, typeof operation === 'string' ? { operation } : operation);
    });
  }

  /**
   * A collection as it stands in storage, without marking it as seen - and
   * the bytes it was read from, which #assertUnmoved compares against once
   * the write it validated has landed.
   *
   * For validating a write against a collection it does not itself write.
   * The seen map must not move: it is what the stale-write guard compares a
   * write against, and refreshing it here would tell a later save of this
   * collection that this session's copy is current when it is not.
   */
  async #storedField(field) {
    const key = this.#companyKey(field);
    /* Through the same reader the load uses, so a collection written across
       numbered parts is rejoined here too. Decoded on its own, the marker
       that stands in for one read as an object where a list was expected,
       and the check saw an empty collection: a class was deleted out from
       under four thousand stored certificates because the list they were in
       had grown past one KV value. */
    const { raw, value } = await Store.#readStored(key, []);
    return { raw, value: Array.isArray(value) ? value : [] };
  }

  /**
   * That every collection a commit was checked against still holds what the
   * check read - asked after the commit's own write has landed.
   *
   * The check before apply() and the publication of the write are separate
   * round trips, and a commit in another session lands between them: an
   * issuance found its class stored, the class was deleted from a second
   * tab whose own check of the stored securities found no shares of it yet,
   * and then the certificate published. Both saves reported success, neither
   * session was told of a conflict, and the certificate was dropped on the
   * next load for want of its class. The publication is conditional only on
   * the key it writes, so a collection it was checked against has to be
   * asked again once the write is down. Two commits that each read the
   * other's key and then write their own cannot both find their dependency
   * unmoved afterwards: whichever write landed first is in place when the
   * other commit reads again. The one that finds a change is undone by the
   * caller like a failed write - the value it published is rewritten to
   * what it replaced - and refused as stale, which is what its session is.
   */
  async #assertUnmoved(observed) {
    if (!observed.size) return;
    const keys = [...observed.keys()];
    const current = await Promise.all(keys.map((key) => getKV(key)));
    keys.forEach((key, i) => {
      if (Store.#bytes(current[i]) === observed.get(key)) return;
      this.#stale = true;
      this.dispatchEvent(new Event('stale'));
      throw new StaleWriteError(key);
    });
  }

  async #commitNow(fields, apply, keys, depends = [], { operation = 'change', source = 'app', explanation = '', sourceArchive = null, forceAudit = false } = {}) {
    /* Every collection this commit reads and does not write, with the bytes
       the read found. Checked here before anything is applied, and asked
       again once the write has landed - see #assertUnmoved. */
    const observed = new Map();
    // Securities also depend on the company plans, classes and holders used to validate
    // them. Another tab can delete an unused class without changing the
    // securities key: issuing against our old copy then succeeds, but the
    // certificate disappears on reload. Check these read dependencies before
    // applying anything; collections this commit writes have their own guard.
    // Read together: each is a round trip or more, and the sheet waits.
    if (keys.includes('securities')) {
      const checked = ['company', 'classes', 'stakeholders']
        .filter((field) => !keys.includes(field))
        .map((field) => this.#companyKey(field))
        .filter((key) => this.#seen.has(key));
      const current = await Promise.all(checked.map((key) => getKV(key)));
      checked.forEach((key, i) => {
        this.#assertSeen(key, current[i]);
        observed.set(key, Store.#bytes(current[i]));
      });
    }
    /* Collections this write is checked against but does not write. The
       stale-write guard only ever compares the key it is about to write, so
       a rule that reads another collection was tested against whatever this
       session happened to have loaded - a class delete looked for issued
       shares in a list that predated them. Read inside the queue, so the
       check sees what is stored right now. */
    const stored = {};
    await Promise.all(depends.map(async (field) => {
      const { raw, value } = await this.#storedField(field);
      stored[field] = value;
      if (!keys.includes(field)) observed.set(this.#companyKey(field), Store.#bytes(raw));
    }));
    await this.#assertAuditDependencies(observed.keys());
    const auditBefore = Object.fromEntries(AUDIT_FIELDS.map((f) => [f, this[f]]));
    const prev = Object.fromEntries(fields.map((f) => [f, this[f]]));
    /* The epoch goes back with the data. An import or split that failed and
       rolled back left it bumped, so every pending undo refused with "the cap
       table has changed" over a cap table that had not. */
    const epoch = this.#dataEpoch;
    const restore = () => {
      Object.assign(this, prev);
      this.#dataEpoch = epoch;
      this.emit();
    };

    let result;
    try {
      result = apply(stored);
    } catch (err) {
      // Nothing was persisted yet, so memory is the only thing to undo.
      restore();
      /* A plain Error out of apply() is one of this file's own refusals, in
         the user's words - see isRefusal. A TypeError is a bug, and keeps
         reading as a failure. */
      if (err instanceof Error && err.constructor === Error) err.refused = true;
      throw err;
    }
    this.emit();
    this.#sent.clear();
    let audit = null;
    const journal = new AuditJournal(this.activeCompanyId);
    try {
      if (keys.some((key) => AUDIT_FIELDS.includes(key))) {
        for (const [id, pending] of this.#auditOwed) {
          if (pending.companyId !== this.activeCompanyId) continue;
          await new AuditJournal(pending.companyId).recover(pending, (write) => this.#restoreAuditWrite(write));
          this.#auditOwed.delete(id);
          if (!this.#auditLocalFailures.delete(id)) {
            this.#stale = true; this.dispatchEvent(new Event('stale'));
            throw new StaleWriteError(this.#companyKey('company'));
          }
        }
      }
      const businessKeys = keys.filter((key) => AUDIT_FIELDS.includes(key));
      const after = Object.fromEntries(businessKeys.map((f) => [f, this[f]]));
      if (businessKeys.length && (auditChanges(auditBefore, after).length || sourceArchive || explanation || forceAudit)) {
        const writes = await Promise.all(businessKeys.map(async (field) => {
          const key = this.#companyKey(field), expected = await readKV(key);
          this.#assertSeen(key, expected.raw);
          if (expected.deleted) {
            // Another tab deleted the company: said with the banner, not a toast alone.
            this.#stale = true; this.dispatchEvent(new Event('stale'));
            throw new StaleWriteError(key);
          }
          return { key, field, expected, revision: crypto.randomUUID(), before: auditBefore[field] };
        }));
        /* A key never written has no tombstone to say its company was
           deleted elsewhere, so on a collection's first write the registry
           is asked - the same rule #kvSet applies, asked here first so the
           refusal comes before the intent is journaled rather than after it
           has to be compensated. A key that holds a value says for itself. */
        if (writes.some((w) => w.expected.raw === null || w.expected.raw === undefined)) {
          const registry = Store.sanitizeRegistry(await Store.#readStored(REGISTRY_KEY, null).then((r) => r.value));
          if (registry && !registry.companies.some((c) => c.id === this.activeCompanyId)) {
            this.#stale = true; this.dispatchEvent(new Event('stale'));
            throw new StaleWriteError(this.#companyKey('company'));
          }
        }
        const actor = this.user ? { id: this.user.uuid || null, name: this.user.username || null } : { id: null, name: null };
        await journal.baseline(auditBefore, actor, this.activity);
        audit = await journal.prepare({ before: auditBefore, after, actor, operation, writes, source, explanation, sourceArchive });
        this.#auditActive = audit;
      }
      await finishWrites(keys.map((k) => this.#persistField(k)));
      await this.#assertUnmoved(observed);
      await this.#assertAuditDependencies(observed.keys(), audit?.id);
      if (audit) await journal.complete(audit);
      this.#auditActive = null;
    } catch (err) {
      this.#auditActive = null;
      restore();
      /* Every key the commit sent to may now hold its half of a change
         memory no longer has - or the whole of it, when a collection it was
         checked against moved meanwhile. Each is owed the value memory went
         back to and rewritten here - after every original write has settled,
         so none can land after the rewrite and undo it - and, should the
         connection refuse the rewrite too, again until it lands. See #owed. */
      for (const field of keys.filter((field) => !audit?.writes.some((w) => w.field === field))) {
        for (const [key, value] of this.#fieldWrites(field, { every: true })) {
          if (this.#sent.has(key)) this.#owe(key, value);
        }
      }
      await this.#flushOwed();
      if (audit) {
        try {
          await journal.recover(audit, (write) => this.#restoreAuditWrite(write), err.message);
          if ((await journal.decision(audit.id)).value?.status === 'completed') {
            await this.#loadCompany(); this.emit();
            return result;
          }
        } catch {
          const was = this.unsaved;
          this.#auditOwed.set(audit.id, audit);
          this.#auditLocalFailures.add(audit.id);
          if (!was) this.dispatchEvent(new Event('unsaved'));
        }
        /* The decision was moved by another session - a "Retry now" pressed
           in a second tab while this save was in flight, which fenced its
           keys and put the before-state back. Said as what it is to this
           session: a change made elsewhere, with the banner that says to
           reload. As the journal's own words it read as if some earlier
           change of the user's own were still waiting, and the banner only
           came up when the next save was refused as stale. */
        if (err instanceof AuditRecoveryError) {
          this.#stale = true; this.dispatchEvent(new Event('stale'));
          throw new StaleWriteError(audit.writes[0]?.key || this.#companyKey('company'));
        }
      }
      throw err;
    }
    return result;
  }

  #auditActive = null;
  #auditOwed = new Map();
  #auditLocalFailures = new Set();

  async #assertAuditDependencies(keys, ownId = null) {
    const wanted = new Set(keys);
    if (!wanted.size) return;
    const journal = new AuditJournal(this.activeCompanyId);
    const open = (status) => ['pending', 'compensating'].includes(status);
    for (const id of (await journal.head()).value.pending) {
      if (id === ownId) continue;
      // A decided entry cannot hold a dependency, and its intent may be gone.
      if (!open((await journal.decision(id)).value?.status)) continue;
      const event = await journal.pending(id);
      for (const write of event?.writes || []) {
        if (!wanted.has(write.key)) continue;
        const current = await readKV(write.key);
        // Asked again after the key: a transaction that completed between the two reads holds nothing.
        if (current.revision === write.revision && open((await journal.decision(id)).value?.status)) {
          this.#stale = true; this.dispatchEvent(new Event('stale'));
          throw new StaleWriteError(write.key);
        }
      }
    }
  }

  async #restoreAuditWrite(write) {
    for (;;) {
      const current = await readKV(write.key);
      const ours = current.revision === write.revision;
      if (!ours && current.revision !== write.expected.revision) {
        // A completed compensation is recognized by its retained before value.
        if (!(await Store.#holds(write.key, current.raw, JSON.stringify(write.before)))) {
          this.#attempted.delete(write.key);
          this.#stale = true; this.dispatchEvent(new Event('stale'));
        } else this.#acknowledged(write.key, Store.#bytes(current.raw));
        return false;
      }
      try {
        if (!ours) {
          // Fence the original revision without changing its payload or chunk
          // generation. This also blocks an append delayed at the server.
          const fenced = await compareAndSetKV(write.key, current, current.raw ?? JSON.stringify(write.before));
          this.#acknowledged(write.key, Store.#bytes(fenced.raw));
          await this.#resolveSuperseded(write.key, fenced.raw);
        } else {
          await this.#kvSet(write.key, write.before, { auditExpected: current });
        }
        return ours;
      } catch (err) {
        if (err instanceof StaleWriteError || err instanceof KVConflictError) continue;
        throw err;
      }
    }
  }

  auditPage(options = {}) { return new AuditJournal(this.activeCompanyId).page(options); }
  auditDetail(id) { return new AuditJournal(this.activeCompanyId).blob(id); }
  exportAudit(options = {}) { return new AuditJournal(this.activeCompanyId).export(options); }

  /* ---------- Init, migration, and the company registry ---------- */

  /** The registry entry of the loaded company. */
  get activeCompany() {
    return this.companies.find((c) => c.id === this.activeCompanyId) || null;
  }

  static sanitizeRegistry(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.companies)) return null;
    const seen = new Set();
    const companies = raw.companies
      .filter((c) => c && typeof c === 'object' && str(c.id))
      .map((c) => ({
        id: str(c.id).slice(0, 40),
        label: str(c.label).slice(0, 120),
        createdAt: num(c.createdAt, Date.now()),
      }))
      /* One entry per company. Two entries naming the same id name the same
         stored keys, so the second is a duplicate rather than a company - and
         deleting "the" company then filtered both out and read the first of
         nothing. */
      .filter((c) => !seen.has(c.id) && seen.add(c.id));
    if (!companies.length) return null;
    return { activeId: str(raw.activeId), companies };
  }

  async #saveRegistry() {
    await this.#kvSet(REGISTRY_KEY, { activeId: this.activeCompanyId, companies: this.companies });
  }

  async init() {
    this.user = await puter.auth.getUser().catch(() => null);
    const [globalSettings, registryRaw] = await Promise.all([
      // The theme carries no data and is rebuilt from the default, so a
      // damaged value here is not worth refusing to start over.
      this.#kvGet(GLOBAL_SETTINGS_KEY, null, { lenient: true }),
      this.#kvGet(REGISTRY_KEY, null),
    ]);
    this.settings = { theme: 'system', ...(globalSettings && typeof globalSettings === 'object' ? globalSettings : {}) };

    let registry = Store.sanitizeRegistry(registryRaw);
    if (registryRaw !== null && !registry) throw new CorruptDataError(REGISTRY_KEY);
    if (!registry) registry = await this.#migrateLegacy();
    this.companies = registry.companies;
    this.activeCompanyId = registry.companies.some((c) => c.id === registry.activeId)
      ? registry.activeId
      : registry.companies[0].id;
    if (this.activeCompanyId !== registry.activeId) await this.#saveRegistry();

    await this.#loadCompany();
    /* Best effort, like the read above it: the key can be absent, or hold a
       revision the lenient read passed over as damaged - and a write starts
       by reading the revision, which threw over the same damage and took the
       boot down with "check your connection" over a light-or-dark toggle,
       with every record of the company intact. */
    if (globalSettings === null) {
      await this.#kvSet(GLOBAL_SETTINGS_KEY, { theme: this.settings.theme }).catch(() => {});
    }
  }

  /**
   * First load on an account without a registry: whatever lives at the old
   * singleton keys becomes company #1, copied under its namespaced keys, and
   * the singletons are removed so the migration can never run twice against
   * data that has since diverged. A fresh account just gets an empty slot.
   */
  async #migrateLegacy() {
    const id = uid();
    const legacy = {};
    await Promise.all(Object.entries(LEGACY_KEYS).map(async ([field, key]) => {
      legacy[field] = await this.#kvGet(key, null, { array: field !== 'company' });
    }));
    const hasLegacy = Object.values(legacy).some((v) => v !== null);
    const label = str(legacy.company && typeof legacy.company === 'object' ? legacy.company.name : '').slice(0, 120);
    const registry = { activeId: id, companies: [{ id, label, createdAt: Date.now() }] };

    try {
      /* Inside the same try as the registry write: a copy that failed
         halfway left the copies already landed under an id nothing named,
         and the next boot migrated again under a fresh one - a full second
         copy of the company in the user's cloud, forever. */
      if (hasLegacy) {
        await Promise.all(Object.keys(LEGACY_KEYS)
          .filter((field) => legacy[field] !== null)
          .map((field) => this.#kvSet(this.#companyKey(field, id), legacy[field])));
        // onboarded/sampleData lived on the account-wide settings; they
        // describe this company now.
        const { theme, ...companyBits } = this.settings;
        await this.#kvSet(this.#companyKey('settings', id), companyBits);
      }
      await this.#kvSet(REGISTRY_KEY, registry);
    } catch (err) {
      /* The write may have landed with only its acknowledgement lost. Cleaned
         up as a failure, that left the worst of both: the next boot found a
         registry, skipped the migration, and loaded an empty company #1 -
         while the singletons, never removed, still held the whole cap table
         with nothing reading them. So read the key back first: a registry
         naming this id is this write, and the migration goes on as if it had
         resolved. */
      const landed = await this.#kvGet(REGISTRY_KEY, null, { lenient: true }).catch(() => null);
      const ours = Store.sanitizeRegistry(landed)?.companies.some((c) => c.id === id);
      if (!ours) {
        /* Nothing names the copies just written once the registry fails, and
           the next boot migrates again under a fresh id - so a first boot that
           lost its connection at the last write left a full second copy of the
           company in the user's cloud with nothing pointing at it. Best-effort,
           like every cleanup here: the singletons are still in place for the
           retry either way. */
        if (hasLegacy) {
          await Promise.allSettled(['settings', ...Object.keys(LEGACY_KEYS)]
            .map((field) => Store.#kvDelete(this.#companyKey(field, id))));
        }
        throw err;
      }
    }
    if (hasLegacy) {
      await Promise.all(Object.values(LEGACY_KEYS).map((key) => Store.#kvDelete(key))).catch(() => {});
    }
    return registry;
  }

  /**
   * The company whose data is actually in memory.
   *
   * Not the same thing as `activeCompanyId`, which is the pointer every
   * write lands on: a switch moves the pointer first and reads the new
   * company's collections afterwards, so between the two they name different
   * companies. Anything composed from what is loaded - a form filled in from
   * the profile on screen - belongs to this one, and hands it back when it
   * saves.
   */
  #loadedCompanyId = null;

  get loadedCompanyId() {
    return this.#loadedCompanyId;
  }

  /** Read every collection of the active company into state. */
  /**
   * The securities as sanitizeSecurities keeps them, with one difference: a
   * record whose holder the stakeholders list does not name is kept, under a
   * stand-in holder, instead of dropped.
   *
   * Only the load does this. Everywhere else a missing holder is bad input -
   * a backup edited by hand, a CSV row naming nobody - and dropping the record
   * is the validation. At load it is damage: a stakeholder delete that wrote
   * its holders and lost the connection before its securities, or a stale tab
   * putting an older holder list over a newer one. Resolved by dropping, the
   * certificates were gone from the next save on, with nothing said. Under
   * "Unknown holder" they stay on the cap table, where the user can see them
   * and put them right. A stand-in nothing survived under - the record was
   * dropped for a reason of its own, a missing class say - is not kept.
   */
  static recoverHolders(rawSecurities, { classes = [], stakeholders = [], plans = null } = {}) {
    const known = new Set(stakeholders.map((h) => h.id));
    const missing = [];
    for (const s of Array.isArray(rawSecurities) ? rawSecurities : []) {
      const id = s && typeof s === 'object' ? rid(s.stakeholderId) : '';
      if (id && !known.has(id)) {
        known.add(id);
        missing.push(id);
      }
    }
    const standIns = Store.sanitizeStakeholders(missing.map((id) => ({ id, name: 'Unknown holder', kind: 'entity' })));
    const securities = Store.sanitizeSecurities(rawSecurities, { classes, stakeholders: [...stakeholders, ...standIns], plans });
    const held = new Set(securities.map((s) => s.stakeholderId));
    const recovered = standIns.filter((h) => held.has(h.id))
      .map((h, i) => (i ? { ...h, name: `Unknown holder ${i + 1}` } : h));
    return {
      stakeholders: recovered.length ? [...stakeholders, ...recovered] : stakeholders,
      securities,
      recovered,
    };
  }

  async #loadCompany(attempt = 0) {
    const loading = this.activeCompanyId;
    const journal = new AuditJournal(loading);
    const pending = [];
    const observedHead = (await journal.head()).value;
    for (const id of observedHead.pending) {
      const decision = (await journal.decision(id)).value;
      const event = ['completed', 'compensated', 'rejected'].includes(decision?.status) ? null : await journal.pending(id);
      if (!event) {
        // Decided, with its index cleanup left to whoever reads next: this reader.
        await journal.release(id).catch(() => {});
        await journal.discardIntent(id);
        this.#auditOwed.delete(id);
        this.#auditLocalFailures.delete(id);
        continue;
      }
      pending.push(event);
    }
    const stored = {};
    await Promise.all(['settings', ...COMPANY_FIELDS].map(async (field) => {
      const key = this.#companyKey(field, loading);
      const value = await this.#kvGet(key, field === 'settings' || field === 'company' ? null : []);
      /* A value this session still owes the key stands in for what is stored
         there - see #owed. Switched away from and back to while the rewrite
         waits, the company would otherwise load the half-applied commit the
         rewrite is about to undo. */
      stored[field] = this.#owed.has(key) ? this.#owed.get(key) : value;
    }));
    // Readers do not cancel a live writer. Present its before-state until its
    // durable decision is known; retryUnsaved explicitly fences unfinished work.
    for (const event of pending) {
      const decision = (await journal.decision(event.id)).value;
      if (decision?.status === 'completed') {
        await Promise.all(event.writes.map(async (write) => { stored[write.field] = await this.#kvGet(write.key, write.field === 'company' ? null : []); }));
        continue;
      }
      for (const write of event.writes) {
        const current = await readKV(write.key);
        if (this.#auditOwed.has(event.id) || current.revision === write.revision || current.revision === write.expected.revision) {
          stored[write.field] = write.before;
        }
      }
      this.#auditOwed.set(event.id, event);
    }
    const latestHead = (await journal.head()).value;
    if (latestHead.latest !== observedHead.latest) {
      if (attempt >= 3) throw new AuditRecoveryError('The company is changing in another session. Try loading it again.');
      return this.#loadCompany(attempt + 1);
    }
    /* Sanitized into locals and assigned together. A sanitizer that refuses
       a record - a scenario carrying a field this version does not know -
       threw with the profile and the classes already assigned and every
       other collection still empty, and the recovery screen's restore then
       found data to snapshot: a restore point of that half-loaded state,
       pushing a real one off the list. A load that fails now leaves memory
       as it was, whichever step failed. */
    const settings = {
      theme: this.settings.theme || 'system',
      ...(stored.settings && typeof stored.settings === 'object' ? stored.settings : {}),
    };
    const company = Store.sanitizeCompany(stored.company);
    const classes = Store.sanitizeClasses(stored.classes);
    const { stakeholders, securities, recovered } = Store.recoverHolders(stored.securities, {
      classes,
      stakeholders: Store.sanitizeStakeholders(stored.stakeholders),
      plans: company.plans,
    });
    const scenarios = Store.sanitizeScenarios(stored.scenarios);
    const exits = Store.sanitizeExits(stored.exits);
    const hiring = Store.sanitizeHiring(stored.hiring);
    const activity = Store.sanitizeActivity(stored.activity);
    const restorePoints = Store.sanitizeRestorePoints(stored.restorePoints);
    Object.assign(this, { settings, company, classes, stakeholders, securities, recoveredHolders: recovered,
      scenarios, exits, hiring, activity, restorePoints });
    this.#loadedCompanyId = loading;
    this.#dataEpoch += 1;
    if (recovered.length) this.dispatchEvent(new Event('recovered'));
  }

  /**
   * Point the store at a company and read its collections in, restoring the
   * previous pointer if either step fails.
   *
   * The pointer decides which keys every later write lands on, while the
   * collections in memory still belong to the company that was loaded before.
   * Left mismatched by a failed switch - the caller only gets a toast, and the
   * app keeps running - the user's next edit would persist one company's
   * entire dataset over another's. #loadCompany assigns nothing unless all of
   * its reads resolve, so putting the pointer back is enough to match it to
   * the data still in memory.
   */
  async #activate(id, { add = null } = {}) {
    /* Out of service from the moment the switch is asked for, not from the
       moment its turn on the queue comes: with a write ahead of it the view
       stayed live for the length of that write, showing a company the next
       save could no longer land on (see #commit's pin). Counted, since a
       second switch can be asked for while the first waits. */
    this.#switchesPending += 1;
    this.#setSwitching(true);
    // On the write queue: a switch that lands mid-commit would re-point that
    // commit's rollback at the new company's keys - the queue makes every
    // in-flight write finish (or roll back) against its own company first.
    return this.#enqueue(async () => {
      try {
        return await this.#activateNow(id, { add });
      } finally {
        this.#switchesPending -= 1;
        if (this.#switchesPending === 0) this.#setSwitching(false);
      }
    });
  }

  /**
   * Whether the store is between companies: the pointer has moved to the one
   * being opened while the collections in memory - and everything drawn from
   * them on screen - still belong to the one being left. Any control in that
   * view would compose an edit from one company's data and commit it against
   * the other's keys, so the shell takes the view out of service while this
   * is true.
   */
  #switching = false;
  #switchesPending = 0;

  get switching() {
    return this.#switching;
  }

  #setSwitching(value) {
    if (this.#switching === value) return;
    this.#switching = value;
    this.dispatchEvent(new Event('switching'));
  }

  async #activateNow(id, { add = null } = {}) {
    const prevId = this.activeCompanyId;
    const prevCompanies = this.companies;
    /* The list is edited once the queue gets here, never handed in ready
       made: a rename still in flight when "New company" was clicked has
       landed by now, and a list built at click time would save its label
       over with the stale one. */
    const companies = add ? [...this.companies, add] : this.companies;
    /* Checked here as well as at the press: a delete of this very company
       queued ahead of the switch has run by now, and the switch would have
       pointed the registry - and every later write - at a company whose keys
       were going, with its data loaded on screen as the current one. */
    if (!add && !companies.some((c) => c.id === id)) throw refusal('That company is gone.');
    this.companies = companies;
    this.activeCompanyId = id;
    try {
      await this.#saveRegistry();
      await this.#loadCompany();
    } catch (err) {
      this.activeCompanyId = prevId;
      this.companies = prevCompanies;
      // Best-effort: the registry on disk may name the company that failed
      // to load, and the next boot should find the one actually in memory.
      await this.#saveRegistry().catch(() => {});
      throw err;
    }
    this.emit();
  }

  /** Load a different company. State swaps wholesale; views re-render. */
  async switchCompany(id) {
    if (id === this.activeCompanyId) return;
    if (!this.companies.some((c) => c.id === id)) throw refusal('That company is gone.');
    await this.#activate(id);
  }

  /** Add a company slot and switch to it (empty, ready for onboarding). */
  async createCompany(label = '') {
    const entry = { id: uid(), label: str(label).slice(0, 120), createdAt: Date.now() };
    await this.#activate(entry.id, { add: entry });
    return entry;
  }

  /**
   * Remove a company and its data. The last company can't be deleted -
   * wiping it is what "Delete all data" is for.
   */
  async deleteCompany(id) {
    const target = this.companies.find((c) => c.id === id);
    if (!target) return;
    if (this.companies.length <= 1) throw refusal('At least one company must remain.');
    const remaining = this.companies.filter((c) => c.id !== id);
    /* The files behind its attachments, read before its keys go. Every KV
       key of the company is removed below, but the signed agreements and
       409A reports its records pointed at live in the user's cloud under
       their own paths and were left there - a deleted company took its
       markers with it and left every file behind with nothing pointing at
       them, while the confirmation said its data was gone. Best-effort, like
       the key cleanup: a read that fails deletes no file. */
    const files = await this.#storedAttachmentPaths(id).catch(() => new Set());
    if (this.activeCompanyId === id) {
      /* Same hazard as a switch, and worse: a failed load here would leave
         the deleted company's data in memory pointed at a survivor's keys.
         The switch comes first and on its own, and the company leaves the
         registry only once the survivor is loaded. Dropped in the same
         write that moved the pointer, a survivor whose load then failed -
         with the connection refusing the rewrite that put the pointer back
         - left this company on screen under a stored registry that no
         longer named it: every later save landed on keys nothing would read
         again, and the next load opened the survivor with this company's
         data unreachable. */
      await this.#activate(remaining[0].id);
    }
    await this.#enqueue(async () => {
      const prevCompanies = this.companies;
      // Filtered here rather than at click time - see #activate.
      this.companies = this.companies.filter((c) => c.id !== id);
      try {
        await this.#saveRegistry();
      } catch (err) {
        /* A deletion the registry never recorded must not linger in
           memory: the caller was told nothing changed, yet the next
           unrelated registry write (a rename, a new company) would
           silently commit it - with the deleted company's data keys
           skipped by the cleanup below and orphaned forever. */
        this.companies = prevCompanies;
        throw err;
      }
      this.emit();
    });
    // Best-effort cleanup: a missed key is unreachable data, not corruption.
    // Settled rather than raced to the first failure, so one key that will
    // not go does not stop the rest from going.
    await Promise.allSettled(['settings', ...COMPANY_FIELDS]
      .map((field) => Store.#kvDelete(this.#companyKey(field, id))));
    // Nor is anything still owed to keys that are gone, and every generation
    // a failed write left unresolved behind them is dead with them.
    for (const field of ['settings', ...COMPANY_FIELDS]) {
      const key = this.#companyKey(field, id);
      this.#settle(key);
      const pending = this.#superseded.get(key);
      if (pending) {
        this.#superseded.delete(key);
        await Promise.allSettled([pending.previous, ...pending.attempted].filter(Boolean)
          .map((raw) => Store.#deleteParts(key, raw)));
      }
    }
    /* Best-effort, like the key cleanup above. The registry no longer names
       the company, so nothing can ask for this again: a purge that failed
       part-way rejected a deletion the registry had already made - the
       toast said the company could not be deleted while it was gone from
       the list - and the file cleanup below never ran, leaving every
       attachment behind. What a failed purge leaves is unreachable data,
       not corruption. */
    await new AuditJournal(id).purge().catch(() => {});
    for (const [transactionId, event] of this.#auditOwed) {
      if (event.companyId !== id) continue;
      this.#auditOwed.delete(transactionId);
      this.#auditLocalFailures.delete(transactionId);
    }
    this.dispatchEvent(new Event('unsaved'));
    await this.#deleteOrphanedFiles(files);
  }

  /**
   * Every attachment path a company's stored records name: on its
   * securities, its 409A valuations, and the copies of both inside its
   * restore points. Read from storage rather than memory, since the company
   * asked about is usually not the one loaded.
   */
  async #storedAttachmentPaths(companyId) {
    const read = async (field, fallback) => (
      await Store.#readStored(this.#companyKey(field, companyId), fallback)).value;
    const [securities, company, points] = await Promise.all([
      read('securities', []), read('company', null), read('restorePoints', []),
    ]);
    const paths = new Set();
    const collect = (records) => {
      for (const r of Array.isArray(records) ? records : []) {
        for (const a of Array.isArray(r?.attachments) ? r.attachments : []) {
          // Read raw from storage, so held to the same shape the sanitizer keeps.
          if (typeof a?.path === 'string' && Store.isAttachmentPath(a.path)) paths.add(a.path);
        }
      }
    };
    collect(securities);
    collect(company?.valuations);
    for (const p of Array.isArray(points) ? points : []) {
      collect(p?.data?.securities);
      collect(p?.data?.company?.valuations);
    }
    return paths;
  }

  /**
   * Remove the files at these paths, except any a company's stored records
   * still name - on its securities, its 409A valuations, or inside its
   * restore points. A backup imported into another company carries the same
   * paths, so the file behind "Signed SPA.pdf" can be referenced from two
   * cap tables at once: what a deleted company pointed at may be what a
   * survivor still opens, and the reference removed from the copy was over
   * the very file the original still carried. When any company cannot be
   * read, nothing is removed at all rather than guessed at.
   */
  async #deleteOrphanedFiles(paths) {
    if (!paths.size || typeof puter.fs?.delete !== 'function') return;
    const kept = new Set();
    try {
      for (const c of this.companies) {
        for (const p of await this.#storedAttachmentPaths(c.id)) kept.add(p);
      }
    } catch {
      return;
    }
    await Promise.allSettled([...paths]
      .filter((p) => !kept.has(p))
      .map((p) => puter.fs.delete(p)));
  }

  /* ---------- Settings & company ---------- */

  async updateSettings(patch) {
    return this.#commit('updateSettings', ['settings'], () => {
      this.settings = { ...this.settings, ...patch };
    }, ['settings'], [], { pinned: Object.keys(patch).some((k) => k !== 'theme') });
  }

  /**
   * The switcher names companies off the registry, so whenever the profile
   * name changes - a rename, an import, sample data - the entry follows.
   * Best-effort: the profile is the truth, the label is a copy of it.
   * Callers wait for the attempt so a reload after an acknowledged rename,
   * import, or wipe does not race the extra round trips of publication.
   *
   * Including when the profile name goes away. A wipe (or an import of a
   * dataset with no company name) leaves an empty cap table, and a label that
   * stayed behind would keep naming it after the company that was deleted -
   * in the sidebar, the switcher, the settings list, and the import dialog -
   * while onboarding asks for a company name underneath it.
   */
  /* `committed` is { id, name } captured inside the write's apply(), which is
     the only moment both are certainly about the same company. Read off the
     store after the write resolved instead, they came apart: a switch queued
     behind the write moves the company pointer as soon as its turn comes,
     before the other company's data has loaded - and a rename of Acme that
     resolved a microtask later found Beta's registry entry under Acme's
     still-loaded profile, and labelled Beta "Acme". */
  #syncRegistryLabel({ id, name }) {
    const entry = this.companies.find((c) => c.id === id);
    if (!entry || entry.label === name) return;
    this.companies = this.companies.map((c) => (c.id === id ? { ...c, label: name } : c));
    this.emit();
    return this.#enqueue(() => this.#saveRegistry()).catch(() => {});
  }

  /** The registry label a write leaves its company with, read inside apply(). */
  #committedName() {
    return { id: this.activeCompanyId, name: this.company.name };
  }

  /**
   * `companyId` names the company the caller composed this patch against. A
   * form reads the profile on screen when it opens and saves whatever the
   * user typed over it, so a save that arrives after the store has moved to
   * another company would write the old profile into the new company. Naming
   * the company the form was opened for makes that a refusal instead.
   */
  async updateCompany(patch, { companyId = null } = {}) {
    const committed = await this.#commit('updateCompany', ['company'], () => {
      if (companyId && companyId !== this.activeCompanyId) throw new CompanyChangedError();
      /* A pool size in the patch is a resize effective today. The pool sheet
         comes through resizePool with the date the user picked; this is the
         plain edit, dated the day it was made. */
      const { poolAuthorized, ...rest } = patch;
      let company = Store.sanitizeCompany({ ...this.company, ...rest });
      if (poolAuthorized !== undefined) company = Store.poolResized(company, poolAuthorized, todayISO());
      this.company = company;
      return this.#committedName();
    }, ['company']);
    await this.#syncRegistryLabel(committed);
  }

  /**
   * Set the authorized option pool as of a date. The size is in today's share
   * units, like every count typed into the app; the date says when the
   * reserve took effect, so a snapshot of an earlier day reads the pool as it
   * stood before. Today at the latest, as a split is: the pool is restated on
   * the spot, and there is nowhere to hold "will be".
   */
  async resizePool({ size, date }) {
    const when = str(date).slice(0, 10);
    if (!when) throw refusal('Pick an effective date.');
    if (!isISODate(when)) throw refusal('Pick a valid effective date.');
    if (when > todayISO()) throw refusal('The pool can’t be resized as of a future date.');
    const n = num(size, NaN);
    if (!Number.isInteger(n) || n < 0) throw refusal('Enter the pool size in whole shares.');
    if (this.company.plans.length > 1) {
      throw refusal('This company has several equity plans. Resize each plan’s reserve under Share classes.');
    }
    return this.#commit('resizePool', ['company'], ({ securities }) => {
      /* Not below what the plan has granted - checked here, against the
         awards as they stand when the queue gets here and as another tab
         stored them, not only in the sheet at the moment it opened. A grant
         deleted with its Undo toast still up, the sheet opened, the Undo
         pressed and the smaller size saved left a pool of one share under
         261,000 granted options; this commit writes only the company, so
         the stale-write guard never looked at a grant another tab issued.
         Zero stays a deliberate "no pool", as the sheet reads it. */
      const granted = Math.max(poolDrawn(this.securities), poolDrawn(securities));
      if (n > 0 && n < granted) {
        throw new Error(`The pool can’t be smaller than the ${granted.toLocaleString('en-US')} shares already granted.`);
      }
      const next = Store.poolResized(this.company, n, when);
      // Zero is exempt above, and here: a deliberate "no pool" on any date.
      if (n > 0) {
        this.#assertReserveHolds(next, [this.securities, securities], (hit, company) => {
          const day = hit.reserve + hit.shortfall;
          const today = inTodaysShares(company, hit, day);
          return `The pool had ${fmtCount(day)} shares granted from it ${drawnDay(hit)}${restatedNote(day, today)}, `
            + `so it can’t be smaller than ${today === day ? 'that' : fmtCount(today)} ${heldDay(hit)}.`;
        });
      }
      this.company = next;
    }, ['company'], ['securities']);
  }

  /**
   * A dated change to a reserve has to hold on every day since it, not only
   * today. A resize dated back to June that left the plan smaller than what
   * June's grants had drawn was accepted - the floor was today's balance -
   * and wrote a shortfall into the plan's history: the June table read the
   * pool short, and the next award dated inside it was refused for a
   * shortfall the grant had nothing to do with, with a message blaming the
   * grant. The same day-by-day sweep the awards are held to, run over the
   * company before and after the change, against the securities as this
   * session and the store hold them.
   */
  #assertReserveHolds(company, lists, wording) {
    for (const securities of lists) {
      const hit = reserveShortfall({ ...this.db, securities }, { ...this.db, company, securities });
      if (hit) throw new Error(wording(hit, company));
    }
  }

  /* ---------- Equity incentive plans ---------- */

  plan(id) {
    return this.company.plans.find((p) => p.id === id) || null;
  }

  /** The plan already on file under a name, case and surrounding space aside. */
  #planNamed(name, exceptId = null) {
    const key = str(name).slice(0, PLAN_NAME_MAX).toLowerCase();
    return this.company.plans.find((p) => p.id !== exceptId && p.name.toLowerCase() === key) || null;
  }

  /**
   * The fields a plan sheet writes, checked the way the sheet checks them:
   * a name nobody else has, an adoption date, a class that exists, at least
   * one award kind, an expiration after the adoption, and recycling rules
   * that name plans on file - never the plan itself.
   */
  #planFields(input, existing = null) {
    const name = str(input.name).slice(0, PLAN_NAME_MAX);
    if (!name) throw new Error('Name the plan.');
    const twin = this.#planNamed(name, existing?.id);
    if (twin) throw new Error(`A plan named "${twin.name}" is already on file.`);
    /* A new plan is adopted on a date. A plan that came over from the one
       pool has none recorded (see legacyPlan), and stays editable without
       one until someone fills it in - but a date once recorded is not
       cleared by an edit, which would quietly lift the refusal of awards
       dated before it. */
    const adopted = str(input.adopted ?? existing?.adopted).slice(0, 10);
    if (!adopted && (!existing || existing.adopted)) throw new Error('Pick the plan’s adoption date.');
    if (adopted && !isISODate(adopted)) throw new Error('Pick a valid adoption date.');
    const classId = rid(input.classId ?? existing?.classId ?? '');
    /* A class picked now has to be on file. One the plan already names and
       the edit leaves alone may have been deleted since - the exercise sheets
       fall back to common when it is - and refusing it here locked a retired
       plan out of reopening, and out of every edit that never touched it. */
    if (classId && classId !== (existing?.classId || '') && !this.shareClass(classId)) throw new Error('That share class is gone.');
    const types = Array.isArray(input.awardTypes) ? input.awardTypes : (existing?.awardTypes || ['option', 'rsu']);
    const awardTypes = [...new Set(types.filter((t) => t === 'option' || t === 'rsu'))];
    if (!awardTypes.length) throw new Error('Pick at least one kind of award the plan is written for.');
    const expires = str(input.expires ?? existing?.expires ?? '').slice(0, 10);
    if (expires && !isISODate(expires)) throw new Error('Pick a valid expiration date.');
    if (expires && expires <= adopted) throw new Error('The plan’s expiration date must be after its adoption date.');
    const recycling = Store.sanitizeRecycling({ ...(existing?.recycling || {}), ...(input.recycling || {}) });
    for (const { value: event, label } of RECYCLING_EVENTS) {
      const rule = recycling[event];
      if (rule === 'return' || rule === 'retire') continue;
      if (existing && rule === existing.id) throw new Error('A plan can’t pour shares over into itself.');
      if (!this.plan(rule)) throw new Error(`The plan named for ${label.toLowerCase()}s is gone.`);
    }
    return { name, adopted, classId, awardTypes, expires, recycling };
  }

  /**
   * Whether every plan still covers what is committed under it once the
   * company record changes - a recycling rule turned from returning shares
   * to retiring them, a pour-over redirected. Only a plan the change pushes
   * further below zero is refused: imported awards may already outrun a
   * reserve, and that is the share classes page's to name, not this edit's
   * to fix.
   *
   * Held day by day, as a resize or an award is (see reserveShortfall), not
   * to today's balance alone. A rule applies to every forfeiture on record,
   * so turning returns into retirements re-commits shares on the days they
   * came back - and a plan whose reserve was raised since read fine today
   * while a grant funded by a 2022 return now sat in a 2022 shortfall that
   * every later transfer or resize dated inside it was refused for.
   */
  #assertReservesHold(before, after, lists) {
    for (const securities of lists) {
      const hit = reserveShortfall({ ...this.db, company: before, securities }, { ...this.db, company: after, securities });
      if (!hit) continue;
      const today = inTodaysShares(after, hit, hit.shortfall);
      throw new Error(`${hit.plan.name} would have ${fmtCount(hit.shortfall)} more shares committed than reserved`
        + `${hit.date ? ` on ${hit.date}` : ''}${restatedNote(hit.shortfall, today)}. `
        + `Resize its reserve${hit.date ? ' as of that day' : ''} first.`);
    }
  }

  /**
   * Adopt an equity incentive plan: its reserve is dated the adoption. The
   * first plan a company adopts takes on the awards already on file that
   * never said which plan they draw from - the way every award drew the one
   * pool - unless `assignExisting` is off, in which case they are marked as
   * outside every plan, which is the other thing they could be.
   */
  async addPlan(input, { assignExisting = true } = {}) {
    const first = !this.company.plans.length;
    /* The second plan is the first moment an award naming no plan could be
       read two ways. Under one plan every such award drew it - a record
       written before plans existed reads that way from the moment it is
       loaded - but only in memory: the stored copy still names nothing, and
       reloaded against two plans it fell outside both, or was refused by
       the import that carried it. So adopting the second plan writes the
       awards down with the plan they have been drawing all along. */
    const second = this.company.plans.length === 1;
    const keys = first || second ? ['company', 'securities'] : ['company'];
    return this.#commit('addPlan', keys, () => {
      const plans = this.company.plans;
      if (plans.length >= MAX_PLANS) {
        throw new ListFullError(`This company already holds ${MAX_PLANS} equity plans, the most it can keep.`);
      }
      const fields = this.#planFields(input);
      if (fields.adopted > todayISO()) throw new Error('A plan can’t be adopted as of a future date.');
      const reserve = num(input.reserve, 0);
      if (!Number.isInteger(reserve) || reserve < 0) throw new Error('Enter the reserve in whole shares.');
      // Resolve recycling targets against all existing plans, not an isolated
      // new record that would discard every successor reference.
      const plan = Store.sanitizePlans([...plans, { ...fields, id: uid(), status: 'active', reserve: 0, reserveHistory: [], createdAt: Date.now() }]).at(-1);
      let company = Store.sanitizeCompany({ ...this.company, plans: [...plans, plan] });
      if (reserve > 0) company = Store.planResized(company, plan.id, reserve, fields.adopted, { kind: 'adoption' });
      if (!plans.length) {
        const unassigned = this.securities.filter((a) => (a.kind === 'option' || a.kind === 'rsu') && !a.planId && !a.outsidePlan);
        if (unassigned.length && assignExisting) {
          for (const a of unassigned) {
            if (!planAccepts(plan, a.kind, securityDate(a))) {
              // The remedy follows the cause: an expired plan is not fixed by an earlier adoption.
              const expired = plan.expires && securityDate(a) > plan.expires;
              throw new Error(`${a.label}: ${planRefusal(plan, a.kind, securityDate(a))} `
                + (expired
                  ? 'Set the plan’s expiration after its latest award, or leave the existing awards outside it.'
                  : 'Adopt the plan on or before its earliest award, or leave the existing awards outside it.'));
            }
          }
          const drawn = poolDrawn(unassigned);
          if (reserve < drawn) {
            throw new Error(`The reserve can’t be smaller than the ${fmtCount(drawn)} shares already granted under the awards it takes on.`);
          }
          this.securities = this.securities.map((a) => (unassigned.includes(a) ? { ...a, planId: plan.id } : a));
        } else if (unassigned.length) {
          this.securities = this.securities.map((a) => (unassigned.includes(a) ? { ...a, outsidePlan: true } : a));
        }
      } else if (plans.length === 1) {
        // Said in the record now, before there are two plans to choose between.
        const only = plans[0];
        this.securities = this.securities.map((a) => ((a.kind === 'option' || a.kind === 'rsu') && !a.planId && !a.outsidePlan
          ? { ...a, planId: only.id } : a));
      }
      this.company = company;
      return company.plans.find((p) => p.id === plan.id);
    }, keys, ['securities']);
  }

  /**
   * Edit a plan's terms. The dates and kinds an amendment moves are held to
   * the awards already granted under it: the adoption cannot move past an
   * award or the first reserve change, the expiration cannot fall before an
   * award, and a kind in use cannot be dropped. A rule change that would
   * leave a plan with more committed than reserved is refused too. `status:
   * 'active'` reopens a retired plan.
   */
  async updatePlan(id, patch) {
    /* A plan no longer written for option grants cannot hold a planned one:
       the roles naming it take the default plan, as they do when it is
       retired. Written only when the kinds move, so a rename stays one key. */
    const dropsOptions = Array.isArray(patch.awardTypes) && !patch.awardTypes.includes('option');
    const keys = dropsOptions && this.hiring.some((h) => h.planId === id) ? ['company', 'hiring'] : ['company'];
    return this.#commit('updatePlan', keys, ({ securities }) => {
      const before = this.plan(id);
      if (!before) throw new Error('That plan is gone.');
      const fields = this.#planFields({ ...before, ...patch }, before);
      /* The awards as this session and storage hold them, one record per id:
         a grant issued in another tab is in the stored list alone, and one
         this session just issued is in memory alone. */
      const awards = [...new Map([...this.securities, ...securities]
        .filter((a) => (a.kind === 'option' || a.kind === 'rsu') && a.planId === id)
        .map((a) => [a.id, a])).values()];
      const dates = awards.map((a) => securityDate(a)).filter(Boolean).sort();
      if (fields.adopted !== before.adopted) {
        if (fields.adopted > todayISO()) throw new Error('A plan can’t be adopted as of a future date.');
        if (dates.length && fields.adopted > dates[0]) {
          const first = awards.find((a) => securityDate(a) === dates[0]);
          throw new Error(`${first.label} was granted on ${dates[0]} under this plan, so it can’t have been adopted after that.`);
        }
        const entries = (before.reserveHistory || []).map((e) => e.date).filter(Boolean).sort();
        if (entries.length && fields.adopted > entries[0]) {
          throw new Error(`This plan’s reserve was first set on ${entries[0]}, so it can’t have been adopted after that.`);
        }
      }
      for (const { value: kind, noun } of [{ value: 'option', noun: 'option grants' }, { value: 'rsu', noun: 'RSU awards' }]) {
        const held = awards.filter((a) => a.kind === kind).length;
        if (held && !fields.awardTypes.includes(kind)) {
          throw new Error(`${fmtCount(held)} ${held === 1 ? noun.slice(0, -1) : noun} ${held === 1 ? 'draws' : 'draw'} from this plan, so it can’t stop being written for them.`);
        }
      }
      if (fields.expires && dates.length && fields.expires < dates[dates.length - 1]) {
        throw new Error(`An award under this plan is dated ${dates[dates.length - 1]}, so the plan can’t have expired before that.`);
      }
      const next = { ...before, ...fields };
      if (patch.status === 'active' && before.status === 'retired') {
        next.status = 'active';
        delete next.retiredAt;
      }
      const company = Store.sanitizeCompany({ ...this.company, plans: this.company.plans.map((p) => (p.id === id ? next : p)) });
      this.#assertReservesHold(this.company, company, [this.securities, securities]);
      this.company = company;
      if (keys.includes('hiring')) this.hiring = Store.sanitizeHiring(this.hiring.map((h) => (h.planId === id ? { ...h, planId: '' } : h)));
      return company.plans.find((p) => p.id === id);
    }, keys, ['securities']);
  }

  /**
   * Delete a plan nothing refers to: no award draws from it, no other plan
   * pours shares into it, no transfer links its history to another's. A
   * plan with any of those is retired instead, which keeps them.
   */
  async deletePlan(id) {
    /* The hiring plan is written whether or not this session's copy names
       the plan: the rows are read inside the queue, where a role planned a
       moment ago - queued ahead of this write, or saved in another tab - is
       on the list. Decided at call time from the list in memory, a role
       naming the plan stayed on it after the plan was gone. */
    const keys = ['company', 'hiring'];
    return this.#commit('deletePlan', keys, ({ securities }) => {
      const plan = this.plan(id);
      if (!plan) throw new Error('That plan is gone.');
      const drawing = [...this.securities, ...securities].filter((a) => a.planId === id);
      if (drawing.length) {
        const n = new Set(drawing.map((a) => a.id)).size;
        throw new Error(`${fmtCount(n)} ${n === 1 ? 'award draws' : 'awards draw'} from ${plan.name}. Move them to another plan, or retire the plan instead.`);
      }
      const pours = this.company.plans.find((p) => p.id !== id && Object.values(p.recycling || {}).includes(id));
      if (pours) throw new Error(`${pours.name} pours shares over into ${plan.name}. Change its recycling rules first.`);
      const linked = this.company.plans.find((p) => p.id !== id && (p.reserveHistory || []).some((e) => e.planId === id));
      if (linked) throw new Error(`Shares were transferred between ${plan.name} and ${linked.name}, so it can’t be deleted. Retire it instead.`);
      const aggregate = int(this.company.poolAuthorized);
      const reserve = planReserve(plan);
      const plans = this.company.plans.filter((p) => p.id !== id);
      this.company = Store.sanitizeCompany({
        ...this.company,
        plans,
        poolAuthorized: aggregate - reserve,
        // With no plans left, the legacy mirror must be empty too, or the
        // migration recreates the deleted plan. The journal keeps its history.
        poolHistory: !plans.length ? [] : reserve > 0
          ? [...this.company.poolHistory, { date: todayISO(), before: aggregate, after: aggregate - reserve, seq: Store.nextPoolSeq(this.company) }]
          : this.company.poolHistory,
      });
      this.hiring = Store.sanitizeHiring(this.hiring.map((h) => (h.planId === id ? { ...h, planId: '' } : h)));
    }, keys, ['securities']);
  }

  /**
   * Set a plan's reserve as of a date - the pool sheet's resize, per plan.
   * Today at the latest, on or after the adoption, and never below what the
   * plan's awards have committed, measured against this session's awards
   * and the stored ones alike (see resizePool for why).
   */
  async resizePlanReserve(id, { size, date, reason = '' }) {
    const when = str(date).slice(0, 10);
    if (!when) throw refusal('Pick an effective date.');
    if (!isISODate(when)) throw refusal('Pick a valid effective date.');
    if (when > todayISO()) throw refusal('A reserve can’t be resized as of a future date.');
    const n = num(size, NaN);
    if (!Number.isInteger(n) || n < 0) throw refusal('Enter the reserve in whole shares.');
    return this.#commit('resizePlanReserve', ['company'], ({ securities }) => {
      const plan = this.plan(id);
      if (!plan) throw new Error('That plan is gone.');
      if (plan.adopted && when < plan.adopted) {
        throw new Error(`${plan.name} was adopted on ${plan.adopted}, so its reserve can’t change before that.`);
      }
      const floor = Math.max(0, ...[this.securities, securities].map((list) => {
        const row = planBalances({ company: this.company, securities: list }).plans.find((r) => r.planId === id);
        return row ? row.reserve - row.available : 0;
      }));
      if (n < floor) {
        throw new Error(`${plan.name}’s reserve can’t be smaller than the ${fmtCount(floor)} shares already committed under it.`);
      }
      const next = Store.planResized(this.company, id, n, when, { kind: 'resize', reason });
      this.#assertReserveHolds(next, [this.securities, securities], (hit, company) => {
        const day = hit.reserve + hit.shortfall;
        const today = inTodaysShares(company, hit, day);
        return `${hit.plan.name} had ${fmtCount(day)} shares committed under it ${drawnDay(hit)}${restatedNote(day, today)}, `
          + `so its reserve can’t be smaller than ${today === day ? 'that' : fmtCount(today)} ${heldDay(hit)}.`;
      });
      this.company = next;
    }, ['company'], ['securities']);
  }

  /* What a plan can spare on a day and today, whichever is less. */
  #reserveToSpare(planId, when, lists, company = this.company) {
    return Math.min(...lists.map((list) => {
      const db = { company, classes: this.classes, stakeholders: this.stakeholders, securities: list };
      const now = planBalances(db).plans.find((r) => r.planId === planId)?.available ?? 0;
      const then = planBalances(dbAsOf(db, when)).plans.find((r) => r.planId === planId)?.available ?? 0;
      // Transfer quantities use today's units; dbAsOf uses the units of the
      // historical day. Compare like units, without rounding room upward.
      return Math.min(now, Math.floor(then / unsplitFactor(company, when)));
    }));
  }

  /**
   * Move unallocated shares from one plan's reserve to another's as of a
   * date, in one commit: two linked entries under one transfer id and one
   * sequence number, so each plan's history names the other and the same
   * shares are never counted twice. Held to what the source had available on
   * the day and still has today; the destination must be open.
   */
  async transferReserve({ fromPlanId, toPlanId, quantity, date, reason = '' }) {
    const when = str(date).slice(0, 10);
    if (!when) throw refusal('Pick the transfer date.');
    if (!isISODate(when)) throw refusal('Pick a valid transfer date.');
    if (when > todayISO()) throw refusal('A transfer can’t be dated in the future.');
    const q = num(quantity, NaN);
    if (!Number.isInteger(q) || q <= 0) throw refusal('Enter how many shares move, in whole shares.');
    if (fromPlanId === toPlanId) throw refusal('Pick two different plans.');
    return this.#commit('transferReserve', ['company'], ({ securities }) => {
      const from = this.plan(fromPlanId);
      const to = this.plan(toPlanId);
      if (!from || !to) throw new Error('That plan is gone.');
      if (!planIsOpen(to)) throw new Error(`${to.name} has been retired, so shares can’t move into it.`);
      /* Nor into a plan past its expiration: nothing can be granted from
         them there, and they would go on sitting in the fully diluted count
         under the plan-expired item until someone moved them back. */
      if (to.expires && to.expires < when) throw new Error(`${to.name} expired on ${to.expires}, so shares can’t move into it on ${when}.`);
      for (const plan of [from, to]) {
        if (plan.adopted && when < plan.adopted) throw new Error(`${plan.name} was adopted on ${plan.adopted}, after this transfer date.`);
      }
      const room = this.#reserveToSpare(fromPlanId, when, [this.securities, securities]);
      if (q > room) {
        throw new Error(room > 0
          ? `${from.name} has ${fmtCount(room)} ${room === 1 ? 'share' : 'shares'} available to move as of ${when}.`
          : `${from.name} has nothing available to move as of ${when}.`);
      }
      const transferId = uid();
      const seq = Store.nextPoolSeq(this.company);
      const link = { kind: 'transfer', reason, transferId, seq, mirror: false };
      let company = Store.planResized(this.company, fromPlanId, planReserve(from) - q, when, { ...link, counterpartyId: toPlanId });
      company = Store.planResized(company, toPlanId, planReserve(to) + q, when, { ...link, counterpartyId: fromPlanId });
      /* Room on the day and today is not room on every day between: a grant
         drawn in September and returned in January left both ends clear
         while a June transfer overdrew September. */
      this.#assertReserveHolds(company, [this.securities, securities], (hit, after) => {
        const today = inTodaysShares(after, hit, hit.shortfall);
        return `${hit.plan.name} would have ${fmtCount(hit.shortfall)} more shares committed than reserved${hit.date ? ` on ${hit.date}` : ''}`
          + `${today === hit.shortfall ? '' : `${restatedNote(hit.shortfall, today)},`} after this transfer. Move fewer shares, or date the transfer later.`;
      });
      this.company = company;
      return { transferId, quantity: q };
    }, ['company'], ['securities']);
  }

  /**
   * Retire a plan as of a date: no new awards after it, and its unallocated
   * shares leave the fully diluted count. Its awards and history stay. The
   * date cannot precede the plan's latest award or reserve change. Its
   * available shares can be poured over into a successor in the same commit
   * (`pourOverTo`), and the rules that returned shares to it can be pointed
   * at a successor (`recycleTo`) so a later forfeiture lands there instead.
   */
  async retirePlan(id, { date, pourOverTo = null, recycleTo = null, reason = '' }) {
    const when = str(date).slice(0, 10);
    if (!when) throw refusal('Pick the retirement date.');
    if (!isISODate(when)) throw refusal('Pick a valid retirement date.');
    if (when > todayISO()) throw refusal('A plan can’t be retired as of a future date.');
    // The hiring plan is always written - see deletePlan.
    const keys = ['company', 'hiring'];
    return this.#commit('retirePlan', keys, ({ securities }) => {
      const plan = this.plan(id);
      if (!plan) throw new Error('That plan is gone.');
      if (!planIsOpen(plan)) throw new Error(`${plan.name} is already retired.`);
      if (plan.adopted && when < plan.adopted) throw new Error(`${plan.name} was adopted on ${plan.adopted}, after this date.`);
      const last = planLastActivity({ company: this.company, securities: [...this.securities, ...securities] }, id);
      if (last && last > when) {
        throw new Error(`${plan.name} has an award or a reserve change dated ${last}, so it can’t be retired before that.`);
      }
      const successorNamed = (planId, what) => {
        const to = this.plan(planId);
        if (!to) throw new Error(`The plan to ${what} is gone.`);
        if (to.id === id) throw new Error('Pick another plan as the successor.');
        if (!planIsOpen(to)) throw new Error(`${to.name} has been retired, so it can’t take this plan’s shares.`);
        return to;
      };
      let company = this.company;
      if (recycleTo) {
        successorNamed(recycleTo, 'send returns to');
        const recycling = Object.fromEntries(RECYCLING_EVENTS.map(({ value }) => [value,
          plan.recycling[value] === 'return' ? recycleTo : plan.recycling[value]]));
        company = Store.sanitizeCompany({ ...company,
          plans: company.plans.map((p) => p.id === id ? { ...p, recycling } : p) });
        this.#assertReservesHold(this.company, company, [this.securities, securities]);
      }
      let pouredOver = 0;
      if (pourOverTo) {
        const to = successorNamed(pourOverTo, 'pour the reserve into');
        if (to.adopted && when < to.adopted) throw new Error(`${to.name} was adopted on ${to.adopted}, after this date.`);
        // Nor past its expiration, as transferReserve refuses: nothing can be granted from the shares there.
        if (to.expires && to.expires < when) throw new Error(`${to.name} expired on ${to.expires}, so shares can’t move into it on ${when}.`);
        // Rules apply to historical events too. Measure the remaining reserve
        // after redirecting them, so old returns do not also move in this transfer.
        pouredOver = Math.max(0, this.#reserveToSpare(id, when, [this.securities, securities], company));
        if (pouredOver > 0) {
          const link = {
            kind: 'transfer', reason: reason || `Poured over on the retirement of ${plan.name}`, transferId: uid(),
            seq: Store.nextPoolSeq(company), mirror: false,
          };
          company = Store.planResized(company, id, planReserve(plan) - pouredOver, when, { ...link, counterpartyId: to.id });
          company = Store.planResized(company, to.id, planReserve(to) + pouredOver, when, { ...link, counterpartyId: id });
        }
      }
      const current = company.plans.find((p) => p.id === id);
      const next = { ...current, status: 'retired', retiredAt: when };
      this.company = Store.sanitizeCompany({ ...company, plans: company.plans.map((p) => (p.id === id ? next : p)) });
      /* The planned roles follow the reserve into the successor when it is
         written for option grants; a successor that only holds RSU awards
         cannot take a planned grant, so they fall back to the default plan.
         Moved regardless, the card named a plan the grant sheet then quietly
         swapped for another. */
      const heir = [pourOverTo, recycleTo].map((p) => (p ? this.plan(p) : null)).find((p) => p && planAccepts(p, 'option'));
      this.hiring = Store.sanitizeHiring(this.hiring.map((h) => (h.planId === id ? { ...h, planId: heir?.id || '' } : h)));
      return { pouredOver };
    }, keys, ['securities']);
  }

  /**
   * The awards in a backup that name no plan and could draw from more than
   * one: the import has to be told which - see resolvePlan. Each as
   * `{ label, candidates }`.
   */
  static unresolvedPlanAwards(rawSecurities, plans) {
    const out = [];
    for (const s of Array.isArray(rawSecurities) ? rawSecurities : []) {
      if (!s || typeof s !== 'object' || (s.kind !== 'option' && s.kind !== 'rsu')) continue;
      const planId = rid(s.planId);
      const named = planId && plans.some((p) => p.id === planId);
      if (named || s.outsidePlan === true) continue;
      const { planId: resolved, candidates } = resolvePlan({ ...s, planId: '' }, plans);
      if (!resolved && candidates.length > 1) out.push({ label: str(s.label) || 'an award', candidates });
    }
    return out;
  }

  /* ---------- 409A valuations ---------- */

  /**
   * Record and remove valuations by mapping the list inside apply(), like
   * every other list edit here. The callers used to rebuild the list from
   * the store at call time and hand it to updateCompany whole - so a delete
   * that failed and rolled back, with a new 409A recorded during its round
   * trip, saw the new one committed from a list snapshotted while the
   * deleted valuation was optimistically gone. The toast said the deleted
   * one was still there; it was not.
   */
  async addValuation(input) {
    return this.#commit('addValuation', ['company'], () => {
      const [valuation] = Store.sanitizeValuations([{ ...input, id: uid() }]);
      if (!valuation) throw new Error('A valuation needs a date and a price per share.');
      /* Checked here rather than left to the sanitizer's slice. The history
         is kept newest first and cut at the end, so a 41st valuation silently
         dropped the oldest - the one Form 3921 reads a grant-date fair market
         value out of, and the one an RSU priced against - and a valuation
         backfilled behind the limit was dropped the moment it was written,
         with an id handed back for a record that was never there. */
      if (this.company.valuations.length >= VALUATIONS_MAX) {
        throw new ListFullError(
          `This company already holds ${VALUATIONS_MAX} valuations, the most it can keep. `
          + 'Delete one from the 409A history before recording another.');
      }
      this.company = Store.sanitizeCompany({
        ...this.company, valuations: [valuation, ...this.company.valuations],
      });
      return valuation;
    }, ['company']);
  }

  async deleteValuation(id) {
    return this.#commit('deleteValuation', ['company'], () => {
      this.company = Store.sanitizeCompany({
        ...this.company, valuations: this.company.valuations.filter((v) => v.id !== id),
      });
    }, ['company']);
  }

  /* ---------- Share classes ---------- */

  shareClass(id) {
    return this.classes.find((c) => c.id === id) || null;
  }

  async addClass(input) {
    return this.#commit('addClass', ['classes'], () => {
      const cls = Store.sanitizeClasses([{ ...input, id: uid(), createdAt: Date.now() }])[0];
      /* The sanitizer drops a record with no name, and the slot it left was
         being appended as it was: a `null` in the live list that every later
         lookup tripped over until a reload dropped it. The forms refuse a
         blank first; the record refuses it too. */
      if (!cls) throw refusal('Give the share class a name.');
      this.classes = [...this.classes, cls];
      return cls;
    }, ['classes']);
  }

  async updateClass(id, patch) {
    return this.#commit('updateClass', ['classes', 'securities'], () => {
      /* A record that is gone by the time the write runs - deleted in another
         tab, or left on screen across a company switch - is a refusal, not a
         no-op: the map below found nothing to change, the unchanged list was
         written, and the form reported the edit saved. */
      if (!this.shareClass(id)) throw new Error('That share class is gone.');
      /* Dated amendments are written against the class's preference as it
         stood; the app has no convention for re-reading them over a changed
         multiple or rank, so those fields freeze once amendments exist. */
      const current = this.shareClass(id);
      if (current.preferredTerms?.length
        && ['kind', 'liquidationMultiple', 'participating', 'seniority'].some((k) => k in patch && patch[k] !== current[k])) {
        throw new FinancingError('Changing the underlying preference or seniority after dated terms exist is unsupported. Keep the original class terms and review the charter amendment.');
      }
      if ('preferredTerms' in patch) appendOnly(current.preferredTerms, patch.preferredTerms, 'Preferred amendments');
      // `|| c`: a patch the sanitizer rejects keeps the record rather than
      // leaving undefined in the array (which would crash every render).
      this.classes = this.classes.map((c) => (c.id === id
        ? Store.sanitizeClasses([{ ...c, ...patch, id, kind: patch.kind ?? c.kind }])[0] || c
        : c));
      /* The class's certificates are read against the amended terms the
         moment they land, the check every certificate write runs (see
         sanitizeSecurities). Without it an amendment dated before a
         recorded payment, dropping the dividend terms, left that payment
         exceeding a balance that no longer accrued: the exit model went
         unsupported, every edit of the certificate was refused for it, and
         amendments being append-only there was no way back. */
      if ('preferredTerms' in patch) {
        const amended = this.shareClass(id);
        for (const s of this.securities) {
          if (s.kind !== 'shares' || s.classId !== id || !s.dividendEvents?.length) continue;
          const last = s.dividendEvents.reduce((date, e) => (e.date > date ? e.date : date), s.date);
          try {
            dividendAccrual(s, amended, last);
          } catch (err) {
            if (!(err instanceof FinancingError)) throw err;
            throw new FinancingError(`${err.message} Date the amendment after that certificate’s dividend events, or keep dividend terms in it.`);
          }
        }
      }
      // The class's certificates take their dividend basis the moment terms arrive - see sanitizeSecurities.
      this.securities = this.securities.map((s) => (s.kind === 'shares' && s.classId === id
        && !s.economicBasis && this.shareClass(id).preferredTerms?.length
        ? {
          ...s,
          economicBasis: validateBasis({
            principal: s.cashInvested ?? s.quantity * s.pricePerShare,
            date: originalIssueDate(s, this.securities) || s.date,
          }),
        }
        : s));
    }, ['classes', 'securities']);
  }

  /**
   * Classes with issued shares - or warrants over them - can't be deleted;
   * the UI disables it too. Without the warrant check the sanitizer would
   * silently drop those warrants on the next load.
   */
  async deleteClass(id) {
    return this.#commit('deleteClass', ['classes'], ({ securities }) => {
      /* Checked inside apply(), against the securities as they stand when
         the queue gets here: a security delete queued just ahead can fail
         and roll its record back, and a check made at call time had already
         waved the class through - leaving that warrant pointing at nothing.

         And against the stored securities as well as this session's, because
         this commit writes only the classes: the stale-write guard compares
         the key it is about to write and would never look at a certificate
         another tab issued after this one loaded. Deleted anyway, the class
         took that certificate with it - the sanitizer drops a certificate
         with no class on the next load, and the save after that makes it
         permanent. */
      const referenced = [...this.securities, ...securities];
      if (referenced.some((s) => s.kind === 'shares' && s.classId === id)) {
        throw new Error('This class has issued shares.');
      }
      if (referenced.some((s) => s.kind === 'warrant' && s.classId === id)) {
        throw new Error('Warrants are outstanding over this class.');
      }
      if (referenced.some((s) => s.kind === 'rsu' && s.classId === id)) {
        throw new Error('RSU awards settle into this class.');
      }
      /* A plan's awards exercise and settle into its class. Deleted under
         it, the plan pointed at nothing and the next exercise failed with
         "Could not issue the exercise certificate". Point the plan at another
         class first. */
      if (this.company.plans.some((p) => p.classId === id)) {
        throw new Error('An equity plan settles its awards into this class.');
      }
      this.classes = this.classes.filter((c) => c.id !== id);
    }, ['classes'], ['securities']);
  }

  /* ---------- Stakeholders ---------- */

  stakeholder(id) {
    return this.stakeholders.find((h) => h.id === id) || null;
  }

  async addStakeholder(input) {
    return this.#commit('addStakeholder', ['stakeholders'], () => {
      const full = roomFor('stakeholders', this.stakeholders.length, 1, MAX_STAKEHOLDERS);
      if (full) throw new ListFullError(full);
      const holder = Store.sanitizeStakeholders([{ ...input, id: uid(), createdAt: Date.now() }])[0];
      // As addClass: a nameless holder is refused, not appended as a hole.
      if (!holder) throw refusal('Give the stakeholder a name.');
      this.stakeholders = [...this.stakeholders, holder];
      return holder;
    }, ['stakeholders']);
  }

  /**
   * A rename keeps the name being left behind. The activity log is free
   * text, and the holder's page finds their history by the name in it - so
   * correcting "Sam Rivera" to "Samuel Rivera" made every line about Sam
   * vanish from Samuel's statement, with the log itself untouched. The old
   * name rides along instead, and the page and the search read it too. A
   * change of capitalization alone is the same name.
   */
  async updateStakeholder(id, patch) {
    return this.#commit('updateStakeholder', ['stakeholders'], () => {
      // A missing record refuses rather than saving nothing - see updateClass.
      if (!this.stakeholder(id)) throw new Error('That stakeholder is gone.');
      // `|| h`: same guard as updateClass/updateSecurity.
      this.stakeholders = this.stakeholders.map((h) => {
        if (h.id !== id) return h;
        const next = { ...h, ...patch, id };
        const renamed = 'name' in patch && str(patch.name)
          && str(patch.name).toLowerCase() !== h.name.toLowerCase();
        if (renamed) next.formerNames = [h.name, ...(h.formerNames || [])];
        return Store.sanitizeStakeholders([next])[0] || h;
      });
    }, ['stakeholders']);
  }

  /**
   * Why a stakeholder cannot be deleted right now, or null. The cascade is a
   * bulk deleteSecurity and is refused for the same reason: a record another
   * certificate was drawn off cannot go while that certificate stands.
   * Records the cascade takes with it are not dependencies - what stops it is
   * a sale, which left the shares in someone else's hands and the grant and
   * exercise they came out of in this one's. Delete those and the shares stay
   * outstanding while the pool they were drawn from reads as never drawn.
   *
   * And the other way round: a certificate this holder bought in a transfer
   * is one leg of an event whose source, and whose other leg, belong to the
   * seller. Cascaded away, the shares simply left the cap table with the
   * source still closed against them - see transferOf. Deleting the leg
   * itself undoes the transfer; a cascade that also rewrote another holder's
   * certificates would not be what deleting a person means. A repurchase's
   * remainder is the seller's own, and goes with the seller's closed source.
   *
   * Public so the stakeholders list can say this before its confirm dialog
   * rather than after it - the securities list already checks its own
   * deletes the same way.
   */
  stakeholderDeleteRefusal(id) {
    const holder = this.stakeholder(id);
    const removed = this.securities.filter((s) => s.stakeholderId === id);
    const going = new Set(removed.map((s) => s.id));
    const blocking = removed
      .flatMap((s) => [
        ...(['option', 'rsu', 'warrant'].includes(s.kind) ? this.certificatesFrom(s.id) : []),
        // A convertible whose conversion certificate someone else now holds.
        ...[this.convertedInto(s)].filter(Boolean),
        ...this.successorsOf(s.id),
      ])
      .filter((c) => !going.has(c.id));
    if (blocking.length) {
      const labels = [...new Set(blocking.map((c) => c.label))].join(', ');
      return `${holder?.name || 'This stakeholder'}’s records are what ${labels} came off. Delete those certificates first.`;
    }
    const leg = removed.find((s) => this.transferOf(s) && !going.has(s.fromTransferId));
    if (leg) {
      const { source } = this.transferOf(leg);
      const event = source.closedReason === 'repurchase' ? 'repurchase' : 'transfer';
      return `${holder?.name || 'This stakeholder'} holds ${leg.label}, which came off ${source.label} `
        + `in a ${event}. Delete that certificate first, which undoes the ${event}.`;
    }
    /* And a leg since repurchased, in full or in part, whose source another
       holder's records still close against - see retiredLegStands. The
       cascade would take it, and any remainder of it this holder kept, with
       nothing left to say where those shares went: the source stayed closed
       against fewer shares than it held, and deleting its last standing leg
       then "undid" the transfer at the source's full count, so the shares
       the company had retired were outstanding again. A closed leg whose
       successors stand with another holder is caught above; one whose
       successors all go with this holder is the remainder a partial
       repurchase left them, which #retiredLegOf does not see. */
    const retired = removed.find((s) => s.kind === 'shares' && s.fromTransferId && s.closedAt
      && !going.has(s.fromTransferId) && this.security(s.fromTransferId)?.kind === 'shares'
      && this.security(s.fromTransferId)?.closedAt);
    if (retired) {
      return retiredLegStands(retired, this.security(retired.fromTransferId), {
        holder: holder?.name || 'This stakeholder', inPart: this.successorsOf(retired.id).length > 0,
      });
    }
    return null;
  }

  /**
   * The closed source a fully repurchased leg came off, while both stand
   * closed; null for anything else. A closed leg with successors is a leg
   * transferred on, which deleteSecurity already refuses on those grounds.
   */
  #retiredLegOf(security) {
    if (security?.kind !== 'shares' || !security.fromTransferId || !security.closedAt) return null;
    if (this.successorsOf(security.id).length) return null;
    const source = this.security(security.fromTransferId);
    return source?.kind === 'shares' && source.closedAt ? source : null;
  }

  /**
   * What an undo has to find unchanged before it puts a certificate back,
   * read before the records go. The undo closures guard the dataset's
   * identity with #dataEpoch, but a transfer, a departure, a round close or
   * an ordinary edit does not bump it - and for the seconds an Undo toast is
   * up, the award or instrument a deleted certificate hangs off can be edited
   * past every rule that would have held while the certificate stood: a
   * grant re-dated past its exercise, a window closed before it, early
   * exercise turned off behind it, a reopened SAFE's terms retyped, its
   * holder departed. Re-inserted anyway, the certificate came back on the
   * wrong side of each of those rules, which #assertLineageStands refuses.
   *
   *  awards      the awards the certificates hang off that existed then
   *  ahead       awards already exercised ahead of vesting without early
   *              exercise (an import), which stay tolerated
   *  terms       a reopened convertible's terms, frozen while it is converted
   *  departed    each restored award holder's departure date as it stood
   */
  #lineageAtDelete(going) {
    const awards = new Set();
    const ahead = new Set();
    const terms = new Map();
    const departed = new Map();
    const fit = new Map();
    for (const c of going) {
      if (c.kind === 'option' || c.kind === 'rsu') {
        departed.set(c.stakeholderId, this.stakeholder(c.stakeholderId)?.departed || '');
        /* Whether the award's plan could hold it as it stood: an amendment or
           a retirement that closes the plan to it meanwhile refuses the undo,
           while an award imported outside its plan's dates goes back as it was. */
        const plan = c.planId && !c.outsidePlan ? this.plan(c.planId) : null;
        if (plan) fit.set(c.id, planAccepts(plan, c.kind, securityDate(c)));
      }
      if (c.kind !== 'shares' || c.fromTransferId) continue;
      const award = this.security(c.fromOptionId || c.fromRsuId || c.fromWarrantId);
      if (award && ['option', 'rsu', 'warrant'].includes(award.kind)) {
        awards.add(award.id);
        /* An RSU award's settlements are held to its vesting the way a
           grant's exercises are, so it is remembered here on the same terms.
           Early exercise is a grant's provision alone: an RSU has none. */
        if (award.kind !== 'warrant' && (award.kind === 'rsu' || !award.earlyExercise) && exerciseAheadOfVesting(award, this.securities)) {
          ahead.add(award.id);
        }
      }
      const source = c.fromConvertibleId ? this.security(c.fromConvertibleId) : null;
      if (source && (source.kind === 'safe' || source.kind === 'note')) {
        terms.set(source.id, Store.#convertibleTerms(source));
      }
    }
    return { awards, ahead, terms, departed, fit };
  }

  /** The terms a conversion certificate was sized from - the ones
   *  updateSecurity freezes while the instrument stands converted. */
  static #convertibleTerms(s) {
    return JSON.stringify(['date', 'principal', 'valuationCap', 'discount', 'safeType', 'interestRate']
      .map((k) => [k, s[k] ?? null]));
  }

  /**
   * What a transfer's legs took from their source besides its size, class,
   * date and price: the holder the seller's remainder stays with, and the
   * schedule and 83(b) record it continues. A leg-delete undo re-closes the
   * source under legs drawn from these as they stood, so it is refused once
   * any of them changed - re-closed anyway, the remainder of a certificate
   * now held by someone else read as that person's stock under the old
   * holder's name, on the old schedule.
   */
  static #transferSourceTerms(s) {
    return JSON.stringify(['stakeholderId', 'vestingMonths', 'cliffMonths', 'vestingStart', 'vestingFrequency',
      'vestingTranches', 'vestingBase', 'vestingOffset', 'accelTrigger', 'accelPct', 'filed83b', 'missed83b', 'date83b']
      .map((k) => [k, s[k] ?? null]));
  }

  /**
   * Refuse an undo whose restored certificates would stand on the wrong
   * side of a rule enforced while they stood - see #lineageAtDelete. Run
   * after the records are back in the array, so the same functions the
   * standing rules use read the same state; a throw rolls the whole undo
   * back. The wording is the one every undo refusal here uses.
   */
  #assertLineageStands(back, lineage) {
    const changed = () => new Error('The cap table has changed since the delete.');
    /* Labels number from the highest one standing, so a record issued while
       the toast was up took the deleted record's label - and the undo put
       both back under it: two CS-3s, ambiguous in every message that names
       a certificate and in a CSV import that matches on the label. */
    const restoring = new Set(back.map((s) => s.id));
    const taken = new Set(this.securities.filter((s) => !restoring.has(s.id)).map((s) => s.label));
    if (back.some((s) => taken.has(s.label))) throw changed();
    const certified = certifiedByGrant(this.securities);
    const checkedGrants = new Set();
    for (const c of back) {
      if (c.kind === 'option' || c.kind === 'rsu') {
        const was = lineage.departed.get(c.stakeholderId);
        if (was !== undefined && (this.stakeholder(c.stakeholderId)?.departed || '') !== was) throw changed();
        const plan = c.planId && !c.outsidePlan ? this.plan(c.planId) : null;
        if (plan && lineage.fit.get(c.id) && !planAccepts(plan, c.kind, securityDate(c))) throw changed();
        continue;
      }
      if (c.kind !== 'shares' || c.fromTransferId) continue;
      const awardId = c.fromOptionId || c.fromRsuId || c.fromWarrantId;
      const award = awardId ? this.security(awardId) : null;
      if (awardId && lineage.awards.has(awardId) && !award) throw changed();
      if (award) {
        const granted = award.grantDate || award.date;
        if (granted && c.date && c.date < granted) throw changed();
        if (award.kind === 'warrant') this.#assertWarrant(award);
        if (award.kind === 'option') {
          const cutoff = exerciseCutoff(award);
          if (cutoff && c.date && c.date > cutoff) throw changed();
          if (!checkedGrants.has(award.id)) {
            checkedGrants.add(award.id);
            /* An exercise certificate goes back only while its grant still
               has the exercise uncertified. Deleting one leaves the grant's
               counter alone so the certificate can be issued again, and an
               undo after that put both on the table: two certificates for one
               exercise, with the grant saying 100 were ever bought. */
            if ((certified.get(award.id) || 0) > grantExercised(award)) throw changed();
            if (!award.earlyExercise && !lineage.ahead.has(award.id) && exerciseAheadOfVesting(award, this.securities)) {
              throw changed();
            }
          }
        } else if (!checkedGrants.has(award.id)) {
          checkedGrants.add(award.id);
          /* A settlement certificate hands its units back to the award when
             it is deleted, and the award's vesting is free to be frozen below
             them meanwhile - a cancellation the certificate had blocked while
             it stood. #resettleFor puts the units back against what the award
             still holds, not against what it will ever vest, so the undo left
             250 settled on an award whose schedule stopped at 104. */
          if (!lineage.ahead.has(award.id) && exerciseAheadOfVesting(award, this.securities)) throw changed();
        }
      }
      const source = c.fromConvertibleId ? this.security(c.fromConvertibleId) : null;
      if (source) {
        if (source.date && c.date && c.date < source.date) throw changed();
        const was = lineage.terms.get(source.id);
        if (was !== undefined && Store.#convertibleTerms(source) !== was) throw changed();
      }
    }
  }

  /**
   * Deleting a stakeholder cascades to their securities (the UI confirms
   * first), and is refused while any of those securities is the source
   * another holder's certificate was drawn off. Returns { undo } that
   * re-inserts exactly what was removed - never a whole-array snapshot, so
   * records created while the undo toast was showing survive. Safe to call
   * twice.
   */
  async deleteStakeholder(id) {
    /* Read inside apply(), when the queue reaches this delete - not at call
       time. apply() runs against the state every earlier commit left behind,
       and a write queued just ahead of this one (a certificate issued to the
       holder, an undo putting one of their records back) had not applied yet
       when the delete was called. Captured then, the list missed that record:
       the cascade below removed it all the same, and the undo put back only
       what the list held, so the record was gone with no way back. */
    let holder = null;
    let removed = [];
    let reopened = [];
    let unsettled = [];
    let lineage = null;
    await this.#commit('deleteStakeholder', ['stakeholders', 'securities'], () => {
      holder = this.stakeholder(id);
      removed = this.securities.filter((s) => s.stakeholderId === id);
      const refused = this.stakeholderDeleteRefusal(id);
      if (refused) throw new Error(refused);
      lineage = this.#lineageAtDelete(removed);
      this.stakeholders = this.stakeholders.filter((h) => h.id !== id);
      this.securities = this.securities.filter((s) => s.stakeholderId !== id);
      /* A convertible someone else holds that converted into one of these
         certificates is live again - see deleteSecurity - and an award
         someone else holds gets back the units these certificates settled. */
      reopened = this.#reopenConvertedInto(new Set(removed.map((s) => s.id)));
      unsettled = this.#unsettleFor(removed);
    }, ['stakeholders', 'securities']);
    const epoch = this.#dataEpoch;
    return {
      undo: () => this.#commit('undo.deleteStakeholder', ['stakeholders', 'securities'], () => {
        // The removed records belong to the dataset they came from - not to
        // another company switched to, or to post-split units.
        if (epoch !== this.#dataEpoch) throw new Error('The cap table has changed since the delete.');
        const have = new Set(this.securities.map((s) => s.id));
        const back = removed.filter((s) => !have.has(s.id));
        // Nor to a cap table whose share classes have moved on - see
        // deleteSecurity's undo.
        if (back.some((s) => !this.#referencesResolve(s, { holder }))) {
          throw new Error('The cap table has changed since the delete.');
        }
        if (holder && !this.stakeholders.some((h) => h.id === holder.id)) {
          this.stakeholders = [...this.stakeholders, holder];
        }
        if (back.length) this.#resettleFor(unsettled);
        if (back.length) this.#assertRemarkable(reopened);
        if (back.length) this.securities = [...this.securities, ...back];
        if (back.length) this.#assertLineageStands(back, lineage);
        this.#remarkConverted(reopened);
      }, ['stakeholders', 'securities']),
    };
  }

  /**
   * Whether a record put back by an undo still has somewhere to stand: its
   * holder (or the one being restored with it) and, for the kinds that name
   * one, its share class. The undo closures guard the dataset's identity
   * with #dataEpoch, but deleting a class or a holder does not bump it - and
   * the six seconds an Undo toast stays up are long enough to delete the
   * class a warrant was over, now that nothing else is over it. Re-inserted
   * anyway, the record showed and counted until the next load, when the
   * sanitizer dropped it without a word.
   */
  #referencesResolve(s, { holder = null } = {}) {
    const holderOk = this.stakeholder(s.stakeholderId) || (holder && holder.id === s.stakeholderId);
    if (!holderOk) return false;
    /* The plan has to be on file. Whether it can hold the award is judged
       against how things stood at the delete - see #lineageAtDelete - since
       an imported award outside its plan's dates is taken as written. */
    if ((s.kind === 'option' || s.kind === 'rsu') && s.planId && !s.outsidePlan && !this.plan(s.planId)) return false;
    if (s.kind === 'shares' || s.kind === 'warrant' || s.kind === 'rsu') {
      return !!this.shareClass(s.classId);
    }
    return true;
  }

  /* ---------- Securities ---------- */

  security(id) {
    return this.securities.find((s) => s.id === id) || null;
  }

  async addSecurity(input) {
    return this.#commit('addSecurity', ['securities'], () => {
      this.#assertSecurityInput(input, { adding: true });
      const full = roomFor('securities', this.securities.length, 1, MAX_SECURITIES);
      if (full) throw new ListFullError(full);
      this.#assertPlanNamed(input);
      if (input.mfn?.elections?.length) throw new FinancingError('Record the original instrument first, then elect eligible later terms.');
      const label = nextLabel(this.db, input.kind, input.classId);
      const sec = Store.sanitizeSecurities(
        [{ ...input, id: uid(), label, createdAt: Date.now() }], this)[0];
      if (!sec) throw new Error('Invalid security.');
      this.#assertVestingSchedule(sec);
      this.#assertPlanFits(null, sec);
      assertUniqueTermIds([...this.securities, sec]);
      const capacityError = planCapacityError(this.db, [...this.securities, sec]);
      if (capacityError) throw new Error(capacityError);
      this.securities = [...this.securities, sec];
      if (sec.kind === 'warrant') this.#assertWarrant(sec);
      if (sec.fromWarrantId) this.#assertWarrant(this.security(sec.fromWarrantId));
      this.#certifiedWithinAward(sec, { lift: true });
      return sec;
    }, ['securities']);
  }

  /**
   * The shares certified out of an award fit inside it. The exercise and
   * settlement paths keep an award's counter and its certificates in step,
   * but a certificate can also arrive naming an award on its own - a backup,
   * the API - and nothing held it to the award: a 2,000-share certificate
   * against a 4,800-option grant left the counter at zero, and the grant
   * then exercised all 4,800 on top of it. With `lift`, the counter is
   * brought up to the certified total, since a certificate out of a grant is
   * an exercise whether or not the counter saw it. Provenance to an award
   * that is gone is kept, as the sanitizer says: the shares happened.
   */
  #certifiedWithinAward(cert, { lift = false } = {}) {
    if (cert?.kind !== 'shares' || cert.fromTransferId) return;
    const award = this.security(cert.fromOptionId || cert.fromRsuId || '');
    if (!award || (award.kind !== 'option' && award.kind !== 'rsu')) return;
    const units = award.kind === 'rsu';
    const certified = (units ? certifiedByRsu : certifiedByGrant)(this.securities).get(award.id) || 0;
    const held = units ? rsuOutstanding(award) : grantOutstanding(award);
    if (certified > held) {
      throw new Error(`${award.label} holds ${fmtCount(held)} ${units ? 'units' : 'options'}, `
        + `but ${fmtCount(certified)} shares would be certified out of it.`);
    }
    const counter = units ? rsuSettled(award) : grantExercised(award);
    if (!lift || counter >= certified) return;
    this.securities = this.securities.map((s) => (s.id === award.id
      ? Store.sanitizeSecurities([{ ...s, [units ? 'settled' : 'exercised']: certified, id: s.id, kind: s.kind, label: s.label }], this)[0] || s
      : s));
  }

  /**
   * What a security write has to say plainly before the sanitizer reads it.
   * The sanitizer is written for stored records: it rounds a fractional
   * count, floors a negative price at zero and keeps whatever a date field
   * holds - right for a backup, wrong for a form or an API call, where 100.6
   * shares were saved as 101 under a "saved" toast, a strike of -1 as free
   * options, and a date of 2024-13-45 as a certificate that sorted after
   * every real one and counted on no as-of date at all. Only the fields the
   * write names are checked, so a patch that leaves a figure alone leaves it
   * alone; a new security needs a date (a grant date will do for an award),
   * and an edit cannot take one away.
   */
  #assertSecurityInput(input, { adding = false } = {}) {
    const given = (key) => input[key] !== undefined && input[key] !== null && input[key] !== '';
    const whole = (key) => Number.isSafeInteger(Number(input[key]));
    if (given('quantity') && !(whole('quantity') && Number(input.quantity) > 0)) {
      throw refusal('Enter the quantity in whole shares.');
    }
    for (const key of ['exercised', 'settled', 'cancelled']) {
      if (given(key) && !(whole(key) && Number(input[key]) >= 0)) throw refusal(`Enter the ${key} count in whole shares.`);
    }
    const money = {
      pricePerShare: 'price per share', strike: 'strike price', principal: 'principal', valuationCap: 'valuation cap',
      discount: 'discount', interestRate: 'interest rate', transferPricePerShare: 'transfer price', repurchasePricePerShare: 'repurchase price',
    };
    for (const [key, label] of Object.entries(money)) {
      if (!given(key)) continue;
      const n = Number(input[key]);
      if (!Number.isFinite(n)) throw refusal(`Enter the ${label} as a number.`);
      if (n < 0) throw refusal(`The ${label} can’t be negative.`);
    }
    const dates = {
      date: 'date', grantDate: 'grant date', vestingStart: 'vesting start date', expires: 'expiration date',
      exerciseBy: 'exercise deadline', filed83b: '83(b) filing date', date83b: '83(b) date', maturityDate: 'maturity date',
      cancelledDate: 'cancellation date', convertedAt: 'conversion date', closedAt: 'closing date', vestingStoppedAt: 'vesting stop date',
    };
    for (const [key, label] of Object.entries(dates)) {
      if (given(key) && !isISODate(str(input[key]))) throw refusal(`Pick a valid ${label}.`);
    }
    if ((adding && !given('date') && !given('grantDate')) || (!adding && 'date' in input && !given('date'))) {
      throw refusal('Pick a date.');
    }
  }

  /**
   * A plan reference an award arrives with has to name a plan on file. The
   * sanitizer drops one that does not and resolves the award as unassigned,
   * which is right for a backup written against plans since deleted - but a
   * form or an import naming a plan that is gone is asking for something
   * the store cannot do, and saying so beats saving the award under another
   * plan in silence.
   */
  #assertPlanNamed(input) {
    if (input?.kind !== 'option' && input?.kind !== 'rsu') return;
    const planId = rid(input.planId);
    if (planId && !this.plans.some((p) => p.id === planId)) {
      throw new Error('That plan is gone. Pick another plan for this award, or leave it outside any plan.');
    }
  }

  /**
   * An award fits the plan it names: the plan is written for its kind, was
   * adopted by its date, had not expired or been retired. Checked when the
   * plan or the date moves (and on every new award), so a record imported in
   * that state stays editable otherwise - the same rule every chronology
   * check in this file follows.
   */
  #assertPlanFits(before, after) {
    if ((after.kind !== 'option' && after.kind !== 'rsu') || !after.planId) return;
    const moved = !before || before.planId !== after.planId || securityDate(before) !== securityDate(after);
    if (!moved) return;
    const plan = this.plans.find((p) => p.id === after.planId);
    if (!plan) throw new Error('That plan is gone.');
    if (!planAccepts(plan, after.kind, securityDate(after))) throw new Error(planRefusal(plan, after.kind, securityDate(after)));
  }

  /**
   * Patch a security. A certificate a transfer or repurchase has closed keeps
   * its size, class, and date whatever the patch says: the successors were
   * sized and dated against them, `dbAsOf` reopens it at that size for dates
   * before the transfer, and a grant's exercised balance is netted from it.
   * Editing any of the three would break that arithmetic in a record the user
   * can no longer see the other half of. Notes, prices, and attachments stay
   * editable, so the transfer paperwork can still be filed against it - and a
   * price correction carries to the certificates issued in its place, which
   * inherited it (see #repriceTransferFamily).
   *
   * A split still restates closed certificates - it rewrites the array
   * wholesale rather than coming through here, which is what keeps every
   * per-share number moving together.
   */
  async updateSecurity(id, patch) {
    return this.#commit({ operation: 'updateSecurity', explanation: str(patch.auditReason).slice(0, 2000) }, ['securities'], () => {
      const before = this.security(id);
      // A missing record refuses rather than saving nothing - see updateClass.
      if (!before) throw new Error('That security is gone.');
      this.#assertSecurityInput(patch);
      if ('proRata' in patch) appendOnly(before.proRata, patch.proRata, 'Participation rights');
      if ('dividendEvents' in patch) appendOnly(before.dividendEvents, patch.dividendEvents, 'Dividend events');
      if ('economicBasis' in patch && before.economicBasis
        && (patch.economicBasis?.principal !== before.economicBasis.principal || patch.economicBasis?.date !== before.economicBasis.date)) {
        throw new FinancingError('Original dividend basis is permanent.');
      }
      if ('mfn' in patch && before.mfn) {
        const old = { ...before.mfn, elections: [] }; const next = { ...patch.mfn, elections: [] };
        if (JSON.stringify(old) !== JSON.stringify(next)) throw new FinancingError('Original MFN scope is permanent.');
        appendOnly(before.mfn.elections, patch.mfn?.elections, 'MFN elections');
      }
      /* A new election is re-derived from its source as it stands: the terms
         it records must be the source's, not typed in. */
      for (const e of (patch.mfn?.elections || []).slice(before.mfn?.elections.length || 0)) {
        const checked = electMFN(this.db, { ...before, mfn: { ...patch.mfn, elections: (before.mfn?.elections || []) } }, e);
        if (JSON.stringify(checked.terms) !== JSON.stringify(e.terms) || checked.sourceDate !== e.sourceDate) {
          throw new FinancingError('MFN election terms must match the eligible source instrument.');
        }
      }
      if ('planId' in patch || 'outsidePlan' in patch) this.#assertPlanNamed({ kind: before.kind, planId: patch.planId });
      // The records as this write found them, for the checks that compare
      // the state of a grant's exercises before and after.
      const was = this.securities;
      let after = before;
      this.securities = this.securities.map((s) => {
        if (s.id !== id) return s;
        /* Both ends of a transfer are settled in these three fields. The
           closed source is one - its successors were sized and dated against
           it - and so is each successor: a transfer splits one certificate
           into two, in one commit, and there is no edit of one leg alone that
           keeps the total or the chronology. Growing the buyer's leg to 400
           put 460 shares outstanding where 100 were ever issued, and moving
           its date back put 400 of them on the cap table before the shares
           existed. */
        const settled = s.kind === 'shares' && (s.closedAt || s.fromTransferId)
          ? { quantity: s.quantity, classId: s.classId, date: s.date }
          : null;
        /* And the closing itself, on the source: the day and the event that
           closed it are what dated the legs, and the count a repurchase
           retired is what the remainder was sized against - so 20 of 50
           retired with 30 kept could be rewritten to 50 retired beside the
           same 30-share remainder, and the certificate reopened under its
           own legs. Deleting a leg is the way a transfer is undone. */
        if (settled && s.closedAt) {
          settled.closedAt = s.closedAt;
          settled.closedReason = s.closedReason;
          settled.repurchasedQty = s.repurchasedQty;
        }
        /* A converted SAFE or note is settled the same way: the certificate it
           became was sized from its principal at the price its cap and
           discount set, and the cheque it stands for is counted at its
           principal. Edited afterwards, the two came apart - a principal
           raised from $250,000 to $300,000 put the extra $50,000 into capital
           raised and the issuance history beside a certificate still holding
           the shares $250,000 bought. Deleting the certificate is the way a
           conversion is undone; the instrument reopens with every term
           editable again. The date is held to the conversion separately, in
           #assertAwardChronology. */
        const converted = (s.kind === 'safe' || s.kind === 'note') && s.convertedAt
          ? Object.fromEntries(['principal', 'valuationCap', 'discount', 'safeType', 'interestRate']
            .filter((k) => k in s).map((k) => [k, s[k]]))
          : null;
        const next = { ...s, ...patch, ...settled, ...converted, id, kind: s.kind, label: s.label };
        /* An award moved to another plan, or out of every plan, leaves the
           old reference behind: the two fields say one thing each, and a
           patch that sets one clears the other. */
        if ('planId' in patch || 'outsidePlan' in patch) {
          if (patch.outsidePlan === true) delete next.planId;
          else if (rid(patch.planId)) delete next.outsidePlan;
          else { delete next.planId; delete next.outsidePlan; }
        }
        /* A quantity typed over the one a split produced is a new number, and
           what the splits recorded against the old one no longer describes
           this record. */
        if (int(next.quantity) !== int(s.quantity)) delete next.preSplit;
        else if (next.preSplit && JSON.stringify(next.vestingTranches) !== JSON.stringify(s.vestingTranches)) {
          // A replacement schedule supersedes the schedule the split restated.
          next.preSplit = next.preSplit.map(({ vestingTranches, ...entry }) => entry);
        }
        after = Store.sanitizeSecurities([next], this)[0] || s;
        return after;
      });
      // A right appended here may not reuse an ID another instrument holds.
      assertUniqueTermIds(this.securities);
      this.#assertAwardChronology(before, after);
      if (after.kind === 'warrant') this.#assertWarrant(after, before);
      if (after.fromWarrantId) this.#assertWarrant(this.security(after.fromWarrantId));
      this.#assertForfeituresAfterAward(before, after);
      this.#assertAwardCapacity(before, after);
      this.#assertPlanFits(before, after);
      this.#assertVestingSchedule(after, before);
      this.#assertClaimedWithinVesting(before, after);
      // Only when the window actually moved, so a grant imported already in
      // that state stays editable otherwise.
      if (after.kind === 'option' && exerciseCutoff(after) !== exerciseCutoff(before)) {
        this.#assertExercisesInsideWindow(after);
      }
      this.#reissueAgainstAward(before, after);
      /* Only when the certificate grows - the one edit that can put the
         certified total past the award. A table imported already past it
         (the sanitizer clamps the counter, not the certificates) stays
         editable otherwise, and a shrink is how it gets repaired; held to it
         on every edit, a price correction on such a certificate was refused
         for a total the edit did not touch. */
      if (int(after.quantity) > int(before.quantity)) this.#certifiedWithinAward(after);
      this.#assertExercisesBehindVesting(before, after, was);
      this.#reconvertWithCertificate(before, after);
      this.#repriceTransferFamily(before, after);
      const capacityError = planCapacityError({ ...this.db, securities: was }, this.securities);
      if (capacityError) throw new Error(capacityError);
    }, ['securities']);
  }

  /**
   * An exercise certificate cannot be edited into an exercise its grant
   * could not have made. exerciseOption and certifyExercise both refuse an
   * exercise past what had vested on its day, and editing the certificate
   * afterwards walked over that: moved to an earlier day, or grown past the
   * balance vested when it was issued, it read as options bought before they
   * had vested on a grant that says only vested options can be - the record
   * the early-exercise flag exists to authorize, without the flag. Which
   * record is wrong is the user's to say.
   *
   * Only the two edits that can create the problem are checked, and only
   * when they do, so a certificate imported in that state stays editable
   * otherwise. The grant's own schedule is deliberately not held to its past
   * exercises here: an exercise was checked against the schedule as it stood
   * on its day, and a schedule corrected later is held to the final ceiling
   * by #assertClaimedWithinVesting instead.
   *
   * The same for an RSU award's settlement certificates, which settleRSU
   * holds to the units vested on their day: a 250-unit settlement could be
   * moved to a day 104 had vested, or grown to 600, and the award's counter
   * followed it. A grant with early exercise is exempt - buying ahead is what
   * the provision means.
   */
  #assertExercisesBehindVesting(before, after, securitiesBefore) {
    if (before.kind !== 'shares' || before.fromTransferId) return;
    const awardId = before.fromOptionId || before.fromRsuId;
    if (!awardId) return;
    const earlier = !!after.date && after.date < before.date;
    if (!earlier && int(after.quantity) <= int(before.quantity)) return;
    const award = this.security(awardId);
    if (!award || (award.kind !== 'option' && award.kind !== 'rsu') || award.earlyExercise) return;
    if (exerciseAheadOfVesting(award, securitiesBefore)) return;
    const ahead = exerciseAheadOfVesting(award, this.securities);
    if (!ahead) return;
    const { certificate, vested, exercised } = ahead;
    if (award.kind === 'rsu') {
      throw new Error(`${certificate.label} was settled from ${award.label} on ${certificate.date}, `
        + `when only ${vested} of the ${exercised} settled had vested. Only vested units can be settled.`);
    }
    throw new Error(`${certificate.label} was exercised from ${award.label} on ${certificate.date}, `
      + `when only ${vested} of the ${exercised} bought had vested. Only vested options can be exercised on this grant.`);
  }

  /**
   * The issue price of a transferred certificate is one number written once
   * per leg. A transfer hands each successor its source's price - the
   * liquidation preference and the capital it returns belong to the shares,
   * not to what a later buyer paid - and a repurchase leaves the remainder
   * on it too. Corrected on the closed source afterwards, the legs kept the
   * old figure: capital raised (read off the source) moved while the class's
   * invested capital and its preference (read off the live legs) did not, so
   * one cap table reported two prices for the same issuance. Corrected on a
   * leg instead, the source and the other leg stayed behind the same way.
   *
   * So a price change carries across the whole family - the certificate the
   * legs came off, however far back, and every certificate issued off it or
   * off one of its legs - the way a certificate's size moves its award's
   * counter. Only members still on the price being corrected follow: one
   * already carrying a different figure (an import) is left as it stands.
   */
  #repriceTransferFamily(before, after) {
    if (before.kind !== 'shares' || !(before.closedAt || before.fromTransferId)) return;
    const was = num(before.pricePerShare);
    const now = num(after.pricePerShare);
    if (was === now) return;
    let root = before;
    const climbed = new Set([root.id]);
    while (root.fromTransferId) {
      const source = this.security(root.fromTransferId);
      if (!source || source.kind !== 'shares' || climbed.has(source.id)) break;
      climbed.add(source.id);
      root = source;
    }
    const family = new Set();
    const queue = [root.id];
    while (queue.length) {
      const id = queue.pop();
      if (family.has(id)) continue;
      family.add(id);
      for (const leg of this.successorsOf(id)) queue.push(leg.id);
    }
    family.delete(before.id);
    if (!family.size) return;
    this.securities = this.securities.map((s) => (family.has(s.id) && s.kind === 'shares' && num(s.pricePerShare) === was
      ? Store.sanitizeSecurities([{ ...s, pricePerShare: now, id: s.id, kind: s.kind, label: s.label }], this)[0] || s
      : s));
  }

  /**
   * A conversion certificate and the day its SAFE or note converted are one
   * event written twice: the certificate's date, and `convertedAt` on the
   * instrument. A snapshot reads the instrument as live until the second and
   * the shares as issued from the first, so the two have to agree - moved
   * apart, every date between them showed the money either nowhere (the
   * certificate dated later: the instrument gone and no shares yet) or twice
   * (dated earlier: the instrument still outstanding beside the shares it
   * became), and the issuance history grew a zero-dollar financing on the
   * certificate's new day. The date moves the instrument's with it, the way
   * an exercise certificate's size moves its grant's counter; the certificate
   * is already held to the instrument's signing date above.
   */
  #reconvertWithCertificate(before, after) {
    if (before.kind !== 'shares' || before.fromTransferId || !before.fromConvertibleId) return;
    if (before.date === after.date || !after.date) return;
    const source = this.security(before.fromConvertibleId);
    if (!source || source.convertedToId !== before.id || source.convertedAt === after.date) return;
    this.securities = this.securities.map((s) => (s.id === source.id
      ? Store.sanitizeSecurities([{ ...s, convertedAt: after.date, id: s.id, kind: s.kind, label: s.label }], this)[0] || s
      : s));
  }

  /**
   * A grant's exercise window cannot close before an exercise already dated
   * after it. An exercise is refused past the expiration or the
   * post-termination deadline, but the window could be moved the other way
   * afterwards: a departure recorded late with a deadline before an exercise
   * that had already happened, or an expiration edited back past one, left
   * the grant reading as expired - on the needs-attention list, offering to
   * cancel options that had in fact been bought - while its own certificate
   * said otherwise. Which record is wrong is the user's to say.
   */
  #assertExercisesInsideWindow(grant) {
    const cutoff = exerciseCutoff(grant);
    if (!cutoff) return;
    const late = this.securities
      .filter((s) => s.kind === 'shares' && !s.fromTransferId && s.fromOptionId === grant.id && s.date && s.date > cutoff)
      .reduce((a, c) => (a && a.date <= c.date ? a : c), null);
    if (!late) return;
    const clock = grant.exerciseBy && cutoff === grant.exerciseBy ? 'the exercise deadline' : 'the expiration';
    throw new Error(`${late.label} was exercised from ${grant.label} on ${late.date}, after ${clock} of ${cutoff}.`);
  }

  /**
   * An award cannot shrink below what has already left it. The sanitizer
   * keeps an award's counters inside its total - exercised (or settled) is
   * clamped to whatever survives cancellation - so a 1,000-option grant with
   * 400 exercised into a certificate, resized to 300, read as 300 exercised
   * while the certificate kept its 400 shares: a hundred shares outstanding
   * that no grant says were ever bought, a Form 3921 row the grant's own
   * counter contradicts, and 700 options handed back to the pool that were
   * spent. A cancellation large enough to reach into the exercised balance
   * did the same by the other route. The forms refuse both; the store held
   * the record to nothing, and quietly wrote a number nobody typed.
   *
   * Nor below what was cancelled: the sanitizer clamps the forfeiture history
   * into the new total, so a 1,000-option grant with 300 cancelled twice,
   * resized to 500, read as 300 and 200 cancelled - a dated history rewritten
   * to numbers nobody recorded, and 100 options that had returned to the
   * pool on a day the record no longer names.
   */
  #assertAwardCapacity(before, after) {
    if (before.kind !== 'option' && before.kind !== 'rsu') return;
    const units = before.kind === 'rsu';
    const was = units ? rsuSettled(before) : grantExercised(before);
    const now = units ? rsuSettled(after) : grantExercised(after);
    const noun = units ? 'units' : 'options';
    const gone = units ? 'settled' : 'exercised';
    if (int(after.quantity) < int(before.quantity)) {
      const returned = Math.max(0, Math.round(Number(before.cancelled) || 0));
      if (int(after.quantity) < was + returned) {
        const spent = [];
        if (was > 0) spent.push(`${was} ${noun} ${gone}`);
        if (returned > 0) spent.push(`${returned}${was > 0 ? '' : ` ${noun}`} cancelled`);
        throw new Error(`${before.label} has ${spent.join(' and ')} already, so it can’t go below ${was + returned}.`);
      }
    }
    if (now >= was) return;
    const left = (units ? rsuOutstanding(before) : grantOutstanding(before)) - was;
    throw new Error(`${before.label} has ${was} ${noun} ${gone} already; only ${left} are left to cancel.`);
  }

  /**
   * An award cannot have handed out more than its schedule will ever vest.
   * An exercise and a settlement are each checked against the balance vested
   * on their own day, but a cancellation recorded afterwards and dated
   * earlier walked over that: a departure entered late, with the deadline
   * cleared, froze a grant's vesting at 250 options with 500 already
   * exercised - a record saying the holder had bought twice what they would
   * ever earn, and an expense report reversing the cost of options that had
   * been paid for. A tranche list rewritten to vest less than has been
   * exercised does the same. A grant with early exercise is exempt: buying
   * ahead of the schedule is what the provision means. Refused only when the
   * ceiling actually drops, so a record imported in that state stays
   * editable otherwise.
   */
  #assertClaimedWithinVesting(before, after) {
    if (after.kind !== 'option' && after.kind !== 'rsu') return;
    /* The provision itself is load-bearing once it has been used. With it
       turned off, an exercise certificate dated ahead of the schedule reads
       as options bought before they could be - and the grant's next
       cancellation freezes its vesting below what was bought, which the
       check below then refuses with nothing left for the user to correct
       but a flag they were allowed to clear. Only a flip this write makes:
       a grant imported in that state stays editable. */
    if (after.kind === 'option' && before.earlyExercise && !after.earlyExercise) {
      const ahead = exerciseAheadOfVesting(after, this.securities);
      if (ahead) {
        throw new Error(`${ahead.certificate.label} was exercised from ${after.label} on ${ahead.certificate.date} `
          + `with ${ahead.exercised} exercised and ${ahead.vested} vested, so early exercise can’t be turned off while it stands.`);
      }
      /* And the counter itself, which the certificates alone do not date: an
         exercise recorded with the certificate box unticked sat above a
         frozen ceiling with the flag off, the certificate for it could never
         be issued, and every other path refuses exactly that state. */
      const claimedNow = grantExercised(after);
      const ceilingNow = vestingCeiling(after);
      if (claimedNow > ceilingNow) {
        throw new Error(`${after.label} has ${claimedNow} options exercised, but its schedule only ever reaches ${ceilingNow}, `
          + 'so early exercise can’t be turned off while they stand.');
      }
    }
    if (after.kind === 'option' && after.earlyExercise) return;
    const units = after.kind === 'rsu';
    const claimed = units ? rsuSettled(after) : grantExercised(after);
    const ceiling = vestingCeiling(after);
    if (claimed <= ceiling || ceiling >= vestingCeiling(before)) return;
    const frozen = vestingStopDate(after);
    const reason = frozen && vestingCeiling({ ...after, cancelledDate: '', vestingStoppedAt: '' }) > ceiling
      ? `only ${ceiling} had vested when its vesting stopped on ${frozen}`
      : `its vesting schedule only ever reaches ${ceiling}`;
    throw new Error(`${after.label} has ${claimed} ${units ? 'units settled' : 'options exercised'}, but ${reason}.`);
  }

  #assertVestingSchedule(security, existing = null) {
    if (security.vestingStoppedAt && security.vestingStoppedAt < (security.grantDate || security.date)
      && (security.vestingStoppedAt !== existing?.vestingStoppedAt
        || (security.grantDate || security.date) !== (existing?.grantDate || existing?.date))) {
      throw new Error('Vesting cannot stop before the award was granted.');
    }
    const scheduled = (security.vestingTranches || []).reduce((sum, t) => sum + t.quantity, 0);
    const limit = vestingScheduleLimit(existing, security.quantity);
    if (scheduled > limit) {
      throw new Error(`The vesting tranches add up to ${scheduled}, more than the ${limit} this schedule can cover.`);
    }
  }

  /**
   * An award's date cannot move past the shares already drawn off it. An
   * exercise and a settlement are both refused before the grant they come
   * out of - the forms say so, and there is nothing to buy or settle before
   * the award exists - but editing the award's date afterwards walked
   * straight over that: a grant moved to 2026 kept a 2025 exercise
   * certificate, which then reads as bought a year before it was granted,
   * files Form 3921 with a grant date after its own exercise date, and
   * disappears out of every historical snapshot where its own certificate is
   * outstanding.
   *
   * Refused rather than reconciled: which record is wrong is the user's to
   * say, and moving the certificate would move the shares' issue date and
   * the tax year of the exercise with it.
   */
  #assertAwardChronology(before, after) {
    if (before.kind === 'shares' && !before.fromTransferId && before.date !== after.date) {
      const award = this.security(before.fromOptionId || before.fromRsuId);
      const granted = award?.grantDate || award?.date;
      if (granted && after.date < granted) {
        throw new Error(`The certificate date can’t precede its source award (${granted}).`);
      }
      /* Nor follow the day the right to exercise ended. An exercise is
         refused after the expiration or the post-termination deadline, and a
         window is refused that closes before an exercise already recorded -
         but the certificate's own date could still be moved past the window
         afterwards, leaving a grant expired with unexercised options on the
         needs-attention list beside its own certificate saying they were
         bought after the right to buy them had lapsed. */
      const cutoff = award?.kind === 'option' ? exerciseCutoff(award) : '';
      if (cutoff && after.date > cutoff) {
        const clock = award.exerciseBy && cutoff === award.exerciseBy ? 'the exercise deadline' : 'the expiration';
        throw new Error(`${before.label} can’t be dated after ${clock} of ${award.label}, ${cutoff}.`);
      }
      /* A conversion certificate is the shares a SAFE or note became, and
         the same rule holds: nothing converts before the instrument was
         signed. Dated earlier, a snapshot between the two dates showed the
         shares with no instrument in existence and read the cheque as never
         having come in. */
      const source = before.fromConvertibleId ? this.security(before.fromConvertibleId) : null;
      if (source?.date && after.date < source.date) {
        throw new Error(`The certificate date can’t precede the ${source.kind === 'safe' ? 'SAFE' : 'note'} `
          + `it converted from (${source.date}).`);
      }
      return;
    }
    /* A maturity cannot have been settled before the note was signed: the
       attention flow refuses the date, and so does the record - a settled
       date before the note read back as "matured, settled" on a day the
       instrument did not exist. Only a date this write sets or moves, so a
       record imported in that state stays editable otherwise. */
    if (before.kind === 'note') {
      const settled = str(after.maturedAt);
      if (settled && settled !== str(before.maturedAt) && str(after.date) && settled < str(after.date)) {
        throw new Error(`${before.label} was issued on ${after.date}, so its maturity can’t have been settled on ${settled}.`);
      }
    }
    /* And the instrument cannot move past the round that converted it. A
       note dated after its own conversion showed a snapshot between the two
       with its shares outstanding and no note anywhere, and capital raised
       swapped the cheque for shares x conversion price - the accrued
       interest counted as money received. Only when the date moves: a
       record already in that state (an import) stays editable otherwise. */
    if ((before.kind === 'safe' || before.kind === 'note') && before.date !== after.date) {
      const converted = str(after.convertedAt);
      if (converted && str(after.date) > converted) {
        throw new Error(`${before.label} converted on ${converted}, so its date can’t move past it.`);
      }
      return;
    }
    if (before.kind !== 'option' && before.kind !== 'rsu') return;
    /* A post-termination deadline set or moved by hand cannot precede the
       departure it follows from. The departure flow refuses one, and the
       option sheet does, but the record took it: the lapse the attention
       flow then dated on that deadline put a forfeiture before the
       termination, and a snapshot between the two read options lapsed
       after the window closed on a holder still employed. Only a deadline
       this write sets or moves, so an imported record stays editable. */
    if (before.kind === 'option') {
      const deadline = str(after.exerciseBy).slice(0, 10);
      if (deadline && deadline !== str(before.exerciseBy).slice(0, 10)) {
        const holder = this.stakeholder(after.stakeholderId);
        if (holder?.departed && deadline < holder.departed) {
          throw new Error(`${holder.name} departed on ${holder.departed}, so ${before.label}’s exercise deadline can’t precede it.`);
        }
      }
    }
    const moved = str(after.grantDate) || str(after.date);
    if (!moved || moved <= (str(before.grantDate) || str(before.date))) return;
    /* Nor past a forfeiture already recorded on it, or the post-termination
       deadline a departure set. Both flows refuse a date before the award -
       a departure dated before a grant, a cancellation before its award -
       and moving the award afterwards walked over that: a grant re-dated
       past its own forfeiture read as expired with nothing ever vested, its
       forfeiture predated it, and the expense report reversed a cost it had
       never recognized. */
    const units = before.kind === 'rsu';
    const forfeited = cancellationHistory(after).find((c) => c.date && c.date < moved);
    if (forfeited) {
      throw new Error(`${before.label} had ${forfeited.quantity} ${units ? 'units' : 'options'} cancelled on `
        + `${forfeited.date}, so its date can’t move past it.`);
    }
    const deadline = str(after.exerciseBy);
    if (deadline && deadline < moved) {
      throw new Error(`${before.label}’s post-termination exercise deadline is ${deadline}, so its date can’t move past it.`);
    }
    /* Nor past the departure that set that deadline. The departure flow
       refuses a grant dated after the termination date, and a grant that
       forfeited nothing on it (fully vested by then) carried only the
       deadline, which the check above lets the date walk up to: the holder
       then read as departed a month before the grant existed, with that
       departure's window on it. */
    const holder = deadline ? this.stakeholder(after.stakeholderId) : null;
    if (holder?.departed && holder.departed < moved) {
      throw new Error(`${holder.name} departed on ${holder.departed}, which set ${before.label}’s exercise deadline, `
        + 'so its date can’t move past it.');
    }
    const drawn = this.securities.filter((s) => s.kind === 'shares'
      && !s.fromTransferId && s.date && s.date < moved
      && (before.kind === 'option' ? s.fromOptionId === before.id : s.fromRsuId === before.id));
    if (!drawn.length) return;
    const earliest = drawn.reduce((a, c) => (a.date <= c.date ? a : c));
    const verb = before.kind === 'option' ? 'exercised' : 'settled';
    throw new Error(`${earliest.label} was ${verb} out of this award on ${earliest.date}, `
      + `so its date can’t move to ${moved}.`);
  }

  /**
   * Nothing is forfeited from an award before the award exists. The cancel
   * form refuses a cancellation dated before the grant and the departure flow
   * refuses a termination dated before one, and the record itself is held to
   * the same rule: a forfeiture dated before the award stopped its vesting
   * clock on a day it had not started, so the award read as never vesting a
   * single option, and a snapshot between the two dates rewound a forfeiture
   * of options that did not exist yet. Only a forfeiture this write adds is
   * checked, so an award imported already in that state stays editable.
   */
  #assertForfeituresAfterAward(before, after) {
    if (after.kind !== 'option' && after.kind !== 'rsu') return;
    const granted = str(after.grantDate) || str(after.date);
    if (!granted) return;
    const had = new Set(cancellationHistory(before).map((c) => `${c.date}:${c.quantity}`));
    const early = cancellationHistory(after)
      .find((c) => !had.has(`${c.date}:${c.quantity}`) && c.date && c.date < granted);
    if (!early) return;
    throw new Error(`${after.label} was granted on ${granted}, so ${early.quantity} `
      + `${after.kind === 'rsu' ? 'units' : 'options'} can’t be cancelled from it on ${early.date}.`);
  }

  /**
   * A certificate born of an exercise or a settlement is one number written
   * twice: the shares on the certificate, and the award's counter saying how
   * much of it has already become stock. Resizing the certificate alone
   * leaves the award holding options it has spent - edit a 1,000-option
   * grant's 100-share certificate to 900 and the grant still says 900 are
   * exercisable, so it issues those too and 1,800 shares come out of a
   * 1,000-option grant.
   *
   * The counter therefore moves with the certificate, and the edit is refused
   * when the award has no room for it - refused rather than clamped, because
   * quietly writing a different number than the one typed is how the two
   * halves come apart in the first place. Transfer successors carry the award
   * link for lineage but were never drawn off the award; they are the
   * certificate's shares changing hands, and never move the counter.
   *
   * Vesting is not re-checked here against the counter: what the holder could
   * have exercised on a given date is a question about each certificate's own
   * date, and #assertExercisesBehindVesting asks it certificate by certificate.
   */
  #reissueAgainstAward(before, after) {
    if (before.kind !== 'shares' || before.fromTransferId) return;
    const awardId = before.fromOptionId || before.fromRsuId;
    if (!awardId) return;
    const size = int(after.quantity);
    if (size === int(before.quantity)) return;
    const award = this.security(awardId);
    if (!award) return;
    const units = award.kind === 'rsu';
    const held = units ? rsuOutstanding(award) : grantOutstanding(award);
    const elsewhere = Math.max(0,
      (units ? rsuSettled(award) : grantExercised(award)) - int(before.quantity));
    if (size > held - elsewhere) {
      const left = held - elsewhere;
      throw new Error(`${award.label} has ${left} ${units ? 'unit' : 'option'}${left === 1 ? '' : 's'} `
        + `left to ${units ? 'settle' : 'exercise'}.`);
    }
    this.securities = this.securities.map((s) => (s.id === awardId
      ? Store.sanitizeSecurities([{
        ...s, [units ? 'settled' : 'exercised']: elsewhere + size,
        id: s.id, kind: s.kind, label: s.label,
      }], this)[0] || s
      : s));
    if (!units && award.earlyExercise && (award.vestingMonths > 0 || award.vestingTranches?.length)) {
      // A resized certificate cannot grow into installments another
      // certificate already owns. Reallocate only this certificate against
      // the others; their recorded schedules remain intact.
      const schedule = exerciseVestingSchedule(this.security(awardId),
        this.securities.filter((s) => s.id !== after.id), size, { certifying: size });
      /* A certificate that holds only installments already vested on its
         date is plain stock and carries no schedule - unless an 83(b) fact
         is recorded on it. The record keeps those facts only beside a
         schedule, so stripping it dropped a recorded filing, and grown
         again the certificate came back restricted with the filing gone
         and the needs-attention list saying the window was missed. */
      const restricted = vestedQuantity({ ...after, ...schedule }, after.date) < size
        || !!after.filed83b || after.missed83b === true;
      this.securities = this.securities.map((s) => s.id === after.id
        ? Store.sanitizeSecurities([{
          ...s, vestingMonths: 0, cliffMonths: 0, vestingStart: '', vestingBase: 0,
          vestingOffset: 0, vestingTranches: [], ...(restricted ? schedule : {}),
        }], this)[0] : s);
    }
  }

  /**
   * The certificates an award was exercised or settled into. While any
   * exist, the award itself cannot be deleted: exercised options stay drawn
   * from the pool through the grant they came from, so deleting the grant
   * alone handed those shares back to the pool while the certificate kept
   * them outstanding - the same shares offered twice.
   */
  certificatesFrom(awardId) {
    return this.securities.filter((s) => s.kind === 'shares'
      && (s.fromOptionId === awardId || s.fromRsuId === awardId || s.fromWarrantId === awardId));
  }

  /**
   * The certificates a transfer or repurchase drew off this one. While any
   * exist, the source cannot be deleted: they were sized and dated against
   * it, `dbAsOf` reopens it to read dates before the transfer, and an
   * exercise nets against it - `certifiedByGrant` counts the source, not the
   * successors, so that the two legs of a transfer are never both counted.
   * Delete the source alone and the grant's 1,000 exercised options read as
   * never exercised while the successor shares stay outstanding: the same
   * equity twice in the diluted base.
   */
  successorsOf(certId) {
    return this.securities.filter((s) => s.fromTransferId === certId);
  }

  /**
   * The certificate a converted SAFE or note became, while it is still on
   * the table; null for a live instrument, another kind, or a conversion
   * whose certificate is already gone. While it stands the instrument cannot
   * be deleted - see deleteSecurity.
   */
  convertedInto(security) {
    if (security?.kind !== 'safe' && security?.kind !== 'note') return null;
    return security.convertedToId ? this.security(security.convertedToId) : null;
  }

  /**
   * The convertibles marked converted into any of `certIds`, reopened: a SAFE
   * or note whose conversion certificate is going is a live instrument again.
   *
   * Deleting the certificate alone left the instrument marked converted into
   * nothing. It was out of the convertibles the round model converts, and its
   * shares were gone, so the money simply left every base - a $500,000 SAFE
   * that read "Converted" in the list, counted in capital raised, and stood
   * nowhere on the cap table. An exercise certificate's shares go back to the
   * grant when it is deleted; a conversion's go back to the instrument.
   *
   * Returns the records as they stood, for an undo to put the marks back.
   */
  #reopenConvertedInto(certIds) {
    const reopened = [];
    this.securities = this.securities.map((s) => {
      if ((s.kind !== 'safe' && s.kind !== 'note') || !certIds.has(s.convertedToId)) return s;
      reopened.push(s);
      return Store.sanitizeSecurities([{
        ...s, convertedAt: '', convertedToId: '', id: s.id, kind: s.kind, label: s.label,
      }], this)[0] || s;
    });
    return reopened;
  }

  /**
   * The instrument a restored conversion certificate re-marks has to be the
   * one the delete reopened, still open. Converted again meanwhile - into a
   * second certificate - or deleted, and the undo put the first certificate
   * back anyway: one SAFE's money on the table twice, or a SAFE outstanding
   * as a convertible beside the shares it became (its own undo restores it
   * in the reopened state it was removed in).
   */
  #assertRemarkable(reopened) {
    for (const mark of reopened) {
      const now = this.security(mark.id);
      if (!now || (now.convertedAt && now.convertedToId !== mark.convertedToId)) {
        throw new Error('The cap table has changed since the delete.');
      }
    }
  }

  /** Put the conversion marks back on instruments whose certificate an undo
   *  is restoring, once #assertRemarkable has found them still open. */
  #remarkConverted(reopened) {
    if (!reopened.length) return;
    const was = new Map(reopened.map((s) => [s.id, s]));
    this.securities = this.securities.map((s) => {
      const mark = was.get(s.id);
      if (!mark || s.convertedAt) return s;
      return { ...s, convertedAt: mark.convertedAt, convertedToId: mark.convertedToId };
    });
  }

  /**
   * Take the units a deleted settlement certificate carried back off its
   * award's counter, as `[{ id, units }]` for an undo to put back.
   *
   * Settlement is the shares arriving: settleRSU writes the counter and the
   * certificate together, and nothing else moves the counter up. So a
   * certificate deleted alone left units marked settled with no shares to
   * show for them - back in the diluted base as units, yet neither
   * settleable (the counter said they were) nor cancellable (settled units
   * never are), with no sheet that could touch the counter. An exercise
   * certificate deliberately keeps its grant's counter: an exercise can
   * stand without its paper, and certifyExercise issues it later. An RSU
   * has no such path, and needs none once the counter follows the shares.
   * Transfer successors re-present shares already counted on the
   * certificate they came off.
   */
  #unsettleFor(certs) {
    const taken = new Map();
    for (const c of certs) {
      if (c.kind !== 'shares' || !c.fromRsuId || c.fromTransferId) continue;
      taken.set(c.fromRsuId, (taken.get(c.fromRsuId) || 0) + int(c.quantity));
    }
    const out = [];
    if (!taken.size) return out;
    this.securities = this.securities.map((s) => {
      const units = taken.get(s.id);
      if (!units || s.kind !== 'rsu') return s;
      out.push({ id: s.id, units });
      return Store.sanitizeSecurities([{
        ...s, settled: Math.max(0, int(s.settled) - units), id: s.id, kind: s.kind, label: s.label,
      }], this)[0] || s;
    });
    return out;
  }

  /** Put settled units back on their awards as an undo restores the
   *  certificates that hold them. An award that can no longer take them -
   *  cancelled down, or gone - refuses the undo rather than clamping. */
  #resettleFor(taken) {
    for (const { id, units } of taken) {
      const award = this.security(id);
      if (!award || award.kind !== 'rsu' || rsuSettled(award) + units > rsuOutstanding(award)) {
        throw new Error('The cap table has changed since the delete.');
      }
    }
    if (!taken.length) return;
    const back = new Map(taken.map((t) => [t.id, t.units]));
    this.securities = this.securities.map((s) => (back.has(s.id)
      ? Store.sanitizeSecurities([{
        ...s, settled: int(s.settled) + back.get(s.id), id: s.id, kind: s.kind, label: s.label,
      }], this)[0] || s
      : s));
  }

  /**
   * The transfer a certificate is one leg of, while it can still be undone:
   * the closed certificate it came off, and every leg that transfer issued.
   * Null for anything that is not an open leg of a closed source.
   *
   * A transfer is one event that closed the source and issued its legs in
   * one commit, and deleting a leg alone left the source closed against legs
   * that were no longer there: 400 of 1,000 shares gone with nothing
   * repurchased, both legs deleted and the source still reading closed, and
   * no record offering a way back short of a restore point. So deleting any
   * leg undoes the transfer - every leg goes and the source reopens with its
   * full holding - the way deleting a conversion certificate puts the
   * instrument back among the convertibles. A leg already closed itself (a
   * buyer's shares since repurchased) is history rather than a live leg, and
   * deletes as the record it is.
   */
  transferOf(security) {
    if (security?.kind !== 'shares' || !security.fromTransferId || security.closedAt) return null;
    const source = this.security(security.fromTransferId);
    if (!source?.closedAt) return null;
    return { source, legs: this.successorsOf(source.id) };
  }

  /**
   * Returns { undo } re-inserting what was removed (idempotent), with
   * `removed` (every record that went) and `reopened` (the transfer source
   * that opened again, or null) for the caller's message.
   */
  async deleteSecurity(id) {
    if (!this.security(id)) return { undo: async () => {}, removed: [], reopened: null };
    /* The records as they stand when the queue gets here - see
       deleteStakeholder. An edit queued ahead of the delete (a cancellation
       still being written, an attachment landing) had not applied when this
       was called, and a copy taken then put the pre-edit record back. */
    let removed = [];
    let reopened = [];
    let unsettled = [];
    let lineage = null;
    /* The source a transfer closed, as it stood closed, for the undo to
       close it again. */
    let reclosed = null;
    await this.#commit('deleteSecurity', ['securities'], () => {
      const target = this.security(id);
      if (!target) return;
      if (['option', 'rsu', 'warrant'].includes(target.kind)) {
        const issued = this.certificatesFrom(id);
        if (issued.length) {
          throw new Error(`${target.label} was ${target.kind === 'rsu' ? 'settled' : 'exercised'} into `
            + `${issued.map((c) => c.label).join(', ')}. Delete those certificates first.`);
        }
      }
      const successors = this.successorsOf(id);
      if (successors.length) throw new Error(successorsStand(target, successors));
      /* A leg since repurchased in full while its source stands closed - see
         retiredLegStands. The sibling that stays open gets the same answer
         below; without this the closed leg went first and the sibling then
         "undid" the transfer at the source's full size. */
      const retiredFrom = this.#retiredLegOf(target);
      if (retiredFrom) throw new Error(retiredLegStands(target, retiredFrom));
      /* And a SAFE or note while the shares it became are on the table, for
         the reason an award is held to its certificates. The certificate
         carries only a reference back; with the instrument gone it read as
         plain shares in the securities list, capital raised swapped the
         cheque that actually came in for shares x conversion price - every
         dollar of a note's accrued interest with it - and the issuance
         history lost the financing the money had been counted under. The
         way to undo a conversion is to delete the certificate, which puts
         the instrument back among the outstanding convertibles. */
      const became = this.convertedInto(target);
      if (became) {
        throw new Error(`${target.label} was converted into ${became.label}. Delete that certificate first.`);
      }
      /* A transfer leg takes the whole transfer with it - see transferOf.
         Only while every other leg still stands as issued: one transferred
         on has legs of its own in the way, exactly as the leg itself would,
         and one since repurchased recorded a buyback of shares the reopened
         source would say were never sold. */
      const transfer = this.transferOf(target);
      let going = [target];
      if (transfer) {
        for (const leg of transfer.legs) {
          if (leg.id === target.id) continue;
          const onward = this.successorsOf(leg.id);
          if (onward.length) {
            throw new Error(successorsStand(leg, onward, { subject: `${leg.label}, issued by the same transfer,` }));
          }
          if (leg.closedAt) {
            throw new Error(`${leg.label}, issued by the same transfer, was since repurchased, so the transfer `
              + `can’t be undone here. Restore the point taken before it instead.`);
          }
        }
        going = transfer.legs;
        reclosed = transfer.source;
      }
      removed = going;
      lineage = this.#lineageAtDelete(going);
      const ids = new Set(going.map((s) => s.id));
      this.securities = this.securities.filter((s) => !ids.has(s.id));
      if (reclosed) {
        this.securities = this.securities.map((s) => (s.id === reclosed.id
          ? Store.sanitizeSecurities([{
            ...s, closedAt: '', closedReason: '', repurchasedQty: 0, repurchasePricePerShare: 0,
            id: s.id, kind: s.kind, label: s.label,
          }], this)[0] || s
          : s));
      }
      reopened = this.#reopenConvertedInto(ids);
      unsettled = this.#unsettleFor(going);
    }, ['securities']);
    const epoch = this.#dataEpoch;
    return {
      removed,
      reopened: reclosed ? this.security(reclosed.id) : null,
      undo: () => this.#commit('undo.deleteSecurity', ['securities'], () => {
        // Nothing was removed (the record was already gone), so nothing goes back.
        if (!removed.length) return;
        // Same dataset-identity guard as deleteStakeholder's undo.
        if (epoch !== this.#dataEpoch) throw new Error('The cap table has changed since the delete.');
        const have = new Set(this.securities.map((s) => s.id));
        const back = removed.filter((s) => !have.has(s.id));
        if (!back.length) return;
        if (back.some((s) => !this.#referencesResolve(s))) {
          throw new Error('The cap table has changed since the delete.');
        }
        if (reclosed) {
          /* The legs were sized and dated against the source as it stood. A
             source resized, moved, transferred again, or gone in the meantime
             is not the one they came off, so they stay gone. Or repriced:
             the legs inherited the source's price, and a price edit carries
             across a transfer family only while it stands closed (see
             #repriceTransferFamily) - so a source repriced while reopened
             was re-closed under legs still at the old price, the very
             two-prices state that rule exists to prevent. */
          const source = this.security(reclosed.id);
          if (!source || source.closedAt || int(source.quantity) !== int(reclosed.quantity)
            || source.classId !== reclosed.classId || source.date !== reclosed.date
            || num(source.pricePerShare) !== num(reclosed.pricePerShare)
            || Store.#transferSourceTerms(source) !== Store.#transferSourceTerms(reclosed)) {
            throw new Error('The cap table has changed since the delete.');
          }
          this.securities = this.securities.map((s) => (s.id === reclosed.id
            ? Store.sanitizeSecurities([{
              ...s, closedAt: reclosed.closedAt, closedReason: reclosed.closedReason,
              repurchasedQty: reclosed.repurchasedQty, repurchasePricePerShare: reclosed.repurchasePricePerShare,
              id: s.id, kind: s.kind, label: s.label,
            }], this)[0] || s
            : s));
        }
        this.#resettleFor(unsettled);
        this.#assertRemarkable(reopened);
        this.securities = [...this.securities, ...back];
        this.#assertLineageStands(back, lineage);
        this.#remarkConverted(reopened);
      }, ['securities']),
    };
  }

  /**
   * Record an option exercise and, when a class is given, issue the resulting
   * certificate in the same commit. The exercise and its certificate are one
   * real-world event: written as two commits, a failed second write keeps the
   * exercise but drops the certificate - and the exercise form can never
   * re-issue it, because those options no longer read as exercisable.
   *
   * An exercise past the vested balance is an early exercise: allowed only
   * when the grant says so, and the certificate then carries the grant's
   * remaining schedule as reverse vesting - which also starts its 30-day
   * 83(b) window.
   */
  async exerciseOption(grantId, { quantity, date, classId = null }) {
    return this.#commit('exerciseOption', ['securities'], () => {
      const grant = this.security(grantId);
      if (!grant || grant.kind !== 'option') throw new Error('That option grant is gone.');
      const qty = wholeCount(quantity, 'Nothing to exercise.');
      /* The date is load-bearing, as it is on a settlement: it dates the
         certificate, the vesting check below, and the Form 3921 year. An
         empty one issued an undated certificate, and one before the grant
         recorded an exercise of options that did not exist yet - the forms
         refuse both, and so does the record, since a certificate's date is
         already held to its award's when it is edited (#assertAwardChronology). */
      const when = str(date).slice(0, 10);
      if (!when) throw new Error('Pick an exercise date.');
      if (!isISODate(when)) throw new Error('Pick a valid exercise date.');
      const granted = grant.grantDate || grant.date;
      if (granted && when < granted) {
        throw new Error(`These options were granted on ${granted} and could not be exercised before it.`);
      }
      /* Nothing can be exercised after the right to do so ended: the
         expiration, or the post-termination deadline a departure set. A
         historical exercise dated on or before that day is still fine. */
      const cutoff = exerciseCutoff(grant);
      if (cutoff && when > cutoff) {
        throw new Error(`These options could not be exercised after ${cutoff}.`);
      }
      /* The invariant, enforced where the records are written: the sanitizer
         clamps the grant's own counter, but the certificate below would still
         carry the full quantity - phantom shares no view could explain. Held
         to the certificates already issued out of the grant as well as to
         its counter: a certificate that arrived naming the grant on its own
         (a backup, the API) is an exercise the counter never saw, and read
         off the counter alone the grant exercised its whole size on top of
         it - 6,800 shares certified out of 4,800 options. */
      const taken = Math.max(grantExercised(grant), certifiedByGrant(this.securities).get(grant.id) || 0);
      if (qty > grantOutstanding(grant) - taken) {
        throw new Error('That is more than this grant has left to exercise.');
      }
      /* Held to the vesting on the exercise date, net of what had been
         exercised by then - not of the whole counter, which refused a valid
         history entered out of date order. See exerciseRoom. */
      const early = qty > exerciseRoom(grant, this.securities, when).room;
      if (early && !grant.earlyExercise) {
        throw new Error('Only vested options can be exercised on this grant.');
      }
      // The counter catches up to the certificates before it counts this one.
      const exercised = taken + qty;
      this.securities = this.securities.map((s) => (s.id === grantId
        ? Store.sanitizeSecurities([{ ...s, exercised, id: s.id, kind: s.kind, label: s.label }], this)[0] || s
        : s));
      if (!classId) return null;
      return this.#exerciseCertificate(grant, { quantity: qty, date: when, classId, early });
    }, ['securities']);
  }

  /**
   * The certificate an exercise turns into, appended to the securities: the
   * grant's holder, the strike as its price, and a link back to the grant so
   * the diluted base nets the two. An early exercise carries the grant's
   * remaining schedule as reverse vesting.
   *
   * One builder for both paths that issue one - the exercise itself, and a
   * certificate issued later for an exercise recorded without one - so the
   * two can never describe the same purchase differently.
   */
  #exerciseCertificate(grant, { quantity, date, classId, early, certifying = 0 }) {
    const full = roomFor('securities', this.securities.length, 1, MAX_SECURITIES);
    if (full) throw new ListFullError(full);
    const input = {
      kind: 'shares', stakeholderId: grant.stakeholderId, classId,
      quantity, pricePerShare: grant.strike || 0, date,
      fromOptionId: grant.id,
      id: uid(), label: nextLabel(this.db, 'shares', classId), createdAt: Date.now(),
    };
    if (early) {
      Object.assign(input, exerciseVestingSchedule(grant, this.securities, quantity, { certifying }));
      /* The reverse-vesting schedule the certificate carries is the
         grant's, and so are the terms that accelerate it. Buying the
         shares early is not an amendment striking the provision. */
      if (grant.accelTrigger) {
        input.accelTrigger = grant.accelTrigger;
        input.accelPct = grant.accelPct;
      }
    }
    const cert = Store.sanitizeSecurities([input], this)[0];
    if (!cert) throw new Error('Could not issue the exercise certificate.');
    this.securities = [...this.securities, cert];
    return cert;
  }

  /**
   * Options a grant has exercised that no certificate accounts for yet: the
   * counter, less the certificates issued out of it (originals at issued
   * size, transfer successors skipped - the certifiedByGrant rule).
   */
  uncertifiedExercises(grant) {
    if (!grant || grant.kind !== 'option') return 0;
    return Math.max(0, grantExercised(grant) - (certifiedByGrant(this.securities).get(grant.id) || 0));
  }

  /**
   * Issue the certificate for an exercise that was recorded without one.
   *
   * An exercise can be recorded on the grant alone - the shares not yet
   * papered, or a cap table imported with the counters but not the
   * certificates. Those options are already out of the grant's exercisable
   * balance, so the exercise form cannot issue them, and Form 3921 lists
   * them as exercises nothing dates. This is the way through: a certificate
   * for up to the uncertified balance, dated the day the exercise was made,
   * under the same rules an exercise is held to - not before the grant, not
   * after the right to exercise ended, and early only where the grant allows
   * it, in which case the certificate reverse-vests exactly as it would have
   * had it been issued with the exercise. The counter does not move: the
   * exercise already happened.
   */
  async certifyExercise(grantId, { quantity, date, classId }) {
    return this.#commit('certifyExercise', ['securities'], () => {
      const grant = this.security(grantId);
      if (!grant || grant.kind !== 'option') throw new Error('That option grant is gone.');
      const qty = wholeCount(quantity, 'Nothing to certify.');
      const when = str(date).slice(0, 10);
      if (!when) throw new Error('Pick the exercise date.');
      if (!isISODate(when)) throw new Error('Pick a valid exercise date.');
      const granted = grant.grantDate || grant.date;
      if (granted && when < granted) {
        throw new Error(`These options were granted on ${granted} and could not be exercised before it.`);
      }
      const cutoff = exerciseCutoff(grant);
      if (cutoff && when > cutoff) {
        throw new Error(`These options could not be exercised after ${cutoff}.`);
      }
      const uncertified = this.uncertifiedExercises(grant);
      if (qty > uncertified) {
        throw new Error(uncertified > 0
          ? `Only ${uncertified} exercised options are still without a certificate.`
          : 'Every exercise on this grant already has its certificate.');
      }
      /* Vested on the exercise date, net of what had been exercised by then
         - the position exerciseOption would have checked had this
         certificate been issued with the exercise. The options being
         certified leave the undated balance as they gain their day. */
      const early = qty > exerciseRoom(grant, this.securities, when, { certifying: qty }).room;
      if (early && !grant.earlyExercise) {
        throw new Error('Only vested options can be exercised on this grant.');
      }
      if (!str(classId)) throw new Error('Pick a share class for the certificate.');
      return this.#exerciseCertificate(grant, { quantity: qty, date: when, classId: str(classId), early, certifying: qty });
    }, ['securities']);
  }

  #assertWarrant(warrant, before = warrant) {
    if (!warrant || warrant.kind !== 'warrant') throw new Error('The source warrant is gone.');
    const exercised = warrantExercised(warrant, this.securities);
    const cancelled = cancellationHistory(warrant).reduce((n, c) => n + c.quantity, 0);
    if (int(warrant.quantity) < exercised + Math.max(cancelled, int(before.cancelled))) {
      throw new Error('The warrant cannot cover fewer shares than were exercised or cancelled.');
    }
    if (warrant.expires && warrant.date && warrant.expires < warrant.date) {
      throw new Error('The warrant expiration cannot precede its issue date.');
    }
    for (const c of cancellationHistory(warrant)) {
      if (c.date < warrant.date || (warrant.expires && c.date > warrant.expires)) {
        throw new Error('A warrant cancellation must fall between its issue and expiration dates.');
      }
    }
    for (const c of this.certificatesFrom(warrant.id)) {
      if (c.fromTransferId) continue;
      if (c.date < warrant.date || (warrant.expires && c.date > warrant.expires)) {
        throw new Error(`${c.label} must be dated within ${warrant.label}’s exercise window.`);
      }
      if (c.classId !== warrant.classId) throw new Error('The exercise certificate must use its warrant’s share class.');
    }
  }

  async cancelWarrant(id, { quantity, date }) {
    let before; let epoch;
    const warrant = await this.#commit('cancelWarrant', ['securities'], () => {
      const warrant = this.security(id);
      this.#assertWarrant(warrant);
      before = warrant; epoch = this.#dataEpoch;
      const n = Number(quantity);
      const when = str(date).slice(0, 10);
      if (!Number.isSafeInteger(n) || n <= 0
        || n > int(warrant.quantity) - int(warrant.cancelled) - warrantExercised(warrant, this.securities)) {
        throw new Error('Enter a whole number within the unexercised warrant balance.');
      }
      if (!isISODate(when)) {
        throw new Error('Pick a valid cancellation date.');
      }
      if (cancellationHistory(warrant).length >= 120) throw new Error('A warrant can hold at most 120 cancellation events.');
      const next = Store.sanitizeSecurities([{
        ...warrant, cancellations: [...cancellationHistory(warrant), { quantity: n, date: when }],
      }], this)[0];
      this.#assertWarrant(next);
      this.securities = this.securities.map((s) => s.id === id ? next : s);
      return next;
    }, ['securities']);
    return { warrant, undo: () => this.#commit('undoWarrantCancellation', ['securities'], () => {
      if (epoch !== this.#dataEpoch || JSON.stringify(this.security(id)) !== JSON.stringify(warrant)) {
        throw new Error('The warrant has changed since the cancellation.');
      }
      this.#assertWarrant(before);
      this.securities = this.securities.map((s) => s.id === id ? before : s);
    }, ['securities']) };
  }

  /** Exercise and its fully paid share certificate are one atomic write. */
  async exerciseWarrant(id, { quantity, date }) {
    return this.#commit('exerciseWarrant', ['securities'], () => {
      const warrant = this.security(id);
      this.#assertWarrant(warrant);
      const n = Number(quantity);
      const when = str(date).slice(0, 10);
      if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Enter a positive whole number of warrant shares.');
      if (n > int(warrant.quantity) - int(warrant.cancelled) - warrantExercised(warrant, this.securities)) {
        throw new Error('That exceeds the unexercised warrant balance.');
      }
      const full = roomFor('securities', this.securities.length, 1, MAX_SECURITIES);
      if (full) throw new ListFullError(full);
      if (!isISODate(when)) {
        throw new Error('Pick a valid exercise date.');
      }
      const cert = Store.sanitizeSecurities([{
        id: uid(), kind: 'shares', label: nextLabel(this.db, 'shares', warrant.classId),
        stakeholderId: warrant.stakeholderId, classId: warrant.classId,
        quantity: n, pricePerShare: warrant.strike, date: when, createdAt: Date.now(),
        fromWarrantId: warrant.id,
      }], this)[0];
      if (!cert) throw new Error('Could not issue the exercise certificate.');
      this.securities = [...this.securities, cert];
      this.#assertWarrant(warrant);
      return cert;
    }, ['securities']);
  }

  /**
   * Settle vested RSU units into shares: the award's counter and the
   * certificate it produces land in one commit, for the same reason an
   * exercise and its certificate do - written separately, a failed second
   * write would leave units marked settled with no shares to show for them,
   * and no way to re-issue the certificate.
   *
   * There is nothing to pay to settle a unit, so the certificate is issued at
   * no cost. Withholding and sell-to-cover are deliberately not modeled;
   * what is recorded here is the shares the holder received.
   */
  async settleRSU(awardId, { quantity, date, classId = null }) {
    return this.#commit('settleRSU', ['securities'], () => {
      const award = this.security(awardId);
      if (!award || award.kind !== 'rsu') throw new Error('That RSU award is gone.');
      const qty = wholeCount(quantity, 'Nothing to settle.');
      // Held to the certificates as well as the counter - see exerciseOption.
      const already = Math.max(rsuSettled(award), certifiedByRsu(this.securities).get(award.id) || 0);
      if (qty > rsuOutstanding(award) - already) {
        throw new Error('That is more than this award has left to settle.');
      }
      const when = str(date).slice(0, 10);
      if (!when) throw new Error('Pick a settlement date.');
      if (!isISODate(when)) throw new Error('Pick a valid settlement date.');
      // Nothing settles before the award exists - the same rule an exercise follows.
      const granted = award.grantDate || award.date;
      if (granted && when < granted) {
        throw new Error(`These units were awarded on ${granted} and could not settle before it.`);
      }
      /* Vesting is measured on the settlement date, so a backdated settlement
         checks against that day's balance - net of the units settled by then,
         not of every settlement on file - the same rule exerciseOption
         enforces. See exerciseRoom. */
      if (qty > exerciseRoom(award, this.securities, when).room) {
        throw new Error('Only vested units can be settled.');
      }
      const cls = str(classId) || award.classId;
      const full = roomFor('securities', this.securities.length, 1, MAX_SECURITIES);
      if (full) throw new ListFullError(full);
      this.securities = this.securities.map((s) => (s.id === awardId
        ? Store.sanitizeSecurities([{
          ...s, settled: already + qty, id: s.id, kind: s.kind, label: s.label,
        }], this)[0] || s
        : s));
      const cert = Store.sanitizeSecurities([{
        kind: 'shares', stakeholderId: award.stakeholderId, classId: cls,
        quantity: qty, pricePerShare: 0, date: when,
        fromRsuId: award.id,
        id: uid(), label: nextLabel(this.db, 'shares', cls), createdAt: Date.now(),
      }], this)[0];
      if (!cert) throw new Error('Could not issue the settlement certificate.');
      this.securities = [...this.securities, cert];
      return cert;
    }, ['securities']);
  }

  /**
   * The share-count and per-share-price effect of a split ratio applied to
   * one securities array - shared by recordSplit and its preview, so the
   * numbers the user reviews are the numbers that commit.
   *
   * Quantities round to the nearest whole share, and a positive holding
   * never rounds below one - a reverse split must not erase a certificate.
   * Returns the transformed records plus the rounding drift on the primary
   * quantities (positive = shares lost to rounding).
   */
  static applySplit(securities, { num, den, id = '' }) {
    const f = num / den;
    let drift = 0;
    /**
     * The holding a split rounded, written down against that split's id.
     *
     * A restated holding cannot be divided back into the one it came from -
     * 15 shares reversed 1-for-10 hold 2, and 2 multiplied back is 20 - so
     * every date before the split read a holding, and a paid-in capital,
     * that were never true. A schedule can lose a tranche even when its total
     * divides exactly, so preserve schedules whose proportions round too.
     * `id` is absent in the split
     * preview, which computes the same numbers but writes nothing.
     */
    const remember = (before, next) => {
      const held = Math.max(0, int(before.quantity));
      if (!id || held <= 0) return next;
      const exact = (held * num) % den === 0 ? (held * num) / den : null;
      const entry = { id, quantity: held };
      let rounded = exact === null || exact !== next.quantity;
      const roundedSchedule = before.vestingTranches?.some((t, i) =>
        t.quantity * num !== next.vestingTranches?.[i]?.quantity * den);
      if (roundedSchedule) {
        entry.vestingTranches = Store.sanitizeTranches(before.vestingTranches);
        rounded = true;
      }
      /* An award's forfeitures and a remainder's vesting base are share
         counts too, and each rounds on its own - see sanitizeSplitHistory. */
      const forfeits = cancellationHistory(before);
      if (forfeits.length) {
        const after = cancellationHistory(next);
        if (forfeits.some((c, i) => c.quantity * num !== (after[i]?.quantity ?? 0) * den)) {
          entry.cancellations = forfeits.map((c) => ({ date: c.date, quantity: c.quantity }));
          rounded = true;
        }
      }
      /* Also whenever the restated base lands at or under the restated
         holding: the sanitizer keeps a base only while it is larger than the
         certificate, so that one is about to be dropped as the ordinary
         state - a 1,000 base over 995 shares went 1-for-10 to 100 over 100,
         exactly, and was gone - and the as-of view then measured the old
         995 against itself, two shares short on every earlier date. */
      const base = int(before.vestingBase);
      if (base > 0 && (base * num !== int(next.vestingBase) * den || int(next.vestingBase) <= next.quantity)) {
        entry.vestingBase = base;
        rounded = true;
      }
      const offset = int(before.vestingOffset);
      if (offset > 0 && offset * num !== int(next.vestingOffset) * den) {
        entry.vestingOffset = offset;
        rounded = true;
      }
      // The count a repurchase retired is one more, read back by repurchaseTerms.
      const retired = int(before.repurchasedQty);
      if (retired > 0 && retired * num !== int(next.repurchasedQty) * den) {
        entry.repurchasedQty = retired;
        rounded = true;
      }
      if (!rounded) return next;
      return {
        ...next,
        preSplit: [...Store.sanitizeSplitHistory(before.preSplit), entry],
      };
    };
    const scaleQ = (q, { track = false } = {}) => {
      if (!(q > 0)) return q;
      const exact = q * f;
      const rounded = Math.max(1, Math.round(exact));
      if (track) drift += exact - rounded;
      return rounded;
    };
    /* An award's total has to keep holding everything that has already
       happened to it: options exercised into certificates that are still
       outstanding, units settled into shares, and whatever went back to the
       pool - all permanent. Each counter rounds up to a whole share on its
       own, so a 3-option grant with one exercised and one cancelled scaled
       1-for-3 to a total of 1 against a history of 2, and the sanitizer,
       which clamps the pair against the total, erased the exercise while its
       certificate stayed outstanding. The total takes whichever is larger. */
    const scaleAwardTotal = (q, spent, nothingLeft = false) => {
      if (!(q > 0)) return q;
      const exact = q * f;
      /* And an award with nothing left - every option exercised or forfeited
         - keeps nothing left. Rounded on its own, the total could come out a
         share above its history: a 2,000-option grant exercised in full as
         two 1,000-share certificates went 1-for-3 to 667 over 666 certified,
         and a fully forfeited grant to 251 over 250 cancelled - one option
         back on the table, exercisable, in the diluted count, and on the
         needs-attention list as expired. */
      const rounded = nothingLeft ? Math.max(1, spent) : Math.max(1, Math.round(exact), spent);
      drift += exact - rounded;
      return rounded;
    };
    const scaleP = (p) => (p > 0 ? tidy(p / f) : p);
    /* Dated share counts - vesting tranches, forfeiture history - restate
       with the position they are measured against. */
    const scaleDated = (list) => (Array.isArray(list)
      ? list.map((t) => ({ ...t, quantity: scaleQ(t.quantity) }))
      : list);
    /**
     * A vesting schedule restated against its own new total.
     *
     * Rounded tranche by tranche the schedule stops adding up to the award.
     * Each positive tranche has a floor of one whole share, so ten tranches
     * of one option through a 1-for-2 reverse split stayed ten options
     * against a grant restated to five - which vested in full five months
     * before its last tranche, and went on announcing tranches after it. A
     * 100-option grant of 1 and 99 came out as 50 scheduled 1 and 50.
     *
     * Scaling the running total and taking differences keeps the schedule
     * summing to the award at every boundary, so its proportions survive and
     * a tranche can legitimately come out at zero - which is what a tranche
     * too small to hold a whole share after a reverse split is. Flooring
     * rather than rounding is what keeps the last boundary the last: a
     * running total that never reaches the award early cannot vest it early.
     */
    const scaleSchedule = (list, before, after) => {
      if (!Array.isArray(list) || !list.length) return list;
      const whole = list.reduce((a, t) => a + Math.max(0, int(t.quantity)), 0);
      if (!(whole > 0)) return list;
      /* The schedule keeps its own relationship to the holding: equal to it
         in the ordinary case, larger where a repurchase out of the unvested
         tail left the whole schedule behind on a smaller certificate. */
      const target = whole === before ? after : Math.max(1, Math.round(whole * f));
      let cum = 0;
      let scaled = 0;
      return list.map((t) => {
        cum += Math.max(0, int(t.quantity));
        const next = Math.min(target, Math.floor((cum * target) / whole));
        const quantity = Math.max(0, next - scaled);
        scaled = next;
        return { ...t, quantity };
      });
    };
    /**
     * A transfer family adds up: the legs a closed source was split into,
     * plus whatever a repurchase retired, are the source. Rounded one by
     * one they came apart by a share - 500 sold as 453 and 47 went 3-for-2
     * to 750 against 680 and 71, the outstanding count moved by that share
     * on the split date, and undoing the transfer moved it back. The parts
     * are sized here against the source's restated total, each floored at
     * a whole share and the largest taking the difference; parents first,
     * so a leg that was sold on again is final before its own legs are.
     * A family that did not add up before the split (an import) rounds as
     * it was, and so does one too small to keep every leg at a share.
     */
    const reconcileFamilies = (before, after) => {
      const beforeById = new Map(before.map((s) => [s.id, s]));
      const afterById = new Map(after.map((s) => [s.id, s]));
      const legsOf = new Map();
      for (const s of before) {
        if (s.kind !== 'shares' || !s.fromTransferId) continue;
        const src = beforeById.get(s.fromTransferId);
        if (!src || src.kind !== 'shares' || !src.closedAt) continue;
        if (!legsOf.has(src.id)) legsOf.set(src.id, []);
        legsOf.get(src.id).push(s);
      }
      const depth = (s) => {
        let d = 0;
        const seen = new Set();
        for (let cur = s; cur?.fromTransferId && !seen.has(cur.id); cur = beforeById.get(cur.fromTransferId)) {
          seen.add(cur.id);
          d += 1;
        }
        return d;
      };
      const sources = [...legsOf.keys()].map((id) => beforeById.get(id)).sort((a, b) => depth(a) - depth(b));
      for (const src of sources) {
        const retired = src.closedReason === 'repurchase' ? int(src.repurchasedQty) : 0;
        const parts = [
          ...(retired > 0 ? [{ retired: true, q: retired }] : []),
          ...legsOf.get(src.id).map((l) => ({ id: l.id, q: int(l.quantity) })),
        ];
        const whole = parts.reduce((a, p) => a + p.q, 0);
        if (whole <= 0 || whole !== int(src.quantity)) continue;
        const target = int(afterById.get(src.id).quantity);
        if (target < parts.length) continue;
        const sized = parts.map((p) => Math.max(1, Math.round((p.q * target) / whole)));
        const largest = sized.indexOf(Math.max(...sized));
        sized[largest] += target - sized.reduce((a, q) => a + q, 0);
        if (sized[largest] < 1) continue;
        parts.forEach((p, i) => {
          if (p.retired) { afterById.get(src.id).repurchasedQty = sized[i]; return; }
          const leg = afterById.get(p.id);
          leg.quantity = sized[i];
          /* A leg that was itself bought back whole has no legs of its own
             and never enters this loop as a source, so its retired count,
             scaled on its own, drifted a share from the size it was just
             given: 10,413 retired of a 10,414-share certificate, and a plan
             recycling repurchases read one phantom share committed. */
          const was = beforeById.get(p.id);
          if (was?.closedReason === 'repurchase' && int(was.repurchasedQty) === int(was.quantity) && !legsOf.has(p.id)) {
            leg.repurchasedQty = sized[i];
          }
        });
      }
    };
    /* Certificates first: an award's counters are reconciled against the
       certificates drawn off it, and each of those rounds on its own. */
    const restated = securities.map((s) => {
      if (s.kind !== 'shares') return s;
      const next = {
        ...s,
        quantity: scaleQ(s.quantity),
        pricePerShare: scaleP(s.pricePerShare),
      };
      if (s.transferPricePerShare) next.transferPricePerShare = scaleP(s.transferPricePerShare);
      // The repurchase's own terms are a share count and a share price.
      if (s.repurchasedQty > 0) next.repurchasedQty = scaleQ(s.repurchasedQty);
      if (s.repurchasePricePerShare) next.repurchasePricePerShare = scaleP(s.repurchasePricePerShare);
      // A share count like any other, so it restates with the quantity it
      // is measured against - left behind, the schedule would read against
      // a position ten times too small.
      if (s.vestingBase > 0) next.vestingBase = scaleQ(s.vestingBase);
      if (s.vestingOffset > 0) next.vestingOffset = scaleQ(s.vestingOffset);
      return next;
    });
    reconcileFamilies(securities, restated);
    const certificates = restated.map((next, i) => {
      const s = securities[i];
      if (s.kind !== 'shares') return next;
      // Sized last, against the quantity the family settled on.
      if (s.vestingTranches) {
        next.vestingTranches = scaleSchedule(s.vestingTranches, int(s.quantity), next.quantity);
      }
      if (!s.closedAt && s.quantity > 0) drift += s.quantity * f - next.quantity;
      /* Paid-in capital is a cheque, and a split does not change it. The
         count rounds to a whole share while the price divides exactly, so
         their product moved: 7 shares at $100,000 went 1-for-3 to 2 at
         $300,000, and capital raised, the issuance history and a dividend's
         basis fell by $100,000 on the day of the split while every earlier
         snapshot kept the old figure. A certificate whose product moves
         keeps the figure it stood for, the way a round-close certificate
         already carries the cheque it brought in; one that restates exactly
         stays as it was. */
      const paid = int(s.quantity) * Math.max(0, Number(s.pricePerShare) || 0);
      const now = next.quantity * Math.max(0, Number(next.pricePerShare) || 0);
      if (s.cashInvested === undefined && paid > 0 && Math.abs(now - paid) > paid * 1e-9) next.cashInvested = paid;
      return remember(s, next);
    });
    const certifiedOptions = certifiedByGrant(certificates);
    const certifiedRsus = certifiedByRsu(certificates);
    // And as they stood before, to tell the counter's papered part from the rest.
    const certifiedOptionsBefore = certifiedByGrant(securities);
    const certifiedRsusBefore = certifiedByRsu(securities);
    const out = certificates.map((s) => {
      if (s.kind === 'option' || s.kind === 'rsu') {
        const claimedKey = s.kind === 'option' ? 'exercised' : 'settled';
        /* The aggregate counter rounds once; the certificates it stands for
           round one by one, and a reverse split can leave them adding up to
           more. Two 1-option exercises of a 4-option grant survive a 1-for-2
           as a whole share each - neither may round away - while the grant's
           counter of 2 rounds to 1, and the grant then read as having an
           option left to exercise over a position it had already certified
           in full: a third share out of a two-share grant. Whichever is
           larger is what has actually left the award. */
        const certified = (s.kind === 'option' ? certifiedOptions : certifiedRsus).get(s.id) || 0;
        const certifiedBefore = (s.kind === 'option' ? certifiedOptionsBefore : certifiedRsusBefore).get(s.id) || 0;
        const counter = int(s[claimedKey]);
        /* Only the part of the counter no certificate stands for yet rounds
           on its own; the papered part is the certificates. Rounded whole,
           the counter of a fully papered grant came out a share above its
           certificates - 2,000 exercised as two 1,000-share certificates went
           1-for-3 to 667 over 666 - and the grant offered to certify an
           exercise that never happened. */
        const uncertified = Math.max(0, counter - certifiedBefore);
        const claimed = certified + (uncertified > 0 ? scaleQ(uncertified) : 0);
        const forfeits = s.cancellations ? scaleDated(s.cancellations) : null;
        const cancelled = forfeits
          ? forfeits.reduce((a, c) => a + c.quantity, 0)
          : (s.cancelled > 0 ? scaleQ(s.cancelled) : 0);
        const cancelledBefore = cancellationHistory(s).reduce((a, c) => a + c.quantity, 0);
        const nothingLeft = int(s.quantity) <= Math.max(counter, certifiedBefore) + cancelledBefore;
        const next = { ...s, quantity: scaleAwardTotal(s.quantity, claimed + cancelled, nothingLeft) };
        if (s.kind === 'option') next.strike = scaleP(s.strike);
        if (claimed > 0) next[claimedKey] = claimed;
        if (cancelled > 0) next.cancelled = cancelled;
        if (forfeits) next.cancellations = forfeits;
        if (s.vestingTranches) {
          next.vestingTranches = scaleSchedule(s.vestingTranches, int(s.quantity), next.quantity);
        }
        /* A frozen award with nothing unvested left keeps nothing unvested. A
           departure forfeits exactly what had not vested by the day, so the
           award holds what its stopped schedule vests - but the total, the
           forfeiture and the schedule's floor each round on their own, and a
           1,000-option grant departed at month 12 of 48 went 1-for-7 to 143
           less 107 forfeited: 36 held over 35 the schedule will ever vest.
           That one option sat in the forecast as still vesting and on the
           needs-attention list as vesting after a departure, on a grant
           nobody had touched. The last forfeiture takes the difference, and
           never below what was exercised or settled. */
        const stopped = vestingStopDate(s);
        // Rounding must not turn a completed forfeiture into a partial one
        // while reconciling the schedule and its certificates.
        const ceiling = () => vestingCeiling({ ...next, vestingStoppedAt: stopped });
        if (stopped && cancelled > 0 && int(s.quantity) - cancelledBefore <= vestingCeiling(s)) {
          const outstanding = next.quantity - cancelled;
          const extra = Math.min(outstanding - ceiling(), outstanding - claimed);
          if (extra > 0) {
            next.cancelled = cancelled + extra;
            if (forfeits) forfeits[forfeits.length - 1].quantity += extra;
          }
        }
        /* And the mirror: a frozen award's schedule has to vest at least what
           was exercised or settled off it. The ceiling floors while the
           certificates round to nearest, so 250 exercised of 1,000 frozen at
           month 12 went 1-for-7 to 36 certified against a ceiling of 35 - the
           grant read 97% vested beside a certificate for all of it, in the
           very state the store refuses every edit into. A tranche schedule
           moves the shortfall into the last tranche that had vested; a
           time-based one grows with its forfeiture, a share at a time, until
           the line reaches the certificates - never adding to what is left. */
        if (stopped && !s.earlyExercise && claimed > 0 && (next.cancelled || 0) > 0) {
          const short = () => claimed - ceiling();
          if (short() > 0 && next.vestingTranches) {
            const list = next.vestingTranches.map((t) => ({ ...t }));
            const lastVested = list.filter((t) => t.date <= stopped).pop();
            const firstAfter = list.find((t) => t.date > stopped);
            if (lastVested && firstAfter) {
              const move = Math.min(short(), firstAfter.quantity);
              lastVested.quantity += move;
              firstAfter.quantity -= move;
              next.vestingTranches = list;
            }
          } else {
            for (let guard = 0; short() > 0 && guard < MAX_VESTING_MONTHS; guard += 1) {
              next.quantity += 1;
              next.cancelled += 1;
              if (forfeits) forfeits[forfeits.length - 1].quantity += 1;
              drift -= 1;
            }
          }
        }
        return remember(s, next);
      }
      if (s.kind === 'warrant') {
        const forfeits = scaleDated(cancellationHistory(s));
        const cancelled = forfeits.reduce((n, c) => n + c.quantity, 0);
        const exercised = warrantExercised(s, certificates);
        const unspent = Math.max(0, int(s.quantity) - int(s.cancelled) - warrantExercised(s, securities));
        const quantity = Math.max(1, exercised + cancelled + (unspent > 0 ? scaleQ(unspent) : 0));
        drift += int(s.quantity) * f - quantity;
        const next = { ...s, quantity, strike: scaleP(s.strike) };
        if (forfeits.length) {
          next.cancelled = cancelled; next.cancelledDate = forfeits[0].date;
          if (forfeits.length > 1) next.cancellations = forfeits;
        }
        return remember(s, next);
      }
      // Certificates are already restated; SAFEs and notes are dollar
      // amounts, which a split doesn't touch.
      return s;
    });
    /* And the mirror for a live award. Its certificates round to nearest,
       one by one, while what its schedule had vested on their dates floors,
       so 250 and 125 units settled exactly as they vested went 1-for-3 to 83
       and 42 certified against 124 vested on the second certificate's date:
       one share ahead on an award nobody had touched, in the state every
       later cancellation, departure and certification is refused for. A
       reverse split rounds fractions down with cash in lieu, so a
       certificate that ran ahead gives the share up - to the award as an
       option not yet exercised where the award has room, since its total
       rounded on its own, and to the drift where the award had nothing left.
       Only for an award that was behind its vesting before the split; one
       imported ahead stays as it was, tolerated as everywhere else. */
    const beforeById = new Map(securities.map((s) => [s.id, s]));
    const written = (before, next) => (!id || next.preSplit?.some((e) => e.id === id)
      ? next
      : { ...next, preSplit: [...Store.sanitizeSplitHistory(before.preSplit), { id, quantity: int(before.quantity) }] });
    for (let i = 0; i < out.length; i += 1) {
      const award = out[i];
      if ((award.kind !== 'option' && award.kind !== 'rsu') || vestingStopDate(award) || award.earlyExercise) continue;
      const was = beforeById.get(award.id);
      if (!was || exerciseAheadOfVesting(was, securities)) continue;
      const units = award.kind === 'rsu';
      const counter = units ? 'settled' : 'exercised';
      const certs = out
        .map((c, at) => ({ c, at }))
        .filter(({ c }) => c.kind === 'shares' && (units ? c.fromRsuId : c.fromOptionId) === award.id && !c.fromTransferId && c.date)
        .sort((a, b) => a.c.date.localeCompare(b.c.date) || (Number(a.c.createdAt) || 0) - (Number(b.c.createdAt) || 0));
      let cumulative = 0;
      let trimmed = 0;
      for (const { c, at } of certs) {
        cumulative += int(c.quantity);
        const vested = units ? rsuVested(award, c.date) : grantVested(award, c.date);
        const over = cumulative - vested;
        if (over <= 0 || int(c.quantity) - over < 1) continue;
        out[at] = written(beforeById.get(c.id), { ...c, quantity: int(c.quantity) - over });
        cumulative -= over;
        trimmed += over;
      }
      if (!trimmed) continue;
      const next = { ...award, [counter]: Math.max(0, int(award[counter]) - trimmed) };
      const left = units ? rsuOutstanding(was) - rsuSettled(was) : grantOutstanding(was) - grantExercised(was);
      if (left <= 0) {
        next.quantity = Math.max(1, int(award.quantity) - trimmed);
        if (next.vestingTranches) next.vestingTranches = scaleSchedule(was.vestingTranches, int(was.quantity), next.quantity);
        drift += trimmed;
      }
      out[i] = written(was, next);
    }
    return { securities: out, drift };
  }

  /**
   * Record a stock split: N new shares for D old, effective a date. Every
   * per-share-denominated number moves together in one commit - security
   * quantities, strikes and prices, class authorized counts and prices, the
   * option pool, and recorded 409A valuations - and the split is stored as
   * a dated event so `dbAsOf` can render pre-split dates in pre-split units.
   *
   * Returns { drift }: the whole-share rounding drift a reverse split
   * produced (0 for clean forward splits), for the caller to report.
   */
  async recordSplit({ num, den, date }) {
    const n = int(num);
    const d = int(den);
    if (n <= 0 || d <= 0) throw refusal('Enter a valid split ratio.');
    if (n === d) throw refusal('A 1-for-1 split changes nothing.');
    const when = str(date).slice(0, 10);
    if (!when) throw refusal('Pick an effective date.');
    /* A day that exists, as every other dated write is held to: a split dated
       "garbage" sorted after every real date, so unsplitFactor read today as
       before it and every snapshot, today's included, showed a table a split
       factor away from the register. */
    if (!isISODate(when)) throw refusal('Pick a valid effective date.');
    // A split restates every quantity, strike and price in the company, so
    // the way back is a snapshot rather than an undo closure.
    return this.#guarded(`Before the ${n}-for-${d} split`,
      (commit) => commit(['company', 'classes', 'securities', 'hiring'], () => {
      const f = n / d;
      // Minted here so the records this split rounds can name it.
      const splitId = uid();
      const { securities, drift } = Store.applySplit(this.securities, { num: n, den: d, id: splitId });
      this.securities = Store.sanitizeSecurities(securities, this);
      /* A planned grant sized in shares is a share count like any other, and
         the pool it is drawn against is being restated - left in old units
         the plan covered a tenth of what it did, and the shortfall it hands
         the round model shrank to match. A percentage row needs nothing. */
      this.hiring = Store.sanitizeHiring(this.hiring.map((h) => (h.sizeMode === 'shares' && h.shares > 0
        ? { ...h, shares: Math.max(1, Math.round(h.shares * f)) }
        : h)));
      this.classes = Store.sanitizeClasses(this.classes.map((c) => ({
        ...c,
        authorized: c.authorized > 0 ? Math.max(1, Math.round(c.authorized * f)) : c.authorized,
        pricePerShare: c.pricePerShare > 0 ? tidy(c.pricePerShare / f) : c.pricePerShare,
        /* A conversion price a past down round already lowered is per-share
           money like any other, so it moves with the issue price it is
           measured against. Left behind, it reads as a price above what the
           class paid - which is the unadjusted state - and the protection it
           records stops triggering on the next down round. */
        conversionPrice: c.conversionPrice > 0 ? tidy(c.conversionPrice / f) : c.conversionPrice,
      })));
      /* Each plan's reserve rounds like any holding, and like a holding it
         is written down where it did - in the plan's own history, so the
         as-of walk reads the figure rather than dividing back: a 1,500,000
         pool that went 1-for-7 to 214,286 read 1,500,002 on every date
         before the split - in the pool row, the fully diluted total, and
         every percentage under it. */
      /* Numbered after every split and pool resize already on file, whatever
         their dates: the records were restated by those first and by this one
         last, and that is the order the as-of view has to unwind them in. */
      const seq = Store.nextPoolSeq(this.company);
      const poolBefore = this.company.poolAuthorized;
      const plans = this.company.plans.map((plan) => {
        const before = planReserve(plan);
        if (before === 0) return plan;
        const after = scalePlanReserve(before, f);
        return {
          ...plan, reserve: after,
          reserveHistory: [...(plan.reserveHistory || []), { date: when, before, after, seq, kind: 'split', splitId }],
        };
      });
      const poolAfter = plans.length
        ? plans.reduce((a, plan) => a + planReserve(plan), 0)
        : (poolBefore > 0 ? Math.max(1, Math.round(poolBefore * f)) : poolBefore);
      const split = { id: splitId, date: when, num: n, den: d, seq };
      if (poolBefore > 0 && poolAfter * d !== poolBefore * n) {
        split.poolBefore = poolBefore;
        split.poolAfter = poolAfter;
      }
      this.company = Store.sanitizeCompany({
        ...this.company,
        plans,
        poolAuthorized: poolAfter,
        valuations: this.company.valuations.map((v) => ({ ...v, fmvPerShare: tidy(v.fmvPerShare / f) })),
        splits: [...this.company.splits, split],
      });
      // Every quantity is now in new units; an undo captured before the
      // split would re-insert a certificate in old ones.
      this.#dataEpoch += 1;
      return { drift };
    }, ['company', 'classes', 'securities', 'hiring']), () => {
      if (this.company.splits.length >= MAX_STOCK_SPLITS) {
        throw new ListFullError(`This company already holds ${MAX_STOCK_SPLITS} stock splits, the most it can keep. No split was applied.`);
      }
    }, { operation: 'recordSplit' });
  }

  /**
   * Transfer shares off a certificate - to another holder, a brand-new one,
   * or back to the company (a repurchase, which retires them).
   *
   * The original certificate is closed as of the date and successors are
   * issued in the same commit: one to the buyer (unless the company took the
   * shares), and one to the seller for whatever they kept. Successors inherit
   * the class, the original price per share (a liquidation preference and the
   * capital it returns belong to the shares, not to what a later buyer paid),
   * and the exercise/conversion provenance, so grant accounting stays intact.
   * The consideration is recorded on the buyer's leg as
   * `transferPricePerShare` - a record, not company money.
   *
   * `to`: { stakeholderId } | { newHolder: { name, kind } } | 'company'.
   */
  async transferShares(certId, { date, quantity, pricePerShare = 0, to }) {
    const label = this.security(certId)?.label;
    /* Named for what it is: the restore points sheet and its confirm read
       "Before transferring CS-6" for a repurchase, while every refusal that
       pointed the user at this very point called it the repurchase. */
    const verb = to === 'company' ? 'repurchasing' : 'transferring';
    return this.#guarded(label ? `Before ${verb} ${label}` : `Before a share ${to === 'company' ? 'repurchase' : 'transfer'}`,
      (commit) => commit(['stakeholders', 'securities'], () => {
      const cert = this.security(certId);
      if (!cert || cert.kind !== 'shares') throw new Error('That certificate is gone.');
      if (cert.closedAt) throw new Error('This certificate was already transferred.');
      const qty = wholeCount(quantity, 'Enter how many shares transfer.');
      if (qty > cert.quantity) {
        throw new Error(`${cert.label} only holds ${cert.quantity} shares.`);
      }
      const when = str(date).slice(0, 10);
      if (!when) throw new Error('Pick a transfer date.');
      if (!isISODate(when)) throw new Error('Pick a valid transfer date.');
      if (cert.date && when < cert.date) {
        throw new Error('The transfer can’t precede the certificate it moves.');
      }

      const repurchase = to === 'company';
      /* The successors this issues - a buyer's certificate, a remainder - and
         a holder it may create count against the company's ceilings like
         every other record does. */
      const successors = (repurchase ? 0 : 1) + (cert.quantity - qty > 0 ? 1 : 0);
      const room = roomFor('securities', this.securities.length, successors, MAX_SECURITIES)
        || (!repurchase && to?.newHolder ? roomFor('stakeholders', this.stakeholders.length, 1, MAX_STAKEHOLDERS) : null);
      if (room) throw new ListFullError(room);
      let buyerId = null;
      if (!repurchase) {
        if (to?.newHolder) {
          const holder = Store.sanitizeStakeholders([{ ...to.newHolder, id: uid(), createdAt: Date.now() }])[0];
          if (!holder) throw new Error('The receiving party needs a name.');
          this.stakeholders = [...this.stakeholders, holder];
          buyerId = holder.id;
        } else {
          buyerId = to?.stakeholderId;
          if (!this.stakeholder(buyerId)) throw new Error('Pick who receives the shares.');
        }
        if (buyerId === cert.stakeholderId) {
          throw new Error('The shares already belong to this holder.');
        }
      }

      this.securities = this.securities.map((s) => (s.id === certId
        ? Store.sanitizeSecurities([{
          ...s, id: s.id, kind: s.kind, label: s.label,
          closedAt: when, closedReason: repurchase ? 'repurchase' : 'transfer',
          /* The repurchase's own terms: there is no buyer certificate to
             carry them, so they are recorded against the certificate the
             shares came off. */
          ...(repurchase
            ? { repurchasedQty: qty, repurchasePricePerShare: Math.max(0, num(pricePerShare)) }
            : {}),
        }], this)[0] || s
        : s));

      const issue = (input) => {
        const sec = Store.sanitizeSecurities([{
          ...input, ...transferredEconomics(cert, input.quantity), kind: 'shares', classId: cert.classId, date: when,
          fromTransferId: cert.id,
          id: uid(), label: nextLabel(this.db, 'shares', cert.classId), createdAt: Date.now(),
        }], this)[0];
        if (!sec) throw new Error('Could not issue the successor certificate.');
        this.securities = [...this.securities, sec];
        return sec;
      };

      // Exercise/conversion provenance rides along so grant and convertible
      // accounting keeps netting against the successor shares.
      const provenance = {};
      if (cert.fromOptionId) provenance.fromOptionId = cert.fromOptionId;
      if (cert.fromRsuId) provenance.fromRsuId = cert.fromRsuId;
      if (cert.fromWarrantId) provenance.fromWarrantId = cert.fromWarrantId;
      if (cert.fromConvertibleId) provenance.fromConvertibleId = cert.fromConvertibleId;
      /* Adjustment shares stay adjustment shares in whoever's hands. The next
         down round sorts a protected class into what was bought and what was
         minted, and a successor that lost the flag read as bought - so a
         secondary sale of these shares grew the class's next adjustment. */
      if (cert.antiDilution) provenance.antiDilution = true;

      let buyerCert = null;
      if (!repurchase) {
        buyerCert = issue({
          ...provenance,
          stakeholderId: buyerId,
          quantity: qty,
          pricePerShare: cert.pricePerShare,
          transferPricePerShare: Math.max(0, num(pricePerShare)),
        });
      }

      let remainderCert = null;
      const kept = cert.quantity - qty;
      if (kept > 0) {
        /* What the seller kept. A sale keeps the schedule (and the 83(b)
           record) running on what stayed behind.
           A repurchase takes the unvested balance, so the remainder reads
           fully vested - but only when it actually took all of it. Buying
           back fewer shares than are unvested leaves the holder still
           earning what is left, and dropping the schedule marked every one
           of those shares vested: a 100-share buyback out of 1,000 with 750
           unvested reported 900 shares with nothing left to earn, and the
           83(b) election on the record went with it. */
        const unvested = Math.max(0, int(cert.quantity) - vestedQuantity(cert, when));
        const keepSchedule = !repurchase || qty < unvested;
        const schedule = {};
        /* Which end of the schedule the shares came off.

           A repurchase takes them out of the unvested tail - that is what the
           repurchase right covers - so what the holder has already earned is
           untouched and the remainder keeps the whole schedule, measured
           against the position it was written for. Scaled down instead, a
           100-share buyback out of a 1,000-share certificate with 250 vested
           reported 225 vested and 675 unvested afterwards: buying back
           unvested shares had un-vested 25 the holder already owned.

           A sale is the opposite. The buyer takes a pro-rata slice of both
           halves - which is exactly what the transfer form says it does - so
           the schedule scales down with the position. */
        const wholePosition = Math.max(int(cert.vestingBase), int(cert.quantity));
        if (keepSchedule && cert.vestingTranches) {
          schedule.vestingTranches = repurchase
            ? cert.vestingTranches.map((t) => ({ ...t }))
            : Store.scaleTranches(cert.vestingTranches, kept, int(cert.quantity));
        }
        if (keepSchedule && cert.vestingMonths > 0) {
          schedule.vestingMonths = cert.vestingMonths;
          schedule.cliffMonths = cert.cliffMonths;
          schedule.vestingStart = cert.vestingStart;
          if (cert.vestingFrequency) schedule.vestingFrequency = cert.vestingFrequency;
          schedule.vestingBase = repurchase
            ? wholePosition
            : Math.round((wholePosition * kept) / int(cert.quantity));
          if (cert.vestingOffset > 0) schedule.vestingOffset = repurchase
            ? cert.vestingOffset
            : Math.round((cert.vestingOffset * kept) / int(cert.quantity));
        }
        if (keepSchedule && cert.filed83b) schedule.filed83b = cert.filed83b;
        /* An acknowledgement that no election was filed is about the original
           purchase, and that purchase is what the remainder continues.
           Dropped, the window reopened on shares the holder had already
           answered for and the item came back into Needs attention. */
        if (keepSchedule && cert.missed83b) schedule.missed83b = true;
        /* Acceleration is a term of the award, not of the position's size: a
           sale of part of it is not an amendment striking the provision from
           what stayed behind. */
        if (keepSchedule && cert.accelTrigger) {
          schedule.accelTrigger = cert.accelTrigger;
          schedule.accelPct = cert.accelPct;
        }
        /* The remainder is the same purchase continuing, so its 83(b) clock
           anchors to the original acquisition date. Without this, a partial
           sale would mint a fresh 30-day window years after the real one
           closed - prompting a filing that is legally too late. */
        if (keepSchedule && (cert.vestingMonths > 0 || cert.vestingTranches)) {
          schedule.date83b = cert.date83b || cert.date;
        }
        remainderCert = issue({
          ...provenance,
          ...schedule,
          stakeholderId: cert.stakeholderId,
          quantity: kept,
          pricePerShare: cert.pricePerShare,
        });
      }

      return { buyerCert, remainderCert, buyerId, repurchase };
    }, ['stakeholders', 'securities']), null, { operation: to === 'company' ? 'repurchaseShares' : 'transferShares' });
  }

  /**
   * Mark a stakeholder as departed: stamp the date on their record and, per
   * option grant, cancel the unvested balance back to the pool and set the
   * post-termination exercise deadline on what stays exercisable - one
   * commit, so a failed write leaves no half-departed holder.
   *
   * `grants`: [{ id, cancelQty, exerciseBy }]. An empty exerciseBy clears
   * any stored deadline (nothing vested survived).
   */
  async markDeparted(stakeholderId, { date, grants = [] }) {
    const name = this.stakeholder(stakeholderId)?.name;
    return this.#guarded(name ? `Before ${name} departed` : 'Before a departure',
      (commit) => commit(['stakeholders', 'securities'], () => {
      const holder = this.stakeholder(stakeholderId);
      if (!holder) throw new Error('That stakeholder is gone.');
      const when = str(date).slice(0, 10);
      if (!when) throw new Error('Pick a termination date.');
      if (!isISODate(when)) throw new Error('Pick a valid termination date.');
      this.stakeholders = this.stakeholders.map((h) => (h.id === stakeholderId
        ? Store.sanitizeStakeholders([{ ...h, departed: when }])[0] || h
        : h));
      for (const g of grants) {
        const grant = this.security(g.id);
        if (!grant || grant.kind !== 'option' || grant.stakeholderId !== stakeholderId) continue;
        /* Nothing happens to a grant before it exists - the same rule the
           cancel form and exerciseOption apply to their own dates. A
           termination dated before the grant measured its vesting on a day
           the option did not exist, read the whole of it as unvested, and
           wrote a forfeiture dated before the grant it forfeits. */
        const granted = grant.grantDate || grant.date;
        if (granted && granted > when) {
          throw new Error(`${grant.label} was granted on ${granted}, after this termination date.`);
        }
        const deadline = str(g.exerciseBy || '').slice(0, 10);
        if (deadline && !isISODate(deadline)) throw new Error('Pick a valid exercise deadline.');
        if (deadline && deadline < when) {
          throw new Error(`${grant.label}’s exercise deadline can’t precede the termination date.`);
        }
        const cancelQty = int(g.cancelQty);
        // Same invariant the cancel form enforces: exercised options were
        // bought and can never be cancelled back.
        if (cancelQty > grantOutstanding(grant) - grantExercised(grant)) {
          throw new Error(`${grant.label} doesn’t have ${cancelQty} option${cancelQty === 1 ? '' : 's'} left to cancel.`);
        }
        const patch = { ...grant, exerciseBy: deadline, vestingStoppedAt: when };
        if (cancelQty > 0) {
          patch.cancellations = [...cancellationHistory(grant), { quantity: cancelQty, date: when }];
        }
        const next = Store.sanitizeSecurities([{ ...patch, id: grant.id, kind: grant.kind, label: grant.label }], this)[0] || grant;
        /* A departure recorded after the fact must not close the window on
           an exercise that already happened inside it, nor freeze vesting
           below what was exercised. */
        this.#assertExercisesInsideWindow(next);
        this.#assertClaimedWithinVesting(grant, next);
        this.securities = this.securities.map((s) => (s.id === grant.id ? next : s));
      }
    }, ['stakeholders', 'securities']), null, { operation: 'markDeparted' });
  }

  /**
   * Cancel the unexercised balance of several lapsed grants in one commit -
   * the shape a lapse usually has: one termination, several grants, the same
   * day. Each grant is cancelled as of its own expiry, which is the day its
   * options actually stopped being exercisable.
   *
   * Grants that are gone, already cancelled, or fully exercised are skipped
   * rather than failing the batch: the list was built from a render that may
   * be a moment stale.
   */
  async cancelLapsedGrants(ids = []) {
    const wanted = ids.map((id) => str(id)).filter(Boolean);
    if (!wanted.length) return { cancelled: 0, quantity: 0 };
    return this.#guarded('Before cancelling lapsed grants',
      (commit) => commit(['securities'], () => {
        let cancelledCount = 0;
        let quantity = 0;
        for (const id of wanted) {
          const grant = this.security(id);
          if (!grant || grant.kind !== 'option') continue;
          const left = grantOutstanding(grant) - grantExercised(grant);
          if (left <= 0) continue;
          /* Only a grant whose window has closed has lapsed. One with no
             expiration and no post-termination deadline dated its forfeiture
             at the grant date, which froze its vesting on day one and read
             every option it held as never earned. */
          const when = exerciseCutoff(grant);
          if (!when) throw new Error(`${grant.label} has no expiration or exercise deadline, so it has not lapsed.`);
          const next = Store.sanitizeSecurities([{
            ...grant,
            cancellations: [...cancellationHistory(grant), { quantity: left, date: when }],
            id: grant.id, kind: grant.kind, label: grant.label,
          }], this)[0] || grant;
          /* The lapse freezes vesting on the day the window closed, and on a
             grant without early exercise nothing can have been exercised past
             what had vested by then - the rule the cancel sheet, the departure
             flow and every edit of the grant are held to. This path alone
             wrote past it: a grant whose schedule was lengthened after an
             exercise (allowed, since the final ceiling still covered it)
             lapsed into a record saying the holder had bought more than they
             would ever earn, and the expense report reversed the cost of
             options that had been paid for - while the row's own Cancel
             button refused the very same cancellation. Refused rather than
             skipped: the batch is one event, and the message names the grant
             whose records need correcting first. */
          this.#assertClaimedWithinVesting(grant, next);
          this.securities = this.securities.map((s) => (s.id === id ? next : s));
          cancelledCount += 1;
          quantity += left;
        }
        if (!cancelledCount) throw new Error('Those grants have already been dealt with.');
        return { cancelled: cancelledCount, quantity };
      }, ['securities']), null, { operation: 'cancelLapsedGrants' });
  }

  /* ---------- Closing a round ---------- */

  /**
   * Apply a modeled round to the cap table in a single commit: any new
   * stakeholders and share class, one certificate per investor and per
   * converting instrument, the instruments marked converted, any anti-dilution
   * adjustment the round triggered, and the resized pool all land together -
   * or, if the write fails, none of them do.
   *
   * Converting an instrument that is already converted is skipped rather than
   * duplicated, so re-running a close cannot convert the same SAFE twice, and
   * one that did not exist on the closing date is refused outright.
   */
  async closeRound({
    newClass = null, classId = null, date, investors = [], conversions = [],
    adjustments = [], poolAuthorized = null, topUp = null, modeling = null,
  }) {
    /* Same rule as transferShares and markDeparted: the date is load-bearing.
       A falsy one would issue undated certificates and stamp a falsy
       convertedAt that the next load's sanitizer drops - the SAFE would read
       as a live convertible again beside its own conversion certificate, and
       a re-run would mint a second one. */
    const when = str(date).slice(0, 10);
    if (!when) throw new Error('Pick a closing date.');
    /* Certificates issued, convertibles flipped to converted, the pool
       resized - all in one commit, and none of it undoable record by record.
       The snapshot goes first. */
    /* Everything a close is held to before a record is touched, run twice:
       once as the pre-snapshot check (a refused close then takes no restore
       point - every refused modeled close used to capture one and roll it
       back in a second write, and when that write failed the point stayed
       and the oldest real one was gone for good) and once more inside the
       commit, against the very table it writes. */
    const checks = () => {
    /* A close that applies a modeled scenario is held to its model: the
       table being written is the one the scenario was modeled on, this
       financing has not closed before, and every figure the review
       confirmed - checks, shares, conversions, adjustments, the top-up -
       is what the model says for this table on the closing date. The
       sheet re-models when its date moves, so `inputs.asOf` is the close. */
    /* The model rewinds splits; stored certificates use today's split
       units. Writing the historical quantities directly would change
       ownership. Historical modeling remains available, but this close
       cannot replay later splits and their rounding on new certificates.
       Every close, not only one held to a dated financing: the base
       model reads the table as of its date too (see modelRound), so a
       round modeled and closed as of a day before a 2-for-1 split wrote
       the investor half the shares its money bought, at twice the price,
       into a table already restated by the split. */
    if (this.company.splits.some((split) => split.date > when)) {
      throw new FinancingError('Closing before a recorded stock split is unsupported. Model and close on or after the split, or restore the table before it.');
    }
    /* The same shape for a down round already on the books: its minted
       shares drop out of the day's snapshot, but the conversion price it
       lowered has no history to rewind (see adjustedAfter), so a round
       priced on that day measured protection from a price not yet in
       force - one such close minted a class's adjustment twice over. */
    const adjusted = adjustedAfter(this.db, when);
    if (adjusted) {
      throw new FinancingError(`Closing before the anti-dilution adjustment of ${adjusted.date} is unsupported. Model and close on or after the round that adjusted ${adjusted.cls?.name || 'the class'}, or restore the table before it.`);
    }
    let modeled = null;
    if (modeling) {
      if (!modeling.id) throw new FinancingError('This financing has no ID.');
      if (this.securities.some((sec) => sec.roundId === modeling.id)) throw new FinancingError('This financing has already been closed.');
      if (modeling.basisDigest !== capTableDigest(this.db)) throw new FinancingError('The cap table changed. Explicitly refresh the scenario before closing.');
      if (modeling.inputs?.asOf !== when) throw new FinancingError('The scenario was modeled as of a different date than the close.');
      modeled = modelRound(this.db, modeling.inputs);
      if (!modeled?.pps || modeled.unsupported) throw new FinancingError(modeled?.unsupported || 'This scenario cannot be priced.');
      if (modeled.financing && modeled.financing.id !== modeling.id) {
        throw new FinancingError('The closing financing ID must match the modeled financing ID and its elections.');
      }
      const total = modeled.financing?.investment ?? (Number(modeling.inputs.investment) || 0);
      const same = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
      const checksReconcile = investors.every((i) => Number.isFinite(i.amount) && i.amount >= 0
        && Math.round(i.amount / modeled.pps) === i.quantity && same(i.pricePerShare, modeled.pps))
        && Math.abs(investors.reduce((a, i) => a + i.amount, 0) - total) <= ALLOCATION_TOLERANCE;
      if (!checksReconcile) throw new FinancingError('Confirmed checks and share allocations do not reconcile to the model.');
      for (const a of modeled.financing?.allocations || []) {
        if (!a.elected) continue;
        const confirmed = investors.filter((i) => i.rightIds?.includes(a.rightId));
        if (confirmed.length !== 1 || confirmed[0].rightIds.length !== 1
          || confirmed[0].newHolder
          || confirmed[0].quantity !== a.shares
          || confirmed[0].stakeholderId !== a.stakeholderId || Math.abs(confirmed[0].amount - a.elected) > ALLOCATION_TOLERANCE) {
          throw new FinancingError('A confirmed pro-rata allocation is missing or changed. Refresh the scenario to change elections.');
        }
      }
      const sameAdjustment = (x, e) => x.classId === e.classId && same(num(x.conversionPrice), e.conversionPriceAfter)
        && (x.holders || []).length === e.holders.length
        && e.holders.every((h) => (x.holders || []).some((y) => y.stakeholderId === h.stakeholderId && int(y.quantity) === h.quantity));
      if (adjustments.length !== modeled.antiDilution.length || modeled.antiDilution.some((e) => !adjustments.some((x) => sameAdjustment(x, e)))) {
        throw new FinancingError('Anti-dilution allocations differ from the model.');
      }
      if (modeled.poolAdd > 0 && (!topUp || topUp.reserve !== topUpReserve(this.db, topUp.planId, modeled.poolAfter))) {
        throw new FinancingError('The pool top-up differs from the model.');
      }
      if (modeled.poolAdd <= 0 && (topUp || poolAuthorized !== null)) throw new FinancingError('This model does not call for a pool top-up.');
      const converting = modeled.conversions.filter((c) => c.shares > 0);
      // A historical snapshot can reopen a SAFE converted by a later
      // recorded round. The live close cannot skip that certificate or
      // convert the same instrument twice and still match this model.
      if (converting.some((c) => this.security(c.securityId)?.convertedAt)) {
        throw new FinancingError('A modeled instrument is already converted in a recorded round. Restore that round before recording an earlier conversion.');
      }
      const sameConversion = (x, c) => x.securityId === c.securityId && x.quantity === c.shares && same(x.pricePerShare, c.price);
      if (conversions.length !== converting.length || converting.some((c) => !conversions.some((x) => sameConversion(x, c)))) {
        throw new FinancingError('Conversion allocations differ from the dated model.');
      }
    }
      return modeled;
    };
    return this.#guarded('Before closing a round', (commit) => commit(
      ['company', 'classes', 'stakeholders', 'securities'],
      () => {
        const modeled = checks();
        /* What a certificate of a modeled close carries: the financing it
           belongs to, the assumptions it was priced under, and - on a new
           money certificate - the pro-rata rights it satisfies, or - on a
           conversion certificate - the MFN election applied to its source. */
        const evidence = (extra) => (modeling ? {
          roundId: modeling.id,
          financingEvidence: {
            asOf: when,
            preMoney: Number(modeling.inputs.preMoney) || 0,
            investment: modeled.financing?.investment ?? (Number(modeling.inputs.investment) || 0),
            poolPct: Number(modeling.inputs.poolPct) || 0,
            roundMode: modeled.financing?.roundMode || 'fixed',
            ...extra,
          },
        } : {});
        const cls = newClass
          ? Store.sanitizeClasses([{ ...newClass, id: uid(), createdAt: Date.now() }])[0]
          : this.shareClass(classId);
        if (!cls) throw new Error('Pick a share class for the round.');
        if (newClass) this.classes = [...this.classes, cls];

        // Labels number off the securities already committed in this apply,
        // so a round issuing five certificates gets five distinct labels.
        const issue = (input) => {
          const sec = Store.sanitizeSecurities([{
            ...input, kind: 'shares', classId: cls.id, date: when,
            id: uid(), label: nextLabel(this.db, 'shares', cls.id), createdAt: Date.now(),
          }], this)[0];
          if (!sec) throw new Error('Could not issue a certificate for this round.');
          this.securities = [...this.securities, sec];
          return sec;
        };

        const issued = [];
        for (const inv of investors) {
          let stakeholderId = inv.stakeholderId;
          if (inv.newHolder) {
            const holder = Store.sanitizeStakeholders([{ ...inv.newHolder, id: uid(), createdAt: Date.now() }])[0];
            if (!holder) throw new Error('An investor is missing a name.');
            this.stakeholders = [...this.stakeholders, holder];
            stakeholderId = holder.id;
          }
          issued.push(issue({
            stakeholderId, quantity: inv.quantity, pricePerShare: inv.pricePerShare,
            ...(inv.amount !== undefined ? { cashInvested: inv.amount } : {}),
            ...evidence({ rightIds: inv.rightIds || [] }),
          }));
        }

        for (const c of conversions) {
          const source = this.security(c.securityId);
          if (!source || !(c.quantity > 0)) continue;
          /* An instrument a recorded round has already converted. Converted
             on or before this closing date, that round is this one run again
             or an earlier one: the shares exist, and nothing is written
             twice. Converted after it, it is a later round's, and this close
             cannot be the round it converts into. A model dated before that
             round reads the instrument as live again - the base model reads
             the table as of its date (see modelRound) - and prices the new
             money over the shares it would convert into; written past it,
             the investor took the shares a conversion that never happened
             had paid for, while the review had listed the conversion. The
             dated close refuses the same. */
          if (source.convertedAt) {
            if (source.convertedAt > when) {
              throw new Error(`${source.label} converted on ${source.convertedAt}, after this closing date, so this round `
                + 'cannot be the one it converts into. Model and close on or after that round, or restore the table before it.');
            }
            continue;
          }
          /* A SAFE converts into the round that priced it, so a round that
             closed before the SAFE was signed cannot be that round. Refused
             rather than skipped: the review named this instrument as
             converting, and a close that quietly leaves one live is a
             different round than the one confirmed. */
          if (source.date && source.date > when) {
            throw new Error(`${source.label} was issued on ${source.date}, after this closing date.`);
          }
          const cert = issue({
            stakeholderId: source.stakeholderId,
            quantity: c.quantity,
            pricePerShare: c.pricePerShare,
            fromConvertibleId: source.id,
            ...(modeling ? {
              cashInvested: modeled.conversions.find((x) => x.securityId === source.id)?.value ?? source.principal,
              ...evidence({ appliedMFN: (modeled.financing?.appliedMFN || []).filter((e) => e.securityId === source.id) }),
            } : {}),
          });
          this.securities = this.securities.map((s) => (s.id === source.id
            ? { ...s, convertedAt: when, convertedToId: cert.id }
            : s));
          issued.push(cert);
        }

        /* Anti-dilution: a protected class's conversion price falls, which
           mints shares for the holders who already own it. The certificates
           carry no price - nothing was paid for them - so the class's
           liquidation preference is untouched while its as-converted count
           rises. The new conversion price is written on the class, because
           the next round's weighted average measures from it. */
        for (const adjustment of adjustments) {
          const target = this.shareClass(adjustment.classId);
          if (!target || !(num(adjustment.conversionPrice) > 0)) continue;
          for (const holder of adjustment.holders || []) {
            if (!(int(holder.quantity) > 0) || !this.stakeholder(holder.stakeholderId)) continue;
            const sec = Store.sanitizeSecurities([{
              kind: 'shares', stakeholderId: holder.stakeholderId, classId: target.id,
              quantity: int(holder.quantity), pricePerShare: 0, date: when,
              antiDilution: true,
              ...(modeling ? { cashInvested: 0, ...evidence({ antiDilution: true }) } : {}),
              id: uid(), label: nextLabel(this.db, 'shares', target.id), createdAt: Date.now(),
            }], this)[0];
            if (!sec) throw new Error('Could not issue an anti-dilution certificate.');
            this.securities = [...this.securities, sec];
            issued.push(sec);
          }
          this.classes = this.classes.map((c) => (c.id === target.id
            ? Store.sanitizeClasses([{ ...c, conversionPrice: num(adjustment.conversionPrice) }])[0] || c
            : c));
        }

        /* The top-up is dated the close, so the table before it reads the old
           pool. It lands in the one plan the close names (`topUp: { planId,
           reserve }`, the plan's new reserve); `poolAuthorized` is the older
           spelling, which resizes a company's one plan. */
        if (topUp) {
          const plan = this.plan(topUp.planId);
          if (!plan) throw new Error('Pick the plan the pool top-up goes into.');
          if (!planIsOpen(plan)) throw new Error(`${plan.name} has been retired, so the round can’t top it up.`);
          // Every dated reserve change is held to the plan's adoption - see resizePlanReserve.
          if (plan.adopted && when < plan.adopted) {
            throw new Error(`${plan.name} was adopted on ${plan.adopted}, after this closing date, so it can’t take the top-up.`);
          }
          /* And not past its expiry, as transferReserve refuses: the plan takes
             no award dated after that day (see planAccepts), so shares topped
             up into it could never be granted while the unallocated count and
             every dilution figure went on counting them as if they could. */
          if (plan.expires && when > plan.expires) {
            throw new Error(`${plan.name} expired on ${plan.expires}, so the round can’t top it up on ${when}. Adopt a plan under Share classes first, or model the round with no top-up.`);
          }
          const reserve = num(topUp.reserve, NaN);
          if (!Number.isInteger(reserve)) throw new Error('Enter the top-up reserve in whole shares.');
          if (reserve < planReserve(plan)) throw new Error('A top-up can’t make the plan’s reserve smaller. Resize the plan separately.');
          this.company = Store.planResized(this.company, plan.id, reserve, when, { kind: 'top-up', reason: 'Round closed' });
        } else if (poolAuthorized !== null) {
          this.company = Store.poolResized(this.company, poolAuthorized, when, { kind: 'top-up', reason: 'Round closed' });
        }
        return { classId: cls.id, certificates: issued };
      },
      ['company', 'classes', 'stakeholders', 'securities']), () => {
        if (investors.some((inv) => !Number.isInteger(Number(inv.quantity)) || !(inv.quantity > 0))) {
          throw refusal('Every investor must receive at least one whole share. Adjust the allocations before closing.');
        }
        /* The record ceilings every other issuing path holds to - see roomFor.
           A close writes a certificate per investor, per conversion and per
           adjusted holder, and a holder per new investor; it was the one path
           that could carry a company past the ceiling, after which its own
           backup could no longer be re-imported. */
        const certificates = investors.length + conversions.length
          + adjustments.reduce((a, x) => a + (x.holders || []).length, 0);
        const full = roomFor('securities', this.securities.length, certificates, MAX_SECURITIES)
          || roomFor('stakeholders', this.stakeholders.length, investors.filter((inv) => inv.newHolder).length, MAX_STAKEHOLDERS);
        if (full) throw new ListFullError(full);
        checks();
      }, { operation: 'closeRound' });
  }

  /* ---------- Round scenarios ---------- */

  /* The dated assumptions a saved scenario carries (see validateFinancing),
     and the digest of the cap table it was modeled on - see capTableDigest -
     so a load can say the table has moved since and a close can refuse to
     apply it until the scenario is explicitly refreshed. A scenario written
     before these existed carries neither and reads as it always did. */
  static #scenarioTerms(s) {
    return {
      ...(s.asOf !== undefined ? { asOf: termDate(s.asOf, 'Model date') } : {}),
      ...(s.financing !== undefined ? { financing: validateFinancing(s.financing) } : {}),
      ...(typeof s.basisDigest === 'string' && s.basisDigest ? { basisDigest: s.basisDigest.slice(0, 40) } : {}),
    };
  }

  static sanitizeScenarios(raw) {
    const idOf = uniqueIds();
    return (Array.isArray(raw) ? raw : [])
      .filter((s) => s && typeof s === 'object')
      .map((s) => ({
        id: idOf(s.id),
        name: str(s.name).slice(0, 80) || 'Untitled round',
        preMoney: Math.max(0, num(s.preMoney)),
        investment: Math.max(0, num(s.investment)),
        poolPct: Math.min(0.9, Math.max(0, num(s.poolPct))),
        ...Store.#scenarioTerms(s),
        updatedAt: num(s.updatedAt, Date.now()),
      }));
  }

  async saveScenario(input) {
    return this.#commit('saveScenario', ['scenarios'], () => {
      // Saved against the table as it stands: saving is itself the refresh.
      const scenario = Store.sanitizeScenarios([{
        ...input, asOf: input.asOf || todayISO(), basisDigest: capTableDigest(this.db), id: input.id || uid(),
      }])[0];
      scenario.updatedAt = Date.now();
      const i = this.scenarios.findIndex((s) => s.id === scenario.id);
      // Revising one already on the strip is not an addition and stays allowed at the cap.
      if (i < 0 && this.scenarios.length >= SCENARIOS_MAX) {
        throw new ListFullError(`This company already holds ${SCENARIOS_MAX} saved scenarios, the most it can keep. Delete one before saving another.`);
      }
      this.scenarios = i >= 0
        ? this.scenarios.map((s, j) => (j === i ? scenario : s))
        : [...this.scenarios, scenario];
      return scenario;
    }, ['scenarios']);
  }

  /**
   * Returns { undo }, like the record deletes: the toast's Undo used to save
   * the scenario again as an ordinary save, which lands in whichever company
   * is loaded when it is pressed - a saved round deleted in one company and
   * undone after a switch turned up in the other, and gone from its own. The
   * undo is held to the dataset the scenario came from.
   */
  async deleteScenario(id) {
    let removed = null;
    await this.#commit('deleteScenario', ['scenarios'], () => {
      removed = this.scenarios.find((s) => s.id === id) || null;
      this.scenarios = this.scenarios.filter((s) => s.id !== id);
    }, ['scenarios']);
    const epoch = this.#dataEpoch;
    return {
      undo: () => this.#commit('undo.deleteScenario', ['scenarios'], () => {
        if (!removed || epoch !== this.#dataEpoch) throw new Error('The cap table has changed since the delete.');
        if (this.scenarios.some((s) => s.id === removed.id)) return;
        this.scenarios = [...this.scenarios, removed];
      }, ['scenarios']),
    };
  }

  /* ---------- Exit scenarios ---------- */

  /**
   * A saved exit is the whole model, not just its price. What happens to
   * unvested awards at close, and whether the deal is a change of control,
   * decide who is in the waterfall at all - a scenario saved with awards
   * cancelled and reloaded with them participating pays out a completely
   * different table at the same price. Scenarios saved before these were
   * recorded read back on the view's own defaults, which is what they were
   * modeled under.
   */
  static sanitizeExits(raw) {
    const idOf = uniqueIds();
    return (Array.isArray(raw) ? raw : [])
      .filter((s) => s && typeof s === 'object' && num(s.exitValue) > 0)
      .map((s) => ({
        id: idOf(s.id),
        name: str(s.name).slice(0, 80) || 'Untitled exit',
        exitValue: Math.max(0, num(s.exitValue)),
        unvestedOptions: s.unvestedOptions === 'cancel' ? 'cancel' : 'participate',
        changeOfControl: !!s.changeOfControl,
        ...Store.#scenarioTerms({ asOf: s.asOf, basisDigest: s.basisDigest }),
        updatedAt: num(s.updatedAt, Date.now()),
      }));
  }

  async saveExitScenario(input) {
    return this.#commit('saveExitScenario', ['exits'], () => {
      const scenario = Store.sanitizeExits([{
        ...input, asOf: input.asOf || todayISO(), basisDigest: capTableDigest(this.db), id: input.id || uid(), updatedAt: Date.now(),
      }])[0];
      if (!scenario) throw new Error('Enter an exit value first.');
      const i = this.exits.findIndex((s) => s.id === scenario.id);
      if (i < 0 && this.exits.length >= SCENARIOS_MAX) {
        throw new ListFullError(`This company already holds ${SCENARIOS_MAX} saved exits, the most it can keep. Delete one before saving another.`);
      }
      this.exits = i >= 0
        ? this.exits.map((s, j) => (j === i ? scenario : s))
        : [...this.exits, scenario];
      return scenario;
    }, ['exits']);
  }

  /** Returns { undo }, held to the dataset the scenario came from - see deleteScenario. */
  async deleteExitScenario(id) {
    let removed = null;
    await this.#commit('deleteExitScenario', ['exits'], () => {
      removed = this.exits.find((s) => s.id === id) || null;
      this.exits = this.exits.filter((s) => s.id !== id);
    }, ['exits']);
    const epoch = this.#dataEpoch;
    return {
      undo: () => this.#commit('undo.deleteExitScenario', ['exits'], () => {
        if (!removed || epoch !== this.#dataEpoch) throw new Error('The cap table has changed since the delete.');
        if (this.exits.some((s) => s.id === removed.id)) return;
        this.exits = [...this.exits, removed];
      }, ['exits']),
    };
  }

  /* ---------- Hiring plan ---------- */

  /**
   * Planned grants. A row is a role, how many of them, how big each grant is
   * (a share count, or a percentage of the fully diluted count), and the month
   * the hire is expected to start.
   *
   * A plan is a forecast, not a record: these never become securities on their
   * own, and nothing here counts anywhere on the cap table.
   */
  static sanitizeHiring(raw) {
    const idOf = uniqueIds();
    return (Array.isArray(raw) ? raw : [])
      .filter((h) => h && typeof h === 'object' && str(h.role))
      .map((h) => {
        const row = {
          id: idOf(h.id),
          role: str(h.role).slice(0, 80),
          headcount: Math.min(HIRING_HEADCOUNT_MAX, Math.max(1, int(h.headcount, 1) || 1)),
          /* 'YYYY-MM': the grant lands in the month the hire starts. A month
             the calendar has no such thing as ("2026-13" in a hand-edited
             backup) reads as unscheduled, the way an unreadable date reads as
             none elsewhere, rather than as a raw string in the Starts column
             that never matches a forecast month. */
          startMonth: /^\d{4}-(0[1-9]|1[0-2])$/.test(str(h.startMonth)) ? str(h.startMonth) : '',
          createdAt: num(h.createdAt, Date.now()),
        };
        // The plan the grants are expected to draw from; blank takes the default destination.
        if (rid(h.planId)) row.planId = rid(h.planId);
        /* One sizing or the other, never both: a row carrying a share count
           and a percentage would read differently depending on which the
           forecast happened to prefer. */
        const pct = Math.min(0.5, Math.max(0, num(h.pct)));
        if (h.sizeMode === 'pct' && pct > 0) {
          row.sizeMode = 'pct';
          row.pct = pct;
        } else {
          row.sizeMode = 'shares';
          row.shares = int(h.shares);
        }
        return row;
      })
      .filter((h) => (h.sizeMode === 'pct' ? h.pct > 0 : h.shares > 0))
      .sort((a, b) => (a.startMonth || '9999-99').localeCompare(b.startMonth || '9999-99')
        || a.role.localeCompare(b.role))
      .slice(0, HIRING_MAX);
  }

  async saveHire(input) {
    return this.#commit('saveHire', ['hiring'], () => {
      const row = Store.sanitizeHiring([{ ...input, id: input.id || uid() }])[0];
      if (!row) throw new Error('A planned grant needs a role and a size.');
      if (row.planId) {
        const plan = this.plan(row.planId);
        if (!plan) throw new Error('That plan is gone.');
        if (!planIsOpen(plan)) throw new Error(`${plan.name} has been retired, so nothing more can be planned under it.`);
        // A planned grant is an option grant, so the plan has to be written for those.
        if (!planAccepts(plan, 'option')) throw new Error(planRefusal(plan, 'option'));
      }
      const rest = this.hiring.filter((h) => h.id !== row.id);
      /* The plan is sorted by start month and role and cut at the end, so a
         hundred-and-first row dropped whichever role now sorted last - and
         that was rarely the one being saved: a role starting earlier in the
         calendar pushed some other role off instead, quietly changing the
         pool forecast and the top-up the round model asks for. Either way
         saveHire returned the row it had just written and the plan said
         "Role added". Editing a row already in the plan is not an addition
         and stays allowed at the limit. */
      if (rest.length >= HIRING_MAX) {
        throw new ListFullError(
          `The hiring plan already holds ${HIRING_MAX} roles, the most it can keep. `
          + 'Delete one before planning another.');
      }
      this.hiring = Store.sanitizeHiring([...rest, row]);
      return row;
    }, ['hiring']);
  }

  async deleteHire(id) {
    return this.#commit('deleteHire', ['hiring'], () => {
      this.hiring = this.hiring.filter((h) => h.id !== id);
    }, ['hiring']);
  }

  /* ---------- Attachments (puter.fs) ---------- */

  /**
   * Where an attachment lives: under the app's own directory in the user's
   * Puter cloud, namespaced by company and record so nothing collides and a
   * backup manifest can name every file.
   */
  #attachmentPath(recordId, fileName) {
    const safe = str(fileName).replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'file';
    /* The record id is only ever a uid() for records this app created, but a
       sanitizer keeps an imported id verbatim - ids are what every other
       record refers to one by, so they cannot be rewritten on the way in.
       Put in the path as it stood, an id shaped like a directory climb wrote
       the file outside the app's own directory, where sanitizeAttachments
       then refused to reference it. */
    const record = str(recordId).replace(/[^\w-]+/g, '_').slice(0, 60) || 'record';
    return `${ATTACHMENT_ROOT}/${this.activeCompanyId}/${record}/${uid()}-${safe}`;
  }

  /** Upload against the dataset the user selected, then commit its reference.
   *  A company switch, import, or restore during the upload invalidates that
   *  target even if the replacement dataset happens to use the same ids. */
  async #attachFile(recordId, file, fields, attach) {
    const epoch = this.#dataEpoch;
    const path = this.#attachmentPath(recordId, file.name);
    await puter.fs.write(path, file, { createMissingParents: true });
    const att = {
      id: uid(), name: str(file.name).slice(0, 120) || 'file',
      path, size: int(file.size), addedAt: Date.now(),
    };
    try {
      await this.#commit('attachDocument', fields, () => {
        if (epoch !== this.#dataEpoch) {
          throw new Error('The cap table changed while the file was uploading. Attach it again.');
        }
        const attachments = attach(att);
        // Check inside the commit: later queue entries may switch company.
        if (!(attachments || []).some((a) => a.id === att.id)) {
          throw new Error('The attachment could not be recorded on this record.');
        }
      }, fields);
    } catch (err) {
      // An ambiguous commit may have completed with its acknowledgement lost.
      // Keep the file until recovery determines whether its reference survived.
      if (!this.unsaved) await puter.fs.delete(att.path).catch(() => {});
      throw err;
    }
    return att;
  }

  /** Upload a file and reference it on a security, in that order - a
   *  reference to a file that failed to upload would be a dead link. */
  async attachToSecurity(securityId, file) {
    const sec = this.security(securityId);
    if (!sec) throw refusal('That security is gone.');
    /* Refused before the upload, not after: the sanitizer caps the list, and
       the reference to a file that had already been written was the one it
       cut - the toast said "Attachment added" over a record that never got
       it, and the file sat in the user's cloud with nothing pointing at it. */
    if ((sec.attachments || []).length >= ATTACHMENTS_MAX) {
      throw refusal(`A record holds up to ${ATTACHMENTS_MAX} attachments. Remove one first.`);
    }
    /* The list is read inside apply(), which runs when the write queue
       reaches this commit. Two uploads started on one record each append to
       the list the other one left - a list snapshotted before the commit
       would be missing whatever landed in between, dropping a reference to
       a file that uploaded fine, orphaning it with its toast already shown. */
    return this.#attachFile(securityId, file, ['securities'], (att) => {
      const sec = this.security(securityId);
      if (!sec) throw new Error('That security is gone.');
      this.securities = this.securities.map((s) => (s.id === securityId
        ? Store.sanitizeSecurities(
          [{ ...s, attachments: [...(s.attachments || []), att] }], this)[0] || s
        : s));
      return this.security(securityId)?.attachments;
    });
  }

  async removeSecurityAttachment(securityId, attachmentId, { deleteFile = true } = {}) {
    const att = (this.security(securityId)?.attachments || []).find((a) => a.id === attachmentId);
    if (!this.security(securityId)) return;
    // Filtered inside apply() for the same reason the attach path appends
    // there: a removal must not roll back an upload it overlapped with.
    await this.#commit('removeSecurityAttachment', ['securities'], () => {
      this.securities = this.securities.map((s) => (s.id === securityId
        ? Store.sanitizeSecurities(
          [{ ...s, attachments: (s.attachments || []).filter((a) => a.id !== attachmentId) }], this)[0] || s
        : s));
    }, ['securities']);
    // The reference is gone either way; a failed file delete only leaves an
    // orphan in the user's own cloud, never a dead link on the record.
    if (att && deleteFile) await this.deleteAttachmentFiles([att]);
  }

  async attachToValuation(valuationId, file) {
    const valuation = this.company.valuations.find((v) => v.id === valuationId);
    if (!valuation) throw refusal('That valuation is gone.');
    if ((valuation.attachments || []).length >= ATTACHMENTS_MAX) {
      throw refusal(`A record holds up to ${ATTACHMENTS_MAX} attachments. Remove one first.`);
    }
    // Mapped inside apply(), like the security attachments above.
    return this.#attachFile(valuationId, file, ['company'], (att) => {
      if (!this.company.valuations.some((v) => v.id === valuationId)) {
        throw new Error('That valuation is gone.');
      }
      this.company = Store.sanitizeCompany({
        ...this.company,
        valuations: this.company.valuations.map((v) => (v.id === valuationId
          ? { ...v, attachments: [...(v.attachments || []), att] }
          : v)),
      });
      return this.company.valuations.find((v) => v.id === valuationId)?.attachments;
    });
  }

  async removeValuationAttachment(valuationId, attachmentId, { deleteFile = true } = {}) {
    const valuation = this.company.valuations.find((v) => v.id === valuationId);
    if (!valuation) return;
    const att = (valuation.attachments || []).find((a) => a.id === attachmentId);
    await this.#commit('removeValuationAttachment', ['company'], () => {
      this.company = Store.sanitizeCompany({
        ...this.company,
        valuations: this.company.valuations.map((v) => (v.id === valuationId
          ? { ...v, attachments: (v.attachments || []).filter((a) => a.id !== attachmentId) }
          : v)),
      });
    }, ['company']);
    if (att && deleteFile) await this.deleteAttachmentFiles([att]);
  }

  /**
   * Delete the files behind attachment references that have just left the
   * cap table - removed from their record, or gone with it. Only a file no
   * stored record names any more goes: the same paper can be referenced from
   * two companies once a backup is imported into a second one, and removing
   * the copy's reference used to delete the file the original still opened,
   * with the original's reference left pointing at nothing. Best-effort, as
   * every file delete here is: a file left behind is an orphan in the user's
   * own cloud, never a dead link on a record.
   */
  async deleteAttachmentFiles(attachments) {
    const paths = new Set((Array.isArray(attachments) ? attachments : [])
      .map((a) => a?.path)
      .filter((path) => Store.isAttachmentPath(path)));
    await this.#deleteOrphanedFiles(paths);
  }

  /** Every attachment on the active company, for the export manifest. */
  attachmentManifest() {
    const rows = [];
    for (const s of this.securities) {
      for (const a of s.attachments || []) {
        rows.push({ record: s.label, securityId: s.id, name: a.name, path: a.path });
      }
    }
    for (const v of this.company.valuations || []) {
      for (const a of v.attachments || []) {
        rows.push({ record: `409A ${v.date}`, valuationId: v.id, name: a.name, path: a.path });
      }
    }
    return rows;
  }

  /* ---------- Activity log ---------- */

  /**
   * Activity entries, in the exact shape logActivity writes. Import is the
   * one path that can carry arbitrary shapes, and views search the log
   * (`a.text.toLowerCase()`), so a non-string text must be coerced here or
   * it breaks every render that touches the entry.
   */
  static sanitizeActivity(raw) {
    return (Array.isArray(raw) ? raw : [])
      .filter((a) => a && typeof a === 'object' && str(a.text))
      .map((a) => ({
        id: rid(a.id) || uid(),
        at: num(a.at, Date.now()),
        text: str(a.text).slice(0, 200),
        icon: str(a.icon).slice(0, 40) || 'activity',
      }))
      /* Newest first, which is the order the app writes and reads - so the
         cap below keeps the latest entries of a log that arrived oldest
         first (a hand-built import) rather than its earliest. */
      .sort((a, b) => b.at - a.at)
      .slice(0, ACTIVITY_MAX);
  }

  /* ---------- Restore points ---------- */

  /**
   * Stored restore points. A point whose payload can't be read is dropped
   * rather than kept as a button that would restore nothing.
   */
  static sanitizeRestorePoints(raw) {
    const points = (Array.isArray(raw) ? raw : [])
      .filter((p) => p && typeof p === 'object' && p.data && typeof p.data === 'object')
      .map((p) => ({
        id: rid(p.id) || uid(),
        at: num(p.at, Date.now()),
        label: str(p.label).slice(0, 80) || 'Snapshot',
        // Whether the dataset in the snapshot was the sample set - see
        // #capture. Points written before this field existed read as false.
        sampleData: p.sampleData === true,
        data: Store.sanitizeSnapshot(p.data),
      }))
      .sort((a, b) => b.at - a.at);
    return Store.trimRestorePoints(points);
  }

  /**
   * The securities in a file that name a holder or class the file does not
   * carry. The sanitizer drops such a record, which is the right reading of
   * a backup damaged in storage (see recoverHolders) and the wrong one of a
   * file someone is importing: the import said done and the certificates
   * were gone, with nothing to say so. An import refuses instead and names
   * them, so the file gets fixed rather than the table.
   */
  static importOrphans(raw, { classes = [], stakeholders = [] } = {}) {
    const classIds = new Set(classes.map((c) => c.id));
    const holderIds = new Set(stakeholders.map((h) => h.id));
    const out = [];
    for (const s of Array.isArray(raw) ? raw : []) {
      if (!s || typeof s !== 'object' || !SECURITY_KINDS.has(s.kind)) continue;
      const needsClass = s.kind === 'shares' || s.kind === 'rsu' || s.kind === 'warrant';
      if (!holderIds.has(rid(s.stakeholderId)) || (needsClass && !classIds.has(rid(s.classId)))) {
        out.push({ label: str(s.label).slice(0, 24) || 'An unlabelled security' });
      }
    }
    return out;
  }

  /** One snapshot's dataset, sanitized against itself (not against today's). */
  static sanitizeSnapshot(raw) {
    const classes = Store.sanitizeClasses(raw?.classes);
    const stakeholders = Store.sanitizeStakeholders(raw?.stakeholders);
    return {
      company: Store.sanitizeCompany(raw?.company),
      classes,
      stakeholders,
      securities: Store.sanitizeSecurities(raw?.securities, { classes, stakeholders }),
      scenarios: Store.sanitizeScenarios(raw?.scenarios),
      exits: Store.sanitizeExits(raw?.exits),
      hiring: Store.sanitizeHiring(raw?.hiring),
      activity: Store.sanitizeActivity(raw?.activity),
    };
  }

  /** The newest points that fit both the count and the size budget. */
  static trimRestorePoints(points) {
    const out = points.slice(0, RESTORE_MAX);
    // Always at least one: a company whose dataset alone exceeds the budget
    // still deserves the snapshot it is about to need.
    while (out.length > 1 && byteLength(out) > RESTORE_BUDGET_BYTES) out.pop();
    return out;
  }

  /**
   * Whether a restore point would be taken before the next guarded write.
   * The CSV preview reads it so it promises a way back only when there is one.
   */
  get hasData() {
    return this.#hasData();
  }

  /** Whether there is anything here worth snapshotting. */
  #hasData() {
    return !!(this.company.name || this.classes.length || this.stakeholders.length
      || this.securities.length || this.scenarios.length || this.exits.length
      || this.hiring.length || this.company.poolAuthorized > 0 || this.company.poolHistory?.length
      || this.company.plans?.length
      || this.company.valuations?.length || this.company.splits?.length
      || Store.hasReporting(this.company));
  }

  /**
   * Whether the reporting assumptions have been set at all - they are data
   * too, and a wipe of a company that holds nothing else would otherwise take
   * no restore point and leave no way back to them.
   */
  static hasReporting(company) {
    const base = Store.defaultReporting();
    const r = company?.reporting;
    return !!r && Object.keys(base).some((k) => r[k] !== base[k]);
  }

  /**
   * Snapshot the dataset under a label. Returns the point, or null when the
   * company is empty - a restore point of nothing is a row that offers to
   * restore nothing.
   *
   * Deliberately not best-effort: it runs before the operation it covers, and
   * a failure here aborts that operation rather than letting an irreversible
   * write go ahead with no way back. The failure mode is a KV write that
   * didn't land, which is the same thing that would have failed the operation
   * one step later anyway.
   */
  async #captureNow(label) {
    if (!this.#hasData()) return null;
    const point = {
      id: uid(),
      at: Date.now(),
      label: str(label).slice(0, 80) || 'Snapshot',
      /* Whether this dataset is the sample set. It is not part of the data,
         but it describes it: the banner over the whole app, the getting-
         started checklist, and the one-tap wipe all read it, and a restore
         that put a real cap table back under "explore freely, nothing here is
         yours" would be at its most misleading in the moment someone is
         undoing a mistake. */
      sampleData: this.settings.sampleData === true,
      data: Object.fromEntries(DATA_FIELDS.map((f) => [f, this[f]])),
    };
    return this.#commitNow(['restorePoints'], () => {
      this.restorePoints = Store.trimRestorePoints([point, ...this.restorePoints]);
      return point;
    }, ['restorePoints']);
  }

  /**
   * Take a restore point, then run the operation it covers. An operation that
   * fails changed nothing, so its snapshot is dropped again rather than left
   * in the list as a point that goes back to exactly where the user already is.
   *
   * The snapshot and the operation are one entry on the write queue, and
   * `run` is handed a commit that writes in place rather than queueing. As
   * two queued steps they could be split by whatever the user did during the
   * snapshot's round trip - and the one thing worth doing while a write hangs
   * is switching company. A switch queued between them re-pointed the second
   * step at the other company: its data was read and rewritten under that
   * company's keys, while the restore point sat on the company the operation
   * was started on. A wipe of one company emptied the other.
   */
  async #guarded(label, run, validate = null, auditMetadata = {}) {
    // Pinned to the company it was asked of, as every #commit is.
    const company = this.activeCompanyId;
    return this.#enqueue(async () => {
      if (this.activeCompanyId !== company) throw new CompanyChangedError();
      // Check capacity on the queued state before a new snapshot displaces an old one.
      validate?.();
      /* The list as it stood, put back whole when the operation fails: the
         snapshot goes, and so does the trim it caused. Dropping the snapshot
         alone left the list one short, since a sixth point pushes the oldest
         off - a failed write cost the user the point it had displaced. */
      const pointsBefore = this.restorePoints;
      const point = await this.#captureNow(label);
      try {
        /* Journaled under the operation's own name, whatever the restore
           point is labelled: the label is for a person reading the list of
           points, the operation is what a filter and an export key on. */
        return await run((fields, apply, keys) => this.#commitNow(fields, apply, keys, [], { forceAudit: true, source: 'app', ...auditMetadata }));
      } catch (err) {
        if (point) {
          await this.#commitNow(['restorePoints'], () => {
            this.restorePoints = pointsBefore;
          }, ['restorePoints']).catch(() => {});
        }
        throw err;
      }
    });
  }

  async deleteRestorePoint(id) {
    return this.#commit('deleteRestorePoint', ['restorePoints'], () => {
      this.restorePoints = this.restorePoints.filter((p) => p.id !== id);
    }, ['restorePoints']);
  }

  /**
   * Roll the company back to a restore point, taking a point of the state
   * being left behind first - so an unwanted restore is itself reversible.
   *
   * The snapshot's collections are copied out rather than handed over: the
   * point stays in the list after the restore, and live state must not share
   * arrays with it. The sample-data flag travels with them: it describes
   * which dataset this is, not which settings the user chose.
   */
  async restoreFromPoint(id) {
    const point = this.restorePoints.find((p) => p.id === id);
    if (!point) throw refusal('That restore point is gone.');
    const data = point.data;
    const company = this.activeCompanyId;
    // Snapshot and restore as one queue entry, for the reason #guarded gives.
    const result = await this.#enqueue(async () => {
      if (this.activeCompanyId !== company) throw new CompanyChangedError();
      if (!this.restorePoints.some((p) => p.id === id)) {
        throw refusal('That restore point is gone.');
      }
      /* As in #guarded: a restore that fails puts the list back as it was.
         With five points held, the snapshot taken here pushed the oldest off
         the list - and when the oldest was the very point being restored, a
         write that failed left the user with a snapshot of where they still
         were and no way back to where they were going. */
      const pointsBefore = this.restorePoints;
      const taken = await this.#captureNow('Before restoring an earlier point');
      // What the snapshot's dataset was, restored with it - see #captureNow.
      const sample = point.sampleData === true;
      const fields = (this.settings.sampleData === true) !== sample
        ? [...DATA_FIELDS, 'settings'] : DATA_FIELDS;
      try {
        return await this.#commitNow(fields, () => {
          this.company = { ...data.company };
          this.classes = [...data.classes];
          this.stakeholders = [...data.stakeholders];
          this.securities = [...data.securities];
          this.scenarios = [...data.scenarios];
          this.exits = [...data.exits];
          this.hiring = [...data.hiring];
          this.activity = [...data.activity];
          if (fields.includes('settings')) this.settings = { ...this.settings, sampleData: sample };
          // Every quantity, id and unit came from another moment; an undo closure
          // from before the restore belongs to the dataset it was built against.
          this.#dataEpoch += 1;
          return this.#committedName();
        }, fields, [], { operation: 'restoreFromPoint', source: 'restore', forceAudit: true,
          // The point by its label and time, which is how the list of points names it; its id names nothing to a reader.
          explanation: `Restored the snapshot "${point.label}" taken ${new Date(point.at).toISOString()}` });
      } catch (err) {
        if (taken) {
          await this.#commitNow(['restorePoints'], () => {
            this.restorePoints = pointsBefore;
          }, ['restorePoints']).catch(() => {});
        }
        throw err;
      }
    });
    await this.#syncRegistryLabel(result);
  }

  /**
   * The active company's restore points, read on their own.
   *
   * For the recovery screen. A load that failed on one of the company's
   * collections reached none of them (see #loadCompany), and the snapshots
   * are the way back the failed load never got to: they stand under a key
   * of their own, readable while the damaged record is not. Assigned as the
   * load would have assigned them, so restoreFromPoint finds the point in
   * the list as usual. A damaged list of points fails the same way the load
   * did, and the screen says so.
   */
  async loadRestorePoints() {
    const raw = await this.#kvGet(this.#companyKey('restorePoints'), []);
    this.restorePoints = Store.sanitizeRestorePoints(raw);
    return this.restorePoints;
  }

  /**
   * Best-effort: activity never blocks or fails the action it describes.
   *
   * The line joins the list in memory at once and is written when the queue
   * gets to it - and the list it joined belongs to the company loaded now,
   * which is not always the company loaded by then. A save whose round trip
   * the user spent switching company had its line prepended to the old
   * company's list and its write queued behind the switch, and the switch
   * replaced that list before the write ran: the line was gone, and the write
   * put the new company's own log back over itself. So the line remembers
   * which company it describes, and lands in that company's log either way.
   */
  logActivity(text, icon = 'activity') {
    const entry = { id: uid(), at: Date.now(), text: str(text).slice(0, 200), icon };
    const companyId = this.#loadedCompanyId;
    this.activity = [entry, ...this.activity].slice(0, ACTIVITY_MAX);
    this.emit();
    this.#enqueue(() => this.#persistActivity(companyId, entry)).catch(() => {});
  }

  /**
   * Write the log, merging first when another session has written it since.
   *
   * The log is the one collection two sessions can both add to without
   * either being wrong: entries are only ever appended, so the answer to a
   * collision is the union, where every other collection refuses. Put through
   * the ordinary stale-write guard, a collision here did two things it should
   * not. The line this session had just written was dropped, and the whole
   * session was marked stale - the banner said the last change was not saved,
   * over a stakeholder that had been saved a moment earlier in a collection
   * nobody else had touched. Only the line describing it had landed on the
   * line another tab wrote about its own change.
   */
  async #persistActivity(companyId = this.#loadedCompanyId, entry = null) {
    /* The company the line describes has been switched away from since it was
       logged - see logActivity. Its list is no longer in memory, so the line
       is merged into that company's stored log directly, and the log of the
       company loaded now is left as it stands. A company deleted in the
       meantime has no log to add to. */
    const active = companyId === this.#loadedCompanyId;
    if (!active && (!entry || !this.companies.some((c) => c.id === companyId))) return;
    const key = this.#companyKey('activity', companyId);
    // Re-merge if an append overtakes the read too. That collision is still
    // just activity; it must never put up the cap table's stale-data banner.
    for (;;) {
      const expected = await readKV(key);
      /* A log whose company has been deleted - in another tab, while this one
         still shows it - has nowhere to go. Read as an empty list, it was
         rewritten whole as a successor of the deletion: a payload, a link and
         a shortcut under a company nothing names and no cleanup will visit.
         The data saves of such a tab are refused as stale; the line is
         simply dropped. */
      if (expected.deleted) return;
      /* A key that holds nothing has no tombstone to say so, so a company
         deleted before its first line was ever logged is checked against the
         registry as stored - once, on the one write that would create the
         key, so the cost lands only on a company's first activity line. */
      if (expected.raw === null || expected.raw === undefined) {
        const registry = Store.sanitizeRegistry(
          await Store.#readStored(REGISTRY_KEY, null).then((r) => r.value, () => null));
        if (registry && !registry.companies.some((c) => c.id === companyId)) return;
      }
      const stored = Store.sanitizeActivity(await Store.#stored(key, expected.raw, []));
      const have = new Set(stored.map((a) => a.id));
      const local = active ? this.activity : [entry];
      const merged = Store.sanitizeActivity([...stored, ...local.filter((a) => !have.has(a.id))]);
      this.#seen.set(key, Store.#bytes(expected.raw));
      if (active) {
        this.activity = merged;
        this.emit();
      }
      const text = JSON.stringify(merged);
      this.#sending(key, text);
      try {
        await compareAndSetKV(key, expected, text);
        this.#acknowledged(key, text);
        return;
      } catch (err) {
        if (!(err instanceof KVConflictError)) throw err;
        this.#attempted.get(key)?.delete(text);
        this.#sent.delete(key);
      }
    }
  }

  /**
   * Additive import (the CSV path): create the named classes, the new
   * stakeholders, and every security in one commit - unlike importAll, which
   * replaces the world. Securities arrive with `stakeholderName` /
   * `className` and are resolved here against existing records plus the ones
   * this same commit creates, so ordering inside the file never matters. A
   * name more than one stakeholder answers to resolves to neither and is
   * refused; the preview says so first.
   *
   * Covered by a restore point like every other write that lands more than
   * one record at a time. Adding is not replacing, but a spreadsheet can put
   * hundreds of securities on the cap table in one press - and the only way
   * back was to delete them one at a time, which is no way back at all.
   */
  async importRecords({ stakeholders = [], classNames = [], securities = [] }) {
    return this.#guarded('Before importing a CSV',
      (commit) => commit(['classes', 'stakeholders', 'securities'], () => {
      /* Same reading the preview gives: a class name more than one class
         answers to names none of them, so a row asking for it is refused
         rather than issued into whichever was stored last. */
      const classByName = new Map();
      const ambiguousClasses = new Set();
      for (const c of this.classes) {
        const key = c.name.trim().toLowerCase();
        if (classByName.has(key)) ambiguousClasses.add(key);
        else classByName.set(key, c);
      }
      // Keyed by the name as the sanitizer will store it, or a name distinct
      // only past the cut created a twin under the same stored name.
      for (const name of classNames) {
        const key = str(name).slice(0, CLASS_NAME_MAX).toLowerCase();
        if (!key || classByName.has(key)) continue;
        const cls = Store.sanitizeClasses([{
          name,
          // A heuristic, editable afterwards: series names read as preferred.
          kind: /preferred|series/i.test(name) ? 'preferred' : 'common',
          id: uid(), createdAt: Date.now(),
        }])[0];
        if (!cls) throw new Error(`Could not create the share class "${name}".`);
        this.classes = [...this.classes, cls];
        classByName.set(key, cls);
      }

      /* Names two people share resolve to neither. Keyed by name alone the
         later record simply overwrote the earlier one, and the securities
         landed on whichever stakeholder happened to be stored last. */
      const holderByName = new Map();
      const ambiguous = new Set();
      for (const h of this.stakeholders) {
        const key = h.name.trim().toLowerCase();
        if (holderByName.has(key)) ambiguous.add(key);
        else holderByName.set(key, h);
      }
      let created = 0;
      for (const input of stakeholders) {
        const key = str(input.name).slice(0, STAKEHOLDER_NAME_MAX).toLowerCase();
        if (!key || holderByName.has(key)) continue;
        const full = roomFor('stakeholders', this.stakeholders.length, 1, MAX_STAKEHOLDERS);
        if (full) throw new ListFullError(full);
        const holder = Store.sanitizeStakeholders([{ ...input, id: uid(), createdAt: Date.now() }])[0];
        if (!holder) throw new Error(`Could not create the stakeholder "${input.name}".`);
        this.stakeholders = [...this.stakeholders, holder];
        holderByName.set(key, holder);
        created += 1;
      }

      const issued = [];
      const full = roomFor('securities', this.securities.length, securities.length, MAX_SECURITIES);
      if (full) throw new ListFullError(full);
      // One scan for the labels and one append for the records - see labelSequence.
      const label = labelSequence(this.db);
      for (const input of securities) {
        const key = str(input.stakeholderName).slice(0, STAKEHOLDER_NAME_MAX).toLowerCase();
        if (ambiguous.has(key)) {
          throw new Error(`More than one stakeholder is named "${input.stakeholderName}".`);
        }
        const holder = holderByName.get(key);
        if (!holder) throw new Error(`Unknown stakeholder "${input.stakeholderName}".`);
        const { stakeholderName, className, price, ...rest } = input;
        const record = { ...rest, stakeholderId: holder.id };
        // A plan named by the row has to be on file - see #assertPlanNamed.
        this.#assertPlanNamed(record);
        // And an MFN election is derived from its source, never imported - see addSecurity.
        if (record.mfn?.elections?.length) throw new FinancingError('Record the original instrument first, then elect eligible later terms.');
        if (input.kind === 'shares') record.pricePerShare = input.pricePerShare ?? 0;
        if (input.kind === 'shares' || input.kind === 'warrant' || input.kind === 'rsu') {
          const classKey = str(className).slice(0, CLASS_NAME_MAX).toLowerCase();
          if (ambiguousClasses.has(classKey)) {
            throw new Error(`More than one share class is named "${className}".`);
          }
          const cls = classByName.get(classKey);
          if (!cls) throw new Error(`Unknown share class "${className}".`);
          record.classId = cls.id;
        }
        /* Sanitized against the one holder and class the row resolved to,
           not the whole cap table: the sanitizer indexes every holder and
           class it is given, and handed all of them once per row it made a
           5,000-row import quadratic in the holders already on the table. */
        const sec = Store.sanitizeSecurities([{
          ...record,
          id: uid(),
          label: label(input.kind, record.classId || null),
          createdAt: Date.now(),
        }], { classes: this.classes.filter((c) => c.id === record.classId), stakeholders: [holder], plans: this.company.plans })[0];
        if (!sec) throw new Error(`Row for ${input.stakeholderName} could not be written.`);
        this.#assertPlanFits(null, sec);
        issued.push(sec);
      }
      assertUniqueTermIds([...this.securities, ...issued]);
      this.securities = [...this.securities, ...issued];

      return { stakeholders: created, securities: issued.length };
    }, ['classes', 'stakeholders', 'securities']), null, { operation: 'importCSV', source: 'csv' });
  }

  /* ---------- Export / import / wipe ---------- */

  /**
   * Everything importAll() reads, so an export is a true backup: restoring one
   * has to put the activity log back too, or the round trip quietly erases the
   * history of how the cap table got to where it is.
   */
  /**
   * A backup with the company's journal. The dataset is taken once every
   * queued write has landed; the journal is read outside the queue, since a
   * long history takes a while and holding the queue for it stalled every
   * save meanwhile. `onProgress` hears how far the read is - see
   * AuditJournal.export.
   */
  async exportBackup({ onProgress = null } = {}) {
    const data = await this.#enqueue(() => this.exportAll());
    return { ...data, auditArchive: await this.exportAudit({ onProgress }) };
  }

  exportAll() {
    return {
      app: 'captable',
      version: 1,
      exportedAt: new Date().toISOString(),
      company: this.company,
      classes: this.classes,
      stakeholders: this.stakeholders,
      securities: this.securities,
      scenarios: this.scenarios,
      exits: this.exits,
      hiring: this.hiring,
      activity: this.activity,
      // What files belong to this backup. Contents stay in the user's own
      // Puter cloud; the manifest tells a backup which paths are its.
      attachmentManifest: this.attachmentManifest(),
    };
  }

  /**
   * Replace the active company's dataset (import, sample data, wipe).
   *
   * `label` names the restore point taken first, since the same call means
   * three different things to the person making it. Restore points themselves
   * are not part of the dataset, so an import never replaces the snapshot it
   * was covered by.
   */
  /**
   * What a backup would install, sanitized and checked, or the refusal
   * importing it would raise. Every refusal a file can earn is decided here,
   * on the file alone, so a caller can ask before it creates anything for
   * the file: the import dialog made the new company first and let the
   * import refuse second, and a file naming a holder it did not carry left
   * an empty company behind - switched to, and under a note saying to retry
   * the same file into it.
   */
  static prepareImport(data) {
    const sourceArchive = data?.auditArchive ?? null;
    if (sourceArchive && (sourceArchive.app !== 'captable-audit' || sourceArchive.version !== 1 || !Array.isArray(sourceArchive.events))) {
      throw refusal('This audit archive format is not supported. No data was imported.');
    }
    const company = Store.sanitizeCompany(data?.company);
    const classes = Store.sanitizeClasses(data?.classes);
    const stakeholders = Store.sanitizeStakeholders(data?.stakeholders);
    /* An award that names no plan takes the one plan that could hold it -
       see resolvePlan. One that several could hold has to be told which,
       in the file: guessing would draw a reserve nobody chose. */
    const unresolved = Store.unresolvedPlanAwards(data?.securities, company.plans);
    if (unresolved.length) {
      const named = unresolved.slice(0, 3).map((u) => u.label).join(', ') + (unresolved.length > 3 ? ` and ${unresolved.length - 3} more` : '');
      throw refusal(`${named} ${unresolved.length === 1 ? 'names' : 'name'} no plan, and more than one plan in the file could hold `
        + `${unresolved.length === 1 ? 'it' : 'them'}. Set "planId" on ${unresolved.length === 1 ? 'it' : 'each'} in the file, `
        + 'or "outsidePlan": true for an award outside any plan. No data was imported.');
    }
    const securities = Store.sanitizeSecurities(data?.securities, { classes, stakeholders, plans: company.plans });
    /* After the sanitizer, whose own refusal of a record with financing terms
       names the terms; every other record it would have dropped is named here. */
    const orphans = Store.importOrphans(data?.securities, { classes, stakeholders });
    if (orphans.length) {
      const named = orphans.slice(0, 3).map((o) => o.label).join(', ') + (orphans.length > 3 ? ` and ${orphans.length - 3} more` : '');
      throw refusal(`${named} ${orphans.length === 1 ? 'names' : 'name'} a stakeholder or share class the file does not include. `
        + 'Add them to the file, or remove the securities, and import again. No data was imported.');
    }
    // Refused before anything is taken or written - see MAX_SECURITIES.
    const full = roomFor('stakeholders', 0, stakeholders.length, MAX_STAKEHOLDERS)
      || roomFor('securities', 0, securities.length, MAX_SECURITIES)
      || roomFor('saved scenarios', 0, (Array.isArray(data?.scenarios) ? data.scenarios : []).length, SCENARIOS_MAX)
      || roomFor('saved exits', 0, (Array.isArray(data?.exits) ? data.exits : []).length, SCENARIOS_MAX);
    if (full) throw new ListFullError(full);
    return {
      sourceArchive, company, classes, stakeholders, securities,
      scenarios: Store.sanitizeScenarios(data?.scenarios),
      exits: Store.sanitizeExits(data?.exits),
      hiring: Store.sanitizeHiring(data?.hiring),
      activity: Store.sanitizeActivity(data?.activity),
    };
  }

  async importAll(data, { label = 'Before replacing all data', settings = null, operation = 'importAll', source = 'app' } = {}) {
    const { sourceArchive: fileArchive, company, classes, stakeholders, securities, scenarios, exits, hiring, activity } = Store.prepareImport(data);
    /* The file's history, less what this company's journal already holds -
       see pruneProvenance. A backup of this company imported back into it
       carries nothing new, and the event says so in place of the archive. */
    const provenance = fileArchive ? pruneProvenance(fileArchive, this.activeCompanyId) : { archive: null, dropped: 0 };
    const sourceArchive = provenance.archive?.events.length ? provenance.archive : null;
    const explanation = provenance.dropped
      ? `${provenance.dropped === 1 ? 'One event' : `${provenance.dropped} events`} of the file’s history ${provenance.dropped === 1 ? 'was' : 'were'} already `
        + `recorded in this company and ${provenance.dropped === 1 ? 'is' : 'are'} not repeated here.`
      : '';
    /* The settings that describe the new dataset (sample or not, onboarded
       or not) land in the same commit as the dataset. Written afterwards as
       a second step, they described whichever company was loaded by then. */
    const fields = settings ? [...DATA_FIELDS, 'settings'] : DATA_FIELDS;
    const result = await this.#guarded(label, (commit) => commit(
      fields,
      () => {
        this.company = company;
        this.classes = classes;
        this.stakeholders = stakeholders;
        this.securities = securities;
        this.scenarios = scenarios;
        this.exits = exits;
        this.hiring = hiring;
        this.activity = activity;
        if (settings) this.settings = { ...this.settings, ...settings };
        this.#dataEpoch += 1;
        return this.#committedName();
      },
      fields), null, { sourceArchive, operation, source, explanation });
    await this.#syncRegistryLabel(result);
  }

  async wipeAll() {
    await this.importAll({}, {
      label: 'Before deleting all data',
      operation: 'wipeAll',
      settings: { sampleData: false, onboarded: false },
    });
  }
}

export const store = new Store();
