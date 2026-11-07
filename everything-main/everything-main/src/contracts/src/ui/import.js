/**
 * Getting data in: restoring a Contract Manager export, and importing a
 * spreadsheet.
 *
 * Both paths show what will happen before anything is written — a restore
 * says what it is about to replace, and a CSV import shows the first rows
 * parsed with the current column mapping, so a wrong guess is visible while
 * it is still free to fix.
 */

import { el, clear, append } from './dom.js';
import { icon } from './icons.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { uid, formatBytes, DOT } from '../lib/util.js';
import {
  parseTable, guessMapping, buildImport, previewFields, localeDateOrder,
  IMPORT_FIELDS, sniffDelimiter,
} from '../lib/csv.js';
import { field, select } from './bits.js';

const PREVIEW_ROWS = 3;

/** Far past any real contract book; the point is to refuse before the tab hangs. */
const MAX_CSV_BYTES = 10 * 1024 * 1024;

/** Read a picked file as text; every import path starts here. */
function readText(file) {
  return file.text ? file.text() : new Response(file).text();
}

/* ------------------------------------------------------------------ */
/* Restore from an export                                              */
/* ------------------------------------------------------------------ */

export function openRestore() {
  const body = el('div');
  const fileInput = el('input', {
    type: 'file', accept: '.json,application/json', style: { display: 'none' },
    onchange: async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      let data;
      try {
        data = JSON.parse(await readText(file));
      } catch {
        renderProblem('That file is not readable JSON. Pick the file this app exported.');
        return;
      }
      if (data?.app !== 'contract-manager' || !Array.isArray(data.contracts)) {
        renderProblem('That JSON was not exported by Contract Manager, so restoring it could not be safe.');
        return;
      }
      renderSummary(data, file.name);
    },
  });

  function renderPick() {
    clear(body);
    append(body, [
      el('p.modal-note', {},
        'Pick the JSON file this app exported. It contains your contracts, contacts and settings.'),
      el('button.btn.btn-primary.btn-block', {
        html: icon('fileUp', 15, 2),
        onclick: () => fileInput.click(),
      }, ' Choose a backup file'),
      fileInput,
      el('p.field-hint', { style: { marginTop: '12px' } },
        'A JSON export does not contain your attached documents; those stay in your Puter cloud. Restoring reconnects the contracts to the files that are still there.'),
    ]);
  }

  function renderProblem(message) {
    clear(body);
    append(body, [
      el('div.callout.callout-danger', {},
        el('span', { html: icon('warning', 18, 2) }),
        el('div', {}, message)),
      el('button.btn.btn-primary.btn-block', { onclick: renderPick }, 'Try another file'),
      fileInput,
    ]);
  }

  function renderSummary(data, filename) {
    clear(body);
    const contracts = data.contracts.length;
    const contacts = Array.isArray(data.contacts) ? data.contacts.length : 0;
    const exportedAt = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : null;
    const current = store.contracts.length + store.contacts.length;

    const restore = el('button.btn.btn-primary.btn-block', {
      onclick: async () => {
        if (current > 0) {
          const ok = await confirmDialog({
            title: 'Replace everything?',
            message: `The ${store.contracts.length} contract${store.contracts.length === 1 ? '' : 's'} and ${store.contacts.length} contact${store.contacts.length === 1 ? '' : 's'} in the app now are removed and replaced by this file. This cannot be undone.`,
            confirmLabel: 'Replace everything',
          });
          if (!ok) return;
        }
        restore.disabled = true;
        try {
          await store.importAll(data);
          modal.close();
          toast(`Restored ${contracts} contract${contracts === 1 ? '' : 's'}`, { icon: 'undo' });
        } catch (err) {
          console.error(err);
          restore.disabled = false;
          toast('Could not restore. Check your connection', { icon: 'wifiOff' });
        }
      },
    }, `Restore ${contracts} contract${contracts === 1 ? '' : 's'} and ${contacts} contact${contacts === 1 ? '' : 's'}`);

    append(body, [
      el('div.callout.callout-ok', {},
        el('span', { html: icon('done', 18, 2) }),
        el('div', {},
          el('strong', {}, filename),
          el('div.callout-sub', {},
            `${contracts} contract${contracts === 1 ? '' : 's'}, ${contacts} contact${contacts === 1 ? '' : 's'}${exportedAt ? `${DOT}exported ${exportedAt}` : ''}`))),
      current > 0
        ? el('p.modal-note', {}, 'This is a restore, so it replaces what is in the app rather than adding to it.')
        : el('p.modal-note', {}, 'The app is empty, so nothing will be overwritten.'),
      restore,
      el('button.btn.btn-ghost.btn-block', { style: { marginTop: '8px' }, onclick: renderPick }, 'Pick a different file'),
      fileInput,
    ]);
  }

  renderPick();
  const modal = openModal({ title: 'Restore from a backup', content: body });
  return modal;
}

/* ------------------------------------------------------------------ */
/* Import a spreadsheet                                                */
/* ------------------------------------------------------------------ */

export function openCsvImport() {
  const body = el('div');
  let table = { headers: [], rows: [] };
  let mapping = {};
  let dateOrder = localeDateOrder();

  const fileInput = el('input', {
    type: 'file', accept: '.csv,.tsv,text/csv,text/plain', style: { display: 'none' },
    onchange: async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      // Parsing is a character-at-a-time pass on the main thread; a file this
      // far outside "a spreadsheet of contracts" would lock the tab up rather
      // than import anything.
      if (file.size > MAX_CSV_BYTES) {
        renderProblem(`That file is ${formatBytes(file.size)}. CSV imports are limited to ${formatBytes(MAX_CSV_BYTES)}.`);
        return;
      }
      let text;
      try {
        text = await readText(file);
      } catch {
        renderProblem('That file could not be read. Try picking it again.');
        return;
      }
      table = parseTable(text);
      if (!table.headers.length || !table.rows.length) {
        renderProblem('That file has no rows to import. It needs a header row and at least one contract.');
        return;
      }
      mapping = guessMapping(table.headers);
      renderMapping(file.name, sniffDelimiter(text));
    },
  });

  function renderPick() {
    clear(body);
    append(body, [
      el('p.modal-note', {},
        'Export your spreadsheet as CSV, then pick it here. The first row must be the column names.'),
      el('button.btn.btn-primary.btn-block', {
        html: icon('fileUp', 15, 2),
        onclick: () => fileInput.click(),
      }, ' Choose a CSV file'),
      fileInput,
      el('p.field-hint', { style: { marginTop: '12px' } },
        'Imported contracts are added to your book; nothing already in it is touched. Columns you do not map are kept in the contract notes.'),
    ]);
  }

  function renderProblem(message) {
    clear(body);
    append(body, [
      el('div.callout.callout-danger', {},
        el('span', { html: icon('warning', 18, 2) }),
        el('div', {}, message)),
      el('button.btn.btn-primary.btn-block', { onclick: renderPick }, 'Try another file'),
      fileInput,
    ]);
  }

  function renderMapping(filename, delimiter) {
    clear(body);
    const columnOptions = [
      { value: '', label: 'Not imported' },
      ...table.headers.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` })),
    ];

    const preview = el('div.import-preview');
    const rowsField = el('div');

    const importOptions = () => ({
      existingContacts: store.contacts,
      dateOrder,
      currency: store.settings.currency,
      noticeDefault: store.settings.noticeDefault,
    });

    /* One pass over the sheet per change, not three: the preview and the
       button both read the same build. */
    const refresh = () => {
      const options = importOptions();
      const { contracts, skipped } = buildImport(table, mapping, options);

      clear(preview);
      for (const row of table.rows.slice(0, PREVIEW_ROWS)) {
        const { shown, problems } = previewFields(row, mapping, table.headers, options);
        preview.append(el('div.import-card', {},
          problems.length
            ? el('div.import-problem', { html: icon('warning', 13, 2.2) }, ` Skipped: ${problems.join('; ')}`)
            : null,
          el('dl.import-fields', {}, shown.map(([label, value]) =>
            el('div', {}, el('dt', {}, label), el('dd', {}, value))))
        ));
      }
      if (skipped.length) {
        preview.append(el('p.import-skipped', {},
          `${skipped.length} of ${table.rows.length} rows cannot be imported yet: ${skipped.slice(0, 3).map((s) => `row ${s.row} (${s.reasons[0]})`).join(', ')}${skipped.length > 3 ? ', …' : ''}`));
      }

      importBtn.textContent = contracts.length
        ? `Import ${contracts.length} contract${contracts.length === 1 ? '' : 's'}`
        : 'Nothing to import yet';
      importBtn.disabled = contracts.length === 0;
    };

    /*
     * The mapping step is fourteen identical dropdowns, and which contract
     * field each one fills is said only by the label beside it. Untied, that
     * label was decoration: a screen reader read fourteen "Not imported"
     * combo boxes in a row with nothing to tell Title from Notes, and on a
     * phone — where the label sits directly above its select — pressing it
     * did nothing.
     */
    for (const f of IMPORT_FIELDS) {
      const sel = select(columnOptions,
        mapping[f.key] === undefined || mapping[f.key] === null ? '' : String(mapping[f.key]));
      sel.id = `map-${f.key}`;
      sel.addEventListener('change', () => {
        if (sel.value === '') delete mapping[f.key];
        else mapping[f.key] = Number(sel.value);
        refresh();
      });
      rowsField.append(el('div.map-row', {},
        el('label.map-label', { htmlFor: sel.id }, f.label,
          f.required ? el('span.map-required', {}, ' required') : null),
        el('div.select-wrap.grow', {}, sel)
      ));
    }

    const orderSel = select([
      { value: 'dmy', label: 'Day / Month / Year (31/01/2026)' },
      { value: 'mdy', label: 'Month / Day / Year (01/31/2026)' },
    ], dateOrder);
    orderSel.addEventListener('change', () => { dateOrder = orderSel.value; refresh(); });

    const importBtn = el('button.btn.btn-primary.btn-block', {
      onclick: async () => {
        const { contracts, newContacts, skipped } = buildImport(table, mapping, importOptions());
        if (!contracts.length) {
          toast('No rows can be imported with this mapping', { icon: 'info' });
          return;
        }
        importBtn.disabled = true;
        try {
          // Ids are minted here rather than by saving each contact in turn, so
          // the contracts can be linked before anything is written. A sheet
          // with 150 counterparties used to cost 150 sequential round-trips,
          // each rewriting the whole contacts file and re-rendering every view;
          // it is now one write per file and one render.
          const created = newContacts.map((c) => ({ id: uid(), name: c.name }));
          const byName = new Map(store.contacts.map((c) => [c.name.trim().toLowerCase(), c.id]));
          for (const c of created) byName.set(c.name.trim().toLowerCase(), c.id);
          const ready = contracts.map(({ contactName, ...c }) => ({
            ...c,
            contactId: contactName ? byName.get(contactName.trim().toLowerCase()) || null : null,
          }));
          await store.importAll({ contracts: ready, contacts: created }, { mode: 'merge' });
          modal.close();
          renderDone(contracts.length, newContacts.length, skipped);
        } catch (err) {
          console.error(err);
          importBtn.disabled = false;
          toast('Could not import. Check your connection', { icon: 'wifiOff' });
        }
      },
    }, 'Import');

    refresh();

    append(body, [
      el('p.modal-note', {},
        `${filename}: ${table.rows.length} row${table.rows.length === 1 ? '' : 's'}, ${table.headers.length} column${table.headers.length === 1 ? '' : 's'}${delimiter !== ',' ? `, separated by "${delimiter === '\t' ? 'tab' : delimiter}"` : ''}.`),
      el('h3.card-title', { style: { marginBottom: '8px' } }, 'Match your columns'),
      rowsField,
      field('Date order in this file', orderSel, {
        hint: 'Only matters for numeric dates like 03/04/2026.',
      }),
      el('h3.card-title', { style: { margin: '16px 0 8px' } },
        `First ${Math.min(PREVIEW_ROWS, table.rows.length)} row${table.rows.length === 1 ? '' : 's'}, as they will be saved`),
      preview,
      importBtn,
      el('button.btn.btn-ghost.btn-block', { style: { marginTop: '8px' }, onclick: renderPick }, 'Pick a different file'),
      fileInput,
    ]);
  }

  function renderDone(imported, contactsCreated, skipped) {
    const doneBody = el('div');
    append(doneBody, [
      el('div.callout.callout-ok', {},
        el('span', { html: icon('done', 18, 2) }),
        el('div', {},
          el('strong', {}, `${imported} contract${imported === 1 ? '' : 's'} imported`),
          contactsCreated
            ? el('div.callout-sub', {}, `${contactsCreated} new contact${contactsCreated === 1 ? '' : 's'} created from the counterparty column.`)
            : null)),
      skipped.length
        ? el('div', {},
          el('h3.card-title', { style: { margin: '4px 0 8px' } }, `${skipped.length} row${skipped.length === 1 ? '' : 's'} skipped`),
          el('div.list', {}, skipped.map((s) =>
            el('div.list-row', {},
              el('span.badge.badge-muted', {}, `Row ${s.row}`),
              el('div.grow.min0', {}, el('div.row-sub.wrap', {}, s.reasons.join('; ')))))),
          el('p.field-hint', { style: { marginTop: '8px' } },
            'Fix these rows in your spreadsheet and import the file again. The contracts that came in are already saved.'))
        : null,
      el('a.btn.btn-primary.btn-block', {
        href: '#/contracts', style: { marginTop: '12px' },
        onclick: () => doneModal.close(),
      }, 'See the contracts'),
    ]);
    const doneModal = openModal({ title: 'Import finished', content: doneBody });
  }

  renderPick();
  const modal = openModal({ title: 'Import from a spreadsheet', content: body, wide: true });
  return modal;
}
