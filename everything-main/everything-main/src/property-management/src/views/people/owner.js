/** Rental owner page: properties owned, year-to-date statement, owner money, notes and files. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, emptyState, moreButton } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { navigate } from '../../ui/router.js';
import { displayName, secondaryName, telHref, formatAddress, primaryEmail } from '../../core/format.js';
import { kindLabel, txTotal } from '../../core/ledger.js';
import { propertyTypeLabel } from '../../core/settings.js';
import { money, date, kvList, notesCard, sectionEmpty, deleteWithUndo, personAvatar } from '../common.js';
import { attachmentsCard } from '../attachments.js';
import { ownerSummary, propertyFigures, tx } from '../properties/shared.js';
import { ownedProperties } from './owners.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  let title = 'Rental owner';

  const body = ctx.live(draw, ['owners', 'properties', 'units', 'leases', 'transactions', 'accounts']);

  function draw() {
    const o = store.get('owners', id);
    if (!o) return emptyState({ icon: 'briefcase', title: 'Owner not found', text: 'This owner may have been deleted.', headingLevel: 1, actions: [h('a.btn.primary', { href: '#/owners' }, 'Back to rental owners')] });
    title = displayName(o);
    const props = ownedProperties(o.id);
    const header = pageHeader({
      title: h('span.row.rn-title', personAvatar({ firstName: displayName(o) }, { size: 'lg' }), displayName(o)),
      crumbs: [{ label: 'Rental owners', href: '#/owners' }],
      subtitle: secondaryName(o) || (o.kind === 'company' ? 'Company' : 'Individual'),
      actions: [
        moreButton((btn) => moreMenu(btn, o, props)),
        h('a.btn.hide-mobile', { href: `#/owners/${o.id}/edit` }, icon('pencil', 16), 'Edit'),
        primaryEmail(o) ? h('button.btn', { type: 'button', onClick: () => import('../compose.js').then((m) => m.composeEmail({ to: [{ name: displayName(o), email: primaryEmail(o) }], subject: '', body: '', related: {} })) }, icon('mail', 16), 'Email') : null,
        h('button.btn.primary', { type: 'button', disabled: !props.length || null, onClick: () => tx().then((m) => m.ownerTransactionDialog({ kind: 'distribution', ownerId: o.id, propertyId: props[0]?.property.id })) }, icon('wallet', 16), 'Owner draw'),
      ],
    });
    return [header, h('div.detail', h('div.detail-main', statementCard(o, props), propertiesCard(o, props), moneyCard(o), attachmentsCard('owners', o, { folder: `files/owners/${o.id}` })), h('div.detail-aside', contactCard(o), agreementCard(o), notesCard('owners', o)))];
  }

  function statementCard(o, props) {
    const today = app.today();
    const from = `${today.slice(0, 4)}-01-01`;
    const s = ownerSummary(o.id, from, today);
    const fee = Number(o.managementFee) || 0;
    const feeEstimate = Math.round((s.totals.income * fee) / 100);
    return h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Year to date'), h('span.subtle', `${date(from)} to ${date(today)}`)),
      props.length
        ? [
            h(
              'div.card-body',
              h(
                'div.rn-figures',
                figure('Income', money(s.totals.income)),
                figure('Expenses', money(s.totals.expenses)),
                figure('Net income', money(s.totals.net), s.totals.net < 0 ? 'owed' : ''),
                figure('Distributions', money(s.totals.distributions)),
                figure('Contributions', money(s.totals.contributions)),
              ),
            ),
            h(
              'div.card-body.flush',
              h(
                'div.table-wrap',
                h(
                  'table.table',
                  h('caption.sr-only', 'Year to date by property'),
                  h('thead', h('tr', h('th', { scope: 'col' }, 'Property'), h('th.r', { scope: 'col' }, 'Share'), h('th.r', { scope: 'col' }, 'Income'), h('th.r', { scope: 'col' }, 'Expenses'), h('th.r', { scope: 'col' }, 'Net'))),
                  h(
                    'tbody',
                    s.rows.map((r) =>
                      h('tr', h('td', h('a', { href: `#/properties/${r.property.id}?tab=financials&period=ytd` }, r.property.name)), h('td.r', h('span.num', `${r.pct}%`)), h('td.r', h('span.num', money(r.income))), h('td.r', h('span.num', money(r.expenses))), h('td.r', h(`span.num${r.net < 0 ? '.owed' : ''}`, money(r.net)))),
                    ),
                  ),
                ),
              ),
            ),
            h(
              'div.rn-card-foot.subtle',
              fee ? `Management fee of ${fee}% on income is about ${money(feeEstimate)} for this period. ` : '',
              h('a', { href: `#/reports/owner-statement?owner=${o.id}&preset=this-year` }, 'Owner statement report'),
            ),
          ]
        : sectionEmpty('This owner is not linked to any property yet. Add them on a property to see their statement.'),
    );
  }

  function figure(label, value, cls = '') {
    return h('div.rn-figure', h('div.section-title', label), h(`div.num.rn-big${cls ? '.' + cls : ''}`, value));
  }

  function propertiesCard(o, props) {
    return h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Properties', props.length ? h('span.count', ` ${props.length}`) : null)),
      props.length
        ? h(
            'ul.list',
            props.map(({ property: p, pct }) => {
              const f = propertyFigures(p.id);
              return h(
                'li',
                h(
                  'a.list-item',
                  { href: `#/properties/${p.id}` },
                  h('div.grow', h('div.title', p.name), h('div.meta', `${propertyTypeLabel(p.type)} · ${f.occupied} of ${f.units} occupied · ${money(f.rent)}/mo`)),
                  h('span.num', `${pct}%`),
                ),
              );
            }),
          )
        : sectionEmpty('No properties yet.', h('a.btn.sm', { href: '#/properties' }, 'Go to properties')),
    );
  }

  function moneyCard(o) {
    const list = store
      .all('transactions')
      .filter((t) => !t.voided && t.ownerId === o.id)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 10);
    return h(
      'section.card',
      h(
        'div.card-head',
        h('h2.grow', 'Contributions and distributions'),
        h('button.btn.sm', { type: 'button', onClick: () => tx().then((m) => m.ownerTransactionDialog({ kind: 'contribution', ownerId: o.id, propertyId: ownedProperties(o.id)[0]?.property.id })) }, 'Contribution'),
        h('button.btn.sm', { type: 'button', onClick: () => tx().then((m) => m.ownerTransactionDialog({ kind: 'distribution', ownerId: o.id, propertyId: ownedProperties(o.id)[0]?.property.id })) }, 'Distribution'),
      ),
      list.length
        ? h(
            'ul.list',
            list.map((t) =>
              h(
                'li',
                h(
                  'a.list-item',
                  { href: `#/transactions/${t.id}` },
                  h('span.rn-date', date(t.date, { month: 'short', day: 'numeric', year: 'numeric' })),
                  h('div.grow', h('div.title', kindLabel(t.kind)), h('div.meta', [lookup.property(t.propertyId)?.name, t.memo].filter(Boolean).join(' · '))),
                  h(`span.num${t.kind === 'distribution' ? '.credit' : ''}`, `${t.kind === 'distribution' ? '-' : ''}${money(txTotal(t))}`),
                ),
              ),
            ),
          )
        : sectionEmpty('No owner money recorded yet.'),
    );
  }

  function contactCard(o) {
    const emails = o.emails || [];
    const phones = o.phones || [];
    return h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Contact')),
      h(
        'div.card-body',
        kvList([
          ['Email', emails.length ? h('div.stack.sm', emails.map((e) => h('a', { href: `mailto:${e}` }, e))) : h('span.subtle', 'None')],
          ['Phone', phones.length ? h('div.stack.sm', phones.map((p) => h('a', { href: telHref(p) }, p))) : h('span.subtle', 'None')],
          ['Address', formatAddress(o.address) || ''],
        ]),
      ),
    );
  }

  function agreementCard(o) {
    const today = app.today();
    const ended = o.agreementEnd && o.agreementEnd < today;
    return h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Management agreement'), h('a.btn.sm.ghost', { href: `#/owners/${o.id}/edit` }, 'Edit')),
      h(
        'div.card-body',
        kvList([
          ['Management fee', o.managementFee ? `${o.managementFee}% of income` : h('span.subtle', 'Not set')],
          ['Starts', o.agreementStart ? date(o.agreementStart) : h('span.subtle', 'Not set')],
          ['Ends', o.agreementEnd ? h('span', date(o.agreementEnd), ended ? h('span.subtle', ' (ended)') : null) : h('span.subtle', 'No end date')],
        ]),
      ),
    );
  }

  function moreMenu(btn, o, props) {
    // Their money in and out stays in the books, so the owner must too.
    const hasMoney = store.all('transactions').some((t) => !t.voided && (t.ownerId === o.id || t.lines.some((l) => l.ownerId === o.id)));
    openMenu(btn, [
      { label: 'Edit owner', icon: 'pencil', href: `#/owners/${o.id}/edit` },
      { label: 'Record contribution', icon: 'hand-coins', disabled: !props.length, run: () => tx().then((m) => m.ownerTransactionDialog({ kind: 'contribution', ownerId: o.id, propertyId: props[0]?.property.id })) },
      { label: 'New task', icon: 'list-checks', href: `#/tasks/new?ownerId=${o.id}` },
      { separator: true },
      {
        label: 'Delete owner',
        icon: 'trash',
        danger: true,
        disabled: props.length > 0 || hasMoney,
        description: props.length ? 'Remove them from their properties first' : hasMoney ? 'Has contributions or distributions in the books' : null,
        run: () => deleteWithUndo('owners', o, { title: `Delete ${displayName(o)}?`, label: 'Owner deleted', after: () => navigate('/owners') }),
      },
    ]);
  }

  return {
    node: h('div.page', body),
    get title() {
      return title;
    },
  };
}
