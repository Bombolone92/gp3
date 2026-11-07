/**
 * CSV and TSV import: pick a file, check the detected field types in a
 * preview, then create a base, a table, or add the rows to a table.
 */
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { parseCSV } from '../lib/csv.js';
import { parseNumber, parseDate } from '../lib/format.js';
import { TYPES, parseText, splitList, defaultOptions } from '../data/fields.js';
import { Base, makeChoice } from '../data/base.js';
import { newId } from '../lib/ids.js';
import { colorPicker } from '../lib/colors.js';
import { openDialog } from './dialog.js';
import { toast } from './toast.js';

const IMPORT_TYPES = ['text', 'longText', 'number', 'currency', 'percent', 'date', 'checkbox', 'singleSelect', 'multipleSelect', 'email', 'url', 'phone'];
const BOOL = /^(true|false|yes|no|y|n|checked|unchecked|x|)$/i;

/** Guess a field type from sample values. */
export function inferType(values) {
  const vals = values.map((v) => String(v ?? '').trim()).filter(Boolean);
  if (!vals.length) return { type: 'text' };
  const all = (re) => vals.every((v) => re.test(v));
  if (vals.every((v) => BOOL.test(v)) && vals.some((v) => /^(true|false|yes|no|checked)$/i.test(v))) return { type: 'checkbox' };
  if (all(/^[-+]?\d+(\.\d+)?%$/)) return { type: 'percent', options: { precision: Math.max(0, ...vals.map((v) => (v.split('.')[1] || '').replace('%', '').length)) } };
  // Commas only group thousands here too: "\u20ac1,50" is a decimal comma.
  if (all(/^-?[$\u20ac\u00a3\u00a5]\s?-?(?:\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$/)) {
    const symbol = vals[0].replace(/^-/, '')[0];
    return { type: 'currency', options: { symbol, precision: Math.max(0, ...vals.map((v) => (v.split('.')[1] || '').length)) } };
  }
  // Commas only as thousands separators: "1,5" (a decimal comma) is not 15.
  // Codes like ZIPs ("02134") and long ids lose digits as numbers.
  const code = (v) => /^[-+(]?0\d/.test(v) || v.replace(/e.*$/i, '').replace(/\D/g, '').replace(/^0+/, '').length > 15;
  if (vals.every((v) => parseNumber(v) !== null && !code(v) && /^[-+(]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(e[+-]?\d+)?\)?$/i.test(v.replace(/\s/g, '')))) {
    // Decimals as written, less the exponent: "2.5e-3" needs 4, "1.5e3" none.
    const decimals = (v) => {
      const m = v.match(/(?:\.(\d+))?(?:e([+-]?\d+))?\)?$/i);
      return (m[1] || '').length - Number(m[2] || 0);
    };
    const precision = Math.min(8, Math.max(0, ...vals.map(decimals)));
    return { type: 'number', options: { precision } };
  }
  if (all(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return { type: 'email' };
  if (all(/^https?:\/\/\S+$/i)) return { type: 'url' };
  // A date needs a date part: times alone ("9:00") are not today's date. It
  // needs a year or a month name too: "1/2" is a fraction, "3-5" a range.
  const datePart = (v) => /\d{4}|^\d{1,2}[/.-]\d{1,2}[/.-]\d{2}\b|[A-Za-z]{3}/.test(v) && /\d[/.-]\d|[A-Za-z]{3}/.test(v);
  if (vals.every((v) => datePart(v) && /^[\d\s/.\-:,apmAPMTZ]+$|^[A-Za-z]{3,9}\.? \d{1,2},? \d{4}/.test(v) && parseDate(v, { includeTime: true }))) {
    const withTime = vals.some((v) => /\d:\d/.test(v));
    return { type: 'date', options: { includeTime: withTime } };
  }
  if (vals.some((v) => v.length > 120 || v.includes('\n'))) return { type: 'longText' };
  const unique = new Set(vals);
  // Repeated values from a short list read as options.
  if (vals.length >= 4 && unique.size < vals.length && unique.size <= Math.min(50, Math.ceil(vals.length * 0.6)) && vals.every((v) => v.length <= 40)) return { type: 'singleSelect' };
  return { type: 'text' };
}

/** A plan from parsed rows: column names, guessed types, data rows. */
export function planFromRows(rows, { header = true, name = 'Imported table' } = {}) {
  // A loop: spreading every row into Math.max overflows the stack on big files.
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const head = header && rows.length ? rows[0] : [];
  const data = header ? rows.slice(1) : rows;
  // Trailing empty lines are common in exports.
  while (data.length && data[data.length - 1].every((c) => !String(c).trim())) data.pop();
  const used = new Set();
  const columns = [];
  for (let i = 0; i < width; i++) {
    let colName = String(head[i] ?? '').trim() || `Field ${i + 1}`;
    let n = 2;
    const baseName = colName;
    while (used.has(colName.toLowerCase())) colName = `${baseName} ${n++}`;
    used.add(colName.toLowerCase());
    const sample = data.slice(0, 500).map((r) => r[i]);
    let guess = i === 0 ? { type: 'text' } : inferType(sample);
    // Options are for short lists: hundreds of different values past the sample make it text.
    if (guess.type === 'singleSelect' && manyDistinct(data, i, 200)) guess = { type: 'text' };
    columns.push({ name: colName, ...guess, include: true });
  }
  if (columns[0] && !['text', 'longText', 'number', 'date', 'email', 'url', 'phone', 'currency', 'percent'].includes(columns[0].type)) columns[0].type = 'text';
  return { name, columns, rows: data };
}

function manyDistinct(rows, i, limit) {
  const seen = new Set();
  for (const r of rows) {
    const v = String(r[i] ?? '').trim().toLowerCase();
    if (v && seen.add(v).size > limit) return true;
  }
  return false;
}

/**
 * What parseText needs for each field. Select fields find options by name
 * in a map and color new ones in turn, so thousands of new options stay
 * fast; new options are added to the field's choices.
 */
function parseContexts(base, fields) {
  const findRecords = (tid, names) => base.compute.findRecords(tid, names);
  const made = new Map();
  return fields.map((field) => {
    if (!field) return null;
    if (made.has(field)) return made.get(field);
    const choices = field.options?.choices;
    let ctx = { findRecords };
    if (choices) {
      const byName = new Map();
      for (const c of choices) if (!byName.has(c.name.toLowerCase())) byName.set(c.name.toLowerCase(), c);
      const pick = colorPicker(choices.map((c) => c.color));
      ctx = {
        findRecords,
        findChoice: (n) => byName.get(String(n).trim().toLowerCase()) || null,
        makeChoice: (n) => {
          const c = { ...makeChoice(n), color: pick() };
          choices.push(c);
          byName.set(c.name.toLowerCase(), c);
          return c;
        },
      };
    }
    made.set(field, ctx);
    return ctx;
  });
}

/** Values for one row of a plan, keyed by field id. */
function cellsFor(fields, ctxs, row, plan) {
  const cells = {};
  plan.columns.forEach((col, i) => {
    const field = fields[i];
    if (!field || col.include === false) return;
    const raw = row[i];
    if (raw === undefined || raw === null || String(raw).trim() === '') return;
    const v = parseText(field, raw, ctxs[i]);
    if (v && typeof v === 'object' && 'newChoices' in v) {
      if (v.value !== null) cells[field.id] = v.value;
    } else if (v !== null && v !== undefined && v !== '') cells[field.id] = v;
  });
  return cells;
}

/** Add a table built from a plan to a base. Returns the table id. */
export function addTableFromPlan(base, plan) {
  return base.transact(() => {
    const cols = plan.columns.filter((c) => c.include !== false);
    const fields = cols.map((c) => ({ id: newId('fld'), name: c.name, type: c.type, options: { ...defaultOptions(c.type), ...(c.options || {}) } }));
    // Choices are collected from the data up front so options keep their first-seen order.
    for (const [k, f] of fields.entries()) {
      if (f.type !== 'singleSelect' && f.type !== 'multipleSelect') continue;
      const col = plan.columns.indexOf(cols[k]);
      const names = [];
      const seen = new Set();
      for (const r of plan.rows) {
        const raw = String(r[col] ?? '').trim();
        if (!raw) continue;
        for (const n of f.type === 'multipleSelect' ? splitList(raw) : [raw]) {
          if (!seen.has(n.toLowerCase())) names.push(n);
          seen.add(n.toLowerCase());
        }
        if (names.length > 200) break;
      }
      const choices = [];
      for (const n of names) choices.push(makeChoice(n, choices));
      f.options.choices = choices;
    }
    const tid = base.addTable(plan.name, { fields });
    const table = base.table(tid);
    const ordered = plan.columns.map((c) => (c.include === false ? null : table.fields[cols.indexOf(c)]));
    const ctxs = parseContexts(base, ordered);
    const all = plan.rows.map((row) => cellsFor(ordered, ctxs, row, plan));
    // Choices added while parsing are saved with the field.
    for (const f of table.fields) if (f.options?.choices) base.apply({ t: 'field.set', table: tid, id: f.id, patch: { options: { ...f.options, choices: [...f.options.choices] } } });
    if (all.length) base.createRecords(tid, all);
    return tid;
  }, 'Import');
}

/** Append rows of a plan to an existing table, matching columns to fields. */
export function appendPlan(base, tableId, plan, mapping) {
  const table = base.table(tableId);
  return base.transact(() => {
    const fields = plan.columns.map((c, i) => (mapping[i] ? table.field(mapping[i]) : null));
    const before = new Map(table.fields.map((f) => [f.id, JSON.stringify(f.options?.choices || [])]));
    // One working copy per field: two columns into one select field share its new options.
    const copies = new Map();
    for (const f of fields) if (f && !copies.has(f.id)) copies.set(f.id, { ...f, options: { ...f.options, choices: [...(f.options.choices || [])] } });
    const working = fields.map((f) => (f ? copies.get(f.id) : null));
    const ctxs = parseContexts(base, working);
    const columns = { columns: plan.columns.map((c, i) => ({ ...c, include: !!mapping[i] })) };
    const all = plan.rows.map((row) => cellsFor(working, ctxs, row, columns));
    for (const f of copies.values()) {
      if (JSON.stringify(f.options.choices || []) !== before.get(f.id)) {
        base.apply({ t: 'field.set', table: tableId, id: f.id, patch: { options: f.options } });
      }
    }
    if (all.length) base.createRecords(tableId, all);
    return all.length;
  }, 'Import');
}

/** Build a whole base document from a plan (for "import into a new base"). */
export function baseFromPlan(plan, name) {
  const doc = { v: 1, id: newId('app'), name, color: 'green', icon: 'table', tables: [] };
  const base = new Base(doc, {});
  const tid = addTableFromPlan(base, plan);
  return { doc: base.doc, records: { [tid]: [...base.table(tid).records.values()] } };
}

export function pickFile(accept = '.csv,.tsv,.txt,text/csv,text/tab-separated-values') {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => {
      resolve(input.files?.[0] || null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

/**
 * A file's text: UTF-8 or UTF-16 by its byte order mark, else UTF-8 when it
 * reads as UTF-8, else Windows-1252 (what Excel on Windows saves as CSV).
 */
export function decodeText(buffer) {
  const b = new Uint8Array(buffer);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
  // A stray invalid byte or two in a UTF-8 file is lost on its own; text
  // that is mostly not UTF-8 is Windows-1252.
  const text = new TextDecoder('utf-8').decode(b);
  const bad = text.match(/\ufffd/g)?.length || 0;
  if (!bad) return text;
  const good = text.match(/[^\x00-\x7f\ufffd]/g)?.length || 0;
  return bad > good ? new TextDecoder('windows-1252').decode(b) : text;
}

/**
 * The import flow. mode: 'base' (new base), 'table' (new table in a base) or
 * 'append' (rows into table). onDone receives { name, plan, doc?, records?, mapping? }.
 */
export async function importFileDialog({ onDone, mode = 'base', table = null, file = null }) {
  file = file || (await pickFile());
  if (!file) return;
  let text;
  try {
    text = decodeText(await file.arrayBuffer());
  } catch {
    toast('Could not read that file.', { error: true });
    return;
  }
  const rows = parseCSV(text);
  if (!rows.length) {
    toast('That file has no rows.', { error: true });
    return;
  }
  const baseName = file.name.replace(/\.(csv|tsv|txt)$/i, '') || 'Imported';
  let header = true;
  let plan = planFromRows(rows, { header, name: baseName });
  const nameInput = h('input.input', { type: 'text', value: baseName, 'aria-label': mode === 'base' ? 'Base name' : 'Table name' });
  const headerToggle = h('input.switch', { type: 'checkbox', role: 'switch', checked: true, 'aria-label': 'First row has field names' });
  const cols = h('div.import-cols');
  const preview = h('div.import-preview');
  const mapping = [];
  if (mode === 'append') {
    plan.columns.forEach((c, i) => {
      mapping[i] = table.fieldByName(c.name)?.id || '';
    });
  }

  const renderCols = () => {
    cols.replaceChildren(
      ...plan.columns.map((c, i) => {
        if (mode === 'append') {
          const select = h('select.select', { 'aria-label': `Field for column ${c.name}`, onchange: () => (mapping[i] = select.value) },
            h('option', { value: '' }, "Don't import"),
            table.fields.filter((f) => !TYPES[f.type].computed && f.type !== 'autonumber' && f.type !== 'attachment').map((f) => h('option', { value: f.id, selected: mapping[i] === f.id }, f.name)));
          return h('div.import-col', h('span.import-col-name', c.name), icon('arrowRight', 14), select);
        }
        const select = h('select.select', { 'aria-label': `Type for ${c.name}`, onchange: () => {
          c.type = select.value;
          c.options = select.value === 'date' ? { includeTime: false } : select.value === 'number' ? { precision: 2 } : undefined;
        } }, IMPORT_TYPES.map((t) => h('option', { value: t, selected: c.type === t }, TYPES[t].label)));
        if (i === 0) select.querySelectorAll('option').forEach((o) => (o.disabled = ['checkbox', 'singleSelect', 'multipleSelect'].includes(o.value)));
        const include = h('input', { type: 'checkbox', checked: c.include !== false, disabled: i === 0, 'aria-label': `Import ${c.name}`, onchange: () => (c.include = include.checked) });
        return h('div.import-col', h('label.check', include, h('span.import-col-name', c.name)), select);
      }),
    );
    const sample = plan.rows.slice(0, 5);
    preview.replaceChildren(
      h('table.import-table', h('thead', h('tr', plan.columns.map((c) => h('th', { scope: 'col' }, c.name)))), h('tbody', sample.map((r) => h('tr', plan.columns.map((_, i) => h('td', String(r[i] ?? '')))))),
      ),
    );
  };
  headerToggle.addEventListener('change', () => {
    header = headerToggle.checked;
    plan = planFromRows(rows, { header, name: nameInput.value });
    renderCols();
  });
  renderCols();
  openDialog({
    title: mode === 'append' ? `Import into ${table.name}` : mode === 'table' ? 'Import a table' : 'Import a spreadsheet',
    className: 'wide',
    body: h(
      'div.import',
      mode === 'append' ? null : h('div.form-row', h('label.field-label', mode === 'base' ? 'Base name' : 'Table name'), nameInput),
      h('label.switch-row', headerToggle, h('span.grow', 'First row has field names')),
      h('p.field-hint', `${plan.rows.length} row${plan.rows.length === 1 ? '' : 's'} and ${plan.columns.length} column${plan.columns.length === 1 ? '' : 's'} found in ${file.name}.`),
      h('h3.import-sub', mode === 'append' ? 'Match columns to fields' : 'Fields'),
      cols,
      h('h3.import-sub', 'Preview'),
      preview,
    ),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Import',
        primary: true,
        onClick: async () => {
          plan.name = nameInput.value.trim() || baseName;
          try {
            if (mode === 'base') await onDone({ name: plan.name, plan, ...baseFromPlan(plan, plan.name) });
            else await onDone({ name: plan.name, plan, mapping });
          } catch (err) {
            console.error(err);
            toast('The import did not finish. Check the file and try again.', { error: true });
          }
        },
      },
    ],
  });
}
