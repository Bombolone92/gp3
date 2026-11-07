import { el } from '../lib/dom.js';
import { fieldId, formatBytes } from '../lib/util.js';
import { icon } from './icons.js';
import { store } from '../lib/store.js';
import { toast } from './toast.js';
import { openModal } from './modal.js';
import { radioGroupKeys } from './bits.js';
import { downloadBlob } from './backupactions.js';
import { canSaveFiles, saveToPuter } from '../lib/puterui.js';
import { projectMarkdown, projectCsv } from '../lib/exportdocs.js';
import { doneColumnIds } from '../lib/board.js';
import { matchesFilter, isFilterActive } from '../lib/filters.js';
import { filterFor } from './filterbar.js';
import { todayISO } from '../lib/dates.js';

/**
 * Export one project in a shape something other than this app can read.
 *
 * The backup zip is still the restorable thing, and it is offered here beside
 * the two readable ones so there is a single answer to "get this out". The
 * dialog is also where the filter is faced honestly: exporting from a filtered
 * board silently sending 42 of 118 tasks would be a mistake nobody notices
 * until the email is sent.
 */

/* The day the file was made, in the user's own timezone: toISOString() is UTC,
   which names a backup taken on Friday evening in the Americas after Saturday.
   Every other date in the app is local (see lib/dates.js). */
const stamp = () => todayISO();

const safeSlug = (name) => String(name || 'project')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';

const FORMATS = [
  {
    value: 'md',
    label: 'Markdown',
    sub: 'A readable document: brief, milestones, then tasks by column',
    ext: 'md',
    type: 'text/markdown',
  },
  {
    value: 'csv',
    label: 'Spreadsheet',
    sub: 'One row per task, with the flat fields a spreadsheet wants',
    ext: 'csv',
    type: 'text/csv',
  },
  {
    value: 'zip',
    label: 'Backup',
    sub: 'Everything, attachments included. Only this app reads it',
    ext: 'zip',
    type: 'application/zip',
  },
];

export async function openExportProject(projectId) {
  const entry = store.projectEntry(projectId);
  let doc = store.getDoc(projectId);
  if (!doc) {
    try {
      doc = await store.loadProject(projectId);
    } catch (err) {
      console.error(err);
      toast('Could not read this project. Check your connection', { icon: 'cloudOff' });
      return null;
    }
  }

  const filter = filterFor(projectId);
  const filtered = doc.tasks.filter((t) => matchesFilter(t, filter, {
    doneIds: doneColumnIds(doc), today: todayISO(),
  }));
  const hasFilter = isFilterActive(filter);

  let format = 'md';
  let onlyFiltered = hasFilter;

  const formatGroup = el('div.template-list', { role: 'radiogroup', 'aria-label': 'Format' });
  function renderFormats() {
    formatGroup.replaceChildren(...FORMATS.map((f) => {
      const selected = f.value === format;
      return el('div.template-row', { className: `template-row${selected ? ' selected' : ''}` },
        el('button.template-pick', {
          type: 'button',
          role: 'radio',
          'aria-checked': selected ? 'true' : 'false',
          tabindex: selected ? 0 : -1,
          onclick: () => { format = f.value; renderFormats(); syncScope(); },
        },
          el('span.template-name', {}, f.label),
          el('span.template-sub', {}, f.sub)
        )
      );
    }));
  }
  renderFormats();
  radioGroupKeys(formatGroup, '.template-pick');

  const scopeId = fieldId('export-scope');
  const scopeBox = el('input', {
    id: scopeId,
    type: 'checkbox',
    checked: onlyFiltered,
    onchange: () => { onlyFiltered = scopeBox.checked; syncScope(); },
  });

  const scopeNote = el('p.form-hint');
  const scopeCheck = el('label.row.export-check', { htmlFor: scopeId }, scopeBox,
    el('span', {}, `Only the ${filtered.length} task${filtered.length === 1 ? '' : 's'} `
      + 'the current filter shows'));
  const scopeField = el('div.field.export-scope', {}, scopeCheck, scopeNote);

  function tasksToExport() {
    return onlyFiltered ? filtered : doc.tasks;
  }

  function syncScope() {
    // The backup is the whole project by definition; a filtered restore point
    // would be a trap.
    const backup = format === 'zip';
    scopeBox.disabled = backup || !hasFilter;
    scopeField.hidden = backup;
    /* With nothing filtered on screen there is nothing to narrow to, and a
       disabled tickbox reading "only the 15 tasks the current filter shows"
       names a filter that is not there. The note below still says exactly
       what will go out. */
    scopeCheck.hidden = !hasFilter;
    const n = tasksToExport().length;
    const total = doc.tasks.length;
    scopeNote.textContent = !hasFilter
      ? `${total} task${total === 1 ? '' : 's'}, the whole project`
      : onlyFiltered
        ? `${n} of ${total} tasks (filter applied)`
        : `All ${total} tasks, ignoring the filter on screen`;
  }
  if (!hasFilter) onlyFiltered = false;
  scopeBox.checked = onlyFiltered;
  syncScope();

  async function build() {
    const spec = FORMATS.find((f) => f.value === format);
    const base = `${safeSlug(entry?.name ?? doc.name)}-${stamp()}`;
    if (format === 'zip') {
      const bundle = await store.exportBundle([projectId]);
      return {
        blob: bundle.blob,
        filename: `${base}.zip`,
        note: bundle.missing
          ? `. ${bundle.missing} attachment${bundle.missing === 1 ? '' : 's'} could not be read`
          : '',
      };
    }
    const tasks = tasksToExport();
    const text = format === 'md'
      ? projectMarkdown(doc, { tasks, name: entry?.name ?? doc.name })
      : projectCsv(doc, { tasks, name: entry?.name ?? doc.name });
    return {
      blob: new Blob([text], { type: `${spec.type};charset=utf-8` }),
      filename: `${base}.${spec.ext}`,
      note: onlyFiltered && hasFilter ? ` (${tasks.length} of ${doc.tasks.length} tasks)` : '',
    };
  }

  async function run(toPuter, button) {
    button.disabled = true;
    try {
      const { blob, filename, note } = await build();
      if (toPuter) {
        const saved = await saveToPuter(blob, filename);
        if (!saved) return; // the picker was dismissed; nothing to report
        toast(`Saved to ${saved.path}${note}`, { icon: 'cloud' });
      } else {
        downloadBlob(blob, filename);
        toast(`${filename} downloaded (${formatBytes(blob.size)})${note}`, { icon: 'download' });
      }
      modal.close();
    } catch (err) {
      console.error(err);
      toast('Could not export. Check your connection', { icon: 'cloudOff' });
    } finally {
      button.disabled = false;
    }
  }

  const downloadBtn = el('button.btn.btn-primary', {
    type: 'button',
    html: icon('download', 15, 2),
    onclick: () => run(false, downloadBtn),
  }, ' Download');

  const puterBtn = canSaveFiles() && el('button.btn.btn-ghost', {
    type: 'button',
    html: icon('cloud', 15, 2),
    onclick: () => run(true, puterBtn),
  }, ' Save to Puter…');

  const modal = openModal({
    title: `Export ${entry?.name ?? 'project'}`,
    dismissOnBack: true,
    content: el('div', {},
      el('div.field', {}, el('span.label', {}, 'Format'), formatGroup),
      scopeField,
      el('p.form-hint', {}, 'For a printed board, list, or timeline, use your '
        + "browser's print command on the view itself."),
      el('div.row.row-end', {},
        el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
        puterBtn || null,
        downloadBtn
      )
    ),
  });
  return modal;
}
