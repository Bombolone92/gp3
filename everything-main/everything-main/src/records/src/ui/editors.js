/**
 * Editing values: the in-cell editor laid over the grid, and the pickers
 * it shares with the expanded record (options, linked records,
 * attachments, dates).
 */
import { h, announce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { chipColors, nextColor } from '../lib/colors.js';
import { formatDate, formatBytes, fromDate, shownDate } from '../lib/format.js';

/**
 * The stored value for a day picked in a calendar, at a time of day (as
 * the cell shows it, so in GMT for GMT fields).
 */
function pickedValue(field, day, h, m) {
  const o = field.options || {};
  if (!o.includeTime) return fromDate(day, false);
  if (o.gmt) return new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), h, m)).toISOString();
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
import { parseText, toText, TYPES, isReadOnly } from '../data/fields.js';
import { makeChoice } from '../data/base.js';
import { newId } from '../lib/ids.js';
import { openPopover } from './popover.js';
import { openDialog } from './dialog.js';
import { toast } from './toast.js';
import { calendar } from './datepicker.js';
import { buttonUrl } from '../data/button.js';

const TEXTUAL = new Set(['text', 'email', 'url', 'phone', 'barcode', 'number', 'currency', 'percent', 'duration', 'rating']);

/** Text shown in an input while editing (raw, not formatted for display). */
export function editText(field, v, ctx) {
  if (v === null || v === undefined) return '';
  switch (field.type) {
    case 'number':
      return String(v);
    case 'currency':
      return String(v);
    case 'percent':
      return String(Math.round(v * 100 * 1e6) / 1e6);
    default:
      return toText(field, v, ctx);
  }
}

/**
 * Open an editor for a grid cell. Returns { close(commit), move(rect), contains(el) },
 * or null when the cell has no editor.
 * onCommit(value, how) where how is 'down' | 'right' | 'left' | 'up' | undefined.
 */
export function openCellEditor({ host, rect, page, table, record, field, initial, onCommit, onCancel }) {
  const base = page.base;
  const ctx = base.compute.ctx;
  const current = base.compute.value(table, record, field);
  let done = false;
  const finish = (commit, how, value) => {
    if (done) return;
    done = true;
    cleanup();
    if (commit) onCommit(value, how);
    else onCancel();
  };
  let cleanup = () => {};

  if (TEXTUAL.has(field.type) || field.type === 'longText' || field.type === 'date') {
    const long = field.type === 'longText';
    const input = long ? h('textarea.cell-editor.long', { 'aria-label': field.name, spellcheck: true }) : h('input.cell-editor', { type: 'text', 'aria-label': field.name, autocomplete: 'off', spellcheck: field.type === 'text' });
    input.value = initial !== undefined ? initial : editText(field, current, ctx);
    if (['number', 'currency', 'percent', 'duration', 'rating'].includes(field.type)) input.classList.add('num');
    if (field.type === 'number' || field.type === 'currency' || field.type === 'percent') input.inputMode = 'decimal';
    if (field.type === 'email') input.inputMode = 'email';
    if (field.type === 'phone') input.inputMode = 'tel';
    if (field.type === 'url') input.inputMode = 'url';
    let cal = null;
    let calPop = null;
    const place = (r) => {
      input.style.left = `${r.x}px`;
      input.style.top = `${r.y}px`;
      input.style.width = `${Math.max(r.w, long ? 320 : 120)}px`;
      input.style.minHeight = `${r.h}px`;
      if (long) input.style.height = `${Math.max(r.h, 160)}px`;
      if (r.x + Math.max(r.w, long ? 320 : 120) > r.maxX) input.style.left = `${Math.max(0, r.maxX - Math.max(r.w, long ? 320 : 120) - 4)}px`;
      // Long text near the bottom opens upward rather than being cut off.
      if (long && r.y + Math.max(r.h, 160) > r.maxY) input.style.top = `${Math.max(0, r.maxY - Math.max(r.h, 160) - 4)}px`;
      calPop?.reposition();
    };
    place(rect);
    host.append(input);
    // Untouched text keeps the value: shown text can round it (a duration
    // of 90 seconds shows as 0:02, a time without its seconds).
    const startText = initial === undefined ? input.value : null;
    const read = () => {
      const t = input.value;
      if (t === startText) return current;
      if (field.type === 'date') {
        if (!t.trim()) return null;
        const v = parseText(field, t);
        if (v === null) {
          toast(`"${t}" is not a date this field understands.`);
          return undefined;
        }
        return v;
      }
      if (!t.trim() && field.type !== 'longText') return null;
      const v = parseText(field, t);
      if (v === null && t.trim() && ['number', 'currency', 'percent', 'duration', 'rating'].includes(field.type)) {
        toast(`"${t}" is not a valid ${TYPES[field.type].label.toLowerCase()}.`);
        return undefined;
      }
      return v;
    };
    input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      } else if (e.key === 'Enter' && !(long && e.shiftKey) && !e.altKey) {
        e.preventDefault();
        finish(true, e.shiftKey ? 'up' : 'down', read());
      } else if (e.key === 'Tab') {
        e.preventDefault();
        finish(true, e.shiftKey ? 'left' : 'right', read());
      } else if (field.type === 'date' && e.key === 'ArrowDown' && e.altKey) {
        e.preventDefault();
        cal?.focus();
      }
    });
    // The edit ends when focus leaves both the input and its calendar.
    const leave = () => {
      setTimeout(() => {
        if (done) return;
        if (input.contains(document.activeElement) || calPop?.el.contains(document.activeElement)) return;
        finish(true, undefined, read());
      }, 0);
    };
    input.addEventListener('blur', leave);
    if (field.type === 'date') {
      const gmt = !!field.options?.gmt;
      cal = calendar({
        value: shownDate(current, gmt),
        onPick: (d) => {
          const keep = shownDate(current, gmt);
          finish(true, undefined, pickedValue(field, d, keep ? keep.getHours() : 9, keep ? keep.getMinutes() : 0));
        },
      });
      input.focus();
      calPop = openPopover(input, cal.el, {
        focus: false,
        className: 'padded',
        label: 'Choose a date',
        expanded: false,
        sheet: false,
        keepFor: (t) => input.contains(t),
        // Escape reaches the popover first; it cancels the edit. A click
        // elsewhere (also with focus in the calendar) saves it.
        onClose: (reason) => {
          if (reason === 'escape') finish(false);
          else if (reason === 'outside') finish(true, undefined, read());
        },
      });
      calPop.el.addEventListener('focusout', leave);
      // Pressing a day must not blur the input: browsers that do not focus
      // clicked buttons (Safari) would end the edit before the click lands.
      calPop.el.addEventListener('mousedown', (e) => e.preventDefault());
      input.addEventListener('input', () => {
        const v = parseText(field, input.value);
        if (v) cal.set(shownDate(v, gmt));
      });
    }
    input.focus();
    if (initial === undefined) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
    cleanup = () => {
      input.remove();
      calPop?.close({ restoreFocus: false });
    };
    return {
      close: (commit) => finish(commit, undefined, commit ? read() : undefined),
      move: place,
      contains: (el) => input.contains(el) || !!calPop?.el.contains(el),
    };
  }

  // Pickers anchored to the cell.
  const anchor = h('div.cell-anchor');
  const place = (r) => {
    anchor.style.left = `${r.x}px`;
    anchor.style.top = `${r.y}px`;
    anchor.style.width = `${r.w}px`;
    anchor.style.height = `${r.h}px`;
    pop?.reposition();
  };
  host.append(anchor);
  let pop = null;
  const close = () => finish(true, undefined, undefined);
  if (field.type === 'singleSelect' || field.type === 'multipleSelect') {
    pop = openChoicePicker(anchor, base, table, field, {
      selected: field.type === 'multipleSelect' ? current || [] : current ? [current] : [],
      multi: field.type === 'multipleSelect',
      query: initial,
      onChange: (ids) => {
        base.setCell(table.id, record.id, field.id, field.type === 'multipleSelect' ? ids : ids[0] || null);
        if (field.type === 'singleSelect') pop?.close();
      },
      onClose: close,
    });
  } else if (field.type === 'link') {
    pop = openRecordPicker(anchor, page, table, field, record, { query: initial, onClose: close });
  } else if (field.type === 'attachment') {
    pop = openAttachments(anchor, page, table, field, record, { onClose: close });
  }
  // No editor for this cell (or its picker could not open): nothing stays open.
  if (!pop) {
    anchor.remove();
    if (!done) onCancel();
    return null;
  }
  place(rect);
  cleanup = () => {
    anchor.remove();
    if (pop && !pop.closed) pop.close({ restoreFocus: false });
  };
  return { close: () => finish(true), move: place, contains: (el) => !!pop?.el.contains(el) };
}

/* ---------------------------------------------------------- choices */

/** Pick options of a select field; new names create options. */
export function openChoicePicker(anchor, base, table, field, { selected = [], multi = false, query = '', onChange, onClose }) {
  let sel = [...selected];
  const input = h('input.input', { type: 'text', placeholder: multi ? 'Find or add options' : 'Find or add an option', 'aria-label': 'Find an option', value: query || '', role: 'combobox', 'aria-expanded': 'true', 'aria-autocomplete': 'list' });
  const list = h('div.choice-list', { role: 'listbox', 'aria-multiselectable': multi ? 'true' : null, id: newId('lst') });
  input.setAttribute('aria-controls', list.id);
  const chips = h('div.chips.choice-selected');
  let active = 0;
  let items = [];
  const choices = () => table.field(field.id)?.options.choices || [];
  const paint = () => {
    const q = input.value.trim().toLowerCase();
    const all = choices();
    if (multi) {
      chips.replaceChildren(
        ...sel.map((id) => {
          const c = all.find((x) => x.id === id);
          if (!c) return null;
          const [bg, fg] = chipColors(c.color);
          return h('span.chip', { style: { background: bg, color: fg } }, h('span.chip-label', c.name), h('button.chip-x', { type: 'button', 'aria-label': `Remove ${c.name}`, onclick: () => toggle(c.id) }, icon('x', 12)));
        }).filter(Boolean),
      );
      chips.hidden = !sel.length;
    }
    items = all.filter((c) => !q || c.name.toLowerCase().includes(q));
    const exact = all.some((c) => c.name.toLowerCase() === q);
    list.replaceChildren();
    items.forEach((c, i) => {
      const [bg, fg] = chipColors(c.color);
      const on = sel.includes(c.id);
      list.append(h('div.choice-item', { role: 'option', id: `${list.id}-${i}`, 'aria-selected': String(on), class: `choice-item${i === active ? ' active' : ''}`, onpointerdown: (e) => e.preventDefault(), onclick: () => toggle(c.id) },
        h('span.menu-check', on ? icon('check', 14) : null),
        h('span.chip', { style: { background: bg, color: fg } }, h('span.chip-label', c.name))));
    });
    if (q && !exact) {
      const i = items.length;
      items.push({ create: input.value.trim() });
      list.append(h('div.choice-item', { role: 'option', id: `${list.id}-${i}`, 'aria-selected': 'false', class: `choice-item${i === active ? ' active' : ''}`, onpointerdown: (e) => e.preventDefault(), onclick: () => create(input.value.trim()) }, icon('plus', 14), h('span', `Add "${input.value.trim()}"`)));
    }
    if (!items.length) list.append(h('div.menu-empty', 'No options yet. Type to add one.'));
    if (active >= items.length) active = items.length - 1;
    input.setAttribute('aria-activedescendant', items.length && active >= 0 ? `${list.id}-${active}` : '');
  };
  const toggle = (id) => {
    if (multi) sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    else sel = sel[0] === id ? [] : [id];
    onChange?.(sel);
    if (multi) {
      input.value = '';
      paint();
      input.focus();
    } else pop.close();
  };
  const create = (name) => {
    if (!name) return;
    const f = table.field(field.id);
    const c = makeChoice(name, f.options.choices);
    c.color = nextColor(f.options.choices.map((x) => x.color));
    base.transact(() => {
      base.updateField(table.id, field.id, { options: { ...f.options, choices: [...f.options.choices, c] } });
      sel = multi ? [...sel, c.id] : [c.id];
      onChange?.(sel);
    }, 'Add option');
    announce(`Added option ${name}`);
    input.value = '';
    // A single select is done once it has its value.
    if (multi) paint();
    else pop.close();
  };
  input.addEventListener('input', () => {
    active = 0;
    paint();
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (pop.closed) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      paint();
      list.children[active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[active];
      if (it?.create) create(it.create);
      else if (it) toggle(it.id);
      else if (!multi) pop.close();
    } else if (e.key === 'Backspace' && multi && !input.value && sel.length) {
      toggle(sel[sel.length - 1]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      pop.close();
    }
  });
  paint();
  const pop = openPopover(anchor, h('div.picker', multi ? chips : null, input, list), { focus: input, label: field.name, onClose, placement: 'bottom-start' });
  return pop;
}

/* ---------------------------------------------------------- linked records */

/** Choose records to link; search, toggle, or create a new linked record. */
export function openRecordPicker(anchor, page, table, field, record, { query = '', onClose, get, set } = {}) {
  const base = page.base;
  const target = base.table(field.options.tableId);
  if (!target) {
    toast('The linked table no longer exists.');
    onClose?.();
    return null;
  }
  const input = h('input.input', { type: 'search', placeholder: `Find a record in ${target.name}`, 'aria-label': `Find a record in ${target.name}`, value: query || '', role: 'combobox', 'aria-expanded': 'true' });
  const list = h('div.record-list', { role: 'listbox', 'aria-multiselectable': field.options.single ? 'false' : 'true', id: newId('lst') });
  input.setAttribute('aria-controls', list.id);
  let active = 0;
  let shown = [];
  // Forms pass get/set to choose links before the record exists.
  const current = get || (() => base.table(table.id).record(record.id)?.c[field.id] || []);
  const write = set || ((ids) => base.setCell(table.id, record.id, field.id, ids));
  const preview = target.fields.filter((f) => f.id !== target.primary.id).slice(0, 3);
  // Records linked when the picker opened (or the search changed) come
  // first; toggling does not reorder the list under the highlight.
  let first = new Set(current());
  const paint = () => {
    const q = input.value.trim().toLowerCase();
    const sel = new Set(current());
    shown = [];
    const add = (r) => {
      const name = base.recordName(target.id, r.id);
      if (q && !name.toLowerCase().includes(q)) return false;
      shown.push({ r, name });
      return true;
    };
    // Linked records show however far down their table they are.
    for (const id of first) {
      const r = target.record(id);
      if (r) add(r);
    }
    let others = 0;
    for (const r of target.ordered()) {
      if (first.has(r.id)) continue;
      if (add(r) && ++others >= 200) break;
    }
    list.replaceChildren();
    shown.forEach(({ r, name }, i) => {
      const details = preview.map((f) => {
        const v = base.compute.value(target, r, f);
        const t = toText(f, v, base.compute.ctx);
        return t ? h('span.record-detail', h('span.muted', `${f.name}: `), t) : null;
      }).filter(Boolean);
      list.append(h('div.record-item', { role: 'option', id: `${list.id}-${i}`, 'aria-selected': String(sel.has(r.id)), onpointerdown: (e) => e.preventDefault(), onclick: () => toggle(r.id) },
        h('span.menu-check', sel.has(r.id) ? icon('check', 14) : null),
        h('span.record-text', h('span.record-name', name), details.length ? h('span.record-details', details) : null)));
    });
    if (!shown.length) list.append(h('div.menu-empty', q ? 'No records match' : `${target.name} has no records yet`));
    setActive(active);
  };
  // Arrow keys only move the highlight: the list is not searched again.
  const setActive = (i) => {
    const rows = shown.length ? list.children : [];
    rows[active]?.classList.remove('active');
    active = i;
    rows[active]?.classList.add('active');
    input.setAttribute('aria-activedescendant', shown.length ? `${list.id}-${active}` : '');
  };
  const toggle = (id) => {
    const cur = current();
    let next;
    if (cur.includes(id)) next = cur.filter((x) => x !== id);
    else next = field.options.single ? [id] : [...cur, id];
    write(next);
    if (field.options.single && next.length) pop.close();
    else paint();
  };
  const addNew = () => {
    const name = input.value.trim();
    base.transact(() => {
      const [rid] = base.createRecords(target.id, [name ? { [target.primary.id]: name } : {}]);
      const cur = current();
      write(field.options.single ? [rid] : [...cur, rid]);
    }, 'Add linked record');
    input.value = '';
    announce(`Created and linked ${name || 'a new record'}`);
    paint();
  };
  input.addEventListener('input', () => {
    active = 0;
    first = new Set(current());
    paint();
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown.length) return;
      setActive((active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length);
      list.children[active]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown[active]) toggle(shown[active].r.id);
      else if (input.value.trim()) addNew();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      pop.close();
    }
  });
  const footer = h('button.picker-footer', { type: 'button', onclick: addNew }, icon('plus', 14), h('span', `Add new record to ${target.name}`));
  paint();
  const pop = openPopover(anchor, h('div.picker.wide', input, list, footer), { focus: input, label: `Link records from ${target.name}`, onClose });
  return pop;
}

/* ------------------------------------------------------------- attachments */

/** A small image to paint in cells and cards (max 320px on the long side). */
export async function makeThumb(file) {
  if (!String(file.type).startsWith('image/') || typeof createImageBitmap !== 'function') return null;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const hgt = Math.max(1, Math.round(bmp.height * scale));
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, hgt) : Object.assign(document.createElement('canvas'), { width: w, height: hgt });
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, hgt);
    const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 }) : await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.82));
    return blob ? { blob, width: bmp.width, height: bmp.height } : null;
  } catch {
    return null;
  }
}

/** Upload files and add them to a record's attachment field. */
export async function uploadFiles(page, table, field, recordId, files) {
  const list = [...files];
  if (!list.length) return;
  const t = toast(`Uploading ${list.length} file${list.length === 1 ? '' : 's'}...`, { timeout: 0 });
  try {
    const atts = [];
    for (const f of list) {
      const thumb = await makeThumb(f);
      atts.push(await page.store.putFile(page.baseId, f, { thumb }));
    }
    const cur = page.base.table(table.id).record(recordId)?.c[field.id] || [];
    page.base.setCell(table.id, recordId, field.id, [...cur, ...atts]);
    t.close();
    announce(`Uploaded ${atts.length} file${atts.length === 1 ? '' : 's'}`);
  } catch (err) {
    t.close();
    toast(err?.code === 'storage_limit_reached' || err?.status === 413 ? 'Your Puter storage is full.' : 'Could not upload the file.', { error: true });
  }
}

const urlCache = new Map();
const URL_CACHE_MAX = 300;
// Types that are safe to show in a page of our own origin. Anything else
// (HTML, SVG, scripts) is handed out as a download so it can never run.
const SAFE_TYPE = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|application\/pdf|audio\/.+|video\/.+|text\/plain)$/i;

export async function fileUrl(page, path) {
  if (urlCache.has(path)) {
    const url = urlCache.get(path);
    urlCache.delete(path);
    urlCache.set(path, url);
    return url;
  }
  let blob = await page.store.readFile(path);
  if (!blob) return null;
  if (!SAFE_TYPE.test(blob.type || '')) {
    const guess = guessType(path);
    blob = new Blob([blob], { type: SAFE_TYPE.test(guess) ? guess : 'application/octet-stream' });
  }
  const url = URL.createObjectURL(blob);
  urlCache.set(path, url);
  while (urlCache.size > URL_CACHE_MAX) {
    const [oldPath, oldUrl] = urlCache.entries().next().value;
    urlCache.delete(oldPath);
    URL.revokeObjectURL(oldUrl);
  }
  return url;
}

function guessType(path) {
  const ext = String(path).split('.').pop().toLowerCase();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm', txt: 'text/plain' }[ext] || '';
}

/** Show an attachment large, with download and open buttons. */
export async function previewAttachment(page, att, list = [att]) {
  let index = Math.max(0, list.findIndex((a) => a.id === att.id));
  const body = h('div.att-preview');
  const title = h('span');
  let showing = 0;
  const show = async () => {
    const a = list[index];
    // Stepping on while a file loads: only the latest one is shown.
    const token = ++showing;
    title.textContent = a.name;
    body.replaceChildren(h('div.spinner'));
    const url = await fileUrl(page, a.path).catch(() => null);
    if (token !== showing) return;
    if (!url) {
      body.replaceChildren(h('p', 'This file could not be loaded.'));
      return;
    }
    const isImg = String(a.type).startsWith('image/');
    const isPdf = a.type === 'application/pdf';
    const isVideo = String(a.type).startsWith('video/');
    const isAudio = String(a.type).startsWith('audio/');
    body.replaceChildren(
      isImg ? h('img', { src: url, alt: a.name }) : isVideo ? h('video', { src: url, controls: true }) : isAudio ? h('audio', { src: url, controls: true }) : isPdf ? h('iframe', { src: url, title: a.name }) : h('div.att-file', icon('file', 40), h('p', a.name), h('p.muted', formatBytes(a.size))),
      h('div.att-actions', h('a.btn', { href: url, download: a.name }, icon('download', 16), 'Download'), h('a.btn.ghost', { href: url, target: '_blank', rel: 'noopener' }, icon('external', 16), 'Open in new tab')),
    );
  };
  const nav = list.length > 1
    ? h('div.att-nav', h('button.icon-btn', { type: 'button', 'aria-label': 'Previous file', onclick: () => {
      index = (index - 1 + list.length) % list.length;
      show();
    } }, icon('chevronLeft', 18)), h('button.icon-btn', { type: 'button', 'aria-label': 'Next file', onclick: () => {
      index = (index + 1) % list.length;
      show();
    } }, icon('chevronRight', 18)))
    : null;
  openDialog({ title: h('span.att-title', title, nav), className: 'xwide', body });
  show();
}

/** Manage a record's attachments: add, preview, remove. */
export function openAttachments(anchor, page, table, field, record, { onClose } = {}) {
  const base = page.base;
  const list = h('ul.att-list');
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => {
    uploadFiles(page, table, field, record.id, fileInput.files).then(paint);
    fileInput.value = '';
  } });
  const drop = h('button.att-drop', { type: 'button', onclick: () => fileInput.click() }, icon('upload', 18), h('span', 'Drop files here or browse'));
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    uploadFiles(page, table, field, record.id, e.dataTransfer.files).then(paint);
  });
  function paint() {
    const atts = base.table(table.id).record(record.id)?.c[field.id] || [];
    list.replaceChildren(
      ...atts.map((a) =>
        h('li.att-item',
          h('button.att-open', { type: 'button', onclick: () => previewAttachment(page, a, atts), 'aria-label': `Open ${a.name}` }, attachmentThumb(page, a, 36), h('span.att-name', a.name), h('span.att-size', formatBytes(a.size))),
          h('button.icon-btn', { type: 'button', 'aria-label': `Remove ${a.name}`, 'data-tip': 'Remove', onclick: () => {
            const cur = base.table(table.id).record(record.id)?.c[field.id] || [];
            base.setCell(table.id, record.id, field.id, cur.filter((x) => x.id !== a.id));
            paint();
          } }, icon('trash', 14))),
      ),
    );
  }
  paint();
  return openPopover(anchor, h('div.picker.wide', drop, fileInput, list), { label: `${field.name} attachments`, onClose, focus: drop });
}

/** A small thumbnail element for an attachment. */
export function attachmentThumb(page, a, size = 36) {
  const box = h('span.att-thumb', { style: { width: `${size}px`, height: `${size}px` } });
  // A file picked in a form, not uploaded yet: shown from the file itself.
  if (a.file) {
    if (String(a.type).startsWith('image/')) {
      a.preview ||= URL.createObjectURL(a.file);
      box.append(h('img', { src: a.preview, alt: '' }));
    } else box.append(h('span.att-ext', (String(a.name).split('.').pop() || '').slice(0, 4).toUpperCase() || icon('file', 16)));
    return box;
  }
  if (a.thumb || String(a.type).startsWith('image/')) {
    fileUrl(page, a.thumb || a.path).then((url) => {
      if (url) box.replaceChildren(h('img', { src: url, alt: '' }));
    }).catch(() => {});
    box.append(icon('image', Math.round(size / 2)));
  } else {
    const ext = (String(a.name).split('.').pop() || '').slice(0, 4).toUpperCase();
    box.append(h('span.att-ext', ext || icon('file', 16)));
  }
  return box;
}

/* ------------------------------------------------------- field inputs */

/**
 * An input for any field, used by the expanded record and forms. Returns
 * an element; changes call onChange(value) (selects, links and
 * attachments save as they change).
 */
export function fieldInput(page, table, field, record, { onChange, form = false, value: formValue, id } = {}) {
  const base = page.base;
  const ctx = base.compute.ctx;
  const value = form ? formValue : base.compute.value(table, record, field);
  const readOnly = isReadOnly(field);
  const commit = (v) => onChange?.(v);
  if (readOnly) {
    if (field.type === 'button') {
      return h('button.btn.small', { type: 'button', id, onclick: () => {
        const url = buttonUrl(base, table, record, field);
        if (url) window.open(url, '_blank', 'noopener');
        else toast('This button has no link yet.');
      } }, field.options?.label || 'Open');
    }
    const text = toText(field, value, ctx);
    if (value && typeof value === 'object' && value.error) return h('div.ro-value.error', { id, title: value.message }, value.error);
    return h('div.ro-value', { id, tabindex: '0' }, text || h('span.muted', 'Empty'));
  }
  switch (field.type) {
    case 'longText': {
      const ta = h('textarea.textarea', { id, rows: 3 });
      ta.value = value || '';
      ta.addEventListener('change', () => commit(ta.value || null));
      autoGrow(ta);
      return ta;
    }
    case 'checkbox': {
      const cb = h('input', { type: 'checkbox', id, checked: !!value, class: 'big-check', style: { accentColor: chipColors(`${field.options?.color || 'green'}Strong`)[0] } });
      cb.addEventListener('change', () => commit(cb.checked));
      return cb;
    }
    case 'rating': {
      const max = field.options?.max || 5;
      let cur = value || 0;
      const stars = Array.from({ length: max }, (_, i) => h('button.rating-star', {
        type: 'button',
        role: 'radio',
        'aria-label': `${i + 1} of ${max}`,
        onclick: () => {
          cur = cur === i + 1 ? 0 : i + 1;
          commit(cur || null);
          paint();
        },
      }));
      // Marked in place, so the star just chosen keeps focus.
      const paint = () => stars.forEach((btn, i) => {
        btn.setAttribute('aria-checked', String(cur === i + 1));
        btn.classList.toggle('on', i < cur);
        btn.style.color = i < cur ? chipColors(`${field.options?.color || 'yellow'}Strong`)[0] : '';
        btn.replaceChildren(icon(field.options?.icon === 'heart' ? 'heart' : 'star', 18, { fill: i < cur ? 'currentColor' : 'none' }));
      });
      paint();
      return h('div.rating-input', { role: 'radiogroup', id, 'aria-label': field.name }, stars);
    }
    case 'singleSelect':
    case 'multipleSelect':
    case 'link':
    case 'attachment': {
      const box = h('div.multi-input', { id, tabindex: '0', role: 'button', 'aria-haspopup': 'dialog', 'aria-label': `${field.name}: edit` });
      let cur = value;
      const paint = () => {
        box.replaceChildren();
        if (field.type === 'attachment') {
          const atts = cur || [];
          // Files picked in a form are not uploaded yet: each can be removed.
          const chip = (a) => (form
            ? h('span.att-chip', attachmentThumb(page, a, 56), h('span.att-chip-name', a.name), h('button.icon-btn.att-remove', { type: 'button', 'aria-label': `Remove ${a.name}`, onclick: (e) => {
              e.stopPropagation();
              if (a.preview) URL.revokeObjectURL(a.preview);
              cur = atts.filter((x) => x !== a);
              commit(cur.length ? cur : null);
              paint();
              box.focus();
            } }, icon('x', 14)))
            : h('button.att-chip', { type: 'button', onclick: (e) => {
              e.stopPropagation();
              previewAttachment(page, a, atts);
            }, 'aria-label': `Open ${a.name}` }, attachmentThumb(page, a, 56), h('span.att-chip-name', a.name)));
          box.append(h('div.att-strip', atts.map(chip)), h('span.multi-add', icon('plus', 14), atts.length && !form ? 'Add or remove files' : 'Add files'));
          return;
        }
        const ids = Array.isArray(cur) ? cur : cur ? [cur] : [];
        const chips = h('div.chips');
        if (field.type === 'link') {
          for (const rid of ids) chips.append(h('span.chip.record', h('span.chip-label', base.recordName(field.options.tableId, rid))));
        } else {
          for (const cid of ids) {
            const c = field.options.choices.find((x) => x.id === cid);
            if (!c) continue;
            const [bg, fg] = chipColors(c.color);
            chips.append(h('span.chip', { style: { background: bg, color: fg } }, h('span.chip-label', c.name)));
          }
        }
        box.append(chips, h('span.multi-add', icon(ids.length ? 'chevronDown' : 'plus', 14), ids.length ? '' : field.type === 'link' ? 'Add a record' : 'Select an option'));
      };
      paint();
      const open = () => {
        if (field.type === 'link') {
          if (form) {
            openRecordPicker(box, page, table, field, record, {
              get: () => cur || [],
              set: (ids) => {
                cur = ids;
                commit(ids);
                paint();
              },
            });
            return;
          }
          openRecordPicker(box, page, table, field, record, { onClose: () => {
            cur = base.table(table.id).record(record.id)?.c[field.id];
            paint();
          } });
        } else if (field.type === 'attachment') {
          if (form) {
            const fi = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => {
              cur = [...(cur || []), ...[...fi.files].map((f) => ({ id: newId('att'), name: f.name, size: f.size, type: f.type, file: f }))];
              commit(cur);
              paint();
            } });
            document.body.append(fi);
            fi.click();
            setTimeout(() => fi.remove(), 60000);
            return;
          }
          openAttachments(box, page, table, field, record, { onClose: () => {
            cur = base.table(table.id).record(record.id)?.c[field.id];
            paint();
          } });
        } else {
          openChoicePicker(box, base, table, field, {
            selected: Array.isArray(cur) ? cur : cur ? [cur] : [],
            multi: field.type === 'multipleSelect',
            onChange: (ids) => {
              cur = field.type === 'multipleSelect' ? ids : ids[0] || null;
              commit(cur);
              paint();
            },
          });
        }
      };
      box.addEventListener('click', open);
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          open();
        }
      });
      return box;
    }
    case 'date': {
      const wrap = h('div.date-input');
      const input = h('input.input', { type: 'text', id, placeholder: field.options?.includeTime ? 'Date and time' : 'Date', autocomplete: 'off' });
      input.value = value ? formatDate(value, field.options) : '';
      const btn = h('button.icon-btn', { type: 'button', 'aria-label': 'Open calendar' }, icon('fDate', 16));
      const save = () => {
        const t = input.value.trim();
        const v = t ? parseText(field, t) : null;
        if (t && v === null) {
          input.classList.add('invalid');
          return;
        }
        input.classList.remove('invalid');
        commit(v);
        input.value = v ? formatDate(v, field.options) : '';
      };
      input.addEventListener('change', save);
      btn.addEventListener('click', () => {
        const cur = shownDate(parseText(field, input.value), field.options?.gmt);
        const cal = calendar({
          value: cur,
          onPick: (d) => {
            const v = pickedValue(field, d, cur ? cur.getHours() : 9, cur ? cur.getMinutes() : 0);
            input.value = formatDate(v, field.options);
            commit(v);
            pop.close();
          },
        });
        const pop = openPopover(btn, cal.el, { className: 'padded', label: 'Choose a date', focus: false });
        requestAnimationFrame(() => cal.focus());
      });
      wrap.append(input, btn);
      return wrap;
    }
    default: {
      const input = h('input.input', { type: field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : field.type === 'phone' ? 'tel' : 'text', id, autocomplete: 'off' });
      if (['number', 'currency', 'percent', 'duration'].includes(field.type)) input.inputMode = 'decimal';
      input.value = editText(field, value, ctx);
      input.addEventListener('change', () => {
        const t = input.value.trim();
        const v = t ? parseText(field, t) : null;
        if (t && v === null) {
          input.classList.add('invalid');
          input.setAttribute('aria-invalid', 'true');
          return;
        }
        input.classList.remove('invalid');
        input.removeAttribute('aria-invalid');
        commit(v);
        if (!form && v !== null && ['number', 'currency', 'percent'].includes(field.type)) input.value = editText(field, v, ctx);
      });
      if (field.type === 'url' || field.type === 'email' || field.type === 'phone') {
        const wrap = h('div.link-input', input);
        const href = () => {
          const v = input.value.trim();
          if (!v) return null;
          if (field.type === 'email') return `mailto:${v}`;
          if (field.type === 'phone') return `tel:${v.replace(/[^\d+]/g, '')}`;
          return /^https?:\/\//i.test(v) ? v : `https://${v}`;
        };
        const open = h('a.icon-btn', { href: '#', target: '_blank', rel: 'noopener', 'aria-label': field.type === 'email' ? 'Send email' : field.type === 'phone' ? 'Call' : 'Open link', onclick: (e) => {
          const u = href();
          if (!u) e.preventDefault();
          else e.currentTarget.href = u;
        } }, icon(field.type === 'email' ? 'fEmail' : field.type === 'phone' ? 'fPhone' : 'external', 16));
        wrap.append(open);
        return wrap;
      }
      return input;
    }
  }
}

export function autoGrow(ta) {
  const fit = () => {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(480, Math.max(72, ta.scrollHeight + 2))}px`;
  };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
}
