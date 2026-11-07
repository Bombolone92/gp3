import { describe, it, expect } from 'vitest';
import {
  fillTemplate, fillSubject, buildMessage, mailtoUrl, messageValues,
  templateFor, allTemplates, clientGreeting, looksLikeEmail, DEFAULT_TEMPLATES, TEMPLATE_KEYS,
} from '../src/lib/message.js';
import { fmtMoney } from '../src/lib/money.js';

/* Money is formatted by Intl, whose output depends on the host locale, so
   expectations compare against the same formatter the app uses. */
const usd = (n) => fmtMoney(n, 'USD');

const settings = {
  business: { name: 'Aurora Studio' },
  taxLabel: 'Tax',
};

const invoice = (over = {}) => ({
  kind: 'invoice',
  number: 'INV-0042',
  currency: 'USD',
  issueDate: '2026-07-20',
  dueDate: '2026-08-20',
  items: [{ qty: 2, rate: 500 }],
  taxRate: 0,
  discountType: 'none',
  discountValue: 0,
  status: 'sent',
  payments: [],
  ...over,
});

const quote = (over = {}) => ({
  kind: 'quote',
  number: 'EST-0007',
  currency: 'USD',
  issueDate: '2026-07-20',
  validUntil: '2026-08-20',
  items: [{ qty: 1, rate: 1000 }],
  taxRate: 0,
  discountType: 'none',
  discountValue: 0,
  status: 'sent',
  payments: [],
  ...over,
});

const client = { id: 'c1', name: 'Maya Chen', company: 'Northwind Labs', email: 'maya@northwind.example' };

describe('fillTemplate', () => {
  it('substitutes placeholders', () => {
    expect(fillTemplate('Hi {client}, here is {number}.', { client: 'Maya', number: 'INV-1' }))
      .toBe('Hi Maya, here is INV-1.');
  });

  it('leaves out a line whose placeholder has no value', () => {
    const body = 'Hi {client},\n\nHere it is.\nPay online: {payLink}\n\nThanks';
    expect(fillTemplate(body, { client: 'Maya', payLink: '' }))
      .toBe('Hi Maya,\n\nHere it is.\n\nThanks');
    expect(fillTemplate(body, { client: 'Maya', payLink: 'https://pay.me/1' }))
      .toContain('Pay online: https://pay.me/1');
  });

  it('keeps unknown placeholders visible instead of deleting text', () => {
    expect(fillTemplate('Hello {oops} {client}', { client: 'Maya' })).toBe('Hello {oops} Maya');
  });

  it('counts a placeholder named after an inherited member as unknown', () => {
    // {constructor} and friends are on every object's prototype, so an `in`
    // test called them known and pasted JavaScript source into the message.
    expect(fillTemplate('Hi {constructor} {toString} {client}', { client: 'Maya' }))
      .toBe('Hi {constructor} {toString} Maya');
  });

  it('collapses the gaps left behind and trims the edges', () => {
    expect(fillTemplate('\nA\n{x}\n{y}\n\nB\n\n', { x: '', y: '' })).toBe('A\n\nB');
  });

  it('treats zero and false as values, not as blanks', () => {
    expect(fillTemplate('{days} days', { days: 0 })).toBe('0 days');
  });

  it('survives empty input', () => {
    expect(fillTemplate('', {})).toBe('');
    expect(fillTemplate(null, {})).toBe('');
  });
});

describe('fillSubject', () => {
  it('stays on one line and tidies the spacing', () => {
    expect(fillSubject('Invoice {number} from {business}', { number: 'INV-1', business: 'Aurora' }))
      .toBe('Invoice INV-1 from Aurora');
    expect(fillSubject('Invoice {number}\nfrom {business}', { number: 'INV-1', business: '' }))
      .toBe('Invoice INV-1 from');
  });

  it('counts a placeholder named after an inherited member as unknown', () => {
    expect(fillSubject('Invoice {number} {valueOf}', { number: 'INV-1' }))
      .toBe('Invoice INV-1 {valueOf}');
  });
});

describe('messageValues', () => {
  it('formats money and dates the way the paper does', () => {
    const v = messageValues(invoice(), client, settings, { link: 'https://x.puter.site/a.html' });
    expect(v).toMatchObject({
      number: 'INV-0042',
      client: 'Maya Chen',
      business: 'Aurora Studio',
      total: usd(1000),
      balance: usd(1000),
      dueDate: 'Aug 20, 2026',
      link: 'https://x.puter.site/a.html',
      payLink: '',
      validUntil: '',
    });
  });

  it('names the earliest open installment on an invoice with a schedule', () => {
    // The reminder wording counts {days} from this date, so {dueDate} has to
    // be the same one or the sentence contradicts itself.
    const doc = invoice({
      dueDate: '2026-12-31',
      schedule: [
        { id: 's1', label: 'On signing', dueDate: '2026-08-01', type: 'percent', value: 50 },
        { id: 's2', label: 'On delivery', dueDate: '2026-12-31', type: 'percent', value: 50 },
      ],
    });
    expect(messageValues(doc, client, settings).dueDate).toBe('Aug 1, 2026');
    // Once the first part is settled, the next open one is what is quoted.
    const half = { ...doc, payments: [{ amount: 500 }] };
    expect(messageValues(half, client, settings).dueDate).toBe('Dec 31, 2026');
  });

  it('says "on receipt" when an invoice has no due date', () => {
    expect(messageValues(invoice({ dueDate: '' }), client, settings).dueDate).toBe('on receipt');
  });

  it('reports the balance still due, not the total', () => {
    const v = messageValues(invoice({ payments: [{ amount: 400 }] }), client, settings);
    expect(v.total).toBe(usd(1000));
    expect(v.balance).toBe(usd(600));
  });

  it("carries a quote's valid-until date and no due date", () => {
    const v = messageValues(quote(), client, settings);
    expect(v.validUntil).toBe('Aug 20, 2026');
    expect(v.dueDate).toBe('');
  });
});

describe('clientGreeting', () => {
  it('falls back through company to a neutral greeting', () => {
    expect(clientGreeting(client)).toBe('Maya Chen');
    expect(clientGreeting({ company: 'Northwind' })).toBe('Northwind');
    expect(clientGreeting(null)).toBe('there');
  });
});

describe('templateFor', () => {
  it('uses the shipped default when nothing is saved', () => {
    expect(templateFor({}, 'invoice')).toEqual(DEFAULT_TEMPLATES.invoice);
    expect(templateFor({ templates: { invoice: { subject: '  ' } } }, 'invoice').subject)
      .toBe(DEFAULT_TEMPLATES.invoice.subject);
  });

  it("prefers the user's own wording", () => {
    const saved = { templates: { invoice: { subject: 'Your bill', body: 'Pay up {number}' } } };
    expect(templateFor(saved, 'invoice')).toEqual({ subject: 'Your bill', body: 'Pay up {number}' });
  });

  it('fills every key the editor offers', () => {
    expect(Object.keys(allTemplates({}))).toEqual(TEMPLATE_KEYS);
    for (const key of TEMPLATE_KEYS) {
      expect(allTemplates({})[key]).toEqual(DEFAULT_TEMPLATES[key]);
    }
  });
});

describe('buildMessage', () => {
  it('writes a sendable invoice email', () => {
    const { subject, body } = buildMessage(invoice(), client, settings, {
      link: 'https://x.puter.site/a.html',
      payLink: 'https://paypal.me/aurora/1000.00USD',
    });
    expect(subject).toBe('Invoice INV-0042 from Aurora Studio');
    expect(body).toContain('Hi Maya Chen,');
    expect(body).toContain(`INV-0042 for ${usd(1000)}`);
    expect(body).toContain('https://x.puter.site/a.html');
    expect(body).toContain('https://paypal.me/aurora/1000.00USD');
    expect(body).toMatch(/Aurora Studio$/);
  });

  it('drops the optional lines when there is no link or pay link', () => {
    const { body } = buildMessage(invoice(), client, settings, {});
    expect(body).not.toContain('View or download');
    expect(body).not.toContain('Pay online');
    expect(body).not.toContain('{');
  });

  it('picks the estimate template for a quote', () => {
    const { subject, body } = buildMessage(quote(), client, settings, { link: 'https://x/y.html' });
    expect(subject).toBe('Estimate EST-0007 from Aurora Studio');
    expect(body).toContain('valid until Aug 20, 2026');
  });

  it('honors an explicit template key and extra values', () => {
    const s = { ...settings, templates: { reminder: { subject: '{number} is {days} days late', body: '{balance} outstanding' } } };
    const msg = buildMessage(invoice(), client, s, { templateKey: 'reminder', extra: { days: 12 } });
    expect(msg.subject).toBe('INV-0042 is 12 days late');
    expect(msg.body).toBe(`${usd(1000)} outstanding`);
  });
});

describe('mailtoUrl', () => {
  it('percent-encodes the subject and body', () => {
    const url = mailtoUrl({ to: 'maya@northwind.example', subject: 'Invoice INV-1', body: 'Hi,\n\nThanks' });
    expect(url).toBe('mailto:maya@northwind.example?subject=Invoice%20INV-1&body=Hi%2C%0A%0AThanks');
  });

  it('never form-encodes spaces as +', () => {
    expect(mailtoUrl({ subject: 'a b' })).not.toContain('+');
  });

  it('strips anything that could smuggle a header into the address', () => {
    expect(mailtoUrl({ to: 'a@b.co?bcc=evil@x.co' })).toBe('mailto:a@b.cobcc=evil@x.co');
    expect(mailtoUrl({ to: ' a@b.co\n' })).toBe('mailto:a@b.co');
  });

  it('strips a # so the address cannot swallow the message into a fragment', () => {
    expect(mailtoUrl({ to: 'maya#work@nw.example', subject: 'Invoice INV-1', body: 'hello' }))
      .toBe('mailto:mayawork@nw.example?subject=Invoice%20INV-1&body=hello');
  });

  it('omits empty parts', () => {
    expect(mailtoUrl({ to: 'a@b.co' })).toBe('mailto:a@b.co');
    expect(mailtoUrl({})).toBe('mailto:');
  });
});

describe('looksLikeEmail', () => {
  it('accepts ordinary addresses and rejects the rest', () => {
    expect(looksLikeEmail('maya@northwind.example')).toBe(true);
    expect(looksLikeEmail('maya')).toBe(false);
    expect(looksLikeEmail('maya@northwind')).toBe(false);
    expect(looksLikeEmail('a@b.co, c@d.co')).toBe(false);
    expect(looksLikeEmail('')).toBe(false);
  });

  it('refuses an address longer than the worker will take, which drops it silently', () => {
    expect(looksLikeEmail(`${'a'.repeat(240)}@northwind.example`)).toBe(false);
    expect(looksLikeEmail(`${'a'.repeat(200)}@northwind.example`)).toBe(true);
  });
});
