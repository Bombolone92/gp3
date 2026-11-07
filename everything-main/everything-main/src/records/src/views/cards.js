/**
 * Record cards for kanban, gallery, calendar and list views: the primary
 * field as a title, then the view's visible fields.
 */
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { chipColors, accentColor } from '../lib/colors.js';
import { toText, isEmpty, TYPES } from '../data/fields.js';
import { visibleFields } from '../data/views.js';
import { fileUrl } from '../ui/editors.js';
import { isNum } from '../lib/format.js';
import { compileFilter } from '../data/query.js';

// Images every browser shows, by type or (for files with an odd type such
// as image/x-png) by name. Others (SVG, HEIC, TIFF) show only from a thumbnail.
const SHOWN_TYPE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i;
const SHOWN_NAME = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;
const showable = (a) => !!a.thumb || SHOWN_TYPE.test(a.type || '') || SHOWN_NAME.test(a.name || '');

/** A small read-only rendering of a value (chips, check marks, stars, text). */
export function valueNode(page, table, field, value) {
  const base = page.base;
  const ctx = base.compute.ctx;
  if (value && typeof value === 'object' && !Array.isArray(value) && value.error) return h('span.card-error', value.error);
  switch (field.type) {
    case 'singleSelect':
    case 'multipleSelect': {
      const ids = Array.isArray(value) ? value : value ? [value] : [];
      return h('span.chips', ids.map((id) => {
        const c = field.options.choices.find((x) => x.id === id);
        if (!c) return null;
        const [bg, fg] = chipColors(c.color);
        return h('span.chip', { style: { background: bg, color: fg } }, h('span.chip-label', c.name));
      }));
    }
    case 'link':
      return h('span.chips', (value || []).slice(0, 12).map((id) => h('span.chip.record', h('span.chip-label', base.recordName(field.options.tableId, id)))));
    case 'checkbox':
      return value ? h('span.card-check', { style: { background: accentColor(field.options?.color || 'green') } }, icon('check', 12, { strokeWidth: 3 })) : h('span.card-check.off');
    case 'rating': {
      const max = field.options?.max || 5;
      return h('span.card-rating', { 'aria-label': `${value || 0} of ${max}` }, Array.from({ length: max }, (_, i) => h('span', { style: { color: i < (value || 0) ? accentColor(field.options?.color || 'yellow') : 'var(--border-strong)' } }, icon('star', 12, { fill: i < (value || 0) ? 'currentColor' : 'none' }))));
    }
    case 'attachment':
      return h('span.card-files', (value || []).slice(0, 4).map((a) => {
        const el = h('span.card-file', { title: a.name });
        const ext = () => (el.textContent = (a.name.split('.').pop() || '').slice(0, 4).toUpperCase());
        if (showable(a)) {
          fileUrl(page, a.thumb || a.path).then((u) => {
            if (!u) return;
            const img = h('img', { src: u, alt: '' });
            img.addEventListener('error', ext, { once: true });
            el.replaceChildren(img);
          }).catch(() => {});
        } else ext();
        return el;
      }));
    case 'lookup': {
      const target = base.compute.lookupTarget(field);
      if (target && (target.type === 'singleSelect' || target.type === 'multipleSelect')) return valueNode(page, table, target, (value || []).flat());
      break;
    }
    default:
  }
  const text = toText(field, value, ctx);
  return h(`span.card-text${field.type === 'longText' ? '.long' : ''}${isNum(value) ? '.num' : ''}`, text);
}

/**
 * A card element for a record. opts: { cover (attachment field), fit,
 * fields (override), compact, color }.
 */
export function recordCard(page, table, view, rec, opts = {}) {
  const base = page.base;
  const primary = table.primary;
  const fields = (opts.fields || visibleFields(table, view)).filter((f) => f.id !== primary.id && f.id !== opts.skip);
  const title = base.recordName(table.id, rec.id);
  const card = h('div.card', { tabindex: '0', 'aria-label': title, dataset: { id: rec.id } });
  if (opts.color) card.style.setProperty('--card-accent', accentColor(opts.color));
  if (opts.color) card.classList.add('colored');
  const cover = opts.cover ? table.field(opts.cover) : null;
  if (cover && cover.type === 'attachment') {
    const atts = rec.c[cover.id] || [];
    const box = h(`div.card-cover${opts.fit === 'contain' ? '.contain' : ''}`);
    const first = atts.find(showable);
    const none = () => box.replaceChildren(h('span.card-cover-empty', icon(atts.length ? 'file' : 'image', 22)));
    if (first) {
      const load = () => fileUrl(page, first.thumb || first.path).then((u) => {
        if (!u) return none();
        const img = h('img', { src: u, alt: '', loading: 'lazy', decoding: 'async' });
        img.addEventListener('error', none, { once: true });
        box.replaceChildren(img);
      }).catch(none);
      // With an observer (opts.lazy), covers load as they come near the screen.
      if (opts.lazy) {
        box._load = load;
        opts.lazy.observe(box);
      } else load();
    } else none();
    card.append(box);
  }
  card.append(h('div.card-title', title));
  const list = h('dl.card-fields');
  let shown = 0;
  for (const f of fields) {
    const v = base.compute.value(table, rec, f);
    if (opts.compact && isEmpty(v) && f.type !== 'checkbox') continue;
    list.append(h('div.card-field', h('dt', icon(TYPES[f.type].icon, 12), h('span', f.name)), h('dd', isEmpty(v) && f.type !== 'checkbox' ? h('span.card-empty', '') : valueNode(page, table, f, v))));
    if (++shown >= (opts.max || 12)) break;
  }
  if (shown) card.append(list);
  return card;
}

/** Color for a record from the view's color settings. */
export function cardColorFn(page, table, view) {
  const c = view.color;
  if (!c || c.type === 'none') return () => null;
  if (c.type === 'select') {
    const f = table.field(c.fieldId);
    if (!f) return () => null;
    return (rec) => f.options.choices.find((x) => x.id === rec.c[f.id])?.color || null;
  }
  const rules = (c.rules || []).map((r) => ({ color: r.color, test: compileFilter(page.base, table, r.filter) })).filter((r) => r.test);
  return (rec) => rules.find((r) => r.test(rec))?.color || null;
}
