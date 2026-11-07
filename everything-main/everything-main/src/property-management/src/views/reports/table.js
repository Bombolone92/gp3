/**
 * Report tables. A report produces sections:
 *
 *   { title?, caption, columns: [{ id, label, value(row), render?(row),
 *     align: 'r', money?: true, sort?: true }], rows, totals?, note? }
 *
 * Rows may carry `_type`: 'group' (a heading row spanning the table),
 * 'subtotal' or 'total' (bold), 'muted'. Money columns format cents and
 * use tabular figures. Sections without typed rows can be sorted.
 */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { money } from '../common.js';
import { downloadText } from '../../core/csv.js';

function cellText(col, row) {
  const v = col.value(row);
  if (v === null || v === undefined || v === '') return '';
  return col.money ? money(v) : String(v);
}

function cellNode(col, row) {
  if (row._type === 'group') return null;
  if (col.render && !row._type) return col.render(row);
  const v = col.value(row);
  if (v === null || v === undefined || v === '') return '';
  if (col.money) return h(`span.num${v < 0 ? '.neg' : ''}`, money(v));
  return String(v);
}

const blank = (v) => v === null || v === undefined || v === '';

/** Sort order for two cell values; blanks go last in either direction. */
function compare(a, b, dir = 'asc') {
  if (a === b) return 0;
  if (blank(a)) return 1;
  if (blank(b)) return -1;
  const c = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  return dir === 'desc' ? -c : c;
}

export function sectionTable(section) {
  const wrap = h('section.report-section', { 'aria-label': section.title || section.caption });
  const sortable = !section.rows.some((r) => r._type);
  let sort = null;
  const draw = () => {
    let rows = section.rows;
    if (sort) {
      const col = section.columns.find((c) => c.id === sort.id);
      rows = [...rows].sort((a, b) => compare(col.value(a), col.value(b), sort.dir));
    }
    const head = h(
      'tr',
      section.columns.map((c) => {
        const active = sort?.id === c.id;
        const label = sortable && c.sort !== false
          ? h(
              'button.sort',
              { type: 'button', onClick: () => ((sort = { id: c.id, dir: active && sort.dir === 'asc' ? 'desc' : 'asc' }), draw()) },
              c.label,
              icon(active ? (sort.dir === 'desc' ? 'arrow-down' : 'arrow-up') : 'sort', 13),
            )
          : c.label;
        return h(`th${c.align === 'r' || c.money ? '.r' : ''}`, { scope: 'col', 'aria-sort': active ? (sort.dir === 'desc' ? 'descending' : 'ascending') : null }, label);
      }),
    );
    const body = rows.map((row) => {
      if (row._type === 'group') return h('tr.rpt-group', h('th', { scope: 'rowgroup', colspan: String(section.columns.length) }, row.label));
      return h(
        `tr${row._type ? '.rpt-' + row._type : ''}`,
        section.columns.map((c, i) => {
          const tag = i === 0 && row._type ? 'th' : 'td';
          return h(`${tag}${c.align === 'r' || c.money ? '.r' : ''}`, tag === 'th' ? { scope: 'row' } : null, cellNode(c, row));
        }),
      );
    });
    const foot = section.totals
      ? h(
          'tfoot',
          h(
            'tr.rpt-total',
            section.columns.map((c, i) => h(`${i === 0 ? 'th' : 'td'}${c.align === 'r' || c.money ? '.r' : ''}`, i === 0 ? { scope: 'row' } : null, i === 0 ? section.totals.label || 'Total' : cellNode(c, { ...section.totals, _type: 'total' }))),
          ),
        )
      : null;
    wrap.replaceChildren(
      ...[
      section.title ? h('h2.report-section-title', section.title) : null,
      rows.length || section.totals
        ? h(
            'div.table-wrap',
            { tabindex: '0', role: 'region', 'aria-label': section.caption || section.title || 'Report' },
            h('table.table.report-table', h('caption.sr-only', section.caption || section.title || 'Report'), h('thead', head), h('tbody', body), foot),
          )
        : h('p.report-empty', section.empty || 'Nothing to show for these settings.'),
      section.note ? h('p.report-note', section.note) : null,
      ].filter(Boolean),
    );
  };
  draw();
  return wrap;
}

/** CSV with every section, separated by a title row and a blank line. */
export function sectionsToCSV(sections, header = []) {
  const out = [...header.map((line) => [line]), ...(header.length ? [[]] : [])];
  sections.forEach((s, i) => {
    if (i) out.push([]);
    if (s.title) out.push([s.title]);
    out.push(s.columns.map((c) => c.label));
    for (const row of s.rows) {
      if (row._type === 'group') out.push([row.label]);
      else out.push(s.columns.map((c) => csvValue(c, row)));
    }
    if (s.totals) out.push(s.columns.map((c, j) => (j === 0 ? s.totals.label || 'Total' : csvValue(c, { ...s.totals, _type: 'total' }))));
  });
  return out.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Numbers stay numeric (so credits stay negative); text is guarded against formulas. */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvValue(col, row) {
  const v = col.csv ? col.csv(row) : col.value(row);
  if (v === null || v === undefined) return '';
  if (col.money) return Math.round(v) / 100;
  return v;
}

export function downloadCSV(filename, sections, header) {
  downloadText(filename, sectionsToCSV(sections, header));
}

export { cellText };
