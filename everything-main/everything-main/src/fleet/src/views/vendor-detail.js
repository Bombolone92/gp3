import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, canEdit } from '../app.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { vehicleName, telHref, mapsUrl } from '../core/format.js';
import { formatDate, addDays } from '../core/dates.js';
import { VENDOR_KINDS } from '../core/status.js';
import { docTotals } from '../core/totals.js';
import { pill } from '../ui/components.js';
import { detailHeader, kvList, sectionCard, vehicleCell, attachmentsPanel, commentsPanel, emptyPage, moreMenuButton, simpleTable, deleteWithUndo, money, deletedNotice } from './common.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  if (!store.get('vendors', id)) return emptyPage('Vendor not found', 'It may have been deleted.');
  const get = () => store.get('vendors', id);
  const files = h('div.two-col.top-gap', h('div.col', attachmentsPanel('vendors', id, { title: 'Documents' })), h('div.col', commentsPanel('vendors', id)));
  const body = ctx.live(() => {
    const v = get();
    files.hidden = !v;
    if (!v) return deletedNotice('vendor', { href: '#/vendors', label: 'Back to vendors' });
    const today = app.today();
    const lines = [
      ...store.all('fuel').filter((f) => f.vendorId === id).map((f) => ({ id: f.id, date: f.date, vehicleId: f.vehicleId, type: f.kind === 'charge' ? 'Charging' : 'Fuel', amount: Number(f.total) || 0, href: `#/fuel/${f.id}` })),
      ...store.all('serviceEntries').filter((e) => e.vendorId === id).map((e) => ({ id: e.id, date: e.date, vehicleId: e.vehicleId, type: 'Service', amount: docTotals(e).total, href: `#/service/${e.id}` })),
      ...store.all('expenses').filter((e) => e.vendorId === id).map((e) => ({ id: e.id, date: e.date, vehicleId: e.vehicleId, type: e.type, amount: Number(e.amount) || 0, href: null })),
    ];
    const total = lines.reduce((a, l) => a + l.amount, 0);
    const last90 = lines.filter((l) => l.date >= addDays(today, -89)).reduce((a, l) => a + l.amount, 0);
    const kinds = (v.kinds || []).map((k) => VENDOR_KINDS.find((x) => x.id === k)?.label).filter(Boolean);
    return h(
      'div',
      detailHeader({
        back: { label: 'Vendors', href: '#/vendors' },
        title: v.name,
        sub: v.address || '',
        meta: [...kinds.map((k) => h('span.mini-tag', k)), v.phone ? h('a.row.gap-4', { href: telHref(v.phone) }, icon('phone', 14), v.phone) : null, v.email ? h('a.row.gap-4', { href: `mailto:${v.email}` }, icon('mail', 14), v.email) : null, v.archived ? pill('Archived', 'gray') : null],
        actions: canEdit('vendors')
          ? [
              h('a.btn', { href: `#/vendors/${id}/edit` }, icon('pencil', 15), 'Edit'),
              moreMenuButton([
                { label: v.archived ? 'Restore' : 'Archive', icon: v.archived ? 'unarchive' : 'archive', run: () => (store.patch('vendors', id, { archived: !v.archived }), toast(v.archived ? 'Vendor restored' : 'Vendor archived')) },
                { label: 'Delete vendor', icon: 'trash', danger: true, run: () => deleteWithUndo('vendors', v, { label: 'vendor', message: deleteMessage(v), onDeleted: () => navigate('/vendors') }) },
              ]),
            ]
          : [],
      }),
      h(
        'div.two-col',
        h(
          'div.col',
          h('div.metric-row.card', metric('Total spend', money(total)), metric('Last 90 days', money(last90)), metric('Transactions', lines.length)),
          sectionCard('Details', kvList([
            ['Contact person', v.contactName],
            ['Phone', v.phone ? h('a', { href: telHref(v.phone) }, v.phone) : null],
            ['Email', v.email ? h('a', { href: `mailto:${v.email}` }, v.email) : null],
            ['Website', v.website ? h('a', { href: /^https?:\/\//.test(v.website) ? v.website : `https://${v.website}`, target: '_blank', rel: 'noopener noreferrer' }, v.website) : null],
            ['Address', v.address ? h('a', { href: mapsUrl(v.address), target: '_blank', rel: 'noopener noreferrer' }, v.address) : null],
            ['Account number', v.accountNumber],
            ['Notes', v.notes ? h('span.pre-wrap', v.notes) : null],
          ])),
        ),
        h(
          'div.col',
          h('section.card.panel', h('div.card-head', h('h2.grow', 'Transactions')), h('div.card-body.flush', simpleTable({
            rows: lines,
            caption: 'Transactions',
            defaultSort: { id: 'date', dir: 'desc' },
            rowHref: (l) => l.href,
            empty: 'No fuel, service, or expenses with this vendor yet.',
            columns: [
              { id: 'date', label: 'Date', render: (l) => formatDate(l.date), sort: (l) => l.date },
              { id: 'type', label: 'Type', render: (l) => l.type, sort: (l) => l.type },
              { id: 'vehicle', label: 'Vehicle', render: (l) => vehicleCell(l.vehicleId, { sub: false, link: false }), sort: (l) => vehicleName(lookup.vehicle(l.vehicleId)) },
              { id: 'amount', label: 'Amount', align: 'r', render: (l) => h('span.money', money(l.amount)), sort: (l) => l.amount },
            ],
          }))),
        ),
      ),
    );
  }, ['vendors', 'fuel', 'serviceEntries', 'expenses']);
  return { node: h('div.page.detail-page', body, files), title: get().name };
}

/** Warn when records still name the vendor: they would show no vendor once it is gone. */
function deleteMessage(v) {
  const n = ['fuel', 'serviceEntries', 'expenses', 'workOrders', 'purchaseOrders'].reduce((sum, c) => sum + app.store.all(c).filter((r) => r.vendorId === v.id).length, 0);
  if (!n) return undefined;
  return `${n} fuel, service, expense, work order, or purchase order record${n === 1 ? '' : 's'} name ${v.name}. They keep their amounts but will show no vendor. Archive the vendor instead to keep its name on them.`;
}

function metric(label, value) {
  return h('div.metric', h('span.metric-label', label), h('span.metric-value', String(value)));
}
