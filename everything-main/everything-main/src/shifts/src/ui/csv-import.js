/**
 * Importing a team and a schedule from a spreadsheet: pick the file,
 * confirm which column is which, look at what it would create, then add
 * it. Additive throughout, and never confusable with the JSON restore,
 * which replaces everything.
 */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { formatDate, formatTimeRange } from '../lib/time.js';
import { parseCSVTable } from '../core/csv.js';
import {
  EMPLOYEE_FIELDS,
  SHIFT_FIELDS,
  describeImport,
  detectMapping,
  parseNameList,
  planEmployeeImport,
  planShiftImport,
} from '../core/import.js';
import { openModal } from './modal.js';
import { field, segmented, showFormError, switchControl } from './components.js';
import { undoToast } from './toast.js';

const KINDS = {
  employees: {
    title: 'Import employees',
    fields: EMPLOYEE_FIELDS,
    noun: 'employee',
    blurb:
      'One row per person. Everything except the name is optional, and nothing already in Shifts is touched.',
  },
  shifts: {
    title: 'Import shifts',
    fields: SHIFT_FIELDS,
    noun: 'shift',
    blurb:
      'One row per shift. Rows that cannot be read are listed and skipped; the rest still come in.',
  },
};

/** "Line 4: no date in this row." */
function problemRow(entry) {
  return el(
    'div',
    { class: 'import-problem' },
    el('span', { class: 'import-line' }, `Line ${entry.line}`),
    el('span', {}, entry.problems.join(' '))
  );
}

function previewRow(kind, entry) {
  if (kind === 'employees') {
    const bits = [
      entry.data.role || 'No role',
      entry.data.email || null,
      entry.data.phone || null,
      entry.data.hourlyRate != null ? `${entry.data.hourlyRate}/h` : null,
    ].filter(Boolean);
    return el(
      'div',
      { class: 'import-row' },
      el('span', { class: 'import-row-main' }, entry.data.name),
      el('span', { class: 'import-row-sub' }, bits.join(' · '))
    );
  }
  const who =
    entry.assignee === null
      ? 'Open shift'
      : entry.assignee.kind === 'existing'
        ? entry.assignee.name
        : entry.assignee.kind === 'new'
          ? `${entry.assignee.name} (new)`
          : entry.assignee.kind === 'archived'
            ? `Open shift (${entry.assignee.name} is archived)`
            : `Open shift (${entry.assignee.name} is not on the team)`;
  return el(
    'div',
    { class: 'import-row' },
    el(
      'span',
      { class: 'import-row-main tnum' },
      `${formatDate(entry.data.date)} · ${formatTimeRange(entry.data.start, entry.data.end)}`
    ),
    el(
      'span',
      { class: 'import-row-sub' },
      [entry.data.role || 'No role', who, entry.data.breakMinutes ? `${entry.data.breakMinutes}m break` : null]
        .filter(Boolean)
        .join(' · ')
    )
  );
}

/**
 * The mapping and preview step. No two spreadsheets have the same
 * headers, so the columns are guessed and then shown, and the preview
 * below re-derives itself from whatever the selects say.
 */
export function openCSVImportDialog(ctx, { kind, text, fileName = null }) {
  const { store } = ctx;
  const spec = KINDS[kind];
  const table = parseCSVTable(text);

  if (table.headers.length === 0 || table.rows.length === 0) {
    const empty = openModal({
      title: spec.title,
      content: el(
        'div',
        { class: 'form-error' },
        icon('circle-alert', 15),
        'That file has no rows in it. A CSV needs a header row and at least one row of data.'
      ),
      footer: [
        el('span', { class: 'grow' }),
        el('button', { class: 'btn btn-primary', onClick: () => empty.close() }, 'Close'),
      ],
    });
    return empty;
  }

  const mapping = detectMapping(table.headers, spec.fields);
  let dateOrder = 'mdy';
  let createMissing = false;

  const previewBox = el('div', { style: { display: 'contents' } });
  const summaryLine = el('p', { class: 'export-preview' });
  const errorBox = el('div', { style: { display: 'contents' } });
  const submit = el('button', { class: 'btn btn-primary' }, icon('upload', 15), 'Import');
  let plan = null;

  const columnSelect = (fieldSpec) => {
    const select = el(
      'select',
      {
        class: 'select',
        onChange: (e) => {
          mapping[fieldSpec.key] = e.target.value === '' ? null : Number(e.target.value);
          refresh();
        },
      },
      el('option', { value: '', selected: mapping[fieldSpec.key] === null }, 'Not in this file'),
      table.headers.map((header, index) =>
        el(
          'option',
          { value: String(index), selected: mapping[fieldSpec.key] === index },
          header || `Column ${index + 1}`
        )
      )
    );
    return field(`${fieldSpec.label}${fieldSpec.required ? ' *' : ''}`, select);
  };

  function refresh() {
    errorBox.replaceChildren();
    plan =
      kind === 'employees'
        ? planEmployeeImport(table, mapping, store.state)
        : planShiftImport(table, mapping, store.state, { dateOrder, createMissing });

    const good = plan.usable;
    const problems = plan.entries.filter((e) => e.problems.length > 0);
    const duplicates = plan.entries.filter((e) => e.duplicate && e.problems.length === 0);

    previewBox.replaceChildren(
      el(
        'div',
        { class: 'import-preview' },
        good.length === 0
          ? el('p', { class: 'coverage-empty' }, 'No row in this file can be read with these columns.')
          : el(
              'div',
              {},
              el('h4', {}, `Will be added (${good.length})`),
              el('div', { class: 'import-list' }, good.slice(0, 8).map((entry) => previewRow(kind, entry))),
              good.length > 8
                ? el('p', { class: 'coverage-empty' }, `…and ${good.length - 8} more.`)
                : null
            ),
        duplicates.length > 0
          ? el(
              'div',
              {},
              el('h4', {}, `Already on the team (${duplicates.length})`),
              el(
                'p',
                { class: 'coverage-empty' },
                `Skipped so nobody is duplicated: ${duplicates
                  .slice(0, 6)
                  .map((e) => e.data.name)
                  .join(', ')}${duplicates.length > 6 ? ', …' : ''}`
              )
            )
          : null,
        problems.length > 0
          ? el(
              'div',
              {},
              el('h4', {}, `Skipped (${problems.length})`),
              el('div', { class: 'import-list' }, problems.slice(0, 8).map(problemRow)),
              problems.length > 8
                ? el('p', { class: 'coverage-empty' }, `…and ${problems.length - 8} more.`)
                : null
            )
          : null,
        plan.roles.length > 0
          ? el(
              'p',
              { class: 'coverage-empty' },
              `New roles this adds: ${plan.roles.join(', ')}.`
            )
          : null
      )
    );

    const parts = [describeImport(plan, spec.noun)];
    if (kind === 'shifts' && plan.unknownNames.length > 0) {
      parts.push(
        createMissing
          ? `${plan.unknownNames.length} new ${plan.unknownNames.length === 1 ? 'person' : 'people'}`
          : `${plan.unknownNames.length} unknown ${
              plan.unknownNames.length === 1 ? 'name' : 'names'
            } left open`
      );
    }
    const archived = kind === 'shifts' ? good.filter((e) => e.assignee?.kind === 'archived').length : 0;
    if (archived > 0) {
      parts.push(`${archived} for archived people left open`);
    }
    summaryLine.textContent = `${parts.join(' · ')}. Nothing is written until you press Import.`;
    submit.disabled = good.length === 0;
    submit.replaceChildren(
      icon('upload', 15),
      good.length === 0 ? 'Nothing to import' : `Import ${good.length} ${good.length === 1 ? spec.noun : `${spec.noun}s`}`
    );
  }

  submit.addEventListener('click', async () => {
    const controls = [...modal.body.querySelectorAll('button, select, input'), submit];
    for (const c of controls) c.disabled = true;
    try {
      const result =
        kind === 'employees'
          ? await store.importRecords({
              employees: plan.usable.map((e) => e.data),
              roles: plan.roles,
            })
          : await store.importRecords({
              employees: createMissing
                ? plan.unknownNames.map((name) => ({ name }))
                : [],
              // Every name the file gave, matched or not: importRecords
              // resolves it against the team plus whoever it just created
              // and leaves the shift open when nobody answers to it,
              // which is how it can report how many ended up that way.
              // Blanking the unmatched ones here instead meant the
              // preview promised "3 unknown names left open" and the
              // outcome said only how many shifts arrived.
              // An archived name is passed blank: the preview already
              // said that shift stays open, and counting it among the
              // names nobody recognised would report it twice.
              shifts: plan.usable.map((e) => ({
                ...e.data,
                assigneeName: e.assignee && e.assignee.kind !== 'archived' ? e.assignee.name : '',
              })),
              roles: plan.roles,
            });
      modal.close();
      undoToast(describeResult(result), result.undo);
    } catch (err) {
      for (const c of controls) c.disabled = false;
      showFormError(errorBox, err.message);
      refresh();
    }
  });

  refresh();

  const modal = openModal({
    title: `${spec.title}${fileName ? `: ${fileName}` : ''}`,
    content: [
      el('p', { class: 'share-copy' }, spec.blurb),
      el('h3', { class: 'coverage-add-title' }, 'Which column is which'),
      el('div', { class: 'form-grid' }, spec.fields.map(columnSelect)),
      kind === 'shifts'
        ? el(
            'div',
            { class: 'repeat-section' },
            el(
              'div',
              { class: 'repeat-head' },
              el('label', {}, 'Dates like 03/04 mean'),
              segmented(
                [
                  { value: 'mdy', label: 'March 4' },
                  { value: 'dmy', label: '3 April' },
                ],
                dateOrder,
                (value) => {
                  dateOrder = value;
                  refresh();
                }
              )
            ),
            el(
              'div',
              { class: 'repeat-head' },
              el('label', {}, 'Add people this file names but Shifts does not know'),
              switchControl(
                false,
                (checked) => {
                  createMissing = checked;
                  refresh();
                },
                'Create employees for unknown names'
              )
            )
          )
        : null,
      previewBox,
      summaryLine,
      errorBox,
    ],
    footer: [
      el('span', { class: 'grow' }),
      el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'),
      submit,
    ],
  });

  return modal;
}

/** "8 employees and 34 shifts added" */
export function describeResult(result) {
  const parts = [];
  if (result.employeesAdded > 0) {
    parts.push(`${result.employeesAdded} ${result.employeesAdded === 1 ? 'person' : 'people'}`);
  }
  if (result.shiftsAdded > 0) {
    parts.push(`${result.shiftsAdded} shift${result.shiftsAdded === 1 ? '' : 's'}`);
  }
  const lead = parts.length > 0 ? `${parts.join(' and ')} added` : 'Nothing added';
  const extra = [];
  if (result.rolesAdded > 0) {
    extra.push(`${result.rolesAdded} new role${result.rolesAdded === 1 ? '' : 's'}`);
  }
  if (result.openedShifts > 0) {
    extra.push(
      `${result.openedShifts} left open (name not recognised)`
    );
  }
  return extra.length > 0 ? `${lead} · ${extra.join(' · ')}` : lead;
}

/**
 * The fast way in: a pasted column of names. Everyone starts somewhere,
 * and for most teams that somewhere is a list of names in a message.
 */
export function openNameListDialog(ctx) {
  const { store } = ctx;
  const input = el('textarea', {
    class: 'textarea',
    rows: '8',
    'aria-label': 'Names to add, one per line',
    placeholder: 'Ava Chen\nLiam Torres\nNoor Haddad',
  });
  const preview = el('p', { class: 'export-preview' });
  const errorBox = el('div', { style: { display: 'contents' } });
  const submit = el('button', { class: 'btn btn-primary' }, icon('user-plus', 15), 'Add people');

  function refresh() {
    const names = parseNameList(input.value);
    const existing = new Set(store.state.employees.map((e) => e.name.trim().toLowerCase()));
    const fresh = names.filter((n) => !existing.has(n.toLowerCase()));
    const skipped = names.length - fresh.length;
    preview.textContent =
      names.length === 0
        ? 'One name per line.'
        : `${fresh.length} to add${skipped > 0 ? `, ${skipped} already on the team` : ''}.`;
    submit.disabled = fresh.length === 0;
    return fresh;
  }

  input.addEventListener('input', refresh);
  refresh();

  submit.addEventListener('click', async () => {
    const fresh = refresh();
    if (fresh.length === 0) return;
    submit.disabled = true;
    try {
      const result = await store.importRecords({ employees: fresh.map((name) => ({ name })) });
      modal.close();
      undoToast(describeResult(result), result.undo);
    } catch (err) {
      submit.disabled = false;
      showFormError(errorBox, err.message);
    }
  });

  const modal = openModal({
    title: 'Paste a list of names',
    content: [
      el(
        'p',
        { class: 'share-copy' },
        'One name per line. Everything else about them, role, hours, rate, contact details, can be filled in afterwards, and anything after a comma or tab on a line is ignored.'
      ),
      input,
      preview,
      errorBox,
    ],
    footer: [
      el('span', { class: 'grow' }),
      el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'),
      submit,
    ],
  });

  return modal;
}
