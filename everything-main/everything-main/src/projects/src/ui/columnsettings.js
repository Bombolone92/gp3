import { el } from '../lib/dom.js';
import { fieldId } from '../lib/util.js';
import { store, normalizeWipLimit, normalizeArchiveDays } from '../lib/store.js';
import { doneColumnIds, columnTasks } from '../lib/board.js';
import { AUTO_ARCHIVE_CHOICES } from '../lib/columns.js';
import { openModal } from './modal.js';

/**
 * What a column holds about itself: a WIP limit, and — on a done column — an
 * age at which finished work archives itself.
 *
 * Both are optional and both are honest about what they do: the limit is
 * shown, never enforced, and the archive rule says when it runs and that
 * nothing is deleted.
 */
export function openColumnSettings(projectId, columnId) {
  const doc = store.getDoc(projectId);
  const column = doc?.columns.find((c) => c.id === columnId);
  if (!column) return null;

  const isDone = doneColumnIds(doc).has(column.id);
  const count = columnTasks(doc.tasks, column.id).length;

  const wipId = fieldId('col-wip');
  const wipInput = el('input.input', {
    id: wipId,
    type: 'number',
    min: 1,
    max: 999,
    step: 1,
    inputmode: 'numeric',
    placeholder: 'No limit',
    value: normalizeWipLimit(column.wipLimit) ?? '',
  });

  const wipHint = el('p.form-hint');
  function syncWipHint() {
    const limit = normalizeWipLimit(wipInput.value);
    wipHint.textContent = limit === null
      ? 'The header shows a plain count. Leave empty for no limit.'
      : count > limit
        ? `The header will read ${count} / ${limit} in a warning tone. Nothing is blocked.`
        : `The header will read ${count} / ${limit}, and warn when it goes over. `
          + 'Nothing is blocked.';
  }
  wipInput.addEventListener('input', syncWipHint);
  syncWipHint();

  const archiveId = fieldId('col-archive');
  const archiveSelect = el('select.input', {
    id: archiveId,
    disabled: !isDone,
    // A control that cannot be used says why, as the disabled filter facets do.
    title: isDone ? null : 'Only a done column can archive its own tasks',
  }, AUTO_ARCHIVE_CHOICES.map((choice) => el('option', {
    value: choice.value === null ? '' : String(choice.value),
    selected: (normalizeArchiveDays(column.autoArchiveDays) ?? null) === choice.value,
  }, choice.label)));

  const archiveHint = el('p.form-hint');
  function syncArchiveHint() {
    if (!isDone) {
      archiveHint.textContent = 'Only a done column can archive its own tasks. '
        + 'Mark this one as a done column first.';
      return;
    }
    const days = normalizeArchiveDays(archiveSelect.value);
    archiveHint.textContent = days === null
      ? 'Finished tasks stay here until you archive them yourself.'
      : `Tasks that have sat here for ${days} day${days === 1 ? '' : 's'} are archived `
        + 'when you open the project. Archived work is never deleted, and the app says '
        + 'what it archived.';
  }
  archiveSelect.addEventListener('change', syncArchiveHint);
  syncArchiveHint();

  const form = el('form', {
    onsubmit: (e) => {
      e.preventDefault();
      store.updateColumn(projectId, column.id, {
        wipLimit: normalizeWipLimit(wipInput.value),
        autoArchiveDays: isDone ? normalizeArchiveDays(archiveSelect.value) : null,
      });
      modal.close();
    },
  },
    el('div.field', {},
      el('label.label', { htmlFor: wipId }, 'Work in progress limit'),
      wipInput,
      wipHint
    ),
    el('div.field', {},
      el('label.label', { htmlFor: archiveId }, 'Archive done tasks'),
      archiveSelect,
      archiveHint
    ),
    el('div.row.row-end', {},
      el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
      el('button.btn.btn-primary', { type: 'submit' }, 'Save')
    )
  );

  const modal = openModal({
    title: `${column.name} settings`,
    content: form,
    dismissOnBack: true,
  });
  return modal;
}
