/** Display helpers bound to the company's settings. */
import { el } from './dom.js';
import { formatMoney } from '../lib/money.js';
import { formatDate } from '../lib/dates.js';

export function money(cents, opts) {
  return formatMoney(cents, opts);
}

/** A right-aligned amount cell; negatives in the negative color. */
export function amountNode(cents, { strong = false, blankZero = false, plain = false } = {}) {
  if (cents === null || cents === undefined || (blankZero && !cents)) return el('span', {}, '');
  return el(`span.money${cents < 0 ? '.neg' : ''}`, { style: strong ? { fontWeight: 600 } : null }, formatMoney(cents, { plain }));
}

export function dateText(iso) {
  return formatDate(iso);
}

const STATUS_BADGE = {
  paid: 'positive', closed: 'neutral', open: 'info', partial: 'warning', overdue: 'negative', voided: 'neutral',
  pending: 'info', accepted: 'positive', rejected: 'negative', converted: 'positive', expired: 'warning',
};

export function statusBadge(status) {
  if (!status?.label) return el('span');
  const kind = STATUS_BADGE[status.code] || 'neutral';
  return el(`span.badge${kind !== 'neutral' ? `.badge-${kind}` : ''}`, {}, el('span.dot'), status.label);
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}
