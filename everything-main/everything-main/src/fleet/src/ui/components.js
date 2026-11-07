/** Reusable view-building blocks. */
import { h, uniqueId, debounce } from './dom.js';
import { icon } from './icons.js';
import { statusMeta } from '../core/status.js';
import { initials } from '../core/format.js';
import { centsToInput, parseMoney } from '../core/money.js';

/** Status pill: statusPill('issue', 'open') or pill('Label', 'green'). */
export function statusPill(kind, id) {
  const m = statusMeta(kind, id);
  return pill(m.label, m.tone);
}

export function pill(label, tone = 'gray', { plain = false } = {}) {
  return h(`span.pill.${tone}${plain ? '.plain' : ''}`, label);
}

/** Colored dot with text, for dense tables. */
export function dotStatus(label, tone = 'gray') {
  return h(`span.dot-status.${tone}`, label);
}

export function avatar(name, { color, size = '', title, img } = {}) {
  const node = h(`span.avatar${size ? '.' + size : ''}${color ? '' : '.client'}`, {
    style: color ? { '--av': color } : null,
    title: title || null,
    'aria-hidden': title ? null : 'true',
    role: title ? 'img' : null,
    'aria-label': title || null,
  });
  if (img) node.append(h('img', { src: img, alt: '' }));
  else node.textContent = initials(name);
  return node;
}

export function avatarStack(members, { size = 'sm', max = 3 } = {}) {
  if (!members.length) return null;
  const shown = members.slice(0, max);
  const extra = members.length - shown.length;
  return h(
    'span.avatar-stack',
    { title: members.map((m) => m.name).join(', ') },
    shown.map((m) => avatar(m.name, { color: m.color, size })),
    extra > 0 ? h(`span.avatar.${size}.client`, `+${extra}`) : null,
  );
}

export function pageHeader({ title, crumbs, subtitle, actions, after }) {
  return h(
    'header.page-header',
    h(
      'div.titles',
      crumbs?.length
        ? h(
            'nav.crumbs',
            { 'aria-label': 'Breadcrumb' },
            crumbs.map((c, i) => [i > 0 ? icon('chevron-right', 14) : null, c.href ? h('a', { href: c.href }, c.label) : h('span', c.label)]),
          )
        : null,
      h('h1', title),
      subtitle ? h('div.subtitle', subtitle) : null,
      after || null,
    ),
    actions ? h('div.actions', actions) : null,
  );
}

export function emptyState({ icon: ic = 'inbox', title, text, actions, compact = false, headingLevel = 2 }) {
  return h(
    `div.empty${compact ? '.compact' : ''}`,
    h('div.empty-icon', icon(ic)),
    h(`h${headingLevel}`, title),
    text ? h('p', text) : null,
    actions ? h('div.row', actions) : null,
  );
}

export function stat({ label, value, sub, tone, onClick, href }) {
  const tag = href ? 'a' : onClick ? 'button' : 'div';
  return h(
    `${tag}.stat${tone ? '.tone-' + tone : ''}`,
    { href: href || null, type: tag === 'button' ? 'button' : null, onClick: onClick || null },
    h('span.stat-label', label),
    h('span.stat-value', value),
    sub ? h('span.stat-sub', sub) : null,
  );
}

export function card({ title, count, actions, body, flush = false, id, headingLevel = 2 }) {
  const headingId = id || uniqueId('card');
  return h(
    'section.card',
    { 'aria-labelledby': title ? headingId : null },
    title
      ? h(
          'div.card-head',
          h(`h${headingLevel}.grow`, { id: headingId }, title, count !== undefined && count !== null ? h('span.count', ` ${count}`) : null),
          actions || null,
        )
      : null,
    h(`div.card-body${flush ? '.flush' : ''}`, body),
  );
}

/** A labelled form field. `control` is an input node (gets the id). */
export function field(label, control, { hint, span2 = false, required = false, error } = {}) {
  const id = control.id || uniqueId('f');
  control.id = id;
  if (required) control.required = true;
  const hintId = hint ? uniqueId('hint') : null;
  if (hintId) control.setAttribute('aria-describedby', hintId);
  return h(
    `div.field${span2 ? '.span-2' : ''}`,
    h('label', { for: id }, label, required ? h('span', { 'aria-hidden': 'true' }, ' *') : null),
    control,
    hint ? h('span.hint', { id: hintId }, hint) : null,
    error ? h('span.error-text', error) : null,
  );
}

export function textInput({ name, value = '', placeholder = '', type = 'text', autocomplete, cls = '', ...rest } = {}) {
  return h(`input.input${cls ? '.' + cls : ''}`, {
    name,
    type,
    value: value ?? '',
    placeholder,
    autocomplete: autocomplete || 'off',
    ...rest,
  });
}

export function textarea({ name, value = '', placeholder = '', rows = 3, ...rest } = {}) {
  const t = h('textarea.textarea', { name, placeholder, rows, ...rest });
  t.value = value ?? '';
  return t;
}

export function select({ name, value, options, cls = '', ...rest }) {
  const s = h(
    `select.select${cls ? '.' + cls : ''}`,
    { name, ...rest },
    options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)).map((o) => h('option', { value: o.value, disabled: o.disabled || null }, o.label)),
  );
  s.value = value ?? '';
  return s;
}

/** Money input: shows dollars, `.cents` getter/setter on the node. */
export function moneyInput({ name, cents = 0, placeholder = '0.00', cls = '', ...rest } = {}) {
  const input = h(`input.input.num${cls ? '.' + cls : ''}`, {
    name,
    inputmode: 'decimal',
    placeholder,
    autocomplete: 'off',
    value: cents ? centsToInput(cents) : '',
    ...rest,
  });
  Object.defineProperty(input, 'cents', {
    get: () => parseMoney(input.value) ?? 0,
    set: (v) => (input.value = v ? centsToInput(v) : ''),
  });
  input.addEventListener('blur', () => {
    const c = parseMoney(input.value);
    if (c !== null) input.value = centsToInput(c);
  });
  return input;
}

export function searchBox({ value = '', placeholder = 'Search', onInput, label = 'Search', delay = 120 }) {
  const input = h('input.input', { type: 'search', value, placeholder, 'aria-label': label, autocomplete: 'off', spellcheck: 'false' });
  const fire = debounce(() => onInput(input.value), delay);
  input.addEventListener('input', fire);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) {
      e.stopPropagation();
      input.value = '';
      onInput('');
    }
  });
  return h('div.input-affix.search', icon('search', 16), input);
}

/** Accessible tabs. tabs: [{ id, label, count }] */
export function tabs({ items, selected, onSelect, label }) {
  const list = h('div.tabs', { role: 'tablist', 'aria-label': label || null });
  const buttons = items.map((t) =>
    h(
      'button',
      {
        type: 'button',
        role: 'tab',
        id: `tab-${t.id}`,
        'aria-selected': String(t.id === selected),
        tabindex: t.id === selected ? '0' : '-1',
        onClick: () => onSelect(t.id),
      },
      t.label,
      t.count !== undefined ? h('span.tab-count', String(t.count)) : null,
    ),
  );
  list.append(...buttons);
  list.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    let n = null;
    if (e.key === 'ArrowRight') n = (i + 1) % buttons.length;
    if (e.key === 'ArrowLeft') n = (i - 1 + buttons.length) % buttons.length;
    if (e.key === 'Home') n = 0;
    if (e.key === 'End') n = buttons.length - 1;
    if (n !== null) {
      e.preventDefault();
      buttons[n].focus();
      buttons[n].click();
    }
  });
  return list;
}

/** Filter chips: [{ id, label, count }] single-select. */
export function chips({ items, selected, onSelect, label }) {
  return h(
    'div.chips',
    { role: 'group', 'aria-label': label || 'Filter' },
    items.map((c) =>
      h(
        'button.chip',
        { type: 'button', 'aria-pressed': String(c.id === selected), onClick: () => onSelect(c.id) },
        c.label,
        c.count !== undefined ? h('span.chip-count', String(c.count)) : null,
      ),
    ),
  );
}

/** Segmented control (single choice). */
export function segmented({ items, value, onChange, label }) {
  const group = h('div.seg', { role: 'radiogroup', 'aria-label': label || null });
  const btns = items.map((it) =>
    h(
      'button',
      {
        type: 'button',
        role: 'radio',
        'aria-checked': String(it.value === value),
        tabindex: it.value === value ? '0' : '-1',
        title: it.title || null,
        'aria-label': it.ariaLabel || null,
        onClick: () => {
          for (const b of btns) {
            b.setAttribute('aria-checked', String(b === btn(it)));
            b.tabIndex = b === btn(it) ? 0 : -1;
          }
          onChange(it.value);
        },
      },
      it.icon ? icon(it.icon, 15) : null,
      it.label ? h('span', it.label) : null,
    ),
  );
  const btn = (it) => btns[items.indexOf(it)];
  group.append(...btns);
  group.addEventListener('keydown', (e) => {
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    let n = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % btns.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + btns.length) % btns.length;
    if (n !== null) {
      e.preventDefault();
      btns[n].focus();
      btns[n].click();
    }
  });
  return group;
}

/**
 * Sortable data table that renders rows in pages ("Show more") so huge
 * lists stay fast. On phones the same rows render as a compact list via
 * `mobile(row)`.
 *
 * columns: [{ id, label, render(row), sort?(row) -> value, align: 'r', cls }]
 */
export function dataTable({ columns, rows, sort, onSort, rowHref, pageSize = 100, mobile, caption, empty }) {
  const wrap = h('div');
  let shown = pageSize;
  const sorted = (() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sort) return rows;
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const va = col.sort(a);
      const vb = col.sort(b);
      if (va === vb) return 0;
      if (va === null || va === undefined || va === '') return 1;
      if (vb === null || vb === undefined || vb === '') return -1;
      return (typeof va === 'string' ? va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' }) : va - vb) * dir;
    });
  })();

  function draw() {
    wrap.replaceChildren();
    if (!sorted.length) {
      if (empty) wrap.append(empty);
      return;
    }
    const visible = sorted.slice(0, shown);
    const table = h(
      'table.table.hide-mobile',
      caption ? h('caption.sr-only', caption) : null,
      h(
        'thead',
        h(
          'tr',
          columns.map((c) => {
            const active = sort?.id === c.id;
            const ariaSort = active ? (sort.dir === 'desc' ? 'descending' : 'ascending') : null;
            return h(
              `th${c.align === 'r' ? '.r' : ''}`,
              { scope: 'col', 'aria-sort': ariaSort },
              c.sort && onSort
                ? h(
                    'button.sort',
                    {
                      type: 'button',
                      onClick: () => onSort({ id: c.id, dir: active && sort.dir === 'asc' ? 'desc' : 'asc' }),
                    },
                    c.label,
                    icon(active ? (sort.dir === 'desc' ? 'arrow-down' : 'arrow-up') : 'sort', 13),
                  )
                : c.label ? c.label : h('span.sr-only', c.srLabel || ''),
            );
          }),
        ),
      ),
      h(
        'tbody',
        visible.map((row) => {
          const href = rowHref?.(row);
          const tr = h(
            `tr${href ? '.clickable' : ''}`,
            columns.map((c, i) => {
              const content = c.render(row);
              return h(
                `td${c.align === 'r' ? '.r' : ''}${c.cls ? '.' + c.cls : ''}`,
                i === 0 && href ? h('a', { href, class: 'row-link' }, content) : content,
              );
            }),
          );
          if (href) {
            tr.addEventListener('click', (e) => {
              if (e.target.closest('a, button, input, label, select')) return;
              if (getSelection()?.toString()) return;
              location.hash = href.replace(/^#/, '');
            });
          }
          return tr;
        }),
      ),
    );
    wrap.append(h('div.table-wrap', { tabindex: '0', role: 'region', 'aria-label': caption || 'Table' }, table));
    if (mobile) {
      wrap.append(
        h(
          'ul.list.show-mobile',
          visible.map((row) => h('li', mobile(row))),
        ),
      );
    }
    if (sorted.length > shown) {
      wrap.append(
        h(
          'div.show-more',
          h(
            'button.btn',
            {
              type: 'button',
              onClick: () => {
                shown += pageSize;
                draw();
              },
            },
            `Show ${Math.min(pageSize, sorted.length - shown)} more`,
            h('span.subtle', ` of ${sorted.length - shown}`),
          ),
        ),
      );
    }
  }
  draw();
  return wrap;
}

/**
 * Combobox with type-ahead filtering (ARIA 1.2 pattern).
 * items(): array; itemLabel(item); renderItem(item); onSelect(item)
 * footerAction: { label, run(query) } shown at the end (e.g. "Create new").
 */
export function combobox({ placeholder, items, itemLabel, renderItem, onSelect, footerAction, label, filter, value = '' }) {
  const listId = uniqueId('cb');
  const input = h('input.input', {
    type: 'text',
    role: 'combobox',
    'aria-expanded': 'false',
    'aria-controls': listId,
    'aria-autocomplete': 'list',
    'aria-label': label || placeholder,
    placeholder,
    autocomplete: 'off',
    value,
  });
  const list = h('ul.combo-list', { id: listId, role: 'listbox', hidden: true });
  let options = [];
  let active = -1;

  function render() {
    const q = input.value;
    const all = items();
    const filtered = (filter ? all.filter((it) => filter(it, q)) : all).slice(0, 50);
    list.replaceChildren();
    options = filtered.map((it, i) => {
      const li = h('li', { role: 'option', id: `${listId}-${i}`, 'aria-selected': 'false' }, renderItem ? renderItem(it) : itemLabel(it));
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        choose(it);
      });
      list.append(li);
      return { it, li };
    });
    if (!options.length && !footerAction) list.append(h('li.combo-empty', 'No matches'));
    if (footerAction) {
      const li = h('li', { role: 'option', id: `${listId}-new`, 'aria-selected': 'false' }, icon('plus', 16), h('span', footerAction.label(q)));
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        close();
        footerAction.run(q);
      });
      list.append(li);
      options.push({ it: null, li, action: true });
    }
    setActive(options.length && q ? 0 : -1);
  }

  function setActive(i) {
    if (active >= 0 && options[active]) options[active].li.setAttribute('aria-selected', 'false');
    active = i;
    if (active >= 0 && options[active]) {
      options[active].li.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', options[active].li.id);
      options[active].li.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function open() {
    render();
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    setActive(-1);
  }

  function choose(it) {
    close();
    onSelect(it);
  }

  // Open on intent (click, typing, arrow), not on programmatic focus.
  input.addEventListener('click', () => list.hidden && open());
  input.addEventListener('input', open);
  input.addEventListener('blur', () => setTimeout(close, 100));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (list.hidden) open();
      setActive(Math.min(options.length - 1, active + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(0, active - 1));
    } else if (e.key === 'Enter') {
      if (!list.hidden && active >= 0) {
        e.preventDefault();
        const o = options[active];
        if (o.action) {
          close();
          footerAction.run(input.value);
        } else choose(o.it);
      }
    } else if (e.key === 'Escape') {
      if (!list.hidden) {
        e.stopPropagation();
        close();
      }
    }
  });
  const wrap = h('div.combo', h('div.input-affix', icon('search', 16), input), list);
  wrap.input = input;
  return wrap;
}

export function spinner(size = 16) {
  const s = icon('loader', size, 'spin');
  return s;
}

/** Overflow ("more") icon button. */
export function moreButton(onClick, label = 'More actions') {
  return h('button.icon-btn.bordered', { type: 'button', 'aria-label': label, title: label, onClick: (e) => onClick(e.currentTarget) }, icon('more'));
}
