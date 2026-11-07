import { el } from '../lib/dom.js';
import { icon } from './icons.js';
import { store } from '../lib/store.js';
import { toast } from './toast.js';
import { openModal, confirmDialog } from './modal.js';
import { parseBackupFile, describeBackup, validateBackup } from '../lib/backup.js';
import { formatBytes } from '../lib/util.js';
import { todayISO } from '../lib/dates.js';
import { canSaveFiles, saveToPuter } from '../lib/puterui.js';

/** Hand a blob to the browser as a download. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  // Long enough for the download to start on any browser.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* The day the file was made, in the user's own timezone: toISOString() is UTC,
   which names a backup taken on Friday evening in the Americas after Saturday.
   Every other date in the app is local (see lib/dates.js). */
const stamp = () => todayISO();

const safeSlug = (name) => String(name || 'project')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';

/**
 * Export everything (or one project), with or without attachment blobs.
 * The zip is the restorable shape; the plain JSON is the readable one, and
 * the UI says which is which rather than quietly dropping files.
 */
export async function exportBackup(btn, {
  ids = null, withAttachments = true, name = null, toPuter = false,
} = {}) {
  if (btn) btn.disabled = true;
  try {
    const base = name ? `${safeSlug(name)}-backup-${stamp()}` : `projects-backup-${stamp()}`;
    let blob;
    let filename;
    let note = '';
    if (withAttachments) {
      const bundle = await store.exportBundle(ids);
      blob = bundle.blob;
      filename = `${base}.zip`;
      if (bundle.missing) {
        note = `. ${bundle.missing} attachment${bundle.missing === 1 ? '' : 's'} could not be read`;
      }
    } else {
      const data = await store.exportAll(ids);
      blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      filename = `${base}.json`;
      note = '. Attachments are not included';
    }

    // A backup that lands in your own Drive is more useful than one in
    // ~/Downloads, on a platform where the Drive is the point.
    if (toPuter) {
      const saved = await saveToPuter(blob, filename);
      if (!saved) return;   // the picker was dismissed; nothing to report
      toast(`Saved to ${saved.path}${note}`, { icon: 'cloud' });
      return;
    }
    downloadBlob(blob, filename);
    toast(`Backup downloaded (${formatBytes(blob.size)})${note}`, { icon: 'download' });
  } catch (err) {
    console.error(err);
    toast('Could not export. Check your connection', { icon: 'cloudOff' });
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * Read a picked backup, confirm what it holds, then import it as new
 * projects. Nothing existing is touched, which the dialog states plainly.
 */
export async function importBackup(file, btn) {
  let parsed;
  try {
    parsed = await parseBackupFile(file);
    validateBackup(parsed.data);
  } catch (err) {
    console.error(err);
    toast(err?.message || 'That file could not be read', { icon: 'cloudOff' });
    return null;
  }

  const info = describeBackup(parsed.data);
  if (!info.projects) {
    toast('That backup has no projects in it', { icon: 'cloudOff' });
    return null;
  }
  const withBlobs = parsed.files.size > 0;
  const ok = await confirmDialog({
    title: 'Import this backup?',
    message: [
      `${info.projects} project${info.projects === 1 ? '' : 's'}`,
      `${info.tasks} task${info.tasks === 1 ? '' : 's'}`,
      info.attachments
        ? `${info.attachments} attachment${info.attachments === 1 ? '' : 's'}${withBlobs ? '' : ' (not in this file)'}`
        : null,
      info.exportedAt ? `exported ${new Date(info.exportedAt).toLocaleDateString()}` : null,
    ].filter(Boolean).join(' · ') + '. They are added as new projects, so nothing existing changes.',
    confirmLabel: 'Import',
    danger: false,
  });
  if (!ok) return null;

  if (btn) btn.disabled = true;
  const pending = toast('Importing…', { icon: 'upload', duration: 60000 });
  let summary;
  try {
    summary = await store.importBackup(parsed);
  } catch (err) {
    console.error(err);
    pending.dismiss();
    toast(err?.message || 'Could not import that backup', { icon: 'cloudOff' });
    return null;
  } finally {
    if (btn) btn.disabled = false;
  }
  pending.dismiss();
  showImportResult(summary);
  return summary;
}

function showImportResult(summary) {
  const lines = [
    `${summary.projects} project${summary.projects === 1 ? '' : 's'}`,
    `${summary.tasks} task${summary.tasks === 1 ? '' : 's'}`,
    summary.attachments ? `${summary.attachments} attachment${summary.attachments === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(', ');

  // A clean import is a toast; anything partial deserves the detail.
  if (!summary.failed.length && !summary.missingAttachments) {
    toast(`Imported ${lines}`, { icon: 'check' });
    return;
  }

  const done = el('button.btn.btn-primary', {});
  const modal = openModal({
    title: 'Import finished',
    dismissOnBack: true,
    content: el('div', {},
      el('p.confirm-message', {}, `Imported ${lines}.`),
      summary.missingAttachments > 0 && el('p.form-hint', {},
        `${summary.missingAttachments} attachment${summary.missingAttachments === 1 ? '' : 's'} `
        + 'could not be restored: the backup did not include the files.'),
      summary.failed.length > 0 && el('div.field', {},
        el('span.label', {}, `${summary.failed.length} project${summary.failed.length === 1 ? '' : 's'} skipped`),
        el('div.recover-list', {}, summary.failed.map((f) => el('div.recover-row', {},
          el('span.recover-main', {},
            el('div.recover-title', {}, f.name),
            el('div.recover-sub', {}, f.error)
          )
        )))
      ),
      el('div.row.row-end', {}, done)
    ),
  });
  done.textContent = 'Done';
  done.addEventListener('click', () => modal.close());
}
