/**
 * The spreadsheet import wizard: pick a CSV or an Excel workbook, map its
 * columns, look at exactly what will happen, then write.
 *
 * Nothing is written before the last step, and the dry run is the same plan
 * the write then executes (lib/import-csv.js). A row that fails mid-import
 * does not roll the earlier ones back: the summary says what was written and
 * what was not, because half an import you can see is far easier to finish
 * than a silent rollback of forty rows.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { openModal } from './modal.js';
import { field, selectWrap } from './bits.js';
import { store } from '../lib/store.js';
import { uid } from '../lib/util.js';
import { headerProblem } from '../lib/csv.js';
import { readTabularFile } from '../lib/xlsx.js';
import {
  CLIENT_FIELDS, INVOICE_FIELDS, guessMapping, prepareClients, prepareInvoices, importSummary,
} from '../lib/import-csv.js';
import { addDays, yearOf } from '../lib/dates.js';
import { billingDefaults } from '../lib/doc.js';
import { fmtMoney } from '../lib/money.js';

const KINDS = {
  clients: { label: 'Clients', fields: CLIENT_FIELDS },
  invoices: { label: 'Open invoices', fields: INVOICE_FIELDS },
};

/** openImportWizard('clients' | 'invoices') */
export function openImportWizard(kind = 'clients') {
  const fields = KINDS[kind].fields;
  const body = el('div.import-body');
  const modal = openModal({ title: `Import ${KINDS[kind].label.toLowerCase()} from a spreadsheet`, content: body });

  let parsed = null;      // { header, rows, delimiter }
  let mapping = {};
  const pickerFor = {};   // field key -> its column select, for a refusal to land on
  let dayFirst = false;
  let advanceNumbering = false;

  const show = (...nodes) => {
    // Whether this step is replacing the one the user is standing in. The
    // button that moved them here goes out with it, and keyboard focus falls
    // to <body> — outside a dialog whose page is inert, with nothing on
    // screen to say the next step arrived. Onboarding's steps land focus for
    // exactly this reason; so do these.
    const inside = body.contains(document.activeElement)
      || document.activeElement === document.body;
    clear(body);
    body.append(...nodes.filter(Boolean));
    if (!inside) return;
    const first = [...body.querySelectorAll('input, select, textarea, button')]
      .find((c) => !c.disabled && !c.hidden
        && (c.offsetWidth || c.offsetHeight || c.getClientRects().length));
    // The first field on a desktop; on a phone the panel, where a keyboard
    // popping up would otherwise cover the step that just arrived.
    if (first && matchMedia('(min-width: 640px)').matches) first.focus();
    else modal.panel.focus({ preventScroll: true });
  };

  /* ----- Step 1: the file ----- */
  const fileInput = el('input', {
    type: 'file', hidden: true,
    accept: 'text/csv,.csv,.tsv,text/plain,.xlsx,'
      + 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    onchange: async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';                 // re-picking the same file must fire
      if (!file) return;
      try {
        // CSV or TSV text, or an .xlsx workbook read directly (lib/xlsx.js);
        // the formats that need a different export are named for what they are.
        const result = await readTabularFile(file);
        const problem = result.problem || headerProblem(result.header);
        if (problem) {
          toast(problem, { icon: 'alert' });
          return;
        }
        if (!result.rows.length) {
          toast('That file has a header but no rows', { icon: 'alert' });
          return;
        }
        parsed = result;
        mapping = guessMapping(result.header, fields);
        stepMap();
      } catch (err) {
        console.error(err);
        toast('That file could not be read', { icon: 'alert' });
      }
    },
  });

  function stepFile() {
    show(
      el('p.compose-intro', {}, kind === 'clients'
        ? 'One row per client, with a header row naming the columns. Everything is mapped by hand in the next step, and nothing is written until you have seen exactly what will happen.'
        : 'One row per unpaid invoice, with a header row naming the columns. Each becomes a single-line invoice marked as sent, so Outstanding, aging, and statements are right from day one.'),
      el('div.side-actions', {},
        el('button.btn.btn-primary', {
          html: icon('upload', 15, 1.6),
          onclick: () => fileInput.click(),
        }, ' Choose a spreadsheet'),
        fileInput),
      kind === 'invoices'
        ? el('p.card-sub', {}, 'Import your clients first if you have them in a file too: invoices match a client by email, then by name, and create one for any name they cannot find.')
        : null);
  }

  /* ----- Step 2: the mapping ----- */
  function stepMap() {
    const pickers = fields.map((f) => {
      // A sample from the file itself is what makes a mapping obvious — of
      // the column picked now, not the one guessed first (see line-import).
      const hintFor = () => {
        const col = mapping[f.key];
        const sample = col === undefined ? '' : String(parsed.rows[0]?.[col] ?? '').slice(0, 40);
        return sample ? `e.g. ${sample}` : (f.required ? '(required)' : '(optional)');
      };
      const select = el('select.select', {
        onchange: (e) => {
          const value = e.target.value;
          mapping[f.key] = value === '' ? undefined : Number(value);
          if (value === '') delete mapping[f.key];
          picker.querySelector('.field-hint').textContent = ` ${hintFor()}`;
        },
      },
        el('option', { value: '', selected: mapping[f.key] === undefined }, f.required ? 'Not mapped — required' : 'Not imported'),
        parsed.header.map((h, i) => el('option', { value: String(i), selected: mapping[f.key] === i }, h)));
      pickerFor[f.key] = select;
      const picker = field(f.label, selectWrap(select), { hint: hintFor() });
      return picker;
    });

    const dayFirstBox = el('input', {
      type: 'checkbox', checked: dayFirst,
      onchange: (e) => { dayFirst = e.target.checked; },
    });

    show(
      el('p.compose-intro', {},
        `${parsed.rows.length} row${parsed.rows.length === 1 ? '' : 's'} read. Match each column to a field — the guesses below come from your header row.`),
      el('div.field-grid', {}, pickers),
      kind === 'invoices'
        ? el('div.field', {}, el('label.check-row', {}, dayFirstBox,
          el('span', {}, 'Dates are day/month/year',
            el('span.field-hint', {}, ' (03/04/2026 means 3 April)'))))
        : null,
      el('div.side-actions', {},
        el('button.btn.btn-ghost', { onclick: stepFile }, 'Back'),
        el('button.btn.btn-primary', { onclick: stepPreview }, 'Preview the import')));
  }

  /* ----- Step 3: the dry run ----- */
  function plan() {
    return kind === 'clients'
      ? prepareClients(parsed.rows, mapping, store.clients)
      : prepareInvoices(parsed.rows, mapping, {
        clients: store.clients,
        // The trash included: a number a trashed invoice carries is still
        // taken — restoring it would put two of them side by side.
        docs: [...store.docs(), ...store.trash().docs],
        currency: store.settings.currency,
        dayFirst,
        termsDays: billingDefaults(store.settings).paymentTermsDays,
      });
  }

  function stepPreview() {
    const missing = fields.filter((f) => f.required && mapping[f.key] === undefined);
    if (missing.length) {
      toast(`${missing.map((f) => f.label).join(' and ')} must be mapped`, { icon: 'alert' });
      // On the picker that has the problem, as every other refusal in the
      // app lands on its field, rather than left on the Preview button.
      pickerFor[missing[0].key]?.focus();
      return;
    }
    const result = plan();
    // Rows the file lists but the import will not write, with their own row
    // numbers: a silent skip reads as "it worked".
    const errorList = result.errors.slice(0, 8);
    const rest = result.errors.length - errorList.length;
    const clashList = (result.clashes || []).slice(0, 8);
    const moreClashes = (result.clashes || []).length - clashList.length;

    const rows = kind === 'clients'
      ? result.create.slice(0, 5).map(({ data }) =>
        el('div.rep-client', {},
          el('span.rep-client-main', {},
            el('span.rep-client-name', {}, data.company || data.name),
            el('span.rep-client-sub', {}, [data.email, data.phone].filter(Boolean).join(' · ') || 'No contact details'))))
      : result.create.slice(0, 5).map(({ doc, paid }) =>
        el('div.rep-client', {},
          el('span.rep-client-main', {},
            el('span.rep-client-name', {}, doc.number),
            el('span.rep-client-sub', {},
              `${doc.issueDate} · ${fmtMoney(doc.items[0].rate, doc.currency)}`
              + (paid ? ` · ${fmtMoney(paid, doc.currency)} already paid` : ''))),
          el('span.rep-client-amount', {}, fmtMoney(doc.items[0].rate - paid, doc.currency))));

    const advanceBox = el('input', {
      type: 'checkbox', checked: advanceNumbering,
      onchange: (e) => { advanceNumbering = e.target.checked; },
    });

    show(
      el('p.compose-intro', {}, importSummary(result, kind)),
      result.create.length
        ? el('div.rep-rows', {}, rows,
          result.create.length > rows.length
            ? el('p.card-sub', {}, `…and ${result.create.length - rows.length} more.`)
            : null)
        : el('p.card-sub', {}, 'Nothing in this file can be imported with the current mapping. Go back and check the columns.'),
      result.errors.length
        ? el('div', {},
          el('p.card-sub', {}, 'Skipped rows:'),
          el('ul.import-errors', {}, errorList.map((e) => el('li', {}, `Row ${e.row}: ${e.why}`)),
            rest > 0 ? el('li', {}, `…and ${rest} more.`) : null))
        : null,
      // The one thing here that is not refused and not undoable: a number
      // this account (or the file itself) already carries. The summary
      // counted them; a count is not something anyone can act on, and every
      // other problem on this step is named row by row.
      clashList.length
        ? el('div', {},
          el('p.card-sub', {}, 'Numbers you already have. These rows still import, and two documents end up sharing each of them:'),
          el('ul.import-errors', {}, clashList.map((n) => el('li', {}, n)),
            moreClashes > 0 ? el('li', {}, `…and ${moreClashes} more.`) : null))
        : null,
      kind === 'invoices' && result.create.length
        ? el('div.field', {}, el('label.check-row', {}, advanceBox,
          el('span', {}, 'Continue my numbering after these',
            el('span.field-hint', {}, ' (otherwise your next invoice keeps the number it would have had)'))))
        : null,
      el('div.side-actions', {},
        el('button.btn.btn-ghost', { onclick: stepMap }, 'Back'),
        result.create.length
          ? el('button.btn.btn-primary', {
            onclick: (e) => runImport(result, e.currentTarget),
          }, `Import ${result.create.length} ${kind === 'clients' ? 'client' : 'invoice'}${result.create.length === 1 ? '' : 's'}`)
          : null));
  }

  /* ----- The write ----- */
  async function runImport(result, button) {
    button.disabled = true;
    // The sheet stays up until the last row is written: Escape (or the
    // scrim) used to hide the progress while the writes went on, with the
    // page underneath live again — and a second import of the same file
    // could start beside the first and double every number.
    modal.lock('Still importing — the rows are being written');
    show(el('p.compose-intro', {}, 'Importing…'));
    let written = 0;
    const failed = [];
    try {
      if (kind === 'clients') {
        for (const { row, data } of result.create) {
          try {
            await store.addClient(data);
            written++;
          } catch (err) {
            console.error(err);
            failed.push(row);
          }
        }
      } else {
        // A client named by an invoice row but not on file yet is created
        // once, up front, so every row that names them lands on one client.
        const created = new Map();
        for (const c of result.newClients) {
          try {
            const saved = await store.addClient({ name: c.name, email: c.email });
            created.set(c.name.toLowerCase(), saved.id);
          } catch (err) {
            console.error(err);
          }
        }
        let highest = 0;
        // Under yearly numbering each year keeps its own counter, so the
        // highest number is tracked per year too: an import of last year's
        // invoices must advance last year's sequence, not this year's.
        const highestPerYear = new Map();
        for (const entry of result.create) {
          try {
            const clientId = entry.clientId || created.get(entry.newClient) || '';
            // The plan refused rows that named nobody; a row whose client
            // could not be created must not slip past that as an invoice
            // with no client, counted as imported.
            if (entry.newClient && !clientId) {
              failed.push(entry.row);
              continue;
            }
            // A row with no due date takes the terms the editor would have
            // filled in for this client — their own when they carry any, the
            // account's otherwise — not the account's for everyone: an
            // imported invoice for a client on 30-day terms was due in 14.
            const { paymentTermsDays } = billingDefaults(store.settings, store.client(clientId));
            const doc = {
              ...entry.doc,
              id: uid(),
              clientId,
              dueDate: entry.doc.dueDate || addDays(entry.doc.issueDate, paymentTermsDays),
              createdAt: Date.now(),
            };
            // Not taught to the Saved-items list: an imported row is an
            // opening balance or a copied description at the invoice's
            // total, and a hundred of them evicted every item the user had
            // curated (the list is capped) — or repriced one to the total.
            await store.saveDoc(doc, { learn: false });
            if (entry.paid > 0.005) {
              await store.addPayment(doc.id, {
                date: doc.issueDate,
                amount: entry.paid,
                method: '',
                note: 'Imported',
              });
            }
            const digits = String(doc.number).match(/(\d+)\s*$/);
            if (digits) {
              const n = Number(digits[1]);
              const year = yearOf(doc.issueDate);
              highest = Math.max(highest, n);
              highestPerYear.set(year, Math.max(highestPerYear.get(year) || 0, n));
            }
            written++;
          } catch (err) {
            console.error(err);
            failed.push(entry.row);
          }
        }
        // Imported numbers only touch the counter when the user asked, and
        // only ever forwards: a counter that went backwards would hand out a
        // number an imported invoice already carries. The counter written is
        // the one the next invoice will actually draw from — under yearly
        // numbering that is each year's own, and writing the lifetime counter
        // instead left the checkbox doing nothing at all.
        if (advanceNumbering) {
          if (store.settings.numberYearly?.invoice) {
            const all = store.settings.yearNext || {};
            const invoice = { ...(all.invoice || {}) };
            let moved = false;
            for (const [year, n] of highestPerYear) {
              if (n >= store.nextNumberValue('invoice', `${year}-01-01`)) {
                invoice[year] = n + 1;
                moved = true;
              }
            }
            if (moved) {
              await store.updateSettings({ yearNext: { ...all, invoice } }).catch(() => {});
            }
          } else if (highest >= store.nextNumberValue('invoice')) {
            await store.updateSettings({ nextInvoice: highest + 1 }).catch(() => {});
          }
        }
      }
    } finally {
      modal.lock(null);
      modal.close();
    }
    const noun = kind === 'clients' ? 'client' : 'invoice';
    toast(`${written} ${noun}${written === 1 ? '' : 's'} imported`
      + (failed.length ? `, ${failed.length} could not be written` : ''),
    { icon: failed.length ? 'alert' : 'circleCheck' });
  }

  stepFile();
  return modal;
}
