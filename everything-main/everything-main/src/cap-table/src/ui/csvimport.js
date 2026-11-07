/**
 * Import from CSV: the road in for the company that already has a cap table
 * somewhere - a spreadsheet, another platform, a lawyer's Excel export.
 *
 * A three-step wizard: pick what the file holds (stakeholders or
 * securities) and load it; match its columns to CapTable fields, with
 * auto-matching doing the obvious part; then a dry-run preview of exactly
 * what will be created - per-row errors called out, duplicates skipped,
 * unknown share classes offered for creation - before anything is written.
 * The import is additive and goes through the store, so the optimistic-write
 * rollback and the activity log apply like everywhere else.
 */

import { el, clear, append } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { field, segmented, flagInvalid } from './bits.js';
import { store, isRefusal } from '../lib/store.js';
import {
  parseCSV, autoMatch, headerRowIndex, STAKEHOLDER_FIELDS, SECURITY_FIELDS,
  buildStakeholderPlan, buildSecurityPlan,
  STAKEHOLDER_TEMPLATE, SECURITY_TEMPLATE,
  authorizedOverruns,
} from '../lib/csvimport.js';
import { toCSV, downloadFile } from '../lib/util.js';
import { shares as fmtShares, dateLong } from '../lib/format.js';

/* Rows of problems the preview lists before it just becomes a wall. The count
   above the table is the whole number either way, and a line under it says
   what did not fit - the same rule the search dialog's group headings follow,
   rather than truncating in silence. */
const MAX_ERROR_ROWS = 50;

/* Ceilings on the file, before it is read and before it is planned. The
   JSON import caps its file at 20 MB because nothing caps the records a
   collection can hold, and a hundred-thousand-security cap table is rewritten
   across dozens of KV parts on every later edit; this wizard was a second
   door to the same state with no ceiling at all. A spreadsheet of ten
   thousand rows is a few hundred kilobytes; the byte limit catches a
   mis-picked file, the row limit a file this app would choke on. */
const MAX_FILE_BYTES = 10 * 1_048_576;
const MAX_ROWS = 10_000;

// "Stakeholder, Security type, and Date", not "Stakeholder and Security type and Date".
const listed = (words) => (words.length <= 2
  ? words.join(' and ')
  : `${words.slice(0, -1).join(', ')}, and ${words[words.length - 1]}`);

export function openCsvImport({ onDone = null } = {}) {
  const state = {
    step: 'pick',          // 'pick' | 'map' | 'preview'
    type: 'stakeholders',  // 'stakeholders' | 'securities'
    fileName: '',
    headers: [],
    rows: [],
    mapping: {},
    createClasses: true,
  };

  const body = el('div');
  const modal = openModal({ title: 'Import from CSV', content: body, wide: true });

  const fields = () => (state.type === 'stakeholders' ? STAKEHOLDER_FIELDS : SECURITY_FIELDS);

  const plan = () => (state.type === 'stakeholders'
    ? buildStakeholderPlan(state.rows, state.mapping, { stakeholders: store.stakeholders })
    : buildSecurityPlan(state.rows, state.mapping, {
      classes: store.classes, stakeholders: store.stakeholders, securities: store.securities, plans: store.plans,
      splits: store.company.splits || [],
    }));

  /* ---------- Step 1: what and which file ---------- */

  function renderPick() {
    /* The hint belongs to the choice, so it follows it - it used to be
       rendered once with the step and stay stale until the wizard was
       reopened, which is when it matters least. */
    const typeHint = el('p.field-hint', {});
    const syncTypeHint = () => {
      typeHint.hidden = state.type !== 'securities';
      typeHint.textContent = 'Securities reference stakeholders by name, so import stakeholders first.';
    };
    const seg = segmented([
      { value: 'stakeholders', label: 'Stakeholders' },
      { value: 'securities', label: 'Securities' },
    ], {
      // The same words as the caption beside it, so the group's name is the
      // one a sighted user reads and a voice-control user says.
      label: 'What does the file hold?', value: state.type, wide: true,
      onSelect: (value) => { state.type = value; syncTypeHint(); },
    });
    syncTypeHint();

    const fileInput = el('input', {
      type: 'file', accept: '.csv,text/csv', 'aria-label': 'CSV file',
      style: { display: 'none' },
      onchange: (e) => {
        const file = e.target.files?.[0];
        // Clear the input so picking the same file again (after fixing it in a
        // spreadsheet, say) fires change again - a same-path re-pick doesn't.
        e.target.value = '';
        if (!file) return;
        if (file.size > MAX_FILE_BYTES) {
          /* Rounded up to a tenth, never to the nearest whole: a file a few
             hundred kilobytes over read "10 MB, larger than ... 10 MB". */
          toast(`That file is ${Math.ceil((file.size / 1_048_576) * 10) / 10} MB, larger than any cap table spreadsheet `
            + `(the limit is ${MAX_FILE_BYTES / 1_048_576} MB)`, { icon: 'alert' });
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          let rows;
          try {
            /* The ceiling holds while parsing, not after: a 10 MB file of
               one-letter lines is five million rows, and parsed whole it
               took a gigabyte of memory before the refusal could be said. */
            rows = parseCSV(reader.result, { maxRows: MAX_ROWS });
          } catch (err) {
            toast(err.message, { icon: 'alert' });
            return;
          }
          // A title in a single cell above the headings is not the header row.
          const headerAt = headerRowIndex(rows);
          if (rows.length - headerAt < 2) {
            toast('That file has no data rows under its header', { icon: 'alert' });
            return;
          }
          state.fileName = file.name;
          state.headers = rows[headerAt];
          state.rows = rows.slice(headerAt + 1);
          state.mapping = autoMatch(state.headers, fields());
          state.step = 'map';
          render();
        };
        reader.onerror = () => toast('Couldn’t read that file', { icon: 'alert' });
        reader.readAsText(file);
      },
    });

    append(clear(body), [
      el('p.confirm-message', {},
        'Bring an existing cap table in without retyping it. Import is additive: nothing here is replaced or wiped, and stakeholders already on the cap table are skipped.'),
      el('div.field', {},
        el('span.field-label', {}, 'What does the file hold?'), seg, typeHint),
      fileInput,
      el('button.btn.btn-primary.btn-block', {
        type: 'button', style: { padding: '12px' },
        html: icon('upload', 15, 2),
        onclick: () => fileInput.click(),
      }, ' Choose CSV file'),
      /* Two labelled buttons side by side need about 370px, and a phone sheet
         is 280px of content wide - so the pair overflowed, and `center` on a
         flex line that doesn't fit pushes the overflow out both ends at once.
         The left end of a scroll container is the one place scrolling cannot
         reach, so "Stakeholders template" was cut off with no way to get to
         it. They stack instead, each line still centred. */
      el('div.row', { style: { marginTop: '14px', justifyContent: 'center', flexWrap: 'wrap' } },
        el('button.btn.btn-ghost', {
          type: 'button', html: icon('file-down', 14, 2),
          onclick: () => downloadFile('stakeholders-template.csv', toCSV(STAKEHOLDER_TEMPLATE), 'text/csv'),
        }, ' Stakeholders template'),
        el('button.btn.btn-ghost', {
          type: 'button', html: icon('file-down', 14, 2),
          onclick: () => downloadFile('securities-template.csv', toCSV(SECURITY_TEMPLATE), 'text/csv'),
        }, ' Securities template')),
    ]);
  }

  /* ---------- Step 2: map columns ---------- */

  function renderMap() {
    // Kept by field, so a refusal can point at the picker it is about.
    const pickers = new Map();
    const selects = fields().map((f) => {
      const select = el('select.select', {
        'aria-label': `Column for ${f.label}`,
        onchange: (e) => {
          const v = e.target.value;
          state.mapping[f.key] = v === '' ? null : Number(v);
        },
      },
        el('option', { value: '', selected: state.mapping[f.key] === null || state.mapping[f.key] === undefined }, 'Not in this file'),
        state.headers.map((h, i) => el('option', {
          value: String(i), selected: state.mapping[f.key] === i,
          // Two columns under one header are told apart by their position.
        }, !h ? `Column ${i + 1}` : state.headers.indexOf(h) !== state.headers.lastIndexOf(h) ? `${h} (column ${i + 1})` : h)));
      pickers.set(f.key, select);
      return field(`${f.label}${f.required ? '' : ' (optional)'}`, el('div.select-wrap', {}, select));
    });

    append(clear(body), [
      el('p.confirm-message', {},
        `${state.fileName} · ${state.rows.length} data row${state.rows.length === 1 ? '' : 's'}. Match the file’s columns to Cap Table fields; the obvious ones are matched already.`),
      el('div.form-grid', {}, selects),
      /* Back carries the same padding as the step's primary action: the two
         sit side by side, and the default 9px left it 6px shorter than the
         button it is paired with. */
      el('div.row', { style: { marginTop: '10px' } },
        el('button.btn.btn-ghost', {
          type: 'button', style: { flex: '1', padding: '12px' },
          onclick: () => { state.step = 'pick'; render(); },
        }, 'Back'),
        el('button.btn.btn-primary', {
          type: 'button', style: { flex: '2', padding: '12px' },
          onclick: () => {
            const missing = fields().filter((f) => f.required
              && (state.mapping[f.key] === null || state.mapping[f.key] === undefined));
            if (missing.length) {
              /* Flagged and focused, as every other sheet's refusal is: the
                 toast alone left focus on the button and nothing on the
                 pickers to say which of them the sentence meant. */
              for (const f of missing) flagInvalid(pickers.get(f.key));
              pickers.get(missing[0].key)?.focus();
              toast(`Map a column for ${listed(missing.map((f) => f.label))}`, { icon: 'alert' });
              return;
            }
            state.step = 'preview';
            render();
          },
        }, 'Preview import')),
    ]);
  }

  /* ---------- Step 3: dry-run preview, then commit ---------- */

  function renderPreview() {
    const p = plan();
    const creates = p.creates;
    const errors = p.errors;
    const skips = p.skips || [];
    const newClasses = p.newClasses || [];

    const summaryLine = (ic, text, cls = '') => el(`div.small${cls}`, { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '3px 0' } },
      el('span', { html: icon(ic, 14, 2), style: { display: 'inline-flex' } }), el('span', {}, text));

    /* The share-class checkbox below changes what is importable but not the
       shape of this step, so the two things it moves - the count line and the
       import button - are updated in place. Re-rendering the step instead
       destroys the checkbox the user just pressed, and keyboard focus drops
       to the document body mid-decision. */
    let importable = creates;
    const countLine = el('span');
    const importBtn = el('button.btn.btn-primary', {
      type: 'button', style: { flex: '2', padding: '12px' },
    });
    const syncImportable = () => {
      const blocked = newClasses.length > 0 && !state.createClasses;
      importable = blocked
        ? creates.filter((c) => !newClasses.some((n) => n.toLowerCase() === (c.className || '').toLowerCase()))
        : creates;
      const noun = state.type === 'stakeholders'
        ? (importable.length === 1 ? 'stakeholder' : 'stakeholders')
        : (importable.length === 1 ? 'security' : 'securities');
      countLine.textContent =
        `${fmtShares(importable.length)} of ${fmtShares(state.rows.length)} rows will be created`;
      importBtn.disabled = state.busy || importable.length === 0;
      importBtn.textContent = importable.length
        ? `Import ${fmtShares(importable.length)} ${noun}`
        : 'Nothing to import';
    };
    syncImportable();

    /* Disabled together with Import while the write is in flight: Back,
       Preview and a freshly built Import button would land the same rows a
       second time - the securities plan does not dedupe. */
    const backBtn = el('button.btn.btn-ghost', {
      type: 'button', style: { flex: '1', padding: '12px' },
      onclick: () => { state.step = 'map'; render(); },
    }, 'Back');
    const classCheck = newClasses.length ? el('input', {
      type: 'checkbox', checked: state.createClasses,
      onchange: (e) => { state.createClasses = e.target.checked; syncImportable(); },
    }) : null;
    importBtn.addEventListener('click', async () => {
      if (state.busy) return;
      importBtn.disabled = true;
      backBtn.disabled = true;
      // Changing this choice used to re-enable Import during the pending
      // write, allowing the same CSV rows to be issued a second time.
      if (classCheck) classCheck.disabled = true;
      state.busy = true;
      try {
        const result = state.type === 'stakeholders'
          ? await store.importRecords({ stakeholders: importable })
          : await store.importRecords({
            securities: importable,
            classNames: state.createClasses ? newClasses : [],
          });
        store.logActivity(state.type === 'stakeholders'
          ? `Imported ${result.stakeholders} stakeholder${result.stakeholders === 1 ? '' : 's'} from ${state.fileName}`
          : `Imported ${result.securities} securit${result.securities === 1 ? 'y' : 'ies'} from ${state.fileName}`, 'upload');
        toast('Import complete');
        modal.close();
        onDone?.();
      } catch (err) {
        console.error(err);
        toast(isRefusal(err) ? err.message : 'Couldn’t import. Check your connection',
          { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
        state.busy = false;
        syncImportable();
        backBtn.disabled = false;
        if (classCheck) classCheck.disabled = false;
      }
    });

    append(clear(body), [
      /* The restore point is promised only when one will be taken: the store
         snapshots nothing for a company that holds nothing, so the first
         import into a fresh company has no point to roll back to. */
      el('p.confirm-message', {},
        'Nothing has been written yet. This is exactly what the import will create.'
        + (store.hasData ? ' A restore point is taken first, so the whole import can be rolled back from Settings.' : '')),
      el('div', { style: { marginBottom: '12px' } },
        summaryLine('check', countLine),
        /* One line per reason: a row repeating a name from earlier in the
           same file is a different thing to fix than a holder who is here
           already, and both used to read as the latter. */
        ...[['Already on the cap table', 'already on the cap table'], ['Earlier in this file', 'repeated from an earlier row']].map(([reason, said]) => {
          const these = skips.filter((k) => k.reason === reason);
          return these.length
            ? summaryLine('info', `${fmtShares(these.length)} skipped: ${said} (${these.slice(0, 4).map((k) => k.name).join(', ')}${these.length > 4 ? '…' : ''})`)
            : null;
        }),
        /* Said, not skipped: two identical grants on one day are two grants,
           but a file imported twice doubled the cap table in silence. */
        p.repeated ? summaryLine('info', `${fmtShares(p.repeated)} ${p.repeated === 1 ? 'row matches a security' : 'rows match securities'} `
          + 'already on the cap table (same holder, type, amount and date) and will be created again', '.warn') : null,
        p.presplit ? summaryLine('info', `${fmtShares(p.presplit.rows)} ${p.presplit.rows === 1 ? 'row is' : 'rows are'} dated before the `
          + `${p.presplit.split.num}-for-${p.presplit.split.den} split of ${dateLong(p.presplit.split.date)}. Share counts and prices are `
          + 'taken in today’s post-split units, as everywhere in the app; earlier dates read them back in their own units', '.warn') : null,
        errors.length ? summaryLine('alert', `${fmtShares(errors.length)} row${errors.length === 1 ? '' : 's'} with problems won’t be imported`, '.warn') : null,
        /* Said before the write, as every sheet that issues shares says it:
           a file that took a class past its authorized count imported without
           a word, and the classes table said "over authorized" afterwards. */
        ...(state.type === 'securities' ? authorizedOverruns(store.db, creates) : []).map((hit) => summaryLine('alert',
          `${hit.name} will hold ${fmtShares(hit.over)} more ${hit.over === 1 ? 'share' : 'shares'} than its authorized count of `
          + `${fmtShares(hit.authorized)} after this import. That is what a charter amendment is for; raise the authorized shares `
          + 'under Share classes once it is signed.', '.warn'))),

      newClasses.length ? el('label.check-row', { style: { margin: '2px 0 12px' } },
        classCheck,
        el('span', {}, `Create ${newClasses.length === 1 ? 'the missing share class' : 'the missing share classes'}: ${newClasses.join(', ')}`)) : null,

      errors.length ? el('div', {},
        /* A scroll box with nothing focusable inside it, so it carries the
           same focusable-region attributes as the cap table's scrollers:
           without them a keyboard user could reach only the first screen
           of problems. */
        el('div.table-wrap', {
          tabindex: 0, role: 'region', 'aria-label': 'Rows with problems',
          style: { margin: '0 0 6px', maxHeight: '200px', overflowY: 'auto' },
        },
          el('table.data', { style: { minWidth: '0' } },
            el('thead', {}, el('tr', {},
              el('th', { scope: 'col' }, 'Line'),
              el('th', { scope: 'col' }, 'Problem'))),
            el('tbody', {}, errors.slice(0, MAX_ERROR_ROWS).map((e2) => el('tr', {},
              el('td', {}, String(e2.line)),
              el('td', {}, e2.message)))))),
        errors.length > MAX_ERROR_ROWS
          ? el('p.field-hint', { style: { margin: '0 0 14px' } },
            `${fmtShares(errors.length - MAX_ERROR_ROWS)} more `
            + `${errors.length - MAX_ERROR_ROWS === 1 ? 'row has' : 'rows have'} problems too. `
            + 'Fix what is listed, then import the file again to see the rest.')
          : el('div', { style: { height: '8px' } })) : null,

      el('div.row', {},
        backBtn,
        importBtn),
    ]);
  }

  function render() {
    if (state.busy) return;
    if (state.step === 'pick') renderPick();
    else if (state.step === 'map') renderMap();
    else renderPreview();
    modal.panel.scrollTop = 0;
    /* A step swap replaces everything in the panel, the control that asked for
       it included - so keyboard focus lands on the document body, and a screen
       reader is left with nothing to read on the step it just moved to. The
       dialog itself is where to put it back: the next step's own first control
       is "Back", which is not where anyone means to be after pressing forward.
       Harmless on the first render, which openModal's own focus follows. */
    modal.panel.focus({ preventScroll: true });
  }

  render();
}
