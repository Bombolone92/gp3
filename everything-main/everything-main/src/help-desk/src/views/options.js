/** Option lists for the select fields used across ticket screens. */
import { h } from '../ui/dom.js';
import { avatar, statusBadge } from '../ui/components.js';
import { STATUS_LABEL, SUBMIT_STATUSES, PRIORITIES, PRIORITY_LABEL, TYPES, TYPE_LABEL } from '../shared/model.js';
import { app } from '../app.js';

export function statusOptions(list = SUBMIT_STATUSES) {
  return list.map((s) => ({ value: s, label: STATUS_LABEL[s], icon: statusBadge(s, { compact: true }) }));
}

export function priorityOptions() {
  return [{ value: null, label: '-' }, ...PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))];
}

export function typeOptions() {
  return [{ value: null, label: '-' }, ...TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))];
}

export function groupOptions() {
  return [{ value: null, label: '-' }, ...(app.replica.cfg.groups || []).map((g) => ({ value: g.id, label: g.name }))];
}

/**
 * The group a ticket goes to when you take it: your first group that still
 * exists (a deleted group would be refused by the server), or none.
 */
export function myGroup() {
  const ids = new Set((app.replica?.cfg.groups || []).map((g) => g.id));
  return (app.me?.groups || []).find((g) => ids.has(g)) || null;
}

/**
 * Assignee choices as "group/agent" pairs: picking a group alone leaves the
 * ticket in that group's queue; picking an agent sets both.
 */
export function assigneeOptions() {
  const out = [{ value: '|', label: 'Unassigned', group: 'General' }];
  const me = app.me;
  if (me) out.push({ value: `${myGroup() || ''}|${me.uuid}`, label: `${me.name} (you)`, group: 'General', icon: avatar(me.name, { size: 'sm', agent: true }) });
  const agents = app.replica.agents();
  for (const g of app.replica.cfg.groups || []) {
    out.push({ value: `${g.id}|`, label: g.name, group: 'Groups', desc: 'Group' });
  }
  for (const g of app.replica.cfg.groups || []) {
    for (const a of agents.filter((x) => (x.groups || []).includes(g.id))) {
      out.push({ value: `${g.id}|${a.uuid}`, label: `${a.name}`, desc: g.name, keywords: a.username, group: 'Agents', icon: avatar(a.name, { size: 'sm', agent: true }) });
    }
  }
  for (const a of agents.filter((x) => !(x.groups || []).length)) {
    out.push({ value: `|${a.uuid}`, label: a.name, keywords: a.username, group: 'Agents', icon: avatar(a.name, { size: 'sm', agent: true }) });
  }
  return out;
}

export function assigneeValue(t) {
  return `${t.group || ''}|${t.assignee || ''}`;
}

export function splitAssignee(v) {
  const [group, assignee] = String(v || '|').split('|');
  return { group: group || null, assignee: assignee || null };
}

/** Label for the current assignee value even if it is not in the options. */
export function assigneeLabel(t) {
  const g = (app.replica.cfg.groups || []).find((x) => x.id === t.group);
  if (t.assignee) return `${g ? `${g.name} / ` : ''}${app.memberName(t.assignee)}`;
  if (g) return g.name;
  return 'Unassigned';
}

export function agentOptions() {
  return app.replica.agents().map((a) => ({ value: a.uuid, label: a.name, keywords: a.username, icon: avatar(a.name, { size: 'sm', agent: true }) }));
}

export function userOption(u) {
  return { value: u.id, label: u.name, desc: u.email || '', keywords: u.email || '', icon: avatar(u.name, { size: 'sm' }) };
}

export function fieldValueLabel(def, v) {
  if (v === undefined || v === null || v === '') return '';
  if (def.type === 'dropdown') return def.options?.find((o) => o.value === v)?.label || v;
  if (def.type === 'checkbox') return v ? 'Yes' : 'No';
  return String(v);
}

export { h };
