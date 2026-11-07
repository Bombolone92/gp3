/**
 * A matter's workspace: header with quick actions and the timer, and tabs
 * for its dashboard, activities, calendar, communications, notes, documents,
 * tasks, bills, trust transactions, and contacts.
 */
import '../styles/matter.css';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { navigate, setQuery } from '../ui/router.js';
import { openMenu } from '../ui/menu.js';
import { confirmDialog, openDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { pageHeader, tabs, card, kvList, stat, emptyState, dataTable, meter, pill, avatar, select, segmented } from '../ui/components.js';
import { matterStatusPill, billStatusPill, contactLink, userChip, moneyCell, financialsFor, dueLabel, priorityPill, iconText, contactPicker } from './common.js';
import { openActivityDialog, openTaskDialog, toggleTask, openEventDialog, openNoteDialog, openLogDialog, openConflictCheck, EVENT_KINDS, LOG_KINDS } from './dialogs.js';
import { openPaymentDialog, openTrustDialog, deleteTransaction } from './money-dialogs.js';
import { startTimerOn, getTimer, onTimerChange, updateTimer } from '../ui/timer.js';
import { where } from '../core/derive.js';
import { contactName, primaryEmail, primaryPhone, telHref, colorFor } from '../core/format.js';
import { formatDate, formatTime, formatDayShort } from '../core/dates.js';
import { formatMoney } from '../core/money.js';
import { formatHoursDecimal } from '../core/duration.js';
import { practiceAreaName, stageName, stagesFor, categoryName, BILLING_METHODS } from '../core/settings.js';
import { activityAmount, billTotals, billBalance, billStatus, ledger, matterAccountBalance } from '../core/finance.js';
import { tasksFromList, solDaysLeft } from '../core/matters.js';
import { newId } from '../core/ids.js';
import { customFieldPairs } from './custom-fields.js';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'activities', label: 'Activities', icon: 'clock' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'communications', label: 'Communications', icon: 'messages' },
  { id: 'notes', label: 'Notes', icon: 'sticky-note' },
  { id: 'documents', label: 'Documents', icon: 'folder' },
  { id: 'tasks', label: 'Tasks', icon: 'list-checks' },
  { id: 'bills', label: 'Bills', icon: 'receipt-text' },
  { id: 'transactions', label: 'Transactions', icon: 'landmark' },
  { id: 'contacts', label: 'Contacts', icon: 'contact' },
];

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  const m0 = store.get('matters', id);
  if (!m0) {
    return h(
      'div.page',
      emptyState({
        icon: 'search',
        title: 'Matter not found',
        text: 'It may have been deleted, or you may not have access to it.',
        headingLevel: 1,
        actions: [h('a.btn.primary', { href: '#/matters' }, 'Back to matters')],
      }),
    );
  }
  const matter = () => store.get('matters', id) || m0;
  let tab = TABS.some((t) => t.id === ctx.query.tab) ? ctx.query.tab : 'dashboard';
  // Choices made inside a tab, kept across the redraws that store changes cause.
  const ui = { kind: 'all', billing: 'all', picked: '', relationship: '' };

  // The header's low trust warning depends on the matter's trust money too.
  const headerSlot = ctx.live(() => header(matter()), ['matters', 'contacts', 'settings', 'users', 'transactions', 'accounts']);
  ctx.onDispose(onTimerChange(() => headerSlot.redraw?.()));
  const counts = () => {
    const by = (c) => where(store, c, 'matterId', id);
    return {
      activities: by('activities').length,
      tasks: by('tasks').filter((t) => !t.done).length,
      bills: by('bills').length,
      documents: by('documents').length,
      notes: by('notes').length,
    };
  };
  const tabBar = ctx.live(() => {
    const c = counts();
    return tabs({
      label: 'Matter sections',
      cls: 'matter-tabs',
      panelId: 'matter-panel',
      selected: tab,
      items: TABS.map((t) => ({ ...t, icon: null, count: c[t.id] || null })),
      onSelect: (t) => {
        tab = t;
        setQuery({ tab: t === 'dashboard' ? '' : t });
        body.redraw();
      },
    });
  }, ['activities', 'tasks', 'bills', 'documents', 'notes']);
  let panel = null;
  const body = ctx.live(() => {
    refocusAfterRedraw(panel);
    return h('div.tab-panel#matter-panel', { role: 'tabpanel', 'aria-label': TABS.find((t) => t.id === tab)?.label }, renderTab(tab, matter(), ctx, ui));
  }, 'all');
  panel = body;

  if (ctx.query.upload && tab === 'documents') queueMicrotask(() => import('./docs-upload.js').then((mod) => mod.openUploadDocuments({ matterId: id })).catch(() => {}));

  return { title: `${m0.displayNumber} ${m0.description}`, node: h('div.page.matter-page', headerSlot, tabBar, body) };
}

/**
 * The tab panel is rebuilt whenever the store changes, which would drop
 * keyboard focus (changing the stage, completing a task). Put focus back on
 * the same control in the new panel, unless something else took it.
 */
function refocusAfterRedraw(container) {
  const el = document.activeElement;
  if (!container || !el || !container.contains(el)) return;
  const key = (n) => `${n.getAttribute('aria-label') || n.getAttribute('name') || n.textContent.trim()}`;
  const k = key(el);
  const tag = el.tagName;
  queueMicrotask(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    [...container.querySelectorAll(tag)].find((n) => key(n) === k)?.focus();
  });
}

// ---- Header -------------------------------------------------------------------------

function header(m) {
  const s = app.settings();
  const client = lookup.contact(m.clientId);
  const f = financialsFor(m);
  const running = getTimer().running && getTimer().matterId === m.id;
  return pageHeader({
    crumbs: [{ label: 'Matters', href: '#/matters' }, { label: m.displayNumber }],
    title: m.description || 'Untitled matter',
    subtitle: [
      h('span.matter-num', m.displayNumber),
      client ? iconText(client.type === 'company' ? 'building' : 'user', '', '') : null,
      client ? h('a.rec-link', { href: `#/contacts/${client.id}` }, contactName(client)) : null,
      matterStatusPill(m.status),
      practiceAreaName(s, m.practiceAreaId) ? h('span', practiceAreaName(s, m.practiceAreaId)) : null,
      stageName(s, m.practiceAreaId, m.stageId) ? pill(stageName(s, m.practiceAreaId, m.stageId), 'accent') : null,
      f.trustLow ? pill('Trust below minimum', 'warning') : null,
    ],
    actions: [
      h(
        `button.btn${running ? '.timer-on' : ''}`,
        {
          type: 'button',
          onClick: async () => {
            if (await startTimerOn(m.id)) toast(`Timer running for ${m.displayNumber}`, { type: 'info' });
          },
          disabled: running || null,
        },
        icon(running ? 'timer' : 'play', 16),
        running ? 'Timer running' : 'Start timer',
      ),
      h('button.btn', { type: 'button', onClick: (e) => openNewMenu(e.currentTarget, m) }, icon('plus', 16), 'New', icon('chevron-down', 14)),
      h('a.btn', { href: `#/matters/${m.id}/edit`, 'aria-label': 'Edit' }, icon('pencil', 16), h('span.hide-sm', 'Edit')),
      h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'More matter actions', title: 'More', onClick: (e) => openMoreMenu(e.currentTarget, m) }, icon('more')),
    ],
  });
}

function openNewMenu(anchor, m) {
  openMenu(
    anchor,
    [
      { label: 'Time entry', icon: 'clock', run: () => openActivityDialog({ kind: 'time', matterId: m.id }) },
      { label: 'Expense', icon: 'receipt', run: () => openActivityDialog({ kind: 'expense', matterId: m.id }) },
      { label: 'Flat fee', icon: 'dollar', run: () => openActivityDialog({ kind: 'flat', matterId: m.id }) },
      { separator: true },
      { label: 'Task', icon: 'square-check', run: () => openTaskDialog({ matterId: m.id }) },
      { label: 'Event', icon: 'calendar-plus', run: () => openEventDialog({ matterId: m.id }) },
      { label: 'Note', icon: 'sticky-note', run: () => openNoteDialog({ matterId: m.id }) },
      ...LOG_KINDS.map((k) => ({ label: k.label, icon: k.icon, run: () => openLogDialog({ kind: k.id, matterId: m.id, contactId: m.clientId }) })),
      { separator: true },
      { label: 'Upload documents', icon: 'file-up', run: () => import('./docs-upload.js').then((mod) => mod.openUploadDocuments({ matterId: m.id })) },
      { label: 'Document from template', icon: 'wand', run: () => import('./docs-generate.js').then((mod) => mod.openGenerateDocument({ matterId: m.id })) },
      { separator: true },
      { label: 'Bill', icon: 'receipt-text', run: () => navigate(`/billing/new?matter=${m.id}`) },
      { label: 'Payment', icon: 'hand-coins', run: () => openPaymentDialog({ matterId: m.id }) },
      { label: 'Trust deposit', icon: 'vault', run: () => openTrustDialog({ type: 'deposit', matterId: m.id }) },
    ],
    { label: 'New for this matter' },
  );
}

function openMoreMenu(anchor, m) {
  const store = app.store;
  const s = app.settings();
  openMenu(
    anchor,
    [
      { heading: 'Status' },
      ...['open', 'pending', 'closed'].map((st) => ({ label: st[0].toUpperCase() + st.slice(1), checked: m.status === st, run: () => setStatus(m, st) })),
      { separator: true },
      { label: 'Change stage', icon: 'kanban', run: () => changeStage(m, anchor) },
      { label: 'Apply task list', icon: 'list-todo', run: () => applyTaskList(m), disabled: !store.all('taskLists').length },
      { label: 'Run conflict check', icon: 'shield-check', run: () => openConflictCheck(contactName(lookup.contact(m.clientId)), { matterId: m.id }) },
      { label: 'Duplicate matter', icon: 'copy', run: () => duplicate(m) },
      { separator: true },
      { label: 'Delete matter', icon: 'trash', danger: true, run: () => deleteMatter(m) },
    ].filter((x) => x && (!x.heading || s)),
    { align: 'end', label: 'Matter actions' },
  );
}

async function setStatus(m, status) {
  if (status === m.status) return;
  if (status === 'closed') {
    const f = financialsFor(m);
    const warn = [
      f.wip > 0 ? `${formatMoney(f.wip)} of unbilled work` : '',
      f.outstanding > 0 ? `${formatMoney(f.outstanding)} outstanding` : '',
      f.trust > 0 ? `${formatMoney(f.trust)} still held in trust` : '',
    ].filter(Boolean);
    const ok = await confirmDialog({
      title: 'Close this matter?',
      message: warn.length ? `This matter still has ${warn.join(', ')}. You can close it anyway and reopen it later.` : 'Closed matters stay searchable and can be reopened at any time.',
      confirmLabel: 'Close matter',
    });
    if (!ok) return;
  }
  const t = app.today();
  app.store.patch('matters', m.id, { status, closedDate: status === 'closed' ? t : '', pendingDate: status === 'pending' ? t : m.pendingDate || '' });
  toast(`Matter marked ${status}`);
}

function changeStage(m, anchor) {
  const s = app.settings();
  const stages = stagesFor(s, m.practiceAreaId);
  openMenu(
    anchor,
    [
      { heading: 'Move to stage' },
      ...stages.map((st) => ({
        label: st.name,
        checked: m.stageId === st.id,
        run: () => (app.store.patch('matters', m.id, { stageId: st.id, stageChangedAt: new Date().toISOString() }), toast(`Moved to ${st.name}`)),
      })),
    ],
    { label: 'Stages' },
  );
}

function applyTaskList(m) {
  const lists = app.store.all('taskLists');
  let chosen = lists.find((l) => l.practiceAreaId === m.practiceAreaId)?.id || lists[0]?.id;
  const sel = select({ name: 'list', value: chosen, options: lists.map((l) => ({ value: l.id, label: `${l.name} (${(l.items || []).length} tasks)` })) });
  sel.addEventListener('change', () => (chosen = sel.value));
  openDialog({
    title: 'Apply task list',
    size: 'narrow',
    body: h('div.stack', h('label.field', h('span.small-head', 'Task list'), sel), h('p.subtle', 'Due dates count from today. Tasks are assigned by role on this matter.')),
    footer: ({ close }) => [
      h('div.spacer'),
      h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
      h(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            const list = lists.find((l) => l.id === chosen);
            const tasks = tasksFromList(list, m, app.today(), (id) => lookup.user(id)?.active !== false);
            app.store.bulkPut('tasks', tasks);
            toast(`${tasks.length} tasks added`);
            close();
          },
        },
        'Add tasks',
      ),
    ],
  });
}

async function duplicate(m) {
  const store = app.store;
  const number = await store.nextNumber('matters');
  const { displayNumber } = await import('../core/matters.js');
  const copy = { ...structuredClone(m), id: undefined, createdAt: undefined, number, status: 'open', openDate: app.today(), closedDate: '', pendingDate: '', description: `${m.description} (copy)` };
  copy.displayNumber = displayNumber(number, { format: app.settings().numbering.format, client: lookup.contact(m.clientId), openDate: copy.openDate });
  copy.billing = { ...copy.billing, flatFeeBilled: false };
  const out = store.put('matters', copy);
  toast(`Created ${out.displayNumber}`);
  navigate(`/matters/${out.id}/edit`);
}

async function deleteMatter(m) {
  const store = app.store;
  const linked = ['activities', 'bills', 'payments', 'transactions', 'documents'].reduce((n, c) => n + where(store, c, 'matterId', m.id).length, 0);
  if (linked) {
    toast('This matter has time, bills, money, or documents recorded against it. Close it instead so its history is kept.', { type: 'error', duration: 8000 });
    return;
  }
  const ok = await confirmDialog({
    title: 'Delete this matter?',
    message: `${m.displayNumber} and its tasks, events, notes, and logs will be deleted. This cannot be undone.`,
    confirmLabel: 'Delete matter',
    danger: true,
  });
  if (!ok) return;
  for (const c of ['tasks', 'events', 'notes', 'communications'])
    store.bulkRemove(
      c,
      where(store, c, 'matterId', m.id).map((r) => r.id),
    );
  store.remove('matters', m.id);
  // Keep any time on the clock, but not on a matter that no longer exists.
  if (getTimer().matterId === m.id) updateTimer({ matterId: '' });
  toast('Matter deleted');
  navigate('/matters');
}

// ---- Tabs -------------------------------------------------------------------------------

function renderTab(tab, m, ctx, ui) {
  switch (tab) {
    case 'activities':
      return activitiesTab(m, ui);
    case 'calendar':
      return calendarTab(m);
    case 'communications':
      return commsTab(m);
    case 'notes':
      return notesTab(m);
    case 'documents':
      return documentsTab(m, ctx, ui);
    case 'tasks':
      return tasksTab(m);
    case 'bills':
      return billsTab(m);
    case 'transactions':
      return transactionsTab(m);
    case 'contacts':
      return contactsTab(m, ui);
    default:
      return dashboardTab(m);
  }
}

function dashboardTab(m) {
  const store = app.store;
  const s = app.settings();
  const f = financialsFor(m);
  const today = app.today();
  const b = m.billing || {};
  const solLeft = solDaysLeft(m, today);
  const tiles = h(
    'div.stats',
    stat({ label: 'Work in progress', icon: 'clock', value: formatMoney(f.wip), sub: `${formatHoursDecimal(f.wipMinutes)} unbilled hours`, href: `#/matters/${m.id}?tab=activities` }),
    stat({
      label: 'Outstanding balance',
      icon: 'receipt-text',
      value: formatMoney(f.outstanding),
      sub: `${formatMoney(f.billed)} billed to date`,
      tone: f.outstanding > 0 ? 'warning' : null,
      href: `#/matters/${m.id}?tab=bills`,
    }),
    stat({
      label: 'Trust funds',
      icon: 'vault',
      value: formatMoney(f.trust),
      sub: m.trustMinimumCents ? `Minimum ${formatMoney(m.trustMinimumCents)}` : 'No minimum set',
      tone: f.trustLow ? 'warning' : null,
      href: `#/matters/${m.id}?tab=transactions`,
    }),
    stat({ label: 'Paid to date', icon: 'hand-coins', value: formatMoney(f.paid), sub: `${formatHoursDecimal(f.workedMinutes)} hours worked in total` }),
  );
  const budget = f.budget
    ? card({
        title: 'Budget',
        body: h(
          'div.stack-sm',
          h('div.row', h('strong', `${f.budgetUsedPct}% used`), h('div.spacer'), h('span.subtle', `${formatMoney(f.workedAmount)} of ${formatMoney(f.budget)}`)),
          meter(f.budgetUsedPct, { label: 'Budget used' }),
          f.budgetUsedPct > 100 ? h('p.text-danger.small', 'Work recorded is over the budget for this matter.') : null,
        ),
      })
    : null;

  const method = BILLING_METHODS.find((x) => x.id === b.method)?.label || 'Hourly';
  const billingText =
    b.billable === false
      ? 'Not billable'
      : b.method === 'flat'
        ? `${method}, ${formatMoney(b.flatFeeCents)}`
        : b.method === 'contingency'
          ? `${method}, ${b.contingencyPct || 0}%`
          : b.rateCents
            ? `${method}, ${formatMoney(b.rateCents)} per hour`
            : `${method}, user rates`;
  const stages = stagesFor(s, m.practiceAreaId);
  const stageSel = select({
    name: 'stage',
    value: m.stageId || '',
    'aria-label': 'Matter stage',
    cls: 'sm',
    options: [{ value: '', label: 'No stage' }, ...stages.map((x) => ({ value: x.id, label: x.name }))],
  });
  stageSel.addEventListener('change', () => {
    app.store.patch('matters', m.id, { stageId: stageSel.value || null, stageChangedAt: new Date().toISOString() });
    toast('Stage updated');
  });
  const details = card({
    title: 'Matter details',
    actions: h('a.btn.sm.ghost', { href: `#/matters/${m.id}/edit` }, icon('pencil', 14), 'Edit'),
    body: kvList([
      ['Client', m.clientId ? contactLink(m.clientId) : ''],
      ['Responsible lawyer', m.responsibleId ? userChip(m.responsibleId) : ''],
      ['Originating lawyer', m.originatingId ? userChip(m.originatingId) : ''],
      ['Responsible staff', m.staffId ? userChip(m.staffId) : ''],
      ['Practice area', practiceAreaName(s, m.practiceAreaId)],
      ['Stage', stageSel],
      ['Open date', formatDate(m.openDate)],
      m.status === 'pending' ? ['Pending since', formatDate(m.pendingDate)] : null,
      m.status === 'closed' ? ['Closed date', formatDate(m.closedDate)] : null,
      [
        'Statute of limitations',
        m.solDate
          ? h(
              `span${solLeft !== null && solLeft <= 30 ? '.text-danger.strong' : ''}`,
              formatDate(m.solDate),
              m.solSatisfied ? h('span.subtle', ' (satisfied)') : solLeft !== null ? h('span.subtle', solLeft < 0 ? ` (passed ${-solLeft} days ago)` : ` (${solLeft} days left)`) : null,
            )
          : '',
      ],
      ['Billing', billingText],
      ['Client reference', m.clientRef || ''],
      ['Location', m.location || ''],
      [
        'Tags',
        m.tags?.length
          ? h(
              'span.tags',
              m.tags.map((t) => h('span.tag.static', t)),
            )
          : '',
      ],
      ...customFieldPairs('matter', m.custom),
      ['Notes', m.notes ? h('span.pre', m.notes) : ''],
    ]),
  });

  const tasks = where(store, 'tasks', 'matterId', m.id)
    .filter((t) => !t.done)
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    .slice(0, 6);
  const events = where(store, 'events', 'matterId', m.id)
    .filter((e) => e.date >= today)
    .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))
    .slice(0, 5);
  const upcoming = card({
    title: 'Upcoming',
    actions: h('button.btn.sm.ghost', { type: 'button', onClick: () => openTaskDialog({ matterId: m.id }) }, icon('plus', 14), 'Task'),
    flush: true,
    body:
      tasks.length || events.length
        ? h(
            'ul.list.compact-list',
            events.map((e) =>
              h(
                'li',
                h(
                  'button.list-item.as-btn',
                  { type: 'button', onClick: () => openEventDialog({ event: e }) },
                  h('span.date-chip', h('span', formatDate(e.date, { month: 'short' })), h('strong', e.date.slice(8))),
                  h('span.grow', h('span.title', e.title), h('span.sub', e.allDay ? 'All day' : `${formatTime(e.start)}${e.location ? ` · ${e.location}` : ''}`)),
                ),
              ),
            ),
            tasks.map((t) => h('li', taskRow(t, today))),
          )
        : emptyState({ compact: true, icon: 'calendar-check', title: 'Nothing scheduled', text: 'Open tasks and upcoming events for this matter appear here.', headingLevel: 3 }),
  });

  const recent = where(store, 'activities', 'matterId', m.id)
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 6);
  const activity = card({
    title: 'Recent activity',
    actions: h('a.btn.sm.ghost', { href: `#/matters/${m.id}?tab=activities` }, 'View all'),
    flush: true,
    body: recent.length
      ? h(
          'ul.list.compact-list',
          recent.map((a) =>
            h(
              'li',
              h(
                'button.list-item.as-btn',
                { type: 'button', onClick: () => openActivityDialog({ activity: a }) },
                h('span.act-kind', icon(a.kind === 'time' ? 'clock' : a.kind === 'expense' ? 'receipt' : 'dollar', 15)),
                h(
                  'span.grow',
                  h('span.title.truncate', a.description || categoryName(s, a.categoryId) || 'Entry'),
                  h('span.sub', `${formatDate(a.date)} · ${lookup.userName(a.userId) || 'Unassigned'}${a.kind === 'time' ? ` · ${formatHoursDecimal(a.minutes)} h` : ''}`),
                ),
                h('span.num', formatMoney(activityAmount(a))),
              ),
            ),
          ),
        )
      : emptyState({
          compact: true,
          icon: 'clock',
          title: 'No time recorded yet',
          actions: [h('button.btn.sm.primary', { type: 'button', onClick: () => openActivityDialog({ kind: 'time', matterId: m.id }) }, 'Record time')],
          headingLevel: 3,
        }),
  });

  const parties = card({ title: 'Contacts', actions: h('a.btn.sm.ghost', { href: `#/matters/${m.id}?tab=contacts` }, 'Manage'), flush: true, body: partiesList(m, true) });

  return h('div.split', h('div.stack', tiles, budget, upcoming, activity), h('div.stack', details, parties));
}

function taskRow(t, today) {
  return h(
    'div.list-item.task-line',
    h('button.task-check', { type: 'button', role: 'checkbox', 'aria-checked': String(!!t.done), 'aria-label': `Complete ${t.name}`, onClick: () => toggleTask(t) }, t.done ? icon('check', 14) : null),
    h(
      'button.grow.link-row',
      { type: 'button', onClick: () => openTaskDialog({ task: t }) },
      h('span.title', t.name),
      h('span.sub', dueLabel(t, today), t.assigneeId ? ` · ${lookup.userName(t.assigneeId)}` : ''),
    ),
    priorityPill(t.priority),
  );
}

function partiesList(m, compact = false) {
  const rows = [{ contactId: m.clientId, relationship: 'Client' }, ...(m.related || [])].filter((r) => r.contactId);
  if (!rows.length) return emptyState({ compact: true, icon: 'contact', title: 'No contacts', headingLevel: 3 });
  return h(
    'ul.list.compact-list',
    rows.map((r) => {
      const c = lookup.contact(r.contactId);
      const email = primaryEmail(c);
      const phone = primaryPhone(c);
      return h(
        'li',
        h(
          'div.list-item',
          avatar(contactName(c), { color: colorFor(r.contactId), size: 'sm' }),
          h(
            'span.grow',
            h('a.title', { href: `#/contacts/${r.contactId}` }, contactName(c)),
            h('span.sub', [r.relationship, r.billRecipient ? 'Bill recipient' : '', compact ? '' : email].filter(Boolean).join(' · ')),
          ),
          email ? h('a.icon-btn.sm', { href: `mailto:${email}`, 'aria-label': `Email ${contactName(c)}`, title: email }, icon('mail', 15)) : null,
          phone ? h('a.icon-btn.sm', { href: telHref(phone), 'aria-label': `Call ${contactName(c)}`, title: phone }, icon('phone', 15)) : null,
        ),
      );
    }),
  );
}

const TABLE_H = 'min(640px, calc(100dvh - 300px))';

function activitiesTab(m, ui) {
  const store = app.store;
  const s = app.settings();
  const list = () => {
    const { kind, billing } = ui;
    return where(store, 'activities', 'matterId', m.id).filter(
      (a) => (kind === 'all' || a.kind === kind) && (billing === 'all' || (billing === 'unbilled' ? a.billable !== false && !a.billId : billing === 'billed' ? !!a.billId : a.billable === false)),
    );
  };
  const table = dataTable({
    caption: 'Matter activities',
    maxHeight: TABLE_H,
    columns: [
      { id: 'date', label: 'Date', width: '110px', render: (a) => formatDate(a.date), sort: (a) => a.date },
      {
        id: 'kind',
        label: 'Type',
        render: (a) => iconText(a.kind === 'time' ? 'clock' : a.kind === 'expense' ? 'receipt' : 'dollar', a.kind === 'time' ? 'Time' : a.kind === 'expense' ? 'Expense' : 'Flat fee'),
        sort: (a) => a.kind,
      },
      {
        id: 'desc',
        label: 'Description',
        render: (a) => h('button.link-row.truncate', { type: 'button', onClick: () => openActivityDialog({ activity: a }) }, a.description || categoryName(s, a.categoryId) || 'Entry'),
        sort: (a) => a.description || '',
      },
      { id: 'user', label: 'User', render: (a) => userChip(a.userId), sort: (a) => lookup.userName(a.userId) },
      { id: 'hours', label: 'Hours', align: 'r', render: (a) => (a.kind === 'time' ? h('span.num', formatHoursDecimal(a.minutes)) : ''), sort: (a) => a.minutes || 0 },
      {
        id: 'rate',
        label: 'Rate',
        align: 'r',
        render: (a) => (a.kind === 'time' ? moneyCell(a.rateCents) : a.kind === 'expense' ? moneyCell(a.priceCents) : ''),
        sort: (a) => a.rateCents || a.priceCents || 0,
      },
      { id: 'amount', label: 'Amount', align: 'r', render: (a) => moneyCell(activityAmount(a)), sort: (a) => activityAmount(a) },
      { id: 'status', label: 'Billing', render: (a) => activityStatus(a), sort: (a) => (a.billId ? 2 : a.billable === false ? 1 : 0) },
    ],
    sort: { id: 'date', dir: 'desc' },
    onSort: () => {},
    rows: list(),
    empty: emptyState({ compact: true, icon: 'clock', title: 'No entries', text: 'Record time and expenses to bill this matter.', headingLevel: 3 }),
    mobile: (a) =>
      h(
        'button.list-item.as-btn',
        { type: 'button', onClick: () => openActivityDialog({ activity: a }) },
        h(
          'span.grow',
          h('span.title.truncate', a.description || 'Entry'),
          h('span.sub', `${formatDate(a.date)} · ${lookup.userName(a.userId)}${a.kind === 'time' ? ` · ${formatHoursDecimal(a.minutes)} h` : ''}`),
        ),
        h('span.num', formatMoney(activityAmount(a))),
      ),
    footer: (rows) => {
      let mins = 0;
      let amt = 0;
      for (const a of rows) {
        if (a.kind === 'time') mins += a.minutes || 0;
        if (a.billable !== false) amt += activityAmount(a);
      }
      return [h('span', h('strong', String(rows.length)), ' entries'), h('span', 'Hours ', h('strong', formatHoursDecimal(mins))), h('span', 'Billable value ', h('strong', formatMoney(amt)))];
    },
  });
  const refresh = () => table.setRows(list());
  return card({
    cls: 'list-card',
    flush: true,
    body: [
      h(
        'div.toolbar',
        segmented({
          label: 'Entry type',
          value: ui.kind,
          items: [
            { value: 'all', label: 'All' },
            { value: 'time', label: 'Time' },
            { value: 'expense', label: 'Expense' },
            { value: 'flat', label: 'Flat fee' },
          ],
          onChange: (v) => ((ui.kind = v), refresh()),
        }),
        segmented({
          label: 'Billing status',
          value: ui.billing,
          items: [
            { value: 'all', label: 'All' },
            { value: 'unbilled', label: 'Unbilled' },
            { value: 'billed', label: 'Billed' },
            { value: 'nonbillable', label: 'Non-billable' },
          ],
          onChange: (v) => ((ui.billing = v), refresh()),
        }),
        h('div.spacer'),
        h('a.btn', { href: `#/billing/new?matter=${m.id}` }, icon('receipt-text', 16), 'Bill unbilled work'),
        h('button.btn.primary', { type: 'button', onClick: () => openActivityDialog({ kind: 'time', matterId: m.id }) }, icon('plus', 16), 'New entry'),
      ),
      table.node,
    ],
  });
}

export function activityStatus(a) {
  if (a.billId) {
    const b = app.store.get('bills', a.billId);
    return b ? h('a', { href: `#/bills/${b.id}` }, pill(`Bill #${b.number}`, b.status === 'draft' ? 'neutral' : 'success')) : pill('Billed', 'success');
  }
  return a.billable === false ? pill('Non-billable', 'neutral') : pill('Unbilled', 'warning');
}

function calendarTab(m) {
  const store = app.store;
  const today = app.today();
  const evs = where(store, 'events', 'matterId', m.id)
    .slice()
    .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  const upcoming = evs.filter((e) => e.date >= today);
  const past = evs.filter((e) => e.date < today).reverse();
  const kinds = Object.fromEntries(EVENT_KINDS.map((k) => [k.id, k]));
  const row = (e) =>
    h(
      'li',
      h(
        'button.list-item.as-btn',
        { type: 'button', onClick: () => openEventDialog({ event: e }) },
        h('span.date-chip', h('span', formatDate(e.date, { month: 'short' })), h('strong', e.date.slice(8))),
        h(
          'span.grow',
          h('span.title', e.title),
          h('span.sub', [formatDayShort(e.date), e.allDay ? 'All day' : `${formatTime(e.start)} to ${formatTime(e.end)}`, e.location].filter(Boolean).join(' · ')),
        ),
        pill(kinds[e.kind]?.label || 'Event', kinds[e.kind]?.tone || 'neutral'),
      ),
    );
  const sol = m.solDate && !m.solSatisfied ? h('div.notice.warning', icon('flag', 16), h('span', 'Statute of limitations: ', h('strong', formatDate(m.solDate)))) : null;
  return h(
    'div.stack',
    h(
      'div.row',
      sol,
      h('div.spacer'),
      h('a.btn', { href: `#/calendar?date=${upcoming[0]?.date || today}` }, icon('calendar', 16), 'Open calendar'),
      h('button.btn.primary', { type: 'button', onClick: () => openEventDialog({ matterId: m.id }) }, icon('plus', 16), 'New event'),
    ),
    card({
      title: 'Upcoming',
      count: upcoming.length,
      flush: true,
      body: upcoming.length ? h('ul.list.compact-list', upcoming.map(row)) : emptyState({ compact: true, icon: 'calendar', title: 'No upcoming events', headingLevel: 3 }),
    }),
    past.length ? card({ title: 'Past', count: past.length, flush: true, body: h('ul.list.compact-list', past.slice(0, 50).map(row)) }) : null,
  );
}

function commsTab(m) {
  const store = app.store;
  const logs = where(store, 'communications', 'matterId', m.id)
    .slice()
    .sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  const kinds = Object.fromEntries(LOG_KINDS.map((k) => [k.id, k]));
  return h(
    'div.stack',
    h(
      'div.row',
      h('div.spacer'),
      ...LOG_KINDS.map((k) =>
        h('button.btn', { type: 'button', 'aria-label': `Log ${k.label.toLowerCase()}`, onClick: () => openLogDialog({ kind: k.id, matterId: m.id, contactId: m.clientId }) }, icon(k.icon, 16), h('span.hide-sm', `Log ${k.label.toLowerCase()}`)),
      ),
    ),
    card({
      title: 'Communications',
      count: logs.length,
      flush: true,
      body: logs.length
        ? h(
            'ul.list.compact-list',
            logs.map((c) =>
              h(
                'li',
                h(
                  'button.list-item.as-btn',
                  { type: 'button', onClick: () => openLogDialog({ log: c }) },
                  h('span.act-kind', icon(kinds[c.kind]?.icon || 'message', 15)),
                  h(
                    'span.grow',
                    h('span.title', c.subject),
                    h(
                      'span.sub',
                      [
                        kinds[c.kind]?.label,
                        c.direction === 'in' ? 'Incoming' : c.direction === 'out' ? 'Outgoing' : '',
                        c.contactId ? lookup.contactName(c.contactId) : c.toUserId ? `To ${lookup.userName(c.toUserId)}` : '',
                        `${formatDate(c.date)}${c.time ? ` ${formatTime(c.time)}` : ''}`,
                        c.minutes ? `${formatHoursDecimal(c.minutes)} h` : '',
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    ),
                    c.body ? h('span.sub.clamp-2', c.body) : null,
                  ),
                ),
              ),
            ),
          )
        : emptyState({ compact: true, icon: 'messages', title: 'No communications logged', text: 'Log calls, emails, meetings, and internal messages to keep a complete record.', headingLevel: 3 }),
    }),
  );
}

function notesTab(m) {
  const store = app.store;
  const notes = where(store, 'notes', 'matterId', m.id)
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return h(
    'div.stack',
    h('div.row', h('div.spacer'), h('button.btn.primary', { type: 'button', onClick: () => openNoteDialog({ matterId: m.id }) }, icon('plus', 16), 'New note')),
    notes.length
      ? h(
          'div.note-grid',
          notes.map((n) =>
            h(
              'article.card.note-card',
              h(
                'div.note-head',
                h('h3.grow', n.subject || 'Note'),
                h('button.icon-btn.sm', { type: 'button', 'aria-label': `Edit note ${n.subject || ''}`.trim(), onClick: () => openNoteDialog({ note: n }) }, icon('pencil', 15)),
              ),
              h('p.pre.note-body', n.body),
              h('div.note-meta.subtle.small', `${formatDate(n.date)}${n.authorId ? ` · ${lookup.userName(n.authorId)}` : ''}`),
            ),
          ),
        )
      : card({ body: emptyState({ compact: true, icon: 'sticky-note', title: 'No notes yet', text: 'Keep case notes, strategy, and call summaries with the matter.', headingLevel: 3 }) }),
  );
}

function documentsTab(m, ctx, ui) {
  // The documents table watches the store itself, so build it once and keep
  // it (with its search and filters) across this panel's redraws.
  if (ui.docs) return ui.docs;
  const slot = (ui.docs = h('div', h('div.subtle', 'Loading documents...')));
  import('./docs-table.js')
    .then((mod) => slot.replaceChildren(mod.documentsTable({ ctx, matterId: m.id })))
    .catch((err) => {
      console.error(err);
      // Offline, say: the next time the panel is drawn tries again.
      if (ui.docs === slot) ui.docs = null;
      slot.replaceChildren(emptyState({ compact: true, icon: 'alert', title: 'Documents could not be loaded', headingLevel: 3 }));
    });
  return slot;
}

function tasksTab(m) {
  const store = app.store;
  const today = app.today();
  const all = where(store, 'tasks', 'matterId', m.id);
  const open = all.filter((t) => !t.done).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const done = all.filter((t) => t.done).sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  return h(
    'div.stack',
    h(
      'div.row',
      h('div.spacer'),
      store.all('taskLists').length ? h('button.btn', { type: 'button', onClick: () => applyTaskList(m) }, icon('list-todo', 16), 'Apply task list') : null,
      h('button.btn.primary', { type: 'button', onClick: () => openTaskDialog({ matterId: m.id }) }, icon('plus', 16), 'New task'),
    ),
    card({
      title: 'Outstanding',
      count: open.length,
      flush: true,
      body: open.length
        ? h(
            'ul.list.compact-list',
            open.map((t) => h('li', taskRow(t, today))),
          )
        : emptyState({ compact: true, icon: 'circle-check', title: 'No outstanding tasks', headingLevel: 3 }),
    }),
    done.length
      ? card({
          title: 'Completed',
          count: done.length,
          flush: true,
          body: h(
            'ul.list.compact-list.done-list',
            done.slice(0, 50).map((t) => h('li', taskRow(t, today))),
          ),
        })
      : null,
  );
}

function billsTab(m) {
  const store = app.store;
  const today = app.today();
  const payments = store.all('payments');
  const bills = where(store, 'bills', 'matterId', m.id);
  const f = financialsFor(m);
  const table = dataTable({
    caption: 'Matter bills',
    maxHeight: TABLE_H,
    rows: bills,
    sort: { id: 'number', dir: 'desc' },
    onSort: () => {},
    rowHref: (b) => `#/bills/${b.id}`,
    columns: [
      { id: 'number', label: 'Bill', render: (b) => `#${b.number}`, sort: (b) => b.number },
      { id: 'issue', label: 'Issued', render: (b) => formatDate(b.issueDate), sort: (b) => b.issueDate },
      { id: 'due', label: 'Due', render: (b) => formatDate(b.dueDate), sort: (b) => b.dueDate },
      { id: 'total', label: 'Total', align: 'r', render: (b) => moneyCell(billTotals(b).total), sort: (b) => billTotals(b).total },
      { id: 'balance', label: 'Balance', align: 'r', render: (b) => moneyCell(billBalance(b, payments), { muted: true }), sort: (b) => billBalance(b, payments) },
      { id: 'status', label: 'Status', render: (b) => billStatusPill(billStatus(b, payments, today)), sort: (b) => billStatus(b, payments, today) },
    ],
    empty: emptyState({
      compact: true,
      icon: 'receipt-text',
      title: 'No bills yet',
      text: f.wip ? `${formatMoney(f.wip)} of unbilled work is ready to bill.` : 'Bills generated from this matter’s work appear here.',
      headingLevel: 3,
    }),
    mobile: (b) =>
      h(
        'a.list-item',
        { href: `#/bills/${b.id}` },
        h('span.grow', h('span.title', `Bill #${b.number}`), h('span.sub', formatDate(b.issueDate))),
        h('span.num', formatMoney(billTotals(b).total)),
        billStatusPill(billStatus(b, payments, today)),
      ),
  });
  return h(
    'div.stack',
    h(
      'div.stats',
      stat({ label: 'Unbilled', value: formatMoney(f.wip) }),
      stat({ label: 'Billed', value: formatMoney(f.billed) }),
      stat({ label: 'Outstanding', value: formatMoney(f.outstanding), tone: f.outstanding ? 'warning' : null }),
      stat({ label: 'In trust', value: formatMoney(f.trust) }),
    ),
    card({
      cls: 'list-card',
      flush: true,
      body: [
        h(
          'div.toolbar',
          h('div.spacer'),
          h('button.btn', { type: 'button', onClick: () => openPaymentDialog({ matterId: m.id }), disabled: !f.outstanding || null }, icon('hand-coins', 16), 'Record payment'),
          h('a.btn.primary', { href: `#/billing/new?matter=${m.id}` }, icon('plus', 16), 'New bill'),
        ),
        table.node,
      ],
    }),
  );
}

function transactionsTab(m) {
  const store = app.store;
  const accounts = store.all('accounts').filter((a) => a.type === 'trust');
  const tx = where(store, 'transactions', 'matterId', m.id);
  const trustIds = new Set(accounts.map((a) => a.id));
  const rows = ledger(tx.filter((t) => trustIds.has(t.accountId))).reverse();
  const f = financialsFor(m);
  const table = dataTable({
    caption: 'Trust ledger',
    maxHeight: TABLE_H,
    rows,
    columns: [
      { id: 'date', label: 'Date', width: '110px', render: (t) => formatDate(t.date) },
      { id: 'desc', label: 'Description', render: (t) => h('span.truncate', t.description || (t.type === 'deposit' ? 'Deposit' : 'Withdrawal')) },
      { id: 'account', label: 'Account', render: (t) => store.get('accounts', t.accountId)?.name || '' },
      { id: 'ref', label: 'Reference', render: (t) => t.reference || '' },
      { id: 'in', label: 'Deposit', align: 'r', render: (t) => (t.type === 'deposit' ? moneyCell(t.amountCents) : '') },
      { id: 'out', label: 'Withdrawal', align: 'r', render: (t) => (t.type === 'withdrawal' ? moneyCell(t.amountCents) : '') },
      { id: 'bal', label: 'Balance', align: 'r', render: (t) => h('strong.num', formatMoney(t.balance)) },
      {
        id: 'act',
        label: '',
        srLabel: 'Actions',
        render: (t) =>
          t.paymentId
            ? h('span.subtle.small', 'Bill payment')
            : h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Delete transaction', onClick: () => deleteTransaction(t) }, icon('trash', 15)),
      },
    ],
    empty: emptyState({ compact: true, icon: 'vault', title: 'No trust activity', text: 'Record retainers and other client funds held in trust for this matter.', headingLevel: 3 }),
    mobile: (t) =>
      h(
        'div.list-item',
        h('span.grow', h('span.title', t.description || t.type), h('span.sub', `${formatDate(t.date)} · balance ${formatMoney(t.balance)}`)),
        h(`span.num${t.type === 'withdrawal' ? '.text-danger' : '.text-success'}`, `${t.type === 'withdrawal' ? '-' : '+'}${formatMoney(t.amountCents)}`),
      ),
  });
  const perAccount = accounts.length > 1 ? h('div.subtle.small', accounts.map((a) => `${a.name}: ${formatMoney(matterAccountBalance(m.id, a.id, tx))}`).join(' · ')) : null;
  return h(
    'div.stack',
    h(
      'div.stats',
      stat({
        label: 'Trust balance',
        icon: 'vault',
        value: formatMoney(f.trust),
        tone: f.trustLow ? 'warning' : null,
        sub: perAccount ? perAccount.textContent : m.trustMinimumCents ? `Minimum ${formatMoney(m.trustMinimumCents)}` : null,
      }),
      stat({ label: 'Outstanding bills', value: formatMoney(f.outstanding) }),
    ),
    f.trustLow
      ? h('div.notice.warning', icon('warning', 16), h('span', `Trust funds are below the ${formatMoney(m.trustMinimumCents)} minimum for this matter. Consider requesting a replenishment.`))
      : null,
    card({
      cls: 'list-card',
      flush: true,
      body: [
        h(
          'div.toolbar',
          h('h2.grow.toolbar-title', 'Trust ledger'),
          h('button.btn', { type: 'button', onClick: () => openTrustDialog({ type: 'withdrawal', matterId: m.id }), disabled: f.trust <= 0 || null }, 'Withdraw'),
          h('button.btn', { type: 'button', onClick: () => openTrustDialog({ type: 'transfer', matterId: m.id }), disabled: f.trust <= 0 || null }, 'Transfer to operating'),
          h('button.btn', { type: 'button', onClick: () => openPaymentDialog({ matterId: m.id, method: 'trust' }), disabled: f.trust <= 0 || !f.outstanding || null }, 'Pay bill from trust'),
          h('button.btn.primary', { type: 'button', onClick: () => openTrustDialog({ type: 'deposit', matterId: m.id }) }, icon('plus', 16), 'Deposit'),
        ),
        table.node,
      ],
    }),
  );
}

function contactsTab(m, ui) {
  const s = app.settings();
  // A quick-created contact redraws this tab, so the choice lives in `ui`.
  if (ui.picked && !lookup.contact(ui.picked)) ui.picked = '';
  const picker = contactPicker({ name: 'newRelated', value: ui.picked, label: 'Add a related contact', placeholder: 'Find or create a contact', onChange: (v) => (ui.picked = v) });
  const rel = select({ name: 'relationship', value: ui.relationship, 'aria-label': 'Relationship', options: [{ value: '', label: 'Relationship' }, ...s.relationships.map((x) => ({ value: x, label: x }))] });
  rel.addEventListener('change', () => (ui.relationship = rel.value));
  const add = () => {
    const picked = ui.picked;
    if (!picked) return picker.input.focus();
    if (picked === m.clientId || (m.related || []).some((r) => r.contactId === picked)) {
      toast('That contact is already on this matter.', { type: 'info' });
      return;
    }
    app.store.patch('matters', m.id, (cur) => ({ ...cur, related: [...(cur.related || []), { id: newId(), contactId: picked, relationship: rel.value || 'Other' }] }));
    ui.picked = '';
    ui.relationship = '';
    toast('Contact added to the matter');
  };
  const rows = (m.related || []).filter((r) => r.contactId);
  return h(
    'div.stack',
    card({
      title: 'Add a related contact',
      body: h('div.related-add', h('div.grow', picker), rel, h('button.btn.primary', { type: 'button', onClick: add }, 'Add')),
    }),
    card({ title: 'Client', flush: true, body: partiesList({ ...m, related: [] }) }),
    card({
      title: 'Related contacts',
      count: rows.length,
      flush: true,
      body: rows.length
        ? h(
            'ul.list.compact-list',
            rows.map((r) =>
              h(
                'li',
                h(
                  'div.list-item',
                  avatar(lookup.contactName(r.contactId), { color: colorFor(r.contactId), size: 'sm' }),
                  h(
                    'span.grow',
                    h('a.title', { href: `#/contacts/${r.contactId}` }, lookup.contactName(r.contactId)),
                    h('span.sub', [r.relationship, r.billRecipient ? 'Bill recipient' : ''].filter(Boolean).join(' · ')),
                  ),
                  h(
                    'button.icon-btn.sm',
                    {
                      type: 'button',
                      'aria-label': `Remove ${lookup.contactName(r.contactId)} from the matter`,
                      onClick: () => {
                        app.store.patch('matters', m.id, (cur) => ({ ...cur, related: (cur.related || []).filter((x) => x.id !== r.id) }));
                        toast('Removed from the matter', { action: { label: 'Undo', run: () => app.store.patch('matters', m.id, (cur) => ({ ...cur, related: [...(cur.related || []), r] })) } });
                      },
                    },
                    icon('x', 15),
                  ),
                ),
              ),
            ),
          )
        : emptyState({
            compact: true,
            icon: 'users',
            title: 'No related contacts',
            text: 'Add opposing parties, counsel, judges, and witnesses so they are covered by conflict checks.',
            headingLevel: 3,
          }),
    }),
  );
}
