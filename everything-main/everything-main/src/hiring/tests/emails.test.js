import { describe, it, expect } from 'vitest';
import {
  EMAIL_TEMPLATES,
  emailEvents,
  emailTemplate,
  lastContactedAt,
  MAILTO_LIMIT,
  mailtoUrl,
  renderTemplate,
  TEMPLATE_VARIABLES,
  templatePlaceholders,
  templateVariables,
} from '../src/core/emails.js';

describe('renderTemplate', () => {
  it('substitutes variables, with and without inner spacing', () => {
    expect(renderTemplate('Hi {{name}}, re {{ job }}', { name: 'Ada', job: 'Engineer' })).toBe('Hi Ada, re Engineer');
  });

  it('blanks unknown or missing variables instead of leaking markers', () => {
    expect(renderTemplate('Hi {{name}}{{mystery}}', { name: 'Ada' })).toBe('Hi Ada');
    expect(renderTemplate('{{name}}', {})).toBe('');
  });

  it('does not resolve inherited object members as variables', () => {
    expect(renderTemplate('X {{constructor}} {{toString}} {{hasOwnProperty}} Y', { name: 'Ada' })).toBe('X    Y');
  });

  it('is resilient to empty input', () => {
    expect(renderTemplate(null, {})).toBe('');
    expect(renderTemplate('plain text', {})).toBe('plain text');
  });
});

describe('emailTemplate', () => {
  it('returns defaults when there is no override', () => {
    const t = emailTemplate({}, 'reject');
    expect(t.subject).toContain('{{company}}');
    expect(t.label).toBe('Rejection');
  });

  it('merges stored overrides over defaults, field by field', () => {
    const settings = { emailTemplates: { reject: { subject: 'Custom subject' } } };
    const t = emailTemplate(settings, 'reject');
    expect(t.subject).toBe('Custom subject');
    expect(t.body).toBe(EMAIL_TEMPLATES.find((x) => x.key === 'reject').body);
  });

  it('is null for unknown keys', () => {
    expect(emailTemplate({}, 'nope')).toBeNull();
  });
});

describe('mailtoUrl', () => {
  it('encodes subject and body', () => {
    const url = mailtoUrl('a@b.com', 'Hello & welcome', 'Line 1\nLine 2');
    expect(url).toBe('mailto:a%40b.com?subject=Hello%20%26%20welcome&body=Line%201%0ALine%202');
  });

  it('is null without a recipient and omits empty params', () => {
    expect(mailtoUrl('', 'x', 'y')).toBeNull();
    expect(mailtoUrl(null, 'x', 'y')).toBeNull();
    expect(mailtoUrl('a@b.com', '', '')).toBe('mailto:a%40b.com');
  });

  it('has a sane practical limit constant', () => {
    expect(MAILTO_LIMIT).toBeGreaterThan(1000);
  });
});

describe('default templates', () => {
  it('cover invite, reject, and offer with subjects and bodies', () => {
    const keys = EMAIL_TEMPLATES.map((t) => t.key);
    expect(keys).toEqual(expect.arrayContaining(['invite', 'reject', 'offer']));
    for (const t of EMAIL_TEMPLATES) {
      expect(t.subject.length).toBeGreaterThan(0);
      expect(t.body).toContain('{{name}}');
    }
  });
});

describe('contact history', () => {
  const candidate = {
    history: [
      { at: '2026-03-01T10:00:00Z', type: 'created', stage: 'applied' },
      { at: '2026-03-02T10:00:00Z', type: 'email', id: 'e1', template: 'invite', subject: 'Interview', sent: true },
      { at: '2026-03-05T10:00:00Z', type: 'note', text: 'Called' },
      { at: '2026-03-04T10:00:00Z', type: 'email', id: 'e2', template: 'reject', subject: 'Your application', sent: false },
    ],
  };

  it('reports when we last wrote, draft or sent', () => {
    expect(lastContactedAt(candidate)).toBe('2026-03-04T10:00:00Z');
    expect(lastContactedAt({ history: [{ at: 'x', type: 'note' }] })).toBeNull();
    expect(lastContactedAt({})).toBeNull();
    expect(lastContactedAt(null)).toBeNull();
  });

  it('lists the email events newest first', () => {
    expect(emailEvents(candidate).map((e) => e.id)).toEqual(['e2', 'e1']);
    expect(emailEvents({})).toEqual([]);
  });

  it('has a template for the times a proposal offers', () => {
    expect(EMAIL_TEMPLATES.some((t) => t.key === 'slots')).toBe(true);
  });
});

describe('template variables', () => {
  it('names only what each template is actually rendered with', () => {
    expect(templateVariables('reject')).toEqual(['name', 'company', 'job']);
    expect(templateVariables('invite')).toContain('time');
    expect(templateVariables('reject')).not.toContain('time');
    expect(templateVariables('nope')).toEqual([]);
  });

  it('exposes the union across every template', () => {
    for (const t of EMAIL_TEMPLATES) {
      for (const v of t.variables) expect(TEMPLATE_VARIABLES).toContain(v);
    }
  });

  it('leaves no placeholder in a shipped template that its own list does not cover', () => {
    // The Settings hint is built from these lists, so a default that used
    // a variable outside its own would advertise one that renders blank.
    for (const t of EMAIL_TEMPLATES) {
      for (const name of [...templatePlaceholders(t.subject), ...templatePlaceholders(t.body)]) {
        expect(t.variables, `${t.key} uses {{${name}}}`).toContain(name);
      }
    }
  });
});

describe('templatePlaceholders', () => {
  it('lists the markers once each, spacing and repeats ignored', () => {
    expect(templatePlaceholders('{{a}} {{ b }} {{a}}')).toEqual(['a', 'b']);
    expect(templatePlaceholders('no markers')).toEqual([]);
    expect(templatePlaceholders(null)).toEqual([]);
  });
});
