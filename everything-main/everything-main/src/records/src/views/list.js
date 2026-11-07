/**
 * List: a compact, readable list of records (grouped when the view has
 * groups), for scanning on any screen size. Rows render in batches.
 */
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { accentColor } from '../lib/colors.js';
import { runView, searchView } from '../data/query.js';
import { visibleFields } from '../data/views.js';
import { isEmpty, toText } from '../data/fields.js';
import { valueNode, cardColorFn } from './cards.js';

const BATCH = 150;

export class ListView {
  constructor(page, table, view) {
    this.page = page;
    this.base = page.base;
    this.table = table;
    this.view = view;
    this.limit = BATCH;
    this.list = h('div.list-view-body');
    this.el = h('div.list-view', this.list);
    this.list.addEventListener('click', (e) => {
      const row = e.target.closest('.list-row');
      if (row) this.page.openRecord(row.dataset.id);
      const more = e.target.closest('.list-more');
      if (more) {
        const next = this.shown[this.drawn]?.id;
        this.limit += BATCH * 3;
        this.render();
        // The button is gone: go on from the first row it showed.
        ((next && this.list.querySelector(`.list-row[data-id="${CSS.escape(next)}"]`)) || this.list.querySelector('.list-more, .list-add'))?.focus();
      }
      const grp = e.target.closest('.list-group-head');
      if (grp) this.toggle(grp.dataset.path);
    });
    this.list.addEventListener('keydown', (e) => {
      const row = e.target.closest?.('.list-row');
      if (!row) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.page.openRecord(row.dataset.id);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const rows = [...this.list.querySelectorAll('.list-row')];
        rows[rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
      }
    });
  }

  mounted() {
    this.render();
  }
  destroy() {}
  update() {
    this.render();
  }
  focus() {
    this.list.querySelector('.list-row')?.focus();
  }
  recordOrder() {
    return (this.records || []).map((r) => r.id);
  }

  toggle(path) {
    const set = new Set(this.view.collapsed || []);
    if (set.has(path)) set.delete(path);
    else set.add(path);
    this.base.updateView(this.table.id, this.view.id, { collapsed: [...set] }, { undoable: false });
  }

  render() {
    const result = runView(this.base, this.table, this.view);
    this.records = result.records;
    const fields = visibleFields(this.table, this.view).slice(1);
    const colorOf = cardColorFn(this.page, this.table, this.view);
    const collapsed = new Set(this.view.collapsed || []);
    // Records in open groups, in order: the rows that show as the limit grows.
    const open = (nodes) => nodes.flatMap((n) => (collapsed.has(n.path) ? [] : n.children ? open(n.children) : n.records));
    this.shown = result.tree ? open(result.tree) : result.records;
    // Matching rows in order, drawn or not.
    this.hits = this.query ? [...new Set(searchView(this.base, this.table, this.view, this.shown, this.query).map((x) => x.recordId))] : [];
    const hits = new Set(this.hits);
    let count = 0;
    const row = (rec) => {
      count++;
      const color = colorOf(rec);
      const meta = h('div.list-meta');
      for (const f of fields.slice(0, 6)) {
        const v = this.base.compute.value(this.table, rec, f);
        if (isEmpty(v)) continue;
        meta.append(h('span.list-meta-item', { title: `${f.name}: ${toText(f, v, this.base.compute.ctx)}` }, h('span.muted', `${f.name} `), valueNode(this.page, this.table, f, v)));
      }
      return h('div.list-row', { role: 'listitem', tabindex: '0', dataset: { id: rec.id }, class: `list-row${hits.has(rec.id) ? ' search-hit' : ''}`, style: color ? { '--row-accent': accentColor(color) } : null },
        h('div.list-title', this.base.recordName(this.table.id, rec.id)), meta, icon('chevronRight', 16));
    };
    const out = [];
    // Whether drawing stopped at the limit with more to show.
    let more = false;
    if (result.tree) {
      const walk = (nodes, depth) => {
        for (const n of nodes) {
          if (count >= this.limit) {
            more = true;
            return;
          }
          const field = this.table.field(n.fieldId);
          const label = n.value === null || n.value === undefined ? 'Empty' : toText(field, n.value, this.base.compute.ctx) || 'Empty';
          const open = !collapsed.has(n.path);
          out.push(h('button.list-group-head', { type: 'button', 'aria-expanded': String(open), dataset: { path: n.path }, style: { paddingLeft: `${12 + depth * 16}px` } }, icon(open ? 'chevronDown' : 'chevronRight', 14), h('span.muted', field?.name || ''), h('strong', label), h('span.list-count', String(n.records.length))));
          if (!open) continue;
          if (n.children) walk(n.children, depth + 1);
          else {
            if (n.records.length > this.limit - count) more = true;
            out.push(h('div.list-group', { role: 'list' }, n.records.slice(0, Math.max(0, this.limit - count)).map(row)));
          }
        }
      };
      walk(result.tree, 0);
    } else {
      out.push(h('div.list-group', { role: 'list', 'aria-label': this.view.name }, result.records.slice(0, this.limit).map(row)));
      more = result.records.length > this.limit;
    }
    this.drawn = count;
    // Only collapsed group headers may be left to show.
    const left = this.shown.length - count;
    if (more) out.push(h('button.btn.ghost.list-more', { type: 'button' }, left > 0 ? `Show more (${left} left)` : 'Show more'));
    out.push(h('button.btn.ghost.list-add', { type: 'button', onclick: (e) => {
      e.stopPropagation();
      this.page.addRecord({});
    } }, icon('plus', 16), 'Add record'));
    this.list.replaceChildren(...out);
  }

  setSearch(query, { keep = false } = {}) {
    query ||= '';
    // The match that was current, by record: an edit has already redrawn the view.
    const prev = keep ? this.hitId : null;
    // Find draws more rows only to reach a match; closing it puts back what was drawn before.
    if (query && !this.query) this.limitBefore = this.limit;
    if (!query && this.query) this.limit = Math.max(BATCH, this.limitBefore || 0);
    // After an edit the view has already drawn this search.
    const drawn = keep && query === this.query;
    this.query = query;
    if (!drawn) this.render();
    const i = prev ? this.hits.indexOf(prev) : -1;
    this.hitIndex = i >= 0 ? i : Math.min(keep ? this.hitIndex || 0 : 0, Math.max(0, this.hits.length - 1));
    if (!keep) this.showHit(false);
    this.hitId = this.hits[this.hitIndex];
    return { total: this.hits.length, index: this.hitIndex };
  }

  stepSearch(d) {
    const n = this.hits?.length || 0;
    if (!n) return { total: 0, index: 0 };
    this.hitIndex = (this.hitIndex + d + n) % n;
    this.showHit(true);
    this.hitId = this.hits[this.hitIndex];
    return { total: n, index: this.hitIndex };
  }

  /** Draw rows up to the current match, and scroll to it. */
  showHit(focus) {
    const id = this.hits?.[this.hitIndex];
    if (!id) return;
    const i = this.shown.findIndex((r) => r.id === id);
    if (i >= this.limit) {
      this.limit = Math.ceil((i + 1) / BATCH) * BATCH;
      this.render();
    }
    const row = this.list.querySelector(`.list-row[data-id="${CSS.escape(id)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
    if (focus) row?.focus({ preventScroll: true });
  }
}
