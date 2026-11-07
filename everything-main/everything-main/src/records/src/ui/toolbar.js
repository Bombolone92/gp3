/**
 * The view toolbar and its panels: hide fields, filter, group, sort, row
 * colors, row height, view settings for cards, calendars and timelines,
 * and sharing (download, print, copy link).
 */
import { h, debounce, fill, keepFocus } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { chipColors, accentColor, HUES } from '../lib/colors.js';
import { TYPES, valueKind, isComputed } from '../data/fields.js';
import { orderedFields, ROW_HEIGHTS, countConditions, newConditionId, emptyFilter, canStack } from '../data/views.js';
import { operatorsFor, defaultOp, NO_VALUE_OPS, DATE_MODES, WITHIN_MODES, FILE_TYPES, isActive } from '../data/query.js';
import { openPopover } from './popover.js';
import { openMenu } from './menu.js';
import { exportCsv, printView } from './exporter.js';
import { sortLabels } from './fieldeditor.js';
import { calendar } from './datepicker.js';
import { formatDate } from '../lib/format.js';
import { toast } from './toast.js';

// The label is the button's name, and its tooltip on narrow screens, where
// only the icon shows.
function toolButton(cls, ic, label, { on = false } = {}) {
  return h(`button.tool-btn.t-${cls}${on ? '.on' : ''}`, { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'data-tip': label, 'aria-label': label }, icon(ic, 16), h('span.tool-label', label));
}

/**
 * Options to choose a field. When the chosen one is not among them (none
 * chosen yet, or deleted), a placeholder shows, so picking the first field
 * is a change.
 */
function fieldOptions(fields, current) {
  const options = fields.map((f) => h('option', { value: f.id, selected: f.id === current }, f.name));
  if (!fields.some((f) => f.id === current)) options.unshift(h('option', { value: '', disabled: true, selected: true }, 'Choose a field'));
  return options;
}

/** Toggle a panel from a toolbar button. */
function panelFrom(btn, build, opts = {}) {
  btn.addEventListener('click', () => {
    if (btn._pop && !btn._pop.closed) {
      btn._pop.close();
      return;
    }
    const content = build();
    btn._pop = openPopover(btn, content, { className: `padded tool-panel${opts.wide ? ' wide' : ''}`, label: opts.label, placement: 'bottom-start', beforeClose: () => content.flush?.() });
  });
  return btn;
}

export function renderToolbar(host, page, table, view) {
  const base = page.base;
  const update = (patch, label) => base.updateView(table.id, view.id, patch, { label });
  const items = [];
  const hiddenCount = (view.hidden || []).filter((id) => table.field(id) && id !== table.schema.primaryFieldId).length;
  const cards = view.type === 'kanban' || view.type === 'gallery' || view.type === 'calendar' || view.type === 'timeline';
  if (view.type === 'form') {
    host.replaceChildren(h('span.muted', { style: { padding: '0 8px' } }, 'Build the form on the left, then open it to fill it in.'));
    return;
  }
  if (view.type === 'kanban') {
    // Only a field the board can stack by (as the board itself shows).
    const f = table.field(view.stackFieldId);
    items.push(panelFrom(toolButton('stack', 'vKanban', canStack(f) ? `Stacked by ${f.name}` : 'Choose a stack field', { on: false }), () => kanbanPanel(page, table, view, update), { label: 'Stack settings' }));
  }
  if (view.type === 'calendar' || view.type === 'timeline') {
    const f = table.field(view.dateFieldId);
    items.push(panelFrom(toolButton('dates', 'fDate', f ? (view.endFieldId && table.field(view.endFieldId) ? `${f.name} to ${table.field(view.endFieldId).name}` : f.name) : 'Choose a date field'), () => datesPanel(page, table, view, update), { label: 'Date settings' }));
  }
  if (view.type === 'gallery') {
    items.push(panelFrom(toolButton('cover', 'image', 'Cover'), () => coverPanel(table, view, update), { label: 'Card cover' }));
  }
  items.push(panelFrom(toolButton('hide', cards ? 'layers' : 'eyeOff', cards ? 'Customize cards' : hiddenCount ? `${hiddenCount} hidden field${hiddenCount === 1 ? '' : 's'}` : 'Hide fields', { on: !cards && !!hiddenCount }), () => hidePanel(page, table, view, update, cards), { label: cards ? 'Fields on cards' : 'Hide fields' }));
  const nFilter = countConditions(view.filters, isActive);
  items.push(panelFrom(toolButton('filter', 'filter', nFilter ? `Filtered by ${filterSummary(table, view)}` : 'Filter', { on: !!nFilter }), () => filterPanel(page, table, view, update), { label: 'Filter', wide: true }));
  if (view.type === 'grid' || view.type === 'list') {
    const nGroup = view.groups?.length || 0;
    items.push(panelFrom(toolButton('group', 'group', nGroup ? `Grouped by ${nGroup} field${nGroup === 1 ? '' : 's'}` : 'Group', { on: !!nGroup }), () => levelsPanel(page, table, view, update, 'groups'), { label: 'Group' }));
  }
  if (view.type !== 'calendar') {
    const nSort = view.sorts?.length || 0;
    items.push(panelFrom(toolButton('sort', 'arrowUpDown', nSort ? `Sorted by ${nSort} field${nSort === 1 ? '' : 's'}` : 'Sort', { on: !!nSort }), () => levelsPanel(page, table, view, update, 'sorts'), { label: 'Sort' }));
  }
  if (view.type === 'grid' || view.type === 'list' || view.type === 'kanban' || view.type === 'calendar' || view.type === 'timeline' || view.type === 'gallery') {
    const on = view.color && view.color.type !== 'none';
    items.push(panelFrom(toolButton('color', 'color', 'Color', { on }), () => colorPanel(page, table, view, update), { label: 'Record colors', wide: true }));
  }
  if (view.type === 'grid') {
    const rh = h('button.tool-btn', { type: 'button', 'aria-label': `Row height: ${ROW_HEIGHTS[view.rowHeight || 'short'].label}`, 'data-tip': 'Row height', 'aria-haspopup': 'menu' }, icon('rowHeight', 16));
    rh.addEventListener('click', () => openMenu(rh, Object.entries(ROW_HEIGHTS).map(([k, v]) => ({ label: v.label, checked: (view.rowHeight || 'short') === k, radio: true, onSelect: () => update({ rowHeight: k }, 'Row height') })), { label: 'Row height' }));
    items.push(rh);
  }
  const share = h('button.tool-btn', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'Share', 'data-tip': 'Share' }, icon('share', 16), h('span.tool-label', 'Share'));
  share.addEventListener('click', () => openMenu(share, [
    { label: 'Download CSV', icon: 'download', description: 'The records and fields this view shows.', onSelect: () => exportCsv(base, table, view) },
    { label: 'Print view', icon: 'printer', onSelect: () => printView(base, table, view) },
    { label: 'Copy link to this view', icon: 'link', description: 'Opens this view for you on any device.', onSelect: () => navigator.clipboard.writeText(location.href.split('#')[0] + `#/${page.baseId}/${table.id}/${view.id}`).then(() => toast('Link copied'), () => toast('Could not copy the link.', { error: true })) },
  ], { label: 'Share and export', width: 300 }));
  items.push(share);
  // An edit in an open panel redraws the toolbar: the panel stays with its button.
  for (const btn of items) {
    const kind = [...btn.classList].find((c) => c.startsWith('t-'));
    const old = kind && host.querySelector(`.tool-btn.${kind}`);
    if (old?._pop && !old._pop.closed) {
      btn._pop = old._pop;
      btn._pop.reanchor(btn);
    }
  }
  host.replaceChildren(...items);
}

function filterSummary(table, view) {
  const names = [];
  const walk = (g) => {
    for (const c of g?.conditions || []) {
      if (c.conditions) walk(c);
      else if (isActive(c)) {
        const f = table.field(c.fieldId);
        if (f && !names.includes(f.name)) names.push(f.name);
      }
    }
  };
  walk(view.filters);
  if (names.length === 1) return names[0];
  return `${names.length} fields`;
}

/* ------------------------------------------------------------ hide fields */

function hidePanel(page, table, view, update, cards) {
  const primary = table.schema.primaryFieldId;
  const search = h('input.input', { type: 'search', placeholder: 'Find a field', 'aria-label': 'Find a field' });
  const list = h('ul.hide-list');
  let dragId = null;
  const paint = () => {
    const q = search.value.trim().toLowerCase();
    const hidden = new Set(view.hidden || []);
    list.replaceChildren();
    for (const f of orderedFields(table, view)) {
      if (f.id === primary && !cards) continue;
      if (q && !f.name.toLowerCase().includes(q)) continue;
      const cb = h('input.switch', { type: 'checkbox', role: 'switch', checked: !hidden.has(f.id), 'aria-label': `Show ${f.name}`, disabled: f.id === primary, onchange: () => {
        const set = new Set(view.hidden || []);
        if (cb.checked) set.delete(f.id);
        else set.add(f.id);
        // The switch already shows the change: redrawing would take its focus.
        update({ hidden: [...set] }, cb.checked ? 'Show field' : 'Hide field');
      } });
      const li = h('li.hide-item', { draggable: 'true' }, h('span.choice-grip', { 'aria-hidden': 'true' }, icon('grip', 14)), h('label.switch-row.grow', cb, icon(TYPES[f.type].icon, 14), h('span.grow', f.name)));
      li.addEventListener('dragstart', (e) => {
        dragId = f.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', f.name);
      });
      li.addEventListener('dragover', (e) => e.preventDefault());
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!dragId || dragId === f.id || f.id === primary) return;
        const ids = orderedFields(table, view).map((x) => x.id).filter((x) => x !== dragId);
        ids.splice(ids.indexOf(f.id), 0, dragId);
        update({ order: ids }, 'Reorder fields');
        dragId = null;
        paint();
      });
      list.append(li);
    }
  };
  search.addEventListener('input', paint);
  paint();
  const all = (show) => update({ hidden: show ? [] : table.fields.filter((f) => f.id !== primary).map((f) => f.id) }, show ? 'Show all fields' : 'Hide all fields');
  return h('div.hide-panel', search, list, h('div.popover-footer', h('button.btn.small', { type: 'button', onclick: () => {
    all(false);
    paint();
  } }, 'Hide all'), h('button.btn.small', { type: 'button', onclick: () => {
    all(true);
    paint();
  } }, 'Show all')));
}

/* ----------------------------------------------------------------- filter */

function filterPanel(page, table, view, update) {
  const base = page.base;
  const host = h('div.filter-panel');
  // Edits happen on a working copy and are saved with a short delay, so
  // typing in a value does not create an undo step per keystroke.
  let filters = structuredClone(view.filters || emptyFilter());
  const commit = () => {
    // The view can go (deleted, or undone) while the panel is open.
    if (base.table(table.id)?.view(view.id)) update({ filters: structuredClone(filters) }, 'Filter');
  };
  const save = debounce(commit, 350);
  const saveNow = () => {
    save.cancel();
    commit();
  };
  // Closing the panel saves a value typed just before.
  host.flush = () => save.flush();

  const fieldSelect = (cond, onChange) => {
    const s = h('select.select', { 'aria-label': 'Field', onchange: () => onChange(s.value) }, fieldOptions(table.fields, cond.fieldId));
    return s;
  };

  const valueEditor = (cond) => {
    const field = table.field(cond.fieldId);
    if (!field || NO_VALUE_OPS.has(cond.op)) return h('span.filter-value-empty');
    const kind = valueKind(field, base.compute.ctx);
    const set = (v, now = false) => {
      cond.value = v;
      if (now) saveNow();
      else save();
    };
    if (kind === 'checkbox') {
      const cb = h('input', { type: 'checkbox', checked: !!cond.value, 'aria-label': 'Checked', onchange: () => set(cb.checked, true) });
      if (cond.value === null || cond.value === undefined) cond.value = false;
      return h('label.check.filter-value', cb, h('span', 'Checked'));
    }
    if (kind === 'select' && field.type === 'singleSelect' && (cond.op === 'is' || cond.op === 'isNot')) {
      const s = h('select.select.filter-value', { 'aria-label': 'Value', onchange: () => set(s.value || null, true) }, h('option', { value: '' }, 'Select an option'), field.options.choices.map((c) => h('option', { value: c.id, selected: cond.value === c.id }, c.name)));
      return s;
    }
    if ((kind === 'select' && field.type === 'singleSelect') || (kind === 'multi' && field.type === 'multipleSelect')) {
      const ids = Array.isArray(cond.value) ? cond.value : cond.value ? [cond.value] : [];
      const btn = h('button.select.filter-value.multi-btn', { type: 'button', 'aria-haspopup': 'menu' });
      const paint = () => {
        const cur = Array.isArray(cond.value) ? cond.value : [];
        btn.replaceChildren(...(cur.length ? cur.map((id) => {
          const c = field.options.choices.find((x) => x.id === id);
          if (!c) return null;
          const [bg, fg] = chipColors(c.color);
          return h('span.chip', { style: { background: bg, color: fg } }, c.name);
        }).filter(Boolean) : [h('span.muted', 'Select options')]));
      };
      cond.value = ids;
      paint();
      btn.addEventListener('click', () => openMenu(btn, () => field.options.choices.map((c) => ({
        label: c.name,
        checked: (cond.value || []).includes(c.id),
        keepOpen: true,
        onSelect: () => {
          const cur = cond.value || [];
          set(cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id], true);
          paint();
        },
      })), { search: field.options.choices.length > 8, label: field.name }));
      return btn;
    }
    if (kind === 'date') {
      const wrap = h('div.filter-value.date-filter');
      const modes = cond.op === 'isWithin' ? WITHIN_MODES : DATE_MODES;
      if (!cond.value || typeof cond.value !== 'object' || !(cond.value.mode in modes)) cond.value = { mode: cond.op === 'isWithin' ? 'pastWeek' : 'today' };
      const modeSel = h('select.select', { 'aria-label': 'Date', onchange: () => {
        cond.value = { mode: modeSel.value };
        saveNow();
        render();
      } }, Object.entries(modes).map(([k, l]) => h('option', { value: k, selected: cond.value.mode === k }, l)));
      wrap.append(modeSel);
      const m = cond.value.mode;
      if (m === 'daysAgo' || m === 'daysFromNow' || m === 'pastDays' || m === 'nextDays') {
        const n = h('input.input.small-num', { type: 'number', min: '0', value: cond.value.n ?? '', 'aria-label': 'Number of days', oninput: () => set({ ...cond.value, n: n.value === '' ? null : Number(n.value) }) });
        wrap.append(n);
      }
      if (m === 'exactDate') {
        const btn = h('button.select', { type: 'button' }, cond.value.date ? formatDate(cond.value.date, { dateFormat: 'local' }) : 'Pick a date');
        btn.addEventListener('click', () => {
          const cal = calendar({ value: cond.value.date, onPick: (d) => {
            set({ mode: 'exactDate', date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }, true);
            pop.close();
            render();
          } });
          const pop = openPopover(btn, cal.el, { className: 'padded', label: 'Pick a date', focus: false });
          requestAnimationFrame(() => cal.focus());
        });
        wrap.append(btn);
      }
      return wrap;
    }
    if (field.type === 'attachment' && cond.op === 'hasFileType') {
      const s = h('select.select.filter-value', { 'aria-label': 'File type', onchange: () => set(s.value, true) }, h('option', { value: '' }, 'Choose a type'), Object.entries(FILE_TYPES).map(([k, l]) => h('option', { value: k, selected: cond.value === k }, l)));
      return s;
    }
    const input = h('input.input.filter-value', { type: kind === 'number' ? 'text' : 'text', inputMode: kind === 'number' ? 'decimal' : 'text', placeholder: 'Enter a value', 'aria-label': 'Value', value: cond.value ?? '' });
    input.addEventListener('input', () => set(input.value));
    return input;
  };

  const conditionRow = (cond, group, i, depth) => {
    const field = table.field(cond.fieldId);
    const ops = field ? operatorsFor(field, base.compute.ctx) : [];
    const opSel = h('select.select', { 'aria-label': 'Operator', onchange: () => {
      const wasNoValue = NO_VALUE_OPS.has(cond.op);
      const prevOp = cond.op;
      cond.op = opSel.value;
      const multiOps = ['isAnyOf', 'isNoneOf'];
      if (wasNoValue || NO_VALUE_OPS.has(cond.op) || multiOps.includes(prevOp) !== multiOps.includes(cond.op) || prevOp === 'isWithin' || cond.op === 'isWithin' || prevOp === 'hasFileType' || cond.op === 'hasFileType') cond.value = null;
      saveNow();
      render();
    } }, ops.map(([k, l]) => h('option', { value: k, selected: cond.op === k }, l)));
    const lead = i === 0 ? h('span.filter-lead', 'Where') : i === 1 ? conjSelect(group) : h('span.filter-lead', group.conjunction === 'or' ? 'or' : 'and');
    return h('div.filter-row', lead, fieldSelect(cond, (fid) => {
      cond.fieldId = fid;
      cond.op = defaultOp(table.field(fid), base.compute.ctx);
      cond.value = null;
      saveNow();
      render();
    }), opSel, valueEditor(cond), h('button.icon-btn', { type: 'button', 'aria-label': 'Remove condition', onclick: () => {
      group.conditions.splice(i, 1);
      saveNow();
      render();
    } }, icon('trash', 14)));
    void depth;
  };

  const conjSelect = (group) => {
    const s = h('select.select.conj', { 'aria-label': 'Match', onchange: () => {
      group.conjunction = s.value;
      saveNow();
      render();
    } }, h('option', { value: 'and', selected: group.conjunction !== 'or' }, 'and'), h('option', { value: 'or', selected: group.conjunction === 'or' }, 'or'));
    return s;
  };

  const newCondition = () => {
    const f = table.primary;
    return { id: newConditionId(), fieldId: f.id, op: defaultOp(f, base.compute.ctx), value: null };
  };

  const groupBlock = (group, depth) => {
    const rows = h('div.filter-rows');
    group.conditions.forEach((c, i) => {
      if (c.conditions) {
        const lead = i === 0 ? h('span.filter-lead', 'Where') : i === 1 ? conjSelect(group) : h('span.filter-lead', group.conjunction === 'or' ? 'or' : 'and');
        rows.append(h('div.filter-row.nested', lead, h('div.filter-group', groupBlock(c, depth + 1), h('button.icon-btn.group-remove', { type: 'button', 'aria-label': 'Remove condition group', onclick: () => {
          group.conditions.splice(i, 1);
          saveNow();
          render();
        } }, icon('trash', 14)))));
      } else rows.append(conditionRow(c, group, i, depth));
    });
    const add = h('div.filter-add',
      h('button.link-btn', { type: 'button', onclick: () => {
        group.conditions.push(newCondition());
        saveNow();
        render();
      } }, icon('plus', 14), 'Add condition'),
      depth === 0 ? h('button.link-btn.muted', { type: 'button', onclick: () => {
        group.conditions.push({ id: newConditionId(), conjunction: 'and', conditions: [newCondition()] });
        saveNow();
        render();
      } }, icon('plus', 14), 'Add condition group') : null);
    return h('div', rows, add);
  };

  function render() {
    keepFocus(host, () => host.replaceChildren(
      filters.conditions.length ? h('p.panel-intro', 'In this view, show records') : h('p.panel-intro.muted', 'No filter conditions are applied to this view.'),
      groupBlock(filters, 0),
    ));
  }

  render();
  return host;
}

/* ----------------------------------------------------------- sort, group */

function levelsPanel(page, table, view, update, key) {
  const base = page.base;
  const host = h('div.levels-panel');
  const usable = (f) => key === 'sorts' || !['attachment', 'button', 'longText'].includes(f.type);
  const render = () => keepFocus(host, () => {
    const levels = view[key] || [];
    fill(host,
      levels.length ? null : h('p.panel-intro.muted', key === 'sorts' ? 'Choose a field to sort by.' : 'Choose a field to group by.'),
      h('div.level-rows', levels.map((lv, i) => {
        const field = table.field(lv.fieldId);
        const s = h('select.select', { 'aria-label': key === 'sorts' ? `Sort field ${i + 1}` : `Group field ${i + 1}`, onchange: () => {
          const next = levels.map((x) => ({ ...x }));
          next[i].fieldId = s.value;
          update({ [key]: next }, key === 'sorts' ? 'Sort' : 'Group');
          render();
        } }, table.fields.filter(usable).map((f) => h('option', { value: f.id, selected: f.id === lv.fieldId }, f.name)));
        const [asc, desc] = field ? sortLabels(field, base.compute.ctx) : ['A → Z', 'Z → A'];
        const dir = h('div.segmented', { role: 'radiogroup', 'aria-label': 'Direction' },
          ...[['asc', asc], ['desc', desc]].map(([d, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String((lv.dir || 'asc') === d), onclick: () => {
            const next = levels.map((x) => ({ ...x }));
            next[i].dir = d;
            update({ [key]: next }, key === 'sorts' ? 'Sort' : 'Group');
            render();
          } }, l)));
        return h('div.level-row', h('span.filter-lead', i === 0 ? (key === 'sorts' ? 'Sort by' : 'Group by') : 'then by'), s, dir, h('button.icon-btn', { type: 'button', 'aria-label': 'Remove', onclick: () => {
          update({ [key]: levels.filter((_, k) => k !== i) }, key === 'sorts' ? 'Sort' : 'Group');
          render();
        } }, icon('x', 14)));
      })),
      (key === 'groups' && levels.length >= 3) ? null : (() => {
        const add = h('button.link-btn', { type: 'button', 'aria-haspopup': 'menu' }, icon('plus', 14), key === 'sorts' ? 'Add a sort' : 'Add a group');
        add.addEventListener('click', () => openMenu(add, table.fields.filter(usable).filter((f) => !levels.some((l) => l.fieldId === f.id)).map((f) => ({ label: f.name, icon: TYPES[f.type].icon, onSelect: () => {
          update({ [key]: [...levels, { fieldId: f.id, dir: 'asc' }] }, key === 'sorts' ? 'Sort' : 'Group');
          render();
        } })), { search: true, searchPlaceholder: 'Find a field', label: 'Fields' }));
        return h('div.filter-add', add);
      })(),
      key === 'groups' && levels.length ? h('div.popover-footer', h('button.btn.small', { type: 'button', onclick: () => update({ collapsed: collectPaths(page, view) }, 'Collapse groups') }, 'Collapse all'), h('button.btn.small', { type: 'button', onclick: () => update({ collapsed: [] }, 'Expand groups') }, 'Expand all')) : null,
    );
  });
  render();
  return host;
}

function collectPaths(page) {
  const tree = page.viewInst?.result?.tree;
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes || []) {
      out.push(n.path);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/* ------------------------------------------------------------------ color */

function colorPanel(page, table, view, update) {
  const host = h('div.color-panel');
  const selects = table.fields.filter((f) => f.type === 'singleSelect');
  const render = () => keepFocus(host, () => {
    const c = view.color || { type: 'none' };
    const mode = h('div.segmented', { role: 'radiogroup', 'aria-label': 'Color records' },
      ...[['none', 'None'], ['select', 'By option'], ['conditions', 'By conditions']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(c.type === k), onclick: () => {
        if (k === 'select') update({ color: { type: 'select', fieldId: selects[0]?.id || null } }, 'Color');
        else if (k === 'conditions') update({ color: { type: 'conditions', rules: c.rules || [] } }, 'Color');
        else update({ color: { type: 'none' } }, 'Color');
        render();
      } }, l)));
    const body = [];
    if (c.type === 'select') {
      if (!selects.length) body.push(h('p.field-hint', 'Add a single select field to color records by its options.'));
      else body.push(h('div.form-row', h('label.field-label', 'Field'), (() => {
        const s = h('select.select', { 'aria-label': 'Color field', onchange: () => update({ color: { type: 'select', fieldId: s.value } }, 'Color') }, fieldOptions(selects, c.fieldId));
        return s;
      })()), h('p.field-hint', 'Records take the color of their option.'));
    }
    if (c.type === 'conditions') {
      const rules = c.rules || [];
      body.push(h('div.color-rules', rules.map((r, i) => {
        const sw = h('button.swatch', { type: 'button', 'aria-label': `Color: ${r.color}`, style: { background: accentColor(r.color) } });
        sw.addEventListener('click', () => {
          const grid = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Color' }, HUES.map((hue) => h('button.swatch', { type: 'button', role: 'radio', 'aria-checked': String(r.color === hue), 'aria-label': hue, style: { background: accentColor(hue) }, onclick: () => {
            const next = structuredClone(rules);
            next[i].color = hue;
            update({ color: { type: 'conditions', rules: next } }, 'Color');
            pop.close();
            render();
          } })));
          const pop = openPopover(sw, grid, { className: 'padded', label: 'Rule color' });
        });
        const cond = r.filter?.conditions?.[0];
        const f = cond && table.field(cond.fieldId);
        const desc = f ? `${f.name} ${operatorsFor(f, page.base.compute.ctx).find(([k]) => k === cond.op)?.[1] || ''} ${describeValue(f, cond)}` : 'Any record';
        const edit = h('button.btn.small.ghost.rule-edit', { type: 'button' }, desc.trim(), icon('chevronDown', 12));
        edit.addEventListener('click', () => {
          // A rule's conditions use the same builder as filters.
          const fake = { ...view, filters: structuredClone(r.filter || emptyFilter()) };
          const panel = filterPanel(page, table, fake, (patch) => {
            const next = structuredClone(view.color.rules);
            next[i].filter = patch.filters;
            update({ color: { type: 'conditions', rules: next } }, 'Color');
          });
          const pop = openPopover(edit, panel, { className: 'padded tool-panel wide', label: 'Rule conditions', beforeClose: () => {
            panel.flush();
            // Redrawn with the new conditions; focus returns to the rule's new button.
            render();
            const again = host.querySelectorAll('.color-rule')[i]?.querySelector('.rule-edit');
            if (again) pop.reanchor(again);
          } });
        });
        return h('div.color-rule', sw, edit, h('button.icon-btn', { type: 'button', 'aria-label': 'Remove rule', onclick: () => {
          update({ color: { type: 'conditions', rules: rules.filter((_, k) => k !== i) } }, 'Color');
          render();
        } }, icon('x', 14)));
      })), h('div.filter-add', h('button.link-btn', { type: 'button', onclick: () => {
        const used = rules.map((r) => r.color);
        const color = HUES.find((x) => !used.includes(x)) || 'blue';
        const f = table.primary;
        update({ color: { type: 'conditions', rules: [...rules, { id: newConditionId(), color, filter: { conjunction: 'and', conditions: [{ id: newConditionId(), fieldId: f.id, op: defaultOp(f, page.base.compute.ctx), value: null }] } }] } }, 'Color');
        render();
      } }, icon('plus', 14), 'Add a color rule')), h('p.field-hint', 'The first matching rule colors a record.'));
    }
    host.replaceChildren(mode, ...body);
  });
  render();
  return host;
}

function describeValue(field, cond) {
  if (NO_VALUE_OPS.has(cond.op)) return '';
  const v = cond.value;
  if (v === null || v === undefined || v === '') return '...';
  if (field.type === 'singleSelect' || field.type === 'multipleSelect') {
    const ids = Array.isArray(v) ? v : [v];
    return ids.map((id) => field.options.choices.find((c) => c.id === id)?.name).filter(Boolean).join(', ');
  }
  if (typeof v === 'object' && v.mode) return v.mode === 'exactDate' ? v.date : (DATE_MODES[v.mode] || WITHIN_MODES[v.mode] || '');
  if (typeof v === 'boolean') return v ? 'checked' : 'unchecked';
  return String(v);
}

/* ---------------------------------------------------- card view settings */

function kanbanPanel(page, table, view, update) {
  const stackable = table.fields.filter(canStack);
  const s = h('select.select', { 'aria-label': 'Stack by', onchange: () => update({ stackFieldId: s.value }, 'Stack by') }, fieldOptions(stackable, view.stackFieldId));
  const empty = h('input.switch', { type: 'checkbox', role: 'switch', checked: !!view.hideEmptyStacks, onchange: () => update({ hideEmptyStacks: empty.checked }, 'Hide empty stacks') });
  const attachments = table.fields.filter((f) => f.type === 'attachment');
  const cover = h('select.select', { 'aria-label': 'Card cover', onchange: () => update({ coverFieldId: cover.value || null }, 'Card cover') }, h('option', { value: '' }, 'No cover'), attachments.map((f) => h('option', { value: f.id, selected: f.id === view.coverFieldId }, f.name)));
  return h('div',
    stackable.length ? h('div.form-row', h('label.field-label', 'Stack records by'), s) : h('p.field-hint', 'Add a single select or checkbox field to stack records by.'),
    h('label.switch-row', empty, h('span.grow', 'Hide empty stacks')),
    h('div.form-row', { style: { marginTop: '10px' } }, h('label.field-label', 'Card cover'), cover));
}

function datesPanel(page, table, view, update) {
  // Formulas count when they give dates (a number would read as a 1970 date).
  const dates = table.fields.filter((f) => ['date', 'createdTime', 'lastModifiedTime'].includes(f.type) || (f.type === 'formula' && page.base.compute.formulaKind(f) === 'date'));
  const start = h('select.select', { 'aria-label': 'Start date', onchange: () => update({ dateFieldId: start.value }, 'Date field') }, fieldOptions(dates, view.dateFieldId));
  const end = h('select.select', { 'aria-label': 'End date', onchange: () => update({ endFieldId: end.value || null }, 'End date field') }, h('option', { value: '' }, 'None (single day)'), dates.filter((f) => !isComputed(f) || f.type === 'formula').map((f) => h('option', { value: f.id, selected: f.id === view.endFieldId }, f.name)));
  const parts = [
    dates.length ? h('div.form-row', h('label.field-label', 'Start date'), start) : h('p.field-hint', 'Add a date field to place records on the calendar.'),
    dates.length ? h('div.form-row', h('label.field-label', 'End date'), end) : null,
  ];
  if (view.type === 'timeline') {
    const scale = h('select.select', { 'aria-label': 'Scale', onchange: () => update({ scale: scale.value }, 'Timeline scale') }, [['day', 'Days'], ['week', 'Weeks'], ['month', 'Months'], ['quarter', 'Quarters']].map(([k, l]) => h('option', { value: k, selected: (view.scale || 'week') === k }, l)));
    parts.push(h('div.form-row', h('label.field-label', 'Scale'), scale));
  }
  return h('div', ...parts);
}

function coverPanel(table, view, update) {
  const attachments = table.fields.filter((f) => f.type === 'attachment');
  const cover = h('select.select', { 'aria-label': 'Cover field', onchange: () => update({ coverFieldId: cover.value || null }, 'Card cover') }, h('option', { value: '' }, 'No cover'), attachments.map((f) => h('option', { value: f.id, selected: f.id === view.coverFieldId }, f.name)));
  const fit = h('div.segmented', { role: 'radiogroup', 'aria-label': 'Image fit' }, ...[['cover', 'Crop'], ['contain', 'Fit']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String((view.coverFit || 'cover') === k), onclick: (e) => {
    update({ coverFit: k }, 'Cover fit');
    e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b === e.currentTarget)));
  } }, l)));
  return h('div', h('div.form-row', h('label.field-label', 'Cover image'), cover), attachments.length ? h('div.form-row', h('label.field-label', 'Image'), fit) : h('p.field-hint', 'Add an attachment field to show images on cards.'));
}
