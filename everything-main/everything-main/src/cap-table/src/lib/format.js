/**
 * Display formatting.
 *
 * Money wears the active company's currency (USD unless the profile says
 * otherwise), so a UK company reads its own figures back in pounds. The
 * digit grouping stays en-US on purpose: every number field in the app is
 * parsed by `parseNum`, which reads "1,500.50" and not "1.500,50", and a
 * figure displayed in one convention but only accepted in the other is a
 * figure the user will retype wrong.
 *
 * The active code is set from the company record (see setCurrency) rather
 * than read from the store, so this module stays free of app state.
 */

import { tidy } from './util.js';

const DEFAULT_CURRENCY = 'USD';

/**
 * The currencies the company profile offers. Any well-formed ISO 4217 code
 * an import carries is honored too - this list is the picker, not the rule.
 */
export const CURRENCIES = [
  { code: 'USD', label: 'US dollar' },
  { code: 'EUR', label: 'Euro' },
  { code: 'GBP', label: 'Pound sterling' },
  { code: 'CAD', label: 'Canadian dollar' },
  { code: 'AUD', label: 'Australian dollar' },
  { code: 'NZD', label: 'New Zealand dollar' },
  { code: 'CHF', label: 'Swiss franc' },
  { code: 'SEK', label: 'Swedish krona' },
  { code: 'NOK', label: 'Norwegian krone' },
  { code: 'DKK', label: 'Danish krone' },
  { code: 'PLN', label: 'Polish złoty' },
  { code: 'CZK', label: 'Czech koruna' },
  { code: 'TRY', label: 'Turkish lira' },
  { code: 'ILS', label: 'Israeli new shekel' },
  { code: 'AED', label: 'UAE dirham' },
  { code: 'SAR', label: 'Saudi riyal' },
  { code: 'ZAR', label: 'South African rand' },
  { code: 'NGN', label: 'Nigerian naira' },
  { code: 'KES', label: 'Kenyan shilling' },
  { code: 'EGP', label: 'Egyptian pound' },
  { code: 'INR', label: 'Indian rupee' },
  { code: 'PKR', label: 'Pakistani rupee' },
  { code: 'SGD', label: 'Singapore dollar' },
  { code: 'HKD', label: 'Hong Kong dollar' },
  { code: 'JPY', label: 'Japanese yen' },
  { code: 'KRW', label: 'South Korean won' },
  { code: 'CNY', label: 'Chinese yuan' },
  { code: 'TWD', label: 'New Taiwan dollar' },
  { code: 'MYR', label: 'Malaysian ringgit' },
  { code: 'IDR', label: 'Indonesian rupiah' },
  { code: 'PHP', label: 'Philippine peso' },
  { code: 'THB', label: 'Thai baht' },
  { code: 'VND', label: 'Vietnamese đồng' },
  { code: 'BRL', label: 'Brazilian real' },
  { code: 'MXN', label: 'Mexican peso' },
  { code: 'CLP', label: 'Chilean peso' },
  { code: 'COP', label: 'Colombian peso' },
  { code: 'ARS', label: 'Argentine peso' },
];

/**
 * The ISO 4217 codes this runtime knows how to format, when it can say.
 * Intl accepts any three letters and renders an unknown one as the letters
 * themselves ("ZZZ 1,000.00"), which is how a typo in a hand-edited import
 * would end up labelling every figure in the app.
 */
const KNOWN_CODES = (() => {
  try {
    return new Set(Intl.supportedValuesOf('currency'));
  } catch {
    return null;
  }
})();

/** A stored or typed currency code, or USD when it isn't a currency. */
export function normalizeCurrency(code) {
  const c = String(code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) return DEFAULT_CURRENCY;
  // No list to check against (an older runtime): a well-formed code is taken
  // at its word rather than silently turned into dollars.
  if (KNOWN_CODES && !KNOWN_CODES.has(c)) return DEFAULT_CURRENCY;
  return c;
}

let currency = DEFAULT_CURRENCY;
/* Formatters are cached per currency - constructing an Intl.NumberFormat is
   the expensive part, and a cap table render calls these hundreds of times. */
const cache = new Map();

/** Point the money formatters at a currency. Returns the code in force. */
export function setCurrency(code) {
  currency = normalizeCurrency(code);
  return currency;
}

/** The currency code money is being formatted in. */
export function currencyCode() {
  return currency;
}

/**
 * The symbol for the active currency - "$", "£", "¥" - for field labels that
 * ask for an amount. Narrow symbol, so a GBP company reads "£" rather than
 * the disambiguating forms Intl uses in prose.
 */
export function currencySymbol(code = currency) {
  for (const display of ['narrowSymbol', 'symbol']) {
    try {
      const parts = new Intl.NumberFormat('en-US', {
        style: 'currency', currency: code, currencyDisplay: display,
      }).formatToParts(0);
      const symbol = parts.find((part) => part.type === 'currency')?.value;
      if (symbol) return symbol;
    } catch {
      // currencyDisplay: 'narrowSymbol' is newer than the rest of Intl;
      // where it is missing, the plain symbol is the right answer.
    }
  }
  return code;
}

/** The picker's label for a code, for prose that names the currency. */
export function currencyLabel(code = currency) {
  return CURRENCIES.find((c) => c.code === code)?.label || code;
}

function nf(key, options) {
  const id = `${currency}:${key}`;
  let formatter = cache.get(id);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency, ...options });
    cache.set(id, formatter);
  }
  return formatter;
}

const intFmt = new Intl.NumberFormat('en-US');
/* Grouped, but not rounded to whole units - see amountValue. */
const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function money(n) {
  const v = Number(n) || 0;
  // Share prices are often sub-cent; keep 4 decimals when cents would round to 0.
  if (v !== 0 && Math.abs(v) < 0.01) {
    return nf('sub', { minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(v);
  }
  return nf('money').format(v);
}

/** Whole-unit money for large figures (valuations, raise amounts). */
export function moneyWhole(n) {
  return nf('whole', { maximumFractionDigits: 0 }).format(Number(n) || 0);
}

/**
 * A statutory US-dollar figure - the ISO $100,000 limit - printed as dollars
 * whatever the company banks in. Through `moneyWhole` the limit relabelled
 * itself in the company's currency, so a UK company read "over the £100,000
 * ISO limit", a figure the Code never wrote. The reports view does the same
 * for Rule 701's thresholds with a formatter of its own.
 */
const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export function moneyUSD(n) {
  return usdWhole.format(Number(n) || 0);
}

/** Compact money for stat tiles: $4.2M, $850K. */
export function moneyCompact(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 10_000) {
    // minimumFractionDigits: 0, or engines that default it to the currency's
    // two decimals (Node 22's V8) print "$250.0K".
    return nf('compact', { notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(v);
  }
  // Under a dollar the cents are the figure: a company whose only price is a
  // $0.0001 par read "Capital raised $0" and "Implied valuation $0".
  if (v !== 0 && Math.abs(v) < 1) return money(v);
  return moneyWhole(v);
}

/** Share price with up to 4 decimals (option strikes, PPS). */
export function sharePrice(n) {
  const v = Number(n) || 0;
  /* Par value runs below a ten-thousandth: a Delaware C-corp's common is
     routinely $0.00001, and a forward split takes whatever it was lower
     still. Four decimals round that to nothing and the minimum of two then
     trims the zeros off, so the class's issue price - on the share classes
     table, in the cap table export, on the printed report - read "$0.00".
     Below the point where four decimals can hold it, the price is given the
     digits it needs, the same way `money` does for sub-cent amounts. */
  if (v !== 0 && Math.abs(v) < 0.0001) {
    return nf('subprice', { minimumFractionDigits: 4, maximumFractionDigits: 8 }).format(v);
  }
  return nf('price', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v);
}

/**
 * A plain grouped number for pre-filling an amount field: "18,000,000".
 *
 * Not `moneyWhole`, because the field's own label already carries the
 * currency and the symbol would have to be typed back out. Not `String(n)`
 * either: every figure this app displays is grouped, the placeholders under
 * these fields demonstrate grouping, and `parseNum` reads it straight back -
 * so a saved scenario read back as a bare run of digits leaves the reader
 * counting them to tell 18 million from 1.8 million.
 */
export function amountValue(n) {
  /* Grouped on the whole part only; the fraction is carried as written. The
     formatter rounded to two decimals, so a principal of 250,000.555 reopened
     in its sheet as 250,000.56, and an unrelated edit saved the rounded
     figure back under a toast saying the record was updated.

     And never shortened: decimalValue tidies to twelve significant digits,
     which is right for a price a split has divided but cut a count or an
     amount past a trillion - a 1,234,567,890,123-share certificate opened
     as 1,234,567,890,120 and a rupiah valuation cap lost its last three
     digits - and the same unrelated edit saved the shorter figure back. A
     whole figure prints as it is (an integer under 1e21 has no exponent to
     expand); one with a fraction keeps fifteen digits, enough for the
     largest figure a record holds with cents behind it, while a division's
     noise still comes off. */
  const v = Number(n) || 0;
  const [whole, fraction] = (Number.isInteger(v) ? String(v) : decimalValue(v, 15)).split('.');
  return `${grouped.format(Number(whole))}${fraction ? `.${fraction}` : ''}`;
}

/**
 * A number written out in full for prefilling a field: "0.0000001", never
 * "1e-7".
 *
 * JavaScript switches to exponent notation below a millionth, and `parseNum`
 * reads plain decimal only - deliberately, since nobody types "1e3" into a
 * share count on purpose. So a price a forward split had taken that small was
 * prefilled in a notation the form's own parser refuses, and saving the
 * record back unchanged failed validation until the user retyped the app's
 * number by hand.
 *
 * The exponent is expanded rather than rounded away: `String(n)` is already
 * the shortest text that reads back as exactly this double, so moving its
 * point keeps the value to the last digit. `toFixed` would have to guess how
 * many decimals are enough and would quietly drop the rest.
 */
export function decimalValue(n, precision = 12) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  // Less the noise a division left on it: a record written by an older
  // split, or imported, can still carry 6.300000000000001 for 6.3.
  const s = String(tidy(v, precision));
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(s);
  if (!m) return s;
  const [, sign, whole, frac = '', exp] = m;
  const digits = whole + frac;
  // Where the point lands once the exponent is applied.
  const point = whole.length + Number(exp);
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** A share count with its unit: "1 share", "2,500 shares". */
export function sharesLabel(n) {
  return countLabel(n, 'share');
}

/**
 * A count with the noun it counts, in the number the count calls for: "1
 * option", "2,500 options". Regular plurals only, which is every unit an
 * award is counted in here.
 */
export function countLabel(n, noun) {
  return `${shares(n)} ${Math.round(Number(n) || 0) === 1 ? noun : `${noun}s`}`;
}

export function shares(n) {
  return intFmt.format(Math.round(Number(n) || 0));
}

/** Compact share count for stat tiles: 12.5M, 840K. */
export function sharesCompact(n) {
  const v = Math.round(Number(n) || 0);
  if (Math.abs(v) >= 10_000) {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  }
  return intFmt.format(v);
}

/**
 * The percent figure a fraction was typed as, as a number: 0.07 reads back
 * as 7, not the 7.000000000000001 that multiplying by 100 leaves behind.
 * For a field that will be saved again, and for a rate quoted in prose;
 * pct() below formats a share of something to fixed decimals.
 */
export function percentValue(fraction) {
  return tidy((Number(fraction) || 0) * 100, 10);
}

/**
 * Ownership percentage from a 0..1 fraction. Tiny-but-real stakes show as
 * "<0.01%" rather than a misleading "0.00%".
 */
export function pct(fraction, digits = 2) {
  const v = Number(fraction) || 0;
  /* The floor follows the digits shown, as the ceiling below does: at no
     decimals a 0.005% stake read "<0.01%" beside a 0.4% stake reading "0%",
     the smaller figure shown finer than the larger. */
  const unit = 10 ** -digits;
  if (v > 0 && v * 100 < unit) return `<${unit.toFixed(digits)}%`;
  const out = `${(v * 100).toFixed(digits)}%`;
  /* And the mirror at the top: a 99.996% stake rounded to "100.00%" beside
     a holder listed at "<0.01%", an ownership table saying one holder owns
     everything while naming another. */
  if (v < 1 && out === `${(100).toFixed(digits)}%`) return `>${(100 - 10 ** -digits).toFixed(digits)}%`;
  return out;
}

/* Built once, like the money formatters above: toLocaleDateString builds a
   formatter per call, and the register and cap table ask for a few thousand
   dates per render. */
const longDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** 'YYYY-MM-DD' → 'Mar 12, 2024'. Returns the input when unparseable. */
export function dateLong(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso ?? '');
  return longDate.format(d);
}

/** Like dateLong, but drops the year when it matches the reference date. */
export function dateShort(iso, referenceISO) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso ?? '');
  const sameYear = String(referenceISO ?? '').slice(0, 4) === String(iso ?? '').slice(0, 4);
  return d.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

/** 'YYYY-MM' → 'Mar 2026', for the month buckets of a forecast. */
export function monthLabel(ym) {
  const d = new Date(`${String(ym ?? '').slice(0, 7)}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(ym ?? '');
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * Relative time for the activity feed: 'just now', '3d ago', 'Mar 12', and
 * 'Mar 12, 2025' once the day falls in another year. The log keeps sixty
 * entries and a restore point lives as long as the company does, so a line
 * from a year or two back is ordinary here - and read without its year, "Sep
 * 5" beside "latest restore point" said the snapshot was taken yesterday.
 */
export function timeAgo(ts) {
  const now = Date.now();
  const diff = now - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const then = new Date(ts);
  const sameYear = then.getFullYear() === new Date(now).getFullYear();
  return then.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}
