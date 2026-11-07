/**
 * The grid view. Cells are painted on one canvas (only what is visible),
 * under a native scroll container so scrolling, momentum and scrollbars
 * behave like the platform's. Editors are DOM elements laid over the
 * canvas. Screen readers get a proxy of the active cell through
 * aria-activedescendant.
 */
import { h, announce, modKey, isMac } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { accentColor } from '../../lib/colors.js';
import { toTSV, parseTSV } from '../../lib/csv.js';
import { runView, searchView, compileFilter, isActive } from '../../data/query.js';
import { TYPES, isReadOnly, toText, listText, parseText, convertValue, valueKind, summarize, summariesFor, SUMMARIES, isEmpty } from '../../data/fields.js';
import { makeChoice } from '../../data/base.js';
import { orderedFields } from '../../data/views.js';
import { formatNumber, formatCurrency, formatPercent, formatDuration } from '../../lib/format.js';
import { Layout, HEADER_H, FOOTER_H, ADD_COL_W, MIN_COL_W } from './layout.js';
import { Painter, readPalette, paintValue } from './cells.js';
import { openMenu } from '../../ui/menu.js';
import { toast } from '../../ui/toast.js';
import { confirmDialog } from '../../ui/dialog.js';
import { openCellEditor, uploadFiles } from '../../ui/editors.js';
import { openFieldEditor, fieldMenuItems } from '../../ui/fieldeditor.js';
import { recordUrl, copyText } from '../../ui/links.js';
import { buttonUrl } from '../../data/button.js';

let uid = 0;

export class GridView {
  constructor(page, table, view) {
    this.page = page;
    this.base = page.base;
    this.table = table;
    this.view = view;
    this.id = `grid${++uid}`;
    this.cursor = null;
    this.anchor = null;
    this.checked = new Set();
    this.hover = null;
    this.drag = null;
    this.editor = null;
    this.search = null;
    this.layout = new Layout();
    this.dpr = window.devicePixelRatio || 1;
    this.W = 0;
    this.H = 0;
    this.frame = 0;

    this.canvas = h('canvas.grid-canvas', { 'aria-hidden': 'true' });
    this.spacer = h('div.grid-spacer');
    // Two cell proxies take turns: a new active descendant is what makes
    // screen readers speak the cell moved to.
    this.proxies = [0, 1].map((i) => {
      const cell = h('div', { role: 'gridcell', id: `${this.id}-cell${i}` });
      return { row: h('div', { role: 'row', hidden: i === 1 }, cell), cell };
    });
    this.proxyTurn = 0;
    this.cellProxy = this.proxies[0].cell;
    this.rowProxy = this.proxies[0].row;
    this.headProxy = h('div', { role: 'row', 'aria-rowindex': '1' });
    this.a11y = h('div.sr-only', { role: 'rowgroup' }, this.headProxy, ...this.proxies.map((p) => p.row));
    this.scroller = h('div.grid-scroller', {
      tabindex: '0',
      role: 'grid',
      'aria-label': `${table.name}, ${view.name}`,
      'aria-multiselectable': 'true',
      'aria-describedby': `${this.id}-help`,
    }, this.spacer, this.a11y);
    this.help = h('p.sr-only', { id: `${this.id}-help` }, 'Use arrow keys to move between cells, Enter to edit, Space to expand a record, and the context menu key or Shift+F10 for more actions.');
    this.overlay = h('div.grid-overlay');
    this.el = h('div.grid-root', this.canvas, this.scroller, this.overlay, this.help);
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.palette = readPalette();
    this.P = new Painter(this.ctx, this.palette, () => this.invalidate(), (path) => this.page.store.readFile(path));
    this.bind();
  }

  /* ----------------------------------------------------------- lifecycle */

  mounted() {
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.watchDpr();
    this.resize();
    this.recompute();
    if (!this.cursor && this.layout.records.length) this.setCursor(0, 0, { scroll: false, announce: false });
    requestAnimationFrame(() => this.focus());
  }

  destroy() {
    // Leaving the view keeps what was typed in a cell.
    this.closeEditor(true);
    this.destroyed = true;
    this.endTouch?.();
    this.drag = null;
    this.ro?.disconnect();
    this.dprQuery?.removeEventListener('change', this.onDpr);
    this.P.destroy();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    document.removeEventListener('copy', this.onCopy);
    document.removeEventListener('cut', this.onCut);
    document.removeEventListener('paste', this.onPaste);
    window.removeEventListener('pointermove', this.onWindowMove);
    window.removeEventListener('pointerup', this.onWindowUp);
    window.removeEventListener('pointercancel', this.onWindowCancel);
    cancelAnimationFrame(this.scrollFrame);
  }

  focus() {
    if (!this.editor) this.scroller.focus({ preventScroll: true });
  }

  onTheme() {
    this.palette = readPalette();
    this.P.setPalette(this.palette);
    this.invalidate();
  }

  /** Repaint sharply when the pixel density changes (another screen, zoom). */
  watchDpr() {
    if (typeof matchMedia !== 'function') return;
    this.dprQuery?.removeEventListener('change', this.onDpr);
    this.onDpr ||= () => {
      this.resize();
      this.watchDpr();
    };
    this.dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.dprQuery.addEventListener?.('change', this.onDpr);
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const W = Math.max(0, this.scroller.clientWidth || r.width);
    const H = Math.max(0, this.scroller.clientHeight || r.height);
    const dpr = window.devicePixelRatio || 1;
    const sharper = dpr !== this.dpr;
    this.dpr = dpr;
    const compact = r.width < 640;
    const relayout = compact !== this.compact;
    // Frozen columns are limited to the width, so a new width refits them.
    const refit = W !== this.W;
    this.compact = compact;
    if (W !== this.W || H !== this.H || relayout || sharper) {
      this.W = W;
      this.H = H;
      this.canvas.width = Math.round(W * this.dpr);
      this.canvas.height = Math.round(H * this.dpr);
      this.canvas.style.width = `${W}px`;
      this.canvas.style.height = `${H}px`;
      if (relayout) this.recompute();
      else if (refit) this.buildColumns();
      // Resizing cleared the canvas: paint now, not on the next frame
      // (once there is something to paint).
      if (this.result) {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.paint();
      } else this.invalidate();
      this.positionEditor();
    }
  }

  update(change) {
    if (change.removedTables?.has(this.table.id)) return;
    // Records of other tables only show here through links (and lookups,
    // rollups and counts over them).
    const mine = change.schema || change.records?.has(this.table.id) || change.tables?.has(this.table.id);
    if (!mine && !this.table.fields.some((f) => TYPES[f.type]?.group === 'relational')) return;
    this.recompute();
    this.positionEditor();
  }

  /* ----------------------------------------------------------- computing */

  recompute() {
    const cursorRec = this.cursorRecordId();
    const cursorField = this.cursor ? this.layout.cols[this.cursor.c]?.field.id : null;
    const anchorRec = this.anchor ? this.layout.records[this.anchor.r]?.id : null;
    const anchorField = this.anchor ? this.layout.cols[this.anchor.c]?.field.id : null;
    // The records in a multi-row selection, to check it still holds them.
    const span = this.anchor && this.cursor ? Math.abs(this.anchor.r - this.cursor.r) : 0;
    const spanIds = span && span <= 5000 ? this.layout.records.slice(Math.min(this.anchor.r, this.cursor.r), Math.max(this.anchor.r, this.cursor.r) + 1).map((r) => r.id) : null;
    this.result = runView(this.base, this.table, this.view);
    const L = this.layout;
    this.buildColumns();
    L.buildRows(this.result, this.view, { collapsed: new Set(this.view.collapsed || []) });
    this.colorTest = this.buildColorTest();
    this.spacer.style.height = `${HEADER_H + L.bodyH + FOOTER_H + 80}px`;
    this.scroller.setAttribute('aria-rowcount', String(L.records.length + 1));
    this.scroller.setAttribute('aria-colcount', String(L.cols.length));
    // Keep the selection on the same record and field.
    const find = (rid, fid) => {
      if (!rid) return null;
      const r = L.records.findIndex((x) => x.id === rid);
      if (r < 0) return null;
      const c = Math.max(0, L.cols.findIndex((x) => x.field.id === fid));
      return { r, c };
    };
    // A record in a group just collapsed hands the cursor to the next shown one.
    const shownNear = (rid, fid) => {
      const i = rid && L.grouped ? this.result.records.findIndex((x) => x.id === rid) : -1;
      if (i < 0) return null;
      const shown = new Set(L.records.map((x) => x.id));
      const near = this.result.records.slice(i + 1).find((x) => shown.has(x.id)) || this.result.records.slice(0, i).findLast((x) => shown.has(x.id));
      return near ? find(near.id, fid) : null;
    };
    const prev = this.cursor;
    this.cursor = find(cursorRec, cursorField) || shownNear(cursorRec, cursorField) || (prev && L.records.length ? { r: Math.min(prev.r, L.records.length - 1), c: Math.min(prev.c, L.cols.length - 1) } : null);
    this.anchor = find(anchorRec, anchorField) || this.cursor;
    // A sort or filter that changed which records lie between the ends would
    // stretch the selection over records never selected: keep just the cursor.
    if (span && this.anchor && this.cursor) {
      const r0 = Math.min(this.anchor.r, this.cursor.r);
      const r1 = Math.max(this.anchor.r, this.cursor.r);
      if (r1 - r0 !== span || (spanIds && L.records.slice(r0, r1 + 1).some((r, i) => r.id !== spanIds[i]))) this.anchor = this.cursor;
    }
    // Checked records the view no longer shows (deleted or filtered out) are
    // no longer selected; ones in collapsed groups stay.
    if (this.checked.size) {
      const shown = new Set(this.result.records.map((r) => r.id));
      for (const id of [...this.checked]) if (!shown.has(id)) this.checked.delete(id);
    }
    if (this.search?.query) this.runSearch(true);
    this.renderEmpty();
    this.updateProxy();
    this.invalidate();
  }

  /** Columns for the current width (frozen ones leave room for the rest). */
  buildColumns() {
    const L = this.layout;
    L.buildColumns(this.table, this.view, { compact: this.compact, maxFrozenW: this.W ? this.W - 160 : Infinity });
    this.spacer.style.width = `${L.contentW + 80}px`;
  }

  /** A message over the grid when there is nothing to show. */
  renderEmpty() {
    this.emptyEl?.remove();
    this.emptyEl = null;
    if (this.layout.records.length || this.result.tree?.length) return;
    const filtered = this.result.total > 0;
    this.emptyEl = h('div.grid-empty', { role: 'status' },
      h('div.empty-icon', icon(filtered ? 'filter' : 'vGrid', 22)),
      h('h2', filtered ? 'No records match' : 'No records yet'),
      h('p', filtered ? 'Every record is hidden by this view\u2019s filters.' : 'Add a record, paste rows from a spreadsheet, or import a CSV file.'),
      filtered
        ? h('button.btn', { type: 'button', onclick: () => this.base.updateView(this.table.id, this.view.id, { filters: { conjunction: 'and', conditions: [] } }, { label: 'Clear filters' }) }, 'Clear filters')
        : h('button.btn.primary', { type: 'button', onclick: () => this.addRecordIn({ groups: [] }) }, icon('plus', 16), 'Add record'));
    this.overlay.append(this.emptyEl);
  }

  buildColorTest() {
    const c = this.view.color;
    if (!c || c.type === 'none') return null;
    if (c.type === 'select') {
      const f = this.table.field(c.fieldId);
      if (!f || f.type !== 'singleSelect') return null;
      return (rec) => {
        const v = rec.c[f.id];
        const choice = v && f.options.choices.find((x) => x.id === v);
        return choice ? choice.color : null;
      };
    }
    if (c.type === 'conditions') {
      const rules = (c.rules || []).map((r) => ({ color: r.color, test: compileFilter(this.base, this.table, r.filter) })).filter((r) => r.test);
      if (!rules.length) return null;
      return (rec) => rules.find((r) => r.test(rec))?.color || null;
    }
    return null;
  }

  cursorRecordId() {
    return this.cursor ? this.layout.records[this.cursor.r]?.id || null : null;
  }

  recordOrder() {
    return this.layout.records.map((r) => r.id);
  }

  canReorderRows() {
    return !this.view.sorts?.length && !this.view.groups?.length;
  }

  /* ------------------------------------------------------------ painting */

  invalidate() {
    if (this.frame || this.destroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.paint();
    });
  }

  paint() {
    const { ctx, P, layout: L } = this;
    const p = this.palette;
    const W = this.W;
    const H = this.H;
    if (!W || !H) return;
    const sx = this.scroller.scrollLeft;
    const sy = this.scroller.scrollTop;
    this.fillHandle = null;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.textBaseline = 'middle';
    P.fontKey = '';
    P.font();
    const bodyTop = HEADER_H;
    const bodyH = H - HEADER_H - FOOTER_H;
    const lastCol = L.cols[L.cols.length - 1];
    const tableRight = lastCol ? Math.max(L.frozenW, L.colX(L.cols.length - 1, sx) + lastCol.w) : L.gutter;
    ctx.fillStyle = p.app;
    ctx.fillRect(0, 0, W, H);

    const [r0, r1] = L.rows.length ? L.visibleRows(sy, bodyH) : [0, -1];
    const [c0, c1] = L.visibleCols(sx, W);
    // Scrolled columns first, then the frozen ones on top.
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.frozenW, bodyTop, Math.max(0, W - L.frozenW), bodyH);
    ctx.clip();
    for (let i = r0; i <= r1; i++) this.paintRow(L.rows[i], i, 'scroll', c0, c1, sx, sy, tableRight);
    this.paintSelection('scroll', sx, sy);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, bodyTop, L.frozenW, bodyH);
    ctx.clip();
    for (let i = r0; i <= r1; i++) this.paintRow(L.rows[i], i, 'frozen', 0, L.frozen - 1, sx, sy, tableRight);
    this.paintSelection('frozen', sx, sy);
    ctx.restore();

    // Group headers and add lines span the table.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, bodyTop, W, bodyH);
    ctx.clip();
    for (let i = r0; i <= r1; i++) {
      const row = L.rows[i];
      if (row.k === 'group' || row.k === 'add') this.paintWideRow(row, i, sy, tableRight);
    }
    // Frozen divider.
    ctx.fillStyle = sx > 0 ? p.borderStrong : p.line;
    ctx.fillRect(L.frozenW - 1, bodyTop, 1, Math.min(bodyH, L.bodyH - sy));
    this.paintDragFeedback(sx, sy);
    ctx.restore();

    this.paintHeader(sx, tableRight);
    this.paintFooter(sx, tableRight);
  }

  rowColor(rec) {
    return this.colorTest ? this.colorTest(rec) : null;
  }

  paintRow(row, index, region, c0, c1, sx, sy, tableRight) {
    if (row.k !== 'rec') return;
    const { ctx, P, layout: L } = this;
    const p = this.palette;
    const y = HEADER_H + row.y - sy;
    const hgt = row.h;
    const rec = row.rec;
    const hovered = this.hover?.row === index;
    const checked = this.checked.has(rec.id);
    const left = region === 'frozen' ? 0 : L.frozenW;
    const right = region === 'frozen' ? L.frozenW : tableRight;
    ctx.fillStyle = p.bg;
    ctx.fillRect(left, y, right - left, hgt);
    if (checked) {
      ctx.fillStyle = p.accentSoft;
      ctx.fillRect(left, y, right - left, hgt);
    } else if (hovered) {
      ctx.fillStyle = p.hover;
      ctx.fillRect(left, y, right - left, hgt);
    }
    if (region === 'frozen') this.paintGutter(row, y, hovered, checked);
    const compute = this.base.compute;
    for (let c = c0; c <= c1; c++) {
      const col = L.cols[c];
      if (!col) continue;
      const x = L.colX(c, sx);
      if (this.search?.set.has(`${rec.id}|${col.field.id}`)) {
        const current = this.search.hits[this.search.index];
        ctx.fillStyle = current && current.recordId === rec.id && current.fieldId === col.field.id ? p.searchCurrent : p.searchHit;
        ctx.fillRect(x, y, col.w, hgt);
      }
      const v = compute.value(this.table, rec, col.field);
      if (!isEmpty(v) || col.field.type === 'checkbox' || col.field.type === 'rating') {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, col.w - 1, hgt - 1);
        ctx.clip();
        const active = this.cursor && this.cursor.r === row.ri && this.cursor.c === c;
        paintValue(P, col.field, v, x, y, col.w, hgt, { compute: compute.ctx, active, hover: hovered });
        ctx.restore();
      }
      ctx.fillStyle = p.line;
      ctx.fillRect(x + col.w - 1, y, 1, hgt);
    }
    ctx.fillStyle = p.line;
    ctx.fillRect(left, y + hgt - 1, right - left, 1);
  }

  paintGutter(row, y, hovered, checked) {
    const { ctx, P, layout: L } = this;
    const p = this.palette;
    const g = L.gutter;
    const hgt = row.h;
    const mid = y + Math.min(hgt, 32) / 2;
    const color = this.rowColor(row.rec);
    if (color) {
      ctx.fillStyle = accentColor(color);
      ctx.fillRect(2, y + 3, 3, hgt - 6);
    }
    if (this.compact) {
      P.font(12);
      P.text(String(row.ri + 1), 6, mid, g - 12, p.text3, 'center');
      P.font();
      return;
    }
    if (hovered || checked) {
      if (hovered && this.canReorderRows()) P.icon('grip', 6, mid - 7, 14, p.text3);
      const bx = 24;
      const by = mid - 7;
      if (checked) {
        P.roundRect(bx, by, 14, 14, 3, p.accent);
        P.icon('check', bx + 2, by + 2, 10, '#ffffff', { strokeWidth: 3 });
      } else P.roundRect(bx + 0.5, by + 0.5, 13, 13, 3, p.bg, p.borderStrong);
      if (hovered) P.icon('expand', 48, mid - 7, 14, p.accentText);
    } else {
      P.font(12);
      P.text(String(row.ri + 1), 8, mid, 40, p.text3, 'center');
      P.font();
    }
  }

  paintWideRow(row, index, sy, tableRight) {
    const { ctx, P, layout: L } = this;
    const p = this.palette;
    const y = HEADER_H + row.y - sy;
    const hovered = this.hover?.row === index;
    if (row.k === 'add') {
      ctx.fillStyle = hovered ? p.subtle : p.bg;
      ctx.fillRect(0, y, tableRight, row.h);
      ctx.fillStyle = p.line;
      ctx.fillRect(0, y + row.h - 1, tableRight, 1);
      ctx.fillRect(L.frozenW - 1, y, 1, row.h);
      P.icon('plus', this.compact ? 14 : 22, y + row.h / 2 - 8, 16, hovered ? p.text : p.text3);
      if (hovered && !this.compact) {
        P.font();
        P.text('Add record', 44, y + row.h / 2, 160, p.text2);
      }
      return;
    }
    // Group header.
    const node = row.node;
    const field = this.table.field(node.fieldId);
    ctx.fillStyle = row.depth === 0 ? p.subtle : p.bg;
    ctx.fillRect(0, y, tableRight, row.h);
    ctx.fillStyle = p.line;
    ctx.fillRect(0, y, tableRight, 1);
    ctx.fillRect(0, y + row.h - 1, tableRight, 1);
    const indent = 12 + row.depth * 14;
    const mid = y + row.h / 2;
    P.icon(row.collapsed ? 'chevronRight' : 'chevronDown', indent, mid - 8, 16, p.text2);
    let x = indent + 24;
    P.font(11);
    const label = field ? field.name : '';
    const lw = P.text(label, x, mid - 8, 200, p.text3);
    void lw;
    // Value on the second line.
    const vy = mid + 7;
    const value = node.value;
    const maxW = Math.max(120, Math.min(tableRight, this.W) - x - 120);
    let vw;
    if (value === null || value === undefined || (Array.isArray(value) && !value.length)) {
      P.font(13, 600);
      vw = P.text('Empty', x, vy, maxW, p.text3);
    } else if (field && (field.type === 'singleSelect' || field.type === 'multipleSelect')) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, vy - 12, maxW, 24);
      ctx.clip();
      paintValue(P, field, value, x - 8, vy - 16, maxW + 16, 32, { compute: this.base.compute.ctx });
      ctx.restore();
      P.font(12);
      const names = (Array.isArray(value) ? value : [value]).map((id) => field.options.choices.find((c) => c.id === id)?.name || '').join(', ');
      vw = Math.min(maxW, P.measure(names) + 24 * (Array.isArray(value) ? value.length : 1));
    } else {
      P.font(13, 600);
      vw = P.text(field ? toText(field, value, this.base.compute.ctx) || 'Empty' : '', x, vy, maxW, p.text);
    }
    P.font(12);
    P.text(`${row.count} ${row.count === 1 ? 'record' : 'records'}`, x + vw + 12, vy, 140, p.text3);
    P.font();
  }

  paintSelection(region, sx, sy) {
    const { ctx, layout: L } = this;
    const p = this.palette;
    if (!this.cursor || !L.records.length) return;
    const a = this.anchor || this.cursor;
    const b = this.cursor;
    const rMin = Math.min(a.r, b.r);
    const rMax = Math.max(a.r, b.r);
    let cMin = Math.min(a.c, b.c);
    let cMax = Math.max(a.c, b.c);
    if (region === 'frozen') cMax = Math.min(cMax, L.frozen - 1);
    else cMin = Math.max(cMin, L.frozen);
    if (cMin > cMax) return;
    const rowA = L.rows[L.recRow[rMin]];
    const rowB = L.rows[L.recRow[rMax]];
    if (!rowA || !rowB) return;
    const x1 = L.colX(cMin, sx);
    const x2 = L.colX(cMax, sx) + L.cols[cMax].w;
    const y1 = HEADER_H + rowA.y - sy;
    const y2 = HEADER_H + rowB.y + rowB.h - sy;
    if (rMin !== rMax || a.c !== b.c) {
      ctx.fillStyle = p.selection;
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(x1 + 0.5, y1 + 0.5, x2 - x1 - 1, y2 - y1 - 1);
    }
    // The active cell.
    if (b.c >= cMin && b.c <= cMax) {
      const row = L.rows[L.recRow[b.r]];
      const cx = L.colX(b.c, sx);
      const cy = HEADER_H + row.y - sy;
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(cx + 1, cy + 1, L.cols[b.c].w - 2, row.h - 2);
    }
    // Fill handle at the bottom right of the selection.
    const handleC = Math.max(a.c, b.c);
    if (handleC >= cMin && handleC <= cMax && !this.editor && !isReadOnly(L.cols[handleC].field)) {
      const hx = L.colX(handleC, sx) + L.cols[handleC].w - 4;
      const hy = y2 - 4;
      ctx.fillStyle = p.bg;
      ctx.fillRect(hx - 1, hy - 1, 8, 8);
      ctx.fillStyle = p.accent;
      ctx.fillRect(hx, hy, 6, 6);
      // Only a handle that is visible (not scrolled under the frozen
      // columns, header or footer) can be grabbed.
      const fx = hx + 3;
      const fy = hy + 3;
      const inRegion = region === 'frozen' ? fx < L.frozenW : fx >= L.frozenW && fx < this.W;
      if (inRegion && fy >= HEADER_H && fy < this.H - FOOTER_H) this.fillHandle = { x: fx, y: fy };
    }
  }

  paintDragFeedback(sx, sy) {
    const d = this.drag;
    if (!d) return;
    const { ctx, layout: L } = this;
    const p = this.palette;
    if (d.kind === 'colmove' && d.active) {
      const col = L.cols[d.from];
      ctx.fillStyle = p.selection;
      ctx.fillRect(d.x - d.offset, 0, col.w, this.H);
      if (d.to !== null) {
        const tx = d.to >= L.cols.length ? L.colX(L.cols.length - 1, sx) + L.cols[L.cols.length - 1].w : L.colX(d.to, sx);
        ctx.fillStyle = p.accent;
        ctx.fillRect(tx - 1, 0, 2, this.H);
      }
    }
    if (d.kind === 'rowmove' && d.active && d.toRow !== null) {
      const y = HEADER_H + d.toY - sy;
      ctx.fillStyle = p.accent;
      ctx.fillRect(0, y - 1, this.W, 2);
    }
    if (d.kind === 'fill' && d.active) {
      const a = this.anchor;
      const b = this.cursor;
      const cMin = Math.min(a.c, b.c);
      const cMax = Math.max(a.c, b.c);
      const rMax = Math.max(a.r, b.r);
      const to = Math.max(rMax, d.toR);
      const rowA = L.rows[L.recRow[Math.min(a.r, b.r)]];
      const rowB = L.rows[L.recRow[to]];
      const x1 = L.colX(cMin, sx);
      const x2 = L.colX(cMax, sx) + L.cols[cMax].w;
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(x1 + 0.5, HEADER_H + rowA.y - sy + 0.5, x2 - x1 - 1, rowB.y + rowB.h - rowA.y - 1);
      ctx.setLineDash([]);
    }
    if (d.kind === 'resize') {
      ctx.fillStyle = p.accent;
      ctx.fillRect(d.lineX - 1, 0, 2, this.H);
    }
  }

  headerTint(fieldId) {
    const p = this.palette;
    const v = this.view;
    const inFilter = (g) => g?.conditions?.some((c) => (c.conditions ? inFilter(c) : c.fieldId === fieldId && isActive(c)));
    if (v.groups?.some((g) => g.fieldId === fieldId)) return p.tintGroup;
    if (v.sorts?.some((s) => s.fieldId === fieldId)) return p.tintSort;
    if (inFilter(v.filters)) return p.tintFilter;
    return null;
  }

  paintHeader(sx, tableRight) {
    const { ctx, P, layout: L } = this;
    const p = this.palette;
    const W = this.W;
    ctx.fillStyle = p.app;
    ctx.fillRect(0, 0, W, HEADER_H);
    const paintCols = (from, to) => {
      for (let c = from; c <= to; c++) {
        const col = L.cols[c];
        if (!col) continue;
        const x = L.colX(c, sx);
        const tint = this.headerTint(col.field.id);
        const hovered = this.hover?.area === 'header' && this.hover.col === c;
        const selectedCol = this.cursor && c >= Math.min(this.cursor.c, this.anchor?.c ?? this.cursor.c) && c <= Math.max(this.cursor.c, this.anchor?.c ?? this.cursor.c);
        ctx.fillStyle = tint || (hovered ? p.subtle : p.header);
        ctx.fillRect(x, 0, col.w, HEADER_H);
        if (selectedCol) {
          ctx.fillStyle = p.selection;
          ctx.fillRect(x, 0, col.w, HEADER_H);
        }
        const ic = TYPES[col.field.type]?.icon || 'fText';
        P.icon(ic, x + 8, HEADER_H / 2 - 7, 14, p.text2);
        P.font(13, 500);
        const menuW = hovered ? 24 : 0;
        const descW = col.field.description ? 16 : 0;
        const tw = P.text(col.field.name, x + 28, HEADER_H / 2 + 0.5, col.w - 36 - menuW - descW, p.text);
        if (descW) P.icon('info', x + 28 + tw + 4, HEADER_H / 2 - 6, 12, p.text3);
        if (hovered) P.icon('chevronDown', x + col.w - 22, HEADER_H / 2 - 7, 14, p.text2);
        ctx.fillStyle = p.line;
        ctx.fillRect(x + col.w - 1, 0, 1, HEADER_H);
      }
      P.font();
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.frozenW, 0, Math.max(0, W - L.frozenW), HEADER_H);
    ctx.clip();
    const [c0, c1] = L.visibleCols(sx, W);
    paintCols(c0, c1);
    // The add-field column.
    const ax = tableRight;
    const addHover = this.hover?.area === 'header' && this.hover.col === -3;
    ctx.fillStyle = addHover ? p.subtle : p.header;
    ctx.fillRect(ax, 0, ADD_COL_W, HEADER_H);
    P.icon('plus', ax + ADD_COL_W / 2 - 8, HEADER_H / 2 - 8, 16, addHover ? p.text : p.text2);
    ctx.fillStyle = p.line;
    ctx.fillRect(ax + ADD_COL_W - 1, 0, 1, HEADER_H);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, L.frozenW, HEADER_H);
    ctx.clip();
    ctx.fillStyle = p.header;
    ctx.fillRect(0, 0, L.gutter, HEADER_H);
    if (!this.compact) {
      const all = this.layout.records.length > 0 && this.checked.size >= this.layout.records.length;
      const some = this.checked.size > 0;
      const bx = 24;
      const by = HEADER_H / 2 - 7;
      if (all || some) {
        P.roundRect(bx, by, 14, 14, 3, p.accent);
        if (all) P.icon('check', bx + 2, by + 2, 10, '#ffffff', { strokeWidth: 3 });
        else {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(bx + 3, by + 6, 8, 2);
        }
      } else P.roundRect(bx + 0.5, by + 0.5, 13, 13, 3, p.bg, p.borderStrong);
    }
    paintCols(0, L.frozen - 1);
    ctx.restore();
    ctx.fillStyle = sx > 0 ? p.borderStrong : p.line;
    ctx.fillRect(L.frozenW - 1, 0, 1, HEADER_H);
    ctx.fillStyle = p.line;
    ctx.fillRect(0, HEADER_H - 1, Math.min(W, tableRight + ADD_COL_W), 1);
  }

  summaryFormatter(field) {
    const o = field.options || {};
    if (field.type === 'currency') return (n) => formatCurrency(n, o.symbol ?? '$', o.precision ?? 2);
    if (field.type === 'percent') return (n) => formatPercent(n, o.precision ?? 0);
    if (field.type === 'duration') return (n) => formatDuration(n, o.format);
    if (field.type === 'number') return (n) => formatNumber(n, Math.max(o.precision ?? 0, Number.isInteger(n) ? 0 : 2));
    return (n) => formatNumber(n, Number.isInteger(n) ? 0 : 2);
  }

  summaryText(col) {
    const fn = this.view.summaries?.[col.field.id];
    if (!fn || fn === 'none') return null;
    const key = `${this.base.version}|${fn}|${col.field.id}|${this.view.id}`;
    this.summaryCache ||= new Map();
    if (this.summaryCache.has(key)) return this.summaryCache.get(key);
    const kind = valueKind(col.field, this.base.compute.ctx);
    const values = this.result.records.map((r) => this.base.compute.value(this.table, r, col.field));
    const text = summarize(kind, values, fn, this.summaryFormatter(col.field));
    if (this.summaryCache.size > 200) this.summaryCache.clear();
    const out = text === '' ? '' : `${SUMMARIES[fn]} ${text}`;
    this.summaryCache.set(key, out);
    return out;
  }

  paintFooter(sx, tableRight) {
    const { ctx, P, layout: L } = this;
    const p = this.palette;
    const y = this.H - FOOTER_H;
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, y, this.W, FOOTER_H);
    ctx.fillStyle = p.border;
    ctx.fillRect(0, y, this.W, 1);
    const mid = y + FOOTER_H / 2;
    P.font(12);
    const paintCols = (from, to) => {
      for (let c = from; c <= to; c++) {
        const col = L.cols[c];
        if (!col || c === 0) continue;
        const x = L.colX(c, sx);
        const text = this.summaryText(col);
        const hovered = this.hover?.area === 'footer' && this.hover.col === c;
        if (hovered) {
          ctx.fillStyle = p.hover;
          ctx.fillRect(x, y + 1, col.w, FOOTER_H - 1);
        }
        if (text) P.text(text, x + 8, mid, col.w - 16, p.text2, 'right');
        else if (hovered) P.text('Summarize', x + 8, mid, col.w - 30, p.text3, 'right');
        if (hovered && !text) P.icon('chevronDown', x + col.w - 20, mid - 6, 12, p.text3);
      }
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.frozenW, y, Math.max(0, this.W - L.frozenW), FOOTER_H);
    ctx.clip();
    const [c0, c1] = L.visibleCols(sx, this.W);
    paintCols(c0, c1);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, L.frozenW, FOOTER_H);
    ctx.clip();
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, y + 1, L.frozenW, FOOTER_H - 1);
    const n = this.result.records.length;
    const total = this.table.records.size;
    const label = this.checked.size
      ? `${this.checked.size} selected`
      : n === total ? `${n} ${n === 1 ? 'record' : 'records'}` : `${n} of ${total} records`;
    P.text(label, 12, mid, L.frozenW - 24 - (L.frozen > 0 ? 0 : 0), p.text2);
    paintCols(1, L.frozen - 1);
    const firstText = L.cols[0] && this.view.summaries?.[L.cols[0].field.id] ? this.summaryText(L.cols[0]) : null;
    if (firstText) P.text(firstText, L.cols[0].x + 8, mid, L.cols[0].w - 16, p.text2, 'right');
    ctx.restore();
    P.font();
    void tableRight;
  }

  /* ------------------------------------------------------------- hit test */

  local(e) {
    const r = this.scroller.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  hit(x, y) {
    const L = this.layout;
    const sx = this.scroller.scrollLeft;
    const sy = this.scroller.scrollTop;
    if (x > this.W || y > this.H) return { area: 'none' };
    if (y < HEADER_H) {
      const col = L.colAt(x, sx);
      if (col === -2) return { area: 'header', col: -2, part: 'all' };
      if (col === -3) return { area: 'header', col: -3, part: 'add' };
      if (col < 0) return { area: 'header', col: -1 };
      const cx = L.colX(col, sx);
      const cw = L.cols[col].w;
      if (x >= cx + cw - 5) return { area: 'header', col, part: 'resize' };
      if (col > 0 && x <= cx + 3) return { area: 'header', col: col - 1, part: 'resize' };
      if (x >= cx + cw - 26) return { area: 'header', col, part: 'menu' };
      return { area: 'header', col, part: 'name' };
    }
    if (y > this.H - FOOTER_H) {
      const col = L.colAt(x, sx);
      return { area: 'footer', col };
    }
    const by = y - HEADER_H + sy;
    const ri = L.rowAt(by);
    if (ri < 0) return { area: 'body', row: -1 };
    const row = L.rows[ri];
    if (row.k === 'group') return { area: 'body', row: ri, part: 'group' };
    if (row.k === 'add') return { area: 'body', row: ri, part: 'addrow' };
    if (row.k === 'gap') return { area: 'body', row: ri, part: 'gap' };
    if (this.fillHandle && Math.abs(x - this.fillHandle.x) <= 6 && Math.abs(y - this.fillHandle.y) <= 6) return { area: 'body', row: ri, part: 'fill' };
    const col = L.colAt(x, sx);
    if (col === -2) {
      if (this.compact) return { area: 'body', row: ri, part: 'expand' };
      if (x < 18) return { area: 'body', row: ri, part: 'grip' };
      if (x < 42) return { area: 'body', row: ri, part: 'check' };
      return { area: 'body', row: ri, part: 'expand' };
    }
    if (col < 0) return { area: 'body', row: ri, part: 'empty' };
    return { area: 'body', row: ri, col, part: 'cell', ri: row.ri };
  }

  /* --------------------------------------------------------------- events */

  bind() {
    const s = this.scroller;
    s.addEventListener('scroll', () => {
      // Content moved under a still pointer (a wheel): hover what is there now.
      if (this.pointerAt && !this.drag) this.hoverAt(this.pointerAt.x, this.pointerAt.y);
      this.invalidate();
      this.positionEditor();
    }, { passive: true });
    s.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    s.addEventListener('pointermove', (e) => this.onPointerMove(e));
    s.addEventListener('pointerleave', () => {
      this.pointerAt = null;
      if (!this.drag && this.hover) {
        this.hover = null;
        this.invalidate();
      }
    });
    s.addEventListener('dblclick', (e) => this.onDblClick(e));
    s.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    s.addEventListener('keydown', (e) => this.onKey(e));
    s.addEventListener('focus', () => this.updateProxy());
    // Files dropped on an attachment cell are uploaded to it. Elsewhere on
    // the grid they are refused, so the browser does not open the file.
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    const dropTarget = (e) => {
      if (!hasFiles(e)) return null;
      const { x, y } = this.local(e);
      const hit = this.hit(x, y);
      if (hit.part !== 'cell') return null;
      const field = this.layout.cols[hit.col].field;
      return field.type === 'attachment' ? { rec: this.layout.rows[hit.row].rec, field, r: this.layout.rows[hit.row].ri, c: hit.col } : null;
    };
    s.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const t = dropTarget(e);
      e.dataTransfer.dropEffect = t ? 'copy' : 'none';
      if (t && (!this.cursor || this.cursor.r !== t.r || this.cursor.c !== t.c)) this.setCursor(t.r, t.c, { scroll: false, announce: false });
    });
    s.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const t = dropTarget(e);
      if (t) uploadFiles(this.page, this.table, t.field, t.rec.id, e.dataTransfer.files);
    });
    this.onWindowMove = (e) => this.onDragMove(e);
    this.onWindowUp = (e) => this.onDragEnd(e);
    this.onWindowCancel = () => this.cancelDrag();
    this.onCopy = (e) => this.handleCopy(e, false);
    this.onCut = (e) => this.handleCopy(e, true);
    this.onPaste = (e) => this.handlePaste(e);
    document.addEventListener('copy', this.onCopy);
    document.addEventListener('cut', this.onCut);
    document.addEventListener('paste', this.onPaste);
  }

  onPointerMove(e) {
    if (this.drag) return;
    const { x, y } = this.local(e);
    // Touch has no hover.
    this.pointerAt = e.pointerType === 'touch' ? null : { x, y };
    this.hoverAt(x, y);
  }

  hoverAt(x, y) {
    const hit = this.hit(x, y);
    const hover = { area: hit.area, row: hit.row ?? -1, col: hit.col ?? -1 };
    let cursor = 'default';
    if (hit.part === 'resize') cursor = 'col-resize';
    else if (hit.part === 'fill') cursor = 'crosshair';
    else if (hit.part === 'grip' && this.canReorderRows()) cursor = 'grab';
    else if (hit.part === 'addrow' || hit.part === 'group' || hit.part === 'add' || hit.part === 'expand' || hit.part === 'check' || hit.part === 'menu' || hit.area === 'footer') cursor = 'pointer';
    this.scroller.style.cursor = cursor;
    // Field descriptions show on hover over the header.
    const desc = hit.area === 'header' && hit.col >= 0 ? this.layout.cols[hit.col]?.field.description || '' : '';
    if (this.scroller.title !== desc) this.scroller.title = desc;
    if (!this.hover || hover.area !== this.hover.area || hover.row !== this.hover.row || hover.col !== this.hover.col) {
      this.hover = hover;
      this.invalidate();
    }
  }

  onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // Ctrl-click on a Mac is a right click: the context menu handles it.
    if (isMac && e.ctrlKey && e.pointerType === 'mouse') return;
    const { x, y } = this.local(e);
    if (x > this.W || y > this.H) return;
    const hit = this.hit(x, y);
    if (this.editor && !this.editor.contains?.(e.target)) this.closeEditor(true);
    if (e.pointerType === 'touch') {
      const s = this.scroller;
      // A touch ends in a tap, a long press, or a scroll; each removes all of these.
      const end = () => {
        s.removeEventListener('pointerup', up);
        s.removeEventListener('pointercancel', end);
        s.removeEventListener('scroll', end);
        if (this.touch) clearTimeout(this.touch.timer);
        this.touch = null;
        this.endTouch = null;
      };
      const up = (ev) => {
        const t = this.touch;
        end();
        if (!t) return;
        const p = this.local(ev);
        if (Math.hypot(p.x - t.x, p.y - t.y) > 10) return;
        this.onTap(t.hit, ev);
      };
      this.endTouch?.();
      this.endTouch = end;
      this.touch = { x, y, t: Date.now(), hit, timer: setTimeout(() => {
        end();
        this.onContextMenu({ clientX: e.clientX, clientY: e.clientY, preventDefault() {}, synthetic: true, hit });
      }, 550) };
      s.addEventListener('pointerup', up);
      s.addEventListener('pointercancel', end);
      s.addEventListener('scroll', end, { passive: true });
      return;
    }
    this.scroller.focus({ preventScroll: true });
    if (hit.area === 'header') return this.headerDown(e, hit, x);
    if (hit.area === 'footer') return this.footerClick(hit, e);
    if (hit.area !== 'body' || hit.row < 0) return;
    const row = this.layout.rows[hit.row];
    switch (hit.part) {
      case 'group':
        this.toggleGroup(row.node.path);
        return;
      case 'addrow':
        this.addRecordIn(row);
        return;
      case 'check':
        this.toggleChecked(row.rec.id, e.shiftKey ? row.ri : null);
        return;
      case 'expand':
        this.page.openRecord(row.rec.id);
        return;
      case 'grip':
        if (this.canReorderRows()) this.startDrag(e, { kind: 'rowmove', ids: this.checked.has(row.rec.id) ? this.layout.records.filter((r) => this.checked.has(r.id)).map((r) => r.id) : [row.rec.id], startY: y, active: false, toRow: null });
        else this.setCursor(row.ri, 0);
        return;
      case 'fill':
        this.startDrag(e, { kind: 'fill', startY: y, active: false, toR: Math.max(this.anchor.r, this.cursor.r) });
        return;
      case 'cell': {
        const field = this.layout.cols[hit.col].field;
        const wasActive = this.cursor && this.cursor.r === row.ri && this.cursor.c === hit.col && this.anchor?.r === row.ri && this.anchor?.c === hit.col;
        if (e.shiftKey && this.cursor) {
          this.cursor = { r: row.ri, c: hit.col };
          this.afterSelect();
        } else {
          this.setCursor(row.ri, hit.col, { scroll: false });
          this.checked.size && !modKey(e) && (this.checked.clear(), this.invalidate());
        }
        // One-click cell types (not when Shift extends the selection).
        if (!e.shiftKey && (wasActive || field.type === 'checkbox')) {
          if (this.cellClick(row, hit.col, x, y)) return;
        }
        this.startDrag(e, { kind: 'select', active: true });
        return;
      }
      default:
    }
  }

  onTap(hit, e) {
    this.scroller.focus({ preventScroll: true });
    if (hit.area === 'header') {
      if (hit.part === 'add') this.addField();
      else if (hit.col >= 0) this.openFieldMenu(hit.col, { x: e.clientX, y: e.clientY });
      return;
    }
    if (hit.area === 'footer') return this.footerClick(hit, e);
    if (hit.area !== 'body' || hit.row < 0) return;
    const row = this.layout.rows[hit.row];
    if (hit.part === 'group') return this.toggleGroup(row.node.path);
    if (hit.part === 'addrow') return this.addRecordIn(row);
    if (hit.part === 'expand' || hit.part === 'check' || hit.part === 'grip') return this.page.openRecord(row.rec.id);
    if (hit.part === 'cell') {
      const wasActive = this.cursor && this.cursor.r === row.ri && this.cursor.c === hit.col;
      this.setCursor(row.ri, hit.col, { scroll: false });
      const field = this.layout.cols[hit.col].field;
      if (field.type === 'checkbox' || field.type === 'rating' || field.type === 'button') {
        const { x, y } = this.local(e);
        this.cellClick(row, hit.col, x, y);
      } else if (wasActive) this.startEdit();
    }
  }

  /** Clicks that act right away (checkbox, rating, button). Returns true if handled. */
  cellClick(row, c, x, y) {
    const field = this.layout.cols[c].field;
    if (isReadOnly(field) && field.type !== 'button') return false;
    if (field.type === 'checkbox') {
      this.base.setCell(this.table.id, row.rec.id, field.id, !row.rec.c[field.id]);
      return true;
    }
    if (field.type === 'rating') {
      const cx = this.layout.colX(c, this.scroller.scrollLeft) + 8;
      const i = Math.floor((x - cx) / 17);
      const max = field.options?.max || 5;
      // Only stars that fit the column are drawn, and only those count.
      const fits = 8 + i * 17 + 14 <= this.layout.cols[c].w - 4;
      if (i >= 0 && i < max && fits) {
        const cur = row.rec.c[field.id] || 0;
        this.base.setCell(this.table.id, row.rec.id, field.id, cur === i + 1 ? null : i + 1);
        return true;
      }
      return false;
    }
    if (field.type === 'button') {
      this.pressButton(row.rec, field);
      return true;
    }
    void y;
    return false;
  }

  pressButton(rec, field) {
    const url = buttonUrl(this.base, this.table, rec, field);
    if (url) window.open(url, '_blank', 'noopener');
    else toast('This button has no link yet. Set one in the field settings.');
  }

  onDblClick(e) {
    const { x, y } = this.local(e);
    const hit = this.hit(x, y);
    if (hit.area === 'header' && hit.part === 'resize') {
      this.autoFit(hit.col);
      return;
    }
    if (hit.area === 'header' && hit.col >= 0 && hit.part === 'name') {
      this.editField(hit.col);
      return;
    }
    if (hit.area === 'body' && hit.part === 'cell') {
      const field = this.layout.cols[hit.col].field;
      if (field.type === 'checkbox' || field.type === 'rating' || field.type === 'button') return;
      this.startEdit();
    }
  }

  headerDown(e, hit, x) {
    if (hit.part === 'add') {
      this.addField();
      return;
    }
    if (hit.part === 'all') {
      // The compact grid draws no check-all box there.
      if (this.compact) return;
      if (this.checked.size) this.checked.clear();
      else for (const r of this.layout.records) this.checked.add(r.id);
      this.announceChecked();
      this.invalidate();
      return;
    }
    if (hit.col < 0) return;
    if (hit.part === 'resize') {
      const col = this.layout.cols[hit.col];
      this.startDrag(e, { kind: 'resize', col: hit.col, startX: x, startW: col.w, w: col.w, lineX: this.layout.colX(hit.col, this.scroller.scrollLeft) + col.w });
      return;
    }
    if (hit.part === 'menu') {
      this.openFieldMenu(hit.col);
      return;
    }
    // Select the column; dragging moves it.
    const sx = this.scroller.scrollLeft;
    this.startDrag(e, { kind: 'colmove', from: hit.col, startX: x, x, offset: x - this.layout.colX(hit.col, sx), active: false, to: null });
  }

  footerClick(hit, e) {
    if (hit.col === undefined || hit.col < 0) return;
    const col = this.layout.cols[hit.col];
    if (!col) return;
    const kind = valueKind(col.field, this.base.compute.ctx);
    const current = this.view.summaries?.[col.field.id] || 'none';
    openMenu({ x: e.clientX, y: e.clientY - 4 }, summariesFor(kind).map((fn) => ({
      label: SUMMARIES[fn],
      checked: current === fn,
      radio: true,
      onSelect: () => this.base.updateView(this.table.id, this.view.id, { summaries: { ...(this.view.summaries || {}), [col.field.id]: fn } }, { label: 'Change summary' }),
    })), { placement: 'top-start', label: `Summary for ${col.field.name}` });
  }

  startDrag(e, drag) {
    this.drag = drag;
    window.addEventListener('pointermove', this.onWindowMove);
    window.addEventListener('pointerup', this.onWindowUp);
    // The browser can take a pen or touch drag over to scroll.
    window.addEventListener('pointercancel', this.onWindowCancel);
    this.autoScroll();
    e.preventDefault?.();
  }

  stopDragging() {
    const d = this.drag;
    this.drag = null;
    window.removeEventListener('pointermove', this.onWindowMove);
    window.removeEventListener('pointerup', this.onWindowUp);
    window.removeEventListener('pointercancel', this.onWindowCancel);
    cancelAnimationFrame(this.scrollFrame);
    return d;
  }

  /** End a drag without acting on it. */
  cancelDrag() {
    const d = this.stopDragging();
    // A resize shifted the columns live: put them back.
    if (d?.kind === 'resize') this.buildColumns();
    this.invalidate();
  }

  autoScroll() {
    cancelAnimationFrame(this.scrollFrame);
    const tick = () => {
      if (!this.drag) return;
      const d = this.drag;
      if (d.last && (d.kind === 'select' || d.kind === 'fill' || d.kind === 'rowmove' || d.kind === 'colmove')) {
        const { x, y } = d.last;
        let dx = 0;
        let dy = 0;
        const edge = 36;
        if (y < HEADER_H + edge && d.kind !== 'colmove') dy = -Math.ceil((HEADER_H + edge - y) / 3);
        else if (y > this.H - FOOTER_H - edge && d.kind !== 'colmove') dy = Math.ceil((y - (this.H - FOOTER_H - edge)) / 3);
        if (x > this.W - edge && d.kind !== 'rowmove' && d.kind !== 'fill') dx = Math.ceil((x - (this.W - edge)) / 3);
        else if (x < this.layout.frozenW + edge && x > this.layout.frozenW && d.kind !== 'rowmove' && d.kind !== 'fill') dx = -Math.ceil((this.layout.frozenW + edge - x) / 3);
        if (dx || dy) {
          this.scroller.scrollLeft += dx;
          this.scroller.scrollTop += dy;
          this.dragTo(x, y);
        }
      }
      this.scrollFrame = requestAnimationFrame(tick);
    };
    this.scrollFrame = requestAnimationFrame(tick);
  }

  onDragMove(e) {
    if (!this.drag) return;
    // No button down: the release happened where it was not seen.
    if (e.buttons === 0) return this.onDragEnd(e);
    const { x, y } = this.local(e);
    this.drag.last = { x, y };
    this.dragTo(x, y);
  }

  dragTo(x, y) {
    const d = this.drag;
    const L = this.layout;
    const sx = this.scroller.scrollLeft;
    const sy = this.scroller.scrollTop;
    switch (d.kind) {
      case 'select': {
        const by = Math.max(0, Math.min(y, this.H - FOOTER_H - 1)) - HEADER_H + sy;
        let ri = L.rowAt(Math.max(0, by));
        if (ri < 0) ri = L.rows.length - 1;
        let row = L.rows[ri];
        while (row && row.k !== 'rec' && ri > 0) row = L.rows[--ri];
        if (!row || row.k !== 'rec') return;
        let c = L.colAt(Math.max(L.gutter, Math.min(x, this.W - 1)), sx);
        if (c === -3 || c === -1) c = L.cols.length - 1;
        if (c < 0) c = 0;
        if (this.cursor.r !== row.ri || this.cursor.c !== c) {
          this.cursor = { r: row.ri, c };
          this.afterSelect(false);
        }
        break;
      }
      case 'resize': {
        d.w = Math.max(MIN_COL_W, Math.round(d.startW + (x - d.startX)));
        d.lineX = L.colX(d.col, sx) + d.w;
        L.cols[d.col].w = d.w;
        // Shift following columns so the drag feels live.
        let cx = L.cols[d.col].x + d.w;
        for (let i = d.col + 1; i < L.cols.length; i++) {
          L.cols[i].x = cx;
          cx += L.cols[i].w;
        }
        if (d.col < L.frozen) L.frozenW = L.cols[L.frozen - 1].x + L.cols[L.frozen - 1].w;
        this.invalidate();
        break;
      }
      case 'colmove': {
        if (!d.active && Math.abs(x - d.startX) > 4) d.active = true;
        if (!d.active) return;
        d.x = x;
        let to = L.colAt(Math.max(L.gutter + 1, x), sx);
        if (to === -3 || to === -1) to = L.cols.length;
        if (to >= 0 && to < L.cols.length) {
          const cx = L.colX(to, sx);
          if (x > cx + L.cols[to].w / 2) to++;
        }
        // The primary field stays first.
        d.to = Math.max(1, to);
        this.invalidate();
        break;
      }
      case 'rowmove': {
        if (!d.active && Math.abs(y - d.startY) > 4) d.active = true;
        if (!d.active) return;
        const by = y - HEADER_H + sy;
        let ri = L.rowAt(Math.max(0, by));
        if (ri < 0) ri = L.rows.length - 1;
        const row = L.rows[ri];
        if (row.k === 'rec') {
          const after = by > row.y + row.h / 2;
          d.toRow = after ? ri + 1 : ri;
          d.toY = after ? row.y + row.h : row.y;
        } else {
          d.toRow = ri;
          d.toY = row.y;
        }
        this.invalidate();
        break;
      }
      case 'fill': {
        if (!d.active && Math.abs(y - d.startY) > 3) d.active = true;
        const by = Math.min(y, this.H - FOOTER_H - 1) - HEADER_H + sy;
        let ri = L.rowAt(Math.max(0, by));
        if (ri < 0) ri = L.rows.length - 1;
        let row = L.rows[ri];
        while (row && row.k !== 'rec' && ri > 0) row = L.rows[--ri];
        if (row?.k === 'rec') d.toR = row.ri;
        this.invalidate();
        break;
      }
      default:
    }
  }

  onDragEnd() {
    const d = this.stopDragging();
    if (!d) return;
    const L = this.layout;
    switch (d.kind) {
      case 'resize': {
        const field = L.cols[d.col].field;
        // A column shown narrower than its saved width (no room on this
        // screen) keeps that width when dragged wider: only narrowing saves.
        const narrowed = (this.view.widths?.[field.id] ?? 0) > d.startW;
        if (d.w !== d.startW && !(narrowed && d.w > d.startW)) this.base.updateView(this.table.id, this.view.id, { widths: { ...(this.view.widths || {}), [field.id]: d.w } }, { label: 'Resize field' });
        else this.recompute();
        break;
      }
      case 'colmove': {
        if (!d.active) {
          this.selectColumn(d.from);
          break;
        }
        if (d.to === null || d.to === d.from || d.to === d.from + 1 || d.from === 0) {
          this.invalidate();
          break;
        }
        // Read before the move: it rebuilds the columns.
        const { id: moving, name } = L.cols[d.from].field;
        const rest = L.cols.map((c) => c.field.id).filter((id) => id !== moving);
        const at = d.to > d.from ? d.to - 1 : d.to;
        this.base.updateView(this.table.id, this.view.id, { order: this.orderWith(moving, rest[at]) }, { label: 'Move field' });
        announce(`Moved ${name}`);
        break;
      }
      case 'rowmove': {
        if (!d.active || d.toRow === null) {
          this.invalidate();
          break;
        }
        const target = L.rows.slice(d.toRow).find((r) => r.k === 'rec' && !d.ids.includes(r.rec.id));
        this.base.moveRecords(this.table.id, d.ids, target ? target.rec.id : null);
        break;
      }
      case 'fill': {
        if (d.active) this.fillDown(d.toR);
        else this.invalidate();
        break;
      }
      default:
        this.invalidate();
    }
  }

  onContextMenu(e) {
    e.preventDefault();
    const pt = { x: e.clientX, y: e.clientY };
    const hit = e.hit || this.hit(...Object.values(this.local(e)));
    if (hit.area === 'header' && hit.col >= 0) {
      this.openFieldMenu(hit.col, pt);
      return;
    }
    if (hit.area === 'body' && hit.row >= 0) {
      const row = this.layout.rows[hit.row];
      if (row.k === 'group') {
        openMenu(pt, [
          { label: 'Collapse all groups', icon: 'collapse', onSelect: () => this.setAllGroups(true) },
          { label: 'Expand all groups', icon: 'expand', onSelect: () => this.setAllGroups(false) },
        ]);
        return;
      }
      if (row.k !== 'rec') return;
      if (hit.part === 'cell') {
        const inRange = this.inSelection(row.ri, hit.col);
        if (!inRange) this.setCursor(row.ri, hit.col, { scroll: false });
      }
      this.openRecordMenu(row.rec, pt);
    }
  }

  /* ------------------------------------------------------------ selection */

  setCursor(r, c, { scroll = true, extend = false, announce: speak = true } = {}) {
    const L = this.layout;
    if (!L.records.length) {
      this.cursor = null;
      this.anchor = null;
      this.updateProxy();
      this.invalidate();
      return;
    }
    r = Math.max(0, Math.min(L.records.length - 1, r));
    c = Math.max(0, Math.min(L.cols.length - 1, c));
    this.cursor = { r, c };
    if (!extend) this.anchor = { r, c };
    if (scroll) this.scrollIntoView(r, c);
    this.afterSelect(speak);
  }

  afterSelect(speak = true) {
    this.updateProxy(speak);
    this.invalidate();
  }

  selectColumn(c) {
    if (!this.layout.records.length) return;
    // The active cell is the top one: typing edits the first record.
    this.anchor = { r: this.layout.records.length - 1, c };
    this.cursor = { r: 0, c };
    this.afterSelect();
    announce(`Selected column ${this.layout.cols[c].field.name}`);
  }

  inSelection(r, c) {
    if (!this.cursor) return false;
    const a = this.anchor || this.cursor;
    return r >= Math.min(a.r, this.cursor.r) && r <= Math.max(a.r, this.cursor.r) && c >= Math.min(a.c, this.cursor.c) && c <= Math.max(a.c, this.cursor.c);
  }

  range() {
    if (!this.cursor) return null;
    const a = this.anchor || this.cursor;
    return { r0: Math.min(a.r, this.cursor.r), r1: Math.max(a.r, this.cursor.r), c0: Math.min(a.c, this.cursor.c), c1: Math.max(a.c, this.cursor.c) };
  }

  scrollIntoView(r, c) {
    const L = this.layout;
    const row = L.rows[L.recRow[r]];
    if (!row) return;
    const s = this.scroller;
    const viewH = this.H - HEADER_H - FOOTER_H;
    if (row.y < s.scrollTop) s.scrollTop = row.y;
    else if (row.y + row.h > s.scrollTop + viewH) s.scrollTop = row.y + row.h - viewH;
    if (c >= L.frozen) {
      const col = L.cols[c];
      const visibleW = this.W - L.frozenW;
      const left = col.x - L.frozenW;
      // A column wider than the visible area shows from its left edge.
      if (left < s.scrollLeft) s.scrollLeft = left;
      else if (left + col.w > s.scrollLeft + visibleW) s.scrollLeft = col.w > visibleW ? left : left + col.w - visibleW;
    }
  }

  toggleChecked(id, shiftIndex) {
    // The last checked record is kept by id: sorting or filtering moves it.
    const last = shiftIndex !== null && this.lastChecked ? this.layout.records.findIndex((r) => r.id === this.lastChecked) : -1;
    if (last >= 0) {
      const [a, b] = [Math.min(shiftIndex, last), Math.max(shiftIndex, last)];
      for (let i = a; i <= b; i++) this.checked.add(this.layout.records[i].id);
    } else if (this.checked.has(id)) this.checked.delete(id);
    else this.checked.add(id);
    this.lastChecked = id;
    this.announceChecked();
    this.invalidate();
  }

  announceChecked() {
    announce(this.checked.size ? `${this.checked.size} record${this.checked.size === 1 ? '' : 's'} selected` : 'Selection cleared');
  }

  /** The screen reader proxy: the active cell's field, value and position. */
  updateProxy(speak = false) {
    const L = this.layout;
    if (!this.cursor || !L.records.length) {
      this.scroller.removeAttribute('aria-activedescendant');
      this.headProxy.replaceChildren();
      this.cellProxy.textContent = L.records.length ? '' : 'No records';
      return;
    }
    const { r, c } = this.cursor;
    const rec = L.records[r];
    const col = L.cols[c];
    if (!rec || !col) return;
    if (speak) {
      this.rowProxy.hidden = true;
      this.cellProxy.textContent = '';
      this.proxyTurn ^= 1;
      ({ row: this.rowProxy, cell: this.cellProxy } = this.proxies[this.proxyTurn]);
      this.rowProxy.hidden = false;
    }
    const v = this.base.compute.value(this.table, rec, col.field);
    let text = toText(col.field, v, this.base.compute.ctx);
    if (col.field.type === 'checkbox') text = v ? 'checked' : 'not checked';
    this.headProxy.replaceChildren(h('div', { role: 'columnheader', 'aria-colindex': String(c + 1) }, col.field.name));
    this.rowProxy.setAttribute('aria-rowindex', String(r + 2));
    this.rowProxy.setAttribute('aria-selected', String(this.checked.has(rec.id)));
    this.cellProxy.setAttribute('aria-colindex', String(c + 1));
    this.cellProxy.setAttribute('aria-readonly', String(isReadOnly(col.field)));
    const rg = this.range();
    const multi = rg && (rg.r1 > rg.r0 || rg.c1 > rg.c0) ? `, ${rg.r1 - rg.r0 + 1} by ${rg.c1 - rg.c0 + 1} cells selected` : '';
    this.cellProxy.textContent = `${col.field.name}: ${text || 'empty'}${multi}`;
    this.scroller.setAttribute('aria-activedescendant', this.cellProxy.id);
  }

  /* -------------------------------------------------------------- keyboard */

  onKey(e) {
    if (e.target !== this.scroller || e.isComposing) return;
    const L = this.layout;
    const mod = modKey(e);
    const key = e.key;
    if (!this.cursor && L.records.length && /^(Arrow|Tab|Enter|Home|End|Page)/.test(key)) {
      e.preventDefault();
      this.setCursor(0, 0);
      return;
    }
    const cur = this.cursor;
    const move = (dr, dc) => {
      e.preventDefault();
      if (!cur) return;
      this.setCursor(cur.r + dr, cur.c + dc, { extend: e.shiftKey });
    };
    const lastR = L.records.length - 1;
    const lastC = L.cols.length - 1;
    switch (key) {
      case 'ArrowUp':
        return mod ? (e.preventDefault(), this.setCursor(0, cur?.c ?? 0, { extend: e.shiftKey })) : move(-1, 0);
      case 'ArrowDown':
        return mod ? (e.preventDefault(), this.setCursor(lastR, cur?.c ?? 0, { extend: e.shiftKey })) : move(1, 0);
      case 'ArrowLeft':
        return mod ? (e.preventDefault(), this.setCursor(cur?.r ?? 0, 0, { extend: e.shiftKey })) : move(0, -1);
      case 'ArrowRight':
        return mod ? (e.preventDefault(), this.setCursor(cur?.r ?? 0, lastC, { extend: e.shiftKey })) : move(0, 1);
      case 'Home':
        e.preventDefault();
        return this.setCursor(mod ? 0 : cur?.r ?? 0, 0, { extend: e.shiftKey });
      case 'End':
        e.preventDefault();
        return this.setCursor(mod ? lastR : cur?.r ?? 0, lastC, { extend: e.shiftKey });
      case 'PageDown':
      case 'PageUp': {
        e.preventDefault();
        const n = Math.max(1, Math.floor((this.H - HEADER_H - FOOTER_H) / (L.rowH || 32)) - 1);
        return this.setCursor((cur?.r ?? 0) + (key === 'PageDown' ? n : -n), cur?.c ?? 0, { extend: e.shiftKey });
      }
      case 'Tab': {
        if (!cur) return;
        // At the first and last cell, Tab moves focus out of the grid.
        if (e.shiftKey ? cur.c === 0 && cur.r === 0 : cur.c === lastC && cur.r === lastR) return;
        e.preventDefault();
        if (e.shiftKey) {
          if (cur.c > 0) this.setCursor(cur.r, cur.c - 1);
          else this.setCursor(cur.r - 1, lastC);
        } else if (cur.c < lastC) this.setCursor(cur.r, cur.c + 1);
        else this.setCursor(cur.r + 1, 0);
        return;
      }
      case 'Enter': {
        if (!cur) {
          if (!L.records.length && e.shiftKey) this.insertRecord(null);
          return;
        }
        e.preventDefault();
        if (e.shiftKey) {
          this.insertRecord(L.records[cur.r].id);
          return;
        }
        const field = L.cols[cur.c].field;
        if (field.type === 'checkbox') {
          const rec = L.records[cur.r];
          this.base.setCell(this.table.id, rec.id, field.id, !rec.c[field.id]);
        } else if (field.type === 'button') this.pressButton(L.records[cur.r], field);
        else this.startEdit();
        return;
      }
      case 'F2': {
        e.preventDefault();
        const field = cur && L.cols[cur.c].field;
        // A checkbox has no editor: F2 toggles it, like Enter.
        if (field?.type === 'checkbox') {
          const rec = L.records[cur.r];
          this.base.setCell(this.table.id, rec.id, field.id, !rec.c[field.id]);
        } else this.startEdit();
        return;
      }
      case ' ':
        if (!cur) return;
        e.preventDefault();
        if (L.cols[cur.c].field.type === 'checkbox' && !e.shiftKey) {
          this.toggleRangeCheckbox();
          return;
        }
        this.page.openRecord(L.records[cur.r].id);
        return;
      case 'Escape':
        if (this.checked.size) {
          this.checked.clear();
          this.announceChecked();
          this.invalidate();
        } else if (cur && (this.anchor?.r !== cur.r || this.anchor?.c !== cur.c)) {
          this.anchor = { ...cur };
          this.afterSelect();
        }
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        if (this.checked.size && !cur) return this.deleteChecked();
        this.clearRange();
        return;
      case 'F10':
      case 'ContextMenu': {
        if (!cur || (key === 'F10' && !e.shiftKey)) return;
        e.preventDefault();
        this.scrollIntoView(cur.r, cur.c);
        const row = L.rows[L.recRow[cur.r]];
        const x = L.colX(cur.c, this.scroller.scrollLeft);
        const r = this.scroller.getBoundingClientRect();
        this.openRecordMenu(row.rec, { x: r.left + x + 20, y: r.top + HEADER_H + row.y - this.scroller.scrollTop + row.h });
        return;
      }
      default:
    }
    // A printed character: no modifiers, Option on a Mac, or AltGr (Ctrl+Alt)
    // elsewhere. Ctrl on a Mac and Meta elsewhere are shortcuts, not typing.
    const typed = key.length === 1 && !e.metaKey && (isMac ? !e.ctrlKey : e.ctrlKey === e.altKey);
    if (mod && !typed) {
      const k = key.toLowerCase();
      if (k === 'a') {
        e.preventDefault();
        if (L.records.length) {
          this.anchor = { r: 0, c: 0 };
          this.cursor = { r: lastR, c: lastC };
          this.afterSelect();
          announce('Selected all cells');
        }
      } else if (k === 'd') {
        e.preventDefault();
        const rg = this.range();
        if (rg && rg.r1 > rg.r0) {
          this.anchor = { r: rg.r0, c: rg.c0 };
          this.cursor = { r: rg.r0, c: rg.c1 };
          this.fillDown(rg.r1);
        }
      } else if (k === 'e' && e.shiftKey) {
        e.preventDefault();
        if (cur) this.page.openRecord(L.records[cur.r].id);
      }
      return;
    }
    if (typed && cur) {
      // Typing starts editing with that character.
      const field = L.cols[cur.c].field;
      if (isReadOnly(field)) return;
      if (field.type === 'checkbox' || field.type === 'rating' || field.type === 'attachment') return;
      e.preventDefault();
      this.startEdit(key);
    }
  }

  toggleRangeCheckbox() {
    const rg = this.range();
    const L = this.layout;
    const changes = [];
    const fields = L.cols.slice(rg.c0, rg.c1 + 1).map((c) => c.field).filter((f) => f.type === 'checkbox');
    if (!fields.length) return;
    const first = L.records[rg.r0].c[fields[0].id];
    for (let r = rg.r0; r <= rg.r1; r++) {
      const rec = L.records[r];
      const cells = {};
      for (const f of fields) cells[f.id] = !first;
      changes.push({ id: rec.id, cells });
    }
    this.base.setCells(this.table.id, changes, 'Toggle checkboxes');
  }

  /* --------------------------------------------------------------- editing */

  cellRect(r, c) {
    const L = this.layout;
    const row = L.rows[L.recRow[r]];
    const col = L.cols[c];
    if (!row || !col) return null;
    return { x: L.colX(c, this.scroller.scrollLeft), y: HEADER_H + row.y - this.scroller.scrollTop, w: col.w, h: row.h };
  }

  startEdit(initial) {
    if (!this.cursor) return;
    const L = this.layout;
    const { r, c } = this.cursor;
    const rec = L.records[r];
    const field = L.cols[c].field;
    if (isReadOnly(field)) {
      toast(`${field.name} is computed, so it can't be edited here.`);
      return;
    }
    this.anchor = { r, c };
    this.scrollIntoView(r, c);
    const rect = this.cellRect(r, c);
    if (!rect) return;
    this.closeEditor(false);
    const pos = this.overlayRect(rect);
    this.editor = openCellEditor({
      host: this.overlay,
      rect: pos,
      page: this.page,
      table: this.table,
      record: rec,
      field,
      initial,
      onCommit: (value, how) => {
        this.commitValue(rec, field, value);
        this.editor = null;
        this.refocus();
        if (how === 'down') this.setCursor(r + 1, c);
        else if (how === 'right') this.setCursor(r, c + 1);
        else if (how === 'left') this.setCursor(r, c - 1);
        else if (how === 'up') this.setCursor(r - 1, c);
        this.invalidate();
      },
      onCancel: () => {
        this.editor = null;
        this.refocus();
        this.invalidate();
      },
    }) || null;
    // Kept by record and field: an edit that re-sorts the view moves them.
    this.editorAt = { r, c, recId: rec.id, fieldId: field.id };
    this.invalidate();
  }

  /** Focus back on the grid after an edit, unless the edit ended by moving focus elsewhere. */
  refocus() {
    const a = document.activeElement;
    if (!a || a === document.body || this.el.contains(a)) this.focus();
  }

  overlayRect(rect) {
    return { x: rect.x, y: rect.y, w: rect.w, h: rect.h, maxX: this.W, maxY: this.H };
  }

  positionEditor() {
    if (!this.editor || !this.editorAt) return;
    const at = this.editorAt;
    const L = this.layout;
    if (L.records[at.r]?.id !== at.recId) at.r = L.records.findIndex((x) => x.id === at.recId);
    if (L.cols[at.c]?.field.id !== at.fieldId) at.c = L.cols.findIndex((x) => x.field.id === at.fieldId);
    // The record or field left the view: the editor goes with it.
    if (at.r < 0 || at.c < 0) {
      this.closeEditor(!!this.table.record(at.recId));
      this.invalidate();
      return;
    }
    const rect = this.cellRect(at.r, at.c);
    if (rect) this.editor.move?.(this.overlayRect(rect));
  }

  closeEditor(commit) {
    if (!this.editor) return;
    const ed = this.editor;
    this.editor = null;
    ed.close(commit);
  }

  commitValue(rec, field, value) {
    // Nothing to save into once the record (or its table) is gone.
    if (value === undefined || !this.base.table(this.table.id)?.record(rec.id)) return;
    if (value && typeof value === 'object' && 'newChoices' in value) {
      this.base.transact(() => {
        if (value.newChoices.length) this.base.updateField(this.table.id, field.id, { options: { ...field.options, choices: [...field.options.choices, ...value.newChoices] } });
        this.base.setCell(this.table.id, rec.id, field.id, value.value);
      }, 'Edit');
      return;
    }
    const before = rec.c[field.id];
    if (JSON.stringify(before ?? null) === JSON.stringify(value ?? null)) return;
    this.base.setCell(this.table.id, rec.id, field.id, value);
  }

  /* -------------------------------------------------------------- records */

  insertRecord(afterId, { before = false } = {}) {
    const cells = this.groupCellsFor(afterId);
    const [id] = this.base.createRecords(this.table.id, [cells], before ? { before: afterId } : { after: afterId });
    const r = this.layout.records.findIndex((x) => x.id === id);
    if (r >= 0) {
      this.setCursor(r, 0);
      announce('Record added');
    } else this.hiddenAdded(id);
    return id;
  }

  /** A record just added that the view's filters hide. */
  hiddenAdded(id) {
    toast('Record added. It is hidden by this view’s filters.', { action: { label: 'Open', onClick: () => this.page.openRecord(id) } });
  }

  /** New records in a group get that group's values. */
  groupCellsFor(recId) {
    const cells = {};
    if (!recId || !this.view.groups?.length) return cells;
    const rec = this.table.record(recId);
    for (const g of this.view.groups) {
      const f = this.table.field(g.fieldId);
      if (f && !isReadOnly(f) && rec?.c[f.id] !== undefined) cells[f.id] = structuredClone(rec.c[f.id]);
    }
    return cells;
  }

  addRecordIn(row) {
    const cells = {};
    for (const node of row.groups || []) {
      const f = this.table.field(node.fieldId);
      if (!f || isReadOnly(f) || node.value === null || node.value === undefined) continue;
      cells[f.id] = structuredClone(node.value);
    }
    // Records added under a filter keep matching it when it is simple.
    for (const c of this.view.filters?.conjunction === 'and' ? this.view.filters.conditions : []) {
      const f = this.table.field(c.fieldId);
      if (!f || isReadOnly(f) || cells[f.id] !== undefined) continue;
      if (c.op === 'is' && (f.type === 'singleSelect' || f.type === 'checkbox' || f.type === 'text')) cells[f.id] = c.value;
      if (c.op === 'hasAnyOf' && Array.isArray(c.value)) cells[f.id] = c.value.slice(0, 1);
    }
    const [id] = this.base.createRecords(this.table.id, [cells]);
    const r = this.layout.records.findIndex((x) => x.id === id);
    if (r >= 0) {
      this.setCursor(r, 0);
      this.focus();
    } else this.hiddenAdded(id);
  }

  openRecordMenu(rec, pt) {
    const ids = this.checked.size > 1 && this.checked.has(rec.id) ? this.layout.records.filter((r) => this.checked.has(r.id)).map((r) => r.id) : [rec.id];
    const many = ids.length > 1;
    const rg = this.range();
    const multiCell = rg && (rg.r1 > rg.r0 || rg.c1 > rg.c0);
    openMenu(pt, [
      !many ? { label: 'Insert record above', icon: 'insertAbove', onSelect: () => this.insertRecord(rec.id, { before: true }) } : null,
      !many ? { label: 'Insert record below', icon: 'insertBelow', hint: 'Shift+Enter', onSelect: () => this.insertRecord(rec.id) } : null,
      { label: many ? `Duplicate ${ids.length} records` : 'Duplicate record', icon: 'copy', onSelect: () => this.base.duplicateRecords(this.table.id, ids) },
      !many ? { label: 'Expand record', icon: 'expand', hint: 'Space', onSelect: () => this.page.openRecord(rec.id) } : null,
      !many ? { label: 'Copy record link', icon: 'link', onSelect: () => copyText(recordUrl(this.page, rec.id), 'Link copied') } : null,
      { type: 'sep' },
      multiCell ? { label: 'Clear selected cells', icon: 'x', onSelect: () => this.clearRange() } : null,
      { label: many ? `Delete ${ids.length} records` : 'Delete record', icon: 'trash', danger: true, onSelect: () => this.deleteRecords(ids) },
    ], { label: 'Record actions' });
  }

  async deleteRecords(ids) {
    if (ids.length > 1) {
      const ok = await confirmDialog({ title: `Delete ${ids.length} records?`, message: 'You can undo this right after.', confirmLabel: 'Delete', danger: true });
      if (!ok) return;
    }
    this.base.deleteRecords(this.table.id, ids);
    for (const id of ids) this.checked.delete(id);
    this.page.toastUndo(ids.length === 1 ? 'Record deleted' : `${ids.length} records deleted`);
    this.focus();
  }

  deleteChecked() {
    this.deleteRecords(this.layout.records.filter((r) => this.checked.has(r.id)).map((r) => r.id));
  }

  clearRange() {
    const rg = this.range();
    if (!rg) return;
    const L = this.layout;
    const changes = [];
    for (let r = rg.r0; r <= rg.r1; r++) {
      const rec = L.records[r];
      const cells = {};
      for (let c = rg.c0; c <= rg.c1; c++) {
        const f = L.cols[c].field;
        if (isReadOnly(f)) continue;
        if (rec.c[f.id] !== undefined) cells[f.id] = null;
      }
      if (Object.keys(cells).length) changes.push({ id: rec.id, cells });
    }
    if (changes.length) {
      this.base.setCells(this.table.id, changes, 'Clear cells');
      announce('Cleared');
    }
  }

  /** Copy the top row of the selection down to row toR (fill handle, Ctrl+D). */
  fillDown(toR) {
    const rg = this.range();
    if (!rg) return;
    const L = this.layout;
    const srcRows = [];
    for (let r = rg.r0; r <= rg.r1; r++) srcRows.push(L.records[r]);
    const end = Math.max(toR, rg.r1);
    const changes = [];
    // Rows below the selection are filled; releasing inside it fills nothing.
    for (let r = rg.r1 + 1; r <= end; r++) {
      const src = srcRows[(r - rg.r0) % srcRows.length];
      const rec = L.records[r];
      const cells = {};
      for (let c = rg.c0; c <= rg.c1; c++) {
        const f = L.cols[c].field;
        if (isReadOnly(f)) continue;
        cells[f.id] = src.c[f.id] === undefined ? null : structuredClone(src.c[f.id]);
      }
      changes.push({ id: rec.id, cells });
    }
    if (changes.length) this.base.setCells(this.table.id, changes, 'Fill cells');
    this.anchor = { r: rg.r0, c: rg.c0 };
    this.cursor = { r: end, c: rg.c1 };
    this.afterSelect();
  }

  /* ------------------------------------------------------------- clipboard */

  ownsClipboardEvent(e) {
    return document.activeElement === this.scroller && !this.editor && !e.defaultPrevented;
  }

  handleCopy(e, cut) {
    if (!this.ownsClipboardEvent(e)) return;
    const L = this.layout;
    let recs;
    let cols;
    if (this.checked.size) {
      recs = L.records.filter((r) => this.checked.has(r.id));
      cols = L.cols;
    } else {
      const rg = this.range();
      if (!rg) return;
      recs = L.records.slice(rg.r0, rg.r1 + 1);
      cols = L.cols.slice(rg.c0, rg.c1 + 1);
    }
    const ctx = this.base.compute.ctx;
    const values = recs.map((rec) => cols.map((col) => this.base.compute.value(this.table, rec, col.field)));
    const rows = values.map((row, i) => row.map((v, j) => {
      const f = cols[j].field;
      if (f.type === 'checkbox') return v ? 'checked' : '';
      if (f.type === 'attachment') return (v || []).map((a) => a.name).join(', ');
      return listText(f, v, ctx);
    }));
    void rows.length;
    const tsv = toTSV(rows);
    e.clipboardData.setData('text/plain', tsv);
    e.preventDefault();
    // Remember raw values so pasting inside the app keeps attachments, links and exact numbers.
    clipboard = { tsv, fields: cols.map((c) => c.field), values: values.map((r) => r.map((v) => structuredClone(v))) };
    announce(`Copied ${recs.length * cols.length} cell${recs.length * cols.length === 1 ? '' : 's'}`);
    if (cut) {
      if (this.checked.size) return;
      this.clearRange();
    }
  }

  handlePaste(e) {
    if (!this.ownsClipboardEvent(e)) return;
    const text = e.clipboardData?.getData('text/plain');
    // A clipboard holding something else (a screenshot) pastes nothing rather
    // than blanks. Copied empty text can come with no types at all.
    const types = e.clipboardData?.types;
    if (!text && types?.length && ![...types].includes('text/plain')) return;
    // An empty view has no cursor: rows paste in from the first cell.
    if (text === undefined || text === null || (!this.cursor && (this.layout.records.length || !this.layout.cols.length))) return;
    e.preventDefault();
    this.pasteText(text);
  }

  pasteText(text) {
    const L = this.layout;
    const internal = clipboard && clipboard.tsv === text ? clipboard : null;
    let rows = internal ? internal.values : parseTSV(text);
    if (!rows.length) return;
    const rg = this.range() || { r0: 0, r1: 0, c0: 0, c1: 0 };
    // One value pasted into a bigger selection fills it.
    const single = rows.length === 1 && rows[0].length === 1;
    const startR = rg.r0;
    const startC = rg.c0;
    const height = single ? rg.r1 - rg.r0 + 1 : rows.length;
    // Rows can differ in length: the widest one sets the width.
    const width = single ? rg.c1 - rg.c0 + 1 : rows.reduce((w, row) => Math.max(w, row.length), 0);
    const needed = startR + height - L.records.length;
    const choiceAdds = new Map();
    const base = this.base;
    const tableId = this.table.id;
    base.transact(() => {
      let recIds = L.records.map((r) => r.id);
      if (needed > 0) {
        const extra = base.createRecords(tableId, Array.from({ length: needed }, () => ({})));
        recIds = recIds.concat(extra);
      }
      const changes = [];
      for (let i = 0; i < height; i++) {
        const recId = recIds[startR + i];
        const cells = {};
        for (let j = 0; j < width; j++) {
          const col = L.cols[startC + j];
          if (!col) break;
          const field = col.field;
          // Past the end of a shorter row, cells are left as they are.
          if (isReadOnly(field) || (!single && j >= rows[i].length)) continue;
          const src = single ? rows[0][0] : rows[i][j];
          const srcField = internal ? internal.fields[single ? 0 : j] : null;
          let value;
          if (internal && srcField && srcField.type === field.type && srcField.id === field.id) value = structuredClone(src);
          // Dates paste by value: the text a European or GMT field shows reads differently here.
          else if (internal && srcField && field.type === 'date' && valueKind(srcField, base.compute.ctx) === 'date') value = convertValue(srcField, field, src, base.compute.ctx);
          else {
            // Names with commas are quoted only for list fields, which read quotes.
            const list = field.type === 'multipleSelect' || field.type === 'link';
            const txt = internal && srcField ? (srcField.type === 'checkbox' ? (src ? 'checked' : '') : (list ? listText : toText)(srcField, src, base.compute.ctx)) : src;
            value = this.parseFor(field, txt, choiceAdds);
          }
          // Values that cannot be pasted (attachments from text) leave the cell alone.
          if (value !== undefined) cells[field.id] = value;
        }
        if (Object.keys(cells).length) changes.push({ id: recId, cells });
      }
      for (const [fid, choices] of choiceAdds) {
        const f = this.table.field(fid);
        base.updateField(tableId, fid, { options: { ...f.options, choices: [...f.options.choices, ...choices] } });
      }
      if (changes.length) base.setCells(tableId, changes, 'Paste');
    }, 'Paste');
    this.anchor = { r: startR, c: startC };
    this.cursor = { r: Math.min(startR + height - 1, this.layout.records.length - 1), c: Math.min(startC + width - 1, L.cols.length - 1) };
    this.afterSelect();
    announce(needed > 0 ? `Pasted and added ${needed} record${needed === 1 ? '' : 's'}` : 'Pasted');
  }

  parseFor(field, text, choiceAdds) {
    if (field.type === 'attachment') return undefined;
    const pending = choiceAdds.get(field.id) || [];
    const res = parseText(field, text, {
      makeChoice: (name) => {
        const existing = pending.find((c) => c.name.toLowerCase() === String(name).toLowerCase());
        if (existing) return existing;
        const c = makeChoice(name, [...(field.options.choices || []), ...pending]);
        pending.push(c);
        choiceAdds.set(field.id, pending);
        return c;
      },
      findRecords: (tid, names) => this.base.compute.findRecords(tid, names),
    });
    if (res && typeof res === 'object' && 'newChoices' in res) return res.value;
    return res;
  }

  /* ---------------------------------------------------------------- fields */

  openFieldMenu(c, pt) {
    const col = this.layout.cols[c];
    if (!col) return;
    const anchor = pt || this.headerAnchor(c);
    openMenu(anchor, fieldMenuItems(this.page, this.table, col.field, {
      onEdit: () => this.editField(c),
      onInsert: (side) => this.addField(side === 'left' ? c : c + 1),
      onFreeze: c < this.layout.cols.length - 1 && !this.compact ? () => this.base.updateView(this.table.id, this.view.id, { frozen: c + 1 }, { label: 'Freeze fields' }) : null,
      frozen: this.layout.frozen,
      index: c,
      view: this.view,
    }), { label: `${col.field.name} options` });
  }

  headerAnchor(c) {
    const r = this.scroller.getBoundingClientRect();
    const x = this.layout.colX(c, this.scroller.scrollLeft);
    return { x: r.left + Math.max(0, x), y: r.top + HEADER_H };
  }

  editField(c) {
    const col = this.layout.cols[c];
    openFieldEditor(this.headerAnchor(c), this.page, this.table, { field: col.field });
  }

  /** Add a field at a column position (end by default). */
  addField(at) {
    const L = this.layout;
    const sx = this.scroller.scrollLeft;
    const r = this.scroller.getBoundingClientRect();
    let anchor;
    if (at === undefined) {
      const last = L.cols[L.cols.length - 1];
      const x = last ? L.colX(L.cols.length - 1, sx) + last.w : L.gutter;
      anchor = { x: r.left + Math.min(x, this.W - 300), y: r.top + HEADER_H };
    } else anchor = this.headerAnchor(Math.min(at, L.cols.length - 1));
    openFieldEditor(anchor, this.page, this.table, {
      onCreated: (fieldId) => {
        // Place it in the view where it was asked for.
        if (at !== undefined) {
          const shown = L.cols.map((x) => x.field.id).filter((id) => id !== fieldId);
          this.base.updateView(this.table.id, this.view.id, { order: this.orderWith(fieldId, shown[at]) }, { undoable: false });
        }
        const c = this.layout.cols.findIndex((x) => x.field.id === fieldId);
        if (c >= 0 && this.cursor) this.setCursor(this.cursor.r, c);
        else if (c >= 0) this.scrollIntoView(0, c);
      },
    });
  }

  /**
   * The view's field order with one field placed before another shown one
   * (or after the last shown one). Hidden fields keep their places.
   */
  orderWith(fieldId, beforeId) {
    const ids = orderedFields(this.table, this.view).map((f) => f.id).filter((id) => id !== fieldId);
    const shown = this.layout.cols.map((c) => c.field.id).filter((id) => id !== fieldId);
    const at = beforeId ? ids.indexOf(beforeId) : ids.indexOf(shown[shown.length - 1]) + 1;
    ids.splice(at < 0 ? ids.length : at, 0, fieldId);
    return ids;
  }

  autoFit(c) {
    const L = this.layout;
    const col = L.cols[c];
    const P = this.P;
    P.font(13, 500);
    let w = P.measure(col.field.name) + 60;
    P.font();
    const ctx = this.base.compute.ctx;
    for (const rec of L.records.slice(0, 500)) {
      const t = toText(col.field, this.base.compute.value(this.table, rec, col.field), ctx);
      w = Math.max(w, Math.min(600, P.measure(t.split('\n')[0]) + 24));
    }
    this.base.updateView(this.table.id, this.view.id, { widths: { ...(this.view.widths || {}), [col.field.id]: Math.round(w) } }, { label: 'Resize field' });
  }

  /* ---------------------------------------------------------------- groups */

  toggleGroup(path) {
    const set = new Set(this.view.collapsed || []);
    if (set.has(path)) set.delete(path);
    else set.add(path);
    this.base.updateView(this.table.id, this.view.id, { collapsed: [...set] }, { undoable: false });
  }

  setAllGroups(collapse) {
    const paths = [];
    const walk = (nodes) => {
      for (const n of nodes || []) {
        paths.push(n.path);
        walk(n.children);
      }
    };
    walk(this.result.tree);
    this.base.updateView(this.table.id, this.view.id, { collapsed: collapse ? paths : [] }, { undoable: false });
  }

  /* ---------------------------------------------------------------- search */

  runSearch(keep) {
    const s = this.search;
    const hits = searchView(this.base, this.table, this.view, this.layout.records, s.query);
    const prev = keep ? s.hits[s.index] : null;
    s.hits = hits;
    s.set = new Set(hits.map((x) => `${x.recordId}|${x.fieldId}`));
    s.index = prev ? Math.max(0, hits.findIndex((x) => x.recordId === prev.recordId && x.fieldId === prev.fieldId)) : 0;
  }

  setSearch(query, { keep = false } = {}) {
    if (!query) {
      this.search = null;
      this.invalidate();
      return { total: 0, index: 0 };
    }
    this.search = { query, hits: [], set: new Set(), index: 0 };
    this.runSearch(keep);
    this.goToHit();
    return { total: this.search.hits.length, index: this.search.index };
  }

  stepSearch(d) {
    const s = this.search;
    if (!s || !s.hits.length) return { total: 0, index: 0 };
    s.index = (s.index + d + s.hits.length) % s.hits.length;
    this.goToHit();
    return { total: s.hits.length, index: s.index };
  }

  goToHit() {
    const s = this.search;
    const hit = s?.hits[s.index];
    if (hit) {
      const r = this.layout.records.findIndex((x) => x.id === hit.recordId);
      const c = this.layout.cols.findIndex((x) => x.field.id === hit.fieldId);
      if (r >= 0 && c >= 0) {
        this.cursor = { r, c };
        this.anchor = { r, c };
        this.scrollIntoView(r, c);
        this.updateProxy();
      }
    }
    this.invalidate();
  }
}

let clipboard = null;

