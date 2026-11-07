/** One statement: printable, with what has been paid and what is left. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pill, emptyState } from '../ui/components.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { app, isFamily, isManager, myStudents } from '../app.js';
import { personName } from '../core/format.js';
import { guardiansOf } from '../core/people.js';
import { account, invoiceTotal, lineTotal, qtyOf, STATUS_META } from '../core/billing.js';
import { formatDate } from '../core/dates.js';
import { money } from './common.js';

export function render(ctx) {
  const store = app.store;
  const body = ctx.live(() => {
    const inv = store.get('invoices', ctx.params.id);
    if (!inv || (isFamily() && !myStudents().some((s) => s.id === inv.studentId))) return emptyState({ icon: 'receipt', title: 'Statement not found', headingLevel: 1, actions: [h('a.btn', { href: '#/billing' }, 'Billing')] });
    const s = store.get('students', inv.studentId);
    const acc = account(inv.studentId, store.all('invoices'), store.all('payments'), app.today());
    const row = acc.rows.find((r) => r.invoice.id === inv.id) || { total: invoiceTotal(inv), paid: 0, balance: invoiceTotal(inv), status: 'due' };
    const meta = STATUS_META[row.status];
    const school = app.settings().school;
    const payers = guardiansOf(store.all('guardians'), inv.studentId).filter((g) => g.billing && g.email);
    const mailto = payers.length
      ? `mailto:${payers.map((g) => encodeURIComponent(g.email)).join(',')}?subject=${encodeURIComponent(`Statement #${inv.number} from ${school.name || 'school'}`)}&body=${encodeURIComponent(`Hello,\n\nHere is statement #${inv.number} for ${personName(s)}.\n\n${inv.items.map((i) => `${i.description}: ${money(lineTotal(i))}`).join('\n')}\n\nTotal: ${money(row.total)}\nPaid: ${money(row.paid)}\nBalance due ${formatDate(inv.dueDate)}: ${money(row.balance)}\n\n${app.settings().billing?.message || ''}\n\n${school.name || ''}\n${school.phone || ''}`)}`
      : null;
    return [
      h(
        'div.statement-bar.no-print',
        h('a.btn.ghost', { href: isFamily() ? '#/billing' : '#/billing/statements' }, icon('arrow-left', 16), 'Statements'),
        h('span.spacer'),
        isManager() && inv.status !== 'void'
          ? [
              h('button.btn', { type: 'button', onClick: () => import('./billing.js').then((m) => m.openPaymentForm({ studentId: inv.studentId })) }, icon('wallet', 16), 'Record payment'),
              h('button.btn', { type: 'button', onClick: () => import('./billing.js').then((m) => m.openInvoiceForm({ invoice: inv })) }, icon('pencil', 16), 'Edit'),
              mailto ? h('a.btn', { href: mailto }, icon('mail', 16), 'Email') : null,
              h('button.btn.ghost.danger-text', { type: 'button', onClick: async () => (await confirmDialog({ title: `Void statement #${inv.number}?`, message: 'It stays on record but no longer counts toward the balance.', confirmLabel: 'Void', danger: true })) && (store.patch('invoices', inv.id, { status: 'void' }), toast('Statement voided')) }, 'Void'),
            ]
          : null,
        isManager() && inv.status === 'void' ? h('button.btn', { type: 'button', onClick: () => restore(inv) }, 'Restore') : null,
        h('button.btn', { type: 'button', onClick: () => window.print() }, icon('printer', 16), 'Print'),
      ),
      h(
        'article.statement',
        h(
          'header.statement-head',
          h('div', h('h1', school.name || 'Statement'), h('p.subtle', [school.address, school.phone, school.email].filter(Boolean).join(' · '))),
          h('div.statement-num', h('span.subtle', 'Statement'), h('strong', `#${inv.number}`), pill(meta.label, meta.tone)),
        ),
        h(
          'dl.statement-facts',
          h('div', h('dt', 'Child'), h('dd', personName(s))),
          h('div', h('dt', 'Issued'), h('dd', formatDate(inv.issueDate))),
          h('div', h('dt', 'Due'), h('dd', formatDate(inv.dueDate))),
          h('div', h('dt', 'Billed to'), h('dd', guardiansOf(store.all('guardians'), inv.studentId).filter((g) => g.billing).map((g) => personName(g)).join(', ') || '-')),
        ),
        h(
          'table.table.statement-lines',
          h('thead', h('tr', h('th', 'Description'), h('th.r', 'Qty'), h('th.r', 'Amount'))),
          h('tbody', inv.items.map((it) => h('tr', h('td', it.description), h('td.r', String(qtyOf(it))), h('td.r', money(lineTotal(it)))))),
          h('tfoot', h('tr', h('th', { colspan: 2 }, 'Total'), h('th.r', money(row.total))), h('tr', h('td', { colspan: 2 }, 'Paid'), h('td.r', money(row.paid))), h('tr.balance-row', h('th', { colspan: 2 }, 'Balance due'), h('th.r', money(row.balance)))),
        ),
        inv.memo ? h('p.statement-memo', inv.memo) : app.settings().billing?.message ? h('p.statement-memo', app.settings().billing.message) : null,
      ),
    ];
  }, ['invoices', 'payments', 'students', 'guardians', 'settings']);

  // The period may have been billed again after this statement was voided.
  async function restore(inv) {
    const again = inv.period && store.all('invoices').find((i) => i.id !== inv.id && i.studentId === inv.studentId && i.period === inv.period && i.status !== 'void');
    if (again && !(await confirmDialog({ title: `Restore statement #${inv.number}?`, message: `Statement #${again.number} already bills this period. Restoring this one bills it twice.`, confirmLabel: 'Restore' }))) return;
    store.patch('invoices', inv.id, { status: 'open' });
  }
  const inv = store.get('invoices', ctx.params.id);
  const visible = inv && (!isFamily() || myStudents().some((s) => s.id === inv.studentId));
  return { node: h('div.page.narrow', body), title: visible ? (inv.number ? `Statement #${inv.number}` : 'Statement') : 'Statement not found' };
}
