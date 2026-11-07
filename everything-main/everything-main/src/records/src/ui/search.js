/**
 * Quick search (Ctrl/Cmd+K): jump to a table, a view, a record in this
 * base, or another base.
 */
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { accentColor } from '../lib/colors.js';
import { VIEW_TYPES } from '../data/views.js';
import { openPopover } from './popover.js';
import { newId } from '../lib/ids.js';

export function openQuickSearch(page) {
  const base = page.base;
  const store = page.store;
  const listId = newId('qs');
  const input = h('input.input.palette-input', { type: 'search', placeholder: 'Search tables, views, records and bases', 'aria-label': 'Quick search', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': listId, autocomplete: 'off' });
  const list = h('div.palette-list', { id: listId, role: 'listbox', 'aria-label': 'Results' });
  let items = [];
  let active = 0;

  const results = (q) => {
    const out = [];
    const ql = q.toLowerCase();
    for (const t of base.tableList()) {
      if (!q || t.name.toLowerCase().includes(ql)) out.push({ kind: 'Table', label: t.name, icon: 'table', go: () => page.go(t.id, null) });
      for (const v of t.views) if (q && v.name.toLowerCase().includes(ql)) out.push({ kind: `View in ${t.name}`, label: v.name, icon: VIEW_TYPES[v.type]?.icon, go: () => page.go(t.id, v.id) });
    }
    if (q) {
      let n = 0;
      outer: for (const t of base.tableList()) {
        for (const r of t.ordered()) {
          const name = base.recordName(t.id, r.id);
          if (name.toLowerCase().includes(ql)) {
            out.push({ kind: `Record in ${t.name}`, label: name, icon: 'expand', go: () => {
              if (page.tableId !== t.id) page.go(t.id, null);
              page.openRecord(r.id);
            } });
            if (++n >= 40) break outer;
          }
        }
      }
      for (const b of store.bases()) {
        if (b.id !== base.id && b.name.toLowerCase().includes(ql)) out.push({ kind: 'Base', label: b.name, base: b, go: () => page.app.navigate(b.id) });
      }
    }
    return out;
  };

  // Searching runs as the query changes; arrow keys only move the highlight.
  const paint = () => {
    items = results(input.value.trim());
    list.replaceChildren(
      ...items.map((it, i) => h('div.menu-item', { role: 'option', id: `${listId}-${i}`, 'aria-selected': 'false', onpointerdown: (e) => e.preventDefault(), onclick: () => choose(i) },
        it.base ? h('span.base-icon', { style: { width: '18px', height: '18px', borderRadius: '4px', background: accentColor(it.base.color) } }, icon(it.base.icon || 'table', 11)) : icon(it.icon || 'table', 16),
        h('span.menu-label', it.label), h('span.menu-hint', it.kind))),
    );
    if (!items.length) list.append(h('div.menu-empty', 'Nothing matches'));
    setActive(Math.min(active, Math.max(0, items.length - 1)));
  };

  const setActive = (i) => {
    const rows = items.length ? list.children : [];
    rows[active]?.classList.remove('active');
    rows[active]?.setAttribute('aria-selected', 'false');
    active = i;
    rows[active]?.classList.add('active');
    rows[active]?.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', items.length ? `${listId}-${active}` : '');
  };

  const choose = (i) => {
    const it = items[i];
    if (!it) return;
    pop.close({ restoreFocus: false });
    it.go();
  };

  input.addEventListener('input', () => {
    active = 0;
    paint();
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      setActive((active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
      list.children[active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    }
  });
  paint();
  const pop = openPopover({ x: window.innerWidth / 2 - Math.min(300, window.innerWidth / 2 - 12), y: 72 }, h('div.palette.menu', h('div.menu-search', input), list), { focus: input, label: 'Quick search', className: 'palette-pop' });
  return pop;
}
