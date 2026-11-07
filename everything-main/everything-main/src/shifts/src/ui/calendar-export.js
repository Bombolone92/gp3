/**
 * Calendar (.ics) export dialog: pick a range (with presets) and an
 * optional employee, preview what it contains, download a static file.
 */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { downloadTextFile } from '../lib/download.js';
import { addDays, isoToday, startOfWeek } from '../lib/time.js';
import { buildScheduleICS } from '../core/ics.js';
import { employeeSelect, field, showFormError } from './components.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';

/** `employeeId` preselects one person, for the export on their profile. */
export function openCalendarExportDialog(ctx, { employeeId = '' } = {}) {
  const { store } = ctx;
  const today = isoToday();
  const week = startOfWeek(today);

  const fromInput = el('input', { class: 'input', type: 'date', value: week });
  const toInput = el('input', { class: 'input', type: 'date', value: addDays(week, 6) });
  // Archived people are not offered here, for the same reason the shift
  // editor leaves them out. The one exception is a person this dialog was
  // opened for: their profile still offers the export, and without an
  // option carrying their id the select would fall back to "Everyone" and
  // quietly hand over the whole team's calendar instead of theirs.
  const offered = store.state.employees.filter((e) => e.active);
  const requested = store.state.employees.find((e) => e.id === employeeId);
  if (requested && !requested.active) offered.push(requested);
  const whoSelect = employeeSelect(offered, employeeId, {
    emptyLabel: 'Everyone',
    describe: (emp) => (emp.active ? '' : ' · archived'),
  });
  const preview = el('p', { class: 'export-preview' });
  const errorBox = el('div', { style: { display: 'contents' } });

  const PRESETS = [
    { label: 'This week', from: week, to: addDays(week, 6) },
    { label: 'Next 4 weeks', from: week, to: addDays(week, 27) },
  ];

  function currentOptions() {
    return {
      from: fromInput.value,
      to: toInput.value,
      employeeId: whoSelect.value || null,
    };
  }

  /** A date input reports '' when cleared, which is not a bound at all. */
  const validRange = () =>
    Boolean(fromInput.value && toInput.value && toInput.value >= fromInput.value);

  function refreshPreview() {
    errorBox.replaceChildren();
    // Count only what the download would actually accept. An open-ended
    // range totals up every shift on record, and a backwards one reads
    // as an empty week rather than a range entered the wrong way round.
    if (!validRange()) {
      preview.textContent = 'Pick a valid date range.';
      return;
    }
    const { count } = buildScheduleICS(store.state, currentOptions());
    preview.textContent =
      count === 0
        ? 'No assigned shifts in this range.'
        : `${count} shift${count === 1 ? '' : 's'} become calendar events. Re-importing a newer export updates them instead of duplicating.`;
  }

  for (const input of [fromInput, toInput, whoSelect]) {
    input.addEventListener('change', refreshPreview);
  }
  refreshPreview();

  const modal = openModal({
    title: 'Export to calendar',
    content: [
      el(
        'div',
        { class: 'preset-row' },
        PRESETS.map((p) =>
          el(
            'button',
            {
              class: 'btn btn-sm',
              onClick: () => {
                fromInput.value = p.from;
                toInput.value = p.to;
                refreshPreview();
              },
            },
            p.label
          )
        )
      ),
      el('div', { class: 'form-grid keep-2col' }, field('From', fromInput), field('Until', toInput)),
      field('Whose shifts', whoSelect),
      preview,
      errorBox,
    ],
    footer: [
      el('span', { class: 'grow' }),
      el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'),
      el(
        'button',
        {
          class: 'btn btn-primary',
          onClick: () => {
            const options = currentOptions();
            if (!validRange()) {
              showFormError(errorBox, 'Pick a valid date range.');
              return;
            }
            const { ics, count } = buildScheduleICS(store.state, options);
            if (count === 0) {
              showFormError(errorBox, 'There are no assigned shifts in this range.');
              return;
            }
            downloadTextFile(`shifts-${options.from}_${options.to}.ics`, ics, 'text/calendar');
            toast('Calendar file downloaded');
            modal.close();
          },
        },
        icon('download', 15),
        'Download .ics'
      ),
    ],
  });
}
