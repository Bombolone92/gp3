import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OFFER_TEMPLATE,
  canTransition,
  expiringOffers,
  isOpenOffer,
  offerLetterText,
  offerTemplate,
  renderOfferLetter,
  validateOffer,
} from '../src/core/offers.js';

describe('canTransition', () => {
  it('follows the lifecycle draft → sent → signed/declined', () => {
    expect(canTransition('draft', 'sent')).toBe(true);
    expect(canTransition('draft', 'withdrawn')).toBe(true);
    expect(canTransition('draft', 'signed')).toBe(false);
    expect(canTransition('sent', 'signed')).toBe(true);
    expect(canTransition('sent', 'declined')).toBe(true);
    expect(canTransition('signed', 'sent')).toBe(false);
    expect(canTransition('declined', 'sent')).toBe(false);
    expect(canTransition('bogus', 'sent')).toBe(false);
  });
});

describe('isOpenOffer', () => {
  it('is true for draft and sent only', () => {
    expect(isOpenOffer({ status: 'draft' })).toBe(true);
    expect(isOpenOffer({ status: 'sent' })).toBe(true);
    expect(isOpenOffer({ status: 'signed' })).toBe(false);
    expect(isOpenOffer({ status: 'withdrawn' })).toBe(false);
  });
});

describe('validateOffer', () => {
  it('accepts sensible terms', () => {
    expect(validateOffer({ salary: 90000, startDate: '2026-06-01', expires: '2026-05-01' })).toEqual([]);
  });

  it('requires a positive salary and a start date', () => {
    expect(validateOffer({ salary: 0, startDate: '2026-06-01' })).toHaveLength(1);
    expect(validateOffer({ salary: 'abc', startDate: '2026-06-01' })).toHaveLength(1);
    expect(validateOffer({ salary: 90000, startDate: 'soon' })).toHaveLength(1);
  });

  it('wants the expiry before the start date', () => {
    expect(validateOffer({ salary: 90000, startDate: '2026-06-01', expires: '2026-07-01' })).toHaveLength(1);
  });

  it('rejects a negative or non-numeric signing bonus, allowing omissions', () => {
    expect(validateOffer({ salary: 90000, startDate: '2026-06-01', bonus: -500 })).toHaveLength(1);
    expect(validateOffer({ salary: 90000, startDate: '2026-06-01', bonus: 'lots' })).toHaveLength(1);
    expect(validateOffer({ salary: 90000, startDate: '2026-06-01', bonus: 5000 })).toEqual([]);
    expect(validateOffer({ salary: 90000, startDate: '2026-06-01', bonus: null })).toEqual([]);
    expect(validateOffer({ salary: 90000, startDate: '2026-06-01', bonus: '' })).toEqual([]);
  });
});

describe('expiringOffers', () => {
  const now = new Date('2026-03-20T12:00:00');

  it('flags sent offers expiring within the window, or already expired', () => {
    const offers = [
      { status: 'sent', expires: '2026-03-21' },
      { status: 'sent', expires: '2026-03-19' },
      { status: 'sent', expires: '2026-04-15' },
      { status: 'draft', expires: '2026-03-21' },
      { status: 'sent', expires: null },
    ];
    const flagged = expiringOffers(offers, { withinDays: 3, now });
    expect(flagged).toHaveLength(2);
  });
});

describe('offerLetterText', () => {
  const offer = {
    salary: 98000,
    currency: 'EUR',
    bonus: 5000,
    equity: '0.1% over 4 years',
    startDate: '2026-06-01',
    expires: '2026-04-01',
    notes: 'Relocation support included.',
    status: 'sent',
    sentAt: '2026-03-20T10:00:00Z',
  };
  const candidate = { name: 'Amara Okafor' };
  const job = { title: 'Senior Frontend Engineer', department: 'Engineering' };

  it('mentions the person, role, and every term', () => {
    const text = offerLetterText(offer, candidate, job, { companyName: 'Acme', now: new Date('2026-03-20') });
    expect(text).toContain('Dear Amara Okafor');
    expect(text).toContain('Senior Frontend Engineer');
    expect(text).toContain('Engineering');
    expect(text).toContain('98,000');
    expect(text).toContain('5,000');
    expect(text).toContain('0.1% over 4 years');
    expect(text).toContain('Relocation support included.');
    expect(text).toContain('Acme');
    expect(text).not.toContain('Signed electronically');
  });

  it('appends the e-signature block once signed', () => {
    const signed = { ...offer, status: 'signed', signerName: 'Amara Okafor', signedAt: '2026-03-22T09:00:00Z' };
    const text = offerLetterText(signed, candidate, job, { companyName: 'Acme', now: new Date('2026-03-22') });
    expect(text).toContain('Signed electronically by Amara Okafor');
  });

  it('omits optional terms it does not have', () => {
    const bare = { salary: 70000, currency: 'USD', bonus: null, equity: '', startDate: '2026-06-01', status: 'draft' };
    const text = offerLetterText(bare, candidate, job, { now: new Date('2026-03-20') });
    expect(text).not.toContain('Signing bonus');
    expect(text).not.toContain('Equity');
  });

  it('renders through a customized template from settings', () => {
    const settings = { offerTemplate: 'OFFER for {{name}}: {{salary}} at {{company}}.\nPerk: {{bonus}}\n{{unknown}} whole line drops.' };
    const text = offerLetterText(offer, candidate, job, {
      companyName: 'Acme',
      now: new Date('2026-03-20'),
      template: offerTemplate(settings),
    });
    // The {{unknown}} line renders empty, so the line-drop rule removes it —
    // which is why the settings editor warns about unknown placeholders.
    expect(text).toBe('OFFER for Amara Okafor: €98,000 at Acme.\nPerk: €5,000');
  });

  it('offerTemplate falls back to the default for absent or blank overrides', () => {
    expect(offerTemplate(null)).toBe(DEFAULT_OFFER_TEMPLATE);
    expect(offerTemplate({ offerTemplate: '   ' })).toBe(DEFAULT_OFFER_TEMPLATE);
    expect(offerTemplate({ offerTemplate: 'Hi {{name}}' })).toBe('Hi {{name}}');
  });

  it('drops lines whose placeholders all render empty, collapsing the gap', () => {
    const text = renderOfferLetter('Top\n\nBonus: {{bonus}}\n\nMiddle {{name}}\n\n{{signature}}', {
      bonus: '',
      name: 'Ada',
      signature: '',
    });
    expect(text).toBe('Top\n\nMiddle Ada');
  });

  it('treats inherited object members as empty, dropping their lines', () => {
    expect(renderOfferLetter('Top\nB {{hasOwnProperty}}\n{{name}}', { name: 'Ada' })).toBe('Top\nAda');
  });

  it('dates the letter and signature on the local day, not the UTC day', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      // Sent and signed Friday Mar 20, 8:30 PM in Los Angeles — already
      // Mar 21 in UTC. The letter must carry the sender's calendar day.
      const signed = {
        ...offer,
        status: 'signed',
        signerName: 'Amara Okafor',
        sentAt: '2026-03-21T03:30:00.000Z',
        signedAt: '2026-03-21T03:30:00.000Z',
      };
      const text = offerLetterText(signed, candidate, job, { companyName: 'Acme', now: new Date('2026-03-21T03:31:00.000Z') });
      expect(text).toContain('Mar 20 · Acme');
      expect(text).toContain('on Mar 20');
      expect(text).not.toContain('Mar 21');
    } finally {
      process.env.TZ = tz;
    }
  });
});
