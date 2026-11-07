/**
 * Gallery: records as cards in a responsive grid, with cover images.
 * Cards render in batches as you scroll, so large tables stay quick.
 */
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { runView, searchView } from '../data/query.js';
import { recordCard, cardColorFn } from './cards.js';
import { openMenu } from '../ui/menu.js';
import { toast } from '../ui/toast.js';

const BATCH = 60;

export class GalleryView {
  constructor(page, table, view) {
    this.page = page;
    this.base = page.base;
    this.table = table;
    this.view = view;
    this.limit = BATCH;
    this.grid = h('div.gallery', { role: 'list', 'aria-label': view.name });
    this.sentinel = h('div.gallery-sentinel', { 'aria-hidden': 'true' });
    this.el = h('div.gallery-wrap', this.grid, this.sentinel);
    this.io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && this.records && this.limit < this.records.length) {
        this.limit += BATCH * 2;
        this.render();
      }
    }, { root: this.el, rootMargin: '600px' });
    this.io.observe(this.sentinel);
    // Covers load when near the screen: loading every rendered card's cover
    // on each change would refetch them all once there are many.
    this.covers = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        this.covers.unobserve(e.target);
        e.target._load?.();
      }
    }, { root: this.el, rootMargin: '600px' });
    // Record cards have an id; the "Add record" tile is a plain button.
    this.grid.addEventListener('click', (e) => {
      const card = e.target.closest('.card[data-id]');
      if (card) this.page.openRecord(card.dataset.id);
    });
    this.grid.addEventListener('keydown', (e) => {
      const card = e.target.closest?.('.card');
      if (!card) return;
      if ((e.key === 'Enter' || e.key === ' ') && card.dataset.id) {
        e.preventDefault();
        this.page.openRecord(card.dataset.id);
      } else if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        const cards = [...this.grid.querySelectorAll('.card')];
        const i = cards.indexOf(card);
        // Columns: the cards on the first row (gaps and padding make a width ratio wrong).
        const next = cards.findIndex((c) => c.offsetTop !== cards[0].offsetTop);
        const cols = next < 0 ? cards.length : Math.max(1, next);
        const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
        cards[Math.max(0, Math.min(cards.length - 1, i + d))]?.focus();
      }
    });
    this.grid.addEventListener('contextmenu', (e) => {
      const card = e.target.closest('.card[data-id]');
      if (!card) return;
      e.preventDefault();
      const id = card.dataset.id;
      openMenu({ x: e.clientX, y: e.clientY }, [
        { label: 'Expand record', icon: 'expand', onSelect: () => this.page.openRecord(id) },
        { label: 'Duplicate record', icon: 'copy', onSelect: () => this.base.duplicateRecords(this.table.id, [id]) },
        { type: 'sep' },
        { label: 'Delete record', icon: 'trash', danger: true, onSelect: () => {
          this.base.deleteRecords(this.table.id, [id]);
          this.page.toastUndo('Record deleted');
        } },
      ]);
    });
  }

  mounted() {
    this.render();
  }
  destroy() {
    this.io.disconnect();
    this.covers.disconnect();
  }
  update() {
    this.render();
  }
  focus() {
    this.grid.querySelector('.card')?.focus();
  }
  recordOrder() {
    return (this.records || []).map((r) => r.id);
  }

  render() {
    const result = runView(this.base, this.table, this.view);
    this.records = result.records;
    const colorOf = cardColorFn(this.page, this.table, this.view);
    // Matching records in order, drawn or not.
    this.hits = this.query ? [...new Set(searchView(this.base, this.table, this.view, result.records, this.query).map((x) => x.recordId))] : [];
    const hits = new Set(this.hits);
    this.covers.disconnect();
    const cards = result.records.slice(0, this.limit).map((r) => {
      const c = recordCard(this.page, this.table, this.view, r, { cover: this.view.coverFieldId, fit: this.view.coverFit, color: colorOf(r), lazy: this.covers });
      c.setAttribute('role', 'listitem');
      if (hits.has(r.id)) c.classList.add('search-hit');
      return c;
    });
    const add = h('button.card.card-add', { type: 'button', onclick: () => this.page.addRecord({}) }, icon('plus', 20), h('span', 'Add record'));
    this.grid.replaceChildren(...cards, add);
    if (!result.records.length && result.total) this.grid.prepend(h('p.gallery-note.muted', 'No records match this view’s filters.'));
  }

  setSearch(query, { keep = false } = {}) {
    query ||= '';
    // The match that was current, by record: an edit has already redrawn the view.
    const prev = keep ? this.hitId : null;
    // Find draws more cards only to reach a match; closing it puts back what was drawn before.
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

  /** Draw cards up to the current match, and scroll to it. */
  showHit(focus) {
    const id = this.hits?.[this.hitIndex];
    if (!id) return;
    const i = this.records.findIndex((r) => r.id === id);
    if (i >= this.limit) {
      this.limit = Math.ceil((i + 1) / BATCH) * BATCH;
      this.render();
    }
    const card = this.grid.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    card?.scrollIntoView({ block: 'nearest' });
    if (focus) card?.focus({ preventScroll: true });
  }
}
