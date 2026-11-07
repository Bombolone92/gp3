/** A single quote: the document, status actions, and conversion to a job. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { pageHeader, statusPill, emptyState, moreButton } from '../ui/components.js';
import { openMenu } from '../ui/menu.js';
import { confirmDialog } from '../ui/dialog.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { clientName } from '../core/format.js';
import { quoteStatus } from '../core/status.js';
import { computeTotals } from '../core/totals.js';
import { quoteToJob, duplicateDoc, removeDoc } from '../core/workflow.js';
import { clientCard, notesCard, money } from './common.js';
import { documentSheet, printDocument, sendDialog, timeline } from './docview.js';
import { attachmentsCard } from './attachments.js';
import { deleteAttachments } from '../files.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;

  const body = ctx.live(() => {
    const q = store.get('quotes', id);
    if (!q) return emptyState({ icon: 'file-pen', title: 'Quote not found', headingLevel: 1, text: 'It may have been deleted.', actions: [h('a.btn.primary', { href: '#/quotes' }, 'Back to quotes')] });
    const status = quoteStatus(q);
    const client = lookup.client(q.clientId);
    const t = computeTotals(q);
    const job = q.jobId ? store.get('jobs', q.jobId) : null;

    // Sending again after changes were requested puts the quote back with the client.
    const markSent = () => store.patch('quotes', q.id, { status: !q.status || q.status === 'draft' || q.status === 'changes_requested' ? 'awaiting_response' : q.status, sentAt: q.sentAt || new Date().toISOString() });
    const approve = () => {
      store.patch('quotes', q.id, { status: 'approved', approvedAt: new Date().toISOString() });
      toast('Quote approved', { action: { label: 'Convert to job', run: convert } });
    };
    const convert = async () => {
      const j = await quoteToJob(store, q.id);
      // Deleted meanwhile (here or on another device), e.g. from the toast's
      // Convert to job after leaving the page.
      if (!j) return toast('This quote no longer exists', { type: 'error' });
      toast(`Job #${j.number} created. Schedule it next.`);
      navigate(`/jobs/${j.id}/edit?schedule=1`);
    };

    let primary;
    if (status === 'draft') primary = h('button.btn.primary', { type: 'button', onClick: () => sendDialog('quotes', q, { onSent: () => (markSent(), toast('Quote marked as sent')) }) }, icon('send', 16), 'Send quote');
    else if (status === 'awaiting_response' || status === 'changes_requested') primary = h('button.btn.primary', { type: 'button', onClick: approve }, icon('check', 16), 'Mark approved');
    else if (status === 'approved') primary = h('button.btn.primary', { type: 'button', onClick: convert }, icon('hammer', 16), 'Convert to job');
    else if (job) primary = h('a.btn.primary', { href: `#/jobs/${job.id}` }, icon('hammer', 16), `View job #${job.number}`);

    const more = moreButton((btn) =>
      openMenu(
        btn,
        [
          { label: 'Print or save as PDF', icon: 'printer', run: () => printDocument('quotes', q) },
          status !== 'draft' ? { label: 'Send again', icon: 'send', run: () => sendDialog('quotes', q, { onSent: markSent }) } : null,
          { separator: true },
          { heading: 'Status' },
          // Once a job is made from it (archived or not) the quote stays approved.
          { label: 'Draft', checked: status === 'draft', run: () => store.patch('quotes', q.id, { status: 'draft' }), disabled: !!q.jobId },
          { label: 'Awaiting response', checked: status === 'awaiting_response', run: () => store.patch('quotes', q.id, { status: 'awaiting_response', sentAt: q.sentAt || new Date().toISOString() }), disabled: !!q.jobId },
          { label: 'Changes requested', checked: status === 'changes_requested', run: () => store.patch('quotes', q.id, { status: 'changes_requested' }), disabled: !!q.jobId },
          { label: 'Approved', checked: status === 'approved' || !!q.jobId, run: approve, disabled: !!q.jobId },
          { separator: true },
          !q.jobId && status !== 'approved' ? { label: 'Convert to job', icon: 'hammer', run: convert } : null,
          {
            label: 'Duplicate',
            icon: 'copy',
            run: async () => {
              const c = await duplicateDoc(store, 'quotes', q.id, app.today());
              toast(`Quote #${c.number} created`);
              navigate(`/quotes/${c.id}/edit`);
            },
          },
          q.archived
            ? { label: 'Unarchive', icon: 'unarchive', run: () => store.patch('quotes', q.id, { archived: false }) }
            : { label: 'Archive', icon: 'archive', run: () => (store.patch('quotes', q.id, { archived: true }), toast('Quote archived', { action: { label: 'Undo', run: () => store.patch('quotes', q.id, { archived: false }) } })) },
          {
            label: 'Delete',
            icon: 'trash',
            danger: true,
            run: async () => {
              if (!(await confirmDialog({ title: `Delete quote #${q.number}?`, message: 'This permanently deletes the quote. The client and any job made from it stay.', confirmLabel: 'Delete quote', danger: true }))) return;
              const undo = removeDoc(store, 'quotes', q.id);
              navigate('/quotes');
              toast('Quote deleted', { action: { label: 'Undo', run: undo }, onDismiss: () => !store.get('quotes', q.id) && deleteAttachments([q]) });
            },
          },
        ],
        { align: 'end' },
      ),
    );

    const header = pageHeader({
      title: h('span.row', { style: { gap: '12px', flexWrap: 'wrap' } }, `Quote #${q.number}`, statusPill(status)),
      crumbs: [{ label: 'Quotes', href: '#/quotes' }],
      subtitle: [q.title || 'Untitled quote', ' for ', h('a', { href: `#/clients/${q.clientId}` }, clientName(client))],
      actions: [more, h('a.btn', { href: `#/quotes/${q.id}/edit` }, icon('pencil', 16), 'Edit'), primary],
    });

    const optionalCount = (q.items || []).filter((i) => i.optional).length;
    return [
      header,
      status === 'changes_requested' ? h('div.notice.danger', { style: { marginBottom: '16px' } }, icon('alert'), h('span', 'The client asked for changes. Edit the quote and send it again.')) : null,
      h(
        'div.detail',
        h(
          'div.detail-main',
          h('section.card.sheet-card', documentSheet('quotes', q)),
          attachmentsCard('quotes', q),
          optionalCount ? h('div.notice', icon('info'), h('span', `${optionalCount} optional item${optionalCount === 1 ? '' : 's'}. Tick "Include in total" when the client picks one, and only those carry over to the job.`)) : null,
        ),
        h(
          'div.detail-aside',
          h(
            'section.card',
            h(
              'div.card-body',
              h(
                'div.doc-meta',
                h('div', h('div.meta-label', 'Total'), h('div.meta-value.big-number', { style: { fontSize: '22px' } }, money(t.total))),
                h('div', h('div.meta-label', 'Est. profit'), h('div.meta-value', { style: { fontSize: '18px', color: t.profit >= 0 ? 'var(--success)' : 'var(--danger)' } }, money(t.profit)), h('div.subtle', { style: { fontSize: '12px' } }, t.subtotal ? `${Math.round((t.profit / Math.max(1, t.subtotal - t.discount)) * 100)}% margin` : '')),
              ),
            ),
          ),
          clientCard(client, q.propertyId),
          h(
            'section.card',
            h('div.card-head', h('h2.grow', 'Activity')),
            timeline([
              { at: q.createdAt, label: 'Quote created', icon: 'file-pen' },
              { at: q.sentAt, label: 'Sent to client', icon: 'send', tone: 'accent' },
              ...(q.emails || []).map((e) => ({ at: e.at, label: `Emailed to ${(e.to || []).join(', ')}`, icon: 'mail', tone: 'accent' })),
              { at: q.approvedAt, label: 'Approved', icon: 'check', tone: 'success' },
              job ? { at: job.createdAt, label: `Converted to job #${job.number}`, icon: 'hammer', tone: 'success' } : null,
            ]),
          ),
          notesCard('quotes', q),
        ),
      ),
    ];
  }, ['quotes', 'clients', 'jobs', 'settings', 'team']);

  const q = store.get('quotes', id);
  return { node: h('div.page', body), title: q ? `Quote #${q.number}` : 'Quote' };
}
