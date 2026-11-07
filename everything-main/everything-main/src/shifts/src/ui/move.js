/**
 * Moving a shift: the one write behind dragging a chip across the week
 * grid, the "Move shift" dialog that gives keyboards and phones the same
 * reach, and the shared checks and feedback both go through.
 */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { addDays, formatDate, formatTimeRange } from '../lib/time.js';
import { evaluateMove } from '../core/scheduling.js';
import { openModal } from './modal.js';
import { toast, undoToast } from './toast.js';
import { employeeSelect, field, switchControl } from './components.js';

/** Who a target assignee id names, for messages. */
function assigneeLabel(state, assigneeId) {
  if (!assigneeId) return 'Open shift';
  return state.employees.find((e) => e.id === assigneeId)?.name ?? 'Former employee';
}

/** The context evaluateMove needs, straight off the live state. */
export function moveContext(state) {
  return {
    shifts: state.shifts,
    employees: state.employees,
    availability: state.availability,
    attendance: state.attendance,
  };
}

/**
 * Runs a proposed move or copy: refuses a true overlap, goes ahead with
 * anything softer and reports it, and hands back an undo either way.
 * Returns true when something was written.
 */
export async function applyMove(ctx, shift, target, { copy = false } = {}) {
  const { store } = ctx;
  const state = store.state;
  const verdict = evaluateMove(shift, target, moveContext(state), { copy });
  if (verdict.blocked) {
    toast(verdict.blocked, 'error');
    return false;
  }
  if (!verdict.changed) return false;

  try {
    const { undo } = copy
      ? await store.copyShift(shift.id, target)
      : await store.moveShift(shift.id, target);
    const where = `${formatDate(target.date)} · ${assigneeLabel(state, target.assigneeId)}`;
    // The warnings are whole sentences already, so the lead-in gets the
    // full stop the join can't add for it.
    undoToast(
      [`${copy ? 'Copied to' : 'Moved to'} ${where}.`, ...verdict.warnings].join(' '),
      undo
    );
    return true;
  } catch (err) {
    toast(err.message, 'error');
    return false;
  }
}

/**
 * Move or reassign one shift without dragging: the keyboard path from a
 * focused chip (M, or the context menu) and the only path on a phone,
 * where the week grid is a day list. Both halves of a drag are here as
 * plain fields, day and person, plus the copy that a modified drop makes.
 */
export function openMoveDialog(ctx, { shift }) {
  const { store } = ctx;
  const state = store.state;

  const dateInput = el('input', { class: 'input', type: 'date', value: shift.date });
  // Archived people are not offered here for the same reason the shift
  // editor leaves them out: they are off the rota. A shift already held
  // by one keeps them listed so the dialog cannot silently unassign it.
  const assignable = state.employees.filter((e) => e.active);
  const current = state.employees.find((e) => e.id === shift.assigneeId);
  if (current && !current.active) assignable.push(current);
  const assigneeSelect = employeeSelect(assignable, shift.assigneeId ?? '', {
    emptyLabel: 'Open shift (unassigned)',
  });
  if (shift.assigneeId && !current) {
    assigneeSelect.appendChild(
      el('option', { value: shift.assigneeId, selected: true }, 'Former employee')
    );
  }

  let copy = false;
  const notesBox = el('div', { style: { display: 'contents' } });
  const submit = el('button', { class: 'btn btn-primary' }, icon('move', 15), 'Move shift');

  const target = () => ({ date: dateInput.value, assigneeId: assigneeSelect.value || null });

  function refresh() {
    notesBox.replaceChildren();
    submit.replaceChildren(icon(copy ? 'copy' : 'move', 15), copy ? 'Copy shift' : 'Move shift');
    const verdict = evaluateMove(shift, target(), moveContext(state), { copy });
    submit.disabled = Boolean(verdict.blocked) || !verdict.changed;
    if (verdict.blocked) {
      // Red, not amber: everything else here is a warning the move goes
      // ahead with, and this is the one thing it will not do.
      notesBox.appendChild(
        el('div', { class: 'form-error' }, icon('circle-alert', 15), verdict.blocked)
      );
      return;
    }
    if (!verdict.changed) {
      notesBox.appendChild(
        el(
          'div',
          { class: 'form-note is-info' },
          icon('info', 15),
          'This is where the shift already sits.'
        )
      );
      return;
    }
    for (const warning of verdict.warnings) {
      notesBox.appendChild(el('div', { class: 'form-note' }, icon('warning', 15), warning));
    }
    if (verdict.warnings.length === 0) {
      notesBox.appendChild(
        el('div', { class: 'form-note is-ok' }, icon('circle-check', 15), 'No conflicts here.')
      );
    }
  }

  dateInput.addEventListener('change', refresh);
  assigneeSelect.addEventListener('change', refresh);
  refresh();

  submit.addEventListener('click', async () => {
    submit.disabled = true;
    const moved = await applyMove(ctx, shift, target(), { copy });
    if (moved) {
      modal.close();
      return;
    }
    // applyMove already said what went wrong in a toast; keep the dialog
    // open so the target can be corrected rather than re-opened.
    submit.disabled = false;
    refresh();
  });

  const modal = openModal({
    title: 'Move shift',
    content: [
      el(
        'p',
        { class: 'share-copy' },
        `${formatDate(shift.date)} · ${formatTimeRange(shift.start, shift.end)} · ${
          shift.role || 'No role'
        } · ${assigneeLabel(state, shift.assigneeId)}`
      ),
      el(
        'div',
        { class: 'form-grid' },
        el(
          'div',
          { class: 'span-2' },
          field('Day', dateInput),
          el(
            'div',
            { class: 'preset-row', style: { marginTop: '8px' } },
            [
              { label: 'Previous day', delta: -1 },
              { label: 'Next day', delta: 1 },
              { label: 'Next week', delta: 7 },
            ].map((p) =>
              el(
                'button',
                {
                  class: 'btn btn-sm',
                  onClick: () => {
                    dateInput.value = addDays(dateInput.value || shift.date, p.delta);
                    refresh();
                  },
                },
                p.label
              )
            )
          )
        ),
        el('div', { class: 'span-2' }, field('Assigned to', assigneeSelect))
      ),
      el(
        'div',
        { class: 'repeat-section' },
        el(
          'div',
          { class: 'repeat-head' },
          el('label', {}, 'Leave the original in place (copy)'),
          switchControl(
            false,
            (checked) => {
              copy = checked;
              refresh();
            },
            'Copy instead of moving'
          )
        )
      ),
      notesBox,
    ],
    footer: [
      el('span', { class: 'grow' }),
      el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'),
      submit,
    ],
  });

  return modal;
}
