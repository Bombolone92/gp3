/** A single job: visits, line items, invoicing and job costing. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { pageHeader, statusPill, emptyState, moreButton } from '../ui/components.js';
import { openMenu } from '../ui/menu.js';
import { confirmDialog } from '../ui/dialog.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { clientName, formatHours } from '../core/format.js';
import { jobStatus, invoiceStatus } from '../core/status.js';
import { computeTotals } from '../core/totals.js';
import { describeSchedule } from '../core/recurrence.js';
import { formatDate, formatDayShort, formatTimeRange, relativeDay } from '../core/dates.js';
import { jobToInvoice, setVisitComplete, closeJob, reopenJob, duplicateDoc, removeDoc } from '../core/workflow.js';
import { clientCard, notesCard, money, lineItemsTable, totalsBlock, teamAvatars, teamNames, checklistCard } from './common.js';
import { timeline } from './docview.js';
import { visitDialog } from './visit-dialog.js';
import { entryMinutes } from './timesheets-core.js';
import { attachmentsCard } from './attachments.js';
import { deleteAttachments } from '../files.js';

function visitLabel(date, today) {
  const rel = relativeDay(date, today);
  const day = formatDayShort(date);
  return rel === formatDate(date) ? day : `${rel}, ${formatDate(date, { month: 'short', day: 'numeric' })}`;
}

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  let showAllDone = false;
  let showAllOpen = false;
  let refocus = null;

  const body = ctx.live(() => {
    // A redraw replaces the visit rows: keep keyboard focus on the same one
    // (data-focus names it), or on the row Show all brought into view.
    const keep = refocus || document.activeElement?.dataset?.focus;
    refocus = null;
    if (keep) queueMicrotask(() => document.querySelector(`[data-focus="${keep}"]`)?.focus());
    const job = store.get('jobs', id);
    if (!job) return emptyState({ icon: 'hammer', title: 'Job not found', headingLevel: 1, text: 'It may have been deleted.', actions: [h('a.btn.primary', { href: '#/jobs' }, 'Back to jobs')] });
    const today = app.today();
    const invoices = store.all('invoices');
    const status = jobStatus(job, today, invoices);
    const client = lookup.client(job.clientId);
    const linkedInvoices = invoices.filter((i) => (i.jobIds || []).includes(job.id));
    const quote = job.quoteId ? store.get('quotes', job.quoteId) : null;
    const visits = job.visits || [];
    const done = visits.filter((v) => v.completedAt);
    const uninvoicedDone = done.filter((v) => !v.invoiceId);

    const createInvoice = async (visitIds = null) => {
      if (!visitIds && linkedInvoices.length) {
        const ok = await confirmDialog({
          title: 'Invoice this job again?',
          message: `This job already has ${linkedInvoices.length === 1 ? `invoice #${linkedInvoices[0].number}` : `${linkedInvoices.length} invoices`}. A new invoice bills the whole job again.`,
          confirmLabel: 'Create another invoice',
        });
        if (!ok) return;
      }
      const inv = await jobToInvoice(store, job.id, { visitIds, today });
      if (!inv) {
        toast('Those visits are already invoiced.', { type: 'info' });
        return;
      }
      toast(`Invoice #${inv.number} drafted`);
      navigate(`/invoices/${inv.id}/edit`);
    };
    // Per-visit jobs bill the completed visits not billed yet.
    const invoiceJob = () => (job.billing === 'per_visit' && uninvoicedDone.length ? createInvoice(uninvoicedDone.map((v) => v.id)) : createInvoice());

    let primary = null;
    if (job.billing === 'per_visit' && uninvoicedDone.length) {
      primary = h('button.btn.primary', { type: 'button', onClick: () => createInvoice(uninvoicedDone.map((v) => v.id)) }, icon('receipt-text', 16), `Invoice ${uninvoicedDone.length} visit${uninvoicedDone.length === 1 ? '' : 's'}`);
    } else if (status === 'requires_invoicing') {
      primary = h('button.btn.primary', { type: 'button', onClick: () => createInvoice() }, icon('receipt-text', 16), 'Create invoice');
    } else if (status === 'completed' && linkedInvoices.length) {
      primary = h('a.btn.primary', { href: `#/invoices/${linkedInvoices[0].id}` }, icon('receipt-text', 16), `View invoice #${linkedInvoices[0].number}`);
    } else if (status === 'unscheduled') {
      primary = h('a.btn.primary', { href: `#/jobs/${job.id}/edit?schedule=1` }, icon('calendar-plus', 16), 'Schedule job');
    } else if (status !== 'archived') {
      primary = h('button.btn.primary', { type: 'button', onClick: () => visitDialog(job.id) }, icon('calendar-plus', 16), 'Add visit');
    }

    const more = moreButton((btn) =>
      openMenu(
        btn,
        [
          { label: 'Add visit', icon: 'calendar-plus', run: () => visitDialog(job.id) },
          { label: 'Create invoice', icon: 'receipt-text', run: invoiceJob },
          { separator: true },
          job.closedAt
            ? { label: 'Reopen job', icon: 'undo', run: () => (reopenJob(store, job.id), toast('Job reopened')) }
            : {
                label: 'Close job',
                icon: 'circle-check',
                description: 'Remove remaining visits and mark complete',
                run: async () => {
                  const open = visits.filter((v) => !v.completedAt && !v.invoiceId).length;
                  if (open && !(await confirmDialog({ title: 'Close this job?', message: `${open} unfinished visit${open === 1 ? ' is' : 's are'} removed from the schedule.`, confirmLabel: 'Close job' }))) return;
                  closeJob(store, job.id);
                  toast('Job closed');
                },
              },
          {
            label: 'Duplicate',
            icon: 'copy',
            run: async () => {
              const c = await duplicateDoc(store, 'jobs', job.id, app.today());
              toast(`Job #${c.number} created`);
              navigate(`/jobs/${c.id}/edit`);
            },
          },
          job.archived
            ? { label: 'Unarchive', icon: 'unarchive', run: () => store.patch('jobs', job.id, { archived: false }) }
            : { label: 'Archive', icon: 'archive', run: () => (store.patch('jobs', job.id, { archived: true }), toast('Job archived', { action: { label: 'Undo', run: () => store.patch('jobs', job.id, { archived: false }) } })) },
          {
            label: 'Delete',
            icon: 'trash',
            danger: true,
            run: async () => {
              if (!(await confirmDialog({ title: `Delete job #${job.number}?`, message: 'This permanently deletes the job and all of its visits. Invoices already created stay.', confirmLabel: 'Delete job', danger: true }))) return;
              const undo = removeDoc(store, 'jobs', job.id);
              navigate('/jobs');
              // Its files go once Undo is no longer on offer.
              toast('Job deleted', { action: { label: 'Undo', run: undo }, onDismiss: () => !store.get('jobs', job.id) && deleteAttachments([job]) });
            },
          },
        ],
        { align: 'end' },
      ),
    );

    const header = pageHeader({
      title: h('span.row', { style: { gap: '12px', flexWrap: 'wrap' } }, `Job #${job.number}`, statusPill(status)),
      crumbs: [{ label: 'Jobs', href: '#/jobs' }],
      subtitle: [job.title || 'Untitled job', ' for ', h('a', { href: `#/clients/${job.clientId}` }, clientName(client))],
      actions: [more, h('a.btn', { href: `#/jobs/${job.id}/edit` }, icon('pencil', 16), 'Edit'), primary],
    });

    // ---- Visits --------------------------------------------------------------
    const sorted = [...visits].sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
    const open = sorted.filter((v) => !v.completedAt);
    const completed = sorted.filter((v) => v.completedAt).reverse();
    const visitRow = (v) => {
      const late = !v.completedAt && v.date && v.date < today;
      const inv = v.invoiceId ? store.get('invoices', v.invoiceId) : null;
      return h(
        `div.visit-row${v.completedAt ? '.done' : ''}`,
        h(
          'label.agenda-check-wrap',
          { title: v.completedAt ? 'Mark not done' : 'Mark done' },
          h('input.agenda-check', {
            type: 'checkbox',
            checked: !!v.completedAt,
            disabled: !v.date || null,
            dataset: { focus: `check-${v.id}` },
            'aria-label': `${v.date ? formatDate(v.date) : 'Unscheduled visit'}: mark ${v.completedAt ? 'not done' : 'done'}`,
            onChange: (e) => setVisitComplete(store, job.id, v.id, e.target.checked),
          }),
        ),
        h(
          'button.link-btn.grow',
          { type: 'button', style: { textAlign: 'left', color: 'inherit', fontWeight: '400', minWidth: '0' }, dataset: { focus: `visit-${v.id}` }, onClick: () => visitDialog(job.id, v.id) },
          h('div.visit-date', v.date ? visitLabel(v.date, today) : 'Not scheduled yet'),
          h('div.subtle', { style: { fontSize: '13px' } }, v.date ? formatTimeRange(v.start, v.end) : 'Pick a date to schedule', late ? h('span.late', ' · Late') : null, v.notes ? ` · ${v.notes}` : ''),
        ),
        inv ? h('a.pill.success.plain', { href: `#/invoices/${inv.id}` }, `Invoice #${inv.number}`) : null,
        teamAvatars(v.assignees || []),
      );
    };
    const visibleDone = showAllDone ? completed : completed.slice(0, 3);
    const visitsCard = h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Visits', h('span.count', ` ${done.length} of ${visits.filter((v) => v.date || v.completedAt).length} done`)), h('button.btn.sm', { type: 'button', onClick: () => visitDialog(job.id) }, icon('plus', 14), 'Add visit')),
      h(
        'div.card-body.flush',
        open.length ? [h('div.menu-label', { style: { padding: '12px 18px 2px' } }, 'Open'), ...(showAllOpen ? open : open.slice(0, 5)).map(visitRow)] : null,
        open.length > 5 && !showAllOpen
          ? h('div.show-more', h('button.btn.sm.ghost', { type: 'button', onClick: () => ((showAllOpen = true), (refocus = `visit-${open[5].id}`), body.redraw()) }, `Show all ${open.length} open visits`))
          : null,
        completed.length ? [h('div.menu-label', { style: { padding: '12px 18px 2px' } }, 'Completed'), ...visibleDone.map(visitRow)] : null,
        completed.length > 3 && !showAllDone
          ? h('div.show-more', h('button.btn.sm.ghost', { type: 'button', onClick: () => ((showAllDone = true), (refocus = `visit-${completed[3].id}`), body.redraw()) }, `Show all ${completed.length} completed`))
          : null,
        !visits.length ? h('div.section-empty', h('span', 'No visits yet.'), h('button.btn.sm', { type: 'button', onClick: () => visitDialog(job.id) }, 'Schedule a visit')) : null,
      ),
    );

    // ---- Costing -------------------------------------------------------------
    const t = computeTotals(job);
    const perVisit = job.billing === 'per_visit';
    const revenue = perVisit ? (t.subtotal - t.discount) * Math.max(1, visits.filter((v) => v.date || v.completedAt).length) : t.subtotal - t.discount;
    const lineCost = perVisit ? t.cost * Math.max(1, done.length) : t.cost;
    const entries = store.all('timeEntries').filter((e) => e.jobId === job.id);
    let labourMin = 0;
    let labourCost = 0;
    for (const e of entries) {
      const m = entryMinutes(e);
      labourMin += m;
      labourCost += Math.round((m / 60) * (lookup.member(e.memberId)?.laborRate || 0));
    }
    const expenses = store.all('expenses').filter((x) => x.jobId === job.id);
    const expenseCost = expenses.reduce((s, x) => s + (x.amount || 0), 0);
    const profit = revenue - lineCost - labourCost - expenseCost;
    const margin = revenue ? Math.round((profit / revenue) * 100) : 0;

    const costingCard = h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Profitability')),
      h(
        'div.card-body.stack',
        h('div.doc-meta', h('div', h('div.meta-label', perVisit ? 'Expected revenue' : 'Job value'), h('div.meta-value', money(revenue))), h('div', h('div.meta-label', 'Profit'), h('div.meta-value', { style: { color: profit >= 0 ? 'var(--success)' : 'var(--danger)' } }, money(profit))), h('div', h('div.meta-label', 'Margin'), h('div.meta-value', `${margin}%`))),
        h(
          'dl.kv',
          h('dt', 'Line item cost'),
          h('dd.money', money(lineCost)),
          h('dt', 'Labour'),
          h('dd', h('span.money', money(labourCost)), h('span.subtle', ` · ${formatHours(labourMin)} logged`)),
          h('dt', 'Expenses'),
          h('dd', h('span.money', money(expenseCost)), h('span.subtle', ` · ${expenses.length} item${expenses.length === 1 ? '' : 's'}`)),
        ),
      ),
    );

    const invoicesCard = h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Invoices', h('span.count', ` ${linkedInvoices.length}`))),
      h(
        'div.card-body.flush',
        linkedInvoices.length
          ? h(
              'ul.list',
              linkedInvoices.map((inv) =>
                h(
                  'li',
                  h(
                    'a.list-item',
                    { href: `#/invoices/${inv.id}` },
                    h('div.grow', h('div.title', `Invoice #${inv.number}`), h('div.meta', formatDate(inv.issueDate))),
                    h('div', { style: { textAlign: 'right' } }, statusPill(invoiceStatus(inv, today, store.all('payments'))), h('div.meta.money', { style: { marginTop: '4px' } }, money(computeTotals(inv).total))),
                  ),
                ),
              ),
            )
          : h('div.section-empty', h('span', 'Not invoiced yet.'), h('button.btn.sm', { type: 'button', onClick: invoiceJob }, 'Create invoice')),
      ),
    );

    const summary = h(
      'section.card',
      h(
        'div.card-body',
        h(
          'div.doc-meta',
          h('div', h('div.meta-label', 'Job type'), h('div.meta-value', job.schedule?.repeat && job.schedule.repeat !== 'none' ? 'Recurring' : 'One-off'), h('div.subtle', { style: { fontSize: '12px' } }, job.schedule?.start ? describeSchedule(job.schedule) : 'Not scheduled')),
          h('div', h('div.meta-label', 'Team'), h('div.meta-value.row', { style: { gap: '6px' } }, teamAvatars(job.assignees || []), h('span.truncate', teamNames(job.assignees || [])))),
          h('div', h('div.meta-label', 'Invoicing'), h('div.meta-value', { on_completion: 'When complete', per_visit: 'After each visit', none: 'No reminder' }[job.billing] || 'When complete')),
          h('div', h('div.meta-label', perVisit ? 'Per visit' : 'Total'), h('div.meta-value', money(t.total))),
        ),
        job.instructions ? h('div.notice', { style: { marginTop: '14px' } }, icon('clipboard'), h('span', { style: { whiteSpace: 'pre-line' } }, job.instructions)) : null,
      ),
    );

    const itemsCard = h('section.card', h('div.card-head', h('h2.grow', 'Products and services')), h('div.card-body.flush', lineItemsTable(job.items, { showCost: true }), h('hr.divider'), totalsBlock(job)));

    return [
      header,
      status === 'late' ? h('div.notice.danger', { style: { marginBottom: '16px' } }, icon('alert'), h('span', 'A visit on this job is past its date and not marked complete.')) : null,
      status === 'requires_invoicing' ? h('div.notice.warning', { style: { marginBottom: '16px' } }, icon('receipt-text'), h('span', job.billing === 'per_visit' ? `${uninvoicedDone.length === 1 ? 'A completed visit is' : `${uninvoicedDone.length} completed visits are`} not invoiced yet.` : 'All visits are complete. Create an invoice to get paid.')) : null,
      h(
        'div.detail',
        h('div.detail-main', summary, visitsCard, checklistCard('jobs', job), itemsCard, invoicesCard, attachmentsCard('jobs', job, { title: 'Photos and files' })),
        h(
          'div.detail-aside',
          clientCard(client, job.propertyId),
          costingCard,
          h(
            'section.card',
            h('div.card-head', h('h2.grow', 'Activity')),
            timeline([
              quote ? { at: quote.createdAt, label: `Quote #${quote.number} created`, icon: 'file-pen' } : null,
              quote?.approvedAt ? { at: quote.approvedAt, label: 'Quote approved', icon: 'check', tone: 'success' } : null,
              { at: job.createdAt, label: 'Job created', icon: 'hammer', tone: 'accent' },
              ...linkedInvoices.map((i) => ({ at: i.createdAt, label: `Invoice #${i.number} created`, icon: 'receipt-text' })),
              job.closedAt ? { at: job.closedAt, label: 'Job closed', icon: 'circle-check', tone: 'success' } : null,
            ]),
          ),
          notesCard('jobs', job),
        ),
      ),
    ];
  }, ['jobs', 'clients', 'invoices', 'payments', 'quotes', 'team', 'timeEntries', 'expenses']);

  const j = store.get('jobs', id);
  return { node: h('div.page', body), title: j ? `Job #${j.number}` : 'Job' };
}
