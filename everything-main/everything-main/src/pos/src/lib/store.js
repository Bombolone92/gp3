/**
 * Data layer on top of Puter.
 *
 * Storage design (mirrors the Accountant app's cost/scale reasoning):
 *
 *  KV (small, hot, single-key reads - never kv.list() scans):
 *    pos:settings:v1    { storeName, address, receiptFooter, currency, theme,
 *                         pricesIncludeTax, defaultTaxId, nextReceipt,
 *                         onboarded, sampleData }
 *    pos:products:v1    [{ id, name, price, categoryId, sku, taxId, slot, stock }]
 *    pos:categories:v1  [{ id, name }]
 *    pos:taxes:v1       [{ id, name, rate }]
 *    pos:discounts:v1   [{ id, name, type, value }]   (named presets)
 *    pos:months:v1      ["2026-08", ...]              (index of sale files)
 *
 *  FS (bulky, grows unbounded - one JSON file per month):
 *    pos-data/sales-YYYY-MM.json  [receipt, ...]
 *
 *  Reads scale with the months a report looks at, not total sales volume.
 */

import { uid, round2, clamp } from './util.js';
import { MAX_AMOUNT } from './money.js';
import { computeCart, changeDue, discountCents, toCents, fromCents, sanitizeQty } from './totals.js';
import { isRefund, refundPlan, refundedQty, refundState } from './refunds.js';
import { daySummary } from './drawer.js';
import { paymentMethodInfo } from './payments.js';
import { Outbox, isTransportError } from './outbox.js';
import { todayISO, monthKeyOf, monthKeysInRange, isMonthKey } from './dates.js';
import {
  SNAPSHOT_FILE, snapshotName, cleanSnapshots, retentionPlan,
  DAILY_INTERVAL_MS, MIN_GAP_MS,
} from './snapshots.js';

const KV = {
  settings: 'pos:settings:v1',
  products: 'pos:products:v1',
  categories: 'pos:categories:v1',
  taxes: 'pos:taxes:v1',
  discounts: 'pos:discounts:v1',
  customers: 'pos:customers:v1',
  credit: 'pos:credit:v1',
  months: 'pos:months:v1',
  holds: 'pos:holds:v1',
  draft: 'pos:draft:v1',
  drawers: 'pos:drawers:v1',
  stockMonths: 'pos:stock-months:v1',
  stocktake: 'pos:stocktake:v1',
  stocktakeMonths: 'pos:stocktake-months:v1',
  snapshots: 'pos:snapshots:v1',
};

/** Which in-memory collection each KV key holds, for writing and rolling back. */
const KV_FIELD = {
  [KV.settings]: 'settings',
  [KV.products]: 'products',
  [KV.categories]: 'categories',
  [KV.taxes]: 'taxes',
  [KV.discounts]: 'discounts',
  [KV.customers]: 'customers',
  [KV.credit]: 'credit',
};

/** How a credit movement came about, for the row a customer's page shows. */
export const CREDIT_TYPES = ['issued', 'spent', 'adjusted'];

/** Parked sales are a working set, not an archive - enough for any counter. */
const MAX_HOLDS = 40;

/**
 * How long a deleted product's photo file outlives the catalog row - well
 * past the undo toast, so a delete taken back keeps its picture. After
 * that the file is orphaned bytes nothing can ever show again.
 */
const PHOTO_PURGE_DELAY_MS = 60_000;

/**
 * The catalog lives in one hot kv entry that every boot reads, so it has a
 * ceiling. Well past any counter's real catalog; it exists so a spreadsheet
 * import can't make the app unopenable.
 */
export const MAX_PRODUCTS = 4000;

/** Guard rails on the option editor, so one product can't bloat the KV entry. */
const MAX_OPTION_GROUPS = 8;
const MAX_OPTION_CHOICES = 20;

/**
 * Draft (in-progress cart) writes are throttled: the first change in a burst
 * goes out at once so a crash costs nothing, and the rest coalesce.
 */
const DRAFT_MIN_INTERVAL_MS = 900;

/**
 * The last-known copy of the small, hot collections, kept in localStorage so
 * a register whose cloud is unreachable at boot can still open and sell.
 * Refreshed on every change, throttled like the draft.
 */
const BOOT_CACHE_KEY = 'pos:boot-cache:v1';
const BOOT_CACHE_MIN_INTERVAL_MS = 2000;

const DATA_DIR = 'pos-data';
const monthPath = (key) => `${DATA_DIR}/sales-${key}.json`;
/** Drawer days are small and bounded, but follow the same per-month shape. */
const drawerPath = (key) => `${DATA_DIR}/drawer-${key}.json`;
/** Stock movements grow with trade, like sales - one file per month. */
const stockPath = (key) => `${DATA_DIR}/stock-${key}.json`;
/** Posted stocktakes: small, but they accumulate - same per-month shape. */
const stocktakePath = (key) => `${DATA_DIR}/stocktake-${key}.json`;
/**
 * Automatic snapshots. The name is built by lib/snapshots.js from a timestamp
 * and a known reason - never from anything typed - and checked here again
 * before it becomes a path, because a snapshot's file name arrives from the
 * kv index, which a hand-edited account could hold anything in.
 */
const snapshotPath = (file) => (SNAPSHOT_FILE.test(String(file ?? ''))
  ? `${DATA_DIR}/snapshots/${file}`
  : null);
/**
 * Product photos: image blobs don't belong in kv. One file per product.
 *
 * The id becomes a path segment, and ids are not always this app's own -
 * a restored backup carries whatever ids the file happened to hold. An id
 * like `../../notes` would resolve to a path outside the directory this
 * app owns, and the read, the write and the delete would all follow it.
 * Only the plain shape uid() produces is turned into a path; anything else
 * gets none, and every caller treats that as "no picture here".
 * (Month keys naming their own files are checked the same way.)
 */
const PHOTO_ID = /^[A-Za-z0-9_-]{1,64}$/;
const photoPath = (id) => (PHOTO_ID.test(String(id ?? '')) ? `${DATA_DIR}/product-images/${id}.jpg` : null);

/** The badge threshold a tracked product uses when it hasn't set its own. */
export const DEFAULT_LOW_STOCK = 5;

/**
 * A counting session is a half-hour job on a shop floor, so it is written to
 * kv as it goes - the tablet will sleep. Throttled exactly like the open cart,
 * for the same reason: the first entry in a burst lands at once, the rest
 * coalesce.
 */
const STOCKTAKE_MIN_INTERVAL_MS = 900;

/** Reasons a human can pick for a manual stock adjustment. */
export const ADJUST_REASONS = [
  { value: 'received', label: 'Received delivery' },
  { value: 'recount', label: 'Recount' },
  { value: 'damage', label: 'Damage / waste' },
  { value: 'other', label: 'Other' },
];

// Re-exported so the many call sites that reach for payment helpers through
// the store keep working; the definitions live in lib/payments.js, which knows
// nothing about storage.
export {
  PAYMENT_METHODS, CASH_METHODS, CREDIT_METHOD, SPLIT_METHOD, paymentMethodInfo,
  receiptPayments, paymentKindOf, receiptChange, receiptTip,
} from './payments.js';

/** Color slots products can carry (rendered from CSS --slot-N tokens). */
export const PRODUCT_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * Why a sale that is still in the offline outbox can't be voided or refunded:
 * both write the month file, which deliberately excludes queued sales, so the
 * change would have nowhere durable to live. Shown to the cashier verbatim.
 */
export const PENDING_SYNC_MESSAGE = 'This sale hasn’t reached your cloud yet. It syncs on its own; try again in a moment.';

const DEFAULT_SETTINGS = {
  storeName: '',
  address: '',
  receiptFooter: 'Thank you for your purchase',
  // Label + number pairs a receipt must carry in much of the world
  // ("VAT No. GB…", "ABN …"), printed under the address.
  registrations: [],
  // Small data-URL image printed at the top of receipts; null = none. Kept
  // inline in settings so receipts render it offline and backups carry it.
  logo: null,
  currency: 'USD',
  theme: 'system',
  pricesIncludeTax: false,
  defaultTaxId: null,
  nextReceipt: 1001,
  onboarded: false,
  sampleData: false,
  // Off by default: shops that don't tip should never see the controls.
  tipsEnabled: false,
  // Reusable phrases a counter taps instead of typing mid-rush ("to go",
  // "no ice"). Empty until a shop writes its own.
  quickNotes: [],
  // The punch card, off by default: a shop that doesn't run one sees nothing
  // of it anywhere. Shape and bounds live in lib/loyalty.js.
  loyalty: { enabled: false, type: 'stamps', stamps: 10, percent: 5, threshold: 5 },
  // Restore points, on by default. The whole point of the feature is that
  // shopkeepers do not think to take backups; a shop that would rather not
  // spend the storage can turn it off in Settings.
  autoSnapshot: true,
};

/**
 * Hard cap on the logo's stored data URL. Settings are read on every boot
 * and travel inside the JSON backup, so the logo must stay a rounding error
 * there - the picker (ui/image.js) steps a chosen image down until it fits.
 */
export const LOGO_MAX_CHARS = 64_000;

/**
 * A logo this app could have stored itself: an inline data-URL image within
 * the picker's cap. Anything else arriving in a backup is foreign - a remote
 * URL would call home on every receipt render and print (and taint the
 * shared receipt's canvas) - so it is dropped rather than installed.
 */
function cleanLogo(logo) {
  return typeof logo === 'string' && logo.startsWith('data:image/') && logo.length <= LOGO_MAX_CHARS
    ? logo
    : null;
}

/** How long a note can be, on a line or on a sale. Long enough for a sentence
 *  a cashier types at a counter; short enough to ride on every receipt. */
export const MAX_NOTE = 80;

/**
 * Quick notes, sanitized: trimmed, deduped case-insensitively, and capped -
 * they live in the settings entry every boot reads, and a chip nobody can
 * read the whole of is not a shortcut.
 */
export function cleanQuickNotes(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const text = String(raw || '').trim().slice(0, 32);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * How long the store's own text may be.
 *
 * These strings become the sidebar brand, the document title, and the header
 * of every receipt - and they ride in the settings entry every boot reads, so
 * a pasted essay belongs in none of those places. Stated here rather than in
 * the fields that type them, because a restored backup has to obey the same
 * ceiling as a keyboard does.
 */
export const STORE_TEXT_MAX = { storeName: 60, address: 200, receiptFooter: 200 };

/** The store's text, trimmed and capped - only the keys actually present. */
function cleanStoreText(settings) {
  const out = {};
  for (const [key, max] of Object.entries(STORE_TEXT_MAX)) {
    if (settings?.[key] === undefined) continue;
    out[key] = String(settings[key] ?? '').trim().slice(0, max);
  }
  return out;
}

/** Registration pairs, sanitized: a row without a number prints nothing. */
export function cleanRegistrations(list) {
  return (Array.isArray(list) ? list : [])
    .map((r) => ({
      label: String(r?.label || '').trim().slice(0, 40),
      number: String(r?.number || '').trim().slice(0, 60),
    }))
    .filter((r) => r.number)
    .slice(0, 2);
}

/**
 * Newest first, with the receipt number breaking ties - two sales rung up in
 * the same millisecond must still have one stable order everywhere.
 */
const byNewest = (a, b) => (b.at || 0) - (a.at || 0) || (b.number || 0) - (a.number || 0);

/**
 * True when an fs read failed because the file doesn't exist (the
 * indexed-but-never-written state persistMonth can leave behind) rather
 * than a transport/API failure.
 */
function isMissingFileError(err) {
  const code = err?.code ?? err?.error?.code;
  if (typeof code === 'string' && /does_not_exist|not_found/.test(code)) return true;
  const msg = String(err?.message ?? err?.error?.message ?? '');
  return /no such file|not found|does not exist/i.test(msg);
}

class Store extends EventTarget {
  settings = null;
  products = [];
  categories = [];
  taxes = [];
  discounts = [];
  customers = [];         // lightweight directory: name + how to reach them
  /**
   * Store credit, as an append-only ledger of signed movements. A balance is
   * always derived by adding these up, never stored as a number of its own -
   * a lone figure is one somebody can edit into being, and this is money the
   * shop owes. Each entry names the receipt that caused it.
   */
  credit = [];
  months = [];            // month keys that have a sales file, sorted desc
  drawerMonths = [];      // month keys that have a drawer file, sorted desc
  stockMonths = [];       // month keys that have a stock-movement file, sorted desc
  stocktakeMonths = [];   // month keys that have a posted-stocktake file, sorted desc
  stocktake = null;       // the open counting session, so a sleep costs nothing
  snapshots = [];         // the restore points on file, newest first
  holds = [];             // parked sales, newest first
  draft = null;           // the in-progress cart, so a reload costs nothing
  user = null;
  /** True when init failed against the cloud and the local snapshot booted us. */
  offlineBoot = false;
  #scope = 'anon';
  #bootCacheTimer = null;
  #bootCacheSavedAt = 0;
  #saleCache = new Map(); // monthKey -> receipts (sorted at desc)
  #saleLoading = new Map();
  #drawerCache = new Map();
  #drawerLoading = new Map();
  #stockCache = new Map();
  #stockLoading = new Map();
  #stocktakeCache = new Map();
  #stocktakeLoading = new Map();
  #stocktakeTimer = null;
  #stocktakeFlushedAt = 0;
  #writeQueues = new Map();
  /**
   * Files this session has actually looked at - read, confirmed absent, or
   * parked as damage. Only these may be written blind: a file the index
   * never sent a loader to could hold a history the write would replace.
   */
  #diskConfirmed = new Set();
  #loadGen = 0;           // bumped when the dataset is replaced wholesale
  #draftTimer = null;
  #draftFlushedAt = 0;
  #draftRestored = false;
  /** Account-scoped localStorage key marking when a draft was last spent. */
  #draftSpentKey = 'pos:draft-spent:v1:anon';
  /** Sales finished locally that haven't reached the cloud yet. */
  outbox = new Outbox();
  #syncing = null;
  #syncFailed = false;
  /** True when a post-sale settings/products write failed and needs a retry. */
  #convergeNeeded = false;

  emit(type = 'change') {
    this.dispatchEvent(new Event(type));
    // Whatever just changed is what an offline boot would want to know.
    if (type === 'change') this.#queueBootCache();
  }

  /* ---------- KV helpers (values stored as JSON strings) ---------- */

  /** Keys whose stored value existed but couldn't be parsed this boot. */
  #corruptKv = new Set();

  async #kvGet(key, fallback) {
    const raw = await puter.kv.get(key);
    if (raw === null || raw === undefined) return fallback;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch (err) {
        // Damage, not absence. The value under this key is the only copy of
        // whatever it held (settings carry the currency, the PIN, the logo),
        // so park the bytes under a side key before any ordinary write can
        // cement the loss, and remember which keys must not be auto-seeded.
        console.error(`Unreadable value under ${key}; a copy was preserved`, err);
        this.#corruptKv.add(key);
        puter.kv.set(`${key}:corrupt:${Date.now()}`, raw).catch(() => {});
        return fallback;
      }
    }
    return raw;
  }

  async #kvSet(key, value) {
    if (key !== KV.products) {
      await puter.kv.set(key, JSON.stringify(value));
      return;
    }
    // Any products write built from live state carries every stock move
    // applied so far, so a success settles all debt that existed when the
    // payload was built. (importAll passes a new dataset instead - it also
    // clears the debt outright, so over-settling here is harmless.)
    const settled = this.#stockDebt.map((e) => e.id);
    await puter.kv.set(key, JSON.stringify(value));
    if (settled.length) this.#dropStockDebt(settled);
  }

  /* ---------- Stock debt (moves applied in memory, not yet durable) ---------- */

  /**
   * Tracked stock moves with a completed sale, refund, or void the moment it
   * happens - but the products write that makes the new level durable is
   * fire-and-forget (a sale must not fail because its bookkeeping did), and
   * for an offline sale it doesn't run at all. Without a record, a reload
   * reads the cloud's pre-sale levels and the next converge cements them.
   *
   * Each unsettled move is noted here, in localStorage like the outbox:
   * synchronous, account-scoped, needing no network. init() replays what the
   * freshly loaded products can't know yet; any successful products write
   * settles everything its payload carried.
   */
  #stockDebt = [];
  #stockDebtKey = 'pos:stock-debt:v1:anon';

  #readStockDebt() {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.#stockDebtKey));
      return Array.isArray(parsed)
        ? parsed.filter((e) => e && e.id && Array.isArray(e.deltas))
        : [];
    } catch {
      return [];
    }
  }

  #writeStockDebt() {
    try {
      if (this.#stockDebt.length) {
        localStorage.setItem(this.#stockDebtKey, JSON.stringify(this.#stockDebt));
      } else {
        localStorage.removeItem(this.#stockDebtKey);
      }
    } catch { /* degraded: a reload may then trust the cloud's stale levels */ }
  }

  /** Note the moves `touched` (from #applyStock); returns the note's id. */
  #addStockDebt(touched) {
    if (!touched.length) return null;
    const entry = {
      id: uid(),
      deltas: touched.map(({ productId, delta }) => ({ productId, delta })),
    };
    this.#stockDebt = [...this.#stockDebt, entry];
    this.#writeStockDebt();
    return entry.id;
  }

  #dropStockDebt(ids) {
    const gone = new Set(ids.filter(Boolean));
    if (!this.#stockDebt.some((e) => gone.has(e.id))) return;
    this.#stockDebt = this.#stockDebt.filter((e) => !gone.has(e.id));
    this.#writeStockDebt();
  }

  /** Re-apply moves that a freshly loaded product list doesn't include. */
  #replayStockDebt(entries) {
    for (const e of entries) {
      for (const { productId, delta } of e.deltas) {
        const p = this.product(productId);
        if (!p || p.stock === null || p.stock === undefined) continue;
        p.stock = Math.round((p.stock + (Number(delta) || 0)) * 1000) / 1000;
      }
    }
  }

  /** The KV-backed collections, cheap to snapshot because every edit is a copy. */
  #snapshot() {
    const { settings, products, categories, taxes, discounts, customers, credit } = this;
    return { settings, products, categories, taxes, discounts, customers, credit };
  }

  /**
   * Write the keys a change touched; on failure put those collections back the
   * way `before` had it, tell the UI, and rethrow.
   *
   * An edit is applied locally first so the app answers instantly, but a change
   * the cloud never accepted must not stay on screen looking saved - it would
   * price the next sale off a rate that only exists on this tablet, and quietly
   * revert on the next reload. (Several keys are written together; if one lands
   * and another doesn't, local state still goes back, and a reload reads
   * whatever the cloud actually holds.)
   *
   * Only the collections in `keys` are restored: a sale can complete while a
   * write is in flight, and a failed catalog edit must not drag the receipt
   * counter or stock levels back with it.
   */
  async #commit(before, keys) {
    try {
      await Promise.all(keys.map((key) => this.#kvSet(key, this[KV_FIELD[key]])));
    } catch (err) {
      for (const key of keys) {
        if (key === KV.settings) {
          // A sale that completed while this write was out has already
          // advanced the receipt counter; putting the old value back would
          // hand its number out a second time. The counter only moves up.
          const advanced = Number(this.settings?.nextReceipt) || 0;
          const prior = before.settings;
          this.settings = {
            ...prior,
            nextReceipt: Math.max(advanced, Number(prior?.nextReceipt) || 0),
          };
        } else {
          this[KV_FIELD[key]] = before[KV_FIELD[key]];
        }
      }
      this.emit();
      throw err;
    }
  }

  /* ---------- Init ---------- */

  /**
   * Point everything this device keeps locally at one account.
   *
   * Every one of these is account-scoped for the same reason: a shared
   * browser must not cross one user's sales, spent drafts, stock debt or
   * posted counts with another's. Both boot paths need the whole set, so
   * they share this - listed in two places, the offline path had only the
   * first two and left the other two on the device-global ':anon' key, which
   * is exactly the sharing the scope exists to prevent.
   */
  #useScope(scope) {
    this.#scope = scope;
    this.outbox = new Outbox(scope);
    this.#draftSpentKey = `pos:draft-spent:v1:${scope}`;
    this.#stockDebtKey = `pos:stock-debt:v1:${scope}`;
    this.#stocktakePostedKey = `pos:stocktake-posted:v1:${scope}`;
    this.#snapshotErrorKey = `pos:snapshot-error:v1:${scope}`;
  }

  async init() {
    this.user = await puter.auth.getUser().catch(() => null);
    this.#useScope(this.user?.uuid || this.user?.username || 'anon');
    this.#stockDebt = this.#readStockDebt();
    const [settings, products, categories, taxes, discounts, customers, credit, months, holds, draft, drawers, stockMonths, stocktake, stocktakeMonths, snapshots] = await Promise.all([
      this.#kvGet(KV.settings, null),
      this.#kvGet(KV.products, []),
      this.#kvGet(KV.categories, []),
      this.#kvGet(KV.taxes, []),
      this.#kvGet(KV.discounts, []),
      this.#kvGet(KV.customers, []),
      this.#kvGet(KV.credit, []),
      this.#kvGet(KV.months, []),
      this.#kvGet(KV.holds, []),
      this.#kvGet(KV.draft, null),
      this.#kvGet(KV.drawers, []),
      this.#kvGet(KV.stockMonths, []),
      this.#kvGet(KV.stocktake, null),
      this.#kvGet(KV.stocktakeMonths, []),
      this.#kvGet(KV.snapshots, []),
    ]);

    this.products = Array.isArray(products) ? products.filter((p) => p && p.id) : [];
    // Stock that moved with sales the cloud hasn't been told about yet: the
    // levels just read are pre-sale, and leaving them would let the next
    // converge write the loss in for good.
    if (this.#stockDebt.length) {
      this.#replayStockDebt(this.#stockDebt);
      this.#convergeNeeded = true;
    }
    this.categories = Array.isArray(categories) ? categories.filter((c) => c && c.id) : [];
    this.taxes = Array.isArray(taxes) ? taxes.filter((t) => t && t.id) : [];
    this.discounts = Array.isArray(discounts) ? discounts.filter((d) => d && d.id) : [];
    this.customers = Array.isArray(customers) ? customers.filter((c) => c && c.id && c.name) : [];
    this.credit = Store.#cleanCredit(credit);
    // Every month index is filtered the same way: a key names a file
    // (pos-data/sales-2026-08.json), and this app only ever builds a path
    // out of a shape it designed. The sales index was the one that wasn't,
    // though the offline-boot snapshot filtered it - so a hand-edited or
    // half-written kv value was the one string that reached a path unchecked.
    this.months = Array.isArray(months) ? [...months].filter(isMonthKey).sort().reverse() : [];
    this.drawerMonths = Array.isArray(drawers) ? [...drawers].filter(isMonthKey).sort().reverse() : [];
    this.stockMonths = Array.isArray(stockMonths) ? [...stockMonths].filter(isMonthKey).sort().reverse() : [];
    this.stocktakeMonths = Array.isArray(stocktakeMonths) ? [...stocktakeMonths].filter(isMonthKey).sort().reverse() : [];
    this.snapshots = cleanSnapshots(snapshots);
    this.stocktake = Store.#cleanStocktake(stocktake);
    // A session this device already posted is not an open count: its levels
    // are in, and resuming it would post every variance a second time. (The
    // post path re-checks the month file too, which covers another device.)
    if (this.stocktake && this.#postedStocktakeIds().includes(this.stocktake.id)) {
      this.stocktake = null;
      this.#kvSet(KV.stocktake, null).catch(() => {});
    }
    this.holds = Array.isArray(holds)
      ? holds.filter((h) => h && h.id && Array.isArray(h.lines) && h.lines.length)
      : [];
    this.draft = Store.#cleanDraft(draft);
    // A draft older than the last completed sale on this device is that
    // sale's cart, not an open one: its clearing write never landed (an
    // offline sale, a tab killed mid-write). Restoring it would put already
    // charged items back on the register, inviting a second charge.
    if (this.draft && this.draft.savedAt <= this.#draftSpentAt()) {
      this.draft = null;
      this.#kvSet(KV.draft, null).catch(() => {});
    }
    this.#draftRestored = !!this.draft;

    if (settings && typeof settings === 'object') {
      this.settings = { ...DEFAULT_SETTINGS, ...settings };
      // Self-heal a counter that isn't a number (a hand-edited backup could
      // have planted one): "1001" + 1 would concatenate, not count.
      const counter = Number(this.settings.nextReceipt);
      this.settings.nextReceipt = Number.isFinite(counter) && counter >= 1
        ? Math.round(counter)
        : DEFAULT_SETTINGS.nextReceipt;
    } else {
      this.settings = { ...DEFAULT_SETTINGS };
      // Seeding defaults is for a first run. Over a value that existed but
      // wouldn't parse, it would overwrite the damaged original - the boot
      // runs on defaults either way, but the stored bytes stay put.
      if (!this.#corruptKv.has(KV.settings)) {
        await this.#kvSet(KV.settings, this.settings);
      }
    }

    // A sale queued offline bumped the counter locally, but the settings write
    // that went with it may never have landed. The queue is the record of
    // what was actually issued, so numbering continues from it.
    const queuedTo = this.outbox.maxNumber();
    if (queuedTo >= this.settings.nextReceipt) {
      this.settings = { ...this.settings, nextReceipt: queuedTo + 1 };
    }

    // A month index that existed but wouldn't parse doesn't mean the months
    // are gone - their files are still on disk. Rebuild what the directory
    // can prove (best effort; the damaged value is already parked), or
    // history, reports, and backups would silently read as empty.
    if ([KV.months, KV.drawers, KV.stockMonths, KV.stocktakeMonths].some((k) => this.#corruptKv.has(k))) {
      await this.#rebuildMonthIndexes();
    }

    // A clean read of the cloud is exactly what an offline boot wants later.
    this.#saveBootCache();
  }

  /** Recover month indexes from the data directory's actual file names. */
  async #rebuildMonthIndexes() {
    let names = [];
    try {
      const entries = await puter.fs.readdir(DATA_DIR);
      names = (Array.isArray(entries) ? entries : []).map((e) => String(e?.name ?? ''));
    } catch {
      return;   // can't list: the write-time read-merge still guards the files
    }
    const found = (prefix) => names
      .map((n) => n.match(new RegExp(`^${prefix}-(\\d{4}-(?:0[1-9]|1[0-2]))\\.json$`)))
      .filter(Boolean)
      .map((m) => m[1]);
    const merged = (current, keys) => [...new Set([...current, ...keys])].sort().reverse();
    const heal = async (kvKey, field, prefix) => {
      if (!this.#corruptKv.has(kvKey)) return;
      this[field] = merged(this[field], found(prefix));
      // A repair rebuilt from the files themselves, not a default seeded
      // over damage - the unreadable original is already parked aside.
      if (this[field].length) await this.#kvSet(kvKey, this[field]).catch(() => {});
    };
    await heal(KV.months, 'months', 'sales');
    await heal(KV.drawers, 'drawerMonths', 'drawer');
    await heal(KV.stockMonths, 'stockMonths', 'stock');
    await heal(KV.stocktakeMonths, 'stocktakeMonths', 'stocktake');
  }

  /* ---------- Offline boot (from the local snapshot) ---------- */

  #queueBootCache() {
    const since = Date.now() - this.#bootCacheSavedAt;
    if (since >= BOOT_CACHE_MIN_INTERVAL_MS) {
      this.#saveBootCache();
      return;
    }
    if (this.#bootCacheTimer) return;
    this.#bootCacheTimer = setTimeout(() => {
      this.#bootCacheTimer = null;
      this.#saveBootCache();
    }, BOOT_CACHE_MIN_INTERVAL_MS - since);
  }

  #saveBootCache() {
    if (!this.settings) return;   // nothing worth snapshotting before init
    this.#bootCacheSavedAt = Date.now();
    try {
      localStorage.setItem(BOOT_CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        // The snapshot names its account, so a later offline boot queues
        // sales into the outbox that account's sync will actually drain.
        scope: this.#scope,
        settings: this.settings,
        products: this.products,
        categories: this.categories,
        taxes: this.taxes,
        discounts: this.discounts,
        customers: this.customers,
        credit: this.credit,
        holds: this.holds,
        // The month indexes too: without them an unreachable month would
        // read as empty instead of failing honestly.
        months: this.months,
        drawerMonths: this.drawerMonths,
        stockMonths: this.stockMonths,
        stocktakeMonths: this.stocktakeMonths,
        // The product levels above already carry these moves; an offline
        // boot must replay only debt noted after this snapshot was taken.
        stockDebtIds: this.#stockDebt.map((e) => e.id),
      }));
    } catch { /* offline boot then simply needs a network */ }
  }

  /**
   * Open the register from the last-known local snapshot - the boot path for
   * "the shop's connection is down and the tablet just restarted". History
   * and edits fail honestly (their reads and writes still go to the cloud);
   * selling works, and finished sales queue in the outbox as ever.
   *
   * Returns false when there's no usable snapshot to boot from.
   */
  initFromBootCache() {
    let snap = null;
    try {
      snap = JSON.parse(localStorage.getItem(BOOT_CACHE_KEY));
    } catch {
      return false;
    }
    if (!snap || typeof snap !== 'object' || !snap.settings) return false;

    this.offlineBoot = true;
    this.#useScope(snap.scope || 'anon');
    this.#stockDebt = this.#readStockDebt();

    this.settings = { ...DEFAULT_SETTINGS, ...snap.settings };
    const counter = Number(this.settings.nextReceipt);
    this.settings.nextReceipt = Number.isFinite(counter) && counter >= 1
      ? Math.round(counter)
      : DEFAULT_SETTINGS.nextReceipt;
    this.products = Array.isArray(snap.products) ? snap.products.filter((p) => p && p.id) : [];
    // The snapshot's levels already include the debt it knew about; replay
    // only moves noted after it was written (a sale racing the snapshot's
    // throttle window), and keep converging until the cloud has them all.
    const reflected = new Set(Array.isArray(snap.stockDebtIds) ? snap.stockDebtIds : []);
    const unreflected = this.#stockDebt.filter((e) => !reflected.has(e.id));
    if (unreflected.length) this.#replayStockDebt(unreflected);
    if (this.#stockDebt.length) this.#convergeNeeded = true;
    this.categories = Array.isArray(snap.categories) ? snap.categories.filter((c) => c && c.id) : [];
    this.taxes = Array.isArray(snap.taxes) ? snap.taxes.filter((t) => t && t.id) : [];
    this.discounts = Array.isArray(snap.discounts) ? snap.discounts.filter((d) => d && d.id) : [];
    this.customers = Array.isArray(snap.customers) ? snap.customers.filter((c) => c && c.id && c.name) : [];
    // Balances are read-only offline (spending credit needs a connection, or
    // the movement would live on this device alone), but a cashier still has
    // to be able to see what a regular is owed.
    this.credit = Store.#cleanCredit(snap.credit);
    this.holds = Array.isArray(snap.holds)
      ? snap.holds.filter((h) => h && h.id && Array.isArray(h.lines) && h.lines.length)
      : [];
    this.months = Array.isArray(snap.months) ? [...snap.months].filter(isMonthKey).sort().reverse() : [];
    this.drawerMonths = Array.isArray(snap.drawerMonths) ? [...snap.drawerMonths].filter(isMonthKey).sort().reverse() : [];
    this.stockMonths = Array.isArray(snap.stockMonths) ? [...snap.stockMonths].filter(isMonthKey).sort().reverse() : [];
    this.stocktakeMonths = Array.isArray(snap.stocktakeMonths) ? [...snap.stocktakeMonths].filter(isMonthKey).sort().reverse() : [];
    // The kv draft is unreachable; better an empty register than a guess.
    this.draft = null;
    this.#draftRestored = false;
    // Same for a counting session: it lives in kv, and a count that can't be
    // saved as it goes is worse than one started again with a connection.
    this.stocktake = null;

    const queuedTo = this.outbox.maxNumber();
    if (queuedTo >= this.settings.nextReceipt) {
      this.settings = { ...this.settings, nextReceipt: queuedTo + 1 };
    }
    return true;
  }

  /**
   * Forget this device's offline copy. Sign-out calls it: the snapshot holds
   * the whole store - settings with the PIN record, the catalog, every
   * customer's name and number - under a device-global key, and must not
   * outlive the account that wrote it, or the next signed-in user's first
   * offline boot would open someone else's shop.
   */
  clearBootCache() {
    clearTimeout(this.#bootCacheTimer);
    this.#bootCacheTimer = null;
    try {
      localStorage.removeItem(BOOT_CACHE_KEY);
    } catch { /* storage unavailable - nothing lives there either */ }
  }

  async updateSettings(patch) {
    const before = this.#snapshot();
    this.settings = { ...this.settings, ...patch };
    this.emit();
    await this.#commit(before, [KV.settings]);
  }

  /* ---------- Catalog ---------- */

  product(id) {
    return this.products.find((p) => p.id === id) || null;
  }

  /**
   * The catalog in the order the register shows it: the arrangement a shop
   * made, then everything it hasn't touched, oldest first.
   *
   * `sortOrder` is absent until somebody arranges the grid, and a product
   * added afterwards has none either - which is exactly what "new products
   * land at the end, never displacing an arrangement someone made" means.
   * Ties fall back to creation order, so the sequence is total and stable.
   */
  productsInOrder() {
    return this.products
      .map((p, i) => ({ p, i }))
      .sort((a, b) => {
        const ao = Number.isFinite(Number(a.p.sortOrder)) ? Number(a.p.sortOrder) : Infinity;
        const bo = Number.isFinite(Number(b.p.sortOrder)) ? Number(b.p.sortOrder) : Infinity;
        if (ao !== bo) return ao - bo;
        return (a.p.createdAt || 0) - (b.p.createdAt || 0) || a.i - b.i;
      })
      .map(({ p }) => p);
  }

  /**
   * Rearrange the grid. `ids` is the new relative order of *some* products -
   * whatever the register was showing when the tile was dragged, which may be
   * one category out of six.
   *
   * The positions those products occupy in the whole order are reused in
   * place, so an arrangement made inside a category leaves every other
   * product exactly where it was, and the same drag reads correctly under
   * "All" too. Every product is then stamped with an explicit `sortOrder`:
   * the order stops depending on array position, so it survives a backup, a
   * restore, and an import that appends.
   */
  async reorderProducts(ids) {
    const wanted = (Array.isArray(ids) ? ids : []).filter((id) => this.product(id));
    if (!wanted.length) return;
    const ordered = this.productsInOrder();
    const moving = new Set(wanted);
    const slots = [];
    ordered.forEach((p, i) => { if (moving.has(p.id)) slots.push(i); });
    // A caller that named a product twice would leave a hole in the order.
    if (slots.length !== wanted.length) throw new Error('That arrangement doesn’t match the catalog.');
    const next = [...ordered];
    wanted.forEach((id, k) => { next[slots[k]] = this.product(id); });

    const order = new Map(next.map((p, i) => [p.id, i]));
    const before = this.#snapshot();
    this.products = this.products.map((p) => (p.sortOrder === order.get(p.id)
      ? p
      : { ...p, sortOrder: order.get(p.id) }));
    this.emit();
    // An arrangement left on screen by a failed write would be gone at the
    // next reload, with the cashier's muscle memory pointing at the old grid.
    await this.#commit(before, [KV.products]);
  }

  /**
   * Pin a product to the Favorites chip, or unpin it. Its own write, because
   * it is the one arrangement a cashier makes mid-shift and it must not carry
   * a half-finished form's fields along with it.
   */
  async setFavorite(id, favorite) {
    const product = this.product(id);
    if (!product) return null;
    const before = this.#snapshot();
    const next = { ...product, favorite: !!favorite };
    this.products = this.products.map((p) => (p.id === id ? next : p));
    this.emit();
    await this.#commit(before, [KV.products]);
    return next;
  }

  category(id) {
    return this.categories.find((c) => c.id === id) || null;
  }

  /**
   * Option groups, sanitized. A group without a name or without any usable
   * choice is dropped rather than stored half-built - the register would have
   * nothing to ask. Deltas may be negative (a smaller size costs less).
   */
  static #cleanOptions(list) {
    const out = [];
    for (const group of (Array.isArray(list) ? list : []).slice(0, MAX_OPTION_GROUPS)) {
      const name = String(group?.name || '').trim();
      const choices = (Array.isArray(group?.choices) ? group.choices : [])
        .slice(0, MAX_OPTION_CHOICES)
        .map((c) => ({
          id: c?.id || uid(),
          name: String(c?.name || '').trim(),
          // Clamped like every typed amount: a delta beyond MAX_AMOUNT would
          // put the line's cents outside the exact-integer range.
          delta: clamp(round2(Number(c?.delta) || 0), -MAX_AMOUNT, MAX_AMOUNT),
        }))
        .filter((c) => c.name);
      if (!name || !choices.length) continue;
      out.push({
        id: group.id || uid(),
        name,
        required: !!group.required,
        multi: !!group.multi,
        choices,
      });
    }
    return out;
  }

  /**
   * A cost price, or null. Zero is a real cost (a giveaway, a comp); an empty
   * field is the absence of one, and the two must not collapse - Number('')
   * is 0, which would report a 100% margin on every uncosted product.
   */
  static #cleanCost(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.min(round2(n), MAX_AMOUNT);
  }

  static #cleanProduct(input) {
    // Sold by the each (default) or by a measure - weight, volume, length.
    // Measured products price per unit and take decimal quantities; their
    // option groups are dropped: a per-kilo price delta has no honest answer
    // at the register, and the form hides the editor for them.
    const soldBy = input.soldBy === 'measure' ? 'measure' : 'each';
    const out = {
      name: String(input.name || '').trim(),
      price: round2(Math.abs(Number(input.price) || 0)),
      // What the shop pays for it, snapshotted onto every line it sells.
      // Optional throughout: null means "not recorded", which reports and
      // exports carry as unknown rather than as free.
      cost: Store.#cleanCost(input.cost),
      categoryId: input.categoryId || null,
      // Long enough for any code a shop actually scans (GS1 digital links
      // included), short enough that a QR holding a whole vCard can't land
      // kilobytes in the hot products entry. The form and the camera path
      // cap at the same figure, so a stored SKU always equals its scan.
      sku: String(input.sku || '').trim().slice(0, 128),
      taxId: input.taxId ?? null,   // null = default tax, 'none' = tax-free
      slot: PRODUCT_SLOTS.includes(input.slot) ? input.slot : 1,
      soldBy,
      unit: soldBy === 'measure' ? (String(input.unit || '').trim().slice(0, 12) || 'unit') : '',
      // The photo's version stamp (set by setProductPhoto); the file itself
      // lives in fs. Callers pass the current value through on edits.
      photo: Number(input.photo) || null,
      // Always written, so clearing a product's options actually clears them
      // (updateProduct merges, and a missing key would keep the old value).
      options: soldBy === 'measure' ? [] : Store.#cleanOptions(input.options),
    };
    const stock = Number(input.stock);
    out.stock = input.trackStock && Number.isFinite(stock)
      ? (soldBy === 'measure' ? Math.round(stock * 1000) / 1000 : Math.round(stock))
      : null;
    // Per-product low-stock threshold; null = the app default. Kept only
    // while stock is tracked, like the count itself.
    const low = Number(input.lowStock);
    out.lowStock = input.trackStock && Number.isFinite(low) && low >= 0
      ? (soldBy === 'measure' ? Math.round(low * 1000) / 1000 : Math.round(low))
      : null;
    return out;
  }

  async addProduct(input) {
    const before = this.#snapshot();
    const product = { id: uid(), createdAt: Date.now(), ...Store.#cleanProduct(input) };
    this.products = [...this.products, product];
    this.emit();
    // A product left on the grid by a failed write could be rung up, putting a
    // productId on the receipt that nothing in the catalog will ever match.
    await this.#commit(before, [KV.products]);
    return product;
  }

  async updateProduct(id, input) {
    const existing = this.product(id);
    if (!existing) return null;
    const before = this.#snapshot();
    const next = { ...existing, ...Store.#cleanProduct(input) };
    this.products = this.products.map((p) => (p.id === id ? next : p));
    this.emit();
    await this.#commit(before, [KV.products]);
    return next;
  }

  /**
   * Apply a product-import plan (lib/product-csv.js planned it, and the
   * preview already said exactly this) in one commit: the categories the file
   * named that don't exist yet, every new product, and every matched one
   * updated in place.
   *
   * One write per collection, rolled back together on failure - a catalog
   * half-replaced by a spreadsheet is not a state anyone can reason about,
   * and the shopkeeper would have no way to tell which half landed.
   */
  async importProducts({ creates = [], updates = [], newCategories = [] } = {}) {
    if (!creates.length && !updates.length) throw new Error('Nothing to import.');
    // A bulk price change that turns out wrong is exactly what a restore
    // point is for; taken before the catalog is touched.
    await this.autoSnapshot('import');
    if (this.products.length + creates.length > MAX_PRODUCTS) {
      throw new Error(`A catalog holds up to ${MAX_PRODUCTS.toLocaleString()} products.`);
    }
    const before = this.#snapshot();
    const keys = [KV.products];

    /* ---- categories named by the file ---- */
    const byName = new Map(this.categories.map((c) => [String(c.name).trim().toLowerCase(), c]));
    const made = [];
    for (const name of newCategories) {
      const clean = String(name || '').trim().slice(0, 60);
      const key = clean.toLowerCase();
      if (!clean || byName.has(key)) continue;
      const cat = { id: uid(), name: clean };
      byName.set(key, cat);
      made.push(cat);
    }
    if (made.length) {
      this.categories = [...this.categories, ...made];
      keys.push(KV.categories);
    }
    /** A patch names its category by name when the category is new. */
    const resolve = (patch) => {
      const { categoryName, ...rest } = patch;
      if (!categoryName) return rest;
      const cat = byName.get(String(categoryName).trim().toLowerCase());
      return { ...rest, categoryId: cat?.id ?? null };
    };

    /**
     * Tile color by category, so an imported catalog arrives looking like one
     * a person arranged rather than three hundred identical tiles. Products
     * with no category cycle the palette as the form's own default does.
     */
    const slotFor = (categoryId, i) => {
      const at = categoryId ? this.categories.findIndex((c) => c.id === categoryId) : -1;
      return PRODUCT_SLOTS[(at >= 0 ? at : this.products.length + i) % PRODUCT_SLOTS.length];
    };

    const now = Date.now();
    const added = creates.map(({ patch }, i) => {
      const input = resolve(patch);
      return {
        id: uid(),
        createdAt: now,
        ...Store.#cleanProduct({ slot: slotFor(input.categoryId, i), ...input }),
      };
    });

    const patched = new Map();
    for (const { id, patch } of updates) {
      const existing = this.product(id);
      // Deleted from another tab while the preview was open: an update with
      // nowhere to land is dropped, not resurrected as a new product.
      if (!existing) continue;
      patched.set(id, {
        ...existing,
        ...Store.#cleanProduct({
          ...existing,
          trackStock: existing.stock !== null && existing.stock !== undefined,
          // Number(null) is 0: a product with no threshold must not come
          // back alerting at zero.
          lowStock: existing.lowStock ?? NaN,
          ...resolve(patch),
        }),
      });
    }

    this.products = [...this.products.map((p) => patched.get(p.id) || p), ...added];
    this.emit();
    await this.#commit(before, keys);
    return { created: added.length, updated: patched.size, categories: made.length };
  }

  /** Receipts keep their own copies of name/price, so history survives. */
  async deleteProduct(id) {
    const target = this.product(id);
    const at = this.products.findIndex((p) => p.id === id);
    const before = this.#snapshot();
    this.products = this.products.filter((p) => p.id !== id);
    this.emit();
    // Rolls the optimistic removal back if the write fails - the cloud still
    // has the product.
    await this.#commit(before, [KV.products]);
    // The photo file waits out the undo window, then goes too - best effort,
    // and re-checked at fire time: the toast pauses its clock under a hover,
    // so a very late undo (or a restore that brought the product back) must
    // find the picture still there rather than a dangling stamp.
    const photoFile = photoPath(id);
    const purge = target?.photo && photoFile
      ? setTimeout(() => {
        if (!this.product(id)) puter.fs.delete(photoFile).catch(() => {});
      }, PHOTO_PURGE_DELAY_MS)
      : null;
    return {
      undo: async () => {
        if (purge) clearTimeout(purge);
        // Only the deleted product comes back. Restoring the pre-delete
        // snapshot wholesale would resurrect every product deleted since
        // (two stacked delete toasts, undo the first) and erase any added
        // while the toast lingered.
        if (!target || this.product(id)) return;
        const undoFrom = this.#snapshot();
        const next = [...this.products];
        next.splice(Math.min(at, next.length), 0, target);
        this.products = next;
        this.emit();
        await this.#commit(undoFrom, [KV.products]);
      },
    };
  }

  /**
   * Put a (pre-downscaled) photo on a product. The file lands first; only
   * then does the catalog point at it, stamped with a version so the
   * in-session image cache knows a replacement from the old picture.
   */
  async setProductPhoto(id, blob) {
    const product = this.product(id);
    if (!product) throw new Error('That product is no longer here.');
    const path = photoPath(id);
    if (!path) throw new Error('This product can’t hold a photo.');
    await puter.fs.write(path, blob, { createMissingParents: true });
    const before = this.#snapshot();
    this.products = this.products.map((p) => (p.id === id ? { ...p, photo: Date.now() } : p));
    this.emit();
    await this.#commit(before, [KV.products]);
    return this.product(id);
  }

  /** The catalog stops pointing at the photo; the file delete is best effort. */
  async removeProductPhoto(id) {
    const before = this.#snapshot();
    this.products = this.products.map((p) => (p.id === id ? { ...p, photo: null } : p));
    this.emit();
    await this.#commit(before, [KV.products]);
    const path = photoPath(id);
    if (path) puter.fs.delete(path).catch(() => {});
  }

  /**
   * The photo blob for a product, or null when there is no file. A read
   * that failed to *reach* the file throws instead: callers must be able
   * to tell "no picture" (cacheable) from "can't fetch it right now"
   * (worth retrying once the connection is back).
   */
  async readProductPhoto(product) {
    if (!product?.photo) return null;
    const path = photoPath(product.id);
    if (!path) return null;
    try {
      return await puter.fs.read(path);
    } catch (err) {
      if (isMissingFileError(err)) return null;
      throw err;
    }
  }

  async addCategory(name) {
    const cat = { id: uid(), name: String(name || '').trim() };
    if (!cat.name) return null;
    const before = this.#snapshot();
    this.categories = [...this.categories, cat];
    this.emit();
    await this.#commit(before, [KV.categories]);
    return cat;
  }

  async renameCategory(id, name) {
    const clean = String(name || '').trim();
    if (!clean) return;
    const before = this.#snapshot();
    this.categories = this.categories.map((c) => (c.id === id ? { ...c, name: clean } : c));
    this.emit();
    await this.#commit(before, [KV.categories]);
  }

  /** Products in the deleted category become uncategorized, not deleted. */
  async deleteCategory(id) {
    const before = this.#snapshot();
    this.categories = this.categories.filter((c) => c.id !== id);
    const orphaned = this.products.some((p) => p.categoryId === id);
    if (orphaned) {
      this.products = this.products.map((p) => (p.categoryId === id ? { ...p, categoryId: null } : p));
    }
    this.emit();
    await this.#commit(before, orphaned ? [KV.categories, KV.products] : [KV.categories]);
  }

  /* ---------- Taxes ---------- */

  tax(id) {
    return this.taxes.find((t) => t.id === id) || null;
  }

  static #cleanRate(rate) {
    const r = Number(rate);
    if (!Number.isFinite(r) || r < 0) return 0;
    return Math.round(r * 1000) / 1000;
  }

  async addTax({ name, rate }) {
    const tax = { id: uid(), name: String(name || '').trim() || 'Tax', rate: Store.#cleanRate(rate) };
    const before = this.#snapshot();
    this.taxes = [...this.taxes, tax];
    const keys = [KV.taxes];
    // The first rate created becomes the default - the common single-rate case.
    if (!this.settings.defaultTaxId) {
      this.settings = { ...this.settings, defaultTaxId: tax.id };
      keys.push(KV.settings);
    }
    this.emit();
    // A rate that didn't save would still be charged on the next sale, and be
    // gone by the time anyone checked the receipt against it.
    await this.#commit(before, keys);
    return tax;
  }

  async updateTax(id, { name, rate }) {
    const before = this.#snapshot();
    this.taxes = this.taxes.map((t) => (t.id === id
      ? { ...t, name: String(name || '').trim() || t.name, rate: Store.#cleanRate(rate) }
      : t));
    this.emit();
    await this.#commit(before, [KV.taxes]);
  }

  /** Products pointing at the deleted rate fall back to the default. */
  async deleteTax(id) {
    const before = this.#snapshot();
    this.taxes = this.taxes.filter((t) => t.id !== id);
    const keys = [KV.taxes];
    if (this.products.some((p) => p.taxId === id)) {
      this.products = this.products.map((p) => (p.taxId === id ? { ...p, taxId: null } : p));
      keys.push(KV.products);
    }
    if (this.settings.defaultTaxId === id) {
      this.settings = { ...this.settings, defaultTaxId: this.taxes[0]?.id || null };
      keys.push(KV.settings);
    }
    this.emit();
    await this.#commit(before, keys);
  }

  /**
   * The tax a product line charges: its own assignment when set ('none'
   * means tax-free), otherwise the store default. Null = no tax.
   */
  taxFor(product) {
    if (product?.taxId === 'none') return null;
    const own = product?.taxId ? this.tax(product.taxId) : null;
    return own || this.tax(this.settings.defaultTaxId) || null;
  }

  /* ---------- Discount presets ---------- */

  async addDiscount({ name, type, value }) {
    const v = Math.abs(Number(value) || 0);
    const d = {
      id: uid(),
      name: String(name || '').trim() || 'Discount',
      type: type === 'fixed' ? 'fixed' : 'percent',
      value: type === 'percent' ? Math.min(100, v) : round2(v),
    };
    const before = this.#snapshot();
    this.discounts = [...this.discounts, d];
    this.emit();
    await this.#commit(before, [KV.discounts]);
    return d;
  }

  async deleteDiscount(id) {
    const before = this.#snapshot();
    this.discounts = this.discounts.filter((d) => d.id !== id);
    this.emit();
    await this.#commit(before, [KV.discounts]);
  }

  /* ---------- Customers (lightweight directory) ---------- */

  customer(id) {
    return this.customers.find((c) => c.id === id) || null;
  }

  static #cleanCustomer(input) {
    return {
      name: String(input.name || '').trim().slice(0, 60),
      phone: String(input.phone || '').trim().slice(0, 30),
      email: String(input.email || '').trim().slice(0, 80),
      note: String(input.note || '').trim().slice(0, 120),
    };
  }

  async addCustomer(input) {
    const clean = Store.#cleanCustomer(input);
    if (!clean.name) throw new Error('A customer needs a name.');
    const customer = { id: uid(), createdAt: Date.now(), ...clean };
    const before = this.#snapshot();
    this.customers = [...this.customers, customer];
    this.emit();
    await this.#commit(before, [KV.customers]);
    return customer;
  }

  async updateCustomer(id, input) {
    const existing = this.customer(id);
    if (!existing) return null;
    const clean = Store.#cleanCustomer(input);
    if (!clean.name) throw new Error('A customer needs a name.');
    const before = this.#snapshot();
    const next = { ...existing, ...clean };
    this.customers = this.customers.map((c) => (c.id === id ? next : c));
    this.emit();
    await this.#commit(before, [KV.customers]);
    return next;
  }

  /**
   * Receipts keep their own copy of the name, so history survives this.
   *
   * A balance does not. Store credit is money the shop owes, and it is
   * spendable only by the customer holding it: deleting them stranded it -
   * unspendable at the till, invisible on every page, and still inside the
   * liability Reports adds up, which then read "$8.00 owed to 0 customers".
   * The way out is one movement in the ledger (Adjust → Take off), which
   * also leaves a record of the write-off; a delete that quietly swallowed
   * the money would leave none. Any currency counts - credit issued before
   * a currency change is still owed.
   */
  async deleteCustomer(id) {
    if (this.creditByCurrency(id).length) {
      throw new Error('That customer still holds store credit. Take the balance off first.');
    }
    const before = this.#snapshot();
    this.customers = this.customers.filter((c) => c.id !== id);
    this.emit();
    await this.#commit(before, [KV.customers]);
  }

  /* ---------- Store credit (a liability, moved only by its ledger) ---------- */

  /** Ledger entries, sanitized. Junk would poison every balance derived. */
  static #cleanCredit(list) {
    return (Array.isArray(list) ? list : [])
      .filter((e) => e && e.id && e.customerId && Number.isFinite(Number(e.amount)))
      .map((e) => ({
        id: String(e.id),
        at: Number(e.at) || 0,
        customerId: String(e.customerId),
        type: CREDIT_TYPES.includes(e.type) ? e.type : 'adjusted',
        // Signed: positive puts credit on the balance, negative takes it off.
        amount: clamp(round2(Number(e.amount)), -MAX_AMOUNT, MAX_AMOUNT),
        currency: String(e.currency || '').slice(0, 8),
        receiptId: e.receiptId ? String(e.receiptId) : null,
        // Number(null) is 0, and a movement with no receipt behind it would
        // then claim receipt #0 on the customer's page.
        receiptNumber: e.receiptNumber === null || e.receiptNumber === undefined
          || !Number.isFinite(Number(e.receiptNumber))
          ? null
          : Number(e.receiptNumber),
        note: String(e.note || '').trim().slice(0, 80),
      }));
  }

  /**
   * One customer's movements, newest first. Two entries can share a
   * millisecond - a refund to credit and the correction somebody makes
   * straight after - so the ledger's own append order breaks the tie. It is
   * append-only, which makes that order the true one.
   */
  creditEntries(customerId) {
    return this.credit
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.customerId === customerId)
      .sort((a, b) => (b.e.at || 0) - (a.e.at || 0) || b.i - a.i)
      .map(({ e }) => e);
  }

  /**
   * What a customer has to spend, in the currency the shop is selling in.
   *
   * Credit issued before a currency change is not spendable at today's prices
   * without inventing an exchange rate, so each entry keeps the currency it
   * was made in and only matching ones are added up. `creditByCurrency` shows
   * the rest, so nothing is hidden - it simply isn't offered at the till.
   */
  creditBalance(customerId, currency = this.settings?.currency) {
    let cents = 0;
    for (const e of this.credit) {
      if (e.customerId !== customerId) continue;
      if ((e.currency || currency) !== currency) continue;
      cents += toCents(e.amount);
    }
    return fromCents(cents);
  }

  /** Every currency a customer holds credit in: [{ currency, amount }]. */
  creditByCurrency(customerId) {
    const out = new Map();
    for (const e of this.credit) {
      if (e.customerId !== customerId) continue;
      const cur = e.currency || this.settings?.currency || 'USD';
      out.set(cur, (out.get(cur) || 0) + toCents(e.amount));
    }
    return [...out.entries()]
      .map(([currency, cents]) => ({ currency, amount: fromCents(cents) }))
      .filter((row) => row.amount !== 0)
      .sort((a, b) => b.amount - a.amount);
  }

  /**
   * What the shop owes, in one currency: the positive balances added up.
   *
   * Never the plain sum of the ledger - one customer overdrawn (a correction
   * posted after the credit was spent) would quietly cancel out what another
   * is genuinely owed, and understate the liability.
   *
   * Read off the directory, exactly as creditHolders is: the two figures sit
   * side by side in Reports ("owed to N customers now"), so they must count
   * the same people. Summed over the ledger instead, entries belonging to
   * nobody - a legacy delete, a hand-edited backup - were money owed to no
   * customer at all.
   */
  outstandingCredit(currency = this.settings?.currency) {
    let cents = 0;
    for (const customer of this.customers) {
      const balance = toCents(this.creditBalance(customer.id, currency));
      if (balance > 0) cents += balance;
    }
    return fromCents(cents);
  }

  /** Customers holding a balance, biggest first - what the shop owes, to whom. */
  creditHolders(currency = this.settings?.currency) {
    return this.customers
      .map((c) => ({ customer: c, balance: this.creditBalance(c.id, currency) }))
      .filter((row) => row.balance !== 0)
      .sort((a, b) => b.balance - a.balance);
  }

  /**
   * File one movement. The ledger is append-only: a correction is another
   * entry, never an edit, so what happened stays readable.
   */
  async #appendCredit(entry) {
    const before = this.#snapshot();
    this.credit = [...this.credit, entry];
    this.emit();
    await this.#commit(before, [KV.credit]);
    return entry;
  }

  /**
   * Issue or take back credit by hand: the goodwill gesture, and the
   * correction. `amount` is signed - positive adds to the balance.
   */
  async adjustCredit({ customerId, amount, note = '' }) {
    const customer = this.customer(customerId);
    if (!customer) throw new Error('That customer is no longer here.');
    const value = round2(Number(amount) || 0);
    if (!value) throw new Error('Enter an amount.');
    if (Math.abs(value) > MAX_AMOUNT) throw new Error('That amount is too large.');
    // Nothing stops a balance going negative in the ledger's arithmetic, but
    // a manual deduction that overdraws is a mistake being made out loud.
    const balance = this.creditBalance(customerId);
    if (value < 0 && toCents(-value) > toCents(balance)) {
      throw new Error('That is more than the balance.');
    }
    return this.#appendCredit({
      id: uid(),
      at: Date.now(),
      customerId,
      type: 'adjusted',
      amount: value,
      currency: this.settings.currency,
      receiptId: null,
      receiptNumber: null,
      note: String(note || '').trim().slice(0, 80),
    });
  }

  /* ---------- Held sales (parked orders) + the in-progress cart ---------- */

  hold(id) {
    return this.holds.find((h) => h.id === id) || null;
  }

  /**
   * Park a cart. Raw lines are stored, never computed totals, so computeCart
   * stays the single source of truth when the sale is picked back up - a
   * price or tax edit in between can't corrupt it.
   */
  async addHold({ label = '', name = '', lines, orderDiscount = null }) {
    if (!Array.isArray(lines) || !lines.length) throw new Error('Nothing to hold.');
    if (this.holds.length >= MAX_HOLDS) throw new Error('Too many held sales.');
    const hold = {
      id: uid(),
      label: String(label || '').trim(),
      name: String(name || '').trim(),
      createdAt: Date.now(),
      lines: structuredClone(lines),
      orderDiscount: orderDiscount ? { ...orderDiscount } : null,
    };
    const prev = this.holds;
    this.holds = [hold, ...prev];
    this.emit();
    try {
      await this.#kvSet(KV.holds, this.holds);
    } catch (err) {
      this.holds = prev;
      this.emit();
      throw err;
    }
    return hold;
  }

  async removeHold(id) {
    const prev = this.holds;
    const target = prev.find((h) => h.id === id);
    if (!target) return null;
    this.holds = prev.filter((h) => h.id !== id);
    this.emit();
    try {
      await this.#kvSet(KV.holds, this.holds);
    } catch (err) {
      this.holds = prev;
      this.emit();
      throw err;
    }
    return target;
  }

  static #cleanDraft(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.lines) || !d.lines.length) return null;
    const draft = {
      lines: d.lines,
      orderDiscount: d.orderDiscount || null,
      savedAt: Number(d.savedAt) || Date.now(),
    };
    // Who the sale is for. Kept with the cart because a reward being cashed
    // in belongs to somebody: restored apart, the register hands the free
    // item over and the receipt names nobody to take the stamp off.
    if (d.customerId) draft.customerId = String(d.customerId);
    // A loyalty reward being cashed in is part of the sale in progress: the
    // discount is already on a line, and without this the reload that
    // restored the cart would charge nothing for the free coffee *and* leave
    // the customer's card unspent, ready to be redeemed a second time.
    const r = d.redeeming;
    if (r && (r.kind === 'stamps' || r.kind === 'spend')) {
      draft.redeeming = {
        kind: r.kind,
        name: String(r.name || '').trim().slice(0, 40),
        ...(r.kind === 'stamps' ? { lineIndex: Math.max(0, Math.round(Number(r.lineIndex) || 0)) } : {}),
      };
    }
    return draft;
  }

  /**
   * True the first time it's asked, and only when init() found a cart left
   * over from a previous run - the register uses it to say so once.
   */
  consumeRestoredDraft() {
    const restored = this.#draftRestored;
    this.#draftRestored = false;
    return restored;
  }

  /**
   * Remember the in-progress cart (null clears it). Safe to call on every
   * keystroke-level change: local state updates at once and the write is
   * throttled. Failures are swallowed - the cart is still on screen, and a
   * toast per missed autosave would be noise.
   */
  queueDraft(draft) {
    this.draft = draft ? { ...draft, savedAt: Date.now() } : null;
    const since = Date.now() - this.#draftFlushedAt;
    if (since >= DRAFT_MIN_INTERVAL_MS) {
      this.flushDraft();
      return;
    }
    if (this.#draftTimer) return;
    this.#draftTimer = setTimeout(() => this.flushDraft(), DRAFT_MIN_INTERVAL_MS - since);
  }

  /** When a draft was last spent by a completed sale on this device, or 0. */
  #draftSpentAt() {
    try {
      return Number(localStorage.getItem(this.#draftSpentKey)) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * The cart being sold *is* the open draft. Its KV copy is cleared with the
   * other bookkeeping, but that write can fail silently (the sale itself may
   * be completing offline) - so the spend is also recorded in localStorage,
   * which needs no network, and init() refuses any draft that isn't newer.
   */
  #spendDraft(at) {
    clearTimeout(this.#draftTimer);
    this.#draftTimer = null;
    this.draft = null;
    try {
      localStorage.setItem(this.#draftSpentKey, String(at));
    } catch { /* the KV clear below still covers the common case */ }
    this.#kvSet(KV.draft, null).catch(() => {});
  }

  /** Write the draft now (also called on page hide). */
  flushDraft() {
    clearTimeout(this.#draftTimer);
    this.#draftTimer = null;
    this.#draftFlushedAt = Date.now();
    return this.#kvSet(KV.draft, this.draft).catch((err) => {
      // Being offline is an expected state for a register, and the cart is
      // still on screen; only log something that isn't just the network.
      if (!isTransportError(err)) console.error(err);
    });
  }

  /* ---------- Sales ---------- */

  async loadMonth(key) {
    if (this.#saleCache.has(key)) return this.#saleCache.get(key);
    if (this.#saleLoading.has(key)) return this.#saleLoading.get(key);
    const gen = this.#loadGen;
    const load = (async () => {
      let sales = [];
      if (this.months.includes(key)) {
        try {
          const blob = await puter.fs.read(monthPath(key));
          const text = await blob.text();
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch { /* damage - handled with the wrong-shape case below */ }
          if (Array.isArray(parsed)) {
            // Junk entries (a hand-edited file) would crash every read below.
            sales = parsed.filter((s) => s && s.id);
          } else {
            // Damaged, not unreachable - a truncated file, or valid JSON
            // that isn't the array this app writes (a hand-wrapped
            // {"sales": [...]}). A register that refuses to sell (or to
            // drain its outbox) over one bad file is worse than a month
            // that reads empty - but never over the only copy: the bytes
            // are parked first, and if even that fails the damage
            // propagates rather than being overwritten.
            const damage = new Error(`Unreadable ${monthPath(key)}`);
            console.error(`Unreadable ${monthPath(key)}; preserving a copy`);
            try {
              await puter.fs.write(`${monthPath(key)}.corrupt-${Date.now()}`, text, { createMissingParents: true });
            } catch {
              throw damage;
            }
          }
        } catch (err) {
          // Indexed-but-never-written reads as empty; anything else must
          // propagate - caching [] over a transport error would let the next
          // sale overwrite the month's real file.
          if (!isMissingFileError(err)) throw err;
        }
        this.#diskConfirmed.add(`sales:${key}`);
      }
      // Sales queued offline are real sales: they belong in history the moment
      // they're rung up, marked as not yet synced, reload or no reload.
      const known = new Set(sales.map((s) => s.id));
      for (const pending of this.outbox.forMonth(key)) {
        if (!known.has(pending.id)) sales.push({ ...pending, pendingSync: true });
      }
      sales.sort(byNewest);
      if (gen === this.#loadGen && !this.#saleCache.has(key)) this.#saleCache.set(key, sales);
      return this.#saleCache.get(key) ?? sales;
    })().finally(() => this.#saleLoading.delete(key));
    this.#saleLoading.set(key, load);
    return load;
  }

  /**
   * Every month that holds sales: the indexed files, plus any month that only
   * exists in the outbox. The first sale of a new month rung up during an
   * outage has no file yet - it is still a sale, and a report or a drawer
   * count that leaves it out is simply wrong. Newest first.
   */
  monthsWithSales() {
    const keys = new Set([...this.months, ...this.outbox.months()]);
    return [...keys].sort().reverse();
  }

  /**
   * A customer's receipts, newest first, gathered from the month files the
   * same way reports read them. Scans up to `monthsToScan` recent months per
   * call; `fromMonth` continues an earlier scan. Returns what it found plus
   * where to continue, so the UI can offer "look further back" honestly.
   */
  async salesForCustomer(customerId, { monthsToScan = 6, fromMonth = 0 } = {}) {
    const keys = this.monthsWithSales().slice(fromMonth, fromMonth + monthsToScan);
    const lists = await Promise.all(keys.map((k) => this.loadMonth(k)));
    return {
      sales: lists.flat().filter((s) => s.customerId === customerId).sort(byNewest),
      nextMonth: fromMonth + keys.length,
      exhausted: fromMonth + keys.length >= this.monthsWithSales().length,
    };
  }

  /** Receipts with fromISO <= date <= toISO, newest first. */
  async salesInRange(fromISO, toISO) {
    const known = new Set(this.monthsWithSales());
    const keys = monthKeysInRange(fromISO, toISO).filter((k) => known.has(k));
    const lists = await Promise.all(keys.map((k) => this.loadMonth(k)));
    return lists.flat()
      .filter((s) => s.date >= fromISO && s.date <= toISO)
      .sort(byNewest);
  }

  /** Serialize writes per month file so rapid sales can't clobber each other. */
  #queueWrite(key, fn) {
    const prev = this.#writeQueues.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    this.#writeQueues.set(key, next);
    return next;
  }

  /**
   * Before the first write this session to a file no loader was ever sent
   * to, look at what is actually there. The loaders trust the month
   * indexes; a lost or unparseable index made them skip the read, and the
   * write that followed replaced a whole file of history with today's one
   * record. Anything readable that this session doesn't hold is folded
   * into `cached` in place (so views and every later write keep it);
   * damage is parked exactly as the loaders park it; a file that can't be
   * seen at all keeps its bytes - the error propagates instead of the
   * write. Runs inside the file's write queue.
   */
  async #absorbUnreadFile(tag, path, cached, idOf, sort) {
    if (this.#diskConfirmed.has(tag)) return;
    let text = null;
    try {
      const blob = await puter.fs.read(path);
      text = await blob.text();
    } catch (err) {
      if (!isMissingFileError(err)) throw err;
      this.#diskConfirmed.add(tag);   // confirmed absent - a blind write is safe
      return;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch { /* damage - parked below */ }
    if (Array.isArray(parsed)) {
      const known = new Set(cached.map(idOf));
      const strays = parsed.filter((r) => r && idOf(r) != null && !known.has(idOf(r)));
      if (strays.length) {
        cached.push(...strays);
        cached.sort(sort);
        this.emit();
      }
    } else {
      console.error(`Unreadable ${path}; preserving a copy`);
      await puter.fs.write(`${path}.corrupt-${Date.now()}`, text, { createMissingParents: true });
    }
    this.#diskConfirmed.add(tag);
  }

  /**
   * Index the month before writing its file: an indexed-but-missing file
   * reads as empty, but a written-yet-unindexed file is invisible after
   * reload and the next write to that month would overwrite it.
   */
  async #ensureMonthIndexed(key) {
    if (this.months.includes(key)) return;
    const prev = this.months;
    this.months = [...prev, key].sort().reverse();
    try {
      await this.#kvSet(KV.months, this.months);
    } catch (err) {
      this.months = prev;
      throw err;
    }
  }

  async #persistMonth(key) {
    await this.#ensureMonthIndexed(key);
    // Queued sales are excluded: the outbox flush is the only path that puts
    // them in the file, which is what keeps them from landing twice. The list
    // must be read *inside* the queued turn: a snapshot taken here would go
    // stale while an outbox merge ahead of it in the queue lands a queued
    // sale and drops its flag - and would then overwrite the file without
    // the sale that merge just filed.
    await this.#queueWrite(key, async () => {
      const cached = this.#saleCache.get(key) || [];
      await this.#absorbUnreadFile(`sales:${key}`, monthPath(key), cached, (s) => s?.id, byNewest);
      const sales = cached.filter((s) => !s.pendingSync);
      return puter.fs.write(monthPath(key), JSON.stringify(sales), { createMissingParents: true });
    });
  }

  /**
   * dir: -1 on sale, +1 on void. Returns one entry per product whose stock
   * moved - what changed and the level it landed on - which is exactly what
   * a ledger line needs, and `.length` still answers "did anything move?".
   */
  #applyStock(lines, dir) {
    const touched = [];
    for (const line of lines) {
      const p = line.productId ? this.product(line.productId) : null;
      if (!p || p.stock === null || p.stock === undefined) continue;
      // Rounded to the measure's 3 places so repeated decimal moves can't
      // leave float dust on the shelf count.
      const delta = Math.round(dir * line.qty * 1000) / 1000;
      p.stock = Math.round((p.stock + dir * line.qty) * 1000) / 1000;
      touched.push({ productId: p.id, name: p.name, unit: p.unit || '', delta, level: p.stock });
    }
    return touched;
  }

  /**
   * Floor the receipt counter above every number already filed in `sales`.
   *
   * The counter's KV write after a sale is fire-and-forget - a sale must not
   * fail because a settings write did - so a lost write followed by a reload
   * would otherwise hand the next sale a number the month already holds, and
   * two receipts would share it.
   */
  #reserveNumberAbove(sales) {
    let used = 0;
    for (const s of sales || []) used = Math.max(used, Number(s?.number) || 0);
    if (used >= this.settings.nextReceipt) {
      this.settings = { ...this.settings, nextReceipt: used + 1 };
    }
  }

  /**
   * The tenders that settle a sale, validated to the cent.
   *
   * A tender's `amount` is what it puts against the balance; `tendered` is
   * what physically changed hands, which for cash may be more - the
   * difference is change. Amounts must sum to the total exactly, so a
   * shortfall can't be recorded as a completed sale.
   *
   * A tender may also carry a `tip`: a gratuity riding on that payment, never
   * part of `amount` - sales totals and tax math must not see it. On cash it
   * comes out of the overpay first, so "keep the change" leaves no change.
   *
   * Accepts the legacy single `payment` too, so older callers keep working.
   */
  static #resolveTenders({ payments, payment }, total) {
    const totalCents = toCents(total);
    const out = [];

    /** What's left of the cash handed over after the sale's share and the tip. */
    const cashChange = (amount, tendered, tip = 0) => {
      const change = changeDue(round2(amount + tip), tendered);
      if (change === null) throw new Error('Cash tendered doesn’t cover the total.');
      return change;
    };

    const resolve = (t, amount) => {
      const method = paymentMethodInfo(t?.method).value;
      const entry = { method, amount };
      const tip = round2(clamp(Number(t?.tip) || 0, 0, MAX_AMOUNT));
      if (tip > 0) entry.tip = tip;
      if (method === 'cash' && t?.tendered !== undefined) {
        entry.tendered = round2(Number(t.tendered));
        entry.change = cashChange(amount, entry.tendered, tip);
      }
      return entry;
    };

    if (Array.isArray(payments) && payments.length) {
      for (const t of payments) {
        const amount = round2(Math.max(0, Number(t?.amount) || 0));
        const entry = resolve(t, amount);
        // An untendered row - unless it carries a tip (a comped sale can
        // still be tipped on), in which case the record matters.
        if (toCents(amount) <= 0 && !entry.tip) continue;
        out.push(entry);
      }
    } else {
      out.push(resolve(payment ?? {}, round2(total)));
    }

    // A fully discounted sale still records how it was settled.
    if (!out.length && totalCents === 0) {
      const method = paymentMethodInfo(payments?.[0]?.method ?? payment?.method).value;
      out.push({ method, amount: 0 });
    }

    const paid = out.reduce((a, t) => a + toCents(t.amount), 0);
    if (paid !== totalCents) {
      throw new Error(paid < totalCents
        ? 'Payments don’t cover the total.'
        : 'Payments exceed the total.');
    }
    return out;
  }

  /**
   * Finalize the current cart into a stored receipt. `lines` are raw cart
   * lines; totals are recomputed here so what's stored is always what
   * computeCart says, never a UI copy.
   */
  async completeSale({
    lines, orderDiscount = null, payment, payments, note = '', customerId = null,
    reward = null, loyalty = null,
  }) {
    const cart = computeCart(lines, {
      orderDiscount,
      pricesIncludeTax: this.settings.pricesIncludeTax,
    });
    if (!cart.lines.length || cart.itemCount <= 0) throw new Error('Nothing to charge.');

    const tenders = Store.#resolveTenders({ payments, payment }, cart.total);

    // Store credit draws on a balance, so it needs a customer and enough of
    // one. Checked before anything is applied: a sale settled against credit
    // that isn't there would hand goods over for nothing.
    const creditCents = tenders
      .filter((t) => t.method === 'credit')
      .reduce((a, t) => a + toCents(t.amount), 0);
    const creditCustomer = customerId ? this.customer(customerId) : null;
    if (creditCents > 0) {
      if (!creditCustomer) throw new Error('Attach the customer whose store credit this is.');
      const available = toCents(this.creditBalance(creditCustomer.id));
      if (creditCents > available) throw new Error('That is more store credit than the balance holds.');
    }

    const now = Date.now();
    const date = todayISO();
    const key = monthKeyOf(date);
    // The month's file may be unreachable - the first sale of a new month
    // during an outage. That can't stop the sale: it goes to the outbox, and
    // the flush appends it to whatever the file turns out to hold.
    let sales = null;
    try {
      sales = await this.loadMonth(key);
    } catch (err) {
      if (!isTransportError(err)) throw err;
    }
    if (sales) this.#reserveNumberAbove(sales);
    // The first sale of a month has an empty file to floor against, but the
    // counter's post-sale write is fire-and-forget - lost, then reloaded, it
    // comes back reading a number last month already issued. The newest
    // earlier month is the record that catches that; read it too (cached
    // after the first look, and only this once-a-month case pays for it).
    if (sales && !sales.length) {
      const prevKey = this.monthsWithSales().find((k) => k < key);
      if (prevKey) {
        const prev = await this.loadMonth(prevKey).catch(() => null);
        if (prev) this.#reserveNumberAbove(prev);
      }
    }
    // Numbers already handed to queued sales floor the counter too. Offline,
    // the month file can't be read to floor against, and a failed settings
    // write racing a sale may have nudged the counter around - the outbox is
    // this device's own record of what it has issued.
    const queuedTo = this.outbox.maxNumber();
    if (queuedTo >= this.settings.nextReceipt) {
      this.settings = { ...this.settings, nextReceipt: queuedTo + 1 };
    }

    const receipt = {
      id: uid(),
      number: this.settings.nextReceipt,
      date,
      at: now,
      currency: this.settings.currency,
      pricesIncludeTax: !!this.settings.pricesIncludeTax,
      type: 'sale',
      lines: cart.lines.map((l) => {
        const line = {
          productId: l.productId || null,
          name: l.name,
          unitPrice: round2(Number(l.unitPrice) || 0),
          qty: l.qty,
          taxRate: Number(l.taxRate) || 0,
          taxName: l.taxName || '',
          discount: l.discount || null,
          subtotal: l.subtotal,
          discountAmount: l.discountAmount,
          tax: l.tax,
          total: l.total,
        };
        // What the goods cost, as the catalog knows it right now. Part of the
        // snapshot like the price: a later cost change must not rewrite what
        // this month earned. Absent when the product keeps no cost - reports
        // read that as unknown, never as zero.
        const unitCost = l.unitCost ?? (l.productId ? this.product(l.productId)?.cost : null);
        if (unitCost !== null && unitCost !== undefined && Number.isFinite(Number(unitCost))) {
          line.unitCost = round2(Number(unitCost));
        }
        // What was asked for on this line - "no ice", "for Sam" - copied like
        // every other detail, so history keeps it after the quick notes change.
        const lineNote = String(l.note || '').trim().slice(0, MAX_NOTE);
        if (lineNote) line.note = lineNote;
        // The measure ('kg', 'm') is part of the snapshot: it's what makes
        // the stored decimal quantity readable, on the receipt and in exports.
        if (l.unit) line.unit = String(l.unit);
        // Chosen options are part of the snapshot: history must survive later
        // edits to the product's option groups.
        if (l.options?.length) {
          line.options = l.options.map((o) => ({
            group: o.group || '', name: o.name, delta: round2(Number(o.delta) || 0),
          }));
        }
        return line;
      }),
      orderDiscount: orderDiscount || null,
      itemCount: cart.itemCount,
      subtotal: cart.subtotal,
      discountTotal: cart.discountTotal,
      taxTotal: cart.taxTotal,
      taxes: cart.taxes,
      total: cart.total,
      payments: tenders,
    };
    if (note.trim()) receipt.note = note.trim().slice(0, MAX_NOTE);

    /**
     * A loyalty reward cashed in on this sale. What it *cost* is taken from
     * this cart's own math, never from the caller: it is the figure Reports
     * adds up as money forgone, and the register is not the authority on
     * money. The rest is the label the reward went by at the time.
     */
    if (reward && (reward.kind === 'stamps' || reward.kind === 'spend')) {
      const value = reward.kind === 'spend'
        ? cart.orderDiscountAmount
        : fromCents(discountCents(
          toCents(cart.lines[reward.lineIndex]?.subtotal || 0),
          cart.lines[reward.lineIndex]?.discount,
        ));
      if (value > 0) {
        receipt.reward = {
          kind: reward.kind,
          name: String(reward.name || '').trim().slice(0, 40),
          value: round2(value),
        };
      }
    }
    // The card as it stands after this sale, printed on the slip - which is
    // the reminder the cardboard card used to be. Figures, not a sentence, so
    // a reprint reads in today's words. Presentation only: nothing about the
    // sale's money depends on it, and the authority for progress is always
    // the receipts themselves.
    if (loyalty && (loyalty.type === 'stamps' || loyalty.type === 'spend')) {
      receipt.loyalty = loyalty.type === 'stamps'
        ? {
          type: 'stamps',
          onCard: Math.max(0, Math.round(Number(loyalty.onCard) || 0)),
          target: Math.max(1, Math.round(Number(loyalty.target) || 1)),
          ready: !!loyalty.ready,
          rewardName: String(loyalty.rewardName || '').trim().slice(0, 40),
        }
        : {
          type: 'spend',
          earned: round2(Math.max(0, Number(loyalty.earned) || 0)),
          target: round2(Math.max(0, Number(loyalty.target) || 0)),
          ready: !!loyalty.ready,
          rewardName: String(loyalty.rewardName || '').trim().slice(0, 40),
        };
    }
    // Registration numbers are part of the sale's legal identity: snapshotted
    // like names and rates, so a later edit can't rewrite an issued receipt.
    const registrations = cleanRegistrations(this.settings.registrations);
    if (registrations.length) receipt.registrations = registrations;
    // The customer, by reference and by value: the id links to the
    // directory, the copied name keeps history whole after any edit.
    const customer = customerId ? this.customer(customerId) : null;
    if (customer) {
      receipt.customerId = customer.id;
      receipt.customerName = customer.name;
    }

    /**
     * Credit spent is made durable before the sale is applied at all.
     *
     * The balance is the shop's record of money it owes, and a spend that
     * lived only on this device could be spent a second time somewhere else.
     * If this write can't land, the sale simply hasn't happened yet: the
     * cashier is standing right there and can take the balance another way.
     * (A queued-offline sale is fine the other way round - the receipt syncs
     * later and agrees with a ledger entry that is already in.)
     */
    if (creditCents > 0) {
      const entry = {
        id: uid(),
        at: now,
        customerId: creditCustomer.id,
        type: 'spent',
        amount: -fromCents(creditCents),
        currency: receipt.currency,
        receiptId: receipt.id,
        receiptNumber: receipt.number,
        note: '',
      };
      const prevCredit = this.credit;
      this.credit = [...prevCredit, entry];
      try {
        await this.#kvSet(KV.credit, this.credit);
      } catch (err) {
        this.credit = prevCredit;
        console.error(err);
        throw new Error('Store credit needs a connection. Take the balance another way, or try again in a moment.');
      }
      receipt.creditSpent = fromCents(creditCents);
      receipt.creditBalance = this.creditBalance(creditCustomer.id, receipt.currency);
    }

    if (sales) sales.unshift(receipt);
    const stockTouched = this.#applyStock(receipt.lines, -1);
    // Noted before any write can settle it: if the products write never
    // runs (offline) or never lands, a reload still owes these moves.
    const debtId = this.#addStockDebt(stockTouched);
    this.settings = { ...this.settings, nextReceipt: this.settings.nextReceipt + 1 };
    this.emit();

    /** Keep the finished sale on this device and sync it later. */
    const queue = () => {
      receipt.pendingSync = true;
      this.outbox.add(receipt, key);   // throws only if the device can't store it
      this.emit();
      this.emit('sync');
    };

    /** Undo everything the sale applied - it never happened. */
    const rollback = () => {
      // Including credit spent: the goods never left, so the balance stands.
      if (receipt.creditSpent) {
        this.credit = this.credit.filter((e) => e.receiptId !== receipt.id);
        this.#kvSet(KV.credit, this.credit).catch(this.#noteConverge);
      }
      // Spliced out of the cached array itself; re-setting the cache entry
      // could plant an empty month over a file we simply couldn't read.
      if (sales) {
        const at = sales.findIndex((s) => s.id === receipt.id);
        if (at >= 0) sales.splice(at, 1);
      }
      if (stockTouched.length) this.#applyStock(receipt.lines, +1);
      this.#dropStockDebt([debtId]);
      this.settings = { ...this.settings, nextReceipt: receipt.number };
      this.emit();
    };

    // Known to be offline, or the month couldn't even be read: don't make the
    // customer wait on a request that is going to fail.
    if (!sales || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      try {
        queue();
      } catch (err) {
        rollback();
        throw err;
      }
      this.#spendDraft(now);
      return receipt;
    }

    try {
      await this.#persistMonth(key);
    } catch (err) {
      // A transport failure must not cost the shop a sale: keep it locally,
      // with its number and stock, and flush it when the network returns. A
      // real rejection would never succeed on retry, so it rolls back -
      // otherwise the unsaved sale stays visible and retrying "Charge" would
      // double-record it.
      if (!isTransportError(err)) {
        rollback();
        throw err;
      }
      try {
        queue();
      } catch (queueErr) {
        rollback();
        throw queueErr;
      }
      this.#spendDraft(now);
      return receipt;
    }
    this.#spendDraft(now);
    this.#kvSet(KV.settings, this.settings).catch(this.#noteConverge);
    if (stockTouched.length) {
      this.#kvSet(KV.products, this.products).catch(this.#noteConverge);
      this.#logStock(stockTouched, { reason: 'sale', receiptId: receipt.id, receiptNumber: receipt.number });
    }
    return receipt;
  }

  /* ---------- Offline outbox ---------- */

  get pendingSync() {
    return this.outbox.count;
  }

  /** True while the cloud's stock/counter copy lags a completed sale. */
  get needsConverge() {
    return this.#convergeNeeded;
  }

  /**
   * A failed write of the bookkeeping that rides on a sale (stock levels,
   * the receipt counter). The sale itself is safe; these must not fail it,
   * but silently dropping them left the shelf count diverged until pure luck
   * rewrote it - remember to converge on the next sync pass instead.
   */
  #noteConverge = (err) => {
    this.#convergeNeeded = true;
    if (!isTransportError(err)) console.error(err);
  };

  /** True when the last sync attempt failed for a reason other than being offline. */
  get syncFailed() {
    return this.#syncFailed;
  }

  /**
   * Push queued sales to the cloud. Single-flight, idempotent, and safe to
   * call as often as you like.
   *
   * Each month's file is re-read inside the write queue and appended to by id,
   * so a sale lands exactly once even if a previous attempt half-succeeded or
   * another device wrote in the meantime.
   */
  async syncOutbox() {
    if (this.#syncing) return this.#syncing;
    if (!this.outbox.count && !this.#convergeNeeded) return { synced: 0 };

    this.#syncing = (async () => {
      let synced = 0;
      let failed = null;
      for (const key of this.outbox.months()) {
        const queued = this.outbox.forMonth(key);
        if (!queued.length) continue;
        try {
          await this.#ensureMonthIndexed(key);
          await this.#queueWrite(key, async () => {
            let onDisk = [];
            try {
              const blob = await puter.fs.read(monthPath(key));
              const text = await blob.text();
              let parsed = null;
              try {
                parsed = JSON.parse(text);
              } catch { /* damage - handled with the wrong-shape case below */ }
              if (Array.isArray(parsed)) {
                onDisk = parsed.filter((s) => s && s.id);
              } else {
                // Same treatment as loadMonth, wrong shape included: park
                // the damaged bytes and merge onto empty, or the queue would
                // jam on them forever. A failed park propagates and the
                // sales stay safely queued.
                console.error(`Unreadable ${monthPath(key)}; preserving a copy`);
                await puter.fs.write(`${monthPath(key)}.corrupt-${Date.now()}`, text, { createMissingParents: true });
              }
            } catch (err) {
              if (!isMissingFileError(err)) throw err;
            }
            const known = new Set(onDisk.map((s) => s.id));
            const additions = queued
              .filter((r) => !known.has(r.id))
              .map(({ pendingSync, ...rest }) => rest);
            const merged = [...onDisk, ...additions].sort(byNewest);
            await puter.fs.write(monthPath(key), JSON.stringify(merged), { createMissingParents: true });
            // This read is ground truth for the session: anything on disk
            // the cache never saw (a month the index lost track of) is
            // folded in, so a later ordinary write can't drop it.
            const cached = this.#saleCache.get(key);
            if (cached) {
              const inCache = new Set(cached.map((s) => s.id));
              const strays = onDisk.filter((s) => !inCache.has(s.id));
              if (strays.length) {
                cached.push(...strays);
                cached.sort(byNewest);
              }
            }
            this.#diskConfirmed.add(`sales:${key}`);
          });
        } catch (err) {
          // A retry loop against a dead network shouldn't fill the console.
          if (!isTransportError(err)) console.error(err);
          failed = err;
          break;   // keep the rest queued, in order, for the next attempt
        }
        // Landed: drop the flags the UI was showing and clear the queue.
        for (const cached of this.#saleCache.get(key) || []) {
          if (queued.some((r) => r.id === cached.id)) delete cached.pendingSync;
        }
        this.outbox.remove(queued.map((r) => r.id));
        synced += queued.length;
      }

      if (synced || this.#convergeNeeded) {
        // Stock and the receipt counter moved while offline (or their
        // post-sale write failed); converge them now, and stop asking only
        // once both have actually landed.
        const landed = await Promise.all([
          this.#kvSet(KV.settings, this.settings).then(() => true, () => false),
          this.#kvSet(KV.products, this.products).then(() => true, () => false),
        ]);
        this.#convergeNeeded = !landed.every(Boolean);
      }
      this.#syncFailed = !!failed && !isTransportError(failed);
      if (synced || failed) {
        this.emit();
        this.emit('sync');
      }
      return { synced, failed };
    })().finally(() => { this.#syncing = null; });

    return this.#syncing;
  }

  /**
   * Give money back for part or all of a sale.
   *
   * The refund is its own receipt - own number, negative amounts, a reference
   * to the original - filed in the month it happens in, which may not be the
   * month of the sale. The original is left as it was rung up, apart from
   * bookkeeping that records how many of each line have now come back, so the
   * same units can never be refunded twice.
   */
  async refundSale({ receiptId, date, picks, method = 'cash', restock = true, note = '', customerId = null }) {
    const originalKey = monthKeyOf(date);
    const originalMonth = await this.loadMonth(originalKey);
    const original = originalMonth.find((s) => s.id === receiptId);
    if (!original) throw new Error('That receipt is no longer here.');
    if (original.voidedAt) throw new Error('A voided sale can’t be refunded.');
    if (isRefund(original)) throw new Error('A refund can’t be refunded.');
    // The refund would land in the cloud while the note of how much of the sale
    // has come back stayed on this device only - a reload would then let the
    // same units be refunded a second time.
    if (original.pendingSync) throw new Error(PENDING_SYNC_MESSAGE);

    // The refund files under today's month; load it before numbering so
    // numbers already filed there (and in the original's month) floor the
    // counter the same way completeSale's do.
    const refundDate = todayISO();
    const refundKey = monthKeyOf(refundDate);
    const refundMonth = await this.loadMonth(refundKey);

    // Priced only now, past the last await before the optimistic
    // application: overlapping calls for the same sale (a dismissed sheet
    // retried while its write was still out) would otherwise both price
    // against the pre-refund bookkeeping and give the same units back
    // twice. From here to the application below is one synchronous stretch.
    const plan = refundPlan(original, picks);
    if (!plan.lines.length) {
      throw new Error(refundState(original) === 'full'
        ? 'This sale has already been refunded in full.'
        : 'Nothing selected to refund.');
    }
    this.#reserveNumberAbove(originalMonth);
    this.#reserveNumberAbove(refundMonth);

    const receipt = {
      id: uid(),
      number: this.settings.nextReceipt,
      date: refundDate,
      at: Date.now(),
      // The original's currency and price mode, not today's settings: this is
      // that sale coming back, at the money it was rung up in.
      currency: original.currency || this.settings.currency,
      pricesIncludeTax: !!original.pricesIncludeTax,
      type: 'refund',
      refundOf: original.id,
      refundOfNumber: original.number,
      refundOfDate: original.date,
      lines: plan.lines,
      orderDiscount: null,
      itemCount: plan.itemCount,
      subtotal: plan.subtotal,
      discountTotal: plan.discountTotal,
      taxTotal: plan.taxTotal,
      taxes: plan.taxes,
      total: plan.total,
      payments: [{ method: paymentMethodInfo(method).value, amount: plan.total }],
    };
    if (note.trim()) receipt.note = note.trim();
    // A refund is its own customer-facing document; it carries the identity
    // in force on the day the money went back.
    const refundRegistrations = cleanRegistrations(this.settings.registrations);
    if (refundRegistrations.length) receipt.registrations = refundRegistrations;
    // The original's customer follows the money back, so their purchase
    // history nets out the same way reports do. A refund to store credit may
    // name one the sale never had: the credit has to belong to somebody.
    const creditTo = method === 'credit'
      ? this.customer(customerId || original.customerId)
      : null;
    if (method === 'credit' && !creditTo) {
      throw new Error('Store credit needs a customer to belong to.');
    }
    if (creditTo) {
      receipt.customerId = creditTo.id;
      receipt.customerName = creditTo.name;
    } else {
      if (original.customerId) receipt.customerId = original.customerId;
      if (original.customerName) receipt.customerName = original.customerName;
    }

    /**
     * Credit issued lands before the receipts do, and is awaited: the slip
     * the customer walks out with prints the balance, so the balance had
     * better be real. A failed receipt write below takes it back out.
     */
    let creditEntry = null;
    if (creditTo) {
      creditEntry = {
        id: uid(),
        at: receipt.at,
        customerId: creditTo.id,
        type: 'issued',
        amount: round2(Math.abs(receipt.total)),
        currency: receipt.currency,
        receiptId: receipt.id,
        receiptNumber: receipt.number,
        note: '',
      };
      const prevCredit = this.credit;
      this.credit = [...prevCredit, creditEntry];
      try {
        await this.#kvSet(KV.credit, this.credit);
      } catch (err) {
        this.credit = prevCredit;
        throw err;
      }
      // Printed on the slip, so the customer leaves holding proof of both
      // the credit and what it brings them to.
      receipt.creditIssued = creditEntry.amount;
      receipt.creditBalance = this.creditBalance(creditTo.id, receipt.currency);
    }

    /* ---- optimistic application ---- */
    const priorRefunded = original.lines.map((l) => l.refundedQty);
    const priorRefunds = original.refunds;

    refundMonth.unshift(receipt);
    for (const line of plan.lines) {
      const src = original.lines[line.refundOfLine];
      // Sanitized per the line's own terms, so decimal returns on measured
      // lines can't accrete float dust in the stored bookkeeping.
      src.refundedQty = sanitizeQty(refundedQty(src) + Math.abs(line.qty), src.unit);
    }
    original.refunds = [
      ...(priorRefunds || []),
      { id: receipt.id, number: receipt.number, date: receipt.date, total: receipt.total },
    ];
    const restocked = restock ? this.#applyStock(plan.restock, +1) : [];
    const debtId = this.#addStockDebt(restocked);
    this.settings = { ...this.settings, nextReceipt: this.settings.nextReceipt + 1 };
    this.emit();

    const rollback = () => {
      if (creditEntry) {
        this.credit = this.credit.filter((e) => e.id !== creditEntry.id);
        this.#kvSet(KV.credit, this.credit).catch(this.#noteConverge);
      }
      this.#saleCache.set(refundKey, (this.#saleCache.get(refundKey) || []).filter((s) => s.id !== receipt.id));
      original.lines.forEach((l, i) => {
        if (priorRefunded[i] === undefined) delete l.refundedQty;
        else l.refundedQty = priorRefunded[i];
      });
      if (priorRefunds === undefined) delete original.refunds;
      else original.refunds = priorRefunds;
      if (restocked.length) this.#applyStock(plan.restock, -1);
      this.#dropStockDebt([debtId]);
      this.settings = { ...this.settings, nextReceipt: receipt.number };
      this.emit();
    };

    // Same month is the common case and a single atomic write. Across
    // months, the original's bookkeeping lands first - it is what refuses
    // the same units a second time. If the refund receipt's write then
    // fails, the bookkeeping is rewritten without it; and if even that
    // compensation fails, the stranded state *blocks* another refund
    // rather than inviting one (the reverse order stranded a filed refund
    // against an unmarked sale, and a retry paid the same money out
    // twice). A blocked receipt heals on the next successful retry here,
    // since the bookkeeping is absolute quantities, not increments.
    let wroteOriginal = false;
    try {
      if (refundKey !== originalKey) {
        await this.#persistMonth(originalKey);
        wroteOriginal = true;
      }
      await this.#persistMonth(refundKey);
    } catch (err) {
      rollback();
      if (wroteOriginal) await this.#persistMonth(originalKey).catch(() => {});
      throw err;
    }

    this.#kvSet(KV.settings, this.settings).catch(this.#noteConverge);
    if (restocked.length) {
      this.#kvSet(KV.products, this.products).catch(this.#noteConverge);
      this.#logStock(restocked, { reason: 'refund', receiptId: receipt.id, receiptNumber: receipt.number });
    }
    return receipt;
  }

  /**
   * Void a receipt: it stays in history (struck through, excluded from
   * reports) and tracked stock returns to the shelf.
   */
  async voidSale(id, date) {
    const key = monthKeyOf(date);
    const sales = await this.loadMonth(key);
    const sale = sales.find((s) => s.id === id);
    if (!sale || sale.voidedAt) return null;
    // Voiding either of these would double-count the money that came back.
    if (isRefund(sale)) throw new Error('A refund can’t be voided.');
    if (sale.refunds?.length) throw new Error('This sale has a refund against it.');
    // Queued sales are excluded from month writes, so the void would have
    // nowhere to be recorded and would vanish on the next reload.
    if (sale.pendingSync) throw new Error(PENDING_SYNC_MESSAGE);
    sale.voidedAt = Date.now();
    const stockTouched = this.#applyStock(sale.lines, +1);
    const debtId = this.#addStockDebt(stockTouched);
    this.emit();
    try {
      await this.#persistMonth(key);
    } catch (err) {
      delete sale.voidedAt;
      if (stockTouched.length) this.#applyStock(sale.lines, -1);
      this.#dropStockDebt([debtId]);
      this.emit();
      throw err;
    }
    if (stockTouched.length) {
      this.#kvSet(KV.products, this.products).catch(this.#noteConverge);
      this.#logStock(stockTouched, { reason: 'void', receiptId: sale.id, receiptNumber: sale.number });
    }
    return sale;
  }

  /* ---------- Cash drawer (opening float, movements, day close) ---------- */

  async loadDrawerMonth(key) {
    if (this.#drawerCache.has(key)) return this.#drawerCache.get(key);
    if (this.#drawerLoading.has(key)) return this.#drawerLoading.get(key);
    const gen = this.#loadGen;
    const load = (async () => {
      let days = [];
      if (this.drawerMonths.includes(key)) {
        try {
          const blob = await puter.fs.read(drawerPath(key));
          const parsed = JSON.parse(await blob.text());
          // Wrong shape fails closed like a parse error: reading it as an
          // empty month would let the next drawer write replace the file.
          if (!Array.isArray(parsed)) throw new Error(`Unexpected shape in ${drawerPath(key)}`);
          days = parsed.filter((d) => d && d.date);
        } catch (err) {
          // Same reasoning as the sales months: an indexed-but-unwritten file
          // reads as empty, anything else must propagate rather than be cached.
          if (!isMissingFileError(err)) throw err;
        }
        this.#diskConfirmed.add(`drawer:${key}`);
      }
      days.sort((a, b) => (a.date < b.date ? 1 : -1));
      if (gen === this.#loadGen && !this.#drawerCache.has(key)) this.#drawerCache.set(key, days);
      return this.#drawerCache.get(key) ?? days;
    })().finally(() => this.#drawerLoading.delete(key));
    this.#drawerLoading.set(key, load);
    return load;
  }

  /** The drawer record for a date, or null when that day was never started. */
  async drawerDay(date) {
    const days = await this.loadDrawerMonth(monthKeyOf(date));
    return days.find((d) => d.date === date) || null;
  }

  /** Drawer days in an inclusive date range, newest first. */
  async drawerDaysInRange(fromISO, toISO) {
    const keys = monthKeysInRange(fromISO, toISO).filter((k) => this.drawerMonths.includes(k));
    const lists = await Promise.all(keys.map((k) => this.loadDrawerMonth(k)));
    return lists.flat()
      .filter((d) => d.date >= fromISO && d.date <= toISO)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  async #persistDrawerMonth(key) {
    if (!this.drawerMonths.includes(key)) {
      const prev = this.drawerMonths;
      this.drawerMonths = [...prev, key].sort().reverse();
      try {
        await this.#kvSet(KV.drawers, this.drawerMonths);
      } catch (err) {
        this.drawerMonths = prev;
        throw err;
      }
    }
    // Read inside the queued turn, like the sales months: the latest state
    // wins over whatever was true when an earlier write was still in flight.
    await this.#queueWrite(`drawer:${key}`, async () => {
      const cached = this.#drawerCache.get(key) || [];
      await this.#absorbUnreadFile(`drawer:${key}`, drawerPath(key), cached,
        (d) => d?.date, (a, b) => (a.date < b.date ? 1 : -1));
      return puter.fs.write(drawerPath(key), JSON.stringify(cached), { createMissingParents: true });
    });
  }

  /** Insert or replace one day's record, rolling back if the write fails. */
  async #writeDrawerDay(day) {
    const key = monthKeyOf(day.date);
    const days = await this.loadDrawerMonth(key);
    const at = days.findIndex((d) => d.date === day.date);
    const prev = at >= 0 ? days[at] : null;
    if (at >= 0) days[at] = day;
    else days.push(day);
    days.sort((a, b) => (a.date < b.date ? 1 : -1));
    this.emit();
    try {
      await this.#persistDrawerMonth(key);
    } catch (err) {
      const now = days.findIndex((d) => d.date === day.date);
      if (prev) days[now] = prev;
      else days.splice(now, 1);
      this.emit();
      throw err;
    }
    return day;
  }

  /** Start a day with the cash put in the drawer. */
  async openDrawer({ date = todayISO(), float = 0 } = {}) {
    if (await this.drawerDay(date)) throw new Error('That day is already started.');
    return this.#writeDrawerDay({
      date,
      openedAt: Date.now(),
      float: round2(Math.max(0, Number(float) || 0)),
      movements: [],
    });
  }

  /**
   * Record cash in or out that isn't a sale. Sign carries direction: positive
   * into the drawer, negative out of it.
   */
  async addCashMovement({ date = todayISO(), amount, reason = '' } = {}) {
    const day = await this.drawerDay(date);
    if (!day) throw new Error('Start the day before recording cash movements.');
    if (day.close) throw new Error('That day is already closed.');
    const amt = round2(Number(amount) || 0);
    if (!amt) throw new Error('Enter an amount.');
    return this.#writeDrawerDay({
      ...day,
      movements: [...day.movements, { id: uid(), at: Date.now(), amount: amt, reason: String(reason).trim() }],
    });
  }

  /**
   * Record the drawer being opened for something that isn't a sale - making
   * change, checking a note. No money moves, which is exactly why it belongs
   * in the movement history: an unexplained drawer opening is what that
   * history exists to explain.
   */
  async recordNoSale({ date = todayISO(), reason = '' } = {}) {
    const day = await this.drawerDay(date);
    if (!day) throw new Error('Start the day before opening the drawer.');
    if (day.close) throw new Error('That day is already closed.');
    return this.#writeDrawerDay({
      ...day,
      movements: [...day.movements, {
        id: uid(),
        at: Date.now(),
        amount: 0,
        noSale: true,
        reason: String(reason || '').trim().slice(0, 60) || 'No sale — drawer opened',
      }],
    });
  }

  /** The day's takings, movements, and expected cash - what a Z-report needs. */
  async drawerSummary(date = todayISO()) {
    const [day, sales] = await Promise.all([this.drawerDay(date), this.salesInRange(date, date)]);
    return daySummary({ date, day, sales });
  }

  /**
   * Close the day: the expected figure is recomputed here, never taken from
   * the UI, and the whole summary is snapshotted so a later refund can't
   * rewrite a Z-report that has already been signed off.
   */
  async closeDrawer({ date = todayISO(), counted } = {}) {
    const day = await this.drawerDay(date);
    if (!day) throw new Error('That day was never started.');
    if (day.close) throw new Error('That day is already closed.');
    const summary = await this.drawerSummary(date);
    const count = round2(Math.max(0, Number(counted) || 0));
    const closed = await this.#writeDrawerDay({
      ...day,
      close: {
        at: Date.now(),
        counted: count,
        expected: summary.expected,
        diff: round2(count - summary.expected),
        float: summary.float,
        paidIn: summary.paidIn,
        paidOut: summary.paidOut,
        cashSales: summary.cashSales,
        cashRefunds: summary.cashRefunds,
        cashTips: summary.cashTips,
        tipTotal: summary.tipTotal,
        tips: summary.tips,
        salesCount: summary.salesCount,
        refundCount: summary.refundCount,
        revenue: summary.revenue,
        tax: summary.tax,
        discounts: summary.discounts,
        byMethod: summary.byMethod,
        currency: this.settings.currency,
      },
    });
    // The natural moment for a restore point: the day is done and counted.
    // After the close is durable, and never in its way.
    this.autoSnapshot('close').catch((err) => console.error(err));
    return closed;
  }

  /* ---------- Stock movement ledger ---------- */

  async loadStockMonth(key) {
    if (this.#stockCache.has(key)) return this.#stockCache.get(key);
    if (this.#stockLoading.has(key)) return this.#stockLoading.get(key);
    const gen = this.#loadGen;
    const load = (async () => {
      let movements = [];
      if (this.stockMonths.includes(key)) {
        try {
          const blob = await puter.fs.read(stockPath(key));
          const parsed = JSON.parse(await blob.text());
          // Wrong shape fails closed, like the drawer months: an "empty"
          // read here would cost the ledger its file on the next write.
          if (!Array.isArray(parsed)) throw new Error(`Unexpected shape in ${stockPath(key)}`);
          movements = parsed.filter((m) => m && m.id);
        } catch (err) {
          if (!isMissingFileError(err)) throw err;
        }
        this.#diskConfirmed.add(`stock:${key}`);
      }
      movements.sort((a, b) => (b.at || 0) - (a.at || 0));
      if (gen === this.#loadGen && !this.#stockCache.has(key)) this.#stockCache.set(key, movements);
      return this.#stockCache.get(key) ?? movements;
    })().finally(() => this.#stockLoading.delete(key));
    this.#stockLoading.set(key, load);
    return load;
  }

  async #persistStockMonth(key) {
    if (!this.stockMonths.includes(key)) {
      const prev = this.stockMonths;
      this.stockMonths = [...prev, key].sort().reverse();
      try {
        await this.#kvSet(KV.stockMonths, this.stockMonths);
      } catch (err) {
        this.stockMonths = prev;
        throw err;
      }
    }
    await this.#queueWrite(`stock:${key}`, async () => {
      const cached = this.#stockCache.get(key) || [];
      await this.#absorbUnreadFile(`stock:${key}`, stockPath(key), cached,
        (m) => m?.id, (a, b) => (b.at || 0) - (a.at || 0));
      return puter.fs.write(stockPath(key), JSON.stringify(cached), { createMissingParents: true });
    });
  }

  /**
   * File movement entries in this month's ledger. On failure they're taken
   * back out of the cache, so what's on screen never claims history the
   * cloud doesn't hold.
   */
  async #appendStock(entries) {
    if (!entries.length) return;
    const key = monthKeyOf(todayISO());
    const movements = await this.loadStockMonth(key);
    movements.unshift(...entries);
    try {
      await this.#persistStockMonth(key);
    } catch (err) {
      const gone = new Set(entries.map((e) => e.id));
      this.#stockCache.set(key, movements.filter((m) => !gone.has(m.id)));
      throw err;
    }
  }

  /**
   * The automatic movements: what a sale, refund, or void did to the shelf.
   * Best-effort by design - recording the sale must never wait on, or fail
   * because of, its ledger note. (An offline sale's note is the one gap.)
   */
  #logStock(touched, { reason, receiptId = null, receiptNumber = null }) {
    if (!touched.length) return;
    const at = Date.now();
    const entries = touched.map((t) => ({
      id: uid(), at, reason, receiptId, receiptNumber, ...t,
    }));
    this.#appendStock(entries).catch((err) => {
      if (!isTransportError(err)) console.error(err);
    });
  }

  /**
   * Adjust a tracked product's stock by a signed amount, with a reason the
   * ledger keeps: a delivery, a recount, breakage. The ledger entry is made
   * durable first - a level that changed with no record of why is exactly
   * the state this feature exists to end.
   */
  async adjustStock({ productId, delta, reason = 'other', note = '' }) {
    const product = this.product(productId);
    if (!product) throw new Error('That product is no longer here.');
    if (product.stock === null || product.stock === undefined) {
      throw new Error('This product doesn’t track stock.');
    }
    const amount = Math.round((Number(delta) || 0) * 1000) / 1000;
    if (!amount) throw new Error('Enter an amount.');

    const entry = {
      id: uid(),
      at: Date.now(),
      reason: ADJUST_REASONS.some((r) => r.value === reason) ? reason : 'other',
      note: String(note || '').trim().slice(0, 80),
      productId: product.id,
      name: product.name,
      unit: product.unit || '',
      delta: amount,
      level: Math.round((product.stock + amount) * 1000) / 1000,
    };
    await this.#appendStock([entry]);

    /** Take the ledger line back out (best effort - a leftover would claim
        a change that didn't happen). */
    const removeLedgerLine = () => {
      const key = monthKeyOf(todayISO());
      const cached = this.#stockCache.get(key);
      if (cached) {
        this.#stockCache.set(key, cached.filter((m) => m.id !== entry.id));
        this.#persistStockMonth(key).catch(() => {});
      }
    };

    // The delta applies to the level as it stands *now*, past the await: a
    // sale can complete while the ledger write is out, and committing the
    // level computed before it would put the sold units back on the shelf.
    const current = this.product(productId);
    if (!current) {
      removeLedgerLine();
      throw new Error('That product is no longer here.');
    }
    if (current.stock === null || current.stock === undefined) {
      removeLedgerLine();
      throw new Error('This product doesn’t track stock.');
    }
    const landed = Math.round((current.stock + amount) * 1000) / 1000;
    if (landed !== entry.level) {
      // The ledger line must state the level the change actually landed on.
      entry.level = landed;
      this.#persistStockMonth(monthKeyOf(todayISO())).catch(() => {});
    }

    const before = this.#snapshot();
    this.products = this.products.map((p) => (p.id === productId ? { ...p, stock: landed } : p));
    this.emit();
    try {
      await this.#commit(before, [KV.products]);
    } catch (err) {
      removeLedgerLine();
      throw err;
    }
    return entry;
  }

  /* ---------- Stocktake (count the shop, post the variances at once) ---------- */

  /** Account-scoped note of sessions this device has already posted. */
  #stocktakePostedKey = 'pos:stocktake-posted:v1:anon';

  #postedStocktakeIds() {
    try {
      const list = JSON.parse(localStorage.getItem(this.#stocktakePostedKey));
      return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }

  /**
   * Remember that a session's variances are in. Synchronous and local, like
   * the spent-draft marker: the kv write that clears the session can fail
   * (the connection that just posted may drop), and a resumed session would
   * post every variance a second time.
   */
  #markStocktakePosted(id) {
    try {
      const list = [...this.#postedStocktakeIds().filter((x) => x !== id), id].slice(-20);
      localStorage.setItem(this.#stocktakePostedKey, JSON.stringify(list));
    } catch { /* the month-file check in postStocktake still guards it */ }
  }

  /**
   * A stored session, sanitized. Counts are keyed by product id and carry the
   * level expected *when that row was counted* - not the level now. A sale
   * rung up mid-count is real, and posting must not put those units back on
   * the shelf: the variance is counted-minus-expected-then, applied to the
   * level as it stands at posting time.
   */
  static #cleanStocktake(s) {
    if (!s || typeof s !== 'object' || !s.id) return null;
    const counts = {};
    for (const [id, entry] of Object.entries(s.counts || {})) {
      const counted = Number(entry?.counted);
      if (!Number.isFinite(counted)) continue;
      counts[id] = {
        counted: Math.round(counted * 1000) / 1000,
        expected: Math.round((Number(entry?.expected) || 0) * 1000) / 1000,
        at: Number(entry?.at) || Date.now(),
      };
    }
    return {
      id: String(s.id),
      startedAt: Number(s.startedAt) || Date.now(),
      categoryId: s.categoryId || null,
      blind: !!s.blind,
      counts,
      savedAt: Number(s.savedAt) || Date.now(),
    };
  }

  /** Products a session covers: tracked, and inside its category if it has one. */
  stocktakeScope(session = this.stocktake) {
    if (!session) return [];
    return this.productsInOrder().filter((p) => p.stock !== null && p.stock !== undefined
      && (!session.categoryId || p.categoryId === session.categoryId));
  }

  /** Start a count. Refuses to bury one already open. */
  async startStocktake({ categoryId = null, blind = false } = {}) {
    if (this.stocktake) throw new Error('A count is already open.');
    const session = {
      id: uid(),
      startedAt: Date.now(),
      categoryId: categoryId || null,
      blind: !!blind,
      counts: {},
      savedAt: Date.now(),
    };
    const prev = this.stocktake;
    this.stocktake = session;
    this.emit();
    try {
      await this.#kvSet(KV.stocktake, session);
    } catch (err) {
      this.stocktake = prev;
      this.emit();
      throw err;
    }
    return session;
  }

  /**
   * Record (or clear, with null) one counted quantity. Safe to call on every
   * keystroke: local state updates at once and the write is throttled.
   * Failures are swallowed - the sheet still shows the count, and a toast per
   * missed autosave during a half-hour count would be noise.
   */
  queueStocktakeCount(productId, counted) {
    if (!this.stocktake) return;
    const product = this.product(productId);
    if (!product || product.stock === null || product.stock === undefined) return;
    const counts = { ...this.stocktake.counts };
    if (counted === null || counted === undefined || !Number.isFinite(Number(counted))) {
      delete counts[productId];
    } else {
      counts[productId] = {
        counted: Math.round(Number(counted) * 1000) / 1000,
        // The shelf as the app believed it to be at the moment of counting.
        expected: Math.round((Number(product.stock) || 0) * 1000) / 1000,
        at: Date.now(),
      };
    }
    this.stocktake = { ...this.stocktake, counts, savedAt: Date.now() };
    this.emit();
    const since = Date.now() - this.#stocktakeFlushedAt;
    if (since >= STOCKTAKE_MIN_INTERVAL_MS) {
      this.flushStocktake();
      return;
    }
    if (this.#stocktakeTimer) return;
    this.#stocktakeTimer = setTimeout(() => this.flushStocktake(), STOCKTAKE_MIN_INTERVAL_MS - since);
  }

  /** Write the open session now (also called on page hide). */
  flushStocktake() {
    clearTimeout(this.#stocktakeTimer);
    this.#stocktakeTimer = null;
    this.#stocktakeFlushedAt = Date.now();
    return this.#kvSet(KV.stocktake, this.stocktake).catch((err) => {
      if (!isTransportError(err)) console.error(err);
    });
  }

  /** Throw the open count away. Nothing has touched a stock level yet. */
  async cancelStocktake() {
    if (!this.stocktake) return;
    const prev = this.stocktake;
    clearTimeout(this.#stocktakeTimer);
    this.#stocktakeTimer = null;
    this.stocktake = null;
    this.emit();
    try {
      await this.#kvSet(KV.stocktake, null);
    } catch (err) {
      this.stocktake = prev;
      this.emit();
      throw err;
    }
  }

  /**
   * What posting the open count would do: one line per counted product, with
   * the variance in units and - where a cost is known - what it is worth.
   * Pure, so the review screen and the post below can never disagree.
   */
  stocktakePlan(session = this.stocktake) {
    if (!session) return null;
    const lines = [];
    let unitsShort = 0;
    let unitsOver = 0;
    let valueCents = 0;
    let unknownCost = 0;
    let counted = 0;
    for (const product of this.stocktakeScope(session)) {
      const entry = session.counts[product.id];
      if (!entry) continue;
      counted++;
      const delta = Math.round((entry.counted - entry.expected) * 1000) / 1000;
      const hasCost = product.cost !== null && product.cost !== undefined
        && Number.isFinite(Number(product.cost));
      const value = hasCost ? Math.round(toCents(product.cost) * delta) : null;
      if (delta < 0) unitsShort = Math.round((unitsShort - delta) * 1000) / 1000;
      if (delta > 0) unitsOver = Math.round((unitsOver + delta) * 1000) / 1000;
      if (value === null) {
        if (delta) unknownCost++;
      } else {
        valueCents += value;
      }
      lines.push({
        productId: product.id,
        name: product.name,
        unit: product.unit || '',
        expected: entry.expected,
        counted: entry.counted,
        delta,
        cost: hasCost ? round2(Number(product.cost)) : null,
        value: value === null ? null : round2(value / 100),
      });
    }
    const variances = lines.filter((l) => l.delta !== 0);
    return {
      id: session.id,
      lines,
      variances,
      counted,
      skipped: this.stocktakeScope(session).length - counted,
      unitsShort,
      unitsOver,
      value: round2(valueCents / 100),
      unknownCost,
    };
  }

  async loadStocktakeMonth(key) {
    if (this.#stocktakeCache.has(key)) return this.#stocktakeCache.get(key);
    if (this.#stocktakeLoading.has(key)) return this.#stocktakeLoading.get(key);
    const gen = this.#loadGen;
    const load = (async () => {
      let records = [];
      if (this.stocktakeMonths.includes(key)) {
        try {
          const blob = await puter.fs.read(stocktakePath(key));
          const parsed = JSON.parse(await blob.text());
          // Wrong shape fails closed, like the drawer and ledger months: an
          // "empty" read would cost the file its history on the next write.
          if (!Array.isArray(parsed)) throw new Error(`Unexpected shape in ${stocktakePath(key)}`);
          records = parsed.filter((r) => r && r.id);
        } catch (err) {
          if (!isMissingFileError(err)) throw err;
        }
        this.#diskConfirmed.add(`stocktake:${key}`);
      }
      records.sort((a, b) => (b.at || 0) - (a.at || 0));
      if (gen === this.#loadGen && !this.#stocktakeCache.has(key)) this.#stocktakeCache.set(key, records);
      return this.#stocktakeCache.get(key) ?? records;
    })().finally(() => this.#stocktakeLoading.delete(key));
    this.#stocktakeLoading.set(key, load);
    return load;
  }

  async #persistStocktakeMonth(key) {
    if (!this.stocktakeMonths.includes(key)) {
      const prev = this.stocktakeMonths;
      this.stocktakeMonths = [...prev, key].sort().reverse();
      try {
        await this.#kvSet(KV.stocktakeMonths, this.stocktakeMonths);
      } catch (err) {
        this.stocktakeMonths = prev;
        throw err;
      }
    }
    await this.#queueWrite(`stocktake:${key}`, async () => {
      const cached = this.#stocktakeCache.get(key) || [];
      await this.#absorbUnreadFile(`stocktake:${key}`, stocktakePath(key), cached,
        (r) => r?.id, (a, b) => (b.at || 0) - (a.at || 0));
      return puter.fs.write(stocktakePath(key), JSON.stringify(cached), { createMissingParents: true });
    });
  }

  /** Posted counts, newest first, across the most recent months on file. */
  async recentStocktakes({ monthsToScan = 12, limit = 12 } = {}) {
    const out = [];
    for (const key of this.stocktakeMonths.slice(0, monthsToScan)) {
      for (const record of await this.loadStocktakeMonth(key)) {
        out.push(record);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  /**
   * Post the open count: every variance at once.
   *
   * Each line moves the level by counted-minus-expected-when-counted, applied
   * to the level as it stands now, so a sale rung up during the count is
   * preserved rather than undone. Every non-zero line lands in the existing
   * movement ledger with a `stocktake` reason and this session's id, so a
   * product's own history still explains itself.
   *
   * Ordered like adjustStock: the ledger and the record are made durable
   * first - a level that moved with no record of why is the state this whole
   * feature exists to end - and a failed levels write takes both back out.
   */
  async postStocktake() {
    const session = this.stocktake;
    if (!session) throw new Error('There’s no open count.');
    const plan = this.stocktakePlan(session);
    if (!plan.counted) throw new Error('Nothing has been counted yet.');

    // A mis-posted count moves every level at once; the way back is taken
    // first, while the levels are still what they were.
    await this.autoSnapshot('stocktake');

    const date = todayISO();
    const key = monthKeyOf(date);
    const filed = await this.loadStocktakeMonth(key);
    // Another device may have posted this very session; posting it again
    // would apply every variance twice.
    if (filed.some((r) => r.id === session.id)) {
      this.#markStocktakePosted(session.id);
      throw new Error('That count has already been posted.');
    }

    const at = Date.now();
    const category = session.categoryId ? this.category(session.categoryId) : null;
    const record = {
      id: session.id,
      at,
      date,
      startedAt: session.startedAt,
      blind: !!session.blind,
      categoryId: session.categoryId || null,
      categoryName: category?.name || '',
      currency: this.settings.currency,
      counted: plan.counted,
      skipped: plan.skipped,
      varianceCount: plan.variances.length,
      unitsShort: plan.unitsShort,
      unitsOver: plan.unitsOver,
      value: plan.value,
      unknownCost: plan.unknownCost,
      lines: plan.lines,
    };

    const entries = plan.variances.map((l) => ({
      id: uid(),
      at,
      reason: 'stocktake',
      sessionId: session.id,
      note: '',
      productId: l.productId,
      name: l.name,
      unit: l.unit,
      delta: l.delta,
      // Filled in below, against the level the change actually lands on.
      level: 0,
    }));

    const levels = new Map();
    for (const l of plan.variances) {
      const current = this.product(l.productId);
      // Deleted, or stopped tracking stock, while the count was open: there
      // is no shelf to correct, and the record still says it was counted.
      if (!current || current.stock === null || current.stock === undefined) continue;
      levels.set(l.productId, Math.round((current.stock + l.delta) * 1000) / 1000);
    }
    for (const entry of entries) {
      entry.level = levels.has(entry.productId)
        ? levels.get(entry.productId)
        : Math.round((Number(this.product(entry.productId)?.stock) || 0) * 1000) / 1000;
    }

    if (entries.length) await this.#appendStock(entries);

    const removeLedger = () => {
      if (!entries.length) return;
      const gone = new Set(entries.map((e) => e.id));
      const monthKey = monthKeyOf(todayISO());
      const cached = this.#stockCache.get(monthKey);
      if (!cached) return;
      this.#stockCache.set(monthKey, cached.filter((m) => !gone.has(m.id)));
      this.#persistStockMonth(monthKey).catch(() => {});
    };

    filed.unshift(record);
    try {
      await this.#persistStocktakeMonth(key);
    } catch (err) {
      const at2 = filed.findIndex((r) => r.id === record.id);
      if (at2 >= 0) filed.splice(at2, 1);
      removeLedger();
      throw err;
    }

    const before = this.#snapshot();
    this.products = this.products.map((p) => (levels.has(p.id) ? { ...p, stock: levels.get(p.id) } : p));
    this.emit();
    try {
      await this.#commit(before, [KV.products]);
    } catch (err) {
      const at2 = filed.findIndex((r) => r.id === record.id);
      if (at2 >= 0) filed.splice(at2, 1);
      this.#persistStocktakeMonth(key).catch(() => {});
      removeLedger();
      throw err;
    }

    // The levels are in. From here the session must never come back.
    this.#markStocktakePosted(session.id);
    clearTimeout(this.#stocktakeTimer);
    this.#stocktakeTimer = null;
    this.stocktake = null;
    this.emit();
    // A failed clear is harmless: the posted marker refuses this session on
    // this device, and the next boot clears the stale kv value outright.
    this.#kvSet(KV.stocktake, null).catch(() => {});
    return record;
  }

  /** The last `limit` movements for one product, newest first. */
  async stockMovementsFor(productId, { limit = 8, monthsToScan = 6 } = {}) {
    const out = [];
    for (const key of this.stockMonths.slice(0, monthsToScan)) {
      const movements = await this.loadStockMonth(key);
      for (const m of movements) {
        if (m.productId !== productId) continue;
        out.push(m);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  /* ---------- Automatic snapshots (restore points nobody has to make) ---------- */

  /**
   * When snapshots last failed on this device, and why.
   *
   * Local, not in the cloud: the thing that fails is a cloud write, so
   * recording the failure there would fail too. Settings reads this to warn -
   * a backup that quietly stopped working is worse than none.
   */
  #snapshotErrorKey = 'pos:snapshot-error:v1:anon';

  snapshotError() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.#snapshotErrorKey));
      return saved && saved.at ? { at: Number(saved.at), why: String(saved.why || '') } : null;
    } catch {
      return null;
    }
  }

  #noteSnapshotError(err) {
    try {
      if (!err) localStorage.removeItem(this.#snapshotErrorKey);
      else {
        localStorage.setItem(this.#snapshotErrorKey, JSON.stringify({
          at: Date.now(),
          why: String(err.message || err).slice(0, 120),
        }));
      }
    } catch { /* the warning is then simply not shown */ }
  }

  /** True when the shop has asked for automatic restore points (the default). */
  get snapshotsOn() {
    return this.settings?.autoSnapshot !== false;
  }

  /** What every snapshot on file costs in storage, together. */
  snapshotBytes() {
    return this.snapshots.reduce((a, s) => a + (Number(s.bytes) || 0), 0);
  }

  /**
   * Write a restore point.
   *
   * The exporter is the one the Export JSON button already uses, so a snapshot
   * and a hand-taken backup are the same file - and restore through the same
   * previewed, validated path. Old ones are pruned to the retention plan
   * afterwards, and a failed prune only leaves bytes behind.
   */
  async takeSnapshot(reason = 'manual') {
    const at = Date.now();
    const file = snapshotName(at, reason);
    const path = snapshotPath(file);
    if (!path) throw new Error('Couldn’t name that snapshot.');
    const data = await this.exportAll();
    const json = JSON.stringify(data);
    const bytes = new TextEncoder().encode(json).length;
    await puter.fs.write(path, json, { createMissingParents: true });

    const entry = {
      file,
      at,
      reason,
      bytes,
      products: data.products.length,
      receipts: Object.values(data.sales || {}).reduce((a, list) => a + list.length, 0),
      customers: data.customers.length,
      months: Object.keys(data.sales || {}).length,
    };
    const prev = this.snapshots;
    this.snapshots = cleanSnapshots([entry, ...prev]);
    try {
      await this.#kvSet(KV.snapshots, this.snapshots);
    } catch (err) {
      // The file is on disk but nothing points at it: an orphan is better
      // than an index claiming a restore point that isn't there, so the
      // index stays as it was and the write is reported as failed.
      this.snapshots = prev;
      throw err;
    }
    this.#noteSnapshotError(null);
    this.emit();
    // Best effort, and after the index: pruning is housekeeping, and a
    // failure here costs storage rather than a restore point.
    this.#pruneSnapshots().catch((err) => console.error(err));
    return entry;
  }

  async #pruneSnapshots() {
    const { keep, prune } = retentionPlan(this.snapshots);
    if (!prune.length) return;
    this.snapshots = keep;
    await this.#kvSet(KV.snapshots, this.snapshots);
    this.emit();
    await Promise.all(prune.map((entry) => {
      const path = snapshotPath(entry.file);
      return path ? puter.fs.delete(path).catch(() => {}) : null;
    }));
  }

  /**
   * Take one automatically, if it is wanted and worth taking.
   *
   * Never throws and never blocks: this rides in front of destructive
   * actions, and a shop must not be stopped from restoring a backup because
   * the snapshot before it couldn't be written. It returns what happened so
   * the caller can say so.
   */
  async autoSnapshot(reason) {
    if (!this.snapshotsOn) return null;
    // Nothing to lose yet - a fresh account's first sample install.
    if (!this.products.length && !this.monthsWithSales().length && !this.customers.length) return null;
    // Two snapshots a minute apart are one restore point.
    const newest = this.snapshots[0]?.at || 0;
    if (Date.now() - newest < MIN_GAP_MS) return null;
    try {
      return await this.takeSnapshot(reason);
    } catch (err) {
      console.error(err);
      this.#noteSnapshotError(err);
      this.emit();
      return null;
    }
  }

  /**
   * The daily one, for the boot path. Silent, and skipped when a snapshot
   * from any cause is recent enough to serve as today's.
   */
  async dailySnapshot() {
    if (!this.snapshotsOn) return null;
    const newest = this.snapshots[0]?.at || 0;
    if (Date.now() - newest < DAILY_INTERVAL_MS) return null;
    return this.autoSnapshot('daily');
  }

  /** Read a snapshot back, for the restore preview to validate and show. */
  async readSnapshot(file) {
    const path = snapshotPath(file);
    if (!path) throw new Error('That restore point is no longer here.');
    const blob = await puter.fs.read(path);
    return JSON.parse(await blob.text());
  }

  /** Forget a restore point: out of the index first, then off the disk. */
  async deleteSnapshot(file) {
    const prev = this.snapshots;
    this.snapshots = prev.filter((s) => s.file !== file);
    this.emit();
    try {
      await this.#kvSet(KV.snapshots, this.snapshots);
    } catch (err) {
      this.snapshots = prev;
      this.emit();
      throw err;
    }
    const path = snapshotPath(file);
    if (path) await puter.fs.delete(path).catch(() => {});
  }

  /* ---------- Whole-dataset import/export (sample data, backups) ---------- */

  /**
   * Receipts fit to file: junk entries dropped, `pendingSync` stripped.
   *
   * The flag is a note about *this device* - "still in the outbox" - not part
   * of the sale. A backup carrying it would restore receipts that look queued
   * with nothing queued: badged forever, unrefundable, and excluded from the
   * next write of their month file, which would erase them from history.
   * Junk (a null, a receipt without an id - a hand-edited file can hold
   * anything) would crash every later read of its month.
   */
  static #landed(receipts) {
    return receipts
      .filter((r) => r && typeof r === 'object' && r.id)
      .map(({ pendingSync, ...receipt }) => receipt);
  }

  async exportAll() {
    const sales = {};
    for (const key of this.monthsWithSales()) {
      sales[key] = Store.#landed(await this.loadMonth(key));
    }
    const drawers = {};
    for (const key of this.drawerMonths) {
      drawers[key] = await this.loadDrawerMonth(key);
    }
    const stockMovements = {};
    for (const key of this.stockMonths) {
      stockMovements[key] = await this.loadStockMonth(key);
    }
    const stocktakes = {};
    for (const key of this.stocktakeMonths) {
      stocktakes[key] = await this.loadStocktakeMonth(key);
    }
    // The PIN record stays home. It hashes a 4-6 digit code, a space any
    // holder of the file searches in moments - and backups travel: mailed to
    // bookkeepers, parked in shared folders. The account is the authority;
    // a restored register keeps the PIN of the device doing the restoring.
    const { pin, ...settings } = this.settings;
    return {
      app: 'point-of-sale',
      version: 1,
      exportedAt: Date.now(),
      settings,
      drawers,
      stockMovements,
      stocktakes,
      products: this.products,
      categories: this.categories,
      taxes: this.taxes,
      discounts: this.discounts,
      customers: this.customers,
      credit: this.credit,
      sales,
    };
  }

  /**
   * The receipt counter a restore continues from. It must be a number -
   * "1001" + 1 concatenates instead of counting - and when the backup's
   * value is unusable, the only safe floor is above every number the
   * restored history already issued.
   */
  static #importedNextReceipt(value, salesByMonth) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 1) return Math.round(n);
    let max = 0;
    for (const list of Object.values(salesByMonth)) {
      for (const receipt of list) max = Math.max(max, Number(receipt?.number) || 0);
    }
    return Math.max(max + 1, DEFAULT_SETTINGS.nextReceipt);
  }

  /**
   * Replace the whole dataset - the sample-data install and its wipe both
   * run through here so there's exactly one hardened path.
   */
  async importAll(data, { snapshotReason = 'restore' } = {}) {
    if (data?.app !== 'point-of-sale' || !data.settings) throw new Error('Not a Point of Sale export.');
    // The one moment a shop most needs a way back is the moment it is least
    // likely to have made one. Best effort by design: a restore must not be
    // refused because the snapshot in front of it couldn't be written.
    await this.autoSnapshot(snapshotReason);
    const incoming = data.sales || {};
    const newMonths = Object.keys(incoming).sort().reverse();
    // Month keys name the files written below - refuse anything else rather
    // than writing a path this app didn't design.
    if (newMonths.some((k) => !isMonthKey(k) || !Array.isArray(incoming[k]))) {
      throw new Error('Sales history in this export is damaged.');
    }
    const staleMonths = this.months.filter((k) => !newMonths.includes(k));
    // Restoring is landing this history for good, so nothing may arrive still
    // marked as waiting on a device - not even from a backup written before
    // exportAll started stripping the flag.
    const restored = Object.fromEntries(newMonths.map((k) => [k, Store.#landed(incoming[k])]));
    const { pin: foreignPin, ...importedSettings } = data.settings;
    const settings = {
      ...importedSettings,
      // The store's own text gets the same trim and ceiling the fields that
      // type it enforce. Uncapped, a backup could plant a name or a footer no
      // keyboard here could have entered - into the sidebar, the window
      // title, every receipt header, and the settings entry every boot reads.
      ...cleanStoreText(importedSettings),
      // A backup's PIN record is not installed: an old export's would lock
      // this register behind a code nobody here set (and exports no longer
      // carry one). Whatever PIN guards this device today keeps guarding it.
      pin: this.settings?.pin ?? null,
      logo: cleanLogo(importedSettings.logo),
      quickNotes: cleanQuickNotes(importedSettings.quickNotes),
      // Like the logo and the quick notes beside them: the receipt path
      // sanitizes these on the way out, but the stored value was whatever
      // arrived, and the tax summary read it straight.
      registrations: cleanRegistrations(importedSettings.registrations),
      nextReceipt: Store.#importedNextReceipt(data.settings.nextReceipt, restored),
    };

    // Records get the same hygiene the interactive paths apply, not just the
    // junk-entry filter: a hand-edited backup can carry a numeric name or an
    // options string, which passes every container check and then crashes
    // the catalog views (localeCompare, charAt) and the register's option
    // picker - after the old dataset is gone. Ids and stamps are preserved;
    // a stored stock level means the product tracks stock.
    const products = (Array.isArray(data.products) ? data.products : [])
      .filter((p) => p && p.id)
      .map((p) => ({
        id: p.id,
        createdAt: Number(p.createdAt) || Date.now(),
        // The grid's arrangement and its pinned tiles travel with the
        // catalog: a restored register opens looking like the one that was
        // backed up. Both are absent on a catalog nobody has arranged.
        ...(p.favorite ? { favorite: true } : {}),
        ...(Number.isFinite(Number(p.sortOrder))
          ? { sortOrder: Math.round(Number(p.sortOrder)) }
          : {}),
        ...Store.#cleanProduct({
          ...p,
          trackStock: p.stock !== null && p.stock !== undefined,
          // Number(null) is 0: a product with no threshold would come back
          // alerting at zero instead of using the app default.
          lowStock: p.lowStock ?? NaN,
        }),
      }));
    const categories = (Array.isArray(data.categories) ? data.categories : [])
      .filter((c) => c && c.id)
      .map((c) => ({ id: c.id, name: String(c.name || '').trim() }));
    const taxes = (Array.isArray(data.taxes) ? data.taxes : [])
      .filter((t) => t && t.id)
      .map((t) => ({ id: t.id, name: String(t.name || '').trim() || 'Tax', rate: Store.#cleanRate(t.rate) }));
    const discounts = (Array.isArray(data.discounts) ? data.discounts : [])
      .filter((d) => d && d.id)
      .map((d) => {
        const v = Math.abs(Number(d.value) || 0);
        return {
          id: d.id,
          name: String(d.name || '').trim() || 'Discount',
          type: d.type === 'fixed' ? 'fixed' : 'percent',
          value: d.type === 'fixed' ? round2(v) : Math.min(100, v),
        };
      });
    const customers = (Array.isArray(data.customers) ? data.customers : [])
      .filter((c) => c && c.id)
      .map((c) => ({ id: c.id, createdAt: Number(c.createdAt) || Date.now(), ...Store.#cleanCustomer(c) }))
      .filter((c) => c.name);
    // The credit ledger travels with the customers it belongs to. Entries for
    // customers the backup doesn't hold are dropped: a balance nobody can be
    // shown, and nobody can spend, is only a wrong liability figure.
    const known = new Set(customers.map((c) => c.id));
    const credit = Store.#cleanCredit(data.credit).filter((e) => known.has(e.customerId));

    const incomingDrawers = data.drawers || {};
    const newDrawerMonths = Object.keys(incomingDrawers).sort().reverse();
    if (newDrawerMonths.some((k) => !isMonthKey(k) || !Array.isArray(incomingDrawers[k]))) {
      throw new Error('Drawer history in this export is damaged.');
    }
    const staleDrawerMonths = this.drawerMonths.filter((k) => !newDrawerMonths.includes(k));
    // Same hygiene the month loaders apply on read, so the files land clean.
    const restoredDrawers = Object.fromEntries(newDrawerMonths.map((k) =>
      [k, incomingDrawers[k].filter((d) => d && d.date)]));

    // Older backups simply have no ledger; that's an empty one, not damage.
    const incomingStock = data.stockMovements || {};
    const newStockMonths = Object.keys(incomingStock).sort().reverse();
    if (newStockMonths.some((k) => !isMonthKey(k) || !Array.isArray(incomingStock[k]))) {
      throw new Error('Stock history in this export is damaged.');
    }
    const staleStockMonths = this.stockMonths.filter((k) => !newStockMonths.includes(k));
    const restoredStock = Object.fromEntries(newStockMonths.map((k) =>
      [k, incomingStock[k].filter((m) => m && m.id)]));

    // Posted counts, same treatment; older backups simply have none.
    const incomingCounts = data.stocktakes || {};
    const newCountMonths = Object.keys(incomingCounts).sort().reverse();
    if (newCountMonths.some((k) => !isMonthKey(k) || !Array.isArray(incomingCounts[k]))) {
      throw new Error('Stocktake history in this export is damaged.');
    }
    const staleCountMonths = this.stocktakeMonths.filter((k) => !newCountMonths.includes(k));
    const restoredCounts = Object.fromEntries(newCountMonths.map((k) =>
      [k, incomingCounts[k].filter((r) => r && r.id)]));

    // Parked sales and the in-progress cart belong to the dataset being
    // replaced; a pending draft write must not land after the wipe.
    clearTimeout(this.#draftTimer);
    this.#draftTimer = null;
    this.draft = null;
    this.holds = [];
    this.#draftRestored = false;
    // An open count belongs to the catalog being replaced: its expected
    // levels describe products that may not exist in the new one.
    clearTimeout(this.#stocktakeTimer);
    this.#stocktakeTimer = null;
    this.stocktake = null;

    // Ordered so a restore that dies part-way leaves an account that still
    // reads coherently, not a blend. Data files land before the indexes
    // that name them: an index written first would point at months that
    // never arrived - they'd read as empty and the next sale would write
    // over whatever the old dataset had there. Until the indexes flip, the
    // old ones keep naming intact old files. Collections follow, and
    // settings go last, so the currency, the receipt counter, and the
    // sample banner describe data that actually exists.
    await Promise.all([
      ...newMonths.map((k) => puter.fs.write(monthPath(k), JSON.stringify(restored[k]), { createMissingParents: true })),
      ...newDrawerMonths.map((k) => puter.fs.write(drawerPath(k), JSON.stringify(restoredDrawers[k]), { createMissingParents: true })),
      ...newStockMonths.map((k) => puter.fs.write(stockPath(k), JSON.stringify(restoredStock[k]), { createMissingParents: true })),
      ...newCountMonths.map((k) => puter.fs.write(stocktakePath(k), JSON.stringify(restoredCounts[k]), { createMissingParents: true })),
    ]);
    await Promise.all([
      this.#kvSet(KV.months, newMonths),
      this.#kvSet(KV.drawers, newDrawerMonths),
      this.#kvSet(KV.stockMonths, newStockMonths),
      this.#kvSet(KV.stocktakeMonths, newCountMonths),
    ]);
    await Promise.all([
      this.#kvSet(KV.products, products),
      this.#kvSet(KV.categories, categories),
      this.#kvSet(KV.taxes, taxes),
      this.#kvSet(KV.discounts, discounts),
      this.#kvSet(KV.customers, customers),
      this.#kvSet(KV.credit, credit),
      this.#kvSet(KV.holds, []),
      this.#kvSet(KV.draft, null),
      this.#kvSet(KV.stocktake, null),
    ]);
    await this.#kvSet(KV.settings, settings);
    // Old month files not in the new dataset are best-effort deletes: the
    // index no longer references them, so a failure only leaves orphans.
    await Promise.all([
      ...staleMonths.map((k) => puter.fs.delete(monthPath(k)).catch(() => {})),
      ...staleDrawerMonths.map((k) => puter.fs.delete(drawerPath(k)).catch(() => {})),
      ...staleStockMonths.map((k) => puter.fs.delete(stockPath(k)).catch(() => {})),
      ...staleCountMonths.map((k) => puter.fs.delete(stocktakePath(k)).catch(() => {})),
    ]);

    this.#loadGen++;
    this.#saleCache.clear();
    this.#saleLoading.clear();
    this.#drawerCache.clear();
    this.#drawerLoading.clear();
    this.#stockCache.clear();
    this.#stockLoading.clear();
    this.#stocktakeCache.clear();
    this.#stocktakeLoading.clear();
    // The restore itself wrote every file it indexes; those are known
    // ground, everything else starts unconfirmed again.
    this.#diskConfirmed = new Set([
      ...newMonths.map((k) => `sales:${k}`),
      ...newDrawerMonths.map((k) => `drawer:${k}`),
      ...newStockMonths.map((k) => `stock:${k}`),
      ...newCountMonths.map((k) => `stocktake:${k}`),
    ]);
    // Queued sales belonged to the dataset being replaced - and so did any
    // stock moves still waiting to be made durable.
    this.outbox.clear();
    this.#stockDebt = [];
    this.#writeStockDebt();
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.products = products;
    this.categories = categories;
    this.taxes = taxes;
    this.discounts = discounts;
    this.customers = customers;
    this.credit = credit;
    this.months = newMonths;
    for (const k of newMonths) {
      this.#saleCache.set(k, restored[k].sort(byNewest));
    }
    this.drawerMonths = newDrawerMonths;
    for (const k of newDrawerMonths) {
      this.#drawerCache.set(k, [...restoredDrawers[k]].sort((a, b) => (a.date < b.date ? 1 : -1)));
    }
    this.stockMonths = newStockMonths;
    for (const k of newStockMonths) {
      this.#stockCache.set(k, [...restoredStock[k]].sort((a, b) => (b.at || 0) - (a.at || 0)));
    }
    this.stocktakeMonths = newCountMonths;
    for (const k of newCountMonths) {
      this.#stocktakeCache.set(k, [...restoredCounts[k]].sort((a, b) => (b.at || 0) - (a.at || 0)));
    }
    // Views holding working copies of their own (the register's open cart)
    // must drop them: those lines belong to the dataset that was just
    // replaced, and re-rendering them would plant it as the new one's draft.
    this.emit('replace');
    this.emit();
  }
}

export const store = new Store();
export { Store };
