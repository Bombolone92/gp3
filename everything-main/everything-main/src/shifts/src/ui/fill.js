/**
 * "Fill open shifts": one proposal per open shift in the visible week,
 * reviewed as a list and written as a single undoable action.
 */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { formatDate, formatTimeRange, weekDates } from '../lib/time.js';
import { fillAssignments, fillSummary, planFill } from '../core/fill.js';
import { openModal } from './modal.js';
import { avatar, emptyState } from './components.js';
import { toast, undoToast } from './toast.js';

/** "11 shifts filled, 3 left open, nobody free" */
export function describeFill({ filling, skipped, nobody }) {
  const parts = [];
  parts.push(`${filling} shift${filling === 1 ? '' : 's'} filled`);
  if (nobody > 0) parts.push(`${nobody} left open, nobody free`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  return parts.join(', ');
}

/**
 * The review list. Each row carries its own picker: the ranked
 * candidates for that shift plus "Leave open". Changing one row pins it
 * and re-derives every untouched row after it, so the totals below
 * always describe what the button will actually write.
 */
export function openFillDialog(ctx, weekStart) {
  const { store } = ctx;
  const dates = weekDates(weekStart);
  /** shiftId -> employee id, or null to leave the shift open. */
  const choices = {};

  const listBox = el('div', { style: { display: 'contents' } });
  const summaryLine = el('p', { class: 'export-preview' });
  const submit = el('button', { class: 'btn btn-primary' }, icon('user-plus', 15), 'Fill shifts');
  const cancel = el('button', { class: 'btn' }, 'Cancel');
  let plan = [];

  function row(entry) {
    const { shift, candidates, proposal } = entry;
    const select = el(
      'select',
      {
        class: 'select',
        'aria-label': `Who works ${formatDate(shift.date)} ${formatTimeRange(shift.start, shift.end)}`,
        dataset: { shiftId: shift.id },
        onChange: (e) => {
          choices[shift.id] = e.target.value || null;
          // Every pick re-derives the rows below it, which rebuilds this
          // control; hand focus back to it so a keyboard user is not
          // dropped out of the list on every choice.
          refresh({ focus: shift.id });
        },
      },
      candidates.map((c) =>
        el(
          'option',
          { value: c.employee.id, selected: proposal?.employee.id === c.employee.id },
          c.employee.name
        )
      ),
      el('option', { value: '', selected: !proposal }, 'Leave open')
    );
    if (candidates.length === 0) select.disabled = true;

    const why = entry.skipped
      ? 'Left open on purpose.'
      : entry.stale
        ? 'That person is no longer free once the rows above are applied.'
        : proposal
          ? proposal.reasons.join(' · ')
          : 'Nobody is a clean fit: everyone is off, booked, or would go over their max hours.';

    return el(
      'div',
      { class: `fill-row${proposal ? '' : ' is-open'}` },
      el(
        'div',
        { class: 'fill-shift' },
        el('div', { class: 'fill-when tnum' }, `${formatDate(shift.date)} · ${formatTimeRange(shift.start, shift.end)}`),
        el(
          'div',
          { class: 'fill-role' },
          shift.role || 'No role',
          shift.breakMinutes > 0 ? ` · ${shift.breakMinutes}m break` : ''
        )
      ),
      el(
        'div',
        { class: 'fill-pick' },
        el(
          'div',
          { class: 'fill-pick-row' },
          proposal ? avatar(proposal.employee, 'avatar-sm') : icon('user', 15),
          select
        ),
        el('div', { class: 'fill-why' }, why)
      )
    );
  }

  function refresh({ focus = null } = {}) {
    plan = planFill(store.state, dates, { choices });
    const counts = fillSummary(plan);
    listBox.replaceChildren(el('div', { class: 'fill-list' }, plan.map(row)));
    if (focus) {
      for (const select of listBox.querySelectorAll('select')) {
        if (select.dataset.shiftId === focus) {
          select.focus();
          break;
        }
      }
    }
    summaryLine.textContent = `${describeFill(counts)}. Nothing is written until you press the button.`;
    submit.disabled = counts.filling === 0;
    submit.replaceChildren(
      icon('user-plus', 15),
      counts.filling === 0 ? 'Nothing to fill' : `Fill ${counts.filling} shift${counts.filling === 1 ? '' : 's'}`
    );
  }

  refresh();

  if (plan.length === 0) {
    const empty = openModal({
      title: 'Fill open shifts',
      content: emptyState({
        iconName: 'calendar',
        title: 'No open shifts this week',
        message: 'Every shift on screen already has someone on it.',
      }),
      footer: [
        el('span', { class: 'grow' }),
        el('button', { class: 'btn btn-primary', onClick: () => empty.close() }, 'Close'),
      ],
    });
    return empty;
  }

  submit.addEventListener('click', async () => {
    const assignments = fillAssignments(plan);
    if (assignments.length === 0) return;
    // One press, one write: lock the whole dialog rather than the button
    // alone, so a slow connection cannot take a second press.
    const controls = [...modal.body.querySelectorAll('button, select'), submit, cancel];
    for (const c of controls) c.disabled = true;
    const counts = fillSummary(plan);
    try {
      const { undo } = await store.assignShifts(assignments);
      modal.close();
      undoToast(describeFill(counts), undo);
    } catch (err) {
      for (const c of controls) c.disabled = false;
      toast(err.message, 'error');
      refresh();
    }
  });

  const modal = openModal({
    title: 'Fill open shifts',
    content: [
      el(
        'p',
        { class: 'share-copy' },
        `${formatDate(dates[0])} – ${formatDate(dates[6])}. Each proposal is worked out with the ones above it already in place, so nobody is double-booked or pushed past their maximum. Swap anyone out, or leave a shift open.`
      ),
      listBox,
      summaryLine,
    ],
    footer: [
      el('span', { class: 'grow' }),
      cancel,
      submit,
    ],
  });
  cancel.addEventListener('click', () => modal.close());

  return modal;
}
