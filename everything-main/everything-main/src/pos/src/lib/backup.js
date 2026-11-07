/**
 * Reading a backup file produced by Settings → Export JSON.
 *
 * Validation is deliberately paranoid and happens *before* anything is
 * written: store.importAll() replaces the whole dataset, so a half-checked
 * file would be a half-imported account. Every rejection carries a reason
 * the cashier can act on.
 */

import { isMonthKey } from './dates.js';

export const BACKUP_APP = 'point-of-sale';
/** Format version this build writes and is able to read. */
export const BACKUP_VERSION = 1;

/** Sanity cap before JSON.parse - a real backup is orders of magnitude smaller. */
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

const NOT_OURS = 'That file isn’t a Point of Sale backup.';
const DAMAGED = 'That backup file is damaged.';

/** A rejection with a message meant for the user, not the console. */
export class BackupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupError';
  }
}

const count = (v) => (Array.isArray(v) ? v.length : 0);

/**
 * Validate a parsed backup and describe it for the pre-import preview.
 * Throws BackupError on anything we won't import.
 */
export function summarizeBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BackupError(NOT_OURS);
  if (data.app !== BACKUP_APP) throw new BackupError(NOT_OURS);

  // Version missing = the shape predates the field; treat it as 1.
  const version = data.version === undefined || data.version === null ? 1 : Number(data.version);
  if (!Number.isInteger(version) || version < 1) throw new BackupError(DAMAGED);
  if (version > BACKUP_VERSION) {
    throw new BackupError('This backup is from a newer version of Point of Sale. Update the app, then restore it.');
  }

  if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
    throw new BackupError('That backup is missing its store settings.');
  }
  for (const key of ['products', 'categories', 'taxes', 'discounts', 'customers', 'credit']) {
    if (data[key] !== undefined && data[key] !== null && !Array.isArray(data[key])) throw new BackupError(DAMAGED);
  }

  const sales = data.sales ?? {};
  if (typeof sales !== 'object' || Array.isArray(sales)) throw new BackupError(DAMAGED);
  const months = Object.keys(sales).sort();
  let receipts = 0;
  for (const key of months) {
    // Month keys name the files importAll writes - only real ones get through.
    if (!isMonthKey(key) || !Array.isArray(sales[key])) throw new BackupError(DAMAGED);
    receipts += sales[key].length;
  }

  // Drawer history gets the same scrutiny as sales: its month keys name files
  // too, and importAll refuses what's rejected here - a file that only fails
  // *after* the preview said it looked fine would read as a network problem.
  const drawers = data.drawers ?? {};
  if (typeof drawers !== 'object' || Array.isArray(drawers)) throw new BackupError(DAMAGED);
  let drawerDays = 0;
  for (const key of Object.keys(drawers)) {
    if (!isMonthKey(key) || !Array.isArray(drawers[key])) throw new BackupError(DAMAGED);
    drawerDays += drawers[key].length;
  }

  // The stock ledger is optional (older backups predate it) but validated
  // the same way: its month keys name files importAll writes.
  const stockMovements = data.stockMovements ?? {};
  if (typeof stockMovements !== 'object' || Array.isArray(stockMovements)) throw new BackupError(DAMAGED);
  let stockMoves = 0;
  for (const key of Object.keys(stockMovements)) {
    if (!isMonthKey(key) || !Array.isArray(stockMovements[key])) throw new BackupError(DAMAGED);
    stockMoves += stockMovements[key].length;
  }

  // Posted stocktakes, same shape and the same scrutiny; older backups have
  // none, which is an empty history rather than damage.
  const stocktakes = data.stocktakes ?? {};
  if (typeof stocktakes !== 'object' || Array.isArray(stocktakes)) throw new BackupError(DAMAGED);
  let counts = 0;
  for (const key of Object.keys(stocktakes)) {
    if (!isMonthKey(key) || !Array.isArray(stocktakes[key])) throw new BackupError(DAMAGED);
    counts += stocktakes[key].length;
  }

  // Photo *stamps* travel on products; the image files themselves are not
  // in a JSON backup - the preview says so instead of losing them silently.
  const photos = Array.isArray(data.products) ? data.products.filter((p) => p?.photo).length : 0;

  const exportedAt = Number(data.exportedAt);
  return {
    version,
    storeName: String(data.settings.storeName || '').trim(),
    currency: data.settings.currency || 'USD',
    nextReceipt: Number.isFinite(Number(data.settings.nextReceipt)) ? Number(data.settings.nextReceipt) : null,
    sampleData: !!data.settings.sampleData,
    products: count(data.products),
    categories: count(data.categories),
    taxes: count(data.taxes),
    discounts: count(data.discounts),
    customers: count(data.customers),
    creditEntries: count(data.credit),
    months,
    receipts,
    drawerDays,
    stockMoves,
    stocktakes: counts,
    photos,
    exportedAt: Number.isFinite(exportedAt) && exportedAt > 0 ? exportedAt : null,
  };
}

/** Read + parse + validate a picked File. Resolves { data, summary }. */
export async function readBackupFile(file) {
  if (!file) throw new BackupError('No file chosen.');
  if (!file.size) throw new BackupError('That file is empty.');
  if (file.size > MAX_BACKUP_BYTES) throw new BackupError('That file is far too large to be a Point of Sale backup.');

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new BackupError('That file isn’t valid JSON.');
  }
  return { data, summary: summarizeBackup(data) };
}
