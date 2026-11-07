/**
 * Create transactions from recurring templates whose date has come. Runs on
 * app start (and on demand). Each created transaction goes through saveTxn,
 * so validation and the closing date apply exactly as for manual entries.
 */
import { dueDates, afterCreating } from './recurring.js';
import { dueDateFor, TXN_TYPES } from './txn.js';
import { newId } from './ids.js';

/**
 * The id is derived from the template and the date, so two devices that both
 * create the same occurrence write the same record instead of a duplicate.
 */
export function occurrenceId(r, date) {
  return `${r.id}-${date.replace(/-/g, '')}`;
}

export function createFromTemplate(store, r, date) {
  const id = r.id ? occurrenceId(r, date) : newId();
  if (store.txn(id)) return store.txn(id);
  const t = { ...structuredClone(r.template || {}), type: r.type, date, id, recurringId: r.id };
  delete t.attachments;
  if (TXN_TYPES[r.type]?.numbered) t.num = store.nextNumber(r.type);
  if ((r.type === 'invoice' || r.type === 'bill') && t.terms) t.dueDate = dueDateFor(date, t.terms, store.settings.terms);
  else if (r.type === 'invoice' || r.type === 'bill') t.dueDate = date;
  return store.saveTxn(t);
}

/** Returns how many transactions were created. */
export function runRecurring(store, { only = null, includeReminders = false, cap = 24 } = {}) {
  let created = 0;
  for (const r of [...store.recurring.values()]) {
    if (only && r.id !== only) continue;
    if (r.mode === 'reminder' && !includeReminders) continue;
    const dates = dueDates(r, store.clock(), cap);
    let n = 0;
    // Dates in a closed period cannot be created; step past them so the
    // schedule carries on in the open period instead of stopping for good.
    let skipped = 0;
    for (const d of dates) {
      if (!n && store.isLocked(d)) { skipped++; continue; }
      try {
        createFromTemplate(store, r, d);
        n++;
      } catch {
        break;
      }
    }
    if (n || skipped) {
      store.put('recurring', afterCreating(r, n + skipped));
      created += n;
    }
  }
  return created;
}
