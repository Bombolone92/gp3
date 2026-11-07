/** Data: backup, restore, sample data, and deleting everything. */
import '../styles/settings.css';
import { h, downloadBlob } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { card, field, textInput } from '../ui/components.js';
import { COLLECTIONS } from '../core/store.js';
import { defaultSettings } from '../core/settings.js';
import { buildBackup, parseBackup, isFirmEmpty } from '../core/settings-backup.js';

const store = () => app.store;

function exportBackup() {
  const snap = store().snapshot();
  const data = buildBackup({ collections: snap.collections, settings: store().state.settings });
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `legal-backup-${app.today()}.json`);
  toast('Backup downloaded');
}

function restoreBackup() {
  const input = h('input', { type: 'file', accept: 'application/json,.json' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    let parsed;
    try {
      parsed = parseBackup(await file.text());
    } catch (err) {
      toast(err.message, { type: 'error' });
      return;
    }
    const total = Object.values(parsed.counts).reduce((s, n) => s + n, 0);
    const ok = await confirmDialog({
      title: 'Restore this backup?',
      message: `The backup has ${total} records. Records with the same id are replaced by the backup's version, and everything else is kept. Firm settings in the backup replace the current ones; settings it does not include stay as they are. Document files are not part of backups.`,
      confirmLabel: 'Restore',
      danger: true,
    });
    if (!ok) return;
    for (const c of COLLECTIONS) if (parsed.collections[c].length) store().bulkPut(c, parsed.collections[c]);
    if (parsed.settings) store().saveSettings(parsed.settings);
    toast(`Restored ${total} records`);
  });
  input.click();
}

async function loadSample() {
  if (!isFirmEmpty((c) => store().all(c))) {
    toast('Sample data can only be loaded into an empty firm.', { type: 'info' });
    return;
  }
  const ok = await confirmDialog({
    title: 'Load the sample firm?',
    message: 'This fills your firm with fictional matters, contacts, time, bills, and trust funds so you can explore. You can delete it all later from this page.',
    confirmLabel: 'Load sample data',
  });
  if (!ok) return;
  const { buildSampleData } = await import('../core/sample.js');
  const sample = buildSampleData(app.today());
  for (const [c, recs] of Object.entries(sample.collections)) store().bulkPut(c, recs);
  store().saveSettings({ ...sample.settings, onboarded: true });
  toast('Sample firm loaded');
}

function deleteAll() {
  const confirmWord = 'DELETE';
  const input = textInput({ name: 'confirm', autocomplete: 'off', spellcheck: 'false' });
  openDialog({
    title: 'Delete all firm data?',
    size: 'narrow',
    body: h(
      'div.stack',
      h('p', 'This permanently deletes every matter, contact, time entry, bill, payment, trust transaction, task, event, note, document, and setting in this firm. It cannot be undone.'),
      h('p', 'Download a backup first if you might need any of it.'),
      field(`Type ${confirmWord} to confirm`, input),
    ),
    footer: ({ close }) => [
      h('div.spacer'),
      h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
      h(
        'button.btn.danger',
        {
          type: 'button',
          onClick: async () => {
            if (input.value.trim() !== confirmWord) {
              input.setAttribute('aria-invalid', 'true');
              input.focus();
              return;
            }
            close();
            const docs = store().all('documents');
            for (const c of COLLECTIONS) {
              const ids = store()
                .all(c)
                .map((r) => r.id);
              if (ids.length) store().bulkRemove(c, ids);
            }
            store().saveSettings({ ...defaultSettings(), onboarded: false });
            // Files go last and best effort; the records are already gone.
            const { deleteFile } = await import('../files.js');
            let failed = 0;
            for (const d of docs) if (d.file) await deleteFile(d.file).catch(() => failed++);
            toast(failed ? `Firm data deleted. ${failed} files could not be removed from storage.` : 'All firm data deleted', { type: failed ? 'error' : 'success' });
          },
        },
        'Delete everything',
      ),
    ],
  });
}

export function dataSection() {
  const empty = isFirmEmpty((c) => store().all(c));
  // In a shared firm, only the owner and admins may wipe or restore data.
  const canManage = !app.team || app.team.role !== 'member';
  return h(
    'div.stack',
    card({
      title: 'Backup',
      body: h(
        'div.stack',
        h('p.subtle', 'Download every record and setting as a JSON file. Document files are not included; download those from Documents.'),
        h(
          'div.row',
          h('button.btn', { type: 'button', onClick: exportBackup }, icon('download', 16), 'Download backup'),
          canManage ? h('button.btn', { type: 'button', onClick: restoreBackup }, icon('upload', 16), 'Restore from backup') : null,
        ),
      ),
    }),
    app.demo || !canManage
      ? null
      : card({
          title: 'Sample data',
          body: h(
            'div.stack',
            h('p.subtle', empty ? 'Fill your empty firm with a realistic, fictional practice to explore every feature.' : 'Sample data can only be loaded into an empty firm.'),
            h('div', h('button.btn', { type: 'button', disabled: !empty || null, onClick: loadSample }, icon('database', 16), 'Load sample firm')),
          ),
        }),
    !canManage
      ? null
      : card({
          title: 'Danger zone',
          cls: 'danger-card',
          body: h(
            'div.stack',
            h('p.subtle', 'Remove everything in this firm and start over.'),
            h('div', h('button.btn.danger', { type: 'button', onClick: deleteAll }, icon('trash', 16), 'Delete all firm data')),
          ),
        }),
  );
}
