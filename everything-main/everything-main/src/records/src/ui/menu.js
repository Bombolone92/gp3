/**
 * Menus: lists of commands with full keyboard support (arrows, Home/End,
 * typeahead, Enter, Escape, Right/Left for submenus) and an optional search
 * box. Items:
 *   { label, icon, hint, onSelect, danger, disabled, checked, submenu, keepOpen, description, render }
 *   { type: 'sep' } | { type: 'header', label }
 */
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { openPopover } from './popover.js';

let seq = 0;

export function openMenu(anchor, items, opts = {}) {
  const id = `menu-${++seq}`;
  const list = h('div.menu-list', { role: 'none' });
  const search = opts.search ? h('input.input', { type: 'text', placeholder: opts.searchPlaceholder || 'Find...', 'aria-label': opts.searchPlaceholder || 'Find', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': id, autocomplete: 'off', spellcheck: false }) : null;
  const root = h('div.menu', { role: 'menu', id, 'aria-label': opts.label || null, tabindex: '-1' });
  if (search) root.append(h('div.menu-search', search));
  root.append(list);
  if (opts.footer) root.append(opts.footer);

  let active = -1;
  let rows = [];
  let sub = null;
  let typed = '';
  let typedTimer = 0;

  const resolveItems = () => (typeof items === 'function' ? items() : items);

  function render() {
    const q = search ? search.value.trim().toLowerCase() : '';
    list.replaceChildren();
    rows = [];
    let pendingSep = false;
    const all = resolveItems().filter(Boolean);
    for (const item of all) {
      if (item.type === 'sep') {
        pendingSep = rows.length > 0;
        continue;
      }
      if (item.type === 'header') {
        if (q) continue;
        if (pendingSep) list.append(h('div.menu-sep', { role: 'separator' }));
        pendingSep = false;
        list.append(h('div.menu-header', { role: 'presentation' }, item.label));
        continue;
      }
      if (q && !String(item.label).toLowerCase().includes(q) && !String(item.keywords || '').toLowerCase().includes(q)) continue;
      if (pendingSep) list.append(h('div.menu-sep', { role: 'separator' }));
      pendingSep = false;
      const i = rows.length;
      const role = item.checked === undefined ? 'menuitem' : item.radio ? 'menuitemradio' : 'menuitemcheckbox';
      const el = h(
        `div.menu-item${item.danger ? '.danger' : ''}`,
        {
          id: `${id}-${i}`,
          role,
          'aria-checked': item.checked === undefined ? null : String(!!item.checked),
          'aria-disabled': item.disabled ? 'true' : null,
          'aria-haspopup': item.submenu ? 'menu' : null,
          title: item.title || null,
        },
        item.checked !== undefined ? h('span.menu-check', item.checked ? icon('check', 14) : null) : null,
        item.render ? item.render() : item.icon ? (item.icon instanceof Node ? item.icon : icon(item.icon, 16)) : null,
        item.render ? null : h('span.menu-label', item.label, item.description ? h('div.muted', { style: { fontSize: '12px', whiteSpace: 'normal' } }, item.description) : null),
        item.hint ? h('span.menu-hint', item.hint) : null,
        item.submenu ? icon('chevronRight', 14) : null,
      );
      el.addEventListener('pointermove', () => {
        if (active !== i) setActive(i, false);
        if (item.submenu && !item.disabled) openSub(i);
        else closeSub();
      });
      el.addEventListener('click', (e) => {
        e.preventDefault();
        choose(i);
      });
      list.append(el);
      rows.push({ item, el });
    }
    if (!rows.length) list.append(h('div.menu-empty', opts.emptyText || 'No matches'));
    if (active >= rows.length) active = rows.length - 1;
    if (search) setActive(rows.length ? Math.max(0, active) : -1, false);
  }

  function setActive(i, scroll = true) {
    rows[active]?.el.classList.remove('active');
    active = i;
    const row = rows[i];
    if (row) {
      row.el.classList.add('active');
      if (scroll) row.el.scrollIntoView({ block: 'nearest' });
      (search || root).setAttribute('aria-activedescendant', row.el.id);
    } else {
      (search || root).removeAttribute('aria-activedescendant');
    }
  }

  function move(delta) {
    if (!rows.length) return;
    let i = active;
    for (let n = 0; n < rows.length; n++) {
      i = (i + delta + rows.length) % rows.length;
      if (!rows[i].item.disabled) break;
    }
    setActive(i);
  }

  function openSub(i) {
    const row = rows[i];
    if (!row?.item.submenu) return;
    if (sub && sub.index === i && !sub.handle.closed) return;
    closeSub();
    const subItems = typeof row.item.submenu === 'function' ? row.item.submenu() : row.item.submenu;
    const handle = openMenu(row.el, subItems, {
      placement: 'right-start',
      offset: 2,
      focus: false,
      expanded: false,
      parent: handle0,
      onChoose: () => handle0.close({ restoreFocus: true }),
      label: row.item.label,
      search: row.item.search,
    });
    sub = { index: i, handle };
  }

  function closeSub() {
    if (sub) {
      sub.handle.close({ restoreFocus: false });
      sub = null;
    }
  }

  function choose(i) {
    const row = rows[i];
    if (!row || row.item.disabled) return;
    if (row.item.submenu) {
      openSub(i);
      sub?.handle.focusFirst?.();
      return;
    }
    if (!row.item.keepOpen) {
      handle0.close({ restoreFocus: opts.restoreFocus !== false });
      opts.onChoose?.();
    }
    row.item.onSelect?.(row.item);
    if (row.item.keepOpen) render();
  }

  const onKey = (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Home': {
        if (search && e.target === search) return;
        e.preventDefault();
        // The first or last item that can be chosen.
        const i = rows.findIndex((r) => !r.item.disabled);
        if (i >= 0) setActive(i);
        break;
      }
      case 'End': {
        if (search && e.target === search) return;
        e.preventDefault();
        let i = rows.length - 1;
        while (i >= 0 && rows[i].item.disabled) i--;
        if (i >= 0) setActive(i);
        break;
      }
      case 'Enter':
      case ' ':
        if (e.key === ' ' && search && e.target === search) return;
        e.preventDefault();
        if (active >= 0) choose(active);
        else if (search && opts.onEnter) {
          opts.onEnter(search.value);
          handle0.close();
        }
        break;
      case 'ArrowRight':
        if (rows[active]?.item.submenu) {
          e.preventDefault();
          openSub(active);
          sub?.handle.focusFirst?.();
        }
        break;
      case 'ArrowLeft':
        if (opts.parent) {
          e.preventDefault();
          handle0.close();
        }
        break;
      case 'Tab':
        e.preventDefault();
        handle0.close();
        break;
      default:
        if (!search && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          typed += e.key.toLowerCase();
          clearTimeout(typedTimer);
          typedTimer = setTimeout(() => (typed = ''), 600);
          const start = typed.length === 1 ? active + 1 : active;
          for (let n = 0; n < rows.length; n++) {
            const k = (start + n) % rows.length;
            if (!rows[k].item.disabled && String(rows[k].item.label).toLowerCase().startsWith(typed)) {
              setActive(k);
              break;
            }
          }
        }
    }
  };

  root.addEventListener('keydown', onKey);
  if (search) search.addEventListener('input', () => {
    active = 0;
    render();
  });

  render();
  const handle0 = openPopover(anchor, root, {
    role: 'presentation',
    placement: opts.placement,
    offset: opts.offset,
    focus: opts.focus === false ? false : search || root,
    className: `menu-pop${opts.className ? ` ${opts.className}` : ''}`,
    onClose: (reason) => {
      closeSub();
      opts.onClose?.(reason);
    },
    expanded: opts.expanded,
    width: opts.width,
  });
  handle0.focusFirst = () => {
    (search || root).focus();
    if (rows.length) setActive(0);
  };
  handle0.refresh = render;
  if (!search && opts.activeFirst !== false && opts.focus !== false) setActive(rows.findIndex((r) => !r.item.disabled));
  return handle0;
}

/** Open a menu at the pointer (context menus). */
export function openContextMenu(e, items, opts = {}) {
  e.preventDefault();
  return openMenu({ x: e.clientX, y: e.clientY }, items, opts);
}
