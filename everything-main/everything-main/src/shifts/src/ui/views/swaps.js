import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { formatDate, formatTimeRange, isoToday } from '../../lib/time.js';
import { evaluateSwap, pendingSwaps, SWAP_STATUS } from '../../core/swaps.js';
import { avatar, emptyState, swapStatusBadge } from '../components.js';
import { openSwapEditor } from '../editors.js';
import { toast } from '../toast.js';

export function renderSwaps(ctx) {
  const { store } = ctx;
  const state = store.state;
  const employeeById = (id) => state.employees.find((e) => e.id === id);
  // Swap history outlives the people in it: deleting somebody keeps the
  // requests they were part of. "Former employee" is what the schedule,
  // the timesheet, and the reports call that person, and one word for it
  // beats three.
  const nameOf = (employee) => employee?.name ?? 'Former employee';

  const pending = pendingSwaps(state.swaps).sort((a, b) =>
    a.shiftSnapshot.date.localeCompare(b.shiftSnapshot.date)
  );
  const history = state.swaps
    .filter((s) => s.status !== SWAP_STATUS.PENDING)
    .sort((a, b) => String(b.resolvedAt).localeCompare(String(a.resolvedAt)));

  /**
   * What is still missing before a request can be made at all, matching
   * the checks openSwapEditor turns a request down on. Offering "New
   * request" as the empty state's one call to action was a dead end on
   * a new account: there is nothing to give away yet, so the button had
   * nothing to do but refuse. Name the missing piece and point at it.
   *
   * The last case has nowhere to point: every shift that could be given
   * away is already out for review, which the list on screen shows.
   */
  const today = isoToday();
  const pendingShiftIds = new Set(pending.map((s) => s.shiftId));
  const upcomingAssigned = state.shifts.filter((s) => s.assigneeId && s.date >= today);
  const blocker =
    state.employees.filter((e) => e.active).length < 2
      ? {
          message: 'A swap hands a shift from one person to another, so the team needs at least two people.',
          label: 'Go to Team',
          route: 'team',
        }
      : upcomingAssigned.length === 0
        ? {
            message: 'A swap needs an upcoming shift that is already assigned to someone. Schedule one first.',
            label: 'Go to Schedule',
            route: 'schedule',
          }
        : upcomingAssigned.every((s) => pendingShiftIds.has(s.id))
          ? { message: 'Every upcoming assigned shift already has a request waiting for review.' }
          : null;

  async function act(action, successMessage) {
    try {
      await action();
      toast(successMessage);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function pendingCard(swap) {
    const from = employeeById(swap.fromEmployeeId);
    const to = employeeById(swap.toEmployeeId);
    const shift = state.shifts.find((s) => s.id === swap.shiftId);
    // Approving acts on the shift as it is now, so show the live details;
    // the snapshot only stands in when the shift has been deleted.
    const snap = shift ?? swap.shiftSnapshot;
    const evaluation = shift
      ? evaluateSwap({
          shift,
          toEmployeeId: swap.toEmployeeId,
          shifts: state.shifts,
          availability: state.availability,
          employees: state.employees,
          attendance: state.attendance,
          rules: state.settings.rules,
        })
      : { ok: false, warnings: ['The shift in this request no longer exists.'] };

    return el(
      'div',
      { class: 'card swap-card' },
      el(
        'div',
        { class: 'swap-route' },
        el('span', { class: 'who' }, avatar(from, 'avatar-sm'), nameOf(from)),
        el('span', { class: 'arrow' }, icon('arrow-right', 15)),
        el('span', { class: 'who' }, avatar(to, 'avatar-sm'), nameOf(to)),
        el('span', { style: { flex: '1' } }),
        swapStatusBadge(swap.status)
      ),
      el(
        'div',
        { class: 'swap-shift' },
        `${formatDate(snap.date)} · ${formatTimeRange(snap.start, snap.end)} · ${snap.role || 'No role'}`
      ),
      swap.reason ? el('div', { class: 'swap-reason' }, `“${swap.reason}”`) : null,
      evaluation.warnings.length
        ? el(
            'div',
            { class: 'swap-warnings' },
            evaluation.warnings.map((w) =>
              el('div', { class: 'swap-warning' }, icon('warning', 14), w)
            )
          )
        : null,
      el(
        'div',
        { class: 'swap-foot' },
        el('span', { class: 'swap-meta' }, 'Approving reassigns the shift.'),
        el(
          'div',
          { class: 'item-actions' },
          el(
            'button',
            { class: 'btn btn-sm', onClick: () => act(() => store.cancelSwap(swap.id), 'Request cancelled') },
            'Cancel'
          ),
          el(
            'button',
            {
              class: 'btn btn-sm btn-danger',
              onClick: () => act(() => store.declineSwap(swap.id), 'Request declined'),
            },
            'Decline'
          ),
          el(
            'button',
            {
              class: 'btn btn-sm btn-primary',
              disabled: !shift,
              onClick: () => act(() => store.approveSwap(swap.id), 'Swap approved and shift reassigned'),
            },
            icon('check', 14),
            'Approve'
          )
        )
      )
    );
  }

  function historyRow(swap) {
    const from = employeeById(swap.fromEmployeeId);
    const to = employeeById(swap.toEmployeeId);
    const snap = swap.shiftSnapshot;
    return el(
      'div',
      { class: 'item-row' },
      avatar(from),
      el(
        'div',
        { class: 'item-main' },
        el('div', { class: 'item-title' }, `${nameOf(from)} → ${nameOf(to)}`),
        el(
          'div',
          { class: 'item-sub tnum' },
          `${formatDate(snap.date)} · ${formatTimeRange(snap.start, snap.end)} · ${snap.role || 'No role'}`
        )
      ),
      el('div', { class: 'item-actions' }, swapStatusBadge(swap.status))
    );
  }

  return el(
    'div',
    {},
    el(
      'div',
      { class: 'view-header' },
      el(
        'div',
        {},
        el('h1', {}, 'Shift swaps'),
        el('p', { class: 'subtitle' }, pending.length ? `${pending.length} awaiting review` : 'No pending requests')
      ),
      el(
        'div',
        { class: 'view-actions' },
        el(
          'button',
          {
            class: 'btn btn-primary',
            // The empty state below already refuses to offer a request it
            // knows cannot be made; this button sat right above it doing
            // the opposite, and pressing it only produced an error toast.
            disabled: Boolean(blocker),
            title: blocker?.message ?? null,
            onClick: () => openSwapEditor(ctx),
          },
          icon('plus', 16),
          'New request'
        )
      )
    ),
    pending.length === 0
      ? el(
          'div',
          { class: 'card', style: { marginBottom: '20px' } },
          emptyState({
            iconName: 'arrow-left-right',
            title: 'No pending requests',
            message:
              blocker?.message ??
              'When someone needs to give away a shift, create a request here and review it before the schedule changes.',
            actions: blocker
              ? blocker.route
                ? [
                    el(
                      'button',
                      { class: 'btn btn-primary', onClick: () => ctx.navigate(blocker.route) },
                      blocker.label
                    ),
                  ]
                : []
              : [
                  el(
                    'button',
                    { class: 'btn btn-primary', onClick: () => openSwapEditor(ctx) },
                    icon('plus', 16),
                    'New request'
                  ),
                ],
          })
        )
      : el(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '4px' } },
          pending.map(pendingCard)
        ),
    history.length > 0
      ? el(
          'div',
          {},
          el('h2', { class: 'section-title' }, 'History'),
          el('div', { class: 'card row-list' }, history.slice(0, 20).map(historyRow))
        )
      : null
  );
}
