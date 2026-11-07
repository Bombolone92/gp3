/**
 * Backup dialog: download the full dataset as a JSON file, restore from
 * one, or bring a team and a schedule in from a spreadsheet.
 *
 * The two imports are deliberately kept apart and labelled for what they
 * do: a JSON restore replaces everything, a CSV import only adds.
 */
import { el, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { downloadTextFile } from '../lib/download.js';
import { isoDate, isoToday, relativeDayLabel } from '../lib/time.js';
import { buildBackup, describeBackup, describeCounts, validateBackup } from '../core/backup.js';
import { describeReason } from '../core/snapshots.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { showFormError } from './components.js';
import { openCSVImportDialog, openNameListDialog } from './csv-import.js';

export function openDataDialog(ctx) {
  const { store } = ctx;
  const errorBox = el('div', { style: { display: 'contents' } });

  function showError(message) {
    showFormError(errorBox, message);
  }

  function exportBackup() {
    errorBox.replaceChildren();
    const backup = buildBackup(store.state);
    downloadTextFile(
      `shifts-backup-${isoToday()}.json`,
      JSON.stringify(backup, null, 2),
      'application/json'
    );
    toast('Backup downloaded');
  }

  async function importBackup(file) {
    errorBox.replaceChildren();
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      showError('That file is not valid JSON.');
      return;
    }
    const errors = validateBackup(data);
    if (errors.length > 0) {
      showError(errors[0]);
      return;
    }
    const ok = await confirmDialog({
      title: 'Replace all data?',
      message: `The file contains ${describeBackup(data)}. Importing replaces everything currently in Shifts with the file’s contents.`,
      confirmLabel: 'Replace my data',
      danger: true,
    });
    if (!ok) return;
    try {
      await store.importData(data);
      toast('Backup restored');
      modal.close();
    } catch (err) {
      showError(err.message);
    }
  }

  const fileInput = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    style: { display: 'none' },
    onChange: (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) importBackup(file);
    },
  });

  /**
   * One hidden file input per CSV shape, so the button that was pressed
   * decides how the file is read rather than the app guessing.
   */
  function csvInput(kind) {
    return el('input', {
      type: 'file',
      accept: 'text/csv,text/plain,.csv,.txt',
      style: { display: 'none' },
      onChange: async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        errorBox.replaceChildren();
        let text;
        try {
          text = await file.text();
        } catch {
          showError('That file could not be read.');
          return;
        }
        openCSVImportDialog(ctx, { kind, text, fileName: file.name });
      },
    });
  }
  const employeesCSV = csvInput('employees');
  const shiftsCSV = csvInput('shifts');

  /* ---- Restore points ------------------------------------------------
     Automatic snapshots of the whole dataset, kept in the user's own
     storage (see core/snapshots.js). Quiet by design: no badges, and
     the list only appears once there is something in it. */

  const snapshotBox = el('div', { style: { display: 'contents' } });

  /**
   * "Today at 2:32 PM". Snapshots are stamped in UTC, so the day has to
   * be read back in local time or a late-evening restore point reads as
   * tomorrow's.
   */
  function snapshotWhen(at) {
    let stamped;
    try {
      stamped = new Date(at);
    } catch {
      return String(at);
    }
    if (Number.isNaN(stamped.getTime())) return String(at);
    const day = relativeDayLabel(isoDate(stamped));
    const time = stamped.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${day} at ${time}`;
  }

  async function restoreSnapshot(entry, button) {
    errorBox.replaceChildren();
    let data;
    try {
      data = await ctx.snapshots.read(entry.name);
    } catch (err) {
      showError(err.message);
      return;
    }
    // The same preview and confirmation a file import gets, because it
    // does the same thing to the data.
    const ok = await confirmDialog({
      title: 'Restore this point?',
      message: `It holds ${describeBackup(data)} from ${snapshotWhen(entry.at)}. Everything currently in Shifts is replaced. A restore point of what is here now is taken first, so this is itself reversible.`,
      confirmLabel: 'Restore this point',
      danger: true,
    });
    if (!ok) return;
    button.disabled = true;
    try {
      await store.importData(data, { reason: 'restore' });
      ctx.snapshots.invalidate();
      toast('Restore point applied');
      modal.close();
    } catch (err) {
      button.disabled = false;
      showError(err.message);
    }
  }

  async function renderSnapshots() {
    const offline = !navigator.onLine;
    let entries = [];
    try {
      entries = await ctx.snapshots.list();
    } catch (err) {
      console.error(err);
    }

    // mount rather than replaceChildren: the conditional pieces below are
    // null when they do not apply, and replaceChildren would render that
    // as the word "null".
    mount(
      snapshotBox,
      el('h3', { class: 'coverage-add-title' }, 'Restore points'),
      el(
        'p',
        { class: 'share-copy' },
        'Shifts keeps the last ten snapshots of everything in your own storage: one on the first change of a day, and one immediately before anything replaces your data wholesale. Restoring one replaces everything, and takes a snapshot first.'
      ),
      offline
        ? el(
            'div',
            { class: 'form-note' },
            icon('wifi-off', 15),
            'Snapshots pause while you are offline, so they never sit in the write queue.'
          )
        : null,
      entries.length === 0
        ? el('p', { class: 'coverage-empty' }, 'No restore points yet. One is taken on your first change of the day.')
        : el(
            'div',
            { class: 'card row-list' },
            entries.map((entry) =>
              el(
                'div',
                { class: 'item-row' },
                el(
                  'div',
                  { class: 'item-main' },
                  el('div', { class: 'item-title' }, snapshotWhen(entry.at)),
                  el(
                    'div',
                    { class: 'item-sub' },
                    [
                      describeReason(entry.reason),
                      entry.counts ? describeCounts(entry.counts) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  )
                ),
                el(
                  'button',
                  {
                    class: 'btn btn-sm',
                    onClick: (e) => restoreSnapshot(entry, e.currentTarget),
                  },
                  icon('history', 15),
                  'Restore'
                )
              )
            )
          ),
      el(
        'button',
        {
          class: 'btn btn-block',
          disabled: offline,
          title: offline ? 'Snapshots pause while you are offline' : 'Take a snapshot of everything right now',
          onClick: async (e) => {
            const button = e.currentTarget;
            button.disabled = true;
            const entry = await ctx.snapshots.save(store.state, 'manual');
            if (entry) toast('Restore point taken');
            else toast('Couldn’t take a restore point right now.', 'error');
            renderSnapshots();
          },
        },
        icon('camera', 15),
        'Snapshot now'
      )
    );
  }

  renderSnapshots();

  const modal = openModal({
    title: 'Backup & restore',
    content: [
      el(
        'p',
        { class: 'share-copy' },
        'Your data lives in your Puter account. A backup file is a full copy: keep it somewhere safe, move it to another account, or restore it after a mistake.'
      ),
      el('p', { class: 'export-preview' }, `Right now: ${describeBackup(store.state)}.`),
      el(
        'button',
        { class: 'btn btn-primary btn-block', onClick: exportBackup },
        icon('download', 15),
        'Download backup'
      ),
      el('h3', { class: 'coverage-add-title' }, 'Import from a spreadsheet'),
      el(
        'p',
        { class: 'share-copy' },
        'CSV import adds to what you already have; nothing is replaced or deleted. You’ll see which column is which, and what each row would create, before anything is written.'
      ),
      el(
        'div',
        { class: 'preset-row' },
        el(
          'button',
          { class: 'btn', onClick: () => employeesCSV.click() },
          icon('users', 15),
          'Employees CSV'
        ),
        el(
          'button',
          { class: 'btn', onClick: () => shiftsCSV.click() },
          icon('calendar', 15),
          'Shifts CSV'
        ),
        el(
          'button',
          { class: 'btn', onClick: () => openNameListDialog(ctx) },
          icon('user-plus', 15),
          'Paste names'
        )
      ),
      employeesCSV,
      shiftsCSV,
      el('h3', { class: 'coverage-add-title' }, 'Restore from a backup'),
      el(
        'div',
        { class: 'form-note' },
        icon('warning', 15),
        'A backup restore replaces everything currently in the app with the file’s contents. This is not the CSV import above, which only adds. You’ll see what the file holds before anything changes.'
      ),
      el(
        'button',
        { class: 'btn btn-block', onClick: () => fileInput.click() },
        icon('upload', 15),
        'Choose backup file'
      ),
      fileInput,
      snapshotBox,
      errorBox,
    ],
  });
}
