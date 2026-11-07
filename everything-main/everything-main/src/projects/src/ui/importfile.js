import { el } from '../lib/dom.js';
import { fieldId } from '../lib/util.js';
import { icon } from './icons.js';
import { store } from '../lib/store.js';
import { toast } from './toast.js';
import { openModal } from './modal.js';
import { importBackup } from './backupactions.js';
import { BACKUP_APP, BACKUP_VERSION } from '../lib/backup.js';
import { looksLikeTrello, trelloToProject } from '../lib/trello.js';
import {
  parseCsv, detectColumns, csvToProject, CSV_FIELDS,
} from '../lib/csvimport.js';

/**
 * Import: our own backup, a Trello board's JSON, or a CSV (Asana's export, or
 * any spreadsheet with a header row).
 *
 * Whatever the format, the document goes through the store's own
 * `prepareImportedProject` — fresh ids for everything, and the path-traversal
 * guard on attachment names — so an importer can never write a shape the rest
 * of the app has not seen. And as with backups: **import always creates a new
 * project**. Nothing existing is touched, ever.
 *
 * Every format shows what it found before writing anything, and the same
 * account of it afterwards. Silently dropping a field is worse than refusing
 * the file.
 */

const isJson = (name) => /\.json$/i.test(name);
const isCsv = (name) => /\.(csv|tsv|txt)$/i.test(name);

/** Route a picked file to the importer that understands it. */
export async function importAnyFile(file, btn) {
  const name = String(file?.name ?? '');

  if (/\.zip$/i.test(name)) return importBackup(file, btn);

  if (isCsv(name)) return openCsvImport(file, btn);

  if (isJson(name)) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      console.error(err);
      toast('That file is not valid JSON', { icon: 'cloudOff' });
      return null;
    }
    if (data?.app === BACKUP_APP) return importBackup(file, btn);
    if (looksLikeTrello(data)) return openTrelloImport(data, name, btn);
    toast('That JSON is neither a backup from this app nor a Trello board', { icon: 'cloudOff' });
    return null;
  }

  // No extension to go on: try the content, since a Trello export is often
  // saved without one.
  try {
    const data = JSON.parse(await file.text());
    if (data?.app === BACKUP_APP) return importBackup(file, btn);
    if (looksLikeTrello(data)) return openTrelloImport(data, name, btn);
  } catch { /* not JSON: fall through to the message below */ }

  toast('Pick a .zip or .json backup, a Trello board JSON, or a .csv', { icon: 'cloudOff' });
  return null;
}

/**
 * Hand a prepared document to the store by wrapping it in the backup envelope
 * it already knows how to read. One code path in, one set of guarantees.
 */
async function createFromDoc(doc, { archived = false } = {}) {
  return store.importBackup({
    data: {
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      exportedAt: Date.now(),
      projects: [doc],
      index: [{ name: doc.name, color: doc.color, archived }],
    },
    files: new Map(),
  });
}

/** The lines a preview and a result share. */
function reportLines(report) {
  return [
    `${report.tasks} task${report.tasks === 1 ? '' : 's'}`,
    `${report.columns} column${report.columns === 1 ? '' : 's'}`,
    report.labels ? `${report.labels} label${report.labels === 1 ? '' : 's'}` : null,
    report.members ? `${report.members} member${report.members === 1 ? '' : 's'}` : null,
    report.milestones ? `${report.milestones} milestone${report.milestones === 1 ? '' : 's'}` : null,
    report.checklistItems ? `${report.checklistItems} checklist items` : null,
    report.comments ? `${report.comments} comment${report.comments === 1 ? '' : 's'}` : null,
    report.archived ? `${report.archived} archived` : null,
    report.skippedRows ? `${report.skippedRows} row${report.skippedRows === 1 ? '' : 's'} skipped (no title)` : null,
  ].filter(Boolean).join(' · ');
}

function previewDialog({ title, name, report, onConfirm }) {
  const nameId = fieldId('import-name');
  const nameInput = el('input.input', {
    id: nameId, type: 'text', value: name, maxLength: 60,
  });

  const importBtn = el('button.btn.btn-primary', { type: 'button' }, 'Import');

  const modal = openModal({
    title,
    dismissOnBack: true,
    content: el('div', {},
      el('div.field', {},
        el('label.label', { htmlFor: nameId }, 'New project name'),
        nameInput
      ),
      el('div.field', {},
        el('span.label', {}, 'What comes across'),
        el('p.confirm-message', {}, reportLines(report)),
        report.notes?.length
          ? el('ul.import-notes', {}, report.notes.map((note) => el('li', {}, note)))
          : null
      ),
      el('p.form-hint', {}, 'It arrives as a new project. Nothing you already have changes.'),
      el('div.row.row-end', {},
        el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
        importBtn
      )
    ),
  });

  importBtn.addEventListener('click', async () => {
    importBtn.disabled = true;
    const finalName = nameInput.value.trim() || name;
    const pending = toast('Importing…', { icon: 'upload', duration: 60000 });
    try {
      const summary = await onConfirm(finalName);
      pending.dismiss();
      modal.close();
      showResult(summary, report);
    } catch (err) {
      console.error(err);
      pending.dismiss();
      importBtn.disabled = false;
      toast(err?.message || 'Could not import that file', { icon: 'cloudOff' });
    }
  });

  return modal;
}

/** The same account afterwards, plus anything that failed on the way in. */
function showResult(summary, report) {
  if (!summary?.projects) {
    toast(summary?.failed?.[0]?.error || 'Nothing was imported', { icon: 'cloudOff' });
    return;
  }
  const notes = [
    ...(report.notes ?? []),
    summary.missingAttachments
      ? `${summary.missingAttachments} attachment${summary.missingAttachments === 1 ? '' : 's'} `
        + 'could not be brought across'
      : null,
  ].filter(Boolean);

  if (!notes.length) {
    toast(`Imported ${summary.tasks} task${summary.tasks === 1 ? '' : 's'}`, { icon: 'check' });
    return;
  }

  const doneBtn = el('button.btn.btn-primary', {}, 'Done');
  const modal = openModal({
    title: 'Import finished',
    dismissOnBack: true,
    content: el('div', {},
      el('p.confirm-message', {},
        `Imported ${summary.tasks} task${summary.tasks === 1 ? '' : 's'} `
        + `into ${summary.projects} new project${summary.projects === 1 ? '' : 's'}.`),
      el('span.label', {}, 'Worth knowing'),
      el('ul.import-notes', {}, notes.map((note) => el('li', {}, note))),
      el('div.row.row-end', {}, doneBtn)
    ),
  });
  doneBtn.addEventListener('click', () => modal.close());
}

// ---- Trello ---------------------------------------------------------------

function openTrelloImport(data, filename, btn) {
  const { doc, report } = trelloToProject(data);
  if (!report.tasks && !report.archived) {
    toast('That Trello board has no cards in it', { icon: 'cloudOff' });
    return null;
  }
  if (btn) btn.disabled = false;
  return previewDialog({
    title: 'Import a Trello board',
    name: doc.name || filename.replace(/\.json$/i, ''),
    report,
    onConfirm: (name) => createFromDoc({ ...doc, name }),
  });
}

// ---- CSV ------------------------------------------------------------------

async function openCsvImport(file, btn) {
  let rows;
  try {
    rows = parseCsv(await file.text());
  } catch (err) {
    console.error(err);
    toast('That CSV could not be read', { icon: 'cloudOff' });
    return null;
  }
  if (rows.length < 2) {
    toast('That CSV needs a header row and at least one task', { icon: 'cloudOff' });
    return null;
  }
  if (btn) btn.disabled = false;

  const headers = rows[0].map((h) => String(h ?? '').trim());
  let mapping = detectColumns(headers);

  const suggestedName = file.name.replace(/\.(csv|tsv|txt)$/i, '').slice(0, 60) || 'Imported project';

  const nameId = fieldId('csv-name');
  const nameInput = el('input.input', {
    id: nameId, type: 'text', value: suggestedName, maxLength: 60,
  });

  const summaryLine = el('p.confirm-message', { role: 'status', 'aria-live': 'polite' });
  const notes = el('ul.import-notes');
  const importBtn = el('button.btn.btn-primary', { type: 'button' }, 'Import');

  /* One row per column in the file: what it is called, a sample value so the
     guess can be checked at a glance, and what it becomes. */
  const table = el('div.csv-map');
  headers.forEach((header, index) => {
    const sample = rows.slice(1, 4).map((r) => String(r[index] ?? '').trim()).find(Boolean) ?? '';
    const selectId = fieldId('csv-col');
    const select = el('select.input', {
      id: selectId,
      onchange: () => {
        const value = select.value || null;
        // One field per column: taking a field frees whoever had it.
        if (value) mapping = mapping.map((m) => (m === value ? null : m));
        mapping[index] = value;
        renderMap();
        syncPreview();
      },
    },
      el('option', { value: '', selected: !mapping[index] }, 'Skip this column'),
      CSV_FIELDS.map((f) => el('option', {
        value: f.key, selected: mapping[index] === f.key,
      }, f.label))
    );
    table.append(el('div.csv-map-row', {},
      el('div.csv-map-head', {},
        el('label.csv-map-name', { htmlFor: selectId }, header || `Column ${index + 1}`),
        sample && el('span.csv-map-sample', { title: sample }, sample)
      ),
      select
    ));
  });

  function renderMap() {
    [...table.querySelectorAll('select')].forEach((select, index) => {
      select.value = mapping[index] ?? '';
    });
  }

  function syncPreview() {
    if (!mapping.includes('title')) {
      summaryLine.textContent = 'Choose which column holds the task title. '
        + 'Nothing else can be imported without it.';
      notes.replaceChildren();
      importBtn.disabled = true;
      return;
    }
    const { report } = csvToProject(rows, mapping, { name: nameInput.value.trim() || suggestedName });
    importBtn.disabled = report.tasks === 0;
    summaryLine.textContent = report.tasks
      ? reportLines(report)
      : 'No rows have a title, so there is nothing to import.';
    notes.replaceChildren(...(report.notes ?? []).map((note) => el('li', {}, note)));
  }

  const modal = openModal({
    title: 'Import a CSV',
    dismissOnBack: true,
    content: el('div.csv-import', {},
      el('div.field', {},
        el('label.label', { htmlFor: nameId }, 'New project name'),
        nameInput
      ),
      el('div.field', {},
        el('span.label', {}, `Columns in ${file.name}`),
        table
      ),
      el('div.field', {},
        el('span.label', {}, 'What comes across'),
        summaryLine,
        notes
      ),
      el('p.form-hint', {}, 'It arrives as a new project. Nothing you already have changes.'),
      el('div.row.row-end', {},
        el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
        importBtn
      )
    ),
  });

  nameInput.addEventListener('input', () => syncPreview());
  syncPreview();

  importBtn.addEventListener('click', async () => {
    importBtn.disabled = true;
    const name = nameInput.value.trim() || suggestedName;
    const { doc, report } = csvToProject(rows, mapping, { name });
    const pending = toast('Importing…', { icon: 'upload', duration: 60000 });
    try {
      const summary = await createFromDoc(doc);
      pending.dismiss();
      modal.close();
      showResult(summary, report);
    } catch (err) {
      console.error(err);
      pending.dismiss();
      importBtn.disabled = false;
      toast(err?.message || 'Could not import that file', { icon: 'cloudOff' });
    }
  });

  return modal;
}
