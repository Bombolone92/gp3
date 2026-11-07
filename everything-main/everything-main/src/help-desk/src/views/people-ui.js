/**
 * Shared UI for the customer, organization and search screens: a sortable
 * table that renders rows in batches as you scroll, a save status pill for
 * forms that save as you edit, and a few option lists.
 */
import './people.css';
import { h, clear, uid, preserveFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { avatar } from '../ui/components.js';
import { app } from '../app.js';
import { collator } from './people-data.js';

const BATCH = 100;

/**
 * columns: [{ id, label, width, sort(row), render(row), cls, numeric }]
 * Returns { el, update(rows), focusFirst() }. Rows are opened with onOpen(row).
 */
export function dataTable({ label, columns, onOpen, sort = null, href = null, onSort = null }) {
  const wrap = h('div.dt-wrap');
  const table = h('table.table.dt', { 'aria-label': label });
  const thead = h('thead');
  const tbody = h('tbody');
  const more = h('div.dt-more');
  table.append(thead, tbody);
  wrap.append(table, more);
  let rows = [];
  let shown = 0;
  let current = sort || { id: columns[0].id, dir: 'asc' };
  let focusIndex = 0;

  function sorted(list) {
    const col = columns.find((c) => c.id === current.id && c.sort);
    if (!col) return list;
    const dir = current.dir === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => {
      const x = col.sort(a);
      const y = col.sort(b);
      if (typeof x === 'string' || typeof y === 'string') return collator.compare(String(x ?? ''), String(y ?? '')) * dir;
      return ((x ?? -Infinity) - (y ?? -Infinity)) * dir;
    });
  }

  function header() {
    clear(thead);
    const tr = h('tr');
    for (const c of columns) {
      const active = current.id === c.id;
      const th = h(`th${c.cls ? `.${c.cls}` : ''}${c.numeric ? '.num' : ''}`, {
        scope: 'col',
        style: c.width ? { width: `${c.width}px` } : {},
        'aria-sort': c.sort ? (active ? (current.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined,
      });
      if (c.sort) {
        th.append(h('button.sort-btn', {
          type: 'button',
          onclick: () => {
            current = { id: c.id, dir: active ? (current.dir === 'asc' ? 'desc' : 'asc') : c.defaultDir || 'asc' };
            onSort?.(current);
            render(true);
          },
        }, c.label, icon(active ? (current.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'arrow-up-down', { size: 12 })));
      } else th.append(c.label);
      tr.append(th);
    }
    thead.append(tr);
  }

  function rowEl(row, index) {
    const link = href ? href(row) : null;
    const tr = h('tr', {
      tabindex: index === focusIndex ? '0' : '-1',
      // A stable handle on the record, so focus can find it after a repaint.
      dataset: link ? { index: String(index), key: link } : { index: String(index) },
      onclick: (e) => {
        if (e.target.closest('a, button, input')) return;
        if ((e.metaKey || e.ctrlKey) && link) {
          window.open(link, '_blank', 'noopener');
          return;
        }
        onOpen?.(row);
      },
      onfocus: () => {
        const prev = tbody.querySelector('tr[tabindex="0"]');
        if (prev && prev !== tr) prev.tabIndex = -1;
        tr.tabIndex = 0;
        focusIndex = index;
      },
    });
    for (const c of columns) tr.append(h(`td${c.cls ? `.${c.cls}` : ''}${c.numeric ? '.num' : ''}`, c.render(row)));
    return tr;
  }

  function appendBatch() {
    const end = Math.min(rows.length, shown + BATCH);
    const frag = document.createDocumentFragment();
    for (let i = shown; i < end; i++) frag.append(rowEl(rows[i], i));
    tbody.append(frag);
    shown = end;
    paintMore();
  }

  function paintMore() {
    clear(more);
    if (shown < rows.length) {
      more.append(h('button.btn.btn-sm', { type: 'button', onclick: () => appendBatch() }, `Show more (${(rows.length - shown).toLocaleString()} left)`));
    }
  }

  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting) && shown < rows.length) appendBatch();
      }, { rootMargin: '400px' })
    : null;
  io?.observe(more);

  function render(resetFocus = false) {
    preserveFocus(wrap, () => {
      rows = sorted(rows);
      header();
      clear(tbody);
      if (resetFocus) focusIndex = 0;
      const keep = Math.max(BATCH, Math.min(rows.length, shown || BATCH));
      shown = 0;
      while (shown < keep && shown < rows.length) appendBatch();
      paintMore();
      // One row stays reachable with Tab when the list shrank below the row
      // last focused.
      if (!tbody.querySelector('tr[tabindex="0"]')) {
        const first = tbody.querySelector('tr');
        if (first) {
          first.tabIndex = 0;
          focusIndex = 0;
        }
      }
    });
  }

  function focusRow(i) {
    if (!rows.length) return;
    const idx = Math.max(0, Math.min(rows.length - 1, i));
    while (idx >= shown) appendBatch();
    const prev = tbody.querySelector('tr[tabindex="0"]');
    if (prev) prev.tabIndex = -1;
    const tr = tbody.querySelector(`tr[data-index="${idx}"]`);
    if (tr) {
      tr.tabIndex = 0;
      tr.focus();
      tr.scrollIntoView({ block: 'nearest' });
    }
    focusIndex = idx;
  }

  tbody.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr');
    if (!tr || e.target !== tr) return;
    const i = Number(tr.dataset.index);
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); focusRow(i + 1); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); focusRow(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusRow(0); }
    else if (e.key === 'End') { e.preventDefault(); focusRow(rows.length - 1); }
    else if (e.key === 'Enter' || e.key === 'o') { e.preventDefault(); onOpen?.(rows[i]); }
  });

  return {
    el: wrap,
    update(list) {
      rows = list;
      render();
    },
    focusFirst() {
      focusRow(0);
    },
    destroy() {
      io?.disconnect();
    },
    get sort() {
      return current;
    },
  };
}

/** A small "Saving / Saved / Not saved" pill announced to screen readers. */
export function saveStatus() {
  const el = h('span.save-status', { role: 'status', 'aria-live': 'polite' });
  let timer = null;
  el.set = (state, text) => {
    clearTimeout(timer);
    clear(el);
    el.dataset.state = state;
    if (state === 'saving') el.append(h('span.spinner'), 'Saving');
    else if (state === 'saved') {
      el.append(icon('check', { size: 13 }), 'Saved');
      timer = setTimeout(() => {
        clear(el);
        delete el.dataset.state;
      }, 2500);
    } else if (state === 'error') el.append(icon('triangle-alert', { size: 13 }), text || 'Not saved');
  };
  return el;
}

export function downloadText(name, text, type = 'text/csv') {
  // A byte order mark tells Excel the CSV is UTF-8, or it garbles accents.
  const blob = new Blob(type === 'text/csv' ? ['\ufeff', text] : [text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function orgOptions() {
  return [
    { value: null, label: 'No organization' },
    ...[...app.replica.orgs.values()].sort((a, b) => collator.compare(a.name, b.name)).map((o) => ({ value: o.id, label: o.name, desc: (o.domains || [])[0] || '', icon: orgMark(o.name, 'sm') })),
  ];
}

/** A square mark for organizations, to tell them apart from people. */
export function orgMark(name, size = '') {
  const letter = String(name || '?').trim()[0]?.toUpperCase() || '?';
  return h(`span.org-mark${size ? `.${size}` : ''}`, { 'aria-hidden': 'true' }, letter);
}

const LOCALE_CODES = ['en-US', 'en-GB', 'es', 'es-MX', 'fr', 'fr-CA', 'de', 'it', 'pt-BR', 'pt-PT', 'nl', 'sv', 'da', 'nb', 'fi', 'pl', 'cs', 'tr', 'ru', 'uk', 'ar', 'he', 'fa', 'hi', 'id', 'th', 'vi', 'ja', 'ko', 'zh-CN', 'zh-TW'];

export function localeOptions() {
  let names = null;
  try {
    names = new Intl.DisplayNames(undefined, { type: 'language' });
  } catch {
    names = null;
  }
  return [
    { value: null, label: 'Not set' },
    ...LOCALE_CODES.map((code) => ({ value: code, label: names?.of(code) || code, desc: code })),
  ];
}

export function tzOptions(zones) {
  return [{ value: null, label: 'Not set' }, ...zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))];
}

/** A person cell: avatar, name and optional second line. */
export function personCell(name, sub = '') {
  return h('div.person-cell', avatar(name, { size: 'sm' }), h('div.person-text', h('span.ellipsis.person-name', name), sub ? h('span.ellipsis.person-sub', sub) : null));
}

/** A responsive segmented control, used where the side nav is hidden on phones. */
export function segmented({ label, items, value, onChange }) {
  const group = h('div.segmented', { role: 'radiogroup', 'aria-label': label });
  const buttons = items.map((it) => h('button.seg', {
    type: 'button',
    role: 'radio',
    'aria-checked': String(it.value === value),
    tabindex: it.value === value ? '0' : '-1',
    onclick: (e) => {
      for (const b of buttons) {
        const on = b === e.currentTarget;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      }
      onChange(it.value);
    },
  }, h('span', it.label), it.count !== undefined ? h('span.count', String(it.count)) : null));
  group.append(...buttons);
  group.setCounts = (counts) => {
    items.forEach((it, i) => {
      const c = buttons[i].querySelector('.count');
      if (c && it.value in counts) c.textContent = String(counts[it.value]);
    });
  };
  group.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (i === -1) return;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % buttons.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + buttons.length) % buttons.length;
    if (next !== null) {
      e.preventDefault();
      buttons[next].focus();
      buttons[next].click();
    }
  });
  return group;
}

export { uid };
