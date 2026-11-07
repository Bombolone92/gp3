/**
 * Views: saved ways of looking at a table. Each keeps its own filters,
 * sorts, groups, hidden fields, field order and widths, plus settings for
 * its type (kanban stacks, calendar dates, gallery covers, form layout).
 */
import { newId } from '../lib/ids.js';

export const VIEW_TYPES = {
  grid: { label: 'Grid', icon: 'vGrid' },
  kanban: { label: 'Kanban', icon: 'vKanban' },
  calendar: { label: 'Calendar', icon: 'vCalendar' },
  gallery: { label: 'Gallery', icon: 'vGallery' },
  timeline: { label: 'Timeline', icon: 'vTimeline' },
  list: { label: 'List', icon: 'vList' },
  form: { label: 'Form', icon: 'vForm' },
};

/** Whether a kanban board can stack by a field: one stack per record. */
export function canStack(f) {
  return !!f && (f.type === 'singleSelect' || f.type === 'checkbox' || (f.type === 'link' && !!f.options?.single));
}

export const VIEW_ORDER = ['grid', 'calendar', 'gallery', 'kanban', 'timeline', 'list', 'form'];

export const ROW_HEIGHTS = {
  short: { label: 'Short', px: 32 },
  medium: { label: 'Medium', px: 56 },
  tall: { label: 'Tall', px: 88 },
  xtall: { label: 'Extra tall', px: 136 },
};

export function emptyFilter() {
  return { conjunction: 'and', conditions: [] };
}

export function createView(table, type = 'grid', name) {
  const fields = table.fields;
  const view = {
    id: newId('viw'),
    name: name || `${VIEW_TYPES[type]?.label || 'Grid'} view`,
    type,
    filters: emptyFilter(),
    sorts: [],
    groups: [],
    hidden: [],
    order: null,
    widths: {},
    frozen: 1,
    rowHeight: 'short',
    color: { type: 'none' },
    summaries: {},
  };
  const firstOf = (...types) => fields.find((f) => types.includes(f.type))?.id || null;
  if (type === 'kanban' || type === 'gallery' || type === 'calendar' || type === 'timeline' || type === 'list') {
    // Cards show the primary field and the next few fields.
    view.hidden = fields.slice(4).map((f) => f.id);
  }
  if (type === 'kanban') {
    view.stackFieldId = firstOf('singleSelect');
    view.coverFieldId = null;
    view.hideEmptyStacks = false;
  }
  if (type === 'gallery') {
    view.coverFieldId = firstOf('attachment');
    view.coverFit = 'cover';
  }
  if (type === 'calendar' || type === 'timeline') {
    view.dateFieldId = firstOf('date', 'createdTime', 'lastModifiedTime');
    view.endFieldId = null;
  }
  if (type === 'timeline') {
    view.scale = 'week';
  }
  if (type === 'form') {
    view.form = {
      title: table.name,
      description: '',
      fields: fields
        .filter((f) => !['formula', 'lookup', 'rollup', 'count', 'autonumber', 'createdTime', 'lastModifiedTime', 'createdBy', 'lastModifiedBy', 'button'].includes(f.type))
        .map((f) => ({ id: f.id, required: f.id === table.schema.primaryFieldId, label: '', help: '' })),
      submitLabel: 'Submit',
      message: 'Thanks for submitting the form.',
      another: true,
    };
  }
  return view;
}

/** Fields in the view's order, primary first; hidden ones included. */
export function orderedFields(table, view) {
  const fields = table.fields;
  const primaryId = table.schema.primaryFieldId;
  let list;
  if (view?.order?.length) {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const seen = new Set();
    list = [];
    for (const id of view.order) {
      const f = byId.get(id);
      if (f && !seen.has(id)) {
        list.push(f);
        seen.add(id);
      }
    }
    for (const f of fields) if (!seen.has(f.id)) list.push(f);
  } else list = fields.slice();
  const pi = list.findIndex((f) => f.id === primaryId);
  if (pi > 0) list.unshift(list.splice(pi, 1)[0]);
  return list;
}

/** Fields shown in the view, in order. The primary field always shows. */
export function visibleFields(table, view) {
  const hidden = new Set(view?.hidden || []);
  const primaryId = table.schema.primaryFieldId;
  return orderedFields(table, view).filter((f) => f.id === primaryId || !hidden.has(f.id));
}

/** Number of conditions; with a predicate, only those that pass it. */
export function countConditions(group, test = () => true) {
  if (!group?.conditions) return 0;
  let n = 0;
  for (const c of group.conditions) n += c.conditions ? countConditions(c, test) : test(c) ? 1 : 0;
  return n;
}

export function newConditionId() {
  return newId('flt');
}
