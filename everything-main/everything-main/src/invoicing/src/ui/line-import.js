/**
 * Fill a document's lines from a spreadsheet: pick a CSV or an Excel
 * workbook, match its columns, see exactly how many lines that makes, then
 * hand them to the editor.
 *
 * Nothing touches the document until Add is pressed, and the arrivals are
 * treated exactly like typed lines — Save still validates them, and the
 * price list still fills a blank rate from a matching name. The parsing and
 * mapping live in lib/csv.js, lib/xlsx.js, and lib/import-csv.js (pure,
 * tested); this is only the sheet around them.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { openModal } from './modal.js';
import { field, selectWrap } from './bits.js';
import { headerProblem } from '../lib/csv.js';
import { readTabularFile } from '../lib/xlsx.js';
import { LINE_ITEM_FIELDS, guessMapping, prepareLineItems } from '../lib/import-csv.js';

/** openLineImport(onAdd) — onAdd receives editor-shaped lines, sans ids. */
export function openLineImport(onAdd) {
  const body = el('div.import-body');
  const modal = openModal({ title: 'Fill lines from a spreadsheet', content: body });

  let parsed = null;      // { header, rows, delimiter }
  let mapping = {};

  // Step swaps land focus like the import wizard's: the button that moved
  // the user here goes out with its step, and a keyboard user must not be
  // dropped on <body> outside a dialog whose page is inert.
  const show = (...nodes) => {
    const inside = body.contains(document.activeElement)
      || document.activeElement === document.body;
    clear(body);
    body.append(...nodes.filter(Boolean));
    if (!inside) return;
    const first = [...body.querySelectorAll('input, select, textarea, button')]
      .find((c) => !c.disabled && !c.hidden
        && (c.offsetWidth || c.offsetHeight || c.getClientRects().length));
    if (first && matchMedia('(min-width: 640px)').matches) first.focus();
    else modal.panel.focus({ preventScroll: true });
  };

  /* ----- Step 1: the file ----- */
  const fileInput = el('input', {
    type: 'file', hidden: true,
    accept: 'text/csv,.csv,.tsv,text/tab-separated-values,text/plain,.xlsx,'
      + 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    onchange: async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';                 // re-picking the same file must fire
      if (!file) return;
      try {
        // CSV or TSV text, or an .xlsx workbook read directly; the formats
        // that need a different export come back named for what they are.
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
        mapping = guessMapping(result.header, LINE_ITEM_FIELDS);
        stepMap();
      } catch (err) {
        console.error(err);
        toast('That file could not be read', { icon: 'alert' });
      }
    },
  });

  function stepFile() {
    show(
      el('p.compose-intro', {},
        'One row per line item, with a header row naming the columns — a description (or timekeeper), '
        + 'the quantity or hours, and optionally a rate, a unit, and a work description. '
        + 'Nothing lands on the document until you have seen what the file makes.'),
      el('div.side-actions', {},
        el('button.btn.btn-primary', {
          html: icon('upload', 15, 1.6),
          onclick: () => fileInput.click(),
        }, ' Choose a spreadsheet'),
        fileInput),
      el('p.card-sub', {},
        'Excel workbooks (.xlsx) and CSV files both work — Google Sheets downloads either, and Numbers exports to Excel. '
        + 'A rate column is optional: a description that matches a saved item fills its rate from your price list.'));
  }

  /* ----- Step 2: the mapping, with the plan it produces ----- */
  function stepMap() {
    const summary = el('p.compose-intro', { 'aria-live': 'polite' });
    const errorsWrap = el('div');
    const addBtn = el('button.btn.btn-primary', {
      onclick: () => {
        const plan = prepareLineItems(parsed.rows, mapping);
        if (!plan.items.length) return;
        onAdd(plan.items.map(({ data }) => data));
        modal.close();
        toast(`${plan.items.length} line${plan.items.length === 1 ? '' : 's'} added`);
      },
    });

    const renderPlan = () => {
      if (mapping.name === undefined) {
        summary.textContent = `${parsed.rows.length} row${parsed.rows.length === 1 ? '' : 's'} read. Map the line description to continue.`;
        clear(errorsWrap);
        addBtn.disabled = true;
        addBtn.textContent = 'Add lines';
        return;
      }
      const plan = prepareLineItems(parsed.rows, mapping);
      const parts = [`${plan.items.length} line${plan.items.length === 1 ? '' : 's'} ready`];
      if (plan.errors.length) parts.push(`${plan.errors.length} row${plan.errors.length === 1 ? '' : 's'} skipped`);
      summary.textContent = parts.join(' · ');
      // The skipped rows, with the file's own row numbers: a silent skip
      // reads as "it worked".
      clear(errorsWrap);
      const shown = plan.errors.slice(0, 6);
      if (shown.length) {
        errorsWrap.append(el('div.card-sub', {},
          shown.map((err) => el('div', {}, `Row ${err.row}: ${err.why}`)),
          plan.errors.length > shown.length
            ? el('div', {}, `…and ${plan.errors.length - shown.length} more.`)
            : null));
      }
      addBtn.disabled = !plan.items.length;
      addBtn.textContent = plan.items.length
        ? `Add ${plan.items.length} line${plan.items.length === 1 ? '' : 's'}`
        : 'Nothing usable yet';
    };

    const pickers = LINE_ITEM_FIELDS.map((f) => {
      // A sample from the file itself is what makes a mapping obvious — of
      // the column picked now, not the one guessed first: left as built,
      // the hint under a picker moved from Price to Cost kept quoting the
      // price while the plan imported the cost.
      const hintFor = () => {
        const col = mapping[f.key];
        const sample = col === undefined ? '' : String(parsed.rows[0]?.[col] ?? '').slice(0, 40);
        return sample ? `e.g. ${sample}` : (f.required ? '(required)' : '(optional)');
      };
      const select = el('select.select', {
        onchange: (e) => {
          const value = e.target.value;
          if (value === '') delete mapping[f.key];
          else mapping[f.key] = Number(value);
          picker.querySelector('.field-hint').textContent = ` ${hintFor()}`;
          renderPlan();
        },
      },
        el('option', { value: '', selected: mapping[f.key] === undefined },
          f.required ? 'Not mapped — required' : 'Not imported'),
        parsed.header.map((h, i) => el('option', { value: String(i), selected: mapping[f.key] === i }, h)));
      const picker = field(f.label, selectWrap(select), { hint: hintFor() });
      return picker;
    });

    renderPlan();
    show(
      summary,
      el('div.field-grid', {}, pickers),
      errorsWrap,
      el('div.side-actions', {},
        el('button.btn.btn-ghost', { onclick: stepFile }, 'Back'),
        addBtn));
  }

  stepFile();
}
