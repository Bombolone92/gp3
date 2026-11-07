import { el, clear } from '../lib/dom.js';
import { icon } from './icons.js';
import { store, docArchive } from '../lib/store.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { relativeTime } from '../lib/util.js';
import { dueBadge, priorityBadge } from './bits.js';

/**
 * Archived tasks of one project: out of the board, timeline, milestones, and
 * every count, but kept whole. Unlike the trash there is no expiry — archive
 * is where finished work goes to stop being noise.
 */
export function openTaskArchive(projectId) {
  const doc = store.getDoc(projectId);
  if (!doc) return null;

  const list = el('div.recover-list');

  function render() {
    clear(list);
    const items = [...docArchive(doc)].sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
    if (!items.length) {
      list.append(el('p.form-hint', {}, 'Nothing archived yet. Archive a task from its sheet, '
        + 'or a whole done column from the column menu.'));
      return;
    }
    for (const task of items) {
      const column = doc.columns.find((c) => c.id === task.columnId);
      list.append(el('div.recover-row', {},
        el('div.recover-main', {},
          el('div.recover-title', {}, task.title || 'Untitled task'),
          el('div.recover-sub', {}, [
            column ? `was in ${column.name}` : 'its column is gone',
            task.archivedAt ? `archived ${relativeTime(task.archivedAt)}` : null,
          ].filter(Boolean).join(' · '))
        ),
        el('span.recover-badges', {}, priorityBadge(task.priority), dueBadge(task, true)),
        el('button.btn.btn-ghost.btn-sm', {
          type: 'button',
          html: icon('unarchive', 14, 2),
          // Named with its row, like the delete button beside it.
          'aria-label': `Unarchive ${task.title || 'Untitled task'}`,
          onclick: () => {
            store.unarchiveTask(projectId, task.id);
            render();
            toast('Task unarchived', { icon: 'unarchive' });
          },
        }, ' Unarchive'),
        el('button.icon-btn.small', {
          type: 'button',
          html: icon('trash', 15, 2),
          'aria-label': `Delete ${task.title || 'Untitled task'}`,
          title: 'Move to trash',
          // Straight to the trash, which is itself undoable — no confirm.
          onclick: () => {
            store.trashArchivedTask(projectId, task.id);
            render();
            toast('Task moved to trash', {
              icon: 'trash',
              duration: 7000,
              action: {
                label: 'Undo',
                onClick: () => {
                  store.restoreTask(projectId, task.id);
                  store.archiveTask(projectId, task.id);
                  render();
                },
              },
            });
          },
        })
      ));
    }
  }

  render();
  return openModal({
    title: 'Archived tasks',
    dismissOnBack: true,
    content: el('div', {},
      el('p.form-hint', {}, 'Archived tasks keep everything (comments, attachments, dates) '
        + 'but stay out of the board and its counts.'),
      list
    ),
  });
}
