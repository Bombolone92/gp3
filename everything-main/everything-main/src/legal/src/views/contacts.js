/** Contacts list: people and companies, with import, export, tags, and bulk actions. */
import '../styles/contacts.css';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { pageHeader, segmented, searchBox, select, dataTable, emptyState, field, tagInput } from '../ui/components.js';
import { setQuery, navigate } from '../ui/router.js';
import { openMenu } from '../ui/menu.js';
import { confirmDialog, formDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { moneyCell, rememberSort, saveSort } from './common.js';
import { contactAvatar, companyLabel, contactMatters, isMatterClient, hasMoneyRecords, clientMoney, allContactTags } from './contacts-shared.js';
import { contactName, contactSortName, primaryEmail, primaryPhone, telHref, matches, pluralize } from '../core/format.js';
import { formatDate, toISODate } from '../core/dates.js';
import { csvObjects, downloadCsv } from '../core/csv.js';
import { where } from '../core/derive.js';
import { contactsFromRows, contactsToRows, splitDuplicates, IMPORT_COLUMNS } from '../core/contacts-io.js';

export function render(ctx) {
  const store = app.store;
  const state = {
    type: ['person', 'company'].includes(ctx.query.type) ? ctx.query.type : 'all',
    q: ctx.query.q || '',
    tag: ctx.query.tag || '',
  };

  // Per-render memo of money and matter counts (cleared on every refresh).
  let memo = new Map();
  const statsOf = (c) => {
    let s = memo.get(c.id);
    if (!s) {
      const ms = contactMatters(c.id);
      s = { open: ms.filter((x) => x.matter.status !== 'closed').length, total: ms.length, ...clientMoney(c.id) };
      memo.set(c.id, s);
    }
    return s;
  };

  const fileInput = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (f) importCsv(f);
  });

  const newMenuBtn = h('button.btn.primary', { type: 'button', 'aria-label': 'Choose contact type' }, icon('chevron-down', 16));
  newMenuBtn.addEventListener('click', () =>
    openMenu(
      newMenuBtn,
      [
        { label: 'Person', icon: 'user', run: () => navigate('/contacts/new?type=person') },
        { label: 'Company', icon: 'building', run: () => navigate('/contacts/new?type=company') },
      ],
      { align: 'end', label: 'New contact' },
    ),
  );

  const header = pageHeader({
    title: 'Contacts',
    actions: [
      h('button.btn', { type: 'button', 'aria-label': 'Conflict check', onClick: () => import('./dialogs.js').then((m) => m.openConflictCheck()) }, icon('shield-check', 16), h('span.hide-sm', 'Conflict check')),
      h('button.btn', { type: 'button', 'aria-label': 'Import', onClick: () => fileInput.click() }, icon('upload', 16), h('span.hide-sm', 'Import')),
      h('button.btn', { type: 'button', 'aria-label': 'Export', onClick: () => exportCsv(table.rows) }, icon('download', 16), h('span.hide-sm', 'Export')),
      h('div.btn-group', h('a.btn.primary', { href: `#/contacts/new${state.type === 'company' ? '?type=company' : ''}` }, icon('plus', 16), 'New contact'), newMenuBtn),
      fileInput,
    ],
  });

  const typeWrap = h('div');
  const bulk = h('div.bulk-bar', { hidden: true });
  const tagWrap = h('div');

  const columns = [
    {
      id: 'name',
      label: 'Name',
      fixed: true,
      width: '28%',
      render: (c) => {
        const sub = c.type === 'company' ? 'Company' : [c.jobTitle, companyLabel(c)].filter(Boolean).join(', ');
        return h('span.contact-cell', contactAvatar(c, 'sm'), h('span.contact-cell-text', h('span.contact-cell-name.truncate', contactName(c)), sub ? h('span.contact-cell-sub.truncate', sub) : null));
      },
      sort: (c) => contactSortName(c).toLowerCase(),
    },
    {
      id: 'email',
      label: 'Email',
      render: (c) => {
        const e = primaryEmail(c);
        return e ? h('a', { href: `mailto:${e}` }, e) : h('span.subtle', '');
      },
      sort: (c) => primaryEmail(c),
    },
    {
      id: 'phone',
      label: 'Phone',
      render: (c) => {
        const p = primaryPhone(c);
        return p ? h('a.num', { href: telHref(p) }, p) : h('span.subtle', '');
      },
      sort: (c) => primaryPhone(c),
    },
    { id: 'matters', label: 'Open matters', align: 'r', width: '120px', render: (c) => h(`span.num${statsOf(c).open ? '' : '.subtle'}`, String(statsOf(c).open)), sort: (c) => statsOf(c).open },
    { id: 'outstanding', label: 'Outstanding', align: 'r', render: (c) => moneyCell(statsOf(c).outstanding, { muted: true }), sort: (c) => statsOf(c).outstanding },
    { id: 'trust', label: 'Trust held', align: 'r', render: (c) => moneyCell(statsOf(c).trust, { muted: true }), sort: (c) => statsOf(c).trust },
    {
      id: 'tags',
      label: 'Tags',
      render: (c) =>
        h(
          'span.tags',
          (c.tags || []).map((t) => h('span.tag.static', t)),
        ),
      sort: (c) => (c.tags || []).join(','),
    },
    { id: 'created', label: 'Created', hidden: true, render: (c) => (c.createdAt ? formatDate(toISODate(new Date(c.createdAt))) : ''), sort: (c) => c.createdAt || '' },
  ];

  const table = dataTable({
    caption: 'Contacts',
    columns,
    columnsKey: 'contacts',
    sort: rememberSort('contacts', { id: 'name', dir: 'asc' }),
    onSort: (v) => saveSort('contacts', v),
    rowHref: (c) => `#/contacts/${c.id}`,
    rowHeight: 50,
    selectable: true,
    onSelectionChange: drawBulk,
    mobile: (c) =>
      h(
        'a.list-item',
        { href: `#/contacts/${c.id}` },
        contactAvatar(c, 'sm'),
        h(
          'span.grow',
          h('span.title.truncate', contactName(c)),
          h('span.sub.truncate', [c.type === 'company' ? 'Company' : companyLabel(c), primaryEmail(c) || primaryPhone(c)].filter(Boolean).join(' · ')),
        ),
        statsOf(c).open ? h('span.pill.accent', pluralize(statsOf(c).open, 'matter')) : null,
      ),
    empty: () =>
      store.all('contacts').length
        ? emptyState({ compact: true, icon: 'search', title: 'No matching contacts', text: 'Try a different search, type, or tag.', headingLevel: 3 })
        : emptyState({
            icon: 'contact',
            title: 'No contacts yet',
            text: 'Add clients, opposing parties, counsel, witnesses, and experts. Import a CSV file to bring in an existing list.',
            actions: [
              h('a.btn.primary', { href: '#/contacts/new' }, icon('plus', 16), 'New contact'),
              h('button.btn', { type: 'button', onClick: () => fileInput.click() }, icon('upload', 16), 'Import CSV'),
            ],
            headingLevel: 3,
          }),
    footer: (rows) => {
      let out = 0;
      let trust = 0;
      for (const c of rows) {
        const s = statsOf(c);
        out += s.outstanding;
        trust += s.trust;
      }
      return [
        h('span', h('strong', String(rows.length)), rows.length === 1 ? ' contact' : ' contacts'),
        h('span', 'Outstanding ', h('strong', moneyCell(out))),
        h('span', 'Trust held ', h('strong', moneyCell(trust))),
      ];
    },
  });

  function rows() {
    return store.all('contacts').filter((c) => {
      if (state.type !== 'all' && c.type !== state.type) return false;
      if (state.tag && !(c.tags || []).includes(state.tag)) return false;
      if (state.q) {
        const hay = [contactName(c), c.companyName, companyLabel(c), c.jobTitle, ...(c.emails || []).map((e) => e.address), ...(c.phones || []).map((p) => p.number), (c.tags || []).join(' ')].join(
          ' ',
        );
        if (!matches(hay, state.q)) return false;
      }
      return true;
    });
  }

  function drawType() {
    const all = store.all('contacts');
    const people = all.filter((c) => c.type !== 'company').length;
    typeWrap.replaceChildren(
      segmented({
        label: 'Contact type',
        value: state.type,
        items: [
          { value: 'all', label: 'All', count: all.length },
          { value: 'person', label: 'People', count: people },
          { value: 'company', label: 'Companies', count: all.length - people },
        ],
        onChange: (v) => {
          state.type = v;
          setQuery({ type: v === 'all' ? '' : v });
          table.clearSelection();
          showRows();
        },
      }),
    );
  }

  function drawTags() {
    const tags = allContactTags();
    if (state.tag && !tags.includes(state.tag)) tags.unshift(state.tag);
    const sel = select({ name: 'tag', value: state.tag, 'aria-label': 'Filter by tag', options: [{ value: '', label: 'All tags' }, ...tags.map((t) => ({ value: t, label: t }))] });
    sel.addEventListener('change', () => {
      state.tag = sel.value;
      setQuery({ tag: state.tag });
      showRows();
    });
    tagWrap.replaceChildren(tags.length ? sel : '');
  }

  function drawBulk(sel) {
    bulk.hidden = !sel.size;
    if (!sel.size) return;
    const chosen = () => [...sel].map((id) => store.get('contacts', id)).filter(Boolean);
    // Redrawn on every refresh, so keep keyboard focus on the same button.
    const focused = bulk.contains(document.activeElement) ? document.activeElement.textContent : null;
    bulk.replaceChildren(
      h('span', `${sel.size} selected`),
      h('div.spacer'),
      h('button.btn.sm', { type: 'button', onClick: () => addTag(chosen()) }, icon('tag', 15), 'Add tag'),
      h('button.btn.sm', { type: 'button', onClick: () => exportCsv(chosen()) }, icon('download', 15), 'Export'),
      h('button.btn.sm', { type: 'button', onClick: () => bulkDelete(chosen()) }, icon('trash', 15), 'Delete'),
      h('button.btn.sm.ghost', { type: 'button', onClick: () => table.clearSelection() }, 'Clear'),
    );
    if (focused !== null) ([...bulk.querySelectorAll('button')].find((x) => x.textContent === focused) || bulk.querySelector('button'))?.focus();
  }

  async function addTag(list) {
    const input = tagInput({ name: 'tags', suggestions: allContactTags(), placeholder: 'Type a tag and press Enter' });
    const ok = await formDialog({
      title: `Tag ${pluralize(list.length, 'contact')}`,
      size: 'narrow',
      body: field('Tags to add', input),
      submitLabel: 'Add tags',
      onSubmit: () => {
        if (!input.tags.length) {
          input.querySelector('input')?.focus();
          return false;
        }
        return true;
      },
    });
    if (!ok) return;
    for (const c of list) {
      const next = [...new Set([...(c.tags || []), ...input.tags])];
      if (next.length !== (c.tags || []).length) store.patch('contacts', c.id, { tags: next });
    }
    toast(`Tagged ${pluralize(list.length, 'contact')}`);
  }

  async function bulkDelete(list) {
    // Clients on matters, and anyone bills or money records point at, are kept.
    const keep = (c) => isMatterClient(c.id) || hasMoneyRecords(c.id);
    const clients = list.filter(keep);
    const deletable = list.filter((c) => !keep(c));
    if (!deletable.length) {
      toast(clients.length === 1 ? `${contactName(clients[0])} is a client with matters or bills and cannot be deleted.` : 'These contacts are clients with matters or bills and cannot be deleted.', {
        type: 'error',
        duration: 7000,
      });
      return;
    }
    // Related parties drop off their matters and out of future conflict checks.
    const parties = deletable.filter((c) => contactMatters(c.id).length);
    const partyMatters = new Set(parties.flatMap((c) => contactMatters(c.id).map((x) => x.matter.id))).size;
    // Notes filed only on these contacts would show nowhere once they are gone.
    const ownNotes = deletable.flatMap((c) => where(store, 'notes', 'contactId', c.id).filter((n) => !n.matterId));
    const msg = [
      `${pluralize(deletable.length, 'contact')} will be deleted.`,
      clients.length ? `${pluralize(clients.length, 'contact')} ${clients.length === 1 ? 'is a client' : 'are clients'} with matters or bills and will be kept.` : '',
      parties.length
        ? `${pluralize(parties.length, 'contact')} ${parties.length === 1 ? 'is a related party' : 'are related parties'} on ${pluralize(partyMatters, 'matter')}. Those matters will show ${parties.length === 1 ? 'it' : 'them'} as deleted, and conflict checks will no longer find ${parties.length === 1 ? 'it' : 'them'}.`
        : '',
      ownNotes.length ? `${pluralize(ownNotes.length, 'note')} filed on ${deletable.length === 1 ? 'it' : 'them'} will be deleted too.` : '',
      clients.length ? '' : 'Communication logs stay but lose their link.',
    ]
      .filter(Boolean)
      .join(' ');
    if (!(await confirmDialog({ title: 'Delete contacts?', message: msg, confirmLabel: 'Delete', danger: true }))) return;
    store.bulkRemove(
      'contacts',
      deletable.map((c) => c.id),
    );
    store.bulkRemove(
      'notes',
      ownNotes.map((n) => n.id),
    );
    table.clearSelection();
    const undo = () => (deletable.forEach((c) => store.restore('contacts', c)), ownNotes.forEach((n) => store.restore('notes', n)));
    toast(`${pluralize(deletable.length, 'contact')} deleted`, { action: { label: 'Undo', run: undo } });
  }

  function exportCsv(list) {
    const companyOf = (id) => (id ? contactName(store.get('contacts', id)) : '');
    downloadCsv(`contacts-${app.today()}.csv`, contactsToRows(list, companyOf));
  }

  async function importCsv(file) {
    let parsed;
    try {
      parsed = contactsFromRows(csvObjects(await file.text()));
    } catch (err) {
      toast(`Could not read ${file.name}. ${err?.message || ''}`.trim(), { type: 'error' });
      return;
    }
    if (!parsed.length) {
      toast(`No contacts found in ${file.name}. The first row should be a header such as ${IMPORT_COLUMNS.slice(0, 5).join(', ')}.`, { type: 'error', duration: 9000 });
      return;
    }
    const { fresh, dupes } = splitDuplicates(parsed, store.all('contacts'));
    if (!fresh.length) {
      toast(`All ${pluralize(parsed.length, 'contact')} in ${file.name} already exist.`, { type: 'info' });
      return;
    }
    const people = fresh.filter((c) => c.type === 'person').length;
    const ok = await confirmDialog({
      title: 'Import contacts?',
      message: h(
        'div.stack-sm',
        h('p', `${file.name} has ${pluralize(fresh.length, 'new contact')}: ${pluralize(people, 'person', 'people')} and ${pluralize(fresh.length - people, 'company', 'companies')}.`),
        dupes.length ? h('p.subtle', `${pluralize(dupes.length, 'row')} matched existing contacts by name and email and will be skipped.`) : null,
      ),
      confirmLabel: `Import ${fresh.length}`,
    });
    if (!ok) return;
    const saved = store.bulkPut('contacts', fresh);
    toast(`Imported ${pluralize(saved.length, 'contact')}`, {
      action: {
        label: 'Undo',
        run: () =>
          store.bulkRemove(
            'contacts',
            saved.map((c) => c.id),
          ),
      },
    });
  }

  const search = searchBox({
    value: state.q,
    placeholder: 'Search by name, email, phone',
    label: 'Search contacts',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      showRows();
    },
  });

  // Rows that leave the list also leave the selection, so redraw the bulk bar.
  function showRows() {
    table.setRows(rows());
    drawBulk(table.selected);
  }

  function refresh() {
    memo = new Map();
    drawType();
    drawTags();
    showRows();
  }
  refresh();
  ctx.watch(['contacts', 'matters', 'bills', 'payments', 'transactions', 'activities'], refresh);

  return {
    title: 'Contacts',
    node: h(
      'div.page.fill',
      header,
      h('section.card.list-card', { 'aria-label': 'Contacts list' }, h('div.toolbar', typeWrap, search, h('div.spacer'), tagWrap, table.columnsButton()), bulk, table.node),
    ),
  };
}
