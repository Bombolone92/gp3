/**
 * Condition and action builders shared by the view, trigger and macro
 * editors. Each row is a small sentence made of selects and inputs:
 * "[Status] [is] [Open]" or "[Assign to] [Ana Ruiz]". Rows can be added and
 * removed with the keyboard; focus moves to a sensible place afterwards.
 */
import { h, clear, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { selectField } from '../ui/components.js';
import { openMenu } from '../ui/popover.js';
import { PLACEHOLDERS } from '../shared/rules.js';
import { app } from '../app.js';
import {
  conditionFields, opsFor, opLabel, valueKind, VALUE_OPTIONS, defaultCondition, reconcileCondition,
  actionFields, actionValueKind, ACTION_OPTIONS, defaultAction,
} from './rules-logic.js';

/** Give a select-like button a hidden label while still reading its value. */
export function labelSelect(btn, text) {
  const labelId = uid('lbl');
  const value = btn.querySelector('.value');
  if (value) {
    value.id ||= uid('val');
    btn.setAttribute('aria-labelledby', `${labelId} ${value.id}`);
  }
  return [h(`span#${labelId}.sr-only`, text), btn];
}

export function customFields() {
  return (app.replica?.cfg?.fields || []).filter((f) => f.active !== false);
}

/** Every custom field, inactive ones too: rules may still use them. */
function allFields() {
  return app.replica?.cfg?.fields || [];
}

/** The menu entry for a field a rule uses but that is no longer offered. */
function unlisted(field, label = (f) => f.title) {
  const def = field.startsWith('field:') ? allFields().find((f) => f.id === field.slice(6)) : null;
  return { value: field, label: def ? `${label(def)} (inactive)` : field.startsWith('field:') ? 'Deleted field' : field };
}

export function names() {
  return {
    agent: (uuid) => app.replica?.members?.[uuid]?.name || null,
    group: (id) => (app.replica?.cfg?.groups || []).find((g) => g.id === id)?.name || null,
    user: (id) => app.replica?.users?.get(Number(id))?.name || null,
    org: (id) => app.replica?.orgs?.get(Number(id))?.name || null,
    field: (id) => (app.replica?.cfg?.fields || []).find((f) => f.id === id) || null,
  };
}

function agentOpts(meLabel) {
  const agents = app.replica ? app.replica.agents() : [];
  return [{ value: 'me', label: meLabel }, ...agents.map((a) => ({ value: a.uuid, label: a.name, keywords: a.username }))];
}

function groupOpts(emptyLabel = 'No group') {
  return [{ value: '', label: emptyLabel }, ...(app.replica?.cfg?.groups || []).map((g) => ({ value: g.id, label: g.name }))];
}

const MISSING = {
  assignee: 'Former agent',
  agent: 'Former agent',
  group: 'Deleted group',
  requester: 'Deleted customer',
  organization: 'Deleted organization',
  'field-option': 'Removed option',
};

/** The value control for a condition or action. */
function valueControl(kind, value, onValue, { label, field, context }) {
  const sel = (options, { pickFirst = true } = {}) => {
    let opts = typeof options === 'function' ? options : () => options;
    const list = opts();
    let current = value;
    if (!list.some((o) => o.value === value)) {
      if (value === undefined || value === null || value === '') {
        // A new row starts from the first choice, unless no choice is a
        // sensible start (a customer): then the admin picks one.
        if (!pickFirst) current = null;
        else {
          current = list[0]?.value;
          if (current !== value) queueMicrotask(() => onValue(current));
        }
      } else {
        // A saved choice that no longer exists (a deactivated agent, a
        // deleted group or customer, a removed option) is kept as it is:
        // rewriting it would silently change the rule on the next save.
        const base = opts;
        const missing = { value, label: MISSING[kind] || String(value) };
        opts = () => [...base(), missing];
      }
    }
    const btn = selectField({ value: current, options: opts, label, onChange: (v) => onValue(v) });
    btn.classList.add('rb-control');
    return labelSelect(btn, label);
  };
  const input = (props) => {
    const id = uid('rbv');
    return [
      h(`label.sr-only`, { for: id }, label),
      h(`input#${id}.input.rb-control`, { ...props, oninput: (e) => onValue(props.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value) }),
    ];
  };
  switch (kind) {
    case 'none':
      return null;
    case 'status':
      return sel(context === 'action' ? ACTION_OPTIONS.status : VALUE_OPTIONS.status);
    case 'priority':
      return sel(VALUE_OPTIONS.priority);
    case 'type':
      return sel(VALUE_OPTIONS.type);
    case 'channel':
      return sel(VALUE_OPTIONS.channel);
    case 'satisfaction':
      return sel(VALUE_OPTIONS.satisfaction);
    case 'actor':
      return sel(VALUE_OPTIONS.actor);
    case 'comment':
      return sel(VALUE_OPTIONS.comment);
    case 'assignee':
      return sel(() => {
        const opts = agentOpts(context === 'view' ? 'The agent viewing it' : context === 'trigger' ? 'The agent making the update' : 'The agent applying it');
        opts.splice(1, 0, { value: '', label: context === 'action' ? 'No one (unassign)' : 'Unassigned' });
        return opts;
      });
    case 'agent':
      return sel(() => agentOpts(context === 'trigger' ? 'The agent making the update' : 'The agent applying it'));
    case 'group':
      return sel(() => groupOpts(context === 'action' ? 'No group' : 'No group'));
    case 'requester':
      return sel(() => [...(app.replica?.users?.values() || [])].sort((a, b) => a.name.localeCompare(b.name)).map((u) => ({ value: u.id, label: u.name, desc: u.email || '', keywords: u.email || '' })), { pickFirst: false });
    case 'organization':
      return sel(() => [{ value: '', label: 'No organization' }, ...[...(app.replica?.orgs?.values() || [])].sort((a, b) => a.name.localeCompare(b.name)).map((o) => ({ value: o.id, label: o.name }))]);
    case 'checkbox':
      return sel([{ value: 'true', label: 'Checked' }, { value: '', label: 'Not checked' }]);
    case 'field-option': {
      const def = allFields().find((f) => f.id === field.slice(6));
      return sel([...(context === 'action' ? [{ value: '', label: 'Clear the field' }] : []), ...(def?.options || []).map((o) => ({ value: o.value, label: o.label }))]);
    }
    case 'hours':
      return h('span.rb-hours', input({ type: 'number', min: 0, step: 1, value: value ?? '', inputmode: 'numeric' }), h('span.rb-suffix', { 'aria-hidden': 'true' }, 'hours'));
    case 'number':
      return input({ type: 'number', value: value ?? '' });
    case 'date':
      return input({ type: 'date', value: value || '' });
    case 'tags':
      return input({ type: 'text', value: Array.isArray(value) ? value.join(' ') : value || '', placeholder: 'billing urgent_words', autocomplete: 'off', spellcheck: 'false' });
    default:
      return input({ type: 'text', value: value ?? '', autocomplete: 'off' });
  }
}

/**
 * Conditions builder. `kind` is 'view' or 'trigger'. Calls onChange with
 * { all, any } after every edit.
 */
export function conditionBuilder({ kind = 'view', value = { all: [], any: [] }, onChange }) {
  const state = {
    all: (value.all || []).map((c) => ({ ...c })),
    any: (value.any || []).map((c) => ({ ...c })),
  };
  const el = h('div.rb-conditions');
  const changed = () => onChange?.(getValue());

  function getValue() {
    return { all: state.all.map((c) => ({ ...c })), any: state.any.map((c) => ({ ...c })) };
  }

  function rowEl(group, c, i) {
    const n = i + 1;
    const groupName = group === 'all' ? 'All' : 'Any';
    const fields = conditionFields(kind, customFields());
    if (!fields.some((f) => f.value === c.field)) fields.push(unlisted(c.field));
    const fieldBtn = selectField({
      value: c.field, options: fields, label: 'Condition field',
      onChange: (v) => {
        state[group][i] = reconcileCondition({ field: v, op: '', value: undefined }, kind, customFields());
        render(`${group}-${i}-op`);
        changed();
      },
    });
    fieldBtn.classList.add('rb-control', 'rb-field');
    const ops = opsFor(c.field, kind).map((op) => ({ value: op, label: opLabel(op) }));
    const opBtn = selectField({
      value: c.op, options: ops, label: 'Operator', search: false,
      onChange: (v) => {
        state[group][i] = reconcileCondition({ ...c, op: v }, kind, allFields());
        render(`${group}-${i}-value`);
        changed();
      },
    });
    opBtn.classList.add('rb-control', 'rb-op');
    opBtn.dataset.focus = `${group}-${i}-op`;
    // A field with a single operator shows it as plain text.
    const opEl = ops.length === 1 ? h('span.rb-op-static', { dataset: { focus: `${group}-${i}-op` }, tabindex: '-1' }, ops[0].label) : labelSelect(opBtn, `${groupName} condition ${n} operator`);
    fieldBtn.dataset.focus = `${group}-${i}-field`;
    const vk = valueKind(c.field, c.op, allFields());
    const valueEl = valueControl(vk, c.value, (v) => {
      state[group][i].value = v;
      changed();
    }, { label: `${groupName} condition ${n} value`, field: c.field, context: kind });
    const wrap = h('div.rb-value', { dataset: { focusWrap: `${group}-${i}-value` } }, valueEl);
    const remove = h('button.icon-btn.rb-remove', {
      type: 'button',
      'aria-label': `Remove ${groupName.toLowerCase()} condition ${n}`,
      title: 'Remove condition',
      dataset: { focus: `${group}-${i}-remove` },
      onclick: () => {
        state[group].splice(i, 1);
        const next = state[group].length ? `${group}-${Math.min(i, state[group].length - 1)}-remove` : `${group}-add`;
        render(next);
        changed();
      },
    }, icon('x', { size: 16 }));
    return h('li.rb-row',
      h('div.rb-sentence', labelSelect(fieldBtn, `${groupName} condition ${n} field`), opEl, wrap),
      remove);
  }

  function groupEl(group) {
    const titles = {
      all: kind === 'view' ? ['Tickets must meet all of these conditions', 'Every condition in this list has to be true.'] : ['Meet all of these conditions', 'Every condition in this list has to be true.'],
      any: ['Meet any of these conditions', 'At least one condition in this list has to be true. Leave it empty to skip.'],
    }[group];
    const headId = uid('rbg');
    const list = h('ol.rb-rows', { 'aria-labelledby': headId });
    state[group].forEach((c, i) => list.append(rowEl(group, c, i)));
    const add = h('button.btn.btn-sm.rb-add', {
      type: 'button',
      dataset: { focus: `${group}-add` },
      onclick: () => {
        const base = state[group].length ? state[group][state[group].length - 1].field : kind === 'trigger' ? 'status' : 'status';
        state[group].push(defaultCondition(base === 'status' && state[group].length ? 'priority' : base, kind, customFields()));
        render(`${group}-${state[group].length - 1}-field`);
        changed();
      },
    }, icon('plus', { size: 14 }), 'Add condition');
    return h(`section.rb-group.rb-${group}`,
      h('div.rb-group-head', h(`h3#${headId}`, titles[0]), h('p.rb-group-desc', titles[1])),
      state[group].length ? list : h('p.rb-empty', group === 'all' ? 'No conditions yet.' : 'No conditions. This list is optional.'),
      add);
  }

  function render(focusKey) {
    clear(el);
    el.append(groupEl('all'), groupEl('any'));
    if (focusKey) {
      const target = el.querySelector(`[data-focus="${focusKey}"]`) || el.querySelector(`[data-focus-wrap="${focusKey}"] input, [data-focus-wrap="${focusKey}"] button`);
      target?.focus();
    }
  }

  render();
  return { el, getValue, focus: () => el.querySelector('button, input')?.focus() };
}

/** A small menu button that inserts placeholders into a text field. */
export function placeholderButton(getTarget, { label = 'Insert placeholder', onInsert } = {}) {
  const btn = h('button.btn.btn-sm.btn-ghost.rb-ph-btn', {
    type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    onclick: () => openMenu(btn, PLACEHOLDERS.map(([code, desc]) => ({
      label: desc, desc: code,
      run: () => {
        const target = getTarget();
        if (onInsert) onInsert(code, target);
        else if (target) insertAtCursor(target, code);
      },
    })), { label: 'Placeholders' }),
  }, icon('code', { size: 14 }), label);
  return btn;
}

export function insertAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  input.focus();
  input.setSelectionRange(start + text.length, start + text.length);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Actions builder. `kind` is 'macro' or 'trigger'. Calls onChange with the
 * list of actions after every edit.
 */
export function actionBuilder({ kind = 'macro', value = [], onChange, emptyText = 'No actions yet.' }) {
  let state = (value || []).map((a) => ({ ...a }));
  const el = h('div.rb-actions');
  const changed = () => onChange?.(getValue());

  function getValue() {
    return state.map((a) => ({ ...a }));
  }

  function emailEditor(a, i) {
    const n = i + 1;
    const toId = uid('to');
    const subjId = uid('subj');
    const bodyId = uid('body');
    let last = null;
    const to = a.field === 'notify_email'
      ? h(`input#${toId}.input`, { type: 'email', value: a.to || '', placeholder: 'team@example.com', autocomplete: 'off', oninput: (e) => { state[i].to = e.target.value.trim(); changed(); } })
      : null;
    const subject = h(`input#${subjId}.input`, { type: 'text', value: a.subject || '', maxlength: 300, oninput: (e) => { state[i].subject = e.target.value; changed(); }, onfocus: (e) => { last = e.target; } });
    const body = h(`textarea#${bodyId}.textarea.rb-body`, { rows: 6, maxlength: 8000, oninput: (e) => { state[i].body = e.target.value; changed(); }, onfocus: (e) => { last = e.target; } }, a.body || '');
    return h('div.rb-email',
      to ? h('div.field', h('label.field-label', { for: toId }, `Action ${n}: send to`), to) : h('p.rb-email-note', icon('mail', { size: 14 }), 'Sent to the requester and the ticket\'s CCs. Customers can unsubscribe from the link in every email.'),
      h('div.field', h('label.field-label', { for: subjId }, 'Email subject'), subject),
      h('div.field', h('div.rb-label-row', h('label.field-label', { for: bodyId }, 'Email body'), placeholderButton(() => last || body)), body,
        h('p.field-hint', 'Plain text. A link to the request in the help center and the request number are added at the end.')));
  }

  function rowEl(a, i) {
    const n = i + 1;
    const fields = actionFields(kind, customFields());
    if (!fields.some((f) => f.value === a.field)) fields.push(unlisted(a.field, (f) => `Set ${f.title}`));
    const fieldBtn = selectField({
      value: a.field, options: fields, label: 'Action',
      onChange: (v) => {
        state[i] = defaultAction(v, customFields());
        render(`a-${i}-value`);
        changed();
      },
    });
    fieldBtn.classList.add('rb-control', 'rb-field');
    fieldBtn.dataset.focus = `a-${i}-field`;
    const vk = actionValueKind(a.field, allFields());
    const valueEl = vk === 'email'
      ? null
      : valueControl(vk, a.value, (v) => {
        state[i].value = v;
        changed();
      }, { label: `Action ${n} value`, field: a.field, context: kind === 'trigger' ? 'trigger' : 'action' });
    const remove = h('button.icon-btn.rb-remove', {
      type: 'button', 'aria-label': `Remove action ${n}`, title: 'Remove action', dataset: { focus: `a-${i}-remove` },
      onclick: () => {
        state.splice(i, 1);
        render(state.length ? `a-${Math.min(i, state.length - 1)}-remove` : 'a-add');
        changed();
      },
    }, icon('x', { size: 16 }));
    return h(`li.rb-row${vk === 'email' ? '.rb-row-email' : ''}`,
      h('div.rb-sentence', labelSelect(fieldBtn, `Action ${n}`), valueEl ? h('div.rb-value', { dataset: { focusWrap: `a-${i}-value` } }, valueEl) : null),
      remove,
      vk === 'email' ? h('div.rb-email-wrap', { dataset: { focusWrap: `a-${i}-value` } }, emailEditor(a, i)) : null);
  }

  function render(focusKey) {
    clear(el);
    const list = h('ol.rb-rows', { 'aria-label': 'Actions' });
    state.forEach((a, i) => list.append(rowEl(a, i)));
    const add = h('button.btn.btn-sm.rb-add', {
      type: 'button', dataset: { focus: 'a-add' },
      onclick: () => {
        const used = new Set(state.map((a) => a.field));
        const next = ['status', 'priority', 'assignee', 'add_tags', 'group', 'type'].find((f) => !used.has(f)) || 'add_tags';
        state.push(defaultAction(next, customFields()));
        render(`a-${state.length - 1}-field`);
        changed();
      },
    }, icon('plus', { size: 14 }), 'Add action');
    el.append(state.length ? list : h('p.rb-empty', emptyText), add);
    if (focusKey) {
      const target = el.querySelector(`[data-focus="${focusKey}"]`) || el.querySelector(`[data-focus-wrap="${focusKey}"] input, [data-focus-wrap="${focusKey}"] button, [data-focus-wrap="${focusKey}"] textarea`);
      target?.focus();
    }
  }

  render();
  return {
    el,
    getValue,
    setValue(v) {
      state = (v || []).map((a) => ({ ...a }));
      render();
    },
  };
}
