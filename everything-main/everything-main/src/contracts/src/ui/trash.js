/**
 * The trash: what was deleted, when, and the two ways out — restore it, or
 * remove it for good. Deleting anything in this app is a legal-document
 * decision, so nothing is erased at the moment of the tap; it lands here and
 * leaves by itself after TRASH_DAYS.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store, TRASH_DAYS } from '../lib/store.js';
import { todayISO, dateToISO, daysBetween, relativeDays } from '../lib/dates.js';
import { emptyState } from './bits.js';
import { DOT, joinDot } from '../lib/util.js';

const KINDS = {
  contract: { label: 'Contract', icon: 'file-text' },
  contact: { label: 'Contact', icon: 'user' },
  document: { label: 'Document', icon: 'paperclip' },
};

/** "deleted yesterday · 29 days left" — both halves matter before restoring. */
function timing(deletedAt) {
  const days = Math.max(0, daysBetween(dateToISO(new Date(deletedAt)), todayISO()));
  const when = days === 0 ? 'deleted today' : `deleted ${relativeDays(-days)}`;
  const left = Math.max(0, TRASH_DAYS - days);
  return `${when}${DOT}${left === 0 ? 'goes today' : `${left} day${left === 1 ? '' : 's'} left`}`;
}

export function openTrash() {
  const body = el('div');

  function render() {
    clear(body);
    const entries = store.trashEntries();

    if (!entries.length) {
      body.append(emptyState({
        icon: 'trashBin',
        title: 'Nothing in the trash',
        sub: `Deleted contracts, contacts, and documents wait here for ${TRASH_DAYS} days before they are removed for good.`,
      }));
      return;
    }

    body.append(el('p.modal-note', {},
      `Restore anything here, or remove it now. Whatever is left is deleted for good ${TRASH_DAYS} days after it went in.`));

    body.append(el('div.list', {}, entries.map((entry) => {
      const kind = KINDS[entry.kind];
      return el('div.trash-row', {},
        el('span.doc-ic', { html: icon(kind.icon, 17, 1.8) }),
        el('div.grow.min0', {},
          el('div.row-title', {}, entry.title),
          // What it was, what it belonged to, and how long is left: the whole
          // line is what decides whether to restore it, and a contact with a
          // company on it was still long enough to lose the days at the end.
          el('div.row-sub.wrap', {},
            joinDot([kind.label, entry.detail, timing(entry.deletedAt)]))
        ),
        el('button.btn.btn-ghost.btn-compact', {
          html: icon('undo', 14, 2),
          // The button is held on to before the await: currentTarget is only
          // valid while the event is dispatching, so reading it again after the
          // write threw gave null — the row stayed disabled for good and the
          // failure was never reported.
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              await store.restoreTrashEntry(entry);
              toast(`${kind.label} restored`, { icon: 'undo' });
            } catch (err) {
              console.error(err);
              btn.disabled = false;
              toast('Could not restore. Check your connection', { icon: 'wifiOff' });
            }
          },
        }, ' Restore'),
        el('button.icon-btn.subtle.danger', {
          html: icon('trash', 16, 2),
          'aria-label': `Delete ${entry.title} permanently`,
          title: 'Delete permanently',
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Delete permanently?',
              message: entry.kind === 'contract'
                ? `"${entry.title}" and any documents attached to it are erased from your cloud. This cannot be undone.`
                : `"${entry.title}" is erased from your cloud. This cannot be undone.`,
              confirmLabel: 'Delete for good',
            });
            if (!ok) return;
            try {
              await store.purgeTrashEntry(entry);
              toast('Deleted permanently', { icon: 'trash' });
            } catch (err) {
              console.error(err);
              toast('Could not delete. Check your connection', { icon: 'wifiOff' });
            }
          },
        })
      );
    })));

    body.append(el('button.btn.btn-ghost.btn-block.btn-danger-ghost', {
      style: { marginTop: '16px' },
      onclick: async () => {
        const n = entries.length;
        const ok = await confirmDialog({
          title: 'Empty the trash?',
          message: `${n} item${n === 1 ? '' : 's'} and any attached documents are erased from your cloud. This cannot be undone.`,
          confirmLabel: 'Empty trash',
        });
        if (!ok) return;
        try {
          await store.emptyTrash();
          toast('Trash emptied', { icon: 'trash' });
        } catch (err) {
          console.error(err);
          toast('Could not empty the trash. Check your connection', { icon: 'wifiOff' });
        }
      },
    }, 'Empty trash now'));
  }

  render();
  // The list follows the store: restoring the last item leaves the empty
  // state on screen rather than a stale row.
  store.addEventListener('change', render);
  return openModal({
    title: 'Trash',
    content: body,
    onClose: () => store.removeEventListener('change', render),
  });
}
