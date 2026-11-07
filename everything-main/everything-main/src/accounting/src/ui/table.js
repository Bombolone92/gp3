/**
 * Data table for every list in the app.
 *
 * Long lists are windowed: only the rows in view (plus a margin) exist in
 * the DOM, between two spacer rows that keep the scrollbar honest, so a
 * register of 50,000 lines scrolls as smoothly as one of 50. Row height is
 * measured from the rows drawn when the table first appears on the page. On
 * phone widths rows become cards of varying height, so the table renders in
 * pages instead, adding more as the end comes into view.
 *
 * Accessibility: real <table> semantics, aria-sort on sortable headers,
 * aria-rowcount/aria-rowindex so assistive tech knows the true size, rows
 * reachable by keyboard (Enter opens), and a labelled select-all checkbox.
 */
import { el, clear } from './dom.js';
import { icon } from './icons.js';

const VIRTUAL_MIN = 120;
const OVERSCAN = 12;
const PAGE = 60;
// Measured row heights by table label, so a list redrawn after a change to
// the books starts with the right spacer heights and keeps its scroll position.
const rowHeights = new Map();

export function dataTable({
  columns,
  rows = [],
  rowKey = (r) => r.id,
  onRowClick = null,
  selectable = false,
  onSelectionChange = null,
  sort = null,
  onSort = null,
  empty = null,
  ariaLabel = '',
  footer = null,
  rowClass = null,
  responsive = true,
  scrollParent = null,
} = {}) {
  let data = rows;
  let selected = new Set();
  let sortState = sort;
  let rowHeight = rowHeights.get(ariaLabel) || 0;
  let range = [0, 0];
  let mobileShown = PAGE;
  let raf = 0;
  // While printing, every row is in the DOM: paper has no scrolling, so a
  // window of rows between spacers would print a few rows and blank pages.
  let printing = false;
  let paintedMobile = null; // which layout the rows were last drawn for

  const table = el(`table.grid${responsive ? '.responsive' : ''}`, { 'aria-label': ariaLabel || null });
  const thead = el('thead');
  const tbody = el('tbody');
  const tfoot = el('tfoot');
  table.append(thead, tbody, tfoot);
  const scroller = el('div.table-scroll', {}, table);
  const more = el('div.table-foot', { hidden: true });
  const root = el('div.table-wrap', {}, scroller, more);

  const isMobile = () => window.matchMedia('(max-width: 767px)').matches;

  // ------------------------------------------------------------ header
  let headCheck = null;
  function renderHead() {
    clear(thead);
    const tr = el('tr');
    if (selectable) {
      headCheck = el('input', { type: 'checkbox', 'aria-label': 'Select all rows' });
      headCheck.addEventListener('change', () => {
        selected = headCheck.checked ? new Set(data.map(rowKey)) : new Set();
        paint();
        onSelectionChange?.(selected);
      });
      tr.append(el('th.check-cell', { scope: 'col' }, headCheck));
    }
    for (const c of columns) {
      const th = el(`th${c.align === 'right' ? '.num' : ''}`, { scope: 'col', style: c.width ? { width: c.width } : null, class: c.hideMobile ? 'hide-mobile' : '' });
      if (c.sortable !== false && onSort && c.key) {
        const dir = sortState?.key === c.key ? sortState.dir : null;
        th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none');
        const b = el('button.sort-btn', { type: 'button' }, c.label, dir ? el('span', { html: icon(dir === 'asc' ? 'up' : 'down', 13) }) : null);
        b.addEventListener('click', () => {
          const nextDir = sortState?.key === c.key && sortState.dir === 'asc' ? 'desc' : sortState?.key === c.key && sortState.dir === 'desc' ? 'asc' : c.defaultDir || 'asc';
          sortState = { key: c.key, dir: nextDir };
          onSort(sortState);
          renderHead();
        });
        th.append(b);
      } else {
        th.append(c.label ? c.label : el('span.sr-only', {}, c.srLabel || ''));
      }
      tr.append(th);
    }
    thead.append(tr);
  }

  // -------------------------------------------------------------- rows
  function cell(c, r) {
    const v = c.render ? c.render(r) : r[c.key];
    const td = el(`td${c.align === 'right' ? '.num' : ''}`, { 'data-label': c.mobileLabel ?? c.label ?? null });
    if (c.className) td.className += ` ${c.className}`;
    if (c.primary) td.classList.add('cell-primary');
    if (c.amount) td.classList.add('cell-amount');
    if (c.hideMobile) td.classList.add('hide-mobile');
    if (v instanceof Node) td.append(v);
    else if (v !== null && v !== undefined) td.textContent = v;
    return td;
  }

  function rowNode(r, index) {
    const key = rowKey(r);
    const tr = el('tr', { 'aria-rowindex': index + 2, dataset: { key } });
    if (onRowClick) {
      tr.classList.add('clickable');
      tr.tabIndex = 0;
      tr.addEventListener('click', (e) => {
        if (e.target.closest('button, a, input, select, label, .no-row-click')) return;
        onRowClick(r, e);
      });
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target === tr) { e.preventDefault(); onRowClick(r, e); }
        if (e.key === 'ArrowDown' && e.target === tr) { e.preventDefault(); tr.nextElementSibling?.focus(); }
        if (e.key === 'ArrowUp' && e.target === tr) { e.preventDefault(); tr.previousElementSibling?.focus(); }
      });
    }
    if (rowClass) {
      const cls = rowClass(r);
      if (cls) tr.className += ` ${cls}`;
    }
    if (selectable) {
      const cb = el('input', { type: 'checkbox', checked: selected.has(key), 'aria-label': `Select row ${index + 1}` });
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(key); else selected.delete(key);
        tr.classList.toggle('is-selected', cb.checked);
        syncHeadCheck();
        onSelectionChange?.(selected);
      });
      if (selected.has(key)) tr.classList.add('is-selected');
      tr.append(el('td.check-cell', {}, cb));
    }
    for (const c of columns) tr.append(cell(c, r));
    return tr;
  }

  function syncHeadCheck() {
    if (!headCheck) return;
    headCheck.checked = data.length > 0 && selected.size === data.length;
    headCheck.indeterminate = selected.size > 0 && selected.size < data.length;
  }

  function spacer(h) {
    const tr = el('tr.vtable-spacer', { 'aria-hidden': 'true' });
    tr.append(el('td', { colSpan: columns.length + (selectable ? 1 : 0), style: { height: `${h}px` } }));
    return tr;
  }

  function scrollEl() {
    return scrollParent || root.closest('.main, .form-body, .dialog-body') || document.scrollingElement;
  }

  // Row height for the spacers. A table is first drawn before it is on the
  // page, where nothing has a size, so the first guess is a fallback; the
  // first drawing on the page measures the rows it drew (some lists have
  // two-line rows) and redraws once if the guess was off. Later tables with
  // the same label reuse that height, so a redraw never shifts the list.
  let measured = rowHeights.has(ariaLabel);
  function measure() {
    if (rowHeight || !data.length) return;
    const probe = rowNode(data[0], 0);
    tbody.append(probe);
    rowHeight = probe.getBoundingClientRect().height || 44;
    probe.remove();
  }
  function calibrate() {
    if (measured || !root.isConnected) return false;
    const rows = tbody.querySelectorAll('tr:not(.vtable-spacer)');
    if (rows.length < 2) return false;
    measured = true;
    const avg = (rows[rows.length - 1].getBoundingClientRect().bottom - rows[0].getBoundingClientRect().top) / rows.length;
    if (!avg) return false;
    if (ariaLabel) rowHeights.set(ariaLabel, avg);
    if (Math.abs(avg - rowHeight) < 0.5) return false;
    rowHeight = avg;
    return true;
  }

  function paint() {
    paintedMobile = isMobile();
    table.setAttribute('aria-rowcount', String(data.length + 1));
    // Work out the window before emptying the body: reading layout with an
    // empty body shrinks the scroller, which clamps its scroll position and
    // throws the list back to the top.
    const windowed = data.length >= VIRTUAL_MIN && !printing && !isMobile();
    if (windowed) {
      measure();
      range = visibleRange();
    }
    clear(tbody);
    if (!data.length) {
      if (empty) {
        const tr = el('tr');
        tr.append(el('td', { colSpan: columns.length + (selectable ? 1 : 0), style: { height: 'auto' } }, empty));
        tbody.append(tr);
      }
      more.hidden = true;
      syncHeadCheck();
      return;
    }
    if (isMobile() && !printing) {
      const n = Math.min(data.length, mobileShown);
      const frag = document.createDocumentFragment();
      for (let i = 0; i < n; i++) frag.append(rowNode(data[i], i));
      tbody.append(frag);
      clear(more);
      if (n < data.length) {
        more.hidden = false;
        more.append(el('button.btn.btn-sm', { type: 'button', onclick: () => { mobileShown += PAGE * 2; paint(); } }, `Show more (${data.length - n} remaining)`));
      } else more.hidden = true;
      syncHeadCheck();
      return;
    }
    more.hidden = true;
    if (data.length < VIRTUAL_MIN || printing) {
      const frag = document.createDocumentFragment();
      data.forEach((r, i) => frag.append(rowNode(r, i)));
      tbody.append(frag);
      syncHeadCheck();
      return;
    }
    const [start, end] = range;
    const frag = document.createDocumentFragment();
    frag.append(spacer(start * rowHeight));
    for (let i = start; i < end; i++) frag.append(rowNode(data[i], i));
    frag.append(spacer((data.length - end) * rowHeight));
    tbody.append(frag);
    syncHeadCheck();
    if (calibrate()) paint();
  }

  function visibleRange() {
    const sc = scrollEl();
    const scRect = sc === document.scrollingElement ? { top: 0 } : sc.getBoundingClientRect();
    const bodyTop = tbody.getBoundingClientRect().top - scRect.top;
    const viewH = sc.clientHeight || window.innerHeight;
    const from = Math.max(0, -bodyTop);
    const start = Math.max(0, Math.floor(from / rowHeight) - OVERSCAN);
    const end = Math.min(data.length, Math.ceil((from + viewH) / rowHeight) + OVERSCAN);
    return [start, Math.max(end, Math.min(data.length, start + 30))];
  }

  function onScroll() {
    // A table replaced by a re-render lets go of its listeners the next time
    // one of them fires, so no view has to remember to destroy it.
    if (!root.isConnected && attached) { destroy(); return; }
    // Crossing the phone breakpoint (a rotated phone, a resized window)
    // switches between windowed rows and pages of cards.
    if (!printing && root.isConnected && isMobile() !== paintedMobile) { repaintKeepingFocus(); return; }
    if (raf || printing || isMobile() || data.length < VIRTUAL_MIN) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const [s, e] = visibleRange();
      if (s !== range[0] || e !== range[1]) repaintKeepingFocus();
    });
  }

  let attached = null; // the element (or window) the scroll listener is on
  function attach() {
    const sc = scrollEl();
    const target = sc === document.scrollingElement ? window : sc;
    if (attached === target) return;
    attached?.removeEventListener('scroll', onScroll);
    target.addEventListener('scroll', onScroll, { passive: true });
    attached = target;
  }
  function destroy() {
    ro?.disconnect();
    attached?.removeEventListener('scroll', onScroll);
    attached = null;
    window.removeEventListener('beforeprint', beforePrint);
    window.removeEventListener('afterprint', afterPrint);
  }
  function repaintKeepingFocus() {
    const focusedKey = document.activeElement?.closest?.('tr')?.dataset?.key;
    paint();
    if (focusedKey) tbody.querySelector(`tr[data-key="${CSS.escape(focusedKey)}"]`)?.focus({ preventScroll: true });
  }
  function beforePrint() {
    if (!root.isConnected) { destroy(); return; }
    if (data.length < VIRTUAL_MIN && data.length <= mobileShown) return;
    printing = true;
    repaintKeepingFocus();
  }
  function afterPrint() {
    if (!printing) return;
    printing = false;
    repaintKeepingFocus();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => onScroll()) : null;

  function renderFoot() {
    clear(tfoot);
    if (!footer) return;
    const cells = typeof footer === 'function' ? footer(data) : footer;
    if (!cells) return;
    const tr = el('tr');
    if (selectable) tr.append(el('td.check-cell'));
    cells.forEach((c, i) => {
      const col = columns[i] || {};
      tr.append(el(`td${col.align === 'right' ? '.num' : ''}`, { class: col.hideMobile ? 'hide-mobile' : '' }, c ?? ''));
    });
    tfoot.append(tr);
  }

  renderHead();
  paint();
  renderFoot();
  requestAnimationFrame(() => {
    attach();
    if (ro) ro.observe(root);
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    paint();
  });

  return {
    root,
    update(next) {
      data = next;
      const keys = new Set(data.map(rowKey));
      for (const k of [...selected]) if (!keys.has(k)) selected.delete(k);
      mobileShown = PAGE;
      paint();
      renderFoot();
    },
    get selection() { return selected; },
    clearSelection() { selected = new Set(); paint(); onSelectionChange?.(selected); },
    destroy,
  };
}

/** Sort rows by a column's sortValue (or key). */
export function sortRows(rows, columns, state) {
  if (!state) return rows;
  const col = columns.find((c) => c.key === state.key);
  if (!col) return rows;
  const get = col.sortValue || ((r) => r[col.key]);
  const dir = state.dir === 'desc' ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x === y) return 0;
    if (x === null || x === undefined || x === '') return 1;
    if (y === null || y === undefined || y === '') return -1;
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
  });
}
