/** Modal editors for shifts, employees, and swap requests. */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { openModal } from './modal.js';
import { openMoveDialog } from './move.js';
import { toast, undoToast } from './toast.js';
import {
  colorSwatches,
  employeeSelect,
  field,
  showFormError,
  suggestionList,
  switchControl,
} from './components.js';
import {
  availabilityStatus,
  findConflicts,
  shiftNetMinutes,
  suggestAssignees,
  timeOffOn,
  weeklyMinutes,
  AVAILABILITY,
} from '../core/scheduling.js';
import { evaluateSwap } from '../core/swaps.js';
import { hasRules, ruleViolations } from '../core/rules.js';
import { CURRENCIES } from '../core/payroll.js';
import { EMPLOYEE_COLORS, REPEAT_MAX_WEEKS } from '../core/store.js';
import { roleField } from './roles.js';
import {
  addDays,
  dayOfWeek,
  dayShort,
  formatDate,
  formatHours,
  formatTimeRange,
  isOvernight,
  isoToday,
  startOfWeek,
} from '../lib/time.js';

/** Monday-first order for day pickers; values are getDay() indices. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const AVAIL_LABEL = {
  [AVAILABILITY.AVAILABLE]: '',
  [AVAILABILITY.PARTIAL]: ' · partially available',
  [AVAILABILITY.UNAVAILABLE]: ' · unavailable',
};

function activeEmployees(state) {
  return state.employees.filter((e) => e.active);
}

function describeShift(state, shift) {
  const emp = state.employees.find((e) => e.id === shift.assigneeId);
  return `${formatDate(shift.date)} · ${formatTimeRange(shift.start, shift.end)} · ${
    shift.role || 'No role'
  }${emp ? ` · ${emp.name}` : ''}`;
}

/* ------------------------------------------------------------------ */
/* Shift editor                                                        */
/* ------------------------------------------------------------------ */

export function openShiftEditor(ctx, { shift = null, defaults = {} } = {}) {
  const { store } = ctx;
  const state = store.state;
  const editing = Boolean(shift);

  const values = {
    date: shift?.date ?? defaults.date ?? isoToday(),
    start: shift?.start ?? defaults.start ?? '09:00',
    end: shift?.end ?? defaults.end ?? '17:00',
    role: shift?.role ?? defaults.role ?? '',
    assigneeId: shift?.assigneeId ?? defaults.assigneeId ?? '',
    note: shift?.note ?? '',
    breakMinutes: shift?.breakMinutes || '',
  };

  const dateInput = el('input', { class: 'input', type: 'date', value: values.date });
  const startInput = el('input', { class: 'input', type: 'time', value: values.start });
  const endInput = el('input', { class: 'input', type: 'time', value: values.end });
  const breakInput = el('input', {
    class: 'input',
    type: 'number',
    min: '0',
    step: '5',
    value: values.breakMinutes,
    placeholder: 'None',
  });
  const roleControl = roleField(store, values.role);

  // Archived employees are not offered, but a shift already assigned to
  // one keeps its assignee listed; otherwise opening and saving the
  // editor would silently unassign them. Only a shift on record earns
  // that. A default naming an archived person would pre-select somebody
  // the store refuses to schedule, so it falls back to an open shift.
  const assignable = activeEmployees(state);
  const currentAssignee = state.employees.find((e) => e.id === values.assigneeId);
  if (editing && currentAssignee && !currentAssignee.active) assignable.push(currentAssignee);

  const describeAssignee = (emp) =>
    `${
      AVAIL_LABEL[
        availabilityStatus(
          { date: dateInput.value, start: startInput.value, end: endInput.value },
          state.availability[emp.id]
        )
      ]
    }${emp.active ? '' : ' · archived'}`;

  const assigneeSelect = employeeSelect(assignable, values.assigneeId, {
    emptyLabel: 'Open shift (unassigned)',
    describe: describeAssignee,
  });
  // A shift can belong to someone who was deleted (their worked shifts
  // keep the assignment for timesheets). Without an option carrying that
  // id, the select would fall back to "unassigned" and saving would
  // silently strip the record from every report.
  if (values.assigneeId && !currentAssignee) {
    assigneeSelect.appendChild(
      el('option', { value: values.assigneeId, selected: true }, 'Former employee')
    );
  }

  const noteInput = el('textarea', { class: 'textarea', value: values.note, placeholder: 'Optional note' });
  const warningsBox = el('div', { style: { display: 'contents' } });
  const suggestionsBox = el('div', { style: { display: 'contents' } });

  /** Top candidates for an unassigned shift, with one-tap assign. */
  function refreshSuggestions() {
    suggestionsBox.replaceChildren();
    const probe = currentShift();
    if (probe.assigneeId) return;
    const suggestions = suggestAssignees(probe, {
      employees: state.employees,
      shifts: state.shifts,
      availability: state.availability,
      rules: state.settings.rules,
    });
    if (suggestions.length === 0) return;
    suggestionsBox.appendChild(
      el(
        'div',
        { class: 'suggest-block' },
        el('label', {}, 'Suggestions'),
        suggestionList(suggestions, (s) => {
          assigneeSelect.value = s.employee.id;
          refreshAssigneeLabels();
          refreshWarnings();
          refreshSuggestions();
        })
      )
    );
  }

  /* Repeat weekly (new shifts only): weekday toggles plus an inclusive
     end date; individual shift records are materialized on save. */
  let repeatOn = false;
  const repeatDays = new Set();
  /**
   * Until the user touches the weekday toggles, the selection is only a
   * default read off the shift's own date, so it has to keep following
   * that date. Once they pick days themselves it is their choice and
   * stays put.
   */
  let repeatDaysPicked = false;
  const untilInput = el('input', { class: 'input', type: 'date' });
  const repeatSummary = el('p', { class: 'export-preview', style: { margin: '0' } });
  const dayToggles = el(
    'div',
    { class: 'day-toggles', role: 'group', 'aria-label': 'Repeat on' },
    DAY_ORDER.map((d) =>
      el(
        'button',
        {
          type: 'button',
          class: 'day-toggle',
          dataset: { day: String(d) },
          'aria-pressed': 'false',
          onClick: (e) => {
            repeatDaysPicked = true;
            if (repeatDays.has(d)) repeatDays.delete(d);
            else repeatDays.add(d);
            e.currentTarget.setAttribute('aria-pressed', String(repeatDays.has(d)));
            refreshRepeatSummary();
          },
        },
        dayShort(d)
      )
    )
  );
  const repeatBody = el(
    'div',
    { class: 'repeat-body', style: { display: 'none' } },
    el('div', { class: 'field' }, el('label', {}, 'Repeat on'), dayToggles),
    field('Until (inclusive)', untilInput),
    repeatSummary
  );

  /** Selects just the shift date's own weekday. No-op on a cleared date. */
  function seedRepeatDays() {
    const dow = dayOfWeek(dateInput.value);
    if (!Number.isInteger(dow)) return;
    repeatDays.clear();
    repeatDays.add(dow);
    for (const b of dayToggles.children) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.day) === dow));
    }
  }

  function syncRepeatBounds() {
    untilInput.min = dateInput.value;
    untilInput.max = addDays(dateInput.value, REPEAT_MAX_WEEKS * 7);
    if (!untilInput.value || untilInput.value < untilInput.min) {
      untilInput.value = addDays(dateInput.value, 28);
    }
    if (untilInput.value > untilInput.max) untilInput.value = untilInput.max;
  }

  function refreshRepeatSummary() {
    if (!repeatOn) return;
    if (repeatDays.size === 0) {
      repeatSummary.textContent = 'Pick at least one weekday.';
      return;
    }
    // The date inputs report '' when cleared; formatting that would
    // render garbage, so ask for the missing piece instead.
    if (!dateInput.value) {
      repeatSummary.textContent = 'Pick a shift date first.';
      return;
    }
    if (!untilInput.value) {
      repeatSummary.textContent = 'Pick an end date.';
      return;
    }
    let count = 0;
    for (let day = dateInput.value; day <= untilInput.value; day = addDays(day, 1)) {
      if (repeatDays.has(dayOfWeek(day))) count += 1;
    }
    repeatSummary.textContent = `Creates ${count} shift${count === 1 ? '' : 's'} through ${formatDate(untilInput.value)}. Each one is edited or deleted on its own afterwards.`;
  }

  const repeatSection = editing
    ? null
    : el(
        'div',
        { class: 'repeat-section' },
        el(
          'div',
          { class: 'repeat-head' },
          el('label', {}, 'Repeat weekly'),
          switchControl(
            false,
            (checked) => {
              repeatOn = checked;
              repeatBody.style.display = checked ? '' : 'none';
              if (checked) {
                if (!repeatDaysPicked) seedRepeatDays();
                syncRepeatBounds();
                refreshRepeatSummary();
              }
            },
            'Repeat weekly'
          )
        ),
        repeatBody
      );

  untilInput.addEventListener('change', refreshRepeatSummary);

  function currentShift() {
    return {
      id: shift?.id ?? '__new__',
      date: dateInput.value,
      start: startInput.value,
      end: endInput.value,
      role: roleControl.getValue(),
      assigneeId: assigneeSelect.value || null,
      note: noteInput.value,
      breakMinutes: breakInput.value,
    };
  }

  function refreshAssigneeLabels() {
    for (const option of assigneeSelect.options) {
      if (!option.value) continue;
      const emp = state.employees.find((e) => e.id === option.value);
      if (!emp) continue;
      option.textContent = `${emp.name}${describeAssignee(emp)}`;
    }
  }

  function refreshWarnings() {
    warningsBox.replaceChildren();
    const probe = currentShift();
    if (isOvernight(probe.start, probe.end)) {
      warningsBox.appendChild(
        el('div', { class: 'form-note is-info' }, icon('info', 15), 'This shift ends the next day.')
      );
    }
    const notes = [];
    if (probe.assigneeId) {
      if (findConflicts(probe, state.shifts).length > 0) {
        notes.push('This employee already has an overlapping shift that day.');
      }
      const record = state.availability[probe.assigneeId];
      const timeOff =
        timeOffOn(record, probe.date) ??
        (isOvernight(probe.start, probe.end) ? timeOffOn(record, addDays(probe.date, 1)) : null);
      if (timeOff) {
        notes.push(`This employee has time off then${timeOff.note ? ` (${timeOff.note})` : ''}.`);
      } else {
        const avail = availabilityStatus(probe, record);
        if (avail === AVAILABILITY.UNAVAILABLE) notes.push('This employee is marked unavailable at this time.');
        if (avail === AVAILABILITY.PARTIAL) notes.push('This shift only partially fits their availability.');
      }
      const emp = state.employees.find((e) => e.id === probe.assigneeId);
      if (emp?.maxHours != null) {
        const others = state.shifts.filter((s) => s.id !== probe.id);
        const projected =
          weeklyMinutes(others, emp.id, startOfWeek(probe.date)) + shiftNetMinutes(probe);
        if (projected > emp.maxHours * 60) {
          notes.push(`This puts ${emp.name} at ${formatHours(projected)} this week, over their ${emp.maxHours}h max.`);
        }
      }
      // Rest, daily hours, and consecutive days: warnings like the ones
      // above, never blockers (see core/rules.js).
      for (const violation of ruleViolations(probe, probe.assigneeId, state.shifts, state.settings.rules, {
        name: emp?.name ?? 'This employee',
      })) {
        notes.push(violation.message);
      }
    }
    // Attendance is keyed by shift, so it goes wherever this dialog sends
    // the shift: onto whoever it is reassigned to, whose timesheet then
    // pays out somebody else's clock times and carries their lateness,
    // or off every timesheet when the shift is left open. Dragging a chip
    // and reviewing a swap both say so before it happens; this is the
    // same warning for the same hazard on the path most edits take.
    if (editing && state.attendance[shift.id]) {
      const from = shift.assigneeId || null;
      const to = probe.assigneeId || null;
      if (to !== from || probe.date !== shift.date) {
        const emp = to ? state.employees.find((e) => e.id === to) : null;
        notes.push(
          to === from
            ? 'Attendance was already recorded for this shift.'
            : to
              ? `The attendance already recorded for this shift becomes ${emp?.name ?? 'the new assignee'}’s.`
              : 'Unassigning takes the attendance already recorded for this shift off the timesheet.'
        );
      }
    }
    for (const note of notes) {
      warningsBox.appendChild(el('div', { class: 'form-note' }, icon('warning', 15), note));
    }
  }

  for (const input of [dateInput, startInput, endInput, breakInput, assigneeSelect]) {
    input.addEventListener('change', () => {
      refreshAssigneeLabels();
      refreshWarnings();
      refreshSuggestions();
    });
  }
  roleControl.onChange(refreshSuggestions);
  dateInput.addEventListener('change', () => {
    if (!repeatOn) return;
    // Correcting the date after switching Repeat on used to leave the
    // weekday behind, so a shift moved to a Tuesday quietly went on
    // repeating every Thursday, and skipped its own day entirely.
    if (!repeatDaysPicked) seedRepeatDays();
    syncRepeatBounds();
    refreshRepeatSummary();
  });
  refreshWarnings();
  refreshSuggestions();

  const errorBox = el('div', { style: { display: 'contents' } });

  async function save(e) {
    errorBox.replaceChildren();
    const button = e.currentTarget;
    button.disabled = true;
    const data = currentShift();
    let message;
    try {
      if (editing) {
        await store.updateShift(shift.id, data);
        message = 'Shift updated';
      } else if (repeatOn) {
        delete data.id;
        // Which records the repeat adds, so the count below is of those
        // and not of every shift this person already held across the
        // span: "Created 12 shifts. 4 may need attention" reads as four
        // of those twelve.
        const before = new Set(state.shifts.map((s) => s.id));
        const { created, skipped } = await store.addRepeatingShifts(data, {
          weekdays: [...repeatDays],
          until: untilInput.value,
        });
        const parts = [`Created ${created} shift${created === 1 ? '' : 's'}`];
        if (skipped > 0) parts.push(`skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}`);
        // A run of shifts is exactly how a rest gap or a fortnight
        // without a day off gets built, and the warnings above only ever
        // described the first one. Count the whole run.
        let flagged = 0;
        if (data.assigneeId && hasRules(state.settings.rules)) {
          for (const shift of state.shifts) {
            if (before.has(shift.id)) continue;
            if (ruleViolations(shift, shift.assigneeId, state.shifts, state.settings.rules).length > 0) {
              flagged += 1;
            }
          }
        }
        message = `${parts.join(', ')}.${
          flagged > 0 ? ` ${flagged} may need attention.` : ''
        }`;
      } else {
        delete data.id;
        await store.addShift(data);
        message = 'Shift added';
      }
    } catch (err) {
      button.disabled = false;
      showFormError(errorBox, err.message);
      return;
    }
    // The shift is saved: close before the bookkeeping below, so a failure
    // there can't leave the dialog open over a saved shift and invite a
    // second submit. The label already lives on the record either way.
    modal.close();
    toast(message);
    store.ensureRole(data.role).catch((err) => console.error(err));
  }

  async function remove() {
    try {
      const undo = await store.deleteShift(shift.id);
      modal.close();
      undoToast('Shift deleted', undo);
    } catch (err) {
      showFormError(errorBox, err.message);
    }
  }

  const modal = openModal({
    title: editing ? 'Edit shift' : 'New shift',
    content: [
      el(
        'div',
        { class: 'form-grid' },
        el('div', { class: 'span-2' }, field('Date', dateInput)),
        field('Starts', startInput),
        field('Ends', endInput),
        el('div', { class: 'field' }, el('label', { for: roleControl.id }, 'Role / label'), roleControl.element),
        field('Unpaid break (min)', breakInput),
        el('div', { class: 'span-2' }, field('Assigned to', assigneeSelect)),
        el('div', { class: 'span-2' }, field('Note', noteInput))
      ),
      // On a laptop a shift is moved by dragging its chip across the
      // week grid. A phone shows a day list instead of that grid, and a
      // drag is not a gesture every pointer can make, so the same one
      // action lives here too: day and person, checked and undoable the
      // same way. It closes this dialog, so anything typed above and not
      // saved is dropped exactly as Cancel would drop it.
      editing
        ? el(
            'button',
            {
              class: 'btn btn-block',
              onClick: () => {
                modal.close();
                openMoveDialog(ctx, { shift });
              },
            },
            icon('move', 15),
            'Move to another day or person'
          )
        : null,
      suggestionsBox,
      repeatSection,
      warningsBox,
      errorBox,
    ],
    footer: [
      editing
        ? el(
            'button',
            {
              class: 'btn btn-danger btn-icon',
              'aria-label': 'Delete shift',
              title: 'Delete shift',
              onClick: remove,
            },
            icon('trash', 16)
          )
        : null,
      el('span', { class: 'grow' }),
      el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'),
      el('button', { class: 'btn btn-primary', onClick: save }, editing ? 'Save changes' : 'Add shift'),
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Employee editor                                                     */
/* ------------------------------------------------------------------ */

export function openEmployeeEditor(ctx, { employee = null } = {}) {
  const { store } = ctx;
  const editing = Boolean(employee);

  const nameInput = el('input', {
    class: 'input',
    type: 'text',
    value: employee?.name ?? '',
    placeholder: 'Full name',
  });
  const roleControl = roleField(store, employee?.role ?? '', { allowEmpty: true });
  const targetInput = el('input', {
    class: 'input',
    type: 'number',
    min: '0',
    max: '168',
    step: '0.5',
    value: employee?.targetHours ?? '',
    placeholder: 'Optional',
  });
  const maxInput = el('input', {
    class: 'input',
    type: 'number',
    min: '0',
    max: '168',
    step: '0.5',
    value: employee?.maxHours ?? '',
    placeholder: 'Optional',
  });
  const rateInput = el('input', {
    class: 'input',
    type: 'number',
    min: '0',
    step: '0.5',
    value: employee?.hourlyRate ?? '',
    placeholder: 'Optional',
  });
  // Contact details exist so a phone can act on them: the profile view
  // turns these into mailto:, tel:, and sms: links. Both optional, and
  // records saved before they existed simply have none.
  const emailInput = el('input', {
    class: 'input',
    type: 'email',
    autocomplete: 'off',
    value: employee?.email ?? '',
    placeholder: 'Optional',
  });
  const phoneInput = el('input', {
    class: 'input',
    type: 'tel',
    autocomplete: 'off',
    value: employee?.phone ?? '',
    placeholder: 'Optional',
  });

  /** "USD" -> "$", falling back to the code itself. */
  const currencySymbol = (code) => {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code })
        .formatToParts(0)
        .find((p) => p.type === 'currency').value;
    } catch {
      return code;
    }
  };
  const savedCurrency = store.state.settings.currency ?? 'USD';
  const currencySelect = el(
    'select',
    { class: 'select', 'aria-label': 'Currency for all rates' },
    CURRENCIES.map((code) =>
      el(
        'option',
        { value: code, selected: code === savedCurrency },
        `${code}${currencySymbol(code) !== code ? ` (${currencySymbol(code)})` : ''}`
      )
    )
  );

  let color = employee?.color ?? EMPLOYEE_COLORS[store.state.employees.length % EMPLOYEE_COLORS.length];
  const swatches = colorSwatches(EMPLOYEE_COLORS, color, (c) => (color = c), { ariaLabel: 'Color' });

  const errorBox = el('div', { style: { display: 'contents' } });

  async function save(e) {
    errorBox.replaceChildren();
    const button = e.currentTarget;
    button.disabled = true;
    const data = {
      name: nameInput.value,
      role: roleControl.getValue(),
      color,
      targetHours: targetInput.value,
      maxHours: maxInput.value,
      hourlyRate: rateInput.value,
      email: emailInput.value,
      phone: phoneInput.value,
    };
    try {
      if (editing) await store.updateEmployee(employee.id, data);
      else await store.addEmployee(data);
    } catch (err) {
      button.disabled = false;
      showFormError(errorBox, err.message);
      return;
    }
    // Saved: close first, so a failure in the follow-up writes can't leave
    // the dialog open over a saved employee and invite a duplicate.
    modal.close();
    toast(editing ? 'Employee updated' : 'Employee added');
    Promise.all([
      store.ensureRole(data.role),
      currencySelect.value !== savedCurrency
        ? store.updateSettings({ currency: currencySelect.value })
        : null,
    ]).catch((err) => {
      console.error(err);
      toast('Saved, but the role list and currency couldn’t be updated.', 'error');
    });
  }

  async function archive() {
    try {
      const undo = await store.archiveEmployee(employee.id);
      modal.close();
      undoToast(`${employee.name} archived`, undo);
    } catch (err) {
      showFormError(errorBox, err.message);
    }
  }

  async function restore() {
    try {
      await store.unarchiveEmployee(employee.id);
      modal.close();
      toast(`${employee.name} is back on the team`);
    } catch (err) {
      showFormError(errorBox, err.message);
    }
  }

  const modal = openModal({
    title: editing ? 'Edit employee' : 'Add employee',
    content: [
      field('Name', nameInput),
      el('div', { class: 'field' }, el('label', { for: roleControl.id }, 'Role'), roleControl.element),
      el(
        'div',
        { class: 'form-grid keep-2col' },
        field('Target hours / week', targetInput),
        field('Max hours / week', maxInput)
      ),
      el(
        'div',
        { class: 'form-grid keep-2col' },
        field('Hourly rate', rateInput),
        field('Currency (all rates)', currencySelect)
      ),
      el('div', { class: 'form-grid' }, field('Email', emailInput), field('Phone', phoneInput)),
      el('div', { class: 'field' }, el('label', {}, 'Color'), swatches),
      errorBox,
    ],
    footer: [
      editing
        ? employee.active
          ? el(
              'button',
              {
                class: 'btn btn-icon',
                'aria-label': `Archive ${employee.name}`,
                title: 'Archive: keeps history, frees upcoming shifts',
                onClick: archive,
              },
              icon('archive', 16)
            )
          : el(
              'button',
              { class: 'btn', title: 'Bring them back into scheduling', onClick: restore },
              icon('archive-restore', 15),
              'Restore'
            )
        : null,
      el('span', { class: 'grow' }),
      el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'),
      el('button', { class: 'btn btn-primary', onClick: save }, editing ? 'Save changes' : 'Add employee'),
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Swap request editor                                                 */
/* ------------------------------------------------------------------ */

export function openSwapEditor(ctx, { shift = null } = {}) {
  const { store } = ctx;
  const state = store.state;
  const today = isoToday();

  const pendingShiftIds = new Set(
    state.swaps.filter((s) => s.status === 'pending').map((s) => s.shiftId)
  );
  const candidates = state.shifts
    .filter((s) => s.assigneeId && s.date >= today && !pendingShiftIds.has(s.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));

  // Same order the Swaps view reports these in, so the two never
  // disagree about which piece is actually missing.
  if (activeEmployees(state).length < 2) {
    toast('Swaps need at least two employees. Add another person first.', 'error');
    return;
  }
  if (candidates.length === 0) {
    toast('No upcoming assigned shifts are eligible for a swap.', 'error');
    return;
  }

  const shiftSelect = el(
    'select',
    { class: 'select' },
    candidates.map((s) =>
      el('option', { value: s.id, selected: shift?.id === s.id }, describeShift(state, s))
    )
  );

  const toSelect = el('select', { class: 'select' });
  const reasonInput = el('textarea', { class: 'textarea', placeholder: 'Why is this swap needed? (optional)' });
  const warningsBox = el('div', { style: { display: 'contents' } });

  function selectedShift() {
    return state.shifts.find((s) => s.id === shiftSelect.value);
  }

  function refreshTargets() {
    const current = selectedShift();
    const previous = toSelect.value;
    toSelect.replaceChildren();
    for (const emp of activeEmployees(state).filter((e) => e.id !== current.assigneeId)) {
      const status = availabilityStatus(current, state.availability[emp.id]);
      toSelect.appendChild(
        el('option', { value: emp.id, selected: emp.id === previous }, `${emp.name}${AVAIL_LABEL[status]}`)
      );
    }
  }

  function refreshWarnings() {
    warningsBox.replaceChildren();
    const current = selectedShift();
    if (!current || !toSelect.value) return;
    const { ok, warnings } = evaluateSwap({
      shift: current,
      toEmployeeId: toSelect.value,
      shifts: state.shifts,
      availability: state.availability,
      employees: state.employees,
      attendance: state.attendance,
      rules: state.settings.rules,
    });
    if (ok) {
      warningsBox.appendChild(
        el('div', { class: 'form-note is-ok' }, icon('circle-check', 15), 'No conflicts. This swap looks clean.')
      );
    } else {
      for (const warning of warnings) {
        warningsBox.appendChild(el('div', { class: 'form-note' }, icon('warning', 15), warning));
      }
    }
  }

  shiftSelect.addEventListener('change', () => {
    refreshTargets();
    refreshWarnings();
  });
  toSelect.addEventListener('change', refreshWarnings);
  refreshTargets();
  refreshWarnings();

  const errorBox = el('div', { style: { display: 'contents' } });

  async function save(e) {
    errorBox.replaceChildren();
    const button = e.currentTarget;
    button.disabled = true;
    try {
      await store.requestSwap({
        shiftId: shiftSelect.value,
        toEmployeeId: toSelect.value,
        reason: reasonInput.value,
      });
      toast('Swap request created');
      modal.close();
    } catch (err) {
      button.disabled = false;
      showFormError(errorBox, err.message);
    }
  }

  const modal = openModal({
    title: 'New swap request',
    content: [
      field('Shift', shiftSelect),
      field('Give the shift to', toSelect),
      field('Reason', reasonInput),
      warningsBox,
      errorBox,
    ],
    footer: [
      el('span', { class: 'grow' }),
      el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'),
      el('button', { class: 'btn btn-primary', onClick: save }, 'Create request'),
    ],
  });
}
