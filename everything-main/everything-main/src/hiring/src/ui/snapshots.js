/**
 * The snapshot list: what the app has quietly kept in the user's own drive,
 * with a way back to any of it. This is the screen nobody looks at until
 * the day they need it, so it says plainly what each copy holds.
 */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { downloadFile } from './components.js';
import { confirmDialog, openModal } from './modal.js';
import { toast } from './toast.js';
import { countsText, SNAPSHOT_DIR, SNAPSHOT_REASONS } from '../core/snapshots.js';
import { validateBackup } from '../core/transfer.js';
import { formatBytes, plural } from '../lib/format.js';
import { formatDateTime, relativeDays } from '../lib/dates.js';
import { reconcilePublishedPages } from './publish.js';

export function openSnapshots(ctx) {
  const { store } = ctx;
  const body = el('div', { style: { display: 'contents' } });
  const modal = openModal({ title: 'Snapshots', wide: true, content: body });

  async function render() {
    let list = [];
    let failed = null;
    try {
      list = await store.listSnapshots();
    } catch (err) {
      failed = err;
    }

    const takeNow = el('button', { class: 'btn btn-sm' }, icon('cloud', 14), 'Take one now');
    takeNow.addEventListener('click', async () => {
      takeNow.disabled = true;
      try {
        await store.snapshot('manual');
        toast('Snapshot saved to your drive');
        await render();
      } catch (err) {
        takeNow.disabled = false;
        toast(err.message ?? 'Couldn’t write the snapshot.', 'error');
      }
    });

    const intro = el(
      'p',
      { class: 'confirm-message' },
      `The app keeps copies of everything in your own Puter drive, under ${SNAPSHOT_DIR}/ — one a day, and one immediately before a wipe, a restore, or a purge. They are yours: nothing here is sent anywhere.`
    );

    if (failed) {
      body.replaceChildren(
        intro,
        el('div', { class: 'form-error' }, icon('circle-alert', 15), 'Couldn’t read your drive just now. The app keeps working; try again in a moment.'),
        el('div', { class: 'modal-footer no-pad' }, takeNow, el('span', { class: 'grow' }), el('button', { class: 'btn btn-primary', onClick: () => modal.close() }, 'Done'))
      );
      return;
    }

    body.replaceChildren(
      intro,
      list.length === 0
        ? el('p', { class: 'card-empty' }, 'No snapshots yet. The first one is taken automatically the next time the app loads — or take one now.')
        : el('div', { class: 'row-list snapshot-list' }, list.map((snapshot) => snapshotRow(snapshot))),
      el(
        'div',
        { class: 'modal-footer no-pad' },
        takeNow,
        el('span', { class: 'grow' }),
        el('button', { class: 'btn btn-primary', onClick: () => modal.close() }, 'Done')
      )
    );

    function snapshotRow(snapshot) {
      const download = async () => {
        try {
          const payload = await store.readSnapshot(snapshot.name);
          downloadFile(snapshot.name, JSON.stringify(payload, null, 2), 'application/json');
          toast('Snapshot downloaded');
        } catch (err) {
          toast(err.message ?? 'Couldn’t read that snapshot.', 'error');
        }
      };

      const restore = async (e) => {
        const button = e.currentTarget;
        button.disabled = true;
        let payload;
        try {
          payload = await store.readSnapshot(snapshot.name);
        } catch (err) {
          button.disabled = false;
          toast(err.message ?? 'Couldn’t read that snapshot.', 'error');
          return;
        }
        // The same validation a hand-picked file goes through: a snapshot
        // is a file in a folder the user can edit like any other.
        const problems = validateBackup(payload);
        if (problems.length > 0) {
          button.disabled = false;
          toast(problems.join(' '), 'error');
          return;
        }
        const ok = await confirmDialog({
          title: 'Restore this snapshot?',
          message: `Everything in the app is replaced by the copy from ${formatDateTime(snapshot.at)} (${countsText(
            snapshot.counts
          )}). A snapshot of the current data is taken first, so this is reversible.`,
          confirmLabel: 'Replace everything',
          danger: true,
        });
        if (!ok) {
          button.disabled = false;
          return;
        }
        try {
          await store.restoreBackup(payload);
        } catch (err) {
          button.disabled = false;
          toast(err.message, 'error');
          return;
        }
        modal.close();
        toast('Snapshot restored');
        // The hosted pages must match the restored data, exactly as after
        // restoring a downloaded backup.
        try {
          await reconcilePublishedPages(ctx);
        } catch (err) {
          console.error(err);
          toast('Couldn’t sync the published job pages. Review them from the Jobs view.', 'error');
        }
      };

      return el(
        'div',
        { class: 'item-row' },
        el('span', { class: 'attachment-icon' }, icon('cloud', 16)),
        el(
          'div',
          { class: 'item-main' },
          el('div', { class: 'item-title' }, `${formatDateTime(snapshot.at)} · ${relativeDays(snapshot.at)}`),
          el(
            'div',
            { class: 'item-sub' },
            [
              SNAPSHOT_REASONS[snapshot.reason] ?? 'Automatic',
              snapshot.counts ? countsText(snapshot.counts) : null,
              snapshot.bytes ? formatBytes(snapshot.bytes) : null,
            ]
              .filter(Boolean)
              .join(' · ')
          )
        ),
        el('div', { class: 'item-actions' },
          el('button', { class: 'btn btn-sm', onClick: download }, icon('download', 14), 'Download'),
          el('button', { class: 'btn btn-sm', onClick: restore }, icon('restore', 14), 'Restore'),
          el(
            'button',
            {
              class: 'btn btn-ghost btn-icon btn-sm btn-icon-danger',
              'aria-label': `Delete the snapshot from ${formatDateTime(snapshot.at)}`,
              title: 'Delete this snapshot',
              onClick: async (e) => {
                const button = e.currentTarget;
                button.disabled = true;
                const ok = await confirmDialog({
                  title: 'Delete this snapshot?',
                  message: 'The file is removed from your drive. The other snapshots are untouched.',
                  confirmLabel: 'Delete',
                  danger: true,
                });
                if (!ok) {
                  button.disabled = false;
                  return;
                }
                try {
                  await store.deleteSnapshot(snapshot.name);
                  toast('Snapshot deleted');
                  await render();
                } catch (err) {
                  button.disabled = false;
                  toast(err.message ?? 'Couldn’t delete that snapshot.', 'error');
                }
              },
            },
            icon('trash', 14)
          )
        )
      );
    }
  }

  render();
}

/** The Settings row: how many copies there are, and the way into them. */
export async function snapshotSummary(store) {
  try {
    const list = await store.listSnapshots();
    if (list.length === 0) return 'None yet';
    return `${plural(list.length, 'snapshot')} · newest ${relativeDays(list[0].at)}`;
  } catch {
    return '';
  }
}
