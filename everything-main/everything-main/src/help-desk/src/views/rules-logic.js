/**
 * Pure helpers behind the rule editors in Admin: which condition fields and
 * actions each kind of rule offers, sensible defaults for a new row, plain
 * language descriptions of conditions and actions, and client-side checks
 * that match what the server accepts. No DOM and no app state, so they are
 * easy to test.
 */
import {
  STATUSES, STATUS_LABEL, SUBMIT_STATUSES, PRIORITIES, PRIORITY_LABEL, TYPES, TYPE_LABEL, CHANNELS, CHANNEL_LABEL,
  normTag, normTags, isEmail,
} from '../shared/model.js';
import { CONDITION_FIELDS, OP_LABEL } from '../shared/rules.js';
import { randomId } from '../shared/ids.js';

export const newId = () => randomId(8);

/** Fields and operators only meaningful while an update is happening. */
const TRIGGER_ONLY_FIELDS = new Set(['actor', 'comment']);
const TRIGGER_ONLY_OPS = new Set(['changed_to', 'changed']);

export const FIELD_OPS = ['is', 'is_not', 'present', 'absent'];
const EXTRA_OP_LABEL = { present: 'Is filled in', absent: 'Is empty' };

export function opLabel(op) {
  return OP_LABEL[op] || EXTRA_OP_LABEL[op] || op;
}

/** Condition fields offered by a rule kind ('view' or 'trigger'). */
export function conditionFields(kind, customFields = []) {
  const out = [];
  for (const [value, def] of Object.entries(CONDITION_FIELDS)) {
    if (kind !== 'trigger' && TRIGGER_ONLY_FIELDS.has(value)) continue;
    out.push({ value, label: def.label });
  }
  for (const f of customFields) out.push({ value: `field:${f.id}`, label: f.title, custom: true });
  return out;
}

export function opsFor(field, kind = 'view') {
  const ops = field.startsWith('field:') ? FIELD_OPS : CONDITION_FIELDS[field]?.ops || ['is'];
  return ops.filter((op) => kind === 'trigger' || !TRIGGER_ONLY_OPS.has(op));
}

/** What kind of value control a condition needs. */
export function valueKind(field, op, customFields = []) {
  if (op === 'changed' || op === 'includes_me' || op === 'present' || op === 'absent') return 'none';
  if (field.startsWith('field:')) {
    const def = customFields.find((f) => f.id === field.slice(6));
    if (!def) return 'text';
    if (def.type === 'dropdown') return 'field-option';
    if (def.type === 'checkbox') return 'checkbox';
    if (def.type === 'number') return 'number';
    if (def.type === 'date') return 'date';
    return 'text';
  }
  switch (field) {
    case 'status': return 'status';
    case 'priority': return 'priority';
    case 'type': return 'type';
    case 'assignee': return 'assignee';
    case 'group': return 'group';
    case 'requester': return 'requester';
    case 'organization': return 'organization';
    case 'channel': return 'channel';
    case 'tags': return 'tags';
    case 'subject': return 'text';
    case 'created':
    case 'updated':
    case 'solved': return 'hours';
    case 'satisfaction': return 'satisfaction';
    case 'actor': return 'actor';
    case 'comment': return 'comment';
    default: return 'text';
  }
}

/** Static option lists for the value controls that need no app data. */
export const VALUE_OPTIONS = {
  status: STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
  priority: [{ value: '', label: 'No priority' }, ...PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))],
  type: [{ value: '', label: 'No type' }, ...TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))],
  channel: CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] })),
  satisfaction: [{ value: 'good', label: 'Rated good' }, { value: 'bad', label: 'Rated bad' }, { value: 'unrated', label: 'Not rated' }],
  actor: [{ value: 'agent', label: 'An agent' }, { value: 'customer', label: 'The customer' }],
  comment: [{ value: 'public', label: 'Is a public reply' }, { value: 'private', label: 'Is an internal note' }, { value: 'present', label: 'Was added' }, { value: 'absent', label: 'Was not added' }],
};

/** A value that is valid for the field and operator. */
export function defaultValue(field, op, customFields = []) {
  const kind = valueKind(field, op, customFields);
  switch (kind) {
    case 'none': return '';
    case 'status': return op === 'less_than' ? 'solved' : op === 'greater_than' ? 'open' : 'open';
    case 'priority': return op === 'less_than' || op === 'greater_than' ? 'normal' : 'urgent';
    case 'type': return 'incident';
    case 'assignee': return field === 'assignee' ? 'me' : '';
    case 'channel': return 'portal';
    case 'hours': return 24;
    case 'satisfaction': return 'bad';
    case 'actor': return 'customer';
    case 'comment': return 'public';
    case 'checkbox': return 'true';
    case 'field-option': {
      const def = customFields.find((f) => f.id === field.slice(6));
      return def?.options?.[0]?.value || '';
    }
    default: return '';
  }
}

export function defaultCondition(field = 'status', kind = 'view', customFields = []) {
  const op = opsFor(field, kind)[0];
  return { field, op, value: defaultValue(field, op, customFields) };
}

/** Keep a condition consistent after its field or operator changed. */
export function reconcileCondition(c, kind, customFields = []) {
  const ops = opsFor(c.field, kind);
  const op = ops.includes(c.op) ? c.op : ops[0];
  const before = valueKind(c.field, c.op, customFields);
  const after = valueKind(c.field, op, customFields);
  let value = c.value;
  if (before !== after || value === undefined || !fits(after, value)) value = defaultValue(c.field, op, customFields);
  return { field: c.field, op, value };
}

/** Whether a stored value makes sense for a kind of value control. */
function fits(kind, value) {
  if (kind === 'hours') return value !== '' && Number.isFinite(Number(value));
  const list = VALUE_OPTIONS[kind];
  if (list) return list.some((o) => o.value === value);
  return true;
}

/** Actions a rule kind offers ('macro' or 'trigger'). */
export function actionFields(kind, customFields = []) {
  const out = [
    { value: 'status', label: 'Set status' },
    { value: 'priority', label: 'Set priority' },
    { value: 'type', label: 'Set type' },
    { value: 'assignee', label: 'Assign to' },
    { value: 'group', label: 'Set group' },
    { value: 'add_tags', label: 'Add tags' },
    { value: 'remove_tags', label: 'Remove tags' },
    { value: 'set_tags', label: 'Replace tags with' },
    { value: 'add_follower', label: 'Add follower' },
  ];
  for (const f of customFields) out.push({ value: `field:${f.id}`, label: `Set ${f.title}`, custom: true });
  if (kind === 'trigger') {
    out.push({ value: 'notify_requester', label: 'Email the requester' });
    out.push({ value: 'notify_email', label: 'Email an address' });
  }
  return out;
}

export function actionValueKind(field, customFields = []) {
  if (field === 'notify_requester' || field === 'notify_email') return 'email';
  if (field.startsWith('field:')) return valueKind(field, 'is', customFields);
  switch (field) {
    case 'status': return 'status';
    case 'priority': return 'priority';
    case 'type': return 'type';
    case 'assignee': return 'assignee';
    case 'add_follower': return 'agent';
    case 'group': return 'group';
    case 'add_tags':
    case 'remove_tags':
    case 'set_tags': return 'tags';
    default: return 'text';
  }
}

export const ACTION_OPTIONS = {
  status: SUBMIT_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
  priority: [{ value: '', label: 'No priority' }, ...PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))],
  type: [{ value: '', label: 'No type' }, ...TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))],
};

export function defaultAction(field, customFields = []) {
  switch (field) {
    case 'status': return { field, value: 'solved' };
    case 'priority': return { field, value: 'high' };
    case 'type': return { field, value: 'question' };
    case 'assignee': return { field, value: 'me' };
    case 'add_follower': return { field, value: 'me' };
    case 'group': return { field, value: '' };
    case 'notify_requester': return { field, subject: 'Re: {{ticket.subject}}', body: 'Hi {{requester.first_name}},\n\n{{comment.text}}' };
    case 'notify_email': return { field, to: '', subject: '[{{desk.name}}] {{ticket.subject}}', body: 'Request #{{ticket.id}} from {{requester.name}} needs attention.\n\n{{comment.text}}' };
    default:
      if (field.startsWith('field:')) return { field, value: defaultValue(field, 'is', customFields) };
      return { field, value: '' };
  }
}

/* --------------------------------------------------------------- text */

/**
 * `names` resolves ids for descriptions:
 *   { agent(uuid), group(id), user(id), org(id), field(id) -> definition }
 */
function valueText(kind, v, names = {}, field = '') {
  const pick = (list) => list.find((o) => String(o.value) === String(v ?? ''))?.label ?? String(v ?? '');
  switch (kind) {
    case 'status': return pick(VALUE_OPTIONS.status);
    case 'priority': return pick(VALUE_OPTIONS.priority);
    case 'type': return pick(VALUE_OPTIONS.type);
    case 'channel': return pick(VALUE_OPTIONS.channel);
    case 'satisfaction': return pick(VALUE_OPTIONS.satisfaction);
    case 'actor': return pick(VALUE_OPTIONS.actor);
    case 'comment': return pick(VALUE_OPTIONS.comment);
    case 'assignee':
    case 'agent':
      if (v === 'me') return 'the current agent';
      if (!v) return 'no one';
      return names.agent?.(v) || 'a former agent';
    case 'group': return v ? names.group?.(v) || 'a deleted group' : 'no group';
    case 'requester': return v ? names.user?.(v) || `customer ${v}` : 'anyone';
    case 'organization': return v ? names.org?.(v) || `organization ${v}` : 'no organization';
    case 'hours': return `${Number(v) || 0} ${Number(v) === 1 ? 'hour' : 'hours'}`;
    case 'tags': return normTags(v).join(', ') || 'no tags';
    case 'checkbox': return v === true || v === 'true' ? 'checked' : 'not checked';
    case 'field-option': {
      const def = names.field?.(field.slice(6));
      return def?.options?.find((o) => o.value === v)?.label || String(v ?? '');
    }
    default: return v === '' || v === undefined || v === null ? 'empty' : `"${v}"`;
  }
}

function fieldLabel(field, names = {}) {
  if (field.startsWith('field:')) return names.field?.(field.slice(6))?.title || 'A deleted field';
  return CONDITION_FIELDS[field]?.label || field;
}

export function describeCondition(c, names = {}, customFields = []) {
  const label = fieldLabel(c.field, names);
  const kind = valueKind(c.field, c.op, customFields);
  const v = valueText(kind, c.value, names, c.field);
  switch (c.op) {
    case 'is':
      if (c.field === 'actor') return `the change is made by ${v.toLowerCase()}`;
      if (c.field === 'comment') return { public: 'the change includes a public reply', private: 'the change includes an internal note', present: 'the change includes a comment', absent: 'the change has no comment' }[c.value] || 'a comment is added';
      return `${label} is ${v}`;
    case 'is_not': return `${label} is not ${v}`;
    case 'less_than': return kind === 'hours' ? `${label.replace('Hours since ', '').replace(/^./, (x) => x.toUpperCase())} less than ${v} ago` : `${label} is before ${v}`;
    case 'greater_than': return kind === 'hours' ? `${label.replace('Hours since ', '').replace(/^./, (x) => x.toUpperCase())} more than ${v} ago` : `${label} is after ${v}`;
    case 'changed_to': return `${label} changes to ${v}`;
    case 'changed': return `${label} changes`;
    case 'includes': return `Tags include ${v}`;
    case 'excludes': return `Tags exclude ${v}`;
    case 'contains': return `${label} contains ${v}`;
    case 'not_contains': return `${label} does not contain ${v}`;
    case 'includes_me': return 'I am following';
    case 'present': return `${label} is filled in`;
    case 'absent': return `${label} is empty`;
    default: return `${label} ${opLabel(c.op).toLowerCase()} ${v}`;
  }
}

export function describeConditions(conditions, names = {}, customFields = []) {
  const all = (conditions?.all || []).map((c) => describeCondition(c, names, customFields));
  const any = (conditions?.any || []).map((c) => describeCondition(c, names, customFields));
  const parts = [];
  if (all.length) parts.push(all.join(' and '));
  if (any.length) parts.push(any.length === 1 ? any[0] : `at least one of: ${any.join(' or ')}`);
  if (!parts.length) return 'Every ticket';
  return parts.join(', and ');
}

export function describeAction(a, names = {}, customFields = []) {
  const kind = actionValueKind(a.field, customFields);
  switch (a.field) {
    case 'status': return `Set status to ${valueText('status', a.value)}`;
    case 'priority': return a.value ? `Set priority to ${valueText('priority', a.value)}` : 'Clear priority';
    case 'type': return a.value ? `Set type to ${valueText('type', a.value)}` : 'Clear type';
    case 'assignee': return a.value ? `Assign to ${valueText('assignee', a.value, names)}` : 'Unassign';
    case 'group': return a.value ? `Move to ${valueText('group', a.value, names)}` : 'Clear group';
    case 'add_tags': return `Add tags ${valueText('tags', a.value)}`;
    case 'remove_tags': return `Remove tags ${valueText('tags', a.value)}`;
    case 'set_tags': return `Replace tags with ${valueText('tags', a.value)}`;
    case 'add_follower': return `Add ${valueText('agent', a.value, names)} as a follower`;
    case 'notify_requester': return 'Email the requester';
    case 'notify_email': return `Email ${a.to || 'an address'}`;
    default:
      if (a.field.startsWith('field:')) return `Set ${fieldLabel(a.field, names)} to ${valueText(kind, a.value, names, a.field)}`;
      return a.field;
  }
}

export function describeActions(actions, names = {}, customFields = []) {
  return (actions || []).map((a) => describeAction(a, names, customFields));
}

/** Summary used in trigger lists: "When ... then ...". */
export function describeTrigger(t, names = {}, customFields = []) {
  const when = { created: 'When a ticket is created', updated: 'When a ticket is updated', any: 'When a ticket is created or updated' }[t.event] || 'When a ticket changes';
  const cond = describeConditions(t.conditions, names, customFields);
  const acts = describeActions(t.actions, names, customFields);
  const then = acts.length ? acts.map(lowerFirst).join(', ') : 'do nothing';
  return `${when}${cond === 'Every ticket' ? '' : `, if ${lowerFirst(cond)}`}, then ${then}.`;
}

function lowerFirst(s) {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

/* ---------------------------------------------------------- validation */

function checkActions(actions, kind) {
  for (const a of actions || []) {
    if (a.field === 'notify_email' && !isEmail(String(a.to || '').trim().toLowerCase())) return 'Enter a valid email address for each "Email an address" action';
    if ((a.field === 'notify_requester' || a.field === 'notify_email') && !String(a.body || '').trim()) return 'Write the email body for each email action';
    if (['add_tags', 'remove_tags'].includes(a.field) && !normTags(a.value).length) return 'Enter at least one tag for each tag action';
    if (kind === 'macro' && (a.field === 'notify_requester' || a.field === 'notify_email')) return 'Macros cannot send emails';
  }
  return null;
}

function checkConditions(conditions) {
  for (const c of [...(conditions?.all || []), ...(conditions?.any || [])]) {
    if (['tags', 'subject'].includes(c.field) && !String(c.value || '').trim()) return 'Fill in a value for every condition';
    if (c.field === 'requester' && (c.value === '' || c.value == null)) return 'Choose a customer for every requester condition';
    // An empty box is not 0 hours: it would match every ticket, or none.
    if (['created', 'updated', 'solved'].includes(c.field) && (String(c.value ?? '').trim() === '' || !(Number(c.value) >= 0))) return 'Enter a number of hours for every time condition';
  }
  return null;
}

/** Returns an error message, or null when the macro can be saved. */
export function validateMacro(m) {
  if (!String(m.title || '').trim()) return 'Give the macro a title';
  if (!(m.actions || []).length && !m.comment?.html) return 'Add at least one action or a comment';
  return checkActions(m.actions, 'macro');
}

export function validateView(v) {
  if (!String(v.title || '').trim()) return 'Give the view a title';
  if (!(v.conditions?.all || []).length && !(v.conditions?.any || []).length) return 'Add at least one condition';
  if (!(v.columns || []).length) return 'Show at least one column';
  return checkConditions(v.conditions);
}

export function validateTrigger(t) {
  if (!String(t.title || '').trim()) return 'Give the trigger a title';
  if (!(t.conditions?.all || []).length && !(t.conditions?.any || []).length) return 'Add at least one condition so the trigger does not run on every ticket';
  if (!(t.actions || []).length) return 'Add at least one action';
  return checkConditions(t.conditions) || checkActions(t.actions, 'trigger');
}

export function validateField(f, others = []) {
  if (!String(f.title || '').trim()) return 'Give the field a title';
  if (others.some((o) => o.id !== f.id && o.title.trim().toLowerCase() === f.title.trim().toLowerCase())) return 'Another field already has that title';
  if (f.type === 'dropdown') {
    const opts = (f.options || []).filter((o) => String(o.label || '').trim());
    if (!opts.length) return 'Add at least one option';
    const values = opts.map((o) => o.value || optionValue(o.label));
    // The stored value is made of the name's letters and numbers; a name of
    // only emoji or symbols would have none, and be dropped on save.
    if (values.some((v) => !v)) return 'Give each option a name with at least one letter or number';
    if (new Set(values).size !== values.length) return 'Two options have the same name';
  }
  return null;
}

/** The stored value for a dropdown option, derived from its label. */
export function optionValue(label) {
  return normTag(label);
}

/* ------------------------------------------------------------- utils */

export function move(list, index, delta) {
  const to = index + delta;
  if (to < 0 || to >= list.length) return list;
  const out = [...list];
  const [item] = out.splice(index, 1);
  out.splice(to, 0, item);
  return out;
}

export function duplicateTitle(title, existing) {
  const base = `${title} (copy)`;
  let name = base;
  let n = 2;
  const taken = new Set(existing.map((x) => x.title));
  while (taken.has(name)) name = `${title} (copy ${n++})`;
  return name;
}

/** Minutes to { h, m } and back, for service level inputs. */
export function splitMinutes(total) {
  if (total === null || total === undefined || total === '') return { h: '', m: '' };
  const n = Math.max(0, Math.round(Number(total)));
  return { h: Math.floor(n / 60), m: n % 60 };
}

export function joinMinutes(h, m) {
  const hh = h === '' || h === null || h === undefined ? 0 : Number(h);
  const mm = m === '' || m === null || m === undefined ? 0 : Number(m);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || mm < 0) return null;
  const total = Math.round(hh * 60 + mm);
  return total > 0 ? total : null;
}

export function formatMinutes(total) {
  if (!total) return 'No target';
  const { h, m } = splitMinutes(total);
  if (h >= 48 && !m && h % 24 === 0) return `${h / 24} days`;
  return [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ');
}
