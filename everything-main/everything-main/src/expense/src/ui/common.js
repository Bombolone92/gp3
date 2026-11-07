/** Shared view pieces: category dots, status badges, expense rows, empty states. */

import { el } from './dom.js';
import { icon } from './icons.js';
import { receiptURL, isPdf } from './receipt.js';
import { store } from '../lib/store.js';
import { formatMoney } from '../lib/money.js';
import { friendlyDay, formatDate } from '../lib/dates.js';
import { STATUS_LABEL } from '../lib/reports.js';
import { groupBy } from '../lib/util.js';

export function catColor(cat) {
  return cat?.slot ? `var(--series-${cat.slot})` : 'var(--ink-3)';
}

export function catDot(cat, { sm = false } = {}) {
  return el(`span.cat-dot${sm ? '.sm' : ''}`, {
    style: { '--cat': catColor(cat) },
    html: icon(cat?.icon || 'tag', sm ? 14 : 18, 1.9),
    'aria-hidden': 'true',
  });
}

const STATUS_ICON = { draft: 'pencil', submitted: 'send', approved: 'badge', reimbursed: 'banknote' };

export function statusBadge(status) {
  return el(`span.badge.${status}`, { html: icon(STATUS_ICON[status] || 'circleDashed', 12, 2.4) }, STATUS_LABEL[status] || status);
}

/** Thumbnail: the receipt image when there is one, otherwise the category dot. */
export function expenseThumb(exp) {
  const cat = store.category(exp.categoryId);
  if (!exp.receiptPath) return catDot(cat);
  if (isPdf(exp)) {
    return el('span.cat-dot', { style: { '--cat': 'var(--ink-2)' }, html: icon('file', 18, 1.9), 'aria-hidden': 'true' });
  }
  const holder = catDot(cat);
  receiptURL(exp).then((url) => {
    if (!url || !holder.isConnected) return;
    const img = el('img.receipt-thumb', { src: url, alt: '', loading: 'lazy' });
    holder.replaceWith(img);
  });
  return holder;
}

/**
 * One expense in a list. `onClick` makes it a button; `trail` replaces the
 * default amount column; `context` chooses which secondary facts to show.
 */
export function expenseRow(exp, { onClick = null, trail = null, showDate = true, showReport = false, selected = null, onToggle = null } = {}) {
  const cat = store.category(exp.categoryId);
  const report = exp.reportId ? store.report(exp.reportId) : null;
  const sub = el('div.sub', {},
    el('span', {}, cat?.name || 'Uncategorised'),
    showDate && el('span.sep', {}, formatDate(exp.date, { year: undefined })),
    showReport && report && el('span.sep.truncate', {}, report.title),
    exp.receiptPath && el('span.flag', { html: icon('receipt', 12, 2.2), title: 'Has receipt', 'aria-label': 'Has receipt' }),
    exp.reconciled && el('span.flag.ok', { html: icon('circleCheck', 12, 2.2), title: 'Reconciled', 'aria-label': 'Reconciled' })
  );
  const children = [
    onToggle && el('input.check', {
      type: 'checkbox', checked: !!selected, 'aria-label': `Select ${exp.merchant || 'expense'}`,
      onclick: (e) => { e.stopPropagation(); onToggle(e.target.checked); },
    }),
    expenseThumb(exp),
    el('div.grow', {},
      el('div.title.truncate', {}, exp.merchant || 'Unknown merchant'),
      sub
    ),
    trail || el('div.amount', {}, formatMoney(exp.amount, exp.currency)),
  ];
  if (onClick) return el('button.list-row', { type: 'button', onclick: onClick }, children);
  return el('div.list-row.static', {}, children);
}

/** Expenses grouped under day headings with a per-day total. */
export function expenseListByDay(expenses, rowOpts = {}, { totals = true } = {}) {
  const groups = groupBy(expenses, (e) => e.date);
  const frag = document.createDocumentFragment();
  for (const [date, items] of groups) {
    const byCur = new Map();
    for (const e of items) byCur.set(e.currency, (byCur.get(e.currency) || 0) + e.amount);
    frag.append(
      el('div.list-group-head', {},
        el('span', {}, friendlyDay(date)),
        totals && el('span.num', {}, [...byCur].map(([c, a]) => formatMoney(a, c)).join(' + '))
      ),
      el('div.list', {}, items.map((e) => expenseRow(e, typeof rowOpts === 'function' ? rowOpts(e) : { ...rowOpts, showDate: false })))
    );
  }
  return frag;
}

export function emptyState({ icon: ic = 'receipt', title, text, action = null }) {
  return el('div.empty', {},
    el('div.empty-icon', { html: icon(ic, 26) }),
    el('h3', {}, title),
    text && el('p', {}, text),
    action && el('button.btn.btn-primary', { type: 'button', html: action.icon ? icon(action.icon, 16, 2.2) : '', onclick: action.onClick }, action.label)
  );
}

export function skeletonList(n = 4) {
  return el('div.list', {}, Array.from({ length: n }, () =>
    el('div.list-row.static', {},
      el('span.skeleton', { style: { width: '38px', height: '38px', borderRadius: '12px' } }),
      el('div.grow', {},
        el('div.skeleton', { style: { width: '46%', height: '14px', marginBottom: '8px' } }),
        el('div.skeleton', { style: { width: '30%', height: '11px' } })),
      el('span.skeleton', { style: { width: '64px', height: '16px' } })
    )));
}

export function sectionHead(title, action = null) {
  return el('div.card-head', {}, el('h2.card-title', {}, title), action);
}

/** Small loader line for async panels. */
export function loadingLine(text = 'Loading') {
  return el('div.loading-line', { html: icon('spinner', 16, 2.2) }, el('span', {}, text));
}
