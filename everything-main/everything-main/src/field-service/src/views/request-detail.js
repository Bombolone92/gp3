/** A single request and its assessment, with conversion to a quote or job. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { pageHeader, statusPill, emptyState, moreButton } from '../ui/components.js';
import { openMenu } from '../ui/menu.js';
import { confirmDialog } from '../ui/dialog.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { clientName } from '../core/format.js';
import { requestStatus } from '../core/status.js';
import { formatDate, formatTimeRange } from '../core/dates.js';
import { requestToQuote, requestToJob } from '../core/workflow.js';
import { clientCard, notesCard, teamAvatars, teamNames } from './common.js';
import { timeline } from './docview.js';
import { attachmentsCard } from './attachments.js';
import { deleteAttachments } from '../files.js';

const TIME_LABEL = { any: 'Any time', morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  const body = ctx.live(() => {
    const r = store.get('requests', id);
    if (!r) return emptyState({ icon: 'inbox', title: 'Request not found', headingLevel: 1, text: 'It may have been deleted.', actions: [h('a.btn.primary', { href: '#/requests' }, 'Back to requests')] });
    const today = app.today();
    const status = requestStatus(r, today);
    const client = lookup.client(r.clientId);
    const target = r.convertedTo ? store.get(r.convertedTo.type === 'quote' ? 'quotes' : 'jobs', r.convertedTo.id) : null;

    const toQuote = async () => {
      const q = await requestToQuote(store, r.id);
      // Already being turned into a job by an earlier click: that one leads on.
      if (!q || !store.get('quotes', q.id)) return;
      toast(`Quote #${q.number} started`);
      navigate(`/quotes/${q.id}/edit`);
    };
    const toJob = async () => {
      const j = await requestToJob(store, r.id);
      if (!j || !store.get('jobs', j.id)) return;
      toast(`Job #${j.number} started`);
      navigate(`/jobs/${j.id}/edit?schedule=1`);
    };
    const setAssessmentDone = (done) => store.patch('requests', r.id, (x) => ((x.assessment = { ...x.assessment, completedAt: done ? new Date().toISOString() : null }), x));

    const primary = target
      ? h('a.btn.primary', { href: `#/${r.convertedTo.type === 'quote' ? 'quotes' : 'jobs'}/${target.id}` }, icon(r.convertedTo.type === 'quote' ? 'file-pen' : 'hammer', 16), `View ${r.convertedTo.type} #${target.number}`)
      : h('button.btn.primary', { type: 'button', onClick: toQuote }, icon('file-pen', 16), 'Convert to quote');

    const more = moreButton((btn) =>
      openMenu(
        btn,
        [
          !target ? { label: 'Convert to job', icon: 'hammer', run: toJob } : null,
          r.assessment && !r.assessment.completedAt ? { label: 'Mark assessment complete', icon: 'check', run: () => (setAssessmentDone(true), toast('Assessment complete')) } : null,
          r.assessment?.completedAt ? { label: 'Mark assessment not complete', icon: 'undo', run: () => setAssessmentDone(false) } : null,
          { separator: true },
          r.archived
            ? { label: 'Unarchive', icon: 'unarchive', run: () => store.patch('requests', r.id, { archived: false }) }
            : { label: 'Archive', icon: 'archive', run: () => (store.patch('requests', r.id, { archived: true }), toast('Request archived', { action: { label: 'Undo', run: () => store.patch('requests', r.id, { archived: false }) } })) },
          {
            label: 'Delete',
            icon: 'trash',
            danger: true,
            run: async () => {
              if (!(await confirmDialog({ title: `Delete request #${r.number}?`, message: 'This permanently deletes the request and its assessment.', confirmLabel: 'Delete request', danger: true }))) return;
              const removed = store.remove('requests', r.id);
              navigate('/requests');
              toast('Request deleted', { action: { label: 'Undo', run: () => store.restore('requests', removed) }, onDismiss: () => !store.get('requests', r.id) && deleteAttachments([removed]) });
            },
          },
        ],
        { align: 'end' },
      ),
    );

    const a = r.assessment;
    const assessmentCard = h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Assessment'), a?.completedAt || a?.date ? statusPill(a.completedAt ? 'assessment_complete' : a.date < today ? 'assessment_overdue' : 'assessment_scheduled') : null),
      h(
        'div.card-body',
        a
          ? h(
              'div.stack',
              h(
                'div.doc-meta',
                h('div', h('div.meta-label', 'Date'), h('div.meta-value', a.date ? formatDate(a.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set')),
                h('div', h('div.meta-label', 'Time'), h('div.meta-value', formatTimeRange(a.start, a.end))),
                h('div', h('div.meta-label', 'Team'), h('div.meta-value.row', { style: { gap: '6px' } }, teamAvatars(a.assignees || []), h('span', teamNames(a.assignees || [])))),
              ),
              a.instructions ? h('p.message-block', a.instructions) : null,
              h(
                'div.row',
                a.completedAt
                  ? h('span.subtle', `Completed ${formatDate(a.completedAt)}`)
                  : h('button.btn', { type: 'button', onClick: () => (setAssessmentDone(true), toast('Assessment complete')) }, icon('check', 16), 'Mark complete'),
                h('a.btn.ghost', { href: `#/requests/${r.id}/edit` }, 'Reschedule'),
              ),
            )
          : h('div.section-empty', { style: { padding: '0' } }, h('span', 'No site visit planned.'), h('a.btn.sm', { href: `#/requests/${r.id}/edit` }, icon('calendar-plus', 14), 'Schedule assessment')),
      ),
    );

    return [
      pageHeader({
        title: h('span.row', { style: { gap: '12px', flexWrap: 'wrap' } }, `Request #${r.number || ''}`, statusPill(status)),
        crumbs: [{ label: 'Requests', href: '#/requests' }],
        subtitle: [r.title || 'Untitled request', ' from ', h('a', { href: `#/clients/${r.clientId}` }, clientName(client))],
        actions: [more, h('a.btn', { href: `#/requests/${r.id}/edit` }, icon('pencil', 16), 'Edit'), primary],
      }),
      h(
        'div.detail',
        h(
          'div.detail-main',
          h(
            'section.card',
            h('div.card-head', h('h2.grow', 'Service details')),
            h(
              'div.card-body.stack',
              h('p.message-block', { style: { color: 'var(--text)' } }, r.details || 'No details provided.'),
              h(
                'dl.kv',
                h('dt', 'Received'),
                h('dd', formatDate(r.createdAt)),
                h('dt', 'Source'),
                h('dd', r.source || 'Not specified'),
                h('dt', 'Preferred dates'),
                h('dd', r.availability?.dates?.length ? r.availability.dates.map((d) => formatDate(d, { weekday: 'short', month: 'short', day: 'numeric' })).join(', ') : 'Flexible'),
                h('dt', 'Preferred times'),
                h('dd', r.availability?.times?.length ? r.availability.times.map((t) => TIME_LABEL[t] || t).join(', ') : 'Flexible'),
              ),
            ),
          ),
          assessmentCard,
          attachmentsCard('requests', r, { title: 'Photos from the client' }),
        ),
        h(
          'div.detail-aside',
          clientCard(client, r.propertyId),
          h(
            'section.card',
            h('div.card-head', h('h2.grow', 'Activity')),
            timeline([
              { at: r.createdAt, label: 'Request received', icon: 'inbox' },
              a?.completedAt ? { at: a.completedAt, label: 'Assessment completed', icon: 'check', tone: 'success' } : null,
              target ? { at: target.createdAt, label: `Converted to ${r.convertedTo.type} #${target.number}`, icon: r.convertedTo.type === 'quote' ? 'file-pen' : 'hammer', tone: 'accent' } : null,
            ]),
          ),
          notesCard('requests', r),
        ),
      ),
    ];
  }, ['requests', 'clients', 'quotes', 'jobs', 'team']);
  const r = store.get('requests', id);
  return { node: h('div.page', body), title: r ? `Request #${r.number}` : 'Request' };
}
