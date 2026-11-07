/** Building blocks shared by several screens. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { avatar, pill } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { app, isFamily } from '../app.js';
import { personName, colorFor } from '../core/format.js';
import { formatMoney } from '../core/money.js';
import { TYPE, describe } from '../core/activities.js';
import { formatTime, formatDate, addDays, relativeDay, parseISODate } from '../core/dates.js';
import { fileUrl } from '../files.js';

export const money = (c) => formatMoney(c, app.settings().currency);

/** Fill an <img> with an attachment once it scrolls near the viewport. */
const lazyQueue = new WeakMap();
const io =
  typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            io.unobserve(e.target);
            lazyQueue.get(e.target)?.();
          }
        },
        { rootMargin: '300px' },
      )
    : null;

export function lazyImage(att, { thumb = true, ref, id, alt = '', cls = '' } = {}) {
  const img = h(`img${cls ? '.' + cls : ''}`, { alt, decoding: 'async', width: att.w || null, height: att.h || null });
  const holder = h('span.img-holder', img);
  const load = () =>
    fileUrl(att, { thumb, ref, id })
      .then((url) => {
        img.src = url;
        holder.classList.add('loaded');
      })
      .catch(() => holder.classList.add('missing'));
  if (io) {
    lazyQueue.set(holder, load);
    io.observe(holder);
  } else load();
  return holder;
}

// Types a browser tab shows without running anything. A file's object URL
// belongs to the app's origin, so an HTML or SVG document opened in a tab
// would run its scripts with the signed-in Puter session.
const VIEWABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf']);

/** Open a photo or PDF in a new tab; download anything else. */
export async function openAttachment(att) {
  const type = String(att.type || '').toLowerCase();
  const blob = await (await fetch(await fileUrl(att))).blob();
  // Forced to the allowed type, so a relabeled file cannot be sniffed as a page.
  if (VIEWABLE.has(type)) {
    const url = URL.createObjectURL(new Blob([blob], { type }));
    window.open(url, '_blank', 'noopener');
    // Released once the new tab has had time to load it, as for downloads.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } else saveBlob(blob, att);
}

/** Save an attachment to the device, never rendering it. */
export async function downloadAttachment(att, opts) {
  saveBlob(await (await fetch(await fileUrl(att, opts))).blob(), att);
}

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'application/pdf': 'pdf' };

function saveBlob(blob, att) {
  const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
  // A photo without a name is saved as "photo.jpg", not "file".
  const type = String(att.type || '').toLowerCase();
  const ext = EXTENSIONS[type];
  const name = att.name || `${type.startsWith('image/') ? 'photo' : 'file'}${ext ? `.${ext}` : ''}`;
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function childAvatar(student, { size = '', title } = {}) {
  const name = personName(student);
  const room = student && app.store.get('rooms', student.roomId);
  const node = avatar(name, { color: room?.color || colorFor(student?.id), size, title });
  if (student?.photo) {
    fileUrl(student.photo, { thumb: true })
      .then((url) => node.replaceChildren(h('img', { src: url, alt: '' })))
      .catch(() => {});
  }
  return node;
}

export function staffAvatar(member, { size = '' } = {}) {
  const node = avatar(personName(member), { color: member?.color || colorFor(member?.id), size });
  if (member?.photo) fileUrl(member.photo, { thumb: true }).then((url) => node.replaceChildren(h('img', { src: url, alt: '' }))).catch(() => {});
  return node;
}

export function guardianAvatar(g, { size = '' } = {}) {
  return avatar(personName(g), { color: '#55606e', size });
}

/** "Ava Chen" with avatar and room, linking to the child's page. */
export function childLink(student, { sub = true, href } = {}) {
  if (!student) return h('span.subtle', 'Unknown child');
  const room = app.store.get('rooms', student.roomId);
  return h(
    'a.person-link',
    { href: href || `#/children/${student.id}` },
    childAvatar(student, { size: 'sm' }),
    h('span.person-text', h('span.person-name', personName(student)), sub && room ? h('span.person-sub', room.name) : null),
  );
}

export function roomDot(room) {
  if (!room) return null;
  return h('span.room-dot', { style: { '--room': room.color || '#55606e' } }, room.name);
}

/** The colored tile for an activity type. */
export function typeTile(type, size = 'md') {
  const t = TYPE[type] || TYPE.note;
  return h(`span.type-tile.${size}.tone-${t.tone}`, { 'aria-hidden': 'true' }, icon(t.icon, size === 'lg' ? 26 : size === 'sm' ? 15 : 19));
}

export function staffOnlyBadge() {
  return h('span.badge-private', { title: 'Only staff can see this' }, icon('eye-off', 13), 'Staff only');
}

/**
 * One activity in a feed: type, time, child, description, note, photos.
 * onEdit(record) shows an edit button (staff only).
 */
export function activityCard(a, { showChild = true, onEdit = null, groupCount = 0 } = {}) {
  const t = TYPE[a.type] || TYPE.note;
  const student = app.store.get('students', a.studentId);
  const d = a.details || {};
  const ref = `activities:${a.day}`;
  const extra = [];
  if (a.type === 'incident') {
    if (d.action) extra.push(h('p.act-detail', h('strong', 'Action taken: '), d.action));
    if (d.notified) extra.push(h('p.act-detail', h('strong', 'Family notified: '), d.notified));
  }
  if (a.type === 'meds' && d.time) extra.push(h('p.act-detail', `Given at ${formatTime(d.time)}`));
  return h(
    'article.act-card',
    { dataset: { type: a.type } },
    typeTile(a.type),
    h(
      'div.act-main',
      h(
        'div.act-head',
        h('span.act-type', t.label),
        showChild && student ? h('a.act-child', { href: `#/children/${student.id}` }, personName(student)) : null,
        groupCount > 1 ? h('span.subtle', `+${groupCount - 1} more`) : null,
        a.staffOnly ? staffOnlyBadge() : null,
        h('span.spacer'),
        h('time.act-time', { datetime: `${a.day}T${a.at}` }, formatTime(a.at)),
        onEdit ? h('button.icon-btn.sm', { type: 'button', 'aria-label': `Edit ${t.label.toLowerCase()} entry`, title: 'Edit', onClick: () => onEdit(a) }, icon('pencil', 15)) : null,
      ),
      a.type !== 'note' && a.type !== 'photo' ? h('p.act-desc', describe(a)) : null,
      a.note ? h('p.act-note', a.note) : null,
      extra,
      a.media?.length ? mediaGrid(a.media, { ref, id: a.id }) : null,
      a.by && !isFamily() ? h('p.act-by', `Logged by ${a.by}`) : a.by ? h('p.act-by', a.by) : null,
    ),
  );
}

/** Thumbnails that open in a lightbox. */
export function mediaGrid(media, { ref, id } = {}) {
  const grid = h(`div.media-grid.n${Math.min(media.length, 4)}`);
  media.slice(0, 4).forEach((m, i) => {
    const btn = h(
      'button.media-item',
      { type: 'button', 'aria-label': `Open photo ${i + 1} of ${media.length}`, onClick: () => openLightbox(media, i, { ref, id }) },
      lazyImage(m, { thumb: true, ref, id }),
      i === 3 && media.length > 4 ? h('span.media-more', `+${media.length - 4}`) : null,
    );
    grid.append(btn);
  });
  return grid;
}

export function openLightbox(media, start = 0, { ref, id } = {}) {
  let i = start;
  const img = h('img', { alt: '' });
  const counter = h('span.lightbox-count');
  // A button, not a link to the object URL, which "Open in new tab" would render (an SVG would run its scripts).
  const download = h('button.btn.sm', { type: 'button', onClick: () => downloadAttachment(media[i], { ref, id }).catch(() => {}) }, icon('download', 16), 'Download');
  function show() {
    const m = media[i];
    counter.textContent = media.length > 1 ? `${i + 1} of ${media.length}` : '';
    img.removeAttribute('src');
    img.alt = m.name || 'Photo';
    fileUrl(m, { ref, id })
      .then((url) => (img.src = url))
      .catch(() => (img.alt = 'This photo could not be loaded.'));
  }
  const api = openDialog({
    label: 'Photo',
    size: 'lightbox',
    body: ({ close }) => {
      const prev = h('button.icon-btn.lightbox-nav.prev', { type: 'button', 'aria-label': 'Previous photo', onClick: () => go(-1) }, icon('chevron-left', 24));
      const next = h('button.icon-btn.lightbox-nav.next', { type: 'button', 'aria-label': 'Next photo', onClick: () => go(1) }, icon('chevron-right', 24));
      return h(
        'div.lightbox',
        h('div.lightbox-bar', counter, h('span.spacer'), download, h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onClick: () => close() }, icon('x'))),
        h('div.lightbox-stage', media.length > 1 ? prev : null, img, media.length > 1 ? next : null),
      );
    },
  });
  function go(d) {
    i = (i + d + media.length) % media.length;
    show();
  }
  api.dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  });
  show();
}

/**
 * Previous / today / next and a date input. onChange(isoDate).
 * Days after `max` cannot be chosen.
 */
export function dayNav({ value, onChange, max = null, label = 'Date' }) {
  const input = h('input.input.date-input', { type: 'date', value, max: max || null, 'aria-label': label });
  input.addEventListener('change', () => input.value && onChange(input.value));
  const canNext = !max || value < max;
  return h(
    'div.day-nav',
    h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'Previous day', onClick: () => onChange(addDays(value, -1)) }, icon('chevron-left')),
    h('button.btn.day-label', { type: 'button', onClick: () => input.showPicker?.() }, relativeDay(value, app.today()) === 'Today' ? `Today, ${formatDate(value, { month: 'short', day: 'numeric' })}` : formatDate(value, { weekday: 'short', month: 'short', day: 'numeric' })),
    input,
    h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'Next day', disabled: !canNext || null, onClick: () => onChange(addDays(value, 1)) }, icon('chevron-right')),
    value !== app.today() ? h('button.btn.sm.ghost', { type: 'button', onClick: () => onChange(app.today()) }, 'Today') : null,
  );
}

export function longDate(iso) {
  return formatDate(iso, { weekday: 'long', month: 'long', day: 'numeric' });
}

export function isWeekend(iso) {
  const d = parseISODate(iso).getDay();
  return d === 0 || d === 6;
}

/** Tone pill for a child's attendance state. */
export function attendancePill(state, roomName = '') {
  if (state === 'in') return pill(roomName ? `In ${roomName}` : 'Checked in', 'success');
  if (state === 'out') return pill('Checked out', 'neutral');
  if (state === 'absent') return pill('Absent', 'warning');
  return pill('Not here yet', 'plain');
}

export function sectionEmpty(text, action) {
  return h('div.section-empty', h('p', text), action || null);
}

/** Remember a list's sort per screen. */
export function rememberSort(key, initial) {
  try {
    return JSON.parse(localStorage.getItem(`childcare.sort.${key}`)) || initial;
  } catch {
    return initial;
  }
}

export function saveSort(key, sort) {
  try {
    localStorage.setItem(`childcare.sort.${key}`, JSON.stringify(sort));
  } catch {}
}

/** Remember a small UI choice (selected room, tab). */
export function remember(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(`childcare.ui.${key}`);
    localStorage.setItem(`childcare.ui.${key}`, value);
  } catch {}
  return null;
}
