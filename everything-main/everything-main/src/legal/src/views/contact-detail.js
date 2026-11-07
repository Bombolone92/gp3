/** One contact: details, matters, bills, communications, and notes. */
import '../styles/contacts.css';
import { customFieldPairs } from './custom-fields.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { pageHeader, tabs, card, kvList, emptyState, dataTable, stat, moreButton, pill } from '../ui/components.js';
import { setQuery, navigate } from '../ui/router.js';
import { openMenu } from '../ui/menu.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { matterStatusPill, userChip, moneyCell, billStatusPill, contactLink } from './common.js';
import { contactAvatar, companyLabel, contactMatters, isMatterClient, hasMoneyRecords, clientMoney } from './contacts-shared.js';
import { commColumns, commMobile } from './comms-table.js';
import { contactName, formatAddress, telHref, matterLabel, pluralize } from '../core/format.js';
import { formatDate, toISODate } from '../core/dates.js';
import { formatMoney } from '../core/money.js';
import { where } from '../core/derive.js';
import { billStatus, billTotals, billBalance } from '../core/finance.js';
import { practiceAreaName } from '../core/settings.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'matters', label: 'Matters' },
  { id: 'bills', label: 'Bills' },
  { id: 'communications', label: 'Communications' },
  { id: 'notes', label: 'Notes' },
];

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  let tab = TABS.some((t) => t.id === ctx.query.tab) ? ctx.query.tab : 'overview';
  const headerWrap = h('div');
  const body = h('div.tab-panel#contact-panel', { role: 'tabpanel', tabindex: '-1' });

  function contact() {
    return store.get('contacts', id);
  }

  function drawHeader() {
    const c = contact();
    if (!c) {
      headerWrap.replaceChildren(
        emptyState({ icon: 'search', title: 'Contact not found', text: 'It may have been deleted.', headingLevel: 1, actions: [h('a.btn.primary', { href: '#/contacts' }, 'Back to contacts')] }),
      );
      body.hidden = true;
      return;
    }
    body.hidden = false;
    const ms = contactMatters(c.id);
    const bills = where(store, 'bills', 'clientId', c.id);
    const comms = where(store, 'communications', 'contactId', c.id);
    const notes = where(store, 'notes', 'contactId', c.id);
    const counts = { matters: ms.length, bills: bills.length, communications: comms.length, notes: notes.length };
    const co = c.type !== 'company' && c.companyId ? store.get('contacts', c.companyId) : null;
    const sub = [
      c.type === 'company' ? pill('Company', 'neutral') : null,
      c.type !== 'company' && (c.jobTitle || companyLabel(c)) ? h('span', [c.jobTitle, c.jobTitle && companyLabel(c) ? ' at ' : '', co ? contactLink(co.id) : companyLabel(c)]) : null,
      isMatterClient(c.id) ? pill('Client', 'accent') : null,
      ...(c.tags || []).map((t) => h('span.tag.static', t)),
    ].filter(Boolean);

    const logBtn = h('button.btn', { type: 'button', 'aria-label': 'Log communication' }, icon('phone', 16), h('span.hide-sm', 'Log'), icon('chevron-down', 14));
    logBtn.addEventListener('click', async () => {
      const { LOG_KINDS, openLogDialog } = await import('./dialogs.js');
      openMenu(
        logBtn,
        LOG_KINDS.filter((k) => k.id !== 'message').map((k) => ({ label: k.label, icon: k.icon, run: () => openLogDialog({ kind: k.id, contactId: c.id, matterId: singleMatter(c) }) })),
        { label: 'Log communication' },
      );
    });

    headerWrap.replaceChildren(
      pageHeader({
        crumbs: [{ label: 'Contacts', href: '#/contacts' }],
        title: h('span.contact-title', contactAvatar(c, 'lg'), h('span.truncate', contactName(c))),
        subtitle: sub.length ? sub : null,
        actions: [
          h('a.btn', { href: `#/contacts/${c.id}/edit` }, icon('pencil', 16), 'Edit'),
          logBtn,
          h('a.btn.primary', { href: `#/matters/new?client=${c.id}` }, icon('plus', 16), 'New matter'),
          moreButton((anchor) =>
            openMenu(
              anchor,
              [
                { label: 'Add note', icon: 'sticky-note', run: () => newNote(c) },
                { label: 'Run conflict check on this name', icon: 'shield-check', run: () => import('./dialogs.js').then((m) => m.openConflictCheck(contactName(c), { contactId: c.id })) },
                { separator: true },
                { label: 'Delete contact', icon: 'trash', danger: true, run: () => remove(c) },
              ],
              { align: 'end', label: 'More actions' },
            ),
          ),
        ],
        tabs: tabs({
          label: 'Contact sections',
          panelId: body.id,
          selected: tab,
          items: TABS.map((t) => ({ ...t, count: t.id === 'overview' ? null : counts[t.id] || null })),
          onSelect: (v) => {
            tab = v;
            setQuery({ tab: v === 'overview' ? '' : v });
            drawBody();
          },
        }),
      }),
    );
    document.title = `${contactName(c)} · Legal`;
  }

  /** The contact's only open matter, used as a sensible default for logs. */
  function singleMatter(c) {
    const open = contactMatters(c.id).filter((x) => x.matter.status !== 'closed');
    return open.length === 1 ? open[0].matter.id : '';
  }

  async function newNote(c) {
    const { openNoteDialog } = await import('./dialogs.js');
    openNoteDialog({ contactId: c.id });
  }

  async function remove(c) {
    if (isMatterClient(c.id)) {
      const n = where(store, 'matters', 'clientId', c.id).length;
      toast(`${contactName(c)} is the client on ${pluralize(n, 'matter')}. Change the client on those matters before deleting this contact.`, { type: 'error', duration: 8000 });
      return;
    }
    if (hasMoneyRecords(c.id)) {
      toast(`${contactName(c)} has bills, payments, or account transactions on record, so the contact is kept to keep that history intact.`, { type: 'error', duration: 8000 });
      return;
    }
    const related = contactMatters(c.id).length;
    // Notes filed only on this contact would show nowhere once it is gone.
    const ownNotes = where(store, 'notes', 'contactId', c.id).filter((n) => !n.matterId);
    const notesLine = ownNotes.length ? `${ownNotes.length === 1 ? 'Its note is' : `Its ${ownNotes.length} notes are`} deleted with it. ` : '';
    const ok = await confirmDialog({
      title: `Delete ${contactName(c)}?`,
      message: related
        ? `This contact is a related party on ${pluralize(related, 'matter')}. Those matters will show the contact as deleted, and conflict checks will no longer find it. ${notesLine}Communication logs are kept.`
        : `${notesLine}Communication logs that mention this contact are kept.`,
      confirmLabel: 'Delete contact',
      danger: true,
    });
    if (!ok) return;
    store.remove('contacts', c.id);
    store.bulkRemove(
      'notes',
      ownNotes.map((n) => n.id),
    );
    toast(`${contactName(c)} deleted`, { action: { label: 'Undo', run: () => (store.restore('contacts', c), ownNotes.forEach((n) => store.restore('notes', n))) } });
    navigate('/contacts');
  }

  // ---- Tabs ----

  function overview(c) {
    const money = clientMoney(c.id);
    const emails = (c.emails || []).filter((e) => e.address);
    const phones = (c.phones || []).filter((p) => p.number);
    const addrs = (c.addresses || []).filter((a) => formatAddress(a));
    const typeLabel = (t) => (t ? h('span.subtle.small', ` ${t[0].toUpperCase()}${t.slice(1)}`) : null);
    const primaryMark = (x, list) => (x.primary && list.length > 1 ? h('span.subtle.small', ' (primary)') : null);
    const info = kvList([
      [
        'Email',
        emails.length
          ? h(
              'div.stack-sm',
              emails.map((e) => h('div', h('a', { href: `mailto:${e.address}` }, e.address), typeLabel(e.type), primaryMark(e, emails))),
            )
          : '',
      ],
      [
        'Phone',
        phones.length
          ? h(
              'div.stack-sm',
              phones.map((p) => h('div', h('a.num', { href: telHref(p.number) }, p.number), typeLabel(p.type), primaryMark(p, phones))),
            )
          : '',
      ],
      [
        'Address',
        addrs.length
          ? h(
              'div.stack-sm',
              addrs.map((a) => h('div.pre', formatAddress(a, { multiline: true }), typeLabel(a.type))),
            )
          : '',
      ],
      [
        'Website',
        c.website ? h('a', { href: /^https?:\/\//i.test(c.website) ? c.website : `https://${c.website}`, target: '_blank', rel: 'noopener noreferrer' }, c.website, ' ', icon('external', 12)) : '',
      ],
      ['Date of birth', c.dob ? formatDate(c.dob, { year: 'numeric', month: 'long', day: 'numeric' }) : ''],
      ['Hourly rate', c.rateCents ? formatMoney(c.rateCents) : ''],
      ...customFieldPairs('contact', c.custom),
      ['Added', c.createdAt ? formatDate(toISODate(new Date(c.createdAt))) : ''],
    ]);
    const hasInfo = emails.length || phones.length || addrs.length || c.website || c.dob;
    const people =
      c.type === 'company'
        ? store
            .all('contacts')
            .filter((p) => p.companyId === c.id)
            .sort((a, b) => contactName(a).localeCompare(contactName(b)))
        : [];
    const ms = contactMatters(c.id)
      .sort((a, b) => (a.matter.status === 'closed') - (b.matter.status === 'closed') || (b.matter.number || 0) - (a.matter.number || 0))
      .slice(0, 6);

    return h(
      'div.split',
      h(
        'div.stack',
        card({
          title: 'Contact information',
          actions: h('a.btn.sm.ghost', { href: `#/contacts/${c.id}/edit` }, icon('pencil', 14), 'Edit'),
          body: hasInfo ? info : h('div.stack-sm', h('p.subtle', 'No email, phone, or address yet.'), h('div', h('a.btn.sm', { href: `#/contacts/${c.id}/edit` }, icon('plus', 14), 'Add details'))),
        }),
        c.notes ? card({ title: 'About', body: h('p.pre', c.notes) }) : null,
        c.type === 'company'
          ? card({
              title: 'People',
              count: people.length || null,
              flush: true,
              actions: h('a.btn.sm.ghost', { href: `#/contacts/new?type=person&company=${encodeURIComponent(c.id)}` }, icon('plus', 14), 'Add person'),
              body: people.length
                ? h(
                    'ul.list',
                    people.map((p) =>
                      h(
                        'li',
                        h(
                          'a.list-item',
                          { href: `#/contacts/${p.id}` },
                          contactAvatar(p, 'sm'),
                          h('span.grow', h('span.title', contactName(p)), p.jobTitle ? h('span.sub', p.jobTitle) : null),
                          icon('chevron-right', 16),
                        ),
                      ),
                    ),
                  )
                : h('p.subtle.card-pad', 'No one is linked to this company yet. Set the company on a person to link them.'),
            })
          : null,
      ),
      h(
        'div.stack',
        card({
          title: 'Billing',
          body: h(
            'div.mini-stats',
            stat({ label: 'Outstanding', value: formatMoney(money.outstanding), tone: money.outstanding ? 'warning' : null, onClick: money.outstanding ? () => go('bills') : null }),
            stat({ label: 'Trust held', value: formatMoney(money.trust) }),
            stat({ label: 'Unbilled work', value: formatMoney(money.wip) }),
            stat({ label: `Paid in ${app.today().slice(0, 4)}`, value: formatMoney(money.paidYear) }),
          ),
        }),
        card({
          title: 'Matters',
          count: contactMatters(c.id).length || null,
          flush: true,
          actions: h('a.btn.sm.ghost', { href: `#/matters/new?client=${c.id}` }, icon('plus', 14), 'New'),
          body: ms.length
            ? h(
                'ul.list',
                ms.map(({ matter: m, relationships }) =>
                  h(
                    'li',
                    h('a.list-item', { href: `#/matters/${m.id}` }, h('span.grow', h('span.title.truncate', matterLabel(m)), h('span.sub', relationships.join(', '))), matterStatusPill(m.status)),
                  ),
                ),
                contactMatters(c.id).length > ms.length ? h('li', h('button.list-item.list-btn.contact-more-link', { type: 'button', onClick: () => go('matters') }, 'View all matters')) : null,
              )
            : h('p.subtle.card-pad', 'Not a party to any matter yet.'),
        }),
      ),
    );
  }

  function go(t) {
    tab = t;
    setQuery({ tab: t });
    drawHeader();
    drawBody();
  }

  function mattersTab(c) {
    const s = app.settings();
    const rows = contactMatters(c.id).map(({ matter, relationships }) => ({ id: matter.id, matter, rel: relationships.join(', ') }));
    return h(
      'section.card.list-card',
      { 'aria-label': 'Matters' },
      dataTable({
        caption: `Matters for ${contactName(c)}`,
        rows,
        sort: { id: 'matter', dir: 'desc' },
        onSort: () => {},
        rowHref: (r) => `#/matters/${r.id}`,
        maxHeight: '70vh',
        columns: [
          { id: 'matter', label: 'Matter', render: (r) => h('span.matter-cell', h('span.matter-num', r.matter.displayNumber), h('span.truncate', r.matter.description)), sort: (r) => r.matter.number },
          { id: 'rel', label: 'Relationship', render: (r) => r.rel, sort: (r) => r.rel },
          { id: 'status', label: 'Status', render: (r) => matterStatusPill(r.matter.status), sort: (r) => r.matter.status },
          { id: 'resp', label: 'Responsible lawyer', render: (r) => userChip(r.matter.responsibleId), sort: (r) => lookup.userName(r.matter.responsibleId) },
          { id: 'area', label: 'Practice area', render: (r) => practiceAreaName(s, r.matter.practiceAreaId), sort: (r) => practiceAreaName(s, r.matter.practiceAreaId) },
          { id: 'open', label: 'Opened', render: (r) => formatDate(r.matter.openDate), sort: (r) => r.matter.openDate },
        ],
        mobile: (r) => h('a.list-item', { href: `#/matters/${r.id}` }, h('span.grow', h('span.title.truncate', matterLabel(r.matter)), h('span.sub', r.rel)), matterStatusPill(r.matter.status)),
        empty: emptyState({
          compact: true,
          icon: 'briefcase',
          title: 'No matters',
          text: 'This contact is not the client or a related party on any matter.',
          actions: [h('a.btn.primary', { href: `#/matters/new?client=${c.id}` }, icon('plus', 16), 'New matter')],
          headingLevel: 3,
        }),
      }).node,
    );
  }

  function billsTab(c) {
    const today = app.today();
    const payFor = (b) => where(store, 'payments', 'billId', b.id);
    const rows = where(store, 'bills', 'clientId', c.id);
    let outstanding = 0;
    for (const b of rows) outstanding += billBalance(b, payFor(b));
    return h(
      'section.card.list-card',
      { 'aria-label': 'Bills' },
      dataTable({
        caption: `Bills for ${contactName(c)}`,
        rows,
        sort: { id: 'issued', dir: 'desc' },
        onSort: () => {},
        rowHref: (b) => `#/bills/${b.id}`,
        maxHeight: '70vh',
        columns: [
          { id: 'number', label: 'Bill', width: '90px', render: (b) => `#${b.number}`, sort: (b) => b.number },
          { id: 'matter', label: 'Matter', render: (b) => lookup.matter(b.matterId)?.displayNumber || '', sort: (b) => lookup.matter(b.matterId)?.displayNumber || '' },
          { id: 'issued', label: 'Issued', render: (b) => formatDate(b.issueDate), sort: (b) => b.issueDate },
          { id: 'due', label: 'Due', render: (b) => formatDate(b.dueDate), sort: (b) => b.dueDate },
          { id: 'status', label: 'Status', render: (b) => billStatusPill(billStatus(b, payFor(b), today)), sort: (b) => billStatus(b, payFor(b), today) },
          { id: 'total', label: 'Total', align: 'r', render: (b) => moneyCell(billTotals(b).total), sort: (b) => billTotals(b).total },
          { id: 'balance', label: 'Balance', align: 'r', render: (b) => moneyCell(billBalance(b, payFor(b)), { muted: true }), sort: (b) => billBalance(b, payFor(b)) },
        ],
        mobile: (b) =>
          h(
            'a.list-item',
            { href: `#/bills/${b.id}` },
            h('span.grow', h('span.title', `Bill #${b.number}`), h('span.sub', `${formatDate(b.issueDate)} · ${formatMoney(billTotals(b).total)}`)),
            billStatusPill(billStatus(b, payFor(b), today)),
          ),
        empty: emptyState({ compact: true, icon: 'receipt-text', title: 'No bills', text: 'Bills for matters where this contact is the client appear here.', headingLevel: 3 }),
        footer: (list) =>
          list.length ? [h('span', h('strong', String(list.length)), list.length === 1 ? ' bill' : ' bills'), h('span', 'Outstanding ', h('strong', formatMoney(outstanding)))] : null,
      }).node,
    );
  }

  function commsTab(c) {
    const rows = where(store, 'communications', 'contactId', c.id);
    return h(
      'div.stack',
      h(
        'div.row',
        h('div.spacer'),
        h(
          'button.btn',
          {
            type: 'button',
            onClick: async (e) => {
              const anchor = e.currentTarget;
              const { LOG_KINDS, openLogDialog } = await import('./dialogs.js');
              openMenu(
                anchor,
                LOG_KINDS.filter((k) => k.id !== 'message').map((k) => ({ label: k.label, icon: k.icon, run: () => openLogDialog({ kind: k.id, contactId: c.id, matterId: singleMatter(c) }) })),
                { align: 'end', label: 'Log communication' },
              );
            },
          },
          icon('plus', 16),
          'Log communication',
        ),
      ),
      h(
        'section.card.list-card',
        { 'aria-label': 'Communications' },
        dataTable({
          caption: `Communications with ${contactName(c)}`,
          rows,
          sort: { id: 'date', dir: 'desc' },
          onSort: () => {},
          maxHeight: '70vh',
          columns: commColumns({ party: false }),
          mobile: commMobile,
          empty: emptyState({ compact: true, icon: 'messages', title: 'No communications logged', text: 'Log calls, emails, and meetings to keep a record of every conversation.', headingLevel: 3 }),
        }).node,
      ),
    );
  }

  function notesTab(c) {
    const list = [...where(store, 'notes', 'contactId', c.id)].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    return h(
      'div.stack',
      h('div.row', h('div.spacer'), h('button.btn', { type: 'button', onClick: () => newNote(c) }, icon('plus', 16), 'New note')),
      list.length
        ? h(
            'ul.note-list',
            list.map((n) =>
              h(
                'li.card.note-card',
                h(
                  'div.note-head',
                  h('h3.grow', h('button.link-btn.note-title', { type: 'button', onClick: () => import('./dialogs.js').then((m) => m.openNoteDialog({ note: n })) }, n.subject || 'Untitled note')),
                  h('span.subtle.small', formatDate(n.date)),
                ),
                n.body ? h('p.pre.note-body', n.body) : null,
                n.authorId ? h('div.note-foot', userChip(n.authorId)) : null,
              ),
            ),
          )
        : card({
            body: emptyState({
              compact: true,
              icon: 'sticky-note',
              title: 'No notes',
              text: 'Keep background, preferences, and conversation notes for this contact.',
              actions: [h('button.btn.primary', { type: 'button', onClick: () => newNote(c) }, icon('plus', 16), 'New note')],
              headingLevel: 3,
            }),
          }),
    );
  }

  function drawBody() {
    const c = contact();
    if (!c) return;
    const fn = { overview, matters: mattersTab, bills: billsTab, communications: commsTab, notes: notesTab }[tab] || overview;
    body.setAttribute('aria-label', (TABS.find((t) => t.id === tab) || TABS[0]).label);
    body.replaceChildren(fn(c));
  }

  drawHeader();
  drawBody();
  ctx.watch(['contacts', 'matters', 'bills', 'payments', 'transactions', 'activities', 'communications', 'notes', 'users'], () => {
    drawHeader();
    drawBody();
  });

  const c = contact();
  return { title: c ? contactName(c) : 'Contact', node: h('div.page.contact-page', headerWrap, body) };
}
