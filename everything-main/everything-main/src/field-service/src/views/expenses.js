/** Expenses: track costs, attach receipts, link them to jobs for costing. */
import { h, keepFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { pageHeader, stat, searchBox, chips, dataTable, emptyState, field, textInput, select, moneyInput, textarea, moreButton } from '../ui/components.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { openMenu } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { clientName, matches, pluralize } from '../core/format.js';
import { formatDate, startOfMonth, addMonths, endOfMonth } from '../core/dates.js';
import { parseMoney } from '../core/money.js';
import { money, rememberSort, saveSort } from './common.js';
import { saveFile, deleteFile } from '../files.js';
import { preview } from './attachments.js';
import { downloadText, toCSV } from '../core/csv.js';

export function render(ctx) {
  const store = app.store;
  const paging = {};
  const state = { q: '', cat: 'all', sort: rememberSort('expenses', { id: 'date', dir: 'desc' }) };
  const statsNode = h('div');
  const chipsNode = h('div');
  const tableNode = h('div');
  // Built once: redrawing it while someone types would drop focus.
  const search = searchBox({ value: state.q, placeholder: 'Search expenses', label: 'Search expenses', onInput: (v) => ((state.q = v), draw()) });
  const body = h('div', statsNode, h('section.card.list-card', { 'aria-label': 'Expense list' }, h('div.toolbar', search, h('div.grow'), chipsNode), tableNode));

  const draw = () => {
    const today = app.today();
    const all = store.all('expenses');
    const ms = startOfMonth(today);
    const ls = startOfMonth(addMonths(today, -1));
    const sum = (l) => l.reduce((s, x) => s + (x.amount || 0), 0);
    const thisMonth = all.filter((x) => x.date >= ms);
    const lastMonth = all.filter((x) => x.date >= ls && x.date <= endOfMonth(ls));
    const onJobs = all.filter((x) => x.jobId);
    const reimb = all.filter((x) => x.reimbursable && !x.reimbursedAt);
    const cats = [...new Set(all.map((x) => x.category || 'Other'))].sort();
    const rows = all.filter((x) => (state.cat === 'all' || (x.category || 'Other') === state.cat) && (!state.q || matches(`${x.title} ${x.category} ${x.notes || ''} ${jobLabel(x)}`, state.q)));

    keepFocus(statsNode, () =>
      statsNode.replaceChildren(
        h(
          'div.stats.list-stats',
          stat({ label: 'This month', value: money(sum(thisMonth)), sub: pluralize(thisMonth.length, 'expense') }),
          stat({ label: 'Last month', value: money(sum(lastMonth)), sub: pluralize(lastMonth.length, 'expense') }),
          stat({ label: 'Charged to jobs', value: money(sum(onJobs)), sub: 'Counted in job costing' }),
          stat({ label: 'To reimburse', value: money(sum(reimb)), sub: `${reimb.length} owed to team`, tone: reimb.length ? 'warning' : null }),
        ),
      ),
    );
    keepFocus(chipsNode, () =>
      chipsNode.replaceChildren(
        ...(cats.length > 1 ? [chips({ label: 'Category', selected: state.cat, onSelect: (c) => ((state.cat = c), draw()), items: [{ id: 'all', label: 'All', count: all.length }, ...cats.map((c) => ({ id: c, label: c, count: all.filter((x) => (x.category || 'Other') === c).length }))] })] : []),
      ),
    );
    keepFocus(tableNode, () =>
      tableNode.replaceChildren(
        dataTable({
          caption: 'Expenses',
          rows,
          paging,
          pagingKey: JSON.stringify([state.q, state.cat, state.sort]),
          sort: state.sort,
          onSort: (s) => ((state.sort = s), saveSort('expenses', s), draw()),
          columns: [
            { id: 'date', label: 'Date', sort: (x) => x.date, render: (x) => h('span.nowrap', formatDate(x.date)) },
            { id: 'title', label: 'Item', sort: (x) => x.title, cls: 'primary-cell', render: (x) => h('button.link-btn', { type: 'button', style: { color: 'var(--text)', textAlign: 'left' }, onClick: () => expenseDialog({ expense: x }) }, x.title, h('span.sub', { style: { display: 'block', fontWeight: '400' } }, x.category || 'Other')) },
            { id: 'job', label: 'Job', sort: (x) => jobLabel(x), render: (x) => (x.jobId && store.get('jobs', x.jobId) ? h('a', { href: `#/jobs/${x.jobId}` }, jobLabel(x)) : h('span.subtle', 'None')) },
            { id: 'paid', label: 'Paid by', render: (x) => h('span', lookup.member(x.paidBy)?.name || 'Business', x.reimbursable ? h('span.sub', { style: { display: 'block' } }, x.reimbursedAt ? 'Reimbursed' : 'To reimburse') : null) },
            { id: 'receipt', label: 'Receipt', render: (x) => (x.receipt ? h('button.icon-btn.sm', { type: 'button', 'aria-label': `View receipt for ${x.title}`, title: 'View receipt', onClick: () => preview(x.receipt) }, icon('paperclip', 15)) : h('span.subtle', '-')) },
            { id: 'amount', label: 'Amount', align: 'r', sort: (x) => x.amount, render: (x) => h('span.money', { style: { fontWeight: '600' } }, money(x.amount)) },
          ],
          mobile: (x) =>
            h(
              'button.mobile-row',
              { type: 'button', style: { width: '100%', border: '0', background: 'none', textAlign: 'left', borderBottom: '1px solid var(--border)' }, onClick: () => expenseDialog({ expense: x }) },
              h('div.grow', { style: { minWidth: '0' } }, h('div.m-title', x.title), h('div.m-sub', `${formatDate(x.date)} · ${x.category || 'Other'}${x.jobId ? ' · ' + jobLabel(x) : ''}`)),
              h('div.m-end', h('span.money', { style: { fontWeight: '700' } }, money(x.amount)), x.receipt ? icon('paperclip', 14, 'subtle') : null),
            ),
          empty: all.length
            ? emptyState({ compact: true, icon: 'search', title: 'No matching expenses', headingLevel: 3 })
            : emptyState({ icon: 'receipt', title: 'No expenses yet', text: 'Track materials, fuel and other costs. Link them to a job to see its real profit.', actions: [h('button.btn.primary', { type: 'button', onClick: () => expenseDialog() }, icon('plus', 16), 'New expense')], headingLevel: 3 }),
        }),
      ),
    );
  };

  function jobLabel(x) {
    const j = x.jobId ? store.get('jobs', x.jobId) : null;
    return j ? `#${j.number} ${j.title || ''}`.trim() : '';
  }

  draw();
  ctx.onDispose(store.subscribe((c) => (c.has('expenses') || c.has('jobs') || c.has('team')) && draw()));

  const exportCSV = () => {
    const rows = [['Date', 'Item', 'Category', 'Job', 'Paid by', 'Reimbursable', 'Amount', 'Notes']];
    for (const x of store.all('expenses')) rows.push([x.date, x.title, x.category || '', jobLabel(x), lookup.member(x.paidBy)?.name || 'Business', x.reimbursable ? 'yes' : '', (x.amount / 100).toFixed(2), x.notes || '']);
    downloadText(`expenses-${app.today()}.csv`, toCSV(rows));
  };

  return {
    node: h(
      'div.page',
      pageHeader({
        title: 'Expenses',
        actions: [moreButton((btn) => openMenu(btn, [{ label: 'Export expenses to CSV', icon: 'file-down', run: exportCSV }])), h('button.btn.primary', { type: 'button', onClick: () => expenseDialog() }, icon('plus', 16), 'New expense')],
      }),
      body,
    ),
    title: 'Expenses',
  };
}

/** Create or edit an expense, with an optional receipt photo. */
export function expenseDialog({ expense = null, jobId = null } = {}) {
  const store = app.store;
  const s = app.settings();
  const x = expense ? structuredClone(expense) : { date: app.today(), title: '', category: s.expenseCategories?.[0] || 'Materials', amount: 0, jobId, paidBy: '', reimbursable: false, notes: '', receipt: null };
  let receipt = x.receipt;
  // Files uploaded in this dialog; any not kept on a saved expense are deleted.
  const uploads = [];
  let saved = false;
  let closed = false;
  let saveBtn = null;
  const discardUpload = (att) => {
    if (att && uploads.includes(att)) deleteFile(att).catch(() => {});
  };
  const title = textInput({ value: x.title, placeholder: 'e.g. Mulch, 6 yards', required: true });
  const amount = moneyInput({ cents: x.amount });
  const date = textInput({ type: 'date', value: x.date });
  const cat = select({ value: x.category, options: [...new Set([...(s.expenseCategories || []), x.category].filter(Boolean))] });
  const jobs = store.all('jobs').filter((j) => !j.archived || j.id === x.jobId);
  const job = select({ value: x.jobId || '', options: [{ value: '', label: 'Not linked to a job' }, ...jobs.map((j) => ({ value: j.id, label: `#${j.number} ${j.title || ''} (${clientName(lookup.client(j.clientId))})` }))] });
  const team = store.all('team');
  const paidBy = select({ value: x.paidBy || '', options: [{ value: '', label: 'The business' }, ...team.map((m) => ({ value: m.id, label: m.name }))] });
  const reimb = h('input', { type: 'checkbox', checked: !!x.reimbursable });
  const reimbursed = h('input', { type: 'checkbox', checked: !!x.reimbursedAt });
  const notes = textarea({ value: x.notes || '', rows: 2 });

  const fileInput = h('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true });
  const receiptRow = h('div');
  const drawReceipt = () =>
    receiptRow.replaceChildren(
      receipt
        ? h('div.picked-client', icon('paperclip', 16), h('span.grow.truncate', receipt.name), h('button.btn.sm', { type: 'button', onClick: () => preview(receipt) }, 'View'), h('button.btn.sm.ghost', { type: 'button', onClick: () => (discardUpload(receipt), (receipt = null), drawReceipt()) }, 'Remove'))
        : h('button.btn', { type: 'button', onClick: () => fileInput.click() }, icon('upload', 16), 'Attach receipt'),
    );
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    receiptRow.replaceChildren(h('span.subtle', 'Uploading...'));
    // Saving now would leave the receipt off the expense.
    saveBtn.disabled = true;
    try {
      const att = await saveFile(f, 'receipts');
      // Closed while uploading: nothing will keep this file.
      if (closed) return void deleteFile(att).catch(() => {});
      uploads.push(att);
      discardUpload(receipt);
      receipt = att;
    } catch (err) {
      if (!closed) toast(err?.message || 'Upload failed', { type: 'error' });
    } finally {
      saveBtn.disabled = false;
    }
    drawReceipt();
  });
  drawReceipt();

  openDialog({
    title: expense ? 'Edit expense' : 'New expense',
    onClose: () => {
      closed = true;
      if (!saved) for (const att of uploads) deleteFile(att).catch(() => {});
    },
    body: h(
      'div.stack',
      h(
        'div.form-grid',
        field('Item', title, { span2: true }),
        field('Amount', amount),
        field('Date', date),
        field('Category', cat),
        field('Job', job),
        field('Paid by', paidBy),
        h('div.field', h('span.field-label', 'Reimbursement'), h('label.check', reimb, 'Reimburse this person'), expense?.reimbursable ? h('label.check', reimbursed, 'Already reimbursed') : null),
        field('Notes', notes, { span2: true }),
      ),
      h('div.field', h('span.field-label', 'Receipt'), receiptRow, fileInput),
    ),
    footer: ({ close }) => [
      expense
        ? h(
            'button.btn.ghost.subtle-danger',
            {
              type: 'button',
              onClick: async () => {
                close();
                if (!(await confirmDialog({ title: 'Delete this expense?', message: `${expense.title}, ${money(expense.amount)}`, confirmLabel: 'Delete', danger: true }))) return;
                const removed = store.remove('expenses', expense.id);
                toast('Expense deleted', {
                  action: { label: 'Undo', run: () => store.restore('expenses', removed) },
                  // Keep the receipt for as long as Undo is on offer.
                  onDismiss: () => expense.receipt && !store.get('expenses', expense.id) && deleteFile(expense.receipt).catch(() => {}),
                });
              },
            },
            'Delete',
          )
        : null,
      h('div.spacer'),
      h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
      (saveBtn = h(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            const cents = parseMoney(amount.value);
            if (!title.value.trim()) {
              title.setAttribute('aria-invalid', 'true');
              title.focus();
              toast('Enter what the expense was for', { type: 'error' });
              return;
            }
            if (!cents || cents <= 0) {
              amount.setAttribute('aria-invalid', 'true');
              amount.focus();
              toast('Enter an amount greater than zero', { type: 'error' });
              return;
            }
            if (expense?.receipt && expense.receipt.path !== receipt?.path) deleteFile(expense.receipt).catch(() => {});
            saved = true;
            store.put('expenses', {
              ...x,
              title: title.value.trim(),
              amount: cents,
              date: date.value || app.today(),
              category: cat.value,
              jobId: job.value || null,
              paidBy: paidBy.value || null,
              reimbursable: reimb.checked,
              reimbursedAt: reimb.checked && reimbursed.checked ? x.reimbursedAt || new Date().toISOString() : null,
              notes: notes.value,
              receipt,
            });
            toast(expense ? 'Expense updated' : 'Expense added');
            close();
          },
        },
        expense ? 'Save' : 'Add expense',
      )),
    ],
  });
}
