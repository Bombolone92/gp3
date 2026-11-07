/**
 * Add or edit one obligation. Shared by the contract detail page and the
 * global Obligations view, so a duty is created and corrected the same way
 * wherever it is found.
 */

import { el, clear } from './dom.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store, REPEAT_OPTIONS, repeatAnchor } from '../lib/store.js';
import { field, textInput, select, formSnapshot } from './bits.js';

const OWNERS = [
  { value: 'us', label: 'Ours' },
  { value: 'them', label: 'Theirs' },
  { value: 'mutual', label: 'Mutual' },
];

const ENDS = [
  { value: 'contract', label: 'When the contract ends' },
  { value: 'date', label: 'On a date' },
  { value: 'count', label: 'After a number of times' },
];

/** openObligationForm({ contract, obligation?, onSaved? }) */
export function openObligationForm({ contract, obligation = null, onSaved = null }) {
  const isEdit = !!obligation;
  const text = textInput({
    value: obligation?.text || '', required: true, maxLength: 200,
    placeholder: 'e.g. Pay invoice net 30',
  });
  const owner = select(OWNERS, obligation?.owner || 'us');
  const due = textInput({ type: 'date', value: obligation?.due || '' });

  /* Repeat: the most common obligation in a contract is a repeating one, and
     the alternative was twelve near-identical rows nobody would create. */
  const existing = obligation?.repeat || null;
  const repeat = select(REPEAT_OPTIONS, existing?.every || 'none');
  const endKind = select(ENDS,
    existing?.until ? 'date' : existing?.count ? 'count' : 'contract');
  const untilInput = textInput({ type: 'date', value: existing?.until || '' });
  const countInput = textInput({
    type: 'number', max: '240', inputmode: 'numeric',
    value: existing?.count ?? 12,
  });
  const repeatWrap = el('div');
  const doneCount = obligation?.history?.length || 0;
  /*
   * Which occurrence the date on screen is, the same way normalizeObligation
   * works it out: the one after the completed ones, except on a series that has
   * already finished, where it is the last one completed. Everything the form
   * derives — the anchor it saves, the smallest count that still contains it —
   * hangs off this, and getting it wrong by one leaves a series that repeats a
   * date it has already been through.
   */
  const liveIndex = obligation?.done && doneCount ? doneCount - 1 : doneCount;
  /*
   * A series that has run its course: the date on screen is the last one
   * completed, not a next one, and the form says so. Saving it with room to
   * run again — a bigger count, a later last date — brings the next
   * occurrence back (reopenedSeries, in the store).
   */
  const finished = !!obligation?.done && !!obligation?.repeat && doneCount > 0;
  const dueLabelText = () => (repeat.value === 'none' ? 'Due date (optional)'
    : finished ? 'Last due date' : 'Next due date');

  /*
   * The end condition is one of three, and only the chosen one is on screen —
   * so its bounds have to be applied as it appears. Left blank it used to save
   * as no end condition at all: "on a date" with no date, or "after a number
   * of times" with the number cleared, both became a series that never ends.
   * A last occurrence before the next one due, or a count already reached,
   * were accepted just as quietly and finished the series before it ran.
   */
  function syncRepeatBounds() {
    untilInput.required = repeat.value !== 'none' && endKind.value === 'date';
    countInput.required = repeat.value !== 'none' && endKind.value === 'count';
    untilInput.min = due.value || '';
    // The count has to still contain the occurrence on screen.
    countInput.min = String(liveIndex + 1);
  }

  function renderRepeat() {
    clear(repeatWrap);
    syncRepeatBounds();
    if (repeat.value === 'none') return;
    const completed = `${doneCount} occurrence${doneCount === 1 ? '' : 's'}`;
    repeatWrap.append(field('Repeats until', endKind, {
      hint: finished
        ? `${completed} completed and the series has finished. Give it more room and the next one is scheduled.`
        : doneCount
          ? `${completed} already completed; the date above is the next one.`
          : 'Only the next occurrence is tracked at a time.',
    }));
    if (endKind.value === 'date') repeatWrap.append(field('Last occurrence on or before', untilInput));
    if (endKind.value === 'count') {
      repeatWrap.append(field('Number of occurrences', countInput, {
        hint: finished
          ? `Counted from the first. ${doneCount} are done, so anything above that schedules the next one.`
          : doneCount
            ? `Counted from the first, so it has to be more than the ${doneCount} already done.`
            : null,
      }));
    }
  }
  repeat.addEventListener('change', renderRepeat);
  endKind.addEventListener('change', renderRepeat);
  renderRepeat();

  const save = el('button.btn.btn-primary.btn-block', { type: 'submit' },
    isEdit ? 'Save changes' : 'Add obligation');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      // A repeat is a schedule, and a schedule needs a first date to count from.
      if (repeat.value !== 'none' && !due.value) {
        due.setCustomValidity('A repeating obligation needs its first due date');
        form.reportValidity();
        return;
      }
      save.disabled = true;
      const data = {
        text: text.value,
        owner: owner.value,
        due: due.value || null,
        repeat: repeat.value === 'none' ? null : {
          every: repeat.value,
          // Anchored so the completed occurrences still line up behind the
          // date shown, and future ones follow from the corrected date. The
          // existing anchor is kept while it still explains that date, so a
          // month-end schedule survives being saved from a February.
          anchor: repeatAnchor(due.value, repeat.value, liveIndex, existing),
          until: endKind.value === 'date' ? untilInput.value || null : null,
          count: endKind.value === 'count' ? Number(countInput.value) || null : null,
          contractEnd: endKind.value === 'contract',
        },
      };
      try {
        if (isEdit) {
          await store.setObligation(contract.id, obligation.id, data);
        } else {
          await store.addObligations(contract.id, [data]);
        }
        modal.close();
        toast(isEdit ? 'Obligation updated' : 'Obligation added');
        onSaved?.();
      } catch (err) {
        console.error(err);
        save.disabled = false;
        toast('Could not save. Check your connection', { icon: 'wifiOff' });
      }
    },
  },
    field('What must happen', text),
    el('div.field-row', {},
      field('Whose duty', owner, { grow: true }),
      field(dueLabelText(), due, { grow: true })
    ),
    field('Repeats', repeat),
    repeatWrap,
    save
  );

  // The due-date label depends on the cadence, and an "end before start"-style
  // validity message has to clear when either input changes.
  const dueLabel = form.querySelector(`label[for="${due.id}"]`);
  const syncDue = () => {
    due.setCustomValidity('');
    // The last occurrence is bounded by the next one due, which can be edited
    // after the repeat fields were drawn.
    syncRepeatBounds();
    if (dueLabel) dueLabel.textContent = dueLabelText();
  };
  repeat.addEventListener('change', syncDue);
  due.addEventListener('input', syncDue);

  const initial = formSnapshot(form);
  const modal = openModal({
    title: isEdit ? 'Edit obligation' : 'Add obligation',
    content: form,
    beforeClose: () => formSnapshot(form) === initial || confirmDialog({
      title: isEdit ? 'Discard changes?' : 'Discard this obligation?',
      message: 'What you typed has not been saved.',
      confirmLabel: 'Discard',
    }),
  });
  return modal;
}
