/** Two-step CSV import wizard: paste or pick a file, map columns, import. */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { field, jobSelect } from './components.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { fromCSVCell, parseCSVWithLines } from '../lib/csv.js';
import { guessColumn, IMPORT_FIELDS, looksLikeHeader } from '../core/transfer.js';
import { parseApplicationEmail } from '../core/jobpage.js';
import { plural } from '../lib/format.js';

/**
 * Why there is nowhere to file a candidate. An account with four closed
 * jobs is told to reopen one, not to "create a job first" — which reads
 * like a bug to someone looking straight at the four.
 */
function openJobsMissing(store, need) {
  return store.state.jobs.length === 0
    ? `Create a job first; ${need}.`
    : `Every job is closed, and ${need}. Reopen one, or create a new job.`;
}

export function openImportWizard(ctx) {
  const { store } = ctx;
  const jobs = store.state.jobs.filter((j) => j.status !== 'closed');
  if (jobs.length === 0) {
    toast(openJobsMissing(store, 'imported candidates need one'), 'error');
    return;
  }

  const body = el('div', { style: { display: 'contents' } });
  const modal = openModal({ title: 'Import candidates', wide: true, content: body });

  // The CSV text survives the wizard's steps: coming Back from the
  // mapping step to fix a column must not throw away what was pasted.
  let csvText = '';
  // So do the mapping choices — Back exists to fix the CSV, and there is
  // no review step after this one: silently reverting the target job to
  // the first job (or the mappings to the guesses) imports every row
  // wrong with no undo. Column picks reset only when the CSV's header
  // shape changes; the job and dedupe choices are file-independent.
  let jobChoice = null;
  let dedupeChoice = true;
  let savedColumns = null;

  /* Step 1: get CSV text */
  function renderSource() {
    const textarea = el('textarea', {
      class: 'textarea',
      id: 'imp-csv',
      rows: 8,
      placeholder: 'Paste CSV here: one candidate per line, with a header row like\nName, Email, Phone, Source, Notes',
    });
    textarea.value = csvText;
    const fileInput = el('input', { type: 'file', accept: '.csv,text/csv,text/plain', style: { display: 'none' } });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        textarea.value = await file.text();
      } catch {
        // A file moved, renamed, or on a disconnected volume rejects the
        // read; without this the click just silently does nothing.
        toast(`Couldn’t read ${file.name}. Check the file and try again.`, 'error');
      }
      fileInput.value = '';
    });

    const next = el('button', { class: 'btn btn-primary' }, 'Continue');
    next.addEventListener('click', () => {
      csvText = textarea.value;
      const rows = parseCSVWithLines(csvText);
      if (rows.length === 0) {
        toast('Nothing to import yet. Paste CSV or choose a file.', 'error');
        return;
      }
      renderMapping(rows);
    });

    body.replaceChildren(
      el(
        'div',
        { class: 'field' },
        // for/id, not a bare <label>: this is one control, so the visible
        // words have to be its accessible name too. Unassociated, the box
        // fell back to naming itself after its own placeholder — which is
        // a worked example, not a label, and is not what a voice-control
        // user reads on the screen in front of them.
        el('label', { for: 'imp-csv' }, 'CSV data'),
        textarea,
        el(
          'div',
          { class: 'input-row' },
          el('button', { class: 'btn btn-sm', onClick: () => fileInput.click() }, icon('upload', 14), 'Choose a file'),
          el('span', { class: 'muted small' }, 'or paste above')
        ),
        fileInput
      ),
      el('div', { class: 'modal-footer no-pad' }, el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), next)
    );
  }

  /* Step 2: map columns, pick the job, import */
  function renderMapping(rows) {
    const hasHeader = looksLikeHeader(rows[0].cells);
    const headers = hasHeader ? rows[0].cells.map((h) => String(h).trim()) : rows[0].cells.map((_, i) => `Column ${i + 1}`);
    const dataRows = hasHeader ? rows.slice(1) : rows;
    if (dataRows.length === 0) {
      toast('That file only has a header row.', 'error');
      return;
    }

    const job = jobSelect(jobs, jobChoice ?? jobs[0]?.id);
    job.addEventListener('change', () => (jobChoice = job.value));
    const dedupe = el('input', { type: 'checkbox', class: 'task-check', checked: dedupeChoice, id: 'imp-dedupe' });
    dedupe.addEventListener('change', () => (dedupeChoice = dedupe.checked));

    const signature = JSON.stringify(headers);
    if (savedColumns?.signature !== signature) savedColumns = { signature, values: {} };

    const columnPickers = {};
    const mappingRows = IMPORT_FIELDS.map((f) => {
      const select = el(
        'select',
        { class: 'select', 'aria-label': `Column for ${f.label}` },
        el('option', { value: '-1' }, 'Not in this file'),
        headers.map((h, i) => el('option', { value: String(i), selected: i === guessColumn(headers, f) }, h))
      );
      const saved = savedColumns.values[f.key];
      if (saved !== undefined && [...select.options].some((o) => o.value === saved)) select.value = saved;
      select.addEventListener('change', () => (savedColumns.values[f.key] = select.value));
      columnPickers[f.key] = select;
      return el(
        'div',
        { class: 'mapping-row' },
        el('span', { class: 'mapping-label' }, f.label + (f.required ? ' *' : '')),
        select
      );
    });

    const entryAt = ({ cells, line }) => {
      // The skip report points the user back at their spreadsheet, so it
      // must carry the source line — the index here is blind to the
      // header row and any blank lines the parser dropped.
      const entry = { row: line };
      for (const f of IMPORT_FIELDS) {
        const idx = Number(columnPickers[f.key].value);
        entry[f.key] = idx >= 0 ? fromCSVCell(cells[idx]) : '';
      }
      return entry;
    };

    const preview = el('div', { class: 'import-preview muted small' });
    const renderPreview = () => {
      const samples = dataRows.slice(0, 3).map(entryAt);
      preview.replaceChildren(
        el('span', {}, `${plural(dataRows.length, 'row')} · preview: `),
        samples
          .map((s) => [s.name || '(no name)', s.email].filter(Boolean).join(' '))
          .join(' · ')
      );
    };
    for (const select of Object.values(columnPickers)) select.addEventListener('change', renderPreview);
    renderPreview();

    const run = el('button', { class: 'btn btn-primary' }, icon('upload', 15), `Import ${plural(dataRows.length, 'candidate')}`);
    run.addEventListener('click', async () => {
      if (Number(columnPickers.name.value) < 0) {
        toast('Pick which column holds the name.', 'error');
        return;
      }
      run.disabled = true;
      try {
        const { added, skipped } = await store.importCandidates(dataRows.map(entryAt), {
          jobId: job.value,
          skipDuplicates: dedupe.checked,
        });
        modal.close();
        toast(`${plural(added, 'candidate')} imported${skipped.length ? `, ${skipped.length} skipped` : ''}`);
        if (skipped.length > 0) showSkipped(skipped);
      } catch (err) {
        run.disabled = false;
        toast(err.message, 'error');
      }
    });

    body.replaceChildren(
      field('Add every row to this job', job, 'imp-job'),
      el('div', { class: 'field' }, el('label', {}, 'Columns'), el('div', { class: 'mapping-grid' }, mappingRows)),
      el('label', { class: 'task-label', for: 'imp-dedupe' }, dedupe, el('span', {}, 'Skip rows whose email already exists')),
      preview,
      el(
        'div',
        { class: 'modal-footer no-pad' },
        el('button', { class: 'btn btn-ghost', onClick: () => renderSource() }, icon('arrow-left', 14), 'Back'),
        el('span', { class: 'grow' }),
        el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'),
        run
      )
    );
  }

  function showSkipped(skipped) {
    const report = openModal({
      title: `${plural(skipped.length, 'row')} skipped`,
      content: el(
        'ul',
        { class: 'skip-list' },
        skipped.slice(0, 50).map((s) => el('li', {}, `Row ${s.row}: ${s.reason}`)),
        skipped.length > 50 ? el('li', {}, `…and ${skipped.length - 50} more`) : null
      ),
      footer: [el('span', { class: 'grow' }), el('button', { class: 'btn btn-primary', onClick: () => report.close() }, 'Done')],
    });
  }

  renderSource();
}

/**
 * One-click intake for a structured application email from the public
 * job page: paste the received email, the fields and target job parse
 * out, and the candidate lands on the right pipeline — with the same
 * duplicate-by-email skipping the CSV import applies.
 */
export function openPasteApplication(ctx) {
  const { store } = ctx;
  const jobs = store.state.jobs.filter((j) => j.status !== 'closed');
  if (jobs.length === 0) {
    toast(openJobsMissing(store, 'applications need one'), 'error');
    return;
  }

  const text = el('textarea', {
    class: 'textarea',
    rows: 9,
    placeholder:
      'Paste the application email here, ideally including the subject line.\n\nApplications sent from your public job page carry their fields and the job they belong to; freeform emails are parsed best-effort.',
  });
  // No aria-label here: field() below gives this select a real <label
  // for>, and an aria-label overrides it. The two disagreed — the screen
  // read "Add to this job" while a screen reader said "Job for this
  // candidate", and a voice-control user asking for the control by the
  // words in front of them matched nothing.
  const job = jobSelect(jobs, jobs[0]?.id);
  const preview = el('div', { class: 'paste-preview' });

  let parsed = null;
  let lastParsedJobId = null;

  function renderPreview() {
    parsed = parseApplicationEmail(text.value);
    // Auto-select the job only when the parsed token changes: the re-parse
    // on every keystroke — and again at Add time — must not silently undo
    // a job the recruiter picked by hand.
    const tokenChanged = parsed.jobId !== lastParsedJobId;
    lastParsedJobId = parsed.jobId;
    if (!text.value.trim()) {
      preview.replaceChildren();
      return;
    }
    const matchedJob = store.state.jobs.find((j) => j.id === parsed.jobId);
    if (tokenChanged && matchedJob && jobs.some((j) => j.id === matchedJob.id)) job.value = matchedJob.id;
    const existing = parsed.email
      ? store.state.candidates.find(
          (c) => c.email.toLowerCase() === parsed.email.toLowerCase()
        )
      : null;
    const row = (label, value) =>
      value
        ? el('div', { class: 'paste-preview-row' }, el('span', { class: 'paste-preview-label' }, label), el('span', {}, value))
        : null;
    // replaceChildren stringifies null into a literal "null" text node;
    // keep only real nodes.
    preview.replaceChildren(...[
      parsed.name || parsed.email
        ? el(
            'div',
            { class: 'paste-preview-grid' },
            row('Name', parsed.name),
            row('Email', parsed.email),
            row('Phone', parsed.phone),
            row('Link', parsed.link),
            row('Notes', parsed.notes.length > 120 ? `${parsed.notes.slice(0, 120)}…` : parsed.notes),
            // A token that resolves to a closed job never reaches the
            // select (it lists open jobs only) — asserting the bare title
            // here would claim a filing the Add button won't perform.
            row(
              'Job',
              matchedJob
                ? jobs.some((j) => j.id === matchedJob.id)
                  ? matchedJob.title
                  : `${matchedJob.title} is closed. Pick one below`
                : parsed.jobId
                  ? 'Not found. Pick one below'
                  : 'No job token. Pick one below'
            ),
            // Screening answers get their own stacked block below the
            // fielded rows: a question is a sentence, and the label
            // column beside those is 46px wide.
            parsed.answers.length > 0
              ? el(
                  'div',
                  { class: 'paste-preview-answers' },
                  parsed.answers.map((a) =>
                    el(
                      'div',
                      {},
                      el('div', { class: 'answer-q' }, a.label),
                      el('div', { class: 'answer-a' }, a.answer.length > 120 ? `${a.answer.slice(0, 120)}…` : a.answer)
                    )
                  )
                )
              : null
          )
        : el('p', { class: 'muted small' }, 'No fields recognized yet. The name is required; everything else is optional.'),
      existing
        ? el(
            'div',
            { class: 'form-error' },
            icon('circle-alert', 15),
            el('span', { class: 'grow' }, `${parsed.email} already belongs to ${existing.name}.`),
            el(
              'button',
              {
                class: 'btn btn-sm',
                onClick: () => {
                  modal.close();
                  ctx.navigate(`candidates/${existing.id}`);
                },
              },
              'Open profile'
            )
          )
        : null,
    ].filter(Boolean));
  }
  text.addEventListener('input', renderPreview);

  const add = el('button', { class: 'btn btn-primary' }, icon('user-plus', 15), 'Add candidate');
  add.addEventListener('click', async () => {
    renderPreview();
    if (!parsed?.name) {
      toast('Couldn’t find a name in the email. Add a "Name:" line.', 'error');
      return;
    }
    add.disabled = true;
    try {
      const { added, skipped } = await store.importCandidates(
        [
          {
            name: parsed.name,
            email: parsed.email,
            phone: parsed.phone,
            link: parsed.link,
            notes: parsed.notes,
            source: 'Career page',
            answers: parsed.answers,
          },
        ],
        { jobId: job.value, skipDuplicates: true }
      );
      if (added === 0) {
        add.disabled = false;
        toast(skipped[0]?.reason ?? 'Nothing was added.', 'error');
        return;
      }
      const candidate = store.state.candidates.at(-1);
      modal.close();
      ctx.navigate(`candidates/${candidate.id}`);
      toast(`${candidate.name} added from their application`);
    } catch (err) {
      add.disabled = false;
      toast(err.message, 'error');
    }
  });

  const modal = openModal({
    title: 'Paste application',
    wide: true,
    content: [
      field('Application email', text, 'paste-email'),
      preview,
      field('Add to this job', job, 'paste-job'),
    ],
    footer: [el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), add],
  });
}
