/**
 * The sentence a zero-tax invoice has to carry.
 *
 * The app can already produce a correct zero-tax document — a document's
 * taxes list can be empty, and one line can opt out with `taxes: []` — but a
 * *compliant* one has to say why. An EU freelancer invoicing a business in
 * another member state must print words to the effect of "reverse charge";
 * an exporter must state the zero-rating; a US supplier billing a reseller
 * needs the exemption on the face of the document.
 *
 * Stored as a short string on the document, the client, or settings:
 *   ''                     inherit (client, then settings)
 *   'none'                 explicitly print nothing
 *   'preset:reverseCharge' one of the shipped sentences, printed in the
 *                          document's own language
 *   anything else          the user's own wording, printed verbatim
 *
 * Absent everywhere is today's behaviour exactly: nothing is printed.
 */

import { docTotals, docTaxes } from './money.js';
import { translator } from './i18n.js';

/** The wordings offered in the pickers, in the order they are shown. */
export const TAX_NOTE_PRESETS = [
  {
    id: 'preset:reverseCharge',
    trKey: 'taxNoteReverseCharge',
    label: 'Reverse charge (EU business customer)',
  },
  {
    id: 'preset:zeroRated',
    trKey: 'taxNoteZeroRated',
    label: 'Zero-rated export',
  },
  {
    id: 'preset:exempt',
    trKey: 'taxNoteExempt',
    label: 'Exempt / resale certificate',
  },
  {
    id: 'preset:smallBusiness',
    trKey: 'taxNoteSmallBusiness',
    label: 'Small-business exemption',
  },
];

const PRESET_BY_ID = new Map(TAX_NOTE_PRESETS.map((p) => [p.id, p]));

/** Is this stored value one of the shipped sentences? */
export function isTaxNotePreset(value) {
  return PRESET_BY_ID.has(String(value || ''));
}

/**
 * The stored value that applies to one document: its own first, then its
 * client's, then the global default. '' inherits at every level, and 'none'
 * stops the search with "print nothing" — the same shape as the late-fee
 * override, because an exempt-by-default account still sends the occasional
 * ordinary invoice.
 */
export function taxNoteValue(settings, doc = null, client = null) {
  const pick = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  return pick(doc?.taxNote) || pick(client?.taxNote) || pick(settings?.taxNote) || '';
}

/**
 * One stored value as the sentence to print. A preset is translated into the
 * document's language; anything else is the user's own words and prints
 * exactly as typed.
 */
export function taxNoteText(value, tr = translator('')) {
  const stored = String(value || '').trim();
  if (!stored || stored === 'none') return '';
  const preset = PRESET_BY_ID.get(stored);
  return preset ? tr(preset.trKey) : stored;
}

/**
 * Does this document charge no tax on something? True when it charges no tax
 * at all, and also when a single line has opted out while the rest is taxed —
 * that untaxed line is exactly what the sentence explains.
 */
export function chargesUntaxed(doc) {
  if (docTotals(doc).tax <= 0.005) return true;
  const defaults = docTaxes(doc).filter((t) => Number(t?.rate) > 0);
  return (doc?.items || []).some((it) => {
    const own = Array.isArray(it?.taxes) ? it.taxes.filter((t) => Number(t?.rate) > 0) : defaults;
    return !own.length;
  });
}

/**
 * The note this document prints, derived rather than passed in — like the
 * pay link, the payment instructions, and the late-fee disclosure — so the
 * preview, the print, the PDF, and the published page can never disagree.
 * A document that charges tax on everything prints nothing: the sentence
 * explains an absence of tax, and on a fully taxed invoice it would be a
 * contradiction.
 */
export function docTaxNote(settings, doc, client = null, tr = translator('')) {
  if (!chargesUntaxed(doc)) return '';
  return taxNoteText(taxNoteValue(settings, doc, client), tr);
}
