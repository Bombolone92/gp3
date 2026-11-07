/**
 * The help desk's domain vocabulary, shared by the worker and the app:
 * ticket statuses, priorities, types, channels and roles, plus the
 * normalizers that turn untrusted input into well-formed records. Everything
 * here is pure so it runs the same in a browser, a Puter worker and tests.
 */

export const STATUSES = ['new', 'open', 'pending', 'hold', 'solved', 'closed'];
export const STATUS_LABEL = {
  new: 'New',
  open: 'Open',
  pending: 'Pending',
  hold: 'On hold',
  solved: 'Solved',
  closed: 'Closed',
};
/** Statuses an agent can submit a ticket as (closed is reached by automation). */
export const SUBMIT_STATUSES = ['new', 'open', 'pending', 'hold', 'solved'];
export const UNSOLVED = new Set(['new', 'open', 'pending', 'hold']);

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const PRIORITY_LABEL = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
export const PRIORITY_RANK = { low: 1, normal: 2, high: 3, urgent: 4 };

export const TYPES = ['question', 'incident', 'problem', 'task'];
export const TYPE_LABEL = { question: 'Question', incident: 'Incident', problem: 'Problem', task: 'Task' };

export const CHANNELS = ['web', 'portal', 'email', 'phone', 'chat', 'api'];
export const CHANNEL_LABEL = {
  web: 'Agent',
  portal: 'Help center',
  email: 'Email',
  phone: 'Phone',
  chat: 'Chat',
  api: 'API',
};

export const ROLES = ['admin', 'agent'];
export const ROLE_LABEL = { owner: 'Owner', admin: 'Administrator', agent: 'Agent' };

export const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'checkbox', 'dropdown'];

export const LIMITS = {
  subject: 200,
  name: 120,
  email: 254,
  tag: 40,
  tags: 30,
  comment: 64 * 1024,
  notes: 4000,
  articleBody: 120 * 1024,
  attachment: 20 * 1024 * 1024,
  attachmentsPerComment: 10,
};

export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.code = 'invalid';
    this.status = 400;
    this.field = field;
  }
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function isEmail(value) {
  return typeof value === 'string' && value.length <= LIMITS.email && EMAIL_RE.test(value);
}

export function normEmail(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return isEmail(v) ? v : '';
}

/** Collapse whitespace and clip to a length. */
export function cleanLine(value, max = 200) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function cleanText(value, max = 4000) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
}

/** Tags are lowercase words joined by underscores, like most help desks use. */
export function normTag(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s,]+/g, '_')
    .replace(/[^\p{L}\p{N}_\-.]/gu, '')
    .slice(0, LIMITS.tag);
}

export function normTags(list) {
  const out = [];
  for (const t of Array.isArray(list) ? list : String(list ?? '').split(/[\s,]+/)) {
    const tag = normTag(t);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= LIMITS.tags) break;
  }
  return out;
}

export function oneOf(value, list, fallback = null) {
  return list.includes(value) ? value : fallback;
}

export function isUnsolved(status) {
  return UNSOLVED.has(status);
}

/** Domain part of an email address, for matching a customer to an organization. */
export function emailDomain(email) {
  const at = String(email || '').lastIndexOf('@');
  return at > 0 ? email.slice(at + 1).toLowerCase() : '';
}

export function normDomain(value) {
  const v = String(value ?? '').trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v : '';
}

/** First name for greetings in macros and emails. */
export function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = parts[0][0] || '';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}

/**
 * Validate a custom field value against its definition. Returns the cleaned
 * value, or undefined when the value should be cleared.
 */
export function cleanFieldValue(def, value) {
  if (value === null || value === undefined || value === '') return undefined;
  switch (def.type) {
    case 'text':
      return cleanLine(value, 500) || undefined;
    case 'textarea':
      return cleanText(value, 4000) || undefined;
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : undefined;
    case 'checkbox':
      return value === true || value === 'true' ? true : undefined;
    case 'dropdown': {
      const opts = (def.options || []).map((o) => o.value);
      return opts.includes(value) ? value : undefined;
    }
    default:
      return undefined;
  }
}

/** Display label for a ticket's requester-facing reference. */
export function ticketRef(id) {
  return `#${Number(id)}`;
}
