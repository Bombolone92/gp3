import { describe, it, expect } from 'vitest';
import {
  TAX_NOTE_PRESETS, chargesUntaxed, docTaxNote, isTaxNotePreset, taxNoteText, taxNoteValue,
} from '../src/lib/taxnote.js';
import { translator, STRINGS } from '../src/lib/i18n.js';

const invoice = (over = {}) => ({
  kind: 'invoice',
  currency: 'EUR',
  items: [{ name: 'Design', qty: 1, rate: 1000 }],
  taxes: [],
  discountType: 'none',
  discountValue: 0,
  payments: [],
  ...over,
});

const settings = { taxLabel: 'VAT' };

describe('resolving which note applies', () => {
  it('prefers the document, then the client, then settings', () => {
    expect(taxNoteValue({ taxNote: 'global' }, { taxNote: 'doc' }, { taxNote: 'client' })).toBe('doc');
    expect(taxNoteValue({ taxNote: 'global' }, {}, { taxNote: 'client' })).toBe('client');
    expect(taxNoteValue({ taxNote: 'global' }, {}, {})).toBe('global');
    expect(taxNoteValue({}, {}, {})).toBe('');
  });

  it('lets an explicit "none" stop the search', () => {
    expect(taxNoteValue({ taxNote: 'global' }, { taxNote: 'none' }, null)).toBe('none');
    expect(taxNoteText('none')).toBe('');
  });

  it('treats blank strings as inheriting, not as content', () => {
    expect(taxNoteValue({ taxNote: 'global' }, { taxNote: '   ' }, { taxNote: '' })).toBe('global');
  });
});

describe('the printed sentence', () => {
  it('translates a preset into the document’s language', () => {
    expect(taxNoteText('preset:reverseCharge')).toBe(STRINGS.en.taxNoteReverseCharge);
    expect(taxNoteText('preset:reverseCharge', translator('de'))).toBe(STRINGS.de.taxNoteReverseCharge);
  });

  it('prints the user’s own wording verbatim, in any language', () => {
    expect(taxNoteText('Steuerfrei nach Vereinbarung', translator('fr'))).toBe('Steuerfrei nach Vereinbarung');
  });

  it('knows its own presets', () => {
    for (const p of TAX_NOTE_PRESETS) expect(isTaxNotePreset(p.id)).toBe(true);
    expect(isTaxNotePreset('reverseCharge')).toBe(false);
    expect(isTaxNotePreset('')).toBe(false);
  });
});

describe('when a document charges no tax', () => {
  it('is true for a document with no tax at all', () => {
    expect(chargesUntaxed(invoice())).toBe(true);
    expect(chargesUntaxed(invoice({ taxRate: 0 }))).toBe(true);
  });

  it('is false when every line is taxed', () => {
    expect(chargesUntaxed(invoice({ taxes: [{ label: 'VAT', rate: 20 }] }))).toBe(false);
  });

  it('is true when one line opted out of a taxed document', () => {
    const doc = invoice({
      taxes: [{ label: 'VAT', rate: 20 }],
      items: [
        { name: 'Design', qty: 1, rate: 1000 },
        { name: 'Disbursement', qty: 1, rate: 40, taxes: [] },
      ],
    });
    expect(chargesUntaxed(doc)).toBe(true);
  });
});

describe('docTaxNote', () => {
  it('prints the inherited sentence on a zero-tax document', () => {
    const note = docTaxNote({ ...settings, taxNote: 'preset:reverseCharge' }, invoice(), null, translator(''));
    expect(note).toBe(STRINGS.en.taxNoteReverseCharge);
  });

  it('stays off a document that charges tax on everything', () => {
    const doc = invoice({ taxes: [{ label: 'VAT', rate: 20 }] });
    expect(docTaxNote({ ...settings, taxNote: 'preset:reverseCharge' }, doc, null)).toBe('');
  });

  it('says nothing when nothing is configured anywhere', () => {
    expect(docTaxNote(settings, invoice(), null)).toBe('');
  });

  it('lets a client’s wording beat the global one, and a document beat both', () => {
    const client = { taxNote: 'preset:zeroRated' };
    const global = { ...settings, taxNote: 'preset:reverseCharge' };
    expect(docTaxNote(global, invoice(), client)).toBe(STRINGS.en.taxNoteZeroRated);
    expect(docTaxNote(global, invoice({ taxNote: 'none' }), client)).toBe('');
    expect(docTaxNote(global, invoice({ taxNote: 'Custom words' }), client)).toBe('Custom words');
  });
});
