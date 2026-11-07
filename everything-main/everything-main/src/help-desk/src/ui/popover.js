/**
 * Floating menus and pickers anchored to a button.
 *
 * openMenu()   an action menu (role=menu) with arrow-key navigation and
 *              type-ahead, for "more actions" and split buttons.
 * openPicker() a searchable list (combobox + listbox) for choosing a value,
 *              used by every select-like field in the app.
 *
 * Only one popover is open at a time. Escape or a click outside closes it
 * and returns focus to the anchor.
 */
import { h, uid, clear, composing } from './dom.js';
import { icon } from './icons.js';

let current = null;

export function closePopover() {
  if (current) current.close(false);
}

/** What a control is called: its aria-label, its <label>, or its text. */
function nameOf(el) {
  return (el.getAttribute('aria-label') || [...(el.labels || [])].map((l) => l.textContent).join(' ') || el.textContent).trim();
}

/**
 * Run what a choice does, then keep keyboard focus on its button. Choices
 * often repaint the toolbar or panel the button lives in, which drops focus
 * to the page; then the button's replacement is found in the closest part of
 * the page that is still there, by its name or else by its position.
 */
function keepFocus(anchor, run) {
  const kin = (root) => [...root.querySelectorAll(anchor.tagName)].filter((e) => e.className === anchor.className);
  const chain = [];
  for (let n = anchor.parentElement; n; n = n.parentElement) chain.push({ n, at: kin(n).indexOf(anchor) });
  const name = nameOf(anchor);
  const restore = () => {
    const was = document.activeElement;
    if (anchor.isConnected || (was && was !== document.body)) return;
    const root = chain.find((c) => c.n.isConnected);
    if (!root) return;
    const same = kin(root.n);
    const named = same.filter((e) => nameOf(e) === name);
    (named.length === 1 ? named[0] : same[root.at])?.focus({ preventScroll: true });
  };
  const out = run();
  restore();
  if (out && typeof out.then === 'function') out.then(restore, restore);
  return out;
}

function place(pop, anchor, { align = 'start', side = 'bottom', minWidth = 0 } = {}) {
  const r = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  pop.style.minWidth = `${Math.max(minWidth, 0)}px`;
  pop.style.maxHeight = '';
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  let left = align === 'end' ? r.right - pw : r.left;
  left = Math.max(8, Math.min(left, vw - pw - 8));
  let top = side === 'top' ? r.top - ph - 4 : r.bottom + 4;
  if (side !== 'top' && top + ph > vh - 8) {
    const above = r.top - ph - 4;
    if (above >= 8) top = above;
    else {
      top = Math.max(8, vh - ph - 8);
      pop.style.maxHeight = `${vh - 16}px`;
    }
  }
  if (side === 'top' && top < 8) top = r.bottom + 4;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

function mount(pop, anchor, opts, onClose) {
  closePopover();
  // Inside a modal dialog everything outside it is inert and drawn beneath
  // it, so a popover opened from a dialog has to live in that dialog.
  (anchor.closest('dialog') || document.body).appendChild(pop);
  place(pop, anchor, opts);
  anchor.setAttribute('aria-expanded', 'true');
  const outside = (e) => {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) state.close(false);
  };
  const onResize = () => state.close(false);
  // A popover is fixed to the window: when the page or a panel scrolls, it
  // follows its button, and closes once the button is out of sight.
  let moving = false;
  const onScroll = (e) => {
    if (pop.contains(e.target) || moving) return;
    moving = true;
    requestAnimationFrame(() => {
      moving = false;
      if (current !== state) return;
      const r = anchor.getBoundingClientRect();
      if (!anchor.isConnected || r.bottom < 0 || r.top > window.innerHeight) state.close(false);
      else place(pop, anchor, opts);
    });
  };
  const state = {
    anchor,
    close(refocus = true) {
      if (current !== state) return;
      current = null;
      pop.remove();
      anchor.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
      if (refocus && anchor.isConnected) anchor.focus();
      onClose?.();
    },
  };
  current = state;
  // Added a tick later so the click that opened it does not close it; not at
  // all if it was closed in the meantime, or the listener would never go.
  setTimeout(() => {
    if (current === state) document.addEventListener('pointerdown', outside, true);
  }, 0);
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onScroll, true);
  return state;
}

/**
 * items: [{ label, icon, shortcut, run, danger, disabled, checked, desc }]
 * plus { separator: true } and { heading: 'Text' }.
 */
/** A second click on the button of an open menu closes it, as menu buttons do. */
function closesInstead(anchor) {
  if (current?.anchor !== anchor) return false;
  current.close(true);
  return true;
}

export function openMenu(anchor, items, opts = {}) {
  if (closesInstead(anchor)) return null;
  const menuId = uid('menu');
  const pop = h(`div#${menuId}.popover.menu`, { role: 'menu', 'aria-label': opts.label || 'Actions', tabindex: '-1' });
  const buttons = [];
  for (const it of items) {
    if (!it) continue;
    if (it.separator) {
      pop.append(h('div.menu-sep', { role: 'separator' }));
      continue;
    }
    if (it.heading) {
      pop.append(h('div.menu-heading', { role: 'presentation' }, it.heading));
      continue;
    }
    const role = it.checked === undefined ? 'menuitem' : 'menuitemradio';
    const btn = h(
      `button.menu-item${it.danger ? '.danger' : ''}`,
      {
        type: 'button', role, tabindex: '-1', disabled: it.disabled,
        'aria-checked': it.checked === undefined ? undefined : String(!!it.checked),
        onclick: () => {
          state.close(true);
          keepFocus(anchor, () => it.run?.());
        },
      },
      h('span.menu-check', it.checked ? icon('check', { size: 14 }) : it.icon ? icon(it.icon, { size: 15 }) : null),
      h('span.menu-label', it.label, it.desc ? h('span.menu-desc', it.desc) : null),
      it.shortcut ? h('kbd.menu-kbd', it.shortcut) : null,
    );
    buttons.push(btn);
    pop.append(btn);
  }
  const state = mount(pop, anchor, opts, opts.onClose);
  const enabled = () => buttons.filter((b) => !b.disabled);
  const focusAt = (i) => {
    const list = enabled();
    if (!list.length) return;
    list[(i + list.length) % list.length].focus();
  };
  let typed = '';
  let typedTimer = null;
  pop.addEventListener('keydown', (e) => {
    const list = enabled();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
    else if (e.key === 'End') { e.preventDefault(); focusAt(list.length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); state.close(true); }
    // Back on the button, Tab then moves on from it as usual.
    else if (e.key === 'Tab') { state.close(true); }
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      typed += e.key.toLowerCase();
      clearTimeout(typedTimer);
      typedTimer = setTimeout(() => { typed = ''; }, 600);
      const hit = list.find((b) => b.textContent.trim().toLowerCase().startsWith(typed));
      hit?.focus();
    }
  });
  focusAt(opts.focusLast ? -1 : 0);
  return state;
}

/**
 * options: [{ value, label, icon, desc, group, render, keywords }]
 * Resolves through `onPick(value, option)`. `create` adds a "Create ..."
 * row for the typed text; `multi` keeps the picker open and toggles.
 */
export function openPicker(anchor, {
  options, value = null, onPick, placeholder = 'Search', search = true, label = 'Choose',
  create = null, multi = false, emptyText = 'No matches', minWidth = 240, align = 'start', loadOptions = null,
}) {
  if (closesInstead(anchor)) return null;
  const listId = uid('listbox');
  const input = search
    ? h('input.input.picker-search', {
        type: 'text', placeholder, role: 'combobox', 'aria-expanded': 'true', 'aria-controls': listId,
        'aria-autocomplete': 'list', 'aria-label': label, autocomplete: 'off', spellcheck: 'false',
      })
    : null;
  const list = h(`ul#${listId}.picker-list`, { role: 'listbox', 'aria-label': label, 'aria-multiselectable': multi ? 'true' : undefined, tabindex: search ? '-1' : '0' });
  const pop = h('div.popover.picker', input ? h('div.picker-head', icon('search', { size: 14 }), input) : null, list);
  let active = 0;
  let rows = [];
  let opts = options || [];
  const selected = new Set(multi ? value || [] : [value]);

  const matchesQuery = (o, q) => !q || `${o.label} ${o.desc || ''} ${o.keywords || ''}`.toLowerCase().includes(q);

  function render() {
    const q = (input?.value || '').trim().toLowerCase();
    clear(list);
    rows = [];
    let lastGroup = null;
    const shown = opts.filter((o) => matchesQuery(o, q)).slice(0, 300);
    for (const o of shown) {
      if (o.group && o.group !== lastGroup) {
        lastGroup = o.group;
        list.append(h('li.picker-group', { role: 'presentation' }, o.group));
      }
      rows.push({ option: o });
    }
    if (create && q && !opts.some((o) => o.label.toLowerCase() === q)) rows.push({ create: input.value.trim() });
    if (!rows.length) list.append(h('li.picker-empty', { role: 'presentation' }, emptyText));
    active = Math.max(0, Math.min(active, rows.length - 1));
    rows.forEach((row, i) => {
      const id = `${listId}-${i}`;
      const isSel = row.option && selected.has(row.option.value);
      const li = h(
        `li#${id}.picker-option${i === active ? '.active' : ''}`,
        {
          role: 'option', 'aria-selected': String(!!isSel),
          onmousedown: (e) => e.preventDefault(),
          onclick: () => choose(i),
          onmousemove: () => {
            if (active !== i) {
              active = i;
              highlight();
            }
          },
        },
        h('span.picker-check', isSel ? icon('check', { size: 14 }) : null),
        row.create
          ? h('span.picker-label', icon('plus', { size: 14 }), ` ${create.label || 'Create'} "${row.create}"`)
          : row.option.render
            ? row.option.render()
            : h('span.picker-label', row.option.icon ? row.option.icon : null, h('span', row.option.label), row.option.desc ? h('span.picker-desc', row.option.desc) : null),
      );
      row.el = li;
      list.append(li);
    });
    highlight();
  }

  function highlight() {
    rows.forEach((r, i) => r.el?.classList.toggle('active', i === active));
    const row = rows[active];
    if (row?.el) {
      (input || list).setAttribute('aria-activedescendant', row.el.id);
      row.el.scrollIntoView({ block: 'nearest' });
    }
  }

  async function choose(i) {
    const row = rows[i];
    if (!row) return;
    if (row.create) {
      const made = await create.run(row.create);
      if (made !== undefined && made !== null) {
        if (multi) {
          selected.add(made.value);
          opts = [...opts, made];
          input.value = '';
          render();
          onPick?.([...selected], made);
        } else {
          state.close(true);
          keepFocus(anchor, () => onPick?.(made.value, made));
        }
      }
      return;
    }
    if (multi) {
      if (selected.has(row.option.value)) selected.delete(row.option.value);
      else selected.add(row.option.value);
      render();
      onPick?.([...selected], row.option);
      return;
    }
    state.close(true);
    keepFocus(anchor, () => onPick?.(row.option.value, row.option));
  }

  const keyTarget = input || list;
  keyTarget.addEventListener('keydown', (e) => {
    if (composing(e)) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(rows.length - 1, active + 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); highlight(); }
    else if (e.key === 'Home' && !input) { e.preventDefault(); active = 0; highlight(); }
    else if (e.key === 'End' && !input) { e.preventDefault(); active = rows.length - 1; highlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); state.close(true); }
    else if (e.key === 'Tab') { state.close(true); }
  });
  if (input) {
    let pending = null;
    input.addEventListener('input', () => {
      active = 0;
      render();
      if (loadOptions) {
        clearTimeout(pending);
        const q = input.value.trim();
        pending = setTimeout(async () => {
          const more = await loadOptions(q);
          if (more && state === current) {
            opts = more;
            render();
          }
        }, 200);
      }
    });
  }
  const startIndex = multi ? 0 : Math.max(0, opts.findIndex((o) => o.value === value));
  active = startIndex;
  render();
  const state = mount(pop, anchor, { minWidth: Math.max(minWidth, anchor.offsetWidth), align });
  keyTarget.focus();
  return state;
}
