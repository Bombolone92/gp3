/**
 * Billing: tuition plans, statements (one per child per period), payments,
 * and balances. Directors run billing for a week or month in one step.
 * Families see their own statements and balance.
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pageHeader, tabs, stat, dataTable, emptyState, field, textInput, textarea, select, moneyInput, pill, chips, searchBox, card, segmented } from '../ui/components.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { navigate } from '../ui/router.js';
import { app, isFamily, isManager, myStudents } from '../app.js';
import { personName, pluralize, matches } from '../core/format.js';
import { sortByName } from '../core/people.js';
import { account, allAccounts, aging, invoiceTotal, planBillingRun, periodFor, STATUS_META, collectedByMonth } from '../core/billing.js';
import { PAYMENT_METHODS, BILLING_FREQUENCIES } from '../core/settings.js';
import { formatDate, addDays, addMonths, startOfMonth } from '../core/dates.js';
import { newId } from '../core/ids.js';
import { downloadText, toCSV } from '../core/csv.js';
import { columnChart } from '../ui/chart.js';
import { money, childLink, childAvatar } from './common.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'balances', label: 'Balances' },
  { id: 'statements', label: 'Statements' },
  { id: 'payments', label: 'Payments' },
  { id: 'plans', label: 'Tuition plans' },
];

export function render(ctx) {
  if (isFamily()) return renderFamily(ctx);
  const store = app.store;
  let tab = TABS.some((t) => t.id === ctx.params.tab) ? ctx.params.tab : 'overview';
  let status = 'open';
  let q = '';

  const body = ctx.live(() => {
    const today = app.today();
    const invoices = store.all('invoices');
    const payments = store.all('payments');
    const accounts = allAccounts(invoices, payments, today);
    const student = (id) => store.get('students', id);
    const views = {
      overview() {
        const month = startOfMonth(today);
        const billed = invoices.filter((i) => i.status !== 'void' && (i.dueDate || i.issueDate).slice(0, 7) === month.slice(0, 7)).reduce((s, i) => s + invoiceTotal(i), 0);
        const collected = payments.filter((p) => (p.date || '').slice(0, 7) === month.slice(0, 7) && p.kind !== 'credit').reduce((s, p) => s + p.amountCents, 0);
        let outstanding = 0;
        let overdue = 0;
        for (const a of accounts.values()) {
          if (a.balance > 0) outstanding += a.balance;
          overdue += a.overdue;
        }
        const ag = aging(accounts, today);
        const series = collectedByMonth(payments, addMonths(month, -5), today);
        return [
          h(
            'div.stats',
            stat({ label: 'Due this month', value: money(billed) }),
            stat({ label: 'Collected this month', value: money(collected), tone: 'success' }),
            stat({ label: 'Outstanding', value: money(outstanding), href: '#/billing/balances' }),
            stat({ label: 'Overdue', value: money(overdue), tone: overdue ? 'danger' : null, href: '#/billing/balances' }),
          ),
          h(
            'div.home-grid',
            h(
              'div.home-main',
              card({ title: 'Collected by month', body: columnChart({ title: 'Collected by month', categories: series.map((x) => ({ label: formatDate(`${x.month}-01`, { month: 'short' }), values: [x.cents] })), series: [{ name: 'Collected', color: 'var(--series-1)' }], format: money, short: (c) => money(c).replace(/\.00$/, '') }) }),
              card({
                title: 'Receivables aging',
                body: h(
                  'div.aging',
                  [
                    ['Current', ag.current],
                    ['1 to 30 days', ag.d30],
                    ['31 to 60 days', ag.d60],
                    ['61 to 90 days', ag.d90],
                    ['Over 90 days', ag.older],
                  ].map(([label, c], i) => h(`div.aging-cell${i && c ? '.late' : ''}`, h('span.subtle.small', label), h('strong', money(c)))),
                ),
              }),
            ),
            h(
              'div.home-aside',
              card({
                title: 'Run billing',
                body: h('div.stack', h('p.subtle', 'Create this period\'s statements from each child\'s tuition plans. Children already billed for the period are skipped.'), h('button.btn.primary', { type: 'button', onClick: () => openBillingRun() }, icon('repeat', 16), 'Run billing')),
              }),
              card({
                title: 'Recent payments',
                flush: true,
                body: payments.length
                  ? h('ul.mini-list', [...payments].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map((p) => h('li', childAvatar(student(p.studentId) || {}, { size: 'sm' }), h('span.grow', h('span.person-name', personName(student(p.studentId))), h('span.person-sub', `${formatDate(p.date)} · ${methodLabel(p)}`)), h('strong.num', money(p.amountCents)))))
                  : h('p.card-pad.subtle', 'No payments yet.'),
              }),
            ),
          ),
        ];
      },
      balances() {
        const known = new Set(store.all('students').map((s) => s.id));
        // A deleted child's statements still count toward Outstanding, so list them too.
        const gone = [...accounts.keys()].filter((id) => !known.has(id)).map((id) => ({ s: null, a: accounts.get(id) }));
        const rows = [...sortByName(store.all('students').filter((s) => accounts.has(s.id) || s.status === 'active')).map((s) => ({ s, a: accounts.get(s.id) || { balance: 0, overdue: 0, paid: 0, billed: 0 } })), ...gone].filter((r) => matches(personName(r.s), q));
        return [
          h('div.toolbar', h('span.grow'), searchBox({ value: q, placeholder: 'Search children', onInput: (v) => ((q = v), body.redraw()) })),
          dataTable({
            columns: [
              { id: 'name', label: 'Child', render: (r) => childLink(r.s, { href: r.s && `#/children/${r.s.id}?tab=billing` }), sort: (r) => personName(r.s).toLowerCase() },
              { id: 'billed', label: 'Billed', align: 'r', render: (r) => money(r.a.billed), sort: (r) => r.a.billed },
              { id: 'paid', label: 'Paid', align: 'r', render: (r) => money(r.a.paid), sort: (r) => r.a.paid },
              { id: 'balance', label: 'Balance', align: 'r', render: (r) => (r.a.balance < 0 ? h('span.success-text', `${money(-r.a.balance)} credit`) : money(r.a.balance)), sort: (r) => r.a.balance },
              { id: 'overdue', label: 'Overdue', align: 'r', render: (r) => (r.a.overdue ? h('strong.danger-text', money(r.a.overdue)) : h('span.subtle', '-')), sort: (r) => r.a.overdue },
              { id: 'act', label: '', srLabel: 'Actions', align: 'r', render: (r) => (r.s ? h('button.btn.sm', { type: 'button', onClick: () => openPaymentForm({ studentId: r.s.id }) }, 'Record payment') : null) },
            ],
            rows,
            sort: { id: 'balance', dir: 'desc' },
            onSort: null,
            rowHref: (r) => (r.s ? `#/children/${r.s.id}?tab=billing` : null),
            caption: 'Balances',
            mobile: (r) => h(r.s ? 'a.list-item' : 'div.list-item', { href: r.s ? `#/children/${r.s.id}?tab=billing` : null }, childAvatar(r.s), h('span.grow', h('span.title', personName(r.s)), h('span.meta', r.a.overdue ? `${money(r.a.overdue)} overdue` : 'Up to date')), h('strong.num', money(r.a.balance))),
          }),
        ];
      },
      statements() {
        const rows = [];
        for (const a of accounts.values()) for (const r of a.rows) rows.push(r);
        const counts = { open: rows.filter((r) => ['due', 'partial', 'overdue'].includes(r.status)).length, overdue: rows.filter((r) => r.status === 'overdue').length, paid: rows.filter((r) => r.status === 'paid').length, all: rows.length };
        const filtered = rows.filter((r) => (status === 'all' ? true : status === 'open' ? ['due', 'partial', 'overdue'].includes(r.status) : r.status === status) && matches(`${personName(student(r.invoice.studentId))} ${r.invoice.number}`, q));
        return [
          h(
            'div.toolbar',
            chips({ label: 'Status', items: [{ id: 'open', label: 'Unpaid', count: counts.open }, { id: 'overdue', label: 'Overdue', count: counts.overdue }, { id: 'paid', label: 'Paid', count: counts.paid }, { id: 'all', label: 'All', count: counts.all }], selected: status, onSelect: (v) => ((status = v), body.redraw()) }),
            h('span.grow'),
            searchBox({ value: q, placeholder: 'Search statements', onInput: (v) => ((q = v), body.redraw()) }),
          ),
          dataTable({
            columns: [
              { id: 'num', label: 'Statement', render: (r) => `#${r.invoice.number}`, sort: (r) => Number(r.invoice.number) },
              { id: 'child', label: 'Child', render: (r) => personName(student(r.invoice.studentId)), sort: (r) => personName(student(r.invoice.studentId)) },
              { id: 'issued', label: 'Issued', render: (r) => formatDate(r.invoice.issueDate), sort: (r) => r.invoice.issueDate },
              { id: 'due', label: 'Due', render: (r) => formatDate(r.invoice.dueDate), sort: (r) => r.invoice.dueDate },
              { id: 'total', label: 'Total', align: 'r', render: (r) => money(r.total), sort: (r) => r.total },
              { id: 'bal', label: 'Balance', align: 'r', render: (r) => money(r.balance), sort: (r) => r.balance },
              { id: 'status', label: 'Status', render: (r) => pill(STATUS_META[r.status].label, STATUS_META[r.status].tone), sort: (r) => r.status },
            ],
            rows: filtered,
            sort: { id: 'due', dir: 'desc' },
            onSort: null,
            rowHref: (r) => `#/statements/${r.invoice.id}`,
            caption: 'Statements',
            mobile: (r) => h('a.list-item', { href: `#/statements/${r.invoice.id}` }, h('span.grow', h('span.title', `#${r.invoice.number} · ${personName(student(r.invoice.studentId))}`), h('span.meta', `Due ${formatDate(r.invoice.dueDate)}`)), h('span.stack.r', h('strong.num', money(r.total)), pill(STATUS_META[r.status].label, STATUS_META[r.status].tone))),
            empty: emptyState({ icon: 'receipt', title: 'No statements here', text: 'Run billing to create statements from tuition plans.', compact: true }),
          }),
        ];
      },
      payments() {
        const rows = [...payments].filter((p) => matches(`${personName(student(p.studentId))} ${p.reference || ''}`, q)).sort((a, b) => b.date.localeCompare(a.date));
        return [
          h(
            'div.toolbar',
            h('button.btn', { type: 'button', onClick: () => downloadText(`payments-${today}.csv`, toCSV([['Date', 'Child', 'Amount', 'Method', 'Reference', 'Note'], ...rows.map((p) => [p.date, personName(student(p.studentId)), (p.amountCents / 100).toFixed(2), methodLabel(p), p.reference || '', p.note || ''])])) }, icon('download', 16), 'Export CSV'),
            h('span.grow'),
            searchBox({ value: q, placeholder: 'Search payments', onInput: (v) => ((q = v), body.redraw()) }),
          ),
          dataTable({
            columns: [
              { id: 'date', label: 'Date', render: (p) => formatDate(p.date), sort: (p) => p.date },
              { id: 'child', label: 'Child', render: (p) => childLink(student(p.studentId), { href: `#/children/${p.studentId}?tab=billing` }), sort: (p) => personName(student(p.studentId)) },
              { id: 'method', label: 'Method', render: (p) => methodLabel(p) },
              { id: 'ref', label: 'Reference', render: (p) => p.reference || h('span.subtle', '-') },
              { id: 'amount', label: 'Amount', align: 'r', render: (p) => money(p.amountCents), sort: (p) => p.amountCents },
              { id: 'act', label: '', srLabel: 'Actions', align: 'r', render: (p) => h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Edit payment', onClick: () => openPaymentForm({ payment: p }) }, icon('pencil', 15)) },
            ],
            rows,
            sort: { id: 'date', dir: 'desc' },
            onSort: null,
            caption: 'Payments',
            mobile: (p) => h('button.list-item.plain-btn', { type: 'button', onClick: () => openPaymentForm({ payment: p }) }, h('span.grow', h('span.title', personName(student(p.studentId))), h('span.meta', `${formatDate(p.date)} · ${methodLabel(p)}`)), h('strong.num', money(p.amountCents))),
            empty: emptyState({ icon: 'wallet', title: 'No payments yet', compact: true }),
          }),
        ];
      },
      plans() {
        const plans = store.all('plans');
        const enrolled = (id) => store.all('students').filter((s) => s.status === 'active' && (s.plans || []).some((p) => p.planId === id)).length;
        return plans.length
          ? h(
              'div.room-grid',
              plans.map((p) =>
                h(
                  'article.room-card.plan-card',
                  h('div.room-card-head', h('h2', p.name), p.description ? h('span.subtle.small', p.description) : null),
                  h('div.plan-price', h('strong', money(p.amountCents)), h('span.subtle', p.frequency === 'weekly' ? ' per week' : ' per month')),
                  h('div.room-card-foot', h('span.subtle.small', `${pluralize(enrolled(p.id), 'child', 'children')} enrolled`), h('button.btn.sm', { type: 'button', onClick: () => openPlanForm(p) }, 'Edit')),
                ),
              ),
            )
          : emptyState({ icon: 'receipt', title: 'No tuition plans yet', text: 'Create plans like "Toddler full time, $1,600 per month", then assign them to children.', actions: [h('button.btn.primary', { type: 'button', onClick: () => openPlanForm() }, 'Add a plan')] });
      },
    };
    return [
      tabs({ label: 'Billing', items: TABS, selected: tab, onSelect: (t) => ((tab = t), (q = ''), history.replaceState(null, '', `#/billing${t === 'overview' ? '' : `/${t}`}`), body.redraw()) }),
      h('div.tab-panel', views[tab]()),
    ];
  }, ['invoices', 'payments', 'plans', 'students']);

  return h(
    'div.page',
    pageHeader({
      title: 'Billing',
      actions: [h('button.btn', { type: 'button', onClick: () => openPlanForm() }, icon('plus', 16), h('span.hide-mobile', 'Plan')), h('button.btn', { type: 'button', onClick: () => openPaymentForm() }, icon('wallet', 16), 'Record payment'), h('button.btn.primary', { type: 'button', onClick: () => openInvoiceForm() }, icon('receipt', 16), 'New statement')],
    }),
    body,
  );
}

// A credit keeps the form's default method, so name its kind instead.
const methodLabel = (p) => (p.kind === 'credit' ? 'Credit or discount' : PAYMENT_METHODS.find((m) => m.id === p.method)?.label || p.method || '');

// ---- Family view -----------------------------------------------------------------------

function renderFamily(ctx) {
  const store = app.store;
  const body = ctx.live(() => {
    const kids = myStudents();
    const today = app.today();
    const settings = app.settings();
    return [
      settings.billing?.message ? h('p.notice.accent', icon('info', 16), h('span', settings.billing.message)) : null,
      kids.map((s) => {
        const a = account(s.id, store.all('invoices'), store.all('payments'), today);
        return card({
          title: personName(s),
          body: h(
            'div.stack',
            h('div.stats', stat({ label: a.balance < 0 ? 'Credit' : 'Balance', value: money(Math.abs(a.balance)) }), stat({ label: 'Overdue', value: money(a.overdue), tone: a.overdue ? 'danger' : null }), stat({ label: 'Paid to date', value: money(a.paid) })),
            a.rows.length
              ? h('ul.mini-list.card-list', [...a.rows].reverse().map((r) => h('li', h('a.grow.plain-link', { href: `#/statements/${r.invoice.id}` }, h('span.person-name', `Statement #${r.invoice.number}`), h('span.person-sub', `Due ${formatDate(r.invoice.dueDate)}`)), h('strong.num', money(r.total)), pill(STATUS_META[r.status].label, STATUS_META[r.status].tone))))
              : h('p.subtle', 'No statements yet.'),
          ),
        });
      }),
      h('p.subtle.small.mt', 'Payments are made directly to the school. Contact the office with any questions about your statement.'),
    ];
  }, ['invoices', 'payments', 'students', 'settings']);
  return h('div.page.narrow', pageHeader({ title: 'Billing' }), body);
}

// ---- Forms -------------------------------------------------------------------------------

function childSelect(value) {
  const kids = sortByName(app.store.all('students').filter((s) => s.status !== 'inquiry'));
  return select({ options: [{ value: '', label: 'Choose a child' }, ...kids.map((s) => ({ value: s.id, label: personName(s) }))], value: value || '', required: true });
}

/** New or edited statement with line items. */
export function openInvoiceForm({ studentId = '', invoice = null } = {}) {
  if (!isManager()) return;
  const store = app.store;
  const today = app.today();
  const inv = structuredClone(invoice || { studentId, issueDate: today, dueDate: addDays(today, app.settings().billing?.dueDays ?? 7), items: [], status: 'open', memo: '' });
  const tuition = new Map(); // prefilled line id -> period key
  if (!inv.items.length) {
    const s = store.get('students', inv.studentId);
    for (const sp of s?.plans || []) {
      const p = store.get('plans', sp.planId);
      if (!p) continue;
      const period = periodFor(p.frequency, today, 1);
      const id = newId();
      tuition.set(id, period.key);
      inv.items.push({ id, description: `${p.name}, ${period.label}`, amountCents: Number.isFinite(sp.amountCents) ? sp.amountCents : p.amountCents, qty: 1 });
    }
    if (!inv.items.length) inv.items.push({ id: newId(), description: '', amountCents: 0, qty: 1 });
  }
  const child = childSelect(inv.studentId);
  const issue = textInput({ type: 'date', value: inv.issueDate });
  const due = textInput({ type: 'date', value: inv.dueDate });
  const memo = textarea({ value: inv.memo || '', rows: 2, placeholder: 'Shown on the statement' });
  const items = h('div.line-items');
  const total = h('strong.num');
  const drawItems = () => {
    items.replaceChildren(
      h('div.line-item.line-head', h('span', 'Description'), h('span.r', 'Qty'), h('span.r', 'Amount'), h('span')),
      ...inv.items.map((it, i) => {
        const d = textInput({ value: it.description, placeholder: 'Tuition, registration fee, late fee...', 'aria-label': 'Description' });
        d.addEventListener('input', () => (it.description = d.value));
        const q = textInput({ type: 'number', min: '0', step: '1', value: it.qty ?? 1, 'aria-label': 'Quantity', cls: 'num' });
        q.addEventListener('input', () => ((it.qty = Number(q.value) || 0), sum()));
        const a = moneyInput({ cents: it.amountCents, 'aria-label': 'Amount' });
        a.addEventListener('input', () => ((it.amountCents = a.cents), sum()));
        return h('div.line-item', d, q, a, h('button.icon-btn', { type: 'button', 'aria-label': 'Remove line', onClick: () => (inv.items.splice(i, 1), drawItems()) }, icon('trash', 16)));
      }),
      h('div.row', h('button.btn.sm', { type: 'button', onClick: () => (inv.items.push({ id: newId(), description: '', amountCents: 0, qty: 1 }), drawItems()) }, icon('plus', 15), 'Add line'), h('span.spacer'), h('span.subtle', 'Total'), total),
    );
    sum();
  };
  const sum = () => (total.textContent = money(invoiceTotal(inv)));
  drawItems();
  openDialog({
    title: invoice ? `Edit statement #${invoice.number}` : 'New statement',
    size: 'wide',
    body: h('div.stack', h('div.form-grid.three', field('Child', child, { required: true }), field('Issued', issue), field('Due', due)), items, field('Message', memo)),
    footer: ({ close }) => [
      h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
      h(
        'button.btn.primary',
        {
          type: 'button',
          onClick: async (e) => {
            const btn = e.currentTarget;
            if (btn.disabled) return;
            if (!child.value) return child.focus();
            const lines = inv.items.filter((it) => it.description.trim() || it.amountCents);
            if (!lines.length) return toast('Add at least one line.', { type: 'error' });
            const rec = { ...inv, studentId: child.value, issueDate: issue.value || today, dueDate: due.value || issue.value || today, memo: memo.value.trim(), items: lines.map((it) => ({ ...it, description: it.description.trim() || 'Charge' })) };
            // Kept tuition lines bill their period, so a billing run does not bill it again.
            const periods = new Set(lines.filter((it) => tuition.has(it.id)).map((it) => tuition.get(it.id)));
            if (!rec.period && rec.studentId === inv.studentId && periods.size === 1) rec.period = [...periods][0];
            if (!rec.number) {
              // A second click while the number is being reserved would create a second statement.
              btn.disabled = true;
              try {
                rec.number = await store.nextNumber('invoices');
              } catch (err) {
                return toast(err.message || 'The statement could not be created.', { type: 'error' });
              } finally {
                btn.disabled = false;
              }
            }
            const saved = store.put('invoices', rec);
            toast(invoice ? 'Statement saved' : `Statement #${saved.number} created`);
            close();
            if (!invoice) navigate(`/statements/${saved.id}`);
          },
        },
        invoice ? 'Save' : 'Create statement',
      ),
    ],
  });
}

/** Record or edit a payment (or a credit). */
export function openPaymentForm({ studentId = '', payment = null } = {}) {
  if (!isManager()) return;
  const store = app.store;
  const p = structuredClone(payment || { studentId, amountCents: 0, date: app.today(), method: 'card', reference: '', note: '', kind: 'payment' });
  if (!payment && studentId) {
    const a = account(studentId, store.all('invoices'), store.all('payments'), app.today());
    if (a.balance > 0) p.amountCents = a.balance;
  }
  const child = childSelect(p.studentId);
  const amount = moneyInput({ cents: p.amountCents, required: true });
  const date = textInput({ type: 'date', value: p.date });
  const method = select({ options: PAYMENT_METHODS.map((m) => ({ value: m.id, label: m.label })), value: p.method });
  const ref = textInput({ value: p.reference || '', placeholder: 'Check number, last 4 digits...' });
  const note = textInput({ value: p.note || '' });
  let kind = p.kind || 'payment';
  openDialog({
    title: payment ? 'Edit payment' : 'Record a payment',
    body: h('div.stack', h('div.field', h('span.field-label', 'Type'), segmented({ label: 'Type', items: [{ value: 'payment', label: 'Payment' }, { value: 'credit', label: 'Credit or discount' }], value: kind, onChange: (v) => (kind = v) })), h('div.form-grid', field('Child', child, { required: true }), field('Amount', amount, { required: true }), field('Date', date), field('Method', method), field('Reference', ref), field('Note', note))),
    footer: ({ close }) => [
      payment ? h('button.btn.ghost.danger-text', { type: 'button', onClick: async () => (await confirmDialog({ title: 'Delete this payment?', message: `${money(payment.amountCents)} on ${formatDate(payment.date)}`, confirmLabel: 'Delete', danger: true })) && (store.remove('payments', payment.id), close()) }, icon('trash', 16), 'Delete') : null,
      h('span.spacer'),
      h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
      h(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            if (!child.value) return child.focus();
            if (!(amount.cents > 0)) return amount.focus();
            store.put('payments', { ...p, studentId: child.value, amountCents: amount.cents, date: date.value || app.today(), method: method.value, reference: ref.value.trim(), note: note.value.trim(), kind });
            toast(payment ? 'Payment saved' : `${money(amount.cents)} recorded`);
            close();
          },
        },
        payment ? 'Save' : 'Record',
      ),
    ],
  });
}

export function openPlanForm(plan = null) {
  const store = app.store;
  const name = textInput({ value: plan?.name || '', required: true, placeholder: 'Toddler full time' });
  const amount = moneyInput({ cents: plan?.amountCents || 0 });
  const freq = select({ options: BILLING_FREQUENCIES.map((f) => ({ value: f.id, label: f.label })), value: plan?.frequency || 'monthly' });
  const desc = textInput({ value: plan?.description || '', placeholder: 'Monday to Friday, full day' });
  openDialog({
    title: plan ? 'Edit plan' : 'Add a tuition plan',
    size: 'narrow',
    body: h('div.stack', field('Name', name, { required: true }), h('div.form-grid', field('Price', amount), field('Billed', freq)), field('Description', desc)),
    footer: ({ close }) => [
      plan ? h('button.btn.ghost.danger-text', { type: 'button', onClick: async () => (await confirmDialog({ title: `Delete ${plan.name}?`, message: 'Children on this plan are no longer billed for it. Existing statements stay as they are.', confirmLabel: 'Delete plan', danger: true })) && (store.remove('plans', plan.id), close()) }, 'Delete') : null,
      h('span.spacer'),
      h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
      h('button.btn.primary', { type: 'button', onClick: () => (name.value.trim() ? (store.put('plans', { ...(plan || {}), name: name.value.trim(), amountCents: amount.cents, frequency: freq.value, description: desc.value.trim() }), toast('Plan saved'), close()) : name.focus()) }, plan ? 'Save' : 'Add plan'),
    ],
  });
}

/** Create a period's statements from tuition plans, with a preview first. */
export function openBillingRun() {
  const store = app.store;
  let frequency = 'monthly';
  let day = app.today();
  const preview = h('div');
  const dateIn = textInput({ type: 'date', value: day });
  const draw = () => {
    const { period, drafts } = planBillingRun({ students: store.all('students'), plans: store.all('plans'), invoices: store.all('invoices') }, { frequency, day, dueDays: app.settings().billing?.dueDays ?? 7, weekStart: 1 });
    const total = drafts.reduce((s, d) => s + invoiceTotal(d), 0);
    preview.replaceChildren(
      h('p', h('strong', period.label), ` · ${pluralize(drafts.length, 'statement')} · ${money(total)}`),
      drafts.length
        ? h('ul.mini-list.card-list.run-list', drafts.map((d) => h('li', childAvatar(store.get('students', d.studentId)), h('span.grow', h('span.person-name', personName(store.get('students', d.studentId))), h('span.person-sub', d.items.map((i) => i.description).join(', '))), h('strong.num', money(invoiceTotal(d))))))
        : h('p.subtle', 'Nothing to bill: every child on a matching plan already has a statement for this period.'),
    );
    preview.drafts = drafts;
  };
  dateIn.addEventListener('change', () => ((day = dateIn.value || app.today()), draw()));
  draw();
  openDialog({
    title: 'Run billing',
    size: 'wide',
    body: h('div.stack', h('div.form-grid', h('div.field', h('span.field-label', 'Plans billed'), segmented({ label: 'Frequency', items: BILLING_FREQUENCIES.map((f) => ({ value: f.id, label: f.label })), value: frequency, onChange: (v) => ((frequency = v), draw()) })), field('Period containing', dateIn)), preview),
    footer: ({ close }) => [
      h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
      h(
        'button.btn.primary',
        {
          type: 'button',
          onClick: async (e) => {
            // A second click while the first is still checking would bill everyone twice.
            const btn = e.currentTarget;
            if (btn.disabled) return;
            btn.disabled = true;
            try {
              // Another admin may have billed this period meanwhile: check again.
              await store.sync({ only: ['invoices'] });
              draw();
              const drafts = preview.drafts || [];
              if (!drafts.length) return close();
              let n = await store.nextNumber('invoices', drafts.length);
              const recs = drafts.map((d) => ({ ...d, id: newId(), number: n++ }));
              store.bulkPut('invoices', recs);
              toast(`Created ${pluralize(recs.length, 'statement')}`);
              close();
              navigate('/billing/statements');
            } catch (err) {
              toast(err.message || 'The statements could not be created.', { type: 'error' });
            } finally {
              btn.disabled = false;
            }
          },
        },
        'Create statements',
      ),
    ],
  });
}
