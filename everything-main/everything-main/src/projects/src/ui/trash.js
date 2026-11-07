import { el, clear } from '../lib/dom.js';
import { icon } from './icons.js';
import { store, docTrash, TRASH_DAYS } from '../lib/store.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { relativeTime } from '../lib/util.js';

/**
 * The trash is the safety net behind the undo toasts: a delete anyone
 * noticed too late is still recoverable for TRASH_DAYS. Everything here is
 * either restore (cheap) or delete forever (confirmed).
 */

const NOTE = `Items are removed for good ${TRASH_DAYS} days after deletion.`;

function trashRow({ title, sub, deletedAt, dot, onRestore, onPurge, purgeTitle, purgeMessage }) {
  return el('div.recover-row', {},
    dot ? el('span.dot.dot-lg', { style: { background: dot }, 'aria-hidden': 'true' }) : null,
    el('div.recover-main', {},
      el('div.recover-title', {}, title),
      el('div.recover-sub', {}, [sub, deletedAt ? `deleted ${relativeTime(deletedAt)}` : null]
        .filter(Boolean).join(' · '))
    ),
    el('button.btn.btn-ghost.btn-sm', {
      type: 'button',
      html: icon('undo', 14, 2),
      // Named with its row, like the delete button beside it: a list of
      // buttons that all say "Restore" tells a screen reader nothing about
      // which one restores what.
      'aria-label': `Restore ${title}`,
      onclick: onRestore,
    }, ' Restore'),
    el('button.icon-btn.small', {
      type: 'button',
      html: icon('trash', 15, 2),
      'aria-label': `Delete ${title} forever`,
      title: 'Delete forever',
      onclick: async () => {
        const ok = await confirmDialog({
          title: purgeTitle,
          message: purgeMessage,
          confirmLabel: 'Delete forever',
        });
        if (ok) onPurge();
      },
    })
  );
}

/** Deleted tasks of one project. */
export function openTaskTrash(projectId) {
  const doc = store.getDoc(projectId);
  if (!doc) return null;

  const list = el('div.recover-list');
  const emptyBtn = el('button.btn.btn-danger-ghost.btn-sm', {
    type: 'button',
    html: icon('trash', 14, 2),
    onclick: async () => {
      const n = docTrash(doc).length;
      const ok = await confirmDialog({
        title: 'Empty the trash?',
        message: `${n} task${n === 1 ? '' : 's'} and their attachments are deleted for good.`,
        confirmLabel: 'Empty trash',
      });
      if (!ok) return;
      store.emptyTrash(projectId);
      render();
    },
  }, ' Empty trash');

  function render() {
    clear(list);
    const items = [...docTrash(doc)].sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
    emptyBtn.hidden = !items.length;
    if (!items.length) {
      list.append(el('p.form-hint', {}, 'Nothing here. Deleted tasks land in the trash first.'));
      return;
    }
    for (const task of items) {
      const column = doc.columns.find((c) => c.id === task.columnId);
      list.append(trashRow({
        title: task.title || 'Untitled task',
        sub: column ? `was in ${column.name}` : 'its column is gone',
        deletedAt: task.deletedAt,
        onRestore: () => {
          store.restoreTask(projectId, task.id);
          render();
          toast('Task restored', { icon: 'undo' });
        },
        onPurge: () => { store.purgeTask(projectId, task.id); render(); },
        purgeTitle: 'Delete this task forever?',
        purgeMessage: `"${task.title}" and its attachments cannot be recovered after this.`,
      }));
    }
  }

  render();
  return openModal({
    title: 'Trash',
    dismissOnBack: true,
    content: el('div', {},
      el('div.row.row-between.trash-head', {}, el('p.form-hint.grow', {}, NOTE), emptyBtn),
      list
    ),
  });
}

/** Deleted projects, whose documents are still on disk. */
export function openProjectTrash() {
  const list = el('div.recover-list');

  function render() {
    clear(list);
    const items = [...store.deletedProjects].sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
    if (!items.length) {
      list.append(el('p.form-hint', {}, 'No deleted projects.'));
      return;
    }
    for (const entry of items) {
      list.append(trashRow({
        title: entry.name,
        dot: entry.color,
        deletedAt: entry.deletedAt,
        onRestore: async () => {
          try {
            await store.restoreProject(entry.id);
            render();
            toast('Project restored', { icon: 'undo' });
          } catch (err) {
            console.error(err);
            toast('Could not restore. Check your connection', { icon: 'cloudOff' });
          }
        },
        onPurge: async () => {
          try {
            await store.purgeProject(entry.id);
            render();
          } catch (err) {
            console.error(err);
            toast('Could not delete. Check your connection', { icon: 'cloudOff' });
          }
        },
        purgeTitle: `Delete "${entry.name}" forever?`,
        purgeMessage: 'Its tasks, comments, and attachments cannot be recovered after this.',
      }));
    }
  }

  render();
  const onChange = (e) => { if (e.detail?.scope === 'projects') render(); };
  store.addEventListener('change', onChange);

  return openModal({
    title: 'Deleted projects',
    dismissOnBack: true,
    onClose: () => store.removeEventListener('change', onChange),
    content: el('div', {}, el('p.form-hint', {}, NOTE), list),
  });
}
