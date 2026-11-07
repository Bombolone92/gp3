/** Read-only pieces for service entry and work order pages. */
import { h } from '../ui/dom.js';
import { app, lookup } from '../app.js';
import { lineLabor, lineParts, docTotals } from '../core/totals.js';
import { formatDecimal } from '../core/format.js';
import { formatDate } from '../core/dates.js';
import { statusPill } from '../ui/components.js';
import { money, sectionCard, miniEmpty } from './common.js';

export function lineItemsView(doc) {
  const items = doc.lineItems || [];
  const t = docTotals(doc);
  if (!items.length) return sectionCard('Line items', miniEmpty('No line items.'));
  return h(
    'section.card.panel',
    { 'aria-label': 'Line items' },
    h('div.card-head', h('h2.grow', 'Line items'), h('span.subtle', `${items.length} task${items.length === 1 ? '' : 's'}`)),
    h('div.metric-row.flat', metricSmall('Labor', money(t.labor)), metricSmall('Parts', money(t.parts)), metricSmall('Total', money(t.total))),
    h(
      'div.table-wrap',
      h(
        'table.table.compact.li-table',
        h('caption.sr-only', 'Line items'),
        h('thead', h('tr', h('th', { scope: 'col' }, 'Item'), h('th.r', { scope: 'col' }, 'Labor'), h('th.r', { scope: 'col' }, 'Parts'), h('th.r', { scope: 'col' }, 'Subtotal'))),
        h(
          'tbody',
          items.map((li) => {
            const task = lookup.task(li.taskId);
            return h(
              'tr',
              h(
                'td',
                h('div.cell-title', task?.name || li.description || 'Custom work'),
                task && li.description ? h('div.cell-sub', li.description) : null,
                li.laborHours ? h('div.cell-sub', `${formatDecimal(li.laborHours, 2)} hr${li.laborRate ? ` at ${money(li.laborRate)}/hr` : ''}`) : null,
                ...(li.parts || []).map((p) => h('div.cell-sub', `${formatDecimal(p.qty, 2)} x ${p.name || lookup.part(p.partId)?.description || 'Part'} at ${money(p.unitCost)}`)),
              ),
              h('td.r.money', money(lineLabor(li))),
              h('td.r.money', money(lineParts(li))),
              h('td.r.money.strong', money(lineLabor(li) + lineParts(li))),
            );
          }),
        ),
      ),
    ),
    h(
      'dl.totals.readonly',
      h('div', h('dt', 'Subtotal'), h('dd.money', money(t.subtotal))),
      t.discount ? h('div', h('dt', `Discount${doc.discount?.type === 'percent' ? ` (${doc.discount.value}%)` : ''}`), h('dd.money', `-${money(t.discount)}`)) : null,
      t.tax ? h('div', h('dt', `Tax (${doc.taxPercent}%)`), h('dd.money', money(t.tax))) : null,
      h('div.grand', h('dt', 'Total'), h('dd.money', money(t.total))),
    ),
  );
}

export function linkedView(doc) {
  const store = app.store;
  const issues = (doc.issueIds || []).map((id) => store.get('issues', id)).filter(Boolean);
  const rems = (doc.reminderIds || []).map((id) => store.get('reminders', id)).filter(Boolean);
  if (!issues.length && !rems.length) return null;
  return sectionCard(
    'Resolves',
    h(
      'ul.widget-list.no-top',
      ...issues.map((i) => h('li', h('a.widget-row', { href: `#/issues/${i.id}` }, statusPill('issue', i.status), h('span.grow.truncate', `Issue #${i.number} ${i.summary}`)))),
      ...rems.map((r) => h('li', h('a.widget-row', { href: `#/reminders/${r.id}` }, h('span.pill.blue', 'Reminder'), h('span.grow.truncate', lookup.taskName(r.taskId) || 'Service'), r.lastDate ? h('span.subtle', `Last done ${formatDate(r.lastDate)}`) : null))),
    ),
  );
}

function metricSmall(label, value) {
  return h('div.metric', h('span.metric-label', label), h('span.metric-value', value));
}
