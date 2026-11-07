/**
 * Table appearance beyond the engine's row and column commands: cell
 * background, border presets, even column widths, and where text sits in a
 * cell; plus turning delimited text into a table and back, and sorting rows.
 * Everything addresses the table or cell the caret is in by node id.
 */

import { unzipSync, strFromU8 } from 'fflate';
import { editCaption, captionInlinesText, captionHasLabel, captionDescription } from './images.js';
import { bytesFromBase64 } from './bytes.js';

/**
 * Whether any cell in the document carries its own formatting of a kind
 * (borders, shading), read from the document as the engine writes it: the
 * engine reports nothing per cell, and writing every cell of a table is a
 * transaction, an undo step and a repaint per cell. Unknown counts as yes.
 */
async function anyCellCarries(api, pattern) {
  if (typeof api?.export?.toDocx !== 'function') return true;
  try {
    const exported = await api.export.toDocx({});
    if (typeof exported?.contentBase64 !== 'string') return true;
    const files = unzipSync(bytesFromBase64(exported.contentBase64), { filter: (file) => /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(file.name) });
    return Object.values(files).some((bytes) => pattern.test(strFromU8(bytes)));
  } catch { return true; }
}
const CELL_BORDERS = /<w:tcBorders>/;
const CELL_SHADING = /<w:tcPr>(?:(?!<\/w:tcPr>)[^])*?<w:shd\b/;

export const BORDER_PRESETS = [
  { id: 'all', label: 'All borders', icon: 'grid' },
  { id: 'box', label: 'Outside borders only', icon: 'table' },
  { id: 'none', label: 'No borders', icon: 'x' },
];

export const CELL_ALIGNMENTS = [
  { id: 'top', label: 'Top' },
  { id: 'center', label: 'Middle' },
  { id: 'bottom', label: 'Bottom' },
];

const ok = (r, what) => {
  if (r == null || (r.success === false && r.failure?.code !== 'NO_OP')) throw new Error(r?.failure?.message || `${what} failed`);
  return r;
};

/** Fill the cell with a color ('#rrggbb'), or clear it with null. */
export async function shadeCell(api, cellNodeId, color) {
  if (!cellNodeId) throw new Error('No cell');
  if (color) ok(await api.tables.setShading({ nodeId: cellNodeId, color }), 'Background');
  else ok(await api.tables.clearShading({ nodeId: cellNodeId }), 'Background');
}

/** The default hairline border. */
export const DEFAULT_BORDER = { lineStyle: 'single', lineWeightPt: 0.5, color: '000000' };

/**
 * Apply a border preset. Every preset starts from no borders so cell-level
 * lines from an earlier grid do not linger; the engine's own "box" preset
 * leaves them in place.
 */
export async function applyBorders(api, tableNodeId, preset, { beforeWrite = () => {}, onChange = () => {} } = {}) {
  if (!tableNodeId) throw new Error('No table');
  const write = async (input) => {
    beforeWrite();
    const result = ok(await api.tables.setBorders({ nodeId: tableNodeId, ...input }), 'Borders');
    if (result.success !== false) onChange();
  };
  const set = (applyTo, border) => write({ mode: 'applyTo', applyTo, border });
  // Clearing can succeed even when drawing replacement borders fails.
  await set('all', null);
  // A cell's own borders paint over the table's, and a cell's cleared border hides the
  // table's line there too. So each cell gets the preset's lines as its own: a grid drawn cell
  // by cell (as many producers and converters write them) neither lingers under "No borders" nor
  // blanks out "All borders" and "Outside borders only".
  // A table whose cells carry no borders of their own (one the engine made) needs no cell written at all.
  const cells = api.tables.getCells && await anyCellCarries(api, CELL_BORDERS) ? await tableCells(api, tableNodeId) : [];
  const rows = Math.max(0, ...cells.map((cell) => (cell?.rowIndex ?? 0) + (cell?.rowspan || 1)));
  const columns = Math.max(0, ...cells.map((cell) => (cell?.columnIndex ?? 0) + (cell?.colspan || 1)));
  for (const cell of cells) {
    if (!cell?.nodeId) continue;
    const outer = {
      top: (cell.rowIndex ?? 0) === 0,
      bottom: (cell.rowIndex ?? 0) + (cell.rowspan || 1) >= rows,
      left: (cell.columnIndex ?? 0) === 0,
      right: (cell.columnIndex ?? 0) + (cell.colspan || 1) >= columns,
    };
    const edge = (side) => (preset === 'all' || (preset === 'box' && outer[side]) ? DEFAULT_BORDER : null);
    await write({ nodeId: cell.nodeId, mode: 'edges', edges: { top: edge('top'), bottom: edge('bottom'), left: edge('left'), right: edge('right') } });
  }
  if (preset === 'all') await set('all', DEFAULT_BORDER);
  else if (preset === 'box') await set('outside', DEFAULT_BORDER);
}

export async function distributeColumns(api, tableNodeId) {
  if (!tableNodeId) throw new Error('No table');
  ok(await api.tables.distributeColumns({ nodeId: tableNodeId }), 'Column widths');
  // The engine evens out the grid only; a fixed-layout table's columns are also sized from each cell's own
  // width, which it left as it was. Every column is set to its even share of the table's width too.
  if (!api.tables.getProperties || !api.tables.getCells || !api.tables.setColumnWidth) return;
  const props = await api.tables.getProperties({ nodeId: tableNodeId });
  if (props?.preferredWidthType !== 'dxa' || !(props.preferredWidth > 0)) return;
  const cells = (await api.tables.getCells({ nodeId: tableNodeId }))?.cells || [];
  const columns = Math.max(0, ...cells.map((cell) => (cell.columnIndex ?? 0) + (cell.colspan || 1)));
  if (!columns) return;
  const widthPt = props.preferredWidth / columns / 20;
  for (let columnIndex = 0; columnIndex < columns; columnIndex++) ok(await api.tables.setColumnWidth({ nodeId: tableNodeId, columnIndex, widthPt }), 'Column widths');
  // A column's width lands on every cell starting in it; a cell spanning several columns is as wide as all of them.
  if (!api.tables.setCellProperties) return;
  for (const cell of cells) {
    if ((cell.colspan || 1) > 1 && cell.nodeId) ok(await api.tables.setCellProperties({ nodeId: cell.nodeId, preferredWidthPt: widthPt * cell.colspan, preferredWidthType: 'dxa' }), 'Column widths');
  }
}

export async function alignCell(api, cellNodeId, verticalAlign) {
  if (!cellNodeId) throw new Error('No cell');
  ok(await api.tables.setCellProperties({ nodeId: cellNodeId, verticalAlign }), 'Alignment');
}

/* ---------- Text and tables ---------- */

/** Ways to split text into cells, in menu order. */
export const TEXT_DELIMITERS = [
  { id: 'tab', label: 'Tabs' },
  { id: 'comma', label: 'Commas' },
];

/** The delimiter a paragraph seems to use: tabs win, then commas, else null. */
export function detectDelimiter(text) {
  const t = String(text || '');
  if (t.includes('\t')) return 'tab';
  if (t.includes(',')) return 'comma';
  return null;
}

/** How the sort submenu orders the caret's column. */
export const SORT_CHOICES = [
  { id: 'textAsc', label: 'A to Z', type: 'text', direction: 'ascending' },
  { id: 'textDesc', label: 'Z to A', type: 'text', direction: 'descending' },
  { id: 'numberAsc', label: 'Smallest number first', type: 'number', direction: 'ascending' },
  { id: 'numberDesc', label: 'Largest number first', type: 'number', direction: 'descending' },
];

/**
 * Turn the paragraph at `nodeId` and the delimited paragraphs that follow it
 * into a table, one paragraph per row. Resolves the new table's node id.
 */
export async function textToTable(api, nodeId, delimiter, { story } = {}) {
  const unavailable = textToTableStoryError(story);
  if (unavailable) throw new Error(unavailable);
  if (!nodeId) throw new Error('No paragraph');
  const r = ok(await api.tables.convertFromText({ nodeId, delimiter }), 'Convert to table');
  return r.table?.nodeId || null;
}

/** The engine ignores document-part targeting for text-to-table conversion. */
export function textToTableStoryError(story) {
  return story && story.storyType !== 'body' ? 'Convert text to table is available in body text only' : null;
}

/** Turn a table back into paragraphs, one per row, cells separated by tabs. */
export async function tableToText(api, tableNodeId, delimiter = 'tab') {
  if (!tableNodeId) throw new Error('No table');
  ok(await api.tables.convertToText({ nodeId: tableNodeId, delimiter }), 'Convert to text');
}

/** Sort the rows of a table by one column. */
export async function sortTable(api, tableNodeId, columnIndex, choiceId) {
  if (!tableNodeId) throw new Error('No table');
  const choice = SORT_CHOICES.find((c) => c.id === choiceId);
  if (!choice || !Number.isInteger(columnIndex) || columnIndex < 0) throw new Error('No column');
  ok(await api.tables.sort({ nodeId: tableNodeId, keys: [{ columnIndex, direction: choice.direction, type: choice.type }] }), 'Sort');
}

/* ---------- Rows and placement ---------- */

/** Where a table sits between the margins. */
export const TABLE_ALIGNMENTS = [
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Center' },
  { id: 'right', label: 'Right' },
];

/**
 * Repeat a row at the top of every page the table spans (or stop doing so).
 * Repeating header rows only count as an unbroken run from the first row, so
 * repeating a row takes the rows above it along, and releasing one releases
 * the rows below it too (`rows` says how many the table has).
 */
export async function setHeaderRow(api, tableNodeId, rowIndex, repeat, { rows = rowIndex + 1 } = {}) {
  if (!tableNodeId || !Number.isInteger(rowIndex) || rowIndex < 0) throw new Error('No row');
  const indexes = repeat ? Array.from({ length: rowIndex + 1 }, (_, i) => i) : Array.from({ length: Math.max(1, rows - rowIndex) }, (_, i) => rowIndex + i);
  for (const index of indexes) ok(await api.tables.setRowOptions({ nodeId: tableNodeId, rowIndex: index, repeatHeader: !!repeat }), 'Header row');
}

/** Align the whole table left, center, or right between the margins. */
export async function alignTable(api, tableNodeId, alignment) {
  if (!tableNodeId) throw new Error('No table');
  if (!TABLE_ALIGNMENTS.some((a) => a.id === alignment)) throw new Error('No alignment');
  ok(await api.tables.setLayout({ nodeId: tableNodeId, alignment }), 'Table alignment');
}

/** The table's current alignment ('left' when unset). */
export async function tableAlignment(api, tableNodeId) {
  try {
    const props = await api.tables.getProperties({ nodeId: tableNodeId });
    return TABLE_ALIGNMENTS.some((a) => a.id === props?.alignment) ? props.alignment : 'left';
  } catch {
    return 'left';
  }
}

/* ---------- Table properties ---------- */

const TWIPS_PER_IN = 1440;
const PT_PER_IN = 72;
const PT_PER_CM = 72 / 2.54;

/** The largest table, column or row measure DOCX readers accept: 22 inches, the page size limit. */
export const MAX_TABLE_SIZE_PT = 22 * PT_PER_IN;

/** How wide a table is: the text column, or a fixed measure. */
export const TABLE_WIDTH_MODES = [
  { id: 'fit', label: 'Fit the page width' },
  { id: 'fixed', label: 'Fixed width' },
];

/** A typed measure in inches or centimeters -> points; null when blank, NaN when not a number. */
export function unitToPt(value, unit) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return unit === 'cm' ? n * PT_PER_CM : n * PT_PER_IN;
}

/** Points -> a rounded measure in the display unit. */
export function ptToUnitValue(pt, unit) {
  const v = unit === 'cm' ? pt / PT_PER_CM : pt / PT_PER_IN;
  return Math.round(v * 100) / 100;
}

/**
 * The dialog's starting values from the engine's table properties: width
 * mode and fixed width (points), and the cell padding when it is the same on
 * every side. Unrecognized width settings use "keep" so they are preserved.
 * Column widths and row heights are not reported, so those
 * fields start blank and mean "leave as is".
 */
export function tableSizeState(props) {
  const p = props || {};
  const fixed = p.autoFitMode === 'fixedWidth' && p.preferredWidthType === 'dxa' && p.preferredWidth > 0;
  const m = p.defaultCellMargins || {};
  const sides = ['topPt', 'rightPt', 'bottomPt', 'leftPt'].map((k) => m[k]).filter((v) => typeof v === 'number');
  const uniform = sides.length === 4 && sides.every((v) => v === sides[0]);
  return { widthMode: fixed ? 'fixed' : p.autoFitMode === 'fitWindow' ? 'fit' : 'keep', widthPt: fixed ? p.preferredWidth / 20 : null, paddingPt: uniform ? sides[0] : null };
}

/**
 * Apply the dialog: table width (fit, or fixed in points), the caret's column
 * width and row height (points, blank leaves them), and one padding for all
 * cell sides. Resolves how many settings were accepted and reports each change
 * immediately, since a later setting can fail after earlier writes succeed.
 */
export async function applyTableProperties(api, ctx, { widthMode, widthPt, columnWidthPt, rowHeightPt, paddingPt }, { beforeWrite = () => {}, onChange = () => {} } = {}) {
  const nodeId = ctx?.tableNodeId;
  if (!nodeId) throw new Error('No table');
  // The engine writes any size; past that limit the table cannot be seen whole or opened faithfully elsewhere.
  if ([widthMode === 'fixed' ? widthPt : 0, columnWidthPt, rowHeightPt].some((value) => value > MAX_TABLE_SIZE_PT)) throw new Error('Table sizes can be up to 22 inches');
  let n = 0;
  const written = (result, label) => {
    ok(result, label);
    n += 1;
    if (result.success !== false) onChange();
  };
  if (widthMode === 'fixed' && widthPt > 0) {
    beforeWrite();
    written(await api.tables.setLayout({ nodeId, autoFitMode: 'fixedWidth', preferredWidth: Math.round((widthPt / PT_PER_IN) * TWIPS_PER_IN), preferredWidthType: 'dxa' }), 'Table width');
  } else if (widthMode === 'fit') {
    beforeWrite();
    written(await api.tables.setLayout({ nodeId, autoFitMode: 'fitWindow' }), 'Table width');
  }
  if (columnWidthPt > 0 && Number.isInteger(ctx.columnIndex)) {
    beforeWrite();
    written(await api.tables.setColumnWidth({ nodeId, columnIndex: ctx.columnIndex, widthPt: columnWidthPt }), 'Column width');
  }
  if (rowHeightPt > 0 && Number.isInteger(ctx.rowIndex)) {
    beforeWrite();
    written(await api.tables.setRowHeight({ nodeId, rowIndex: ctx.rowIndex, heightPt: rowHeightPt, rule: 'atLeast' }), 'Row height');
  }
  if (paddingPt != null && paddingPt >= 0) {
    beforeWrite();
    written(await api.tables.setTableOptions({ nodeId, defaultCellMargins: { topPt: paddingPt, rightPt: paddingPt, bottomPt: paddingPt, leftPt: paddingPt } }), 'Cell padding');
  }
  return n;
}

/* ---------- Captions ---------- */

/** The caption paragraph right above a table, with its displayed text; null when the table has none. */
export async function findTableCaption(api, tableNodeId) {
  if (!tableNodeId || !api?.blocks?.list || !api.getNodeById) return null;
  const blocks = (await api.blocks.list({}))?.blocks || [];
  const at = blocks.findIndex((block) => block.nodeId === tableNodeId);
  const previous = at > 0 ? blocks[at - 1] : null;
  if (!previous || previous.nodeType !== 'paragraph') return null;
  const paragraph = (await api.getNodeById({ nodeId: previous.nodeId }))?.node?.paragraph;
  if (paragraph?.styleRef?.toLowerCase() !== 'caption') return null;
  const text = captionInlinesText(paragraph.inlines || []);
  // A picture's caption right above the table belongs to the picture, not to the table.
  if (!(await captionHasLabel(api, previous.nodeId, text, 'Table'))) return null;
  return { nodeId: previous.nodeId, text };
}

/**
 * A numbered caption ("Table 1: text") in a paragraph above the table, as a
 * SEQ field so field updates renumber it; a table that has one gets it rewritten
 * rather than a second one. Resolves the caption paragraph's node id.
 */
export async function captionTable(api, tableNodeId, text, { position = 'above', onChange = () => {}, canApply = () => true } = {}) {
  if (!tableNodeId) throw new Error('No table');
  const existing = position === 'above' ? await findTableCaption(api, tableNodeId) : null;
  if (existing) {
    if (await editCaption(api, existing, text, { onChange, canApply }) === false) return false;
    return existing.nodeId;
  }
  if (!canApply()) return false;
  const r = ok(await api.captions.insert({ adjacentTo: { kind: 'block', nodeType: 'table', nodeId: tableNodeId }, position, label: 'Table', text: captionDescription(text, 'Table') }), 'Caption');
  if (r.success !== false) onChange();
  return r.caption?.nodeId || null;
}

/* ---------- Splitting and row sizes ---------- */

/** Split the table above the caret's row, so that row starts a new table. */
export async function splitTable(api, tableNodeId, rowIndex) {
  if (!tableNodeId) throw new Error('No table');
  if (!Number.isInteger(rowIndex) || rowIndex < 1) throw new Error('Put the cursor in a row below the first one');
  ok(await api.tables.split({ nodeId: tableNodeId, rowIndex }), 'Split table');
}

/** Give every row the same height. */
export async function distributeRows(api, tableNodeId) {
  if (!tableNodeId) throw new Error('No table');
  ok(await api.tables.distributeRows({ nodeId: tableNodeId }), 'Row heights');
}

/* ---------- Alternate rows ---------- */

/** The light fill alternate rows get unless another color is picked. */
export const BAND_COLOR = '#f2f2f2';

/** Every cell of a table with its row and column, from the table API. */
export async function tableCells(api, tableNodeId) {
  if (!tableNodeId) throw new Error('No table');
  return (await api.tables.getCells({ nodeId: tableNodeId }))?.cells || [];
}

/**
 * Shade every second row (the 2nd, 4th, and so on, leaving the first row
 * for headings) with `color`, and clear the rows between so re-banding in
 * another color starts clean. With null, clear every cell's shading.
 */
export async function bandRows(api, tableNodeId, color, { beforeWrite = () => {}, onChange = () => {} } = {}) {
  const cells = await tableCells(api, tableNodeId);
  // The rows between the bands are cleared only when some cell has shading to clear: each write is an undo step.
  const clearOthers = await anyCellCarries(api, CELL_SHADING);
  let shaded = 0;
  for (const c of cells) {
    const band = color && c.rowIndex % 2 === 1;
    if (!band && !clearOthers) continue;
    beforeWrite();
    const result = ok(band
      ? await api.tables.setShading({ nodeId: c.nodeId, color })
      : await api.tables.clearShading({ nodeId: c.nodeId }), 'Row shading');
    if (band) shaded += 1;
    // Earlier cells stay changed if a later cell cannot be formatted.
    if (result.success !== false) onChange();
  }
  return shaded;
}
