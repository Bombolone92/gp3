/**
 * Validation for the admin-edited configuration documents. Each kind is
 * stored whole under `cfg:<kind>`; these functions keep only known shapes so
 * a stored document can always be read back safely.
 */
import { cleanLine, cleanText, FIELD_TYPES, PRIORITIES, normTags, normEmail } from '../shared/model.js';
import { sanitizeHtml } from '../shared/html.js';
import { CONDITION_FIELDS } from '../shared/rules.js';
import { ValidationError } from '../shared/model.js';

const ID = /^[a-z0-9-]{2,40}$/;
const MAX_ITEMS = 500;

function arr(value, max = MAX_ITEMS) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function id(value) {
  return typeof value === 'string' && ID.test(value) ? value : null;
}

function conditions(value) {
  const one = (c) => {
    if (!c || typeof c !== 'object') return null;
    const field = String(c.field || '');
    if (!(field in CONDITION_FIELDS) && !/^field:[a-z0-9-]{2,40}$/.test(field)) return null;
    const op = cleanLine(c.op, 30);
    let v = c.value;
    if (Array.isArray(v)) v = v.map((x) => cleanLine(x, 100)).slice(0, 50);
    else if (typeof v === 'number' || typeof v === 'boolean') v = v;
    else v = cleanLine(v, 200);
    return { field, op, value: v };
  };
  return {
    all: arr(value?.all, 50).map(one).filter(Boolean),
    any: arr(value?.any, 50).map(one).filter(Boolean),
  };
}

const ACTION_FIELDS = new Set(['status', 'priority', 'type', 'assignee', 'group', 'add_tags', 'remove_tags', 'set_tags', 'add_follower', 'notify_requester', 'notify_email']);

function actions(value) {
  return arr(value, 30)
    .map((a) => {
      if (!a || typeof a !== 'object') return null;
      const field = String(a.field || '');
      if (!ACTION_FIELDS.has(field) && !/^field:[a-z0-9-]{2,40}$/.test(field)) return null;
      if (field === 'notify_requester' || field === 'notify_email') {
        const out = { field, subject: cleanLine(a.subject, 300), body: cleanText(a.body, 8000) };
        if (field === 'notify_email') {
          out.to = normEmail(a.to);
          if (!out.to) return null;
        }
        return out;
      }
      const v = typeof a.value === 'boolean' || typeof a.value === 'number' ? a.value : cleanLine(a.value, 300);
      return { field, value: v };
    })
    .filter(Boolean);
}

const VALIDATORS = {
  groups(value) {
    return arr(value, 200)
      .map((g) => (id(g?.id) && cleanLine(g.name, 80) ? { id: g.id, name: cleanLine(g.name, 80), desc: cleanLine(g.desc, 300) } : null))
      .filter(Boolean);
  },
  macros(value) {
    return arr(value)
      .map((m) => {
        if (!id(m?.id) || !cleanLine(m.title, 120)) return null;
        const html = m.comment?.html ? sanitizeHtml(m.comment.html, { maxLength: 32 * 1024 }) : '';
        return {
          id: m.id,
          title: cleanLine(m.title, 120),
          desc: cleanLine(m.desc, 300),
          active: m.active !== false,
          actions: actions(m.actions),
          comment: html ? { html, public: m.comment.public !== false } : null,
        };
      })
      .filter(Boolean);
  },
  views(value) {
    return arr(value, 200)
      .map((v) => {
        if (!id(v?.id) || !cleanLine(v.title, 120)) return null;
        return {
          id: v.id,
          title: cleanLine(v.title, 120),
          active: v.active !== false,
          conditions: conditions(v.conditions),
          columns: arr(v.columns, 20).map((c) => cleanLine(c, 40)).filter(Boolean),
          sort: { field: cleanLine(v.sort?.field || 'updatedAt', 40), dir: v.sort?.dir === 'asc' ? 'asc' : 'desc' },
          groupBy: cleanLine(v.groupBy, 40) || null,
        };
      })
      .filter(Boolean);
  },
  fields(value) {
    return arr(value, 100)
      .map((f) => {
        if (!id(f?.id) || !cleanLine(f.title, 80) || !FIELD_TYPES.includes(f.type)) return null;
        const out = {
          id: f.id,
          title: cleanLine(f.title, 80),
          type: f.type,
          desc: cleanLine(f.desc, 300),
          active: f.active !== false,
          portal: !!f.portal,
          required: !!f.required,
        };
        if (f.type === 'dropdown') {
          out.options = arr(f.options, 200)
            .map((o) => {
              const label = cleanLine(o?.label ?? o?.value, 100);
              const v = normTags([o?.value || label])[0];
              return label && v ? { value: v, label } : null;
            })
            .filter(Boolean);
          if (!out.options.length) throw new ValidationError(`Add at least one option to "${out.title}"`, 'options');
        }
        return out;
      })
      .filter(Boolean);
  },
  triggers(value) {
    return arr(value, 200)
      .map((t) => {
        if (!id(t?.id) || !cleanLine(t.title, 120)) return null;
        return {
          id: t.id,
          title: cleanLine(t.title, 120),
          active: t.active !== false,
          event: ['created', 'updated', 'any'].includes(t.event) ? t.event : 'any',
          conditions: conditions(t.conditions),
          actions: actions(t.actions),
        };
      })
      .filter(Boolean);
  },
  sla(value) {
    const targets = {};
    for (const p of PRIORITIES) {
      const t = value?.targets?.[p] || {};
      const minutes = (x) => {
        const n = Math.round(Number(x));
        return Number.isFinite(n) && n > 0 ? Math.min(n, 60 * 24 * 365) : null;
      };
      targets[p] = { first: minutes(t.first), next: minutes(t.next), resolve: minutes(t.resolve) };
    }
    return { enabled: value?.enabled !== false, targets };
  },
  kb(value) {
    const categories = arr(value?.categories, 100)
      .map((c, i) => (id(c?.id) && cleanLine(c.name, 100) ? { id: c.id, name: cleanLine(c.name, 100), desc: cleanLine(c.desc, 300), order: Number(c.order ?? i) || 0 } : null))
      .filter(Boolean);
    const catIds = new Set(categories.map((c) => c.id));
    const sections = arr(value?.sections, 500)
      .map((s, i) =>
        id(s?.id) && catIds.has(s.categoryId) && cleanLine(s.name, 100)
          ? { id: s.id, categoryId: s.categoryId, name: cleanLine(s.name, 100), desc: cleanLine(s.desc, 300), order: Number(s.order ?? i) || 0 }
          : null,
      )
      .filter(Boolean);
    return { categories, sections };
  },
};

export function validateConfig(kind, value) {
  const fn = VALIDATORS[kind];
  if (!fn) throw new ValidationError('Unknown settings', 'kind');
  const out = fn(value);
  if (JSON.stringify(out).length > 350 * 1024) throw new ValidationError('These settings are too large to save', kind);
  return out;
}

/** Clean desk settings an administrator may change. */
export function validateMeta(input, current) {
  const out = {};
  if ('name' in input) {
    const name = cleanLine(input.name, 80);
    if (!name) throw new ValidationError('Give the help desk a name', 'name');
    out.name = name;
  }
  if ('appUrl' in input) {
    const url = String(input.appUrl || '');
    out.appUrl = /^https:\/\/[^\s"'<>]+$/.test(url) || /^http:\/\/[a-z0-9.-]*localhost(:\d+)?\//.test(url) ? url.slice(0, 300) : current.appUrl || null;
  }
  if ('server' in input) out.server = /^[a-z0-9_-]{3,63}$/.test(String(input.server || '')) ? input.server : null;
  if ('timezone' in input) out.timezone = cleanLine(input.timezone, 60) || null;
  if ('autoCloseDays' in input) {
    const n = Math.round(Number(input.autoCloseDays));
    out.autoCloseDays = Number.isFinite(n) ? Math.max(0, Math.min(28, n)) : 4;
  }
  if ('portal' in input) {
    const p = input.portal || {};
    out.portal = {
      enabled: !!p.enabled,
      title: cleanLine(p.title, 100),
      intro: cleanLine(p.intro, 300),
      color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : null,
      signInRequired: !!p.signInRequired,
    };
  }
  if ('email' in input) {
    const e = input.email || {};
    out.email = {
      enabled: !!e.enabled,
      replyTo: normEmail(e.replyTo) || null,
      // Read the owner's Puter mailbox for new requests (see client/mailbox.js).
      inbox: !!e.inbox,
      address: normEmail(e.address) || null,
    };
  }
  if ('csat' in input) out.csat = { enabled: !!input.csat?.enabled };
  return out;
}
