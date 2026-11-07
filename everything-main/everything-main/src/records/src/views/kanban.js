/**
 * Kanban: records as cards in stacks by a single select, checkbox or
 * single-link field. Drag cards between stacks (or use "Move to" from the
 * card menu), add cards and stacks.
 */
import { h, announce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { chipColors, nextColor } from '../lib/colors.js';
import { runView, searchView } from '../data/query.js';
import { makeChoice } from '../data/base.js';
import { canStack } from '../data/views.js';
import { recordCard, cardColorFn } from './cards.js';
import { enableCardDrag } from './drag.js';
import { openMenu, openContextMenu } from '../ui/menu.js';
import { promptDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';

const PAGE = 60;
const LINK_STACKS = 50;

export class KanbanView {
  constructor(page, table, view) {
    this.page = page;
    this.base = page.base;
    this.table = table;
    this.view = view;
    this.limits = new Map();
    this.query = '';
    this.board = h('div.kanban', { 'aria-label': `${view.name} stacks` });
    this.el = h('div.board-wrap', this.board);
    enableCardDrag(this.board, {
      onDrop: (d) => this.drop(d),
      onClick: (id) => this.page.openRecord(id),
      scrollers: () => [this.board, ...this.board.querySelectorAll('.stack-cards')],
    });
    this.board.addEventListener('keydown', (e) => {
      const card = e.target.closest?.('.card');
      if (!card) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.page.openRecord(card.dataset.id);
      } else if (e.altKey && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        this.moveCard(card.dataset.id, e.key);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const sib = e.key === 'ArrowDown' ? card.nextElementSibling : card.previousElementSibling;
        if (sib?.classList.contains('card')) sib.focus();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        // The next stack that has cards (empty stacks are passed over).
        let other = card.closest('.stack');
        do other = e.key === 'ArrowRight' ? other.nextElementSibling : other.previousElementSibling;
        while (other && !other.querySelector('.card'));
        other?.querySelector('.card')?.focus();
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const r = card.getBoundingClientRect();
        this.cardMenu(card.dataset.id, { x: r.left + 16, y: r.top + 24 });
      }
    });
    this.board.addEventListener('contextmenu', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      e.preventDefault();
      this.cardMenu(card.dataset.id, { x: e.clientX, y: e.clientY });
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
    this.board.querySelector('.card')?.focus();
  }

  recordOrder() {
    return this.ordered || [];
  }

  /** The field records stack by, or null when it is missing or can no longer stack. */
  stackField() {
    const f = this.table.field(this.view.stackFieldId);
    // A link that allows several records can't be one stack: a drop would drop the other links.
    return canStack(f) ? f : null;
  }

  /** Stacks: [{ key, label, value, color, records }] in display order. */
  stacks(records) {
    const f = this.stackField();
    if (!f) return [];
    const out = [];
    const byKey = new Map();
    const add = (key, label, value, color) => {
      const s = { key, label, value, color, records: [] };
      out.push(s);
      byKey.set(key, s);
      return s;
    };
    if (f.type === 'singleSelect') {
      add('', 'Uncategorized', null, null);
      for (const c of f.options.choices) add(c.id, c.name, c.id, c.color);
      for (const r of records) (byKey.get(r.c[f.id] || '') || byKey.get('')).records.push(r);
    } else if (f.type === 'checkbox') {
      add('0', 'Unchecked', false, 'gray');
      add('1', 'Checked', true, 'green');
      for (const r of records) byKey.get(r.c[f.id] ? '1' : '0').records.push(r);
    } else if (f.type === 'link') {
      add('', 'Not linked', null, null);
      const target = this.base.table(f.options.tableId);
      const all = target?.ordered() || [];
      // Every linked record gets a stack in a small table; in a big one only
      // those with cards (thousands of empty stacks would bury the board).
      const used = all.length > LINK_STACKS ? new Set(records.map((r) => r.c[f.id]?.[0]).filter(Boolean)) : null;
      for (const tr of all) if (!used || used.has(tr.id)) add(tr.id, this.base.recordName(target.id, tr.id), [tr.id], null);
      for (const r of records) (byKey.get(r.c[f.id]?.[0] || '') || byKey.get('')).records.push(r);
    }
    return out;
  }

  render() {
    const scroll = { left: this.board.scrollLeft, stacks: new Map([...this.board.querySelectorAll('.stack')].map((s) => [s.dataset.drop, s.querySelector('.stack-cards')?.scrollTop || 0])) };
    const focusedId = document.activeElement?.closest?.('.card')?.dataset.id;
    const f = this.stackField();
    if (!f) {
      this.hits = [];
      this.shownStacks = [];
      const unusable = this.table.field(this.view.stackFieldId);
      this.board.replaceChildren(h('div.empty', h('div.empty-icon', icon('vKanban', 22)), h('h2', 'Choose how to stack records'), h('p', `${unusable ? `${unusable.name} can't stack records. ` : ''}Kanban stacks need a single select, checkbox or single-link field.`),
        this.table.fields.some((x) => x.type === 'singleSelect')
          ? h('button.btn.primary', { type: 'button', onclick: () => this.base.updateView(this.table.id, this.view.id, { stackFieldId: this.table.fields.find((x) => x.type === 'singleSelect').id }) }, 'Stack by the first select field')
          : h('button.btn.primary', { type: 'button', onclick: () => this.createStatusField() }, icon('plus', 16), 'Add a Status field')));
      return;
    }
    const result = runView(this.base, this.table, this.view);
    const colorOf = cardColorFn(this.page, this.table, this.view);
    const hits = this.query ? new Set(searchView(this.base, this.table, this.view, result.records, this.query).map((x) => x.recordId)) : null;
    const stacks = this.stacks(result.records).filter((s) => !(this.view.hideEmptyStacks && !s.records.length && s.key !== ''));
    this.shownStacks = stacks.filter((s) => s.key !== '' || s.records.length || f.type !== 'singleSelect');
    this.ordered = stacks.flatMap((s) => s.records.map((r) => r.id));
    // Matching cards in board order, drawn or not.
    this.hits = hits ? this.ordered.filter((id) => hits.has(id)) : [];
    const canAdd = f.type !== 'link' || true;
    this.board.replaceChildren(...[
      ...this.shownStacks.map((s) => {
        const [bg, fg] = chipColors(s.color || 'gray');
        const limit = this.limits.get(s.key) || PAGE;
        const cards = h('div.stack-cards', { role: 'list', dataset: { cards: this.view.sorts?.length ? 'unordered' : '' }, 'aria-label': `${s.label}, ${s.records.length} records` });
        for (const r of s.records.slice(0, limit)) {
          const card = recordCard(this.page, this.table, this.view, r, { cover: this.view.coverFieldId, color: colorOf(r), compact: true, max: 8, skip: f.id });
          card.setAttribute('role', 'listitem');
          card.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight');
          if (hits?.has(r.id)) card.classList.add('search-hit');
          cards.append(card);
        }
        if (s.records.length > limit) {
          cards.append(h('button.btn.ghost.small.show-more', { type: 'button', onclick: () => {
            this.limits.set(s.key, limit + PAGE * 2);
            this.render();
            // The button is gone: go on from the first card it showed.
            this.board.querySelector(`.card[data-id="${CSS.escape(s.records[limit].id)}"]`)?.focus();
          } }, `Show ${Math.min(PAGE * 2, s.records.length - limit)} more`));
        }
        const header = h('div.stack-head',
          h('h2.stack-title', s.color ? h('span.chip', { style: { background: bg, color: fg } }, h('span.chip-label', s.label)) : h('span.stack-label', s.label)),
          h('span.stack-count', String(s.records.length)),
          h('div.grow'),
          canAdd ? h('button.icon-btn', { type: 'button', 'aria-label': `Add a record to ${s.label}`, 'data-tip': 'Add record', onclick: () => this.addTo(s) }, icon('plus', 16)) : null,
          f.type === 'singleSelect' && s.key ? h('button.icon-btn', { type: 'button', 'aria-label': `${s.label} options`, 'aria-haspopup': 'menu', onclick: (e) => this.stackMenu(e.currentTarget, s) }, icon('more', 16)) : null);
        return h('section.stack', { dataset: { drop: s.key }, 'aria-label': s.label }, header, cards, h('button.stack-add', { type: 'button', onclick: () => this.addTo(s) }, icon('plus', 14), 'Add record'));
      }),
      f.type === 'singleSelect' ? h('div.stack.stack-new', h('button.btn.ghost', { type: 'button', onclick: () => this.addStack() }, icon('plus', 16), 'Add stack')) : null,
    ].filter(Boolean));
    this.board.scrollLeft = scroll.left;
    for (const s of this.board.querySelectorAll('.stack')) {
      const top = scroll.stacks.get(s.dataset.drop);
      if (top) s.querySelector('.stack-cards').scrollTop = top;
    }
    if (focusedId) this.board.querySelector(`.card[data-id="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
  }

  valueFor(key) {
    const f = this.stackField();
    if (f.type === 'checkbox') return key === '1';
    if (f.type === 'link') return key ? [key] : null;
    return key || null;
  }

  drop({ id, zone, beforeId }) {
    const f = this.stackField();
    const rec = this.table.record(id);
    if (!rec || !f) return;
    const value = this.valueFor(zone);
    const cur = f.type === 'link' ? rec.c[f.id]?.[0] || '' : f.type === 'checkbox' ? (rec.c[f.id] ? '1' : '0') : rec.c[f.id] || '';
    const stack = this.shownStacks?.find((s) => s.key === zone);
    // A stack shows only its first cards: dropped after the last one shown,
    // a card goes there, not past the ones not shown yet.
    if (beforeId == null && stack) beforeId = stack.records.slice(this.limits.get(zone) || PAGE).find((r) => r.id !== id)?.id ?? null;
    // Dropped where it was: nothing to save or undo.
    if (cur === zone) {
      const recs = stack?.records || [];
      const i = recs.findIndex((r) => r.id === id);
      if (this.view.sorts?.length || (i >= 0 && (recs[i + 1]?.id ?? null) === (beforeId ?? null))) return;
    }
    this.base.transact(() => {
      if (cur !== zone) this.base.setCell(this.table.id, id, f.id, value);
      if (!this.view.sorts?.length) this.base.moveRecords(this.table.id, [id], beforeId);
    }, 'Move card');
    announce(`Moved ${this.base.recordName(this.table.id, id)}${stack && cur !== zone ? ` to ${stack.label}` : ''}`);
  }

  /** Alt+Arrow keys: move a card up or down its stack, or to the next stack, as dragging it would. */
  moveCard(id, key) {
    const i = this.shownStacks.findIndex((s) => s.records.some((r) => r.id === id));
    const s = this.shownStacks[i];
    if (!s) return;
    const at = s.records.findIndex((r) => r.id === id);
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      // A sorted view keeps its own order.
      if (this.view.sorts?.length) {
        announce('Cards are sorted in this view');
        return;
      }
      if (key === 'ArrowUp' ? at === 0 : at === s.records.length - 1) return;
      this.drop({ id, zone: s.key, beforeId: key === 'ArrowUp' ? s.records[at - 1].id : s.records[at + 2]?.id ?? null });
    } else {
      const to = this.shownStacks[i + (key === 'ArrowRight' ? 1 : -1)];
      if (!to) return;
      this.drop({ id, zone: to.key, beforeId: null });
    }
    this.reveal(id, true);
  }

  addTo(s) {
    const f = this.stackField();
    const cells = s.key || f.type === 'checkbox' ? { [f.id]: this.valueFor(s.key) } : {};
    this.page.addRecord(cells);
  }

  cardMenu(id, pt) {
    const f = this.stackField();
    const stacks = this.stacks(runView(this.base, this.table, this.view).records);
    openMenu(pt, [
      { label: 'Expand record', icon: 'expand', onSelect: () => this.page.openRecord(id) },
      f ? { label: 'Move to', icon: 'move', submenu: stacks.map((s) => ({ label: s.label, onSelect: () => this.drop({ id, zone: s.key, beforeId: null }) })) } : null,
      { label: 'Duplicate record', icon: 'copy', onSelect: () => this.base.duplicateRecords(this.table.id, [id]) },
      { type: 'sep' },
      { label: 'Delete record', icon: 'trash', danger: true, onSelect: () => {
        this.base.deleteRecords(this.table.id, [id]);
        this.page.toastUndo('Record deleted');
      } },
    ], { label: 'Card actions' });
  }

  stackMenu(anchor, s) {
    const f = this.stackField();
    openMenu(anchor, [
      { label: 'Rename stack', icon: 'pencil', onSelect: async () => {
        const name = await promptDialog({ title: 'Rename stack', label: 'Name', value: s.label, validate: (v) => (!v ? 'Enter a name.' : f.options.choices.some((c) => c.id !== s.key && c.name.toLowerCase() === v.toLowerCase()) ? 'Another option has this name.' : null) });
        if (name) this.base.updateField(this.table.id, f.id, { options: { ...f.options, choices: f.options.choices.map((c) => (c.id === s.key ? { ...c, name } : c)) } });
      } },
      { label: 'Delete stack', icon: 'trash', danger: true, onSelect: () => {
        this.base.updateField(this.table.id, f.id, { options: { ...f.options, choices: f.options.choices.filter((c) => c.id !== s.key) } });
        this.page.toastUndo(`Deleted ${s.label}. Its records moved to Uncategorized.`);
      } },
    ]);
  }

  async addStack() {
    const f = this.stackField();
    const name = await promptDialog({ title: 'Add stack', label: 'Name', validate: (v) => (!v ? 'Enter a name.' : f.options.choices.some((c) => c.name.toLowerCase() === v.toLowerCase()) ? 'A stack with this name exists.' : null) });
    if (!name) return;
    const c = makeChoice(name, f.options.choices);
    c.color = nextColor(f.options.choices.map((x) => x.color));
    this.base.updateField(this.table.id, f.id, { options: { ...f.options, choices: [...f.options.choices, c] } });
  }

  createStatusField() {
    const choices = [];
    for (const [n, color] of [['Todo', 'red'], ['In progress', 'yellow'], ['Done', 'green']]) {
      const c = makeChoice(n, choices);
      c.color = color;
      choices.push(c);
    }
    this.base.transact(() => {
      const id = this.base.addField(this.table.id, { name: 'Status', type: 'singleSelect', options: { choices } });
      this.base.updateView(this.table.id, this.view.id, { stackFieldId: id });
    }, 'Add Status field');
  }

  setSearch(query, { keep = false } = {}) {
    query ||= '';
    // The match that was current, by record: an edit has already redrawn the view.
    const prev = keep ? this.hitId : null;
    // After an edit the view has already drawn this search.
    const drawn = keep && query === this.query;
    this.query = query;
    if (!drawn) this.render();
    const hits = this.hits || [];
    const i = prev ? hits.indexOf(prev) : -1;
    this.hitIndex = i >= 0 ? i : Math.min(keep ? this.hitIndex || 0 : 0, Math.max(0, hits.length - 1));
    if (!keep) this.showHit(false);
    this.hitId = this.hits[this.hitIndex];
    return { total: hits.length, index: this.hitIndex };
  }

  stepSearch(d) {
    const n = this.hits?.length || 0;
    if (!n) return { total: 0, index: 0 };
    this.hitIndex = (this.hitIndex + d + n) % n;
    this.showHit(true);
    this.hitId = this.hits[this.hitIndex];
    return { total: n, index: this.hitIndex };
  }

  showHit(focus) {
    const id = this.hits?.[this.hitIndex];
    if (id) this.reveal(id, focus);
  }

  /** Draw a card's stack down to it, and scroll to it. */
  reveal(id, focus) {
    for (const s of this.shownStacks) {
      const i = s.records.findIndex((r) => r.id === id);
      if (i < 0) continue;
      if (i >= (this.limits.get(s.key) || PAGE)) {
        this.limits.set(s.key, Math.ceil((i + 1) / PAGE) * PAGE);
        this.render();
      }
      break;
    }
    const card = this.board.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (focus) card?.focus({ preventScroll: true });
  }
}

export { openContextMenu };
