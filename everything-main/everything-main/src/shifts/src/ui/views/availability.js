import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { dayName, formatDate, isValidTime, isoToday } from '../../lib/time.js';
import { defaultAvailability } from '../../core/scheduling.js';
import { avatar, emptyState, field, showFormError, switchControl } from '../components.js';
import { openModal } from '../modal.js';
import { toast, undoToast } from '../toast.js';

/** Week rows are shown Monday-first; data stays indexed 0 = Sunday. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function openTimeOffEditor(ctx, employee) {
  const { store } = ctx;
  const today = isoToday();
  const fromInput = el('input', { class: 'input', type: 'date', value: today });
  const toInput = el('input', { class: 'input', type: 'date', value: today });
  const noteInput = el('input', { class: 'input', type: 'text', placeholder: 'e.g. Vacation, appointment' });
  const errorBox = el('div', { style: { display: 'contents' } });

  // Keep the range valid as dates change: moving "from" past "to" drags "to" along.
  fromInput.addEventListener('change', () => {
    if (toInput.value < fromInput.value) toInput.value = fromInput.value;
  });

  const modal = openModal({
    title: `Time off for ${employee.name}`,
    content: [
      el('div', { class: 'form-grid keep-2col' }, field('First day', fromInput), field('Last day', toInput)),
      field('Note', noteInput),
      errorBox,
    ],
    footer: [
      el('span', { class: 'grow' }),
      el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'),
      el(
        'button',
        {
          class: 'btn btn-primary',
          onClick: async (e) => {
            errorBox.replaceChildren();
            const button = e.currentTarget;
            button.disabled = true;
            try {
              await store.addTimeOff(employee.id, {
                from: fromInput.value,
                to: toInput.value,
                note: noteInput.value,
              });
              toast('Time off added');
              modal.close();
            } catch (err) {
              button.disabled = false;
              showFormError(errorBox, err.message);
            }
          },
        },
        'Add time off'
      ),
    ],
  });
}

export function renderAvailability(ctx) {
  const { store, ui } = ctx;
  const state = store.state;
  const today = isoToday();
  // Archived people are off the rota, so the picker does not offer them.
  // Archiving keeps their availability and time off all the same (the
  // team list says as much) and their own page still links here, so the
  // one this view was opened for stays listed. Without them the picker
  // fell back to whoever happened to be first and quietly edited that
  // person instead: the address bar said Theo and every switch flipped
  // and time typed went to Ava.
  const roster = state.employees.filter((e) => e.active);
  const routed = state.employees.find((e) => e.id === ui.availabilityEmp);
  const employees = routed && !routed.active ? [...roster, routed] : roster;

  if (employees.length === 0) {
    return el(
      'div',
      {},
      el('div', { class: 'view-header' }, el('div', {}, el('h1', {}, 'Availability'))),
      el(
        'div',
        { class: 'card' },
        emptyState({
          iconName: 'clock',
          title: 'No employees yet',
          message: 'Add employees to manage their weekly availability.',
          actions: [el('button', { class: 'btn btn-primary', onClick: () => ctx.navigate('team') }, 'Go to Team')],
        })
      )
    );
  }

  const selectedId = employees.some((e) => e.id === ui.availabilityEmp)
    ? ui.availabilityEmp
    : employees[0].id;
  ui.availabilityEmp = selectedId;
  const selected = employees.find((e) => e.id === selectedId);
  const availability = state.availability[selectedId] ?? defaultAvailability();

  async function saveDay(dayIndex, patch) {
    const base = availability.days ?? defaultAvailability().days;
    const days = base.map((d, i) => (i === dayIndex ? { ...d, ...patch } : { ...d }));
    const day = days[dayIndex];
    // A cleared time input reports '', which would otherwise slip past the
    // order check below and persist a window the checks can't interpret.
    if (!day.off && (!isValidTime(day.start) || !isValidTime(day.end))) {
      toast('Enter both a start and an end time.', 'error');
      ctx.refresh();
      return;
    }
    if (!day.off && day.start >= day.end) {
      toast('End time must be after start time.', 'error');
      ctx.refresh();
      return;
    }
    try {
      await store.setAvailability(selectedId, days);
      toast(`${selected.name}’s availability updated`);
    } catch (err) {
      toast(err.message, 'error');
      ctx.refresh();
    }
  }

  const picker = el(
    'div',
    { class: 'emp-picker', role: 'group', 'aria-label': 'Employee' },
    employees.map((emp) =>
      el(
        'button',
        {
          class: 'emp-pill',
          'aria-pressed': String(emp.id === selectedId),
          dataset: { focusKey: `avail:emp:${emp.id}` },
          // Navigate rather than set ui state: the router re-applies the
          // #/availability/<id> hash param on every render, which would
          // immediately override a plain ui.availabilityEmp change.
          onClick: () => ctx.navigate(`availability/${emp.id}`),
        },
        avatar(emp, 'avatar-sm'),
        emp.active ? emp.name : `${emp.name} · archived`
      )
    )
  );

  // An archived person is only ever on screen here because their own
  // page sent the manager, so say why the rota has no room for them
  // rather than showing a week that looks live.
  const archivedNote = selected.active
    ? null
    : el(
        'div',
        { class: 'form-note is-info', style: { marginBottom: '10px' } },
        icon('info', 15),
        `${selected.name} is archived, so nothing is scheduled for them. This pattern is kept for the day they come back.`
      );

  const days = availability.days ?? defaultAvailability().days;
  const rows = el(
    'div',
    { class: 'card row-list' },
    DAY_ORDER.map((dayIndex) => {
      const day = days[dayIndex] ?? { off: false, start: '09:00', end: '17:00' };
      return el(
        'div',
        { class: 'avail-row' },
        el('span', { class: 'day' }, dayName(dayIndex)),
        // Every edit here saves and re-renders the view, so each control
        // is tagged to get focus handed back (see render() in app.js).
        switchControl(
          !day.off,
          (checked) => saveDay(dayIndex, { off: !checked }),
          `Available on ${dayName(dayIndex)}`,
          { focusKey: `avail:${dayIndex}:on` }
        ),
        day.off
          ? el('span', { class: 'off-note' }, 'Unavailable')
          : el(
              'div',
              { class: 'times' },
              el('input', {
                class: 'input',
                type: 'time',
                value: day.start,
                'aria-label': `${dayName(dayIndex)} from`,
                dataset: { focusKey: `avail:${dayIndex}:start` },
                onChange: (e) => saveDay(dayIndex, { start: e.target.value }),
              }),
              el('span', { class: 'sep' }, 'to'),
              el('input', {
                class: 'input',
                type: 'time',
                value: day.end,
                'aria-label': `${dayName(dayIndex)} until`,
                dataset: { focusKey: `avail:${dayIndex}:end` },
                onChange: (e) => saveDay(dayIndex, { end: e.target.value }),
              })
            )
      );
    })
  );

  const entries = [...(availability.exceptions ?? [])].sort((a, b) => b.from.localeCompare(a.from));
  const timeOff = el(
    'div',
    {},
    el(
      'div',
      { class: 'section-bar' },
      el('h2', { class: 'section-title' }, 'Time off'),
      el(
        'button',
        { class: 'btn btn-sm', onClick: () => openTimeOffEditor(ctx, selected) },
        icon('plus', 14),
        'Add time off'
      )
    ),
    entries.length === 0
      ? el(
          'div',
          { class: 'card' },
          emptyState({
            iconName: 'calendar',
            title: 'No time off planned',
            message: `Vacations and other days away override ${selected.name}’s weekly availability.`,
          })
        )
      : el(
          'div',
          { class: 'card row-list' },
          entries.map((entry) =>
            el(
              'div',
              { class: `item-row${entry.to < today ? ' row-muted' : ''}` },
              el(
                'div',
                { class: 'item-main' },
                el(
                  'div',
                  { class: 'item-title tnum' },
                  entry.from === entry.to ? formatDate(entry.from) : `${formatDate(entry.from)} – ${formatDate(entry.to)}`
                ),
                el('div', { class: 'item-sub' }, entry.note || 'Time off')
              ),
              el(
                'div',
                { class: 'item-actions' },
                entry.to < today ? el('span', { class: 'badge' }, 'Past') : null,
                el(
                  'button',
                  {
                    class: 'btn btn-ghost btn-sm btn-icon',
                    'aria-label': 'Remove time off',
                    title: 'Remove time off',
                    onClick: async () => {
                      try {
                        const undo = await store.removeTimeOff(selectedId, entry.id);
                        undoToast('Time off removed', undo);
                      } catch (err) {
                        toast(err.message, 'error');
                      }
                    },
                  },
                  icon('trash', 15)
                )
              )
            )
          )
        )
  );

  return el(
    'div',
    {},
    el(
      'div',
      { class: 'view-header' },
      el(
        'div',
        {},
        el('h1', {}, 'Availability'),
        el('p', { class: 'subtitle' }, 'Weekly windows when each person can be scheduled. Changes save automatically.')
      )
    ),
    picker,
    archivedNote,
    rows,
    timeOff
  );
}
