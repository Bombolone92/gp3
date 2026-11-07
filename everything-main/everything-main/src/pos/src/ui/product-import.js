/**
 * Import a catalog from a spreadsheet.
 *
 * Three panes in one sheet: pick the file, point the columns at the right
 * fields (guessed first, since nobody's export shares a header format), then
 * read exactly what will happen before anything is written - the same
 * previewed path a backup restore takes, for the same reason.
 */

import { el, clear, append, keepFocus } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { downloadBlob } from './download.js';
import { store } from '../lib/store.js';
import { csvBlob } from '../lib/csv.js';
import {
  readCatalogFile, guessMapping, guessFromRows, looksLikeHeader, planImport, matchLabel,
  catalogCsv, ImportError, IMPORT_FIELDS, MAX_IMPORT_ROWS,
} from '../lib/product-csv.js';
import { todayISO } from '../lib/dates.js';
import { plural } from '../lib/util.js';

/** How many skipped rows the review lists by name before summarizing. */
const SKIPPED_SHOWN = 8;

/** Download the catalog: a shop's own list, and the import's own template. */
export function exportCatalogCsv() {
  const text = catalogCsv(store.products, store);
  downloadBlob(csvBlob(text), `catalog-${todayISO()}.csv`);
  toast(store.products.length
    ? `Catalog CSV downloaded · ${plural(store.products.length, 'product')}`
    : 'Empty catalog CSV downloaded — use it as your import template',
  { icon: 'fileSheet' });
}

export function openProductImport({ onDone = null } = {}) {
  /** null until a file has been read. */
  let rows = null;
  let fileName = '';
  let truncated = false;
  let hasHeader = true;
  let mapping = {};
  /** Blocks dismissal while the write is out, like every other money sheet. */
  let importing = false;

  const body = el('div');
  const modal = openModal({
    title: 'Import products', content: body, wide: true, canClose: () => !importing,
  });

  const header = () => (hasHeader ? rows[0] : null);
  const dataRows = () => (hasHeader ? rows.slice(1) : rows);
  /** Columns as the mapper offers them: index plus whatever names it. */
  const columns = () => {
    const width = rows.reduce((a, r) => Math.max(a, r.length), 0);
    return Array.from({ length: width }, (_, i) => ({
      index: i,
      label: header()?.[i]?.trim() ? `${header()[i].trim()}` : `Column ${i + 1}`,
      sample: dataRows().find((r) => String(r[i] ?? '').trim())?.[i] ?? '',
    }));
  };
  const plan = () => planImport(dataRows(), mapping, store, { firstRow: hasHeader ? 2 : 1 });
  /**
   * The header names the columns where there is one; without a header the
   * shape of the data has to answer for it, which reaches the name and the
   * price and nothing subtler.
   */
  const guessColumns = () => (hasHeader ? guessMapping(header() || []) : guessFromRows(rows));

  /* ---------- Pane 1: pick a file ---------- */

  function paintPick() {
    clear(body);
    const pick = () => {
      const input = el('input', {
        type: 'file', accept: '.csv,text/csv,text/plain', style: { display: 'none' },
      });
      const done = () => input.remove();
      input.addEventListener('cancel', done, { once: true });
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        done();
        if (!file) return;
        try {
          const read = await readCatalogFile(file);
          rows = read.rows;
          truncated = read.truncated;
          fileName = file.name;
        } catch (err) {
          if (err instanceof ImportError) {
            toast(err.message, { icon: 'alert', duration: 7000 });
          } else {
            console.error(err);
            toast('Couldn’t read that file', { icon: 'alert' });
          }
          return;
        }
        hasHeader = looksLikeHeader(rows[0]);
        mapping = guessColumns();
        paintMap();
      }, { once: true });
      document.body.append(input);
      input.click();
    };

    append(body, [
      el('p.small.muted', { style: { marginBottom: '16px' } },
        'A CSV with one product per row. Anything with a Name and a Price column works — '
        + 'your own export, or one from another till. Nothing is written until you’ve seen '
        + 'what it will do.'),
      el('button.export-opt.primary', {
        type: 'button', onclick: pick,
      },
        el('span.export-opt-ic', { html: icon('fileUp', 18, 1.8) }),
        el('span.export-opt-text', {},
          el('span.export-opt-title', {}, 'Choose a CSV file'),
          el('span.export-opt-sub', {}, 'Name, price, cost, SKU, category, tax, stock')),
        el('span.export-opt-go', { html: icon('chevR', 16, 2) })
      ),
      el('button.export-opt', {
        type: 'button', onclick: exportCatalogCsv,
      },
        el('span.export-opt-ic', { html: icon('fileSheet', 18, 1.8) }),
        el('span.export-opt-text', {},
          el('span.export-opt-title', {}, store.products.length ? 'Export your catalog first' : 'Download a blank template'),
          el('span.export-opt-sub', {}, store.products.length
            ? 'Edit the prices in a spreadsheet and import it back'
            : 'The columns this import reads, ready to fill in')),
        el('span.export-opt-go', { html: icon('fileDown', 16, 2) })
      ),
      el('p.small.muted', { style: { marginTop: '14px' } },
        'Products already in your catalog are matched by SKU (or by name, where there '
        + 'is no SKU) and updated rather than duplicated. Photos, option groups, and '
        + 'sales history aren’t part of an import.'),
    ]);
  }

  /* ---------- Pane 2: point the columns at the fields ---------- */

  const mapWrap = el('div');
  const mapSummary = el('div.export-summary', { 'aria-live': 'polite' });
  const reviewBtn = el('button.btn.btn-primary.btn-block', { type: 'button' }, 'Review import');

  function paintMap() {
    clear(body);
    const headToggle = el('input', { type: 'checkbox', id: 'csv-has-header', checked: hasHeader });
    headToggle.addEventListener('change', () => {
      hasHeader = headToggle.checked;
      // Which row is the header just changed, and with it what there is to
      // guess from; guess again rather than leave a stale mapping in place.
      mapping = guessColumns();
      renderMap();
      renderMapSummary();
    });

    append(body, [
      el('p.small.muted', { style: { marginBottom: '14px' } },
        el('strong', {}, fileName), ` · ${plural(rows.length, 'row')} read`,
        truncated ? `, the first ${MAX_IMPORT_ROWS.toLocaleString()} of a longer file` : ''),
      el('div.field.check-field', {},
        headToggle,
        el('label', { htmlFor: 'csv-has-header' }, 'The first row is a header, not a product')
      ),
      mapWrap,
      mapSummary,
      reviewBtn,
      el('button.btn.btn-ghost.btn-block', {
        type: 'button', style: { marginTop: '10px' },
        onclick: () => { rows = null; paintPick(); },
      }, 'Choose a different file'),
    ]);
    renderMap();
    renderMapSummary();
    reviewBtn.onclick = paintReview;
  }

  // Changing one column re-renders the whole map (a column can only be used
  // once, so every other select's options change with it).
  function renderMap() {
    keepFocus(mapWrap, paintMapRows);
  }

  function paintMapRows() {
    clear(mapWrap);
    const cols = columns();
    const used = new Set(Object.values(mapping));
    for (const field of IMPORT_FIELDS) {
      const chosen = mapping[field.key];
      const select = el('select.select', {
        'aria-label': `Column for ${field.label}`,
        onchange: (e) => {
          const v = e.target.value;
          if (v === '') delete mapping[field.key];
          else mapping[field.key] = Number(v);
          renderMap();
          renderMapSummary();
        },
      },
        el('option', { value: '', selected: chosen === undefined },
          field.required ? 'Not mapped — required' : 'Not in this file'),
        // A column already pointed at another field is hidden rather than
        // offered: two fields reading one column is never what anyone means.
        ...cols
          .filter((c) => c.index === chosen || !used.has(c.index))
          .map((c) => el('option', { value: String(c.index), selected: c.index === chosen },
            c.sample ? `${c.label} — e.g. ${String(c.sample).slice(0, 24)}` : c.label))
      );
      mapWrap.append(el('div.map-row', {},
        el('div.map-field', {},
          el('span.map-name', {},
            field.label,
            field.required && el('span.map-req', {}, 'required')),
          el('span.map-hint', {}, field.hint || '')),
        el('div.select-wrap.map-select', {}, select)
      ));
    }
  }

  /** The live count under the mapper: enough to know the columns are right. */
  function renderMapSummary() {
    clear(mapSummary);
    const missing = IMPORT_FIELDS.filter((f) => f.required && mapping[f.key] === undefined);
    if (missing.length) {
      reviewBtn.disabled = true;
      mapSummary.append(el('span.export-warn', {},
        `Point a column at ${missing.map((f) => f.label).join(' and ')} to continue.`));
      return;
    }
    reviewBtn.disabled = false;
    const p = plan();
    const parts = [];
    if (p.creates.length) parts.push(`${plural(p.creates.length, 'new product')}`);
    if (p.updates.length) parts.push(`${p.updates.length} matched and updated`);
    if (p.skipped.length) parts.push(`${plural(p.skipped.length, 'row')} skipped`);
    mapSummary.append(parts.length
      ? el('span', {}, parts.join(' · '))
      : el('span.export-warn', {}, 'Nothing in this file can be imported with these columns.'));
  }

  /* ---------- Pane 3: what will happen ---------- */

  function paintReview() {
    const p = plan();
    clear(body);

    const row = (label, value) => el('div.kv-row', {},
      el('span', {}, label), el('span.kv-value', {}, value));

    /** Up to a handful of names, so the counts above are recognizable. */
    const names = (list, get) => list.slice(0, 4).map(get).filter(Boolean).join(', ')
      + (list.length > 4 ? `, and ${list.length - 4} more` : '');

    const skippedList = p.skipped.length ? el('div.import-skipped', {},
      ...p.skipped.slice(0, SKIPPED_SHOWN).map((sk) => el('div.import-skip-row', {},
        el('span.import-skip-row-n', {}, `Row ${sk.rowNumber}`),
        el('span.grow', {}, sk.name || '(no name)'),
        el('span.import-skip-why', {}, sk.reason))),
      p.skipped.length > SKIPPED_SHOWN && el('p.small.muted', { style: { marginTop: '8px' } },
        `and ${p.skipped.length - SKIPPED_SHOWN} more.`)
    ) : null;

    append(body, [
      el('p.small.muted', { style: { marginBottom: '14px' } },
        el('strong', {}, fileName), ' · nothing has been written yet.'),
      el('div.kv-list', { style: { marginBottom: '16px' } },
        row('New products', String(p.creates.length)),
        p.updates.length > 0 && row('Updated', String(p.updates.length)),
        p.newCategories.length > 0 && row('Categories created', String(p.newCategories.length)),
        p.skipped.length > 0 && row('Rows skipped', String(p.skipped.length))
      ),
      // How each match was made, because "updated" is a claim about the
      // shopkeeper's own catalog and they should know what it was based on.
      p.updates.length > 0 && el('p.small.muted', { style: { marginBottom: '12px' } },
        ['sku', 'id', 'name']
          .map((kind) => {
            const hits = p.updates.filter((u) => u.matchedBy === kind);
            return hits.length ? `${plural(hits.length, 'product')} ${matchLabel(kind)} (${names(hits, (u) => u.before.name)})` : null;
          })
          .filter(Boolean)
          .join('; ') + '. Their prices and any other mapped columns are overwritten; photos, options, and history are untouched.'),
      p.newCategories.length > 0 && el('p.small.muted', { style: { marginBottom: '12px' } },
        `New categories: ${p.newCategories.slice(0, 8).join(', ')}${p.newCategories.length > 8 ? `, and ${p.newCategories.length - 8} more` : ''}.`),
      // Never silently defaulted: an unmatched tax name is said out loud.
      p.unknownTaxes.length > 0 && el('div.callout.callout-warn', { style: { marginBottom: '12px' } },
        el('span.callout-ic', { html: icon('alert', 16, 2) }),
        el('span', {},
          el('strong', {}, `${p.unknownTaxes.length === 1 ? 'A tax name' : 'Tax names'} not in your rates`),
          `: ${p.unknownTaxes.slice(0, 6).join(', ')}. Those products use your default rate — add the rates in Settings and import again to assign them.`)),
      skippedList,
      p.creates.length || p.updates.length
        ? el('div.callout.callout-accent', { style: { marginTop: '14px' } },
          el('span.callout-ic', { html: icon('circleCheck', 16, 2) }),
          el('span', {}, p.updates.length
            ? 'Existing products keep their photos, option groups, and sales history. Nothing is deleted.'
            : 'Nothing already in your catalog is changed or deleted.'))
        : el('div.callout.callout-warn', { style: { marginTop: '14px' } },
          el('span.callout-ic', { html: icon('alert', 16, 2) }),
          el('span', {}, 'There is nothing to import. Go back and check the columns.')),
      el('div.row.form-actions', {},
        el('button.btn.btn-ghost', {
          type: 'button', onclick: paintMap,
        }, 'Back to columns'),
        el('button.btn.btn-primary.grow', {
          type: 'button',
          disabled: !p.creates.length && !p.updates.length,
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            importing = true;
            let result;
            try {
              result = await store.importProducts(p);
            } catch (err) {
              console.error(err);
              importing = false;
              btn.disabled = false;
              toast(/catalog holds|Nothing to import/.test(err.message || '')
                ? err.message
                : 'Couldn’t import. Check your connection and try again', { icon: 'wifiOff', duration: 6000 });
              return;
            }
            importing = false;
            modal.close();
            const said = [
              result.created ? `${plural(result.created, 'product')} added` : null,
              result.updated ? `${result.updated} updated` : null,
            ].filter(Boolean).join(' · ');
            toast(said || 'Catalog imported', { icon: 'circleCheck', duration: 5000 });
            onDone?.(result);
          },
        }, p.creates.length && p.updates.length
          ? `Import ${p.creates.length} and update ${p.updates.length}`
          : p.updates.length ? `Update ${plural(p.updates.length, 'product')}`
            : `Import ${plural(p.creates.length, 'product')}`)
      ),
    ]);
  }

  paintPick();
  return modal;
}
