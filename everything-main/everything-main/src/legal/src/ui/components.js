/** Reusable view-building blocks. */
import { h, uniqueId, debounce, rafThrottle } from './dom.js';
import { icon } from './icons.js';
import { initials } from '../core/format.js';
import { centsToInput, centsStep, parseMoney } from '../core/money.js';
import { parseDuration, formatHoursDecimal } from '../core/duration.js';

export function pill(label, tone = 'neutral', { dot = false } = {}) {
  return h(`span.pill.${tone}`, dot ? h('span.pill-dot', { 'aria-hidden': 'true' }) : null, label);
}

export function avatar(name, { color, size = '', title, img } = {}) {
  const node = h(`span.avatar${size ? '.' + size : ''}`, {
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

export function pageHeader({ title, crumbs, subtitle, actions, after, tabs: tabNode }) {
  return h(
    'header.page-header',
    h(
      'div.page-header-row',
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
    ),
    tabNode || null,
  );
}

export function emptyState({ icon: ic = 'inbox', title, text, actions, compact = false, headingLevel = 2 }) {
  return h(
    `div.empty${compact ? '.compact' : ''}`,
    h('div.empty-icon', icon(ic, compact ? 22 : 28)),
    h(`h${headingLevel}`, title),
    text ? h('p', text) : null,
    actions ? h('div.row.center', actions) : null,
  );
}

export function stat({ label, value, sub, tone, onClick, href, icon: ic }) {
  const tag = href ? 'a' : onClick ? 'button' : 'div';
  return h(
    `${tag}.stat${tone ? '.tone-' + tone : ''}`,
    { href: href || null, type: tag === 'button' ? 'button' : null, onClick: onClick || null },
    h('span.stat-label', ic ? icon(ic, 15) : null, label),
    h('span.stat-value', value),
    sub ? h('span.stat-sub', sub) : null,
  );
}

export function card({ title, count, actions, body, flush = false, id, headingLevel = 2, cls = '' }) {
  const headingId = id || uniqueId('card');
  return h(
    `section.card${cls ? '.' + cls : ''}`,
    { 'aria-labelledby': title ? headingId : null },
    title ? h('div.card-head', h(`h${headingLevel}.grow`, { id: headingId }, title, count !== undefined && count !== null ? h('span.count', String(count)) : null), actions || null) : null,
    h(`div.card-body${flush ? '.flush' : ''}`, body),
  );
}

/** Definition list of label/value pairs; empty values are skipped. */
export function kvList(pairs) {
  return h(
    'dl.kv',
    pairs.filter((p) => p && p[1] !== null && p[1] !== undefined && p[1] !== '').map(([k, v]) => [h('dt', k), h('dd', v)]),
  );
}

/** A labelled form field. `control` is an input node (gets the id). */
export function field(label, control, { hint, span = 1, required, error, cls = '' } = {}) {
  const id = control.id || uniqueId('f');
  if (!control.id) control.id = id;
  // Both ways, so a form laid out again can make a field optional; left
  // unsaid, the control keeps what it was created with.
  if (required !== undefined) control.required = !!required;
  const hintId = hint ? uniqueId('hint') : null;
  if (hintId) control.setAttribute('aria-describedby', hintId);
  return h(
    `div.field${span === 2 ? '.span-2' : span === 'full' ? '.span-full' : ''}${cls ? '.' + cls : ''}`,
    h('label', { for: id }, label, required ? h('span.req', { 'aria-hidden': 'true' }, ' *') : null),
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
    options
      .map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
      .map((o) =>
        o.group
          ? h(
              'optgroup',
              { label: o.group },
              o.options.map((x) => h('option', { value: x.value }, x.label)),
            )
          : h('option', { value: o.value, disabled: o.disabled || null }, o.label),
      ),
  );
  s.value = value ?? '';
  return s;
}

export function checkbox({ name, checked = false, label, onChange, ...rest }) {
  const input = h('input', { type: 'checkbox', name, checked, ...rest });
  if (onChange) input.addEventListener('change', () => onChange(input.checked));
  return h('label.check', input, h('span', label));
}

/** On/off switch (a checkbox with role=switch). */
export function toggle({ name, checked = false, label, onChange, ...rest }) {
  const input = h('input.switch', { type: 'checkbox', role: 'switch', name, checked, ...rest });
  if (onChange) input.addEventListener('change', () => onChange(input.checked));
  return h('label.check.switch-label', input, h('span', label));
}

/** Money input showing dollars, with a .cents getter/setter on the node. */
export function moneyInput({ name, cents = 0, placeholder = centsStep() === 100 ? '0' : '0.00', cls = '', allowEmpty = false, ...rest } = {}) {
  const input = h(`input.input.num${cls ? '.' + cls : ''}`, {
    name,
    inputmode: 'decimal',
    placeholder,
    autocomplete: 'off',
    value: cents || (allowEmpty && cents === 0) ? centsToInput(cents) : '',
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

/**
 * Duration input in hours. Accepts 1.5, 1:30, 1h 30m, 90m. A .minutes
 * getter/setter is on the node; blur normalizes to decimal hours.
 */
export function durationInput({ name, minutes = 0, placeholder = '0.0', ...rest } = {}) {
  const input = h('input.input.num', { name, inputmode: 'decimal', placeholder, autocomplete: 'off', value: minutes ? formatHoursDecimal(minutes) : '', ...rest });
  Object.defineProperty(input, 'minutes', {
    get: () => parseDuration(input.value) ?? 0,
    set: (v) => (input.value = v ? formatHoursDecimal(v) : ''),
  });
  input.addEventListener('blur', () => {
    const m = parseDuration(input.value);
    if (m !== null && input.value.trim()) input.value = formatHoursDecimal(m);
    input.toggleAttribute('aria-invalid', !!input.value.trim() && m === null);
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
  const wrap = h('div.input-affix.search', icon('search', 16), input);
  wrap.input = input;
  return wrap;
}

/**
 * Accessible tabs that switch content in place. items: [{ id, label, count }].
 * panelId: the id of the tab panel they control, for aria-controls.
 */
export function tabs({ items, selected, onSelect, label, cls = '', panelId = null }) {
  const list = h(`div.tabs${cls ? '.' + cls : ''}`, { role: 'tablist', 'aria-label': label || null });
  const buttons = items.map((t) =>
    h(
      'button',
      {
        type: 'button',
        role: 'tab',
        id: panelId ? `${panelId}-${t.id}` : null,
        'aria-controls': panelId,
        'aria-selected': String(t.id === selected),
        tabindex: t.id === selected ? '0' : '-1',
        onClick: () => {
          for (const b of buttons) {
            const on = b === buttons[items.indexOf(t)];
            b.setAttribute('aria-selected', String(on));
            b.tabIndex = on ? 0 : -1;
          }
          onSelect(t.id);
        },
      },
      t.icon ? icon(t.icon, 15) : null,
      t.label,
      t.count !== undefined && t.count !== null ? h('span.tab-count', String(t.count)) : null,
    ),
  );
  list.append(...buttons);
  // Keep the selected tab visible in a horizontally scrolling strip.
  const sel = buttons[items.findIndex((t) => t.id === selected)];
  if (sel)
    requestAnimationFrame(() => {
      if (sel.offsetLeft + sel.offsetWidth > list.scrollLeft + list.clientWidth || sel.offsetLeft < list.scrollLeft) list.scrollLeft = sel.offsetLeft - 16;
    });
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

/** Navigation tabs (links between pages), styled like tabs. items: [{ href, label, current }] */
export function navTabs(items, label) {
  return h(
    'nav.tabs.nav-tabs',
    { 'aria-label': label },
    items.map((t) => h('a', { href: t.href, 'aria-current': t.current ? 'page' : null }, t.label, t.count !== undefined ? h('span.tab-count', String(t.count)) : null)),
  );
}

/** Segmented control (single choice). items: [{ value, label, icon }] */
export function segmented({ items, value, onChange, label, size = '' }) {
  const group = h(`div.seg${size ? '.' + size : ''}`, { role: 'radiogroup', 'aria-label': label || null });
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
            const on = b === btns[items.indexOf(it)];
            b.setAttribute('aria-checked', String(on));
            b.tabIndex = on ? 0 : -1;
          }
          onChange(it.value);
        },
      },
      it.icon ? icon(it.icon, 15) : null,
      it.label ? h('span', it.label) : null,
      it.count !== undefined ? h('span.seg-count', String(it.count)) : null,
    ),
  );
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

export function spinner(size = 16) {
  return icon('loader', size, 'spin');
}

/** Overflow ("more") icon button. */
export function moreButton(onClick, label = 'More actions') {
  return h('button.icon-btn.bordered', { type: 'button', 'aria-label': label, title: label, onClick: (e) => onClick(e.currentTarget) }, icon('more'));
}

/** Small horizontal progress meter. pct may exceed 100 (shown as over budget). */
export function meter(pct, { label, tone } = {}) {
  const v = Math.max(0, Number(pct) || 0);
  const t = tone || (v > 100 ? 'danger' : v > 85 ? 'warning' : 'accent');
  return h(
    `div.meter.${t}`,
    {
      role: 'meter',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(Math.min(100, Math.round(v))),
      // The value is capped at the maximum; the text says by how much it is over.
      'aria-valuetext': `${Math.round(v)}%`,
      'aria-label': label || null,
    },
    h('span', { style: { width: `${Math.min(100, v)}%` } }),
  );
}

// ---- Data table ---------------------------------------------------------------

const COLS_KEY = 'legal.columns.';

function loadHidden(key, columns) {
  try {
    const raw = JSON.parse(localStorage.getItem(COLS_KEY + key) || 'null');
    if (Array.isArray(raw)) return new Set(raw);
  } catch {}
  return new Set(columns.filter((c) => c.hidden).map((c) => c.id));
}

function compareBy(col, dir) {
  return (a, b) => {
    const va = col.sort(a);
    const vb = col.sort(b);
    if (va === vb) return 0;
    if (va === null || va === undefined || va === '') return 1;
    if (vb === null || vb === undefined || vb === '') return -1;
    return (typeof va === 'string' ? va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' }) : va - vb) * dir;
  };
}

/**
 * Sortable data table with windowed rendering: only the rows in view (plus
 * a margin) exist in the DOM, so a list of 20,000 time entries scrolls as
 * smoothly as a list of 20. The table scrolls inside its own region with a
 * sticky header. On phones the rows render as a compact list instead.
 *
 * columns: [{ id, label, render(row), sort?(row), align: 'r', width, hidden, fixed }]
 * rowHref(row) makes rows links; onRowClick(row) runs an action instead.
 * Returns { node, setRows(rows), selected: Set, clearSelection() }.
 */
export function dataTable({
  columns,
  rows = [],
  sort = null,
  onSort,
  rowHref,
  onRowClick,
  caption,
  empty,
  mobile,
  selectable = false,
  onSelectionChange,
  columnsKey,
  rowHeight = 44,
  footer,
  rowClass,
  maxHeight,
}) {
  let data = rows;
  let sorted = [];
  let hidden = columnsKey ? loadHidden(columnsKey, columns) : new Set(columns.filter((c) => c.hidden).map((c) => c.id));
  const selected = new Set();
  const node = h('div.dt');
  const scroller = h('div.dt-scroll', { tabindex: '0', role: 'region', 'aria-label': caption || 'Table' });
  if (maxHeight) scroller.style.maxHeight = maxHeight;
  const table = h('table.table');
  const thead = h('thead');
  const tbody = h('tbody');
  table.append(caption ? h('caption.sr-only', caption) : '', thead, tbody);
  scroller.append(table);
  const mobileList = h('ul.list.dt-mobile');
  let mobileShown = 50;
  const foot = h('div.dt-foot');
  const emptyWrap = h('div.dt-empty');
  node.append(scroller, mobileList, emptyWrap, foot);

  const visibleCols = () => columns.filter((c) => !hidden.has(c.id));
  const headerCheckbox = selectable ? h('input', { type: 'checkbox', 'aria-label': 'Select all rows' }) : null;
  headerCheckbox?.addEventListener('change', () => {
    if (headerCheckbox.checked) for (const r of sorted) selected.add(r.id);
    else selected.clear();
    drawRows(true);
    onSelectionChange?.(selected);
  });

  function applySort() {
    const col = sort && columns.find((c) => c.id === sort.id);
    sorted = col?.sort ? [...data].sort(compareBy(col, sort.dir === 'desc' ? -1 : 1)) : data;
  }

  // Redraws replace the header cells and rows. Put focus back on the same
  // control (same row, same column) so keyboard users keep their place.
  const rowOf = new WeakMap();
  function keepingFocus(part, draw) {
    const el = document.activeElement;
    if (!el || !part.contains(el)) return draw();
    const cell = el.closest('td, th');
    const tr = cell?.parentElement;
    const id = rowOf.get(tr)?.id;
    const col = cell ? [...tr.children].indexOf(cell) : -1;
    draw();
    if (el.isConnected) return el.focus({ preventScroll: true });
    const next = part === thead ? part.querySelector('tr') : id === undefined ? null : [...part.children].find((r) => rowOf.get(r)?.id === id);
    (next?.children[col]?.querySelector('a, button, input, select, textarea, [tabindex]') || scroller).focus({ preventScroll: true });
  }

  function drawHead() {
    keepingFocus(thead, drawHeadNow);
  }

  function drawHeadNow() {
    const cols = visibleCols();
    thead.replaceChildren(
      h(
        'tr',
        selectable ? h('th.dt-check', { scope: 'col' }, headerCheckbox) : null,
        cols.map((c) => {
          const active = sort?.id === c.id;
          return h(
            `th${c.align === 'r' ? '.r' : ''}`,
            { scope: 'col', 'aria-sort': active ? (sort.dir === 'desc' ? 'descending' : 'ascending') : null, style: c.width ? { width: c.width } : null },
            c.sort && onSort
              ? h(
                  'button.sort',
                  { type: 'button', onClick: () => setSort({ id: c.id, dir: active && sort.dir === 'asc' ? 'desc' : 'asc' }) },
                  c.label,
                  icon(active ? (sort.dir === 'desc' ? 'arrow-down' : 'arrow-up') : 'sort', 13),
                )
              : c.label || h('span.sr-only', c.srLabel || ''),
          );
        }),
      ),
    );
  }

  function setSort(s) {
    sort = s;
    onSort?.(s);
    applySort();
    drawHead();
    drawRows(true);
    drawMobile();
  }

  let lastRange = '';
  function renderRow(row) {
    const href = rowHref?.(row);
    const cols = visibleCols();
    const tr = h(`tr${href || onRowClick ? '.clickable' : ''}${selected.has(row.id) ? '.selected' : ''}`, { style: { height: `${rowHeight}px` } });
    rowOf.set(tr, row);
    const extra = rowClass?.(row);
    if (extra) tr.classList.add(extra);
    if (selectable) {
      const cb = h('input', { type: 'checkbox', checked: selected.has(row.id), 'aria-label': 'Select row' });
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(row.id);
        else selected.delete(row.id);
        tr.classList.toggle('selected', cb.checked);
        syncHeaderCheckbox();
        onSelectionChange?.(selected);
      });
      tr.append(h('td.dt-check', cb));
    }
    cols.forEach((c, i) => {
      const content = c.render(row);
      tr.append(h(`td${c.align === 'r' ? '.r' : ''}${c.cls ? '.' + c.cls : ''}`, i === 0 && href ? h('a.row-link', { href }, content) : content));
    });
    if (href || onRowClick) {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('a, button, input, label, select, textarea')) return;
        if (getSelection()?.toString()) return;
        // Ctrl/Cmd/Shift+click opens a new tab, as it would on the row's link.
        if (href && (e.metaKey || e.ctrlKey || e.shiftKey)) window.open(href, '_blank', 'noopener');
        else if (href) location.hash = href.replace(/^#/, '');
        else onRowClick(row);
      });
    }
    return tr;
  }

  function syncHeaderCheckbox() {
    if (!headerCheckbox) return;
    headerCheckbox.checked = sorted.length > 0 && selected.size >= sorted.length;
    headerCheckbox.indeterminate = selected.size > 0 && selected.size < sorted.length;
  }

  // Windowing: spacer rows above and below the rendered slice.
  const OVERSCAN = 12;
  function drawRows(force = false) {
    const total = sorted.length;
    const viewH = scroller.clientHeight || 600;
    const headH = thead.offsetHeight || 40;
    const top = Math.max(0, scroller.scrollTop - headH);
    const start = Math.max(0, Math.floor(top / rowHeight) - OVERSCAN);
    const end = Math.min(total, Math.ceil((top + viewH) / rowHeight) + OVERSCAN);
    const key = `${start}:${end}:${total}`;
    if (!force && key === lastRange) return;
    lastRange = key;
    const span = visibleCols().length + (selectable ? 1 : 0);
    const frag = document.createDocumentFragment();
    if (start > 0) frag.append(h('tr.dt-spacer', { 'aria-hidden': 'true' }, h('td', { colspan: String(span), style: { height: `${start * rowHeight}px` } })));
    for (let i = start; i < end; i++) frag.append(renderRow(sorted[i]));
    if (end < total) frag.append(h('tr.dt-spacer', { 'aria-hidden': 'true' }, h('td', { colspan: String(span), style: { height: `${(total - end) * rowHeight}px` } })));
    keepingFocus(tbody, () => tbody.replaceChildren(frag));
    syncHeaderCheckbox();
  }
  scroller.addEventListener(
    'scroll',
    rafThrottle(() => drawRows()),
    { passive: true },
  );
  if (typeof ResizeObserver === 'function') new ResizeObserver(rafThrottle(() => drawRows())).observe(scroller);

  function drawMobile() {
    if (!mobile) {
      mobileList.hidden = true;
      return;
    }
    mobileList.replaceChildren(...sorted.slice(0, mobileShown).map((r) => h('li', mobile(r))));
    if (sorted.length > mobileShown) {
      const showMore = () => {
        const first = mobileShown;
        mobileShown += 50;
        drawMobile();
        // The button is gone; continue from the first item it revealed.
        mobileList.children[first]?.querySelector('a, button, input, [tabindex]')?.focus();
      };
      const more = h('li.dt-more', h('button.btn', { type: 'button', onClick: showMore }, `Show more`, h('span.subtle', ` (${sorted.length - mobileShown} left)`)));
      mobileList.append(more);
    }
  }

  function drawAll() {
    applySort();
    // Selection survives a refresh only for rows that still exist.
    const ids = new Set(data.map((r) => r.id));
    for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
    const isEmpty = !sorted.length;
    node.classList.toggle('is-empty', isEmpty);
    emptyWrap.replaceChildren(isEmpty && empty ? (typeof empty === 'function' ? empty() : empty) : '');
    if (mobile) node.classList.add('has-mobile');
    drawHead();
    drawRows(true);
    drawMobile();
    foot.replaceChildren(...[].concat(footer ? footer(sorted) : []).filter(Boolean));
    foot.hidden = !footer;
  }

  drawAll();

  return {
    node,
    selected,
    setRows(next) {
      data = next;
      drawAll();
    },
    clearSelection() {
      selected.clear();
      drawRows(true);
      onSelectionChange?.(selected);
    },
    get rows() {
      return sorted;
    },
    /** A "Columns" menu button for showing and hiding optional columns. */
    columnsButton() {
      const btn = h('button.btn', { type: 'button', 'aria-haspopup': 'dialog', 'aria-label': 'Columns' }, icon('columns', 16), h('span.hide-sm', 'Columns'));
      btn.addEventListener('click', async () => {
        const { openPopover } = await import('./menu.js');
        openPopover(
          btn,
          () =>
            h(
              'fieldset.cols-pop',
              h('legend.menu-label', 'Show columns'),
              columns
                .filter((c) => c.label && !c.fixed)
                .map((c) =>
                  checkbox({
                    label: c.label,
                    checked: !hidden.has(c.id),
                    onChange: (on) => {
                      if (on) hidden.delete(c.id);
                      else hidden.add(c.id);
                      if (columnsKey) {
                        try {
                          localStorage.setItem(COLS_KEY + columnsKey, JSON.stringify([...hidden]));
                        } catch {}
                      }
                      drawHead();
                      drawRows(true);
                    },
                  }),
                ),
            ),
          { align: 'end', label: 'Columns' },
        );
      });
      return btn;
    },
  };
}

// ---- Pickers ------------------------------------------------------------------------

/**
 * Combobox with type-ahead filtering (ARIA 1.2 pattern).
 * items(): array; itemLabel(item); renderItem?(item); onSelect(item)
 * footerAction: { label(query), run(query) } shown at the end (e.g. "Create").
 */
export function combobox({ placeholder, items, itemLabel, renderItem, onSelect, footerAction, label, filter, value = '', name, required, clearable = false, onClear }) {
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
    name: name || null,
    required: required || null,
  });
  const list = h('ul.combo-list', { id: listId, role: 'listbox', hidden: true });
  let options = [];
  let active = -1;

  function render() {
    const q = input.value;
    const all = items();
    const filtered = (filter ? all.filter((it) => filter(it, q)) : all).slice(0, 60);
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
      const li = h('li.combo-action', { role: 'option', id: `${listId}-new`, 'aria-selected': 'false' }, icon('plus', 16), h('span', footerAction.label(q)));
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

  input.addEventListener('click', () => list.hidden && open());
  input.addEventListener('input', open);
  input.addEventListener('blur', () => setTimeout(close, 120));
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
        e.preventDefault();
        close();
      }
    }
  });
  const clearBtn = clearable
    ? h('button.icon-btn.sm.combo-clear', { type: 'button', 'aria-label': `Clear ${label || ''}`.trim(), onClick: () => ((input.value = ''), onClear?.(), input.focus()) }, icon('x', 14))
    : null;
  const wrap = h('div.combo', h('div.input-affix', icon('search', 16), input, clearBtn), list);
  wrap.input = input;
  return wrap;
}

/**
 * Record picker: a combobox bound to a hidden value. getItems() returns
 * records; labelOf(record) is the text shown. `value` is an id.
 * The node exposes .value (id) and fires 'change'.
 */
export function recordPicker({ name, value = '', getItems, labelOf, subOf, placeholder = 'Search', label, required = false, onChange, footerAction, filterFn }) {
  let current = value || '';
  const hidden = h('input', { type: 'hidden', name: name || null, value: current });
  const find = (id) => getItems().find((r) => r.id === id);
  const cb = combobox({
    placeholder,
    label,
    required,
    value: current ? labelOf(find(current)) || '' : '',
    items: getItems,
    itemLabel: labelOf,
    renderItem: (r) => h('div.pick-item', h('span.truncate', labelOf(r)), subOf ? h('span.pick-sub.truncate', subOf(r) || '') : null),
    filter: filterFn || ((r, q) => !q || normalizeIncludes(`${labelOf(r)} ${subOf ? subOf(r) : ''}`, q)),
    onSelect: (r) => set(r.id),
    footerAction: footerAction
      ? {
          label: footerAction.label,
          run: async (q) => {
            const rec = await footerAction.run(q);
            if (rec?.id) set(rec.id);
          },
        }
      : null,
    clearable: true,
    onClear: () => set(''),
  });
  function set(id) {
    current = id || '';
    hidden.value = current;
    cb.input.value = current ? labelOf(find(current)) || '' : '';
    cb.input.removeAttribute('aria-invalid');
    onChange?.(current);
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // Typing then leaving without choosing restores the chosen label.
  cb.input.addEventListener('blur', () =>
    setTimeout(() => {
      if (!cb.input.value.trim() && current) set('');
      else if (current) cb.input.value = labelOf(find(current)) || '';
      else if (cb.input.value.trim()) cb.input.value = '';
    }, 150),
  );
  const node = h('div.picker', cb, hidden);
  Object.defineProperty(node, 'value', { get: () => current, set: (v) => set(v) });
  node.input = cb.input;
  // field() puts the label's id on the visible input.
  Object.defineProperty(node, 'id', { get: () => cb.input.id, set: (v) => (cb.input.id = v) });
  Object.defineProperty(node, 'required', { get: () => cb.input.required, set: (v) => (cb.input.required = v) });
  return node;
}

function normalizeIncludes(hay, q) {
  const n = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  const H = n(hay);
  return n(q)
    .trim()
    .split(/\s+/)
    .every((t) => H.includes(t));
}

/** Tag editor: chips with an input; Enter or comma adds. Node has .tags. */
export function tagInput({ name, tags = [], suggestions = [], placeholder = 'Add a tag', label = 'Tags' }) {
  let list = [...tags];
  const listId = uniqueId('tags');
  const input = h('input.tag-entry', { type: 'text', placeholder, 'aria-label': label, list: listId, autocomplete: 'off' });
  const chipsNode = h('span.tag-chips');
  const hiddenInput = h('input', { type: 'hidden', name: name || null, value: list.join(',') });
  function draw() {
    chipsNode.replaceChildren(
      ...list.map((t) => h('span.tag', t, h('button.tag-x', { type: 'button', 'aria-label': `Remove ${t}`, onClick: () => ((list = list.filter((x) => x !== t)), draw()) }, icon('x', 12)))),
    );
    hiddenInput.value = list.join(',');
  }
  function add(v) {
    const t = v.trim().replace(/,/g, '');
    if (t && !list.some((x) => x.toLowerCase() === t.toLowerCase())) list.push(t);
    input.value = '';
    draw();
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      if (input.value.trim()) {
        e.preventDefault();
        add(input.value);
      }
    } else if (e.key === 'Backspace' && !input.value && list.length) {
      list.pop();
      draw();
    }
  });
  input.addEventListener('blur', () => input.value.trim() && add(input.value));
  draw();
  const node = h(
    'div.tag-input',
    chipsNode,
    input,
    hiddenInput,
    h(
      'datalist',
      { id: listId },
      suggestions.map((s) => h('option', { value: s })),
    ),
  );
  node.addEventListener('click', (e) => e.target === node && input.focus());
  Object.defineProperty(node, 'tags', { get: () => list });
  Object.defineProperty(node, 'id', { get: () => input.id, set: (v) => (input.id = v) });
  return node;
}

/** Group of options rendered as a row of selectable cards (radio). */
export function choiceCards({ name, value, options, onChange, label }) {
  const group = h('div.choice-cards', { role: 'radiogroup', 'aria-label': label || null });
  for (const o of options) {
    const input = h('input', { type: 'radio', name, value: o.value, checked: o.value === value });
    input.addEventListener('change', () => input.checked && onChange?.(o.value));
    group.append(h('label.choice-card', input, o.icon ? icon(o.icon, 18) : null, h('span', o.label)));
  }
  return group;
}
