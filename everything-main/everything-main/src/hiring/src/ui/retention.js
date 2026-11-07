/**
 * Retention review: archived candidates past the configured window,
 * each with a one-click export and an individually confirmed purge.
 */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { avatar, downloadFile } from './components.js';
import { confirmDialog, openModal } from './modal.js';
import { toast } from './toast.js';
import { retentionDue } from '../core/retention.js';
import { candidateExport } from '../core/transfer.js';
import { relativeDays, todayISO } from '../lib/dates.js';
import { fileSlug, plural } from '../lib/format.js';

function exportCandidate(ctx, candidate) {
  const payload = candidateExport(ctx.store.state, candidate.id);
  downloadFile(`candidate-${fileSlug(candidate.name)}-${todayISO()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  toast(`${candidate.name}’s data exported`);
}

/** Profile-level export button handler, shared with the review list. */
export { exportCandidate };

export function openRetentionReview(ctx) {
  const { store } = ctx;
  const body = el('div', { style: { display: 'contents' } });

  function render() {
    const due = retentionDue(store.state);
    if (due.length === 0) {
      body.replaceChildren(
        el('p', { class: 'confirm-message' }, 'All clear. Nothing is past the retention window.'),
        el('div', { class: 'modal-footer no-pad' }, el('span', { class: 'grow' }), el('button', { class: 'btn btn-primary', onClick: () => modal.close() }, 'Done'))
      );
      return;
    }
    body.replaceChildren(
      el(
        'p',
        { class: 'confirm-message' },
        `${plural(due.length, 'archived candidate')} passed the ${store.state.settings.retentionMonths}-month window. Export anyone you need a record of, then delete. Each deletion asks for confirmation and removes their interviews, feedback, offers, and files.`
      ),
      el(
        'div',
        { class: 'row-list retention-list' },
        due.map(({ candidate, archivedAt }) => {
          const job = store.state.jobs.find((j) => j.id === candidate.jobId);
          return el(
            'div',
            { class: 'item-row' },
            avatar(candidate.name),
            el(
              'div',
              { class: 'item-main' },
              el('div', { class: 'item-title' }, candidate.name),
              el('div', { class: 'item-sub' }, `${job?.title ?? 'Unknown job'} · archived ${relativeDays(archivedAt)}`)
            ),
            el(
              'button',
              { class: 'btn btn-sm', onClick: () => exportCandidate(ctx, candidate) },
              icon('download', 14),
              'Export'
            ),
            el(
              'button',
              {
                class: 'btn btn-sm btn-danger',
                // Disabled across the confirm: the list underneath stays
                // clickable, and a double-click on these small buttons
                // stacked two dialogs for the same person — confirming
                // one left the other asking to delete a deleted record.
                onClick: async (e) => {
                  const button = e.currentTarget;
                  button.disabled = true;
                  const ok = await confirmDialog({
                    title: `Delete ${candidate.name}?`,
                    message: 'Their profile, history, interviews, scorecards, offers, and attachments are permanently removed. This cannot be undone.',
                    confirmLabel: 'Delete permanently',
                    danger: true,
                  });
                  if (!ok) {
                    button.disabled = false;
                    return;
                  }
                  try {
                    await store.deleteCandidate(candidate.id);
                    toast(`${candidate.name} deleted`);
                    render();
                  } catch (err) {
                    button.disabled = false;
                    toast(err.message, 'error');
                  }
                },
              },
              icon('trash', 14),
              'Delete'
            )
          );
        })
      ),
      el('div', { class: 'modal-footer no-pad' }, el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Close'))
    );
  }

  const modal = openModal({ title: 'Retention review', wide: true, content: body });
  render();
}
