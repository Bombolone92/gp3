/**
 * Candidate email templates. The app never sends mail itself: every action
 * opens the user's own mail client through a mailto: URL, so there is no
 * sending infrastructure and no deliverability question. Templates are
 * stored as overrides in settings.emailTemplates and merged over these
 * defaults, so new defaults reach existing users.
 */

export const EMAIL_TEMPLATES = [
  {
    key: 'invite',
    label: 'Interview invitation',
    variables: ['name', 'company', 'job', 'date', 'time', 'where'],
    subject: 'Interview with {{company}}: {{job}}',
    body: `Hi {{name}},

Thank you for your interest in the {{job}} role at {{company}}. We would love to speak with you.

When: {{date}} at {{time}}
Where: {{where}}

If the time does not work, reply and we will find another slot.

Best regards,
{{company}}`,
  },
  {
    key: 'slots',
    label: 'Interview times to choose from',
    variables: ['name', 'company', 'job', 'options', 'where'],
    subject: 'Interview with {{company}}: {{job}}',
    body: `Hi {{name}},

Thank you for your interest in the {{job}} role at {{company}}. We would love to speak with you.

Here are a few times that work on our side — reply with the one that suits you and we will send the invitation:

{{options}}

If none of them work, tell us what does and we will find a slot.

Best regards,
{{company}}`,
  },
  {
    key: 'reject',
    label: 'Rejection',
    variables: ['name', 'company', 'job'],
    subject: 'Your application to {{company}}',
    body: `Hi {{name}},

Thank you for taking the time to apply for the {{job}} role and to speak with us.

After careful consideration we have decided not to move forward. This was a competitive process, and we would be glad to hear from you again for future roles.

We wish you the very best in your search.

Best regards,
{{company}}`,
  },
  {
    key: 'offer',
    label: 'Offer follow-up',
    variables: ['name', 'company', 'job', 'letter'],
    subject: 'Your offer from {{company}}',
    body: `Hi {{name}},

We are delighted to share your offer for the {{job}} role. The full letter follows below; take your time, and reach out with any questions.

{{letter}}

We are excited about the prospect of working together.

Best regards,
{{company}}`,
  },
];

/**
 * What one template is actually rendered with. Each is only ever given
 * the values its own call site builds, so offering the whole union
 * everywhere invited a {{date}} into the rejection email — accepted,
 * saved, and then sent as a blank space in front of a candidate.
 */
export function templateVariables(key) {
  return EMAIL_TEMPLATES.find((t) => t.key === key)?.variables ?? [];
}

/** Every variable any email template can use. */
export const TEMPLATE_VARIABLES = [...new Set(EMAIL_TEMPLATES.flatMap((t) => t.variables))];

/** The {{placeholders}} in a piece of template text, in order, deduped. */
export function templatePlaceholders(text) {
  return [...new Set([...String(text ?? '').matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(([, name]) => name))];
}

/** Replace {{variable}} markers; unknown or missing variables become ''. */
export function renderTemplate(text, vars = {}) {
  // Own keys only: templates are user-editable, and a bare property read
  // would resolve {{constructor}} or {{toString}} to function source.
  return String(text ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) =>
    Object.hasOwn(vars, key) ? String(vars[key] ?? '') : ''
  );
}

/** The effective template for a key: stored override merged over the default. */
export function emailTemplate(settings, key) {
  const base = EMAIL_TEMPLATES.find((t) => t.key === key);
  if (!base) return null;
  const override = settings?.emailTemplates?.[key];
  return {
    ...base,
    subject: override?.subject ?? base.subject,
    body: override?.body ?? base.body,
  };
}

/**
 * Practical mailto length ceiling. Above it, some clients truncate or
 * refuse the URL entirely; callers should fall back to copying the body.
 */
export const MAILTO_LIMIT = 1800;

/** A mailto: URL, or null without a recipient. */
export function mailtoUrl(email, subject, body) {
  const to = String(email ?? '').trim();
  if (!to) return null;
  const params = [];
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${encodeURIComponent(to)}${params.length ? `?${params.join('&')}` : ''}`;
}

/* ---- Contact history ---------------------------------------------------- */

/** Email events on a candidate's timeline, newest first. */
export function emailEvents(candidate) {
  return (candidate?.history ?? []).filter((e) => e?.type === 'email').reverse();
}

/**
 * When we last wrote to this candidate, or null. A draft counts: mailto
 * cannot confirm a send, and "I opened a draft and never sent it" is still
 * the last thing that happened — the timeline says which it was.
 */
export function lastContactedAt(candidate) {
  let latest = null;
  for (const event of candidate?.history ?? []) {
    if (event?.type !== 'email') continue;
    const at = String(event.at ?? '');
    if (at > (latest ?? '')) latest = at;
  }
  return latest;
}
