/**
 * One bill: a printable document, its workflow (draft, approval, issue,
 * payment, void), payments, and inline editing while it is a draft.
 */
import '../styles/billing.css';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { pageHeader, emptyState, card, textInput, textarea, select, moneyInput, durationInput, kvList } from '../ui/components.js';
import { navigate } from '../ui/router.js';
import { openMenu } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { matterLink, contactLink, billStatusPill, financialsFor } from './common.js';
import { openPaymentDialog, deletePayment } from './money-dialogs.js';
import { approveBills, issueBills, voidBills, deleteDrafts, releaseActivities } from './billing-actions.js';
import { billTotals, billPaid, billBalance, billStatus, lineAmount } from '../core/finance.js';
import { formatMoney, centsToInput, parseMoney } from '../core/money.js';
import { formatHoursDecimal } from '../core/duration.js';
import { formatDate, isISODate, today as localDate } from '../core/dates.js';
import { contactName, formatAddress, initials, primaryEmail } from '../core/format.js';
import { PAYMENT_METHODS } from '../core/settings.js';
import { downloadCsv } from '../core/csv.js';
import { newId } from '../core/ids.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  let editing = false;
  let draft = null;
  let dateInputs = {};
  const root = h('div.page.bill-page');

  function bill() {
    return store.get('bills', id);
  }

  function draw() {
    const b = bill();
    if (!b) {
      root.replaceChildren(
        emptyState({ icon: 'receipt-text', title: 'Bill not found', text: 'It may have been deleted.', headingLevel: 1, actions: [h('a.btn.primary', { href: '#/billing' }, 'Back to billing')] }),
      );
      return;
    }
    const doc = editing ? editDoc() : readDoc(b);
    root.replaceChildren(header(b), h('div.split.bill-split', h('div.stack', doc), h('div.stack.no-print', sidePanels(b))));
  }

  // ---- Header and workflow ----------------------------------------------------------

  function header(b) {
    const pays = store.all('payments');
    const st = billStatus(b, pays, app.today());
    const actions = [];
    if (editing) {
      actions.push(h('button.btn', { type: 'button', onClick: cancelEdit }, 'Cancel'), h('button.btn.primary', { type: 'button', onClick: saveEdit }, icon('save', 16), 'Save changes'));
    } else {
      if (b.status === 'draft') {
        actions.push(
          h('button.btn', { type: 'button', onClick: startEdit }, icon('pencil', 16), 'Edit'),
          h('button.btn', { type: 'button', onClick: () => approveBills([b]) }, 'Submit for approval'),
          h('button.btn.primary', { type: 'button', onClick: () => issueBills([b]) }, icon('check', 16), 'Approve and issue'),
        );
      } else if (b.status === 'pending') {
        actions.push(
          h('button.btn', { type: 'button', onClick: () => (store.patch('bills', b.id, { status: 'draft' }), toast('Bill returned to draft')) }, 'Back to draft'),
          h('button.btn.primary', { type: 'button', onClick: () => issueBills([b]) }, icon('check', 16), 'Approve'),
        );
      } else if (b.status !== 'void' && billBalance(b, pays) > 0) {
        actions.push(
          b.sentAt
            ? null
            : h('button.btn', { type: 'button', onClick: () => (store.patch('bills', b.id, { sentAt: new Date().toISOString() }), toast('Marked as sent')) }, icon('send', 16), 'Mark sent'),
          h('button.btn.primary', { type: 'button', onClick: () => openPaymentDialog({ billId: b.id }) }, icon('hand-coins', 16), 'Record payment'),
        );
      }
      actions.push(h('button.btn', { type: 'button', onClick: () => window.print() }, icon('printer', 16), h('span.hide-sm', 'Print or PDF')));
      actions.push(h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'More bill actions', title: 'More', onClick: (e) => moreMenu(e.currentTarget, b) }, icon('more', 18)));
    }
    return pageHeader({
      title: `Bill #${b.number}`,
      crumbs: [{ label: 'Billing', href: '#/billing' }, { label: `Bill #${b.number}` }],
      subtitle: [billStatusPill(st), contactLink(b.clientId), matterLink(b.matterId), b.sentAt ? h('span.subtle', `Sent ${formatDate(localDate(new Date(b.sentAt)))}`) : null],
      actions,
    });
  }

  function moreMenu(anchor, b) {
    const c = lookup.contact(b.clientId);
    openMenu(
      anchor,
      [
        { label: 'Download lines as CSV', icon: 'download', run: () => exportLines(b) },
        { label: 'Email to client', icon: 'mail', disabled: !primaryEmail(c), run: () => emailBill(b) },
        { label: 'View matter', icon: 'briefcase', run: () => navigate(`/matters/${b.matterId}`) },
        { separator: true },
        b.status !== 'void' ? { label: 'Void bill', icon: 'x', danger: true, run: () => voidBills([b]) } : null,
        b.status === 'draft' || b.status === 'pending' ? { label: 'Delete draft', icon: 'trash', danger: true, run: async () => (await deleteDrafts([b])) && navigate('/billing?status=draft') } : null,
      ].filter(Boolean),
      { align: 'end', label: 'Bill actions' },
    );
  }

  function exportLines(b) {
    downloadCsv(`bill-${b.number}.csv`, [
      ['Date', 'Type', 'Timekeeper', 'Description', 'Hours', 'Rate', 'Quantity', 'Price', 'Amount'],
      ...b.lines.map((l) => [
        l.date,
        l.kind,
        lookup.userName(l.userId),
        l.description,
        l.kind === 'time' ? formatHoursDecimal(l.minutes) : '',
        l.kind === 'time' ? centsToInput(l.rateCents) : '',
        l.kind === 'expense' ? (l.qty ?? 1) : '',
        l.kind === 'expense' ? centsToInput(l.priceCents) : '',
        centsToInput(lineAmount(l)),
      ]),
    ]);
  }

  function emailBill(b) {
    const c = lookup.contact(b.clientId);
    const firm = app.settings().firm.name || 'our firm';
    const t = billTotals(b);
    const bal = billBalance(b, store.all('payments'));
    const m = lookup.matter(b.matterId);
    const body = [
      `Dear ${c?.type === 'company' ? c.companyName : c?.firstName || contactName(c)},`,
      '',
      `Please find bill #${b.number} for ${m?.description || 'your matter'} (${m?.displayNumber || ''}).`,
      '',
      `Total: ${formatMoney(t.total)}`,
      `Balance due: ${formatMoney(bal)}`,
      `Due date: ${formatDate(b.dueDate)}`,
      '',
      b.message || '',
      '',
      firm,
    ].join('\n');
    location.href = `mailto:${encodeURIComponent(primaryEmail(c))}?subject=${encodeURIComponent(`Bill #${b.number} from ${firm}`)}&body=${encodeURIComponent(body)}`;
    if (!b.sentAt) store.patch('bills', b.id, { sentAt: new Date().toISOString() });
  }

  // ---- Read-only document ---------------------------------------------------------------

  function docHead(b) {
    const s = app.settings();
    const f = s.firm;
    const c = lookup.contact(b.clientId);
    const addr = c?.addresses?.find((a) => a.primary) || c?.addresses?.[0];
    const m = lookup.matter(b.matterId);
    return [
      h(
        'div.doc-head',
        h(
          'div',
          h('div.doc-firm', f.name || 'Your firm'),
          h('div.doc-muted.pre', formatAddress({ street: f.street, city: f.city, region: f.region, postal: f.postal, country: f.country }, { multiline: true })),
          h('div.doc-muted', [f.phone, f.email].filter(Boolean).join(' · ')),
        ),
        h(
          'div.doc-title-block',
          h('h2.doc-title', 'Bill'),
          h('dl.doc-meta', h('dt', 'Bill number'), h('dd', `#${b.number}`), h('dt', 'Issue date'), h('dd', formatDate(b.issueDate)), h('dt', 'Due date'), h('dd', formatDate(b.dueDate))),
        ),
      ),
      h(
        'div.doc-parties',
        h('div', h('div.doc-label', 'Bill to'), h('div.strong', contactName(c)), addr ? h('div.doc-muted.pre', formatAddress(addr, { multiline: true })) : null),
        h(
          'div',
          h('div.doc-label', 'Matter'),
          h('div.strong', m?.displayNumber || ''),
          h('div', m?.description || ''),
          b.periodFrom ? h('div.doc-muted', `Services from ${formatDate(b.periodFrom)} to ${formatDate(b.periodTo)}`) : null,
        ),
      ),
    ];
  }

  function readDoc(b) {
    const s = app.settings();
    const showTk = s.billing.showTimekeeper !== false;
    const fees = b.lines.filter((l) => l.kind !== 'expense');
    const expenses = b.lines.filter((l) => l.kind === 'expense');
    const t = billTotals(b);
    const pays = store
      .all('payments')
      .filter((p) => p.billId === b.id)
      .sort((a, c) => (a.date < c.date ? -1 : 1));
    const paid = billPaid(b, store.all('payments'));
    const tk = (l) => {
      const u = lookup.user(l.userId);
      return u ? h('abbr', { title: u.name }, initials(u.name)) : '';
    };
    return h(
      'article.card.print-doc.bill-doc',
      { 'aria-label': `Bill ${b.number}` },
      b.status === 'void' ? h('div.doc-void', { role: 'note' }, 'Void') : null,
      docHead(b),
      // Each table scrolls on its own on narrow screens; the card clips overflow (for the void band).
      fees.length
        ? wrapX(
            'table.table-plain.doc-table',
            h('caption', 'Professional services'),
            h('thead', h('tr', h('th', 'Date'), showTk ? h('th', 'By') : null, h('th', 'Description'), h('th.r', 'Hours'), h('th.r', 'Rate'), h('th.r', 'Amount'))),
            h(
              'tbody',
              fees.map((l) =>
                h(
                  'tr',
                  h('td.nowrap', formatDate(l.date)),
                  showTk ? h('td', tk(l)) : null,
                  h('td', l.description || (l.kind === 'flat' ? 'Flat fee' : '')),
                  h('td.r.num', l.kind === 'time' ? formatHoursDecimal(l.minutes) : ''),
                  h('td.r.num', l.kind === 'time' ? formatMoney(l.rateCents) : ''),
                  h('td.r.num', formatMoney(lineAmount(l))),
                ),
              ),
            ),
            h(
              'tfoot',
              h(
                'tr',
                h('td', { colspan: showTk ? '3' : '2' }, 'Total professional services'),
                h('td.r.num', formatHoursDecimal(fees.reduce((n, l) => n + (l.kind === 'time' ? Number(l.minutes) || 0 : 0), 0))),
                h('td'),
                h('td.r.num', formatMoney(t.fees)),
              ),
            ),
          )
        : null,
      expenses.length
        ? wrapX(
            'table.table-plain.doc-table',
            h('caption', 'Expenses'),
            h('thead', h('tr', h('th', 'Date'), h('th', 'Description'), h('th.r', 'Quantity'), h('th.r', 'Price'), h('th.r', 'Amount'))),
            h(
              'tbody',
              expenses.map((l) =>
                h(
                  'tr',
                  h('td.nowrap', formatDate(l.date)),
                  h('td', l.description),
                  h('td.r.num', String(l.qty ?? 1)),
                  h('td.r.num', formatMoney(l.priceCents)),
                  h('td.r.num', formatMoney(lineAmount(l))),
                ),
              ),
            ),
            h('tfoot', h('tr', h('td', { colspan: '4' }, 'Total expenses'), h('td.r.num', formatMoney(t.expenses)))),
          )
        : null,
      totalsBlock(b, t, paid),
      pays.length
        ? wrapX(
            'table.table-plain.doc-table.doc-pays',
            h('caption', 'Payments received'),
            h(
              'tbody',
              pays.map((p) => h('tr', h('td.nowrap', formatDate(p.date)), h('td', methodLabel(p.method), p.reference ? ` ${p.reference}` : ''), h('td.r.num', formatMoney(-p.amountCents)))),
            ),
          )
        : null,
      b.message ? h('p.doc-message.pre', b.message) : null,
    );
  }

  function totalsBlock(b, t, paid) {
    const balance = b.status === 'void' ? 0 : Math.max(0, t.total - paid);
    const row = (label, value, cls = '') => h(`div.tot-row${cls ? '.' + cls : ''}`, h('span', label), h('span.num', value));
    return h(
      'div.doc-totals',
      row('Professional services', formatMoney(t.fees)),
      t.expenses ? row('Expenses', formatMoney(t.expenses)) : null,
      t.discount ? row(b.discount?.type === 'amount' ? 'Discount' : `Discount (${b.discount.value}%)`, formatMoney(-t.discount)) : null,
      t.tax ? row(`${b.taxName || 'Tax'} (${b.taxRate}%)`, formatMoney(t.tax)) : null,
      row('Total', formatMoney(t.total), 'grand'),
      paid ? row('Payments', formatMoney(-paid)) : null,
      b.status === 'draft' || b.status === 'pending' ? null : row('Balance due', formatMoney(balance), 'due'),
    );
  }

  const wrapX = (...args) => h('div.table-wrap-x', h(...args));

  const methodLabel = (id) => PAYMENT_METHODS.find((m) => m.id === id)?.label || 'Payment';

  // ---- Side panels -----------------------------------------------------------------------

  function sidePanels(b) {
    const allPays = store.all('payments');
    const pays = allPays.filter((p) => p.billId === b.id).sort((a, c) => (a.date < c.date ? 1 : -1));
    const t = billTotals(b);
    const paid = billPaid(b, allPays);
    const bal = billBalance(b, allPays);
    const m = lookup.matter(b.matterId);
    const trust = m ? financialsFor(m).trust : 0;
    const issued = !['draft', 'pending', 'void'].includes(b.status);
    return [
      card({
        title: 'Summary',
        body: kvList([
          ['Total', h('span.num.strong', formatMoney(t.total))],
          ['Paid', h('span.num', formatMoney(paid))],
          ['Balance due', h(`span.num.strong${bal && billStatus(b, allPays, app.today()) === 'overdue' ? '.text-danger' : ''}`, issued ? formatMoney(bal) : 'Not issued')],
          ['Due date', formatDate(b.dueDate)],
          ['Lines', String(b.lines.length)],
        ]),
      }),
      issued && trust > 0 && bal > 0
        ? h(
            'div.notice.info',
            icon('vault', 16),
            h(
              'div.grow',
              h('div', 'This matter has ', h('strong', formatMoney(trust)), ' in trust.'),
              h('button.link-btn', { type: 'button', onClick: () => openPaymentDialog({ billId: b.id, method: 'trust' }) }, 'Pay from trust'),
            ),
          )
        : null,
      card({
        title: 'Payments',
        count: pays.length,
        actions: issued && bal > 0 ? h('button.btn.sm', { type: 'button', onClick: () => openPaymentDialog({ billId: b.id }) }, icon('plus', 14), 'Record') : null,
        flush: true,
        body: pays.length
          ? h(
              'ul.list.pay-list',
              pays.map((p) =>
                h(
                  'li.pay-item',
                  h('span.grow', h('span.strong.num', formatMoney(p.amountCents)), h('span.sub', [formatDate(p.date), methodLabel(p.method), p.reference].filter(Boolean).join(' · '))),
                  h(
                    'button.icon-btn.sm',
                    { type: 'button', 'aria-label': `Delete payment of ${formatMoney(p.amountCents)} on ${formatDate(p.date)}`, title: 'Delete payment', onClick: () => deletePayment(p) },
                    icon('trash', 15),
                  ),
                ),
              ),
            )
          : h('p.subtle.pad', issued ? 'No payments yet.' : 'Payments can be recorded once the bill is issued.'),
      }),
    ];
  }

  // ---- Editing (drafts) ------------------------------------------------------------------

  function startEdit() {
    draft = structuredClone(bill());
    editing = true;
    draw();
  }

  function cancelEdit() {
    editing = false;
    draft = null;
    draw();
  }

  function saveEdit() {
    const cur = bill();
    if (!cur || !draft) return;
    if (cur.status !== 'draft') {
      // Someone approved, issued, or voided it while it was being edited.
      toast('This bill is no longer a draft, so the changes were not saved.', { type: 'error', duration: 7000 });
      cancelEdit();
      return;
    }
    const dateError = !isISODate(draft.issueDate)
      ? ['issue', 'Enter an issue date.']
      : !isISODate(draft.dueDate)
        ? ['due', 'Enter a due date.']
        : draft.dueDate < draft.issueDate
          ? ['due', 'The due date cannot be before the issue date.']
          : null;
    if (dateError) {
      const el = dateInputs[dateError[0]];
      el?.setAttribute('aria-invalid', 'true');
      el?.focus();
      toast(dateError[1], { type: 'error' });
      return;
    }
    const kept = new Set(draft.lines.map((l) => l.id));
    releaseActivities(cur, (l) => !kept.has(l.id));
    for (const l of draft.lines) l.amountCents = lineAmount(l);
    // Only the fields this editor changes; everything else stays as stored now.
    const { lines, discount, taxRate, issueDate, dueDate, message } = draft;
    // Dates set by hand are kept when the bill is issued.
    const autoDates = !!cur.autoDates && issueDate === cur.issueDate && dueDate === cur.dueDate;
    store.put('bills', { ...cur, lines, discount, taxRate, issueDate, dueDate, message, autoDates });
    editing = false;
    draft = null;
    toast('Bill saved');
    draw();
  }

  function editDoc() {
    const totals = h('div');
    const redrawTotals = () => totals.replaceChildren(totalsBlock(draft, billTotals(draft), 0));
    const linesBody = h('tbody');

    function lineRow(l) {
      const amount = h('output.num');
      const upd = () => (amount.textContent = formatMoney(lineAmount(l)));
      const date = textInput({ type: 'date', value: l.date, 'aria-label': 'Date' });
      date.addEventListener('change', () => (l.date = date.value));
      const desc = textInput({ value: l.description || '', 'aria-label': 'Description' });
      desc.addEventListener('input', () => (l.description = desc.value));
      let qtyCell = h('td');
      let rateCell = h('td');
      if (l.kind === 'time') {
        const hrs = durationInput({ minutes: l.minutes, 'aria-label': 'Hours' });
        hrs.addEventListener('input', () => ((l.minutes = hrs.minutes), upd(), redrawTotals()));
        const rate = moneyInput({ cents: l.rateCents, 'aria-label': 'Rate per hour' });
        rate.addEventListener('input', () => ((l.rateCents = rate.cents), upd(), redrawTotals()));
        qtyCell = h('td', hrs);
        rateCell = h('td', rate);
      } else if (l.kind === 'expense') {
        const qty = textInput({ type: 'number', value: String(l.qty ?? 1), min: '0', step: 'any', cls: 'num', 'aria-label': 'Quantity' });
        qty.addEventListener('input', () => ((l.qty = Number(qty.value) || 0), upd(), redrawTotals()));
        const price = moneyInput({ cents: l.priceCents, 'aria-label': 'Price' });
        price.addEventListener('input', () => ((l.priceCents = price.cents), upd(), redrawTotals()));
        qtyCell = h('td', qty);
        rateCell = h('td', price);
      } else {
        const amt = h('input.input.num', { inputmode: 'decimal', value: centsToInput(l.amountCents || 0), 'aria-label': 'Amount' });
        amt.addEventListener('input', () => ((l.amountCents = parseMoney(amt.value) ?? 0), upd(), redrawTotals()));
        rateCell = h('td', amt);
      }
      upd();
      const tr = h(
        'tr',
        h('td', h('span.line-kind', l.kind === 'time' ? 'Time' : l.kind === 'expense' ? 'Expense' : l.kind === 'flat' ? 'Flat fee' : l.kind === 'fee' ? 'Fee' : 'Adjustment')),
        h('td', date),
        h('td.wide', desc),
        qtyCell,
        rateCell,
        h('td.r', amount),
        h(
          'td',
          h(
            'button.icon-btn.sm',
            {
              type: 'button',
              'aria-label': `Remove line ${l.description || ''}`.trim(),
              title: l.activityId ? 'Remove line (the entry becomes unbilled)' : 'Remove line',
              onClick: (e) => {
                draft.lines = draft.lines.filter((x) => x !== l);
                // Keep keyboard focus on a neighbouring line (or the add buttons).
                const near = tr.nextElementSibling || tr.previousElementSibling;
                const hadFocus = e.currentTarget === document.activeElement;
                tr.remove();
                redrawTotals();
                if (hadFocus) (near?.querySelector('button[aria-label^="Remove line"]') || addFeeBtn).focus();
              },
            },
            icon('trash', 15),
          ),
        ),
      );
      return tr;
    }
    linesBody.replaceChildren(...draft.lines.map(lineRow));

    const addFeeBtn = h('button.btn.sm', { type: 'button', onClick: () => addLine('fee') }, icon('plus', 14), 'Add fee line');
    const addLine = (kind) => {
      const l = { id: newId(), activityId: null, kind, date: app.today(), description: kind === 'adjustment' ? 'Adjustment' : 'Additional fee', userId: null, amountCents: 0 };
      draft.lines.push(l);
      const row = lineRow(l);
      linesBody.append(row);
      row.querySelector('input:not([type=date])')?.focus();
    };

    const discType = select({
      value: draft.discount?.type || 'percent',
      'aria-label': 'Discount type',
      options: [
        { value: 'percent', label: 'Percent' },
        { value: 'amount', label: 'Amount' },
      ],
    });
    const discVal = h('input.input.num', {
      inputmode: 'decimal',
      'aria-label': 'Discount',
      value: draft.discount?.type === 'amount' ? centsToInput(draft.discount.value || 0) : String(draft.discount?.value || 0),
    });
    const syncDisc = () => {
      const type = discType.value;
      // parseFloat so "10%" or "10 %" reads as 10.
    const v = type === 'amount' ? (parseMoney(discVal.value) ?? 0) : Math.max(0, Math.min(100, Number.parseFloat(discVal.value.replace(',', '.')) || 0));
      draft.discount = { type, value: v };
      redrawTotals();
    };
    discType.addEventListener('change', syncDisc);
    discVal.addEventListener('input', syncDisc);
    const tax = h('input.input.num', { type: 'number', min: '0', max: '100', step: 'any', value: String(draft.taxRate || 0), 'aria-label': 'Tax rate percent' });
    tax.addEventListener('input', () => ((draft.taxRate = Math.max(0, Number(tax.value) || 0)), redrawTotals()));
    const issue = textInput({ type: 'date', value: draft.issueDate, required: true });
    const due = textInput({ type: 'date', value: draft.dueDate, required: true });
    issue.addEventListener('change', () => ((draft.issueDate = issue.value), issue.removeAttribute('aria-invalid')));
    due.addEventListener('change', () => ((draft.dueDate = due.value), due.removeAttribute('aria-invalid')));
    dateInputs = { issue, due };
    const msg = textarea({ value: draft.message || '', rows: 3 });
    msg.addEventListener('input', () => (draft.message = msg.value));
    redrawTotals();

    const lab = (text, control) => h('label.edit-field', h('span', text), control);
    return h(
      'article.card.bill-doc.bill-edit',
      { 'aria-label': `Editing bill ${draft.number}` },
      h('div.notice.info', icon('pencil', 16), h('span', 'Editing a draft. Removed lines release their entries so they can be billed again.')),
      h('div.edit-grid', lab('Issue date', issue), lab('Due date', due), lab('Discount', h('div.row.nowrap', discType, discVal)), lab(`${draft.taxName || 'Tax'} rate (%)`, tax)),
      h(
        'div.table-wrap-x',
        h(
          'table.table-plain.edit-lines',
          h('caption.sr-only', 'Bill lines'),
          h(
            'thead',
            h('tr', h('th', 'Type'), h('th', 'Date'), h('th', 'Description'), h('th', 'Hours or qty'), h('th', 'Rate or amount'), h('th.r', 'Line total'), h('th', h('span.sr-only', 'Remove'))),
          ),
          linesBody,
        ),
      ),
      h(
        'div.row',
        addFeeBtn,
        h('button.btn.sm', { type: 'button', onClick: () => addLine('adjustment') }, icon('plus', 14), 'Add adjustment'),
      ),
      totals,
      lab('Message to client', msg),
    );
  }

  draw();
  ctx.watch(['bills', 'payments', 'contacts', 'matters', 'users', 'settings', 'transactions'], () => {
    if (!editing) draw();
  });

  return { node: root, title: bill() ? `Bill #${bill().number}` : 'Bill', dirty: () => editing };
}
