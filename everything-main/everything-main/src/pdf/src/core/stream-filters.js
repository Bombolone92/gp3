import { PDFArray, PDFDict, PDFName } from 'pdf-lib';
// Every module that parses or decodes PDF objects comes through here, so these apply to all.
import './pdf-names.js';
import './stream-limits.js';

const protections = new WeakMap();
/** A transaction's original cipher settings are needed when combining unlike streams. */
export function rememberStreamProtection(context, protection) {
  if (protection) protections.set(context, protection);
}

function cryptChoice(dict) {
  const filters = dict.lookup(PDFName.of('Filter'));
  const index =
    filters instanceof PDFArray
      ? filters.asArray().findIndex((filter) => dict.context.lookup(filter) === PDFName.of('Crypt'))
      : filters === PDFName.of('Crypt')
        ? 0
        : -1;
  if (index < 0) return null;
  const parms = dict.lookup(PDFName.of('DecodeParms'));
  const value = parms instanceof PDFArray ? parms.get(index) : dict.get(PDFName.of('DecodeParms'));
  const param = dict.context.lookup(value);
  const name = param instanceof PDFDict ? param.lookup(PDFName.of('Name')) : undefined;
  return { value: value ?? null, name: name instanceof PDFName ? name : PDFName.of('Identity') };
}

/** Keep a source's cipher when rewriting its compression or combining page contents. */
export function retainCryptFilter(dict, sources) {
  const choices = sources.map(cryptChoice);
  if (!choices.some(Boolean)) return;
  const protection = protections.get(dict.context);
  let chosen;
  if (protection) {
    const method = (choice) => {
      if (!choice) return protection.security.streamMethod;
      if (choice.name === PDFName.of('Identity')) return 'None';
      if (protection.security.V < 4) return protection.security.streamMethod;
      const cf = protection.dict.lookup(PDFName.of('CF'));
      const filter = cf instanceof PDFDict ? cf.lookup(choice.name) : undefined;
      const cfm = filter instanceof PDFDict ? filter.lookup(PDFName.of('CFM')) : undefined;
      return cfm instanceof PDFName ? cfm.decodeText() : 'None';
    };
    const strength = { None: 0, V2: 1, AESV2: 2, AESV3: 3 };
    chosen = choices.reduce((best, choice) =>
      strength[method(choice)] > strength[method(best)] ? choice : best,
    );
  } else {
    // Ordinary callers have no original encryption dictionary. Keep a named selector
    // over an Identity exemption; implicit defaults take precedence over Identity.
    chosen =
      choices.find((choice) => choice && choice.name !== PDFName.of('Identity')) ??
      (choices.includes(null) ? null : choices[0]);
  }
  if (!chosen) return;
  const filter = dict.lookup(PDFName.of('Filter'));
  const filters =
    filter instanceof PDFArray ? filter.asArray() : filter ? [dict.get(PDFName.of('Filter'))] : [];
  const parms = dict.lookup(PDFName.of('DecodeParms'));
  const parameters =
    parms instanceof PDFArray
      ? parms.asArray()
      : filters.map((_, i) => (i === 0 ? (dict.get(PDFName.of('DecodeParms')) ?? null) : null));
  dict.set(PDFName.of('Filter'), dict.context.obj(['Crypt', ...filters]));
  dict.set(PDFName.of('DecodeParms'), dict.context.obj([chosen.value, ...parameters]));
}

/** Crypt is handled by the security layer; preserve the other filters and their parameters. */
export function withoutCryptFilter(dict) {
  const filters = dict.lookup(PDFName.of('Filter'));
  if (filters === PDFName.of('Crypt')) {
    const decoded = dict.clone();
    decoded.delete(PDFName.of('Filter'));
    decoded.delete(PDFName.of('DecodeParms'));
    return decoded;
  }
  if (!(filters instanceof PDFArray)) return dict;
  const keep = filters
    .asArray()
    .map((filter, index) => ({ filter, index }))
    .filter(({ filter }) => dict.context.lookup(filter) !== PDFName.of('Crypt'));
  if (keep.length === filters.size()) return dict;
  const decoded = dict.clone();
  if (!keep.length) {
    decoded.delete(PDFName.of('Filter'));
    decoded.delete(PDFName.of('DecodeParms'));
  } else {
    decoded.set(PDFName.of('Filter'), dict.context.obj(keep.map(({ filter }) => filter)));
    const parms = dict.lookup(PDFName.of('DecodeParms'));
    if (parms instanceof PDFArray)
      decoded.set(
        PDFName.of('DecodeParms'),
        dict.context.obj(keep.map(({ index }) => parms.get(index) ?? null)),
      );
  }
  return decoded;
}
