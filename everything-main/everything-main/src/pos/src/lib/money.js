export const CURRENCIES = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'SEK', name: 'Swedish Krona' },
  { code: 'NOK', name: 'Norwegian Krone' },
  { code: 'DKK', name: 'Danish Krone' },
  { code: 'PLN', name: 'Polish Zloty' },
  { code: 'CZK', name: 'Czech Koruna' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'KRW', name: 'South Korean Won' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'ZAR', name: 'South African Rand' },
  { code: 'TRY', name: 'Turkish Lira' },
];

/** U+2212. The one mark this app writes a negative amount with. */
const MINUS = '−';

const formatters = new Map();

function formatter(currency) {
  if (!formatters.has(currency)) {
    let f;
    try {
      f = new Intl.NumberFormat(undefined, { style: 'currency', currency });
      // Zero-decimal currencies (JPY, KRW): the app stores hundredths for
      // every currency, and discounts and taxes genuinely land on fractions.
      // Intl's default of zero digits rounded them away at display time, so
      // the printed receipt disagreed with the stored amounts, the CSV, and
      // the drawer's expected cash. Show the exact amount instead - whole
      // when it is whole, fractional when the math made it so.
      if (f.resolvedOptions().maximumFractionDigits === 0) {
        f = new Intl.NumberFormat(undefined, {
          style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2,
        });
      }
    } catch {
      f = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    formatters.set(currency, f);
  }
  return formatters.get(currency);
}

/** '$12.40' - locale-aware currency display. */
export function formatMoney(amount, currency = 'USD') {
  const n = Number(amount);
  // + 0 folds negative zero into plain zero: refund math negates its cents,
  // and an all-zero refund otherwise renders as "-$0.00".
  const value = Number.isFinite(n) ? n + 0 : 0;
  const f = formatter(currency);
  if (value >= 0) return f.format(value);
  // Everywhere this app negates a figure itself - a discount row, cash paid
  // out, a stock movement - it writes U+2212, the minus sign. Intl hands back
  // whatever sign the locale uses, a plain hyphen in most of them, so the
  // same £7.01 refund read "−$7.01" in the Reports tile and "-$7.01" on its
  // own receipt, and a refund slip printed both marks a line apart. Taken
  // apart, the sign is the only piece to swap and each locale keeps its own
  // placement of it. Only negatives pay for the walk.
  return f.formatToParts(value)
    .map((part) => (part.type === 'minusSign' ? MINUS : part.value))
    .join('');
}

/**
 * The bare symbol a currency prints with: '$', '€', 'kr', or the code itself
 * where the locale spells it out. Read back off the formatter rather than
 * kept in a table of our own, so it is always the same mark the amounts on
 * screen carry.
 *
 * For the controls that have to say "a cash amount, not a percentage" in the
 * width of a segmented button. `\s` covers the non-breaking space many
 * locales put between the number and its symbol.
 */
export function currencySymbol(currency = 'USD') {
  // No symbol at all means Intl refused the code and the fallback formatter
  // is printing bare numbers; the code is then the honest label, since "$"
  // would name a currency the amounts beside it are not in.
  return formatMoney(0, currency).replace(/[\d.,\s]/g, '') || currency;
}

/**
 * The two kinds of discount as a control has to offer them: the mark each is
 * written with, and the name that mark stands for - "$" is a fine thing to
 * read and a poor thing to announce.
 *
 * One list, because three controls ask this same question - a discount on a
 * line, on a whole sale, and on a saved preset - and each had grown its own
 * pair of labels for it. The marks match how the app states a discount
 * everywhere else, from a preset chip ("Staff · 20%", "Loyalty card · $2.00")
 * to the badge on a cart row.
 */
export function discountTypeChoices(currency) {
  return [
    { value: 'percent', label: '%', name: 'Percentage' },
    { value: 'fixed', label: currencySymbol(currency), name: 'Fixed amount' },
  ];
}

/**
 * Above this an amount is a typo, not money. The cap also keeps every
 * amount's cents (and any realistic sum of them) inside the range where
 * integers stay exact, which the cart math depends on.
 */
export const MAX_AMOUNT = 999_999_999.99;

/**
 * Parse a user-typed amount. Accepts ',' as a decimal separator and grouped
 * thousands where they're unambiguous ('1,234.56', '1.234,56', '1,000,000');
 * returns null for anything that isn't a non-negative finite number no
 * larger than MAX_AMOUNT.
 *
 * The one shape that is refused outright is a single three-digit comma
 * group like '1,000': that's a thousand on one keyboard and 1.000 on
 * another, and either silent guess records an amount a thousand times off
 * for somebody - a drawer counted at $1,250 must not book as $1.25.
 */
export function parseAmount(text) {
  let s = String(text ?? '').trim();
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Both separators present: the rightmost is the decimal mark, the other
    // is grouping. Anything malformed still dies in Number() below.
    const [grouping, decimal] = lastComma > lastDot ? ['.', ','] : [',', '.'];
    s = s.split(grouping).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    if (/^\d{1,3}(,\d{3}){2,}$/.test(s)) {
      s = s.split(',').join('');            // 1,000,000 - only grouping fits
    } else if (/^[1-9]\d{0,2},\d{3}$/.test(s)) {
      return null;                          // 1,000 - ambiguous, re-ask
    } else {
      s = s.replace(/,/g, '.');             // 2,50 - the comma decimal
    }
  } else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    s = s.split('.').join('');              // 1.000.000 - only grouping fits
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) return null;
  // Round the decimal the user typed, not the float's dust: 1.005 × 100 is
  // 100.4999…, so a bare Math.round sent '1.005' down to 1.00 while
  // '4.005' went up to 4.01. Twelve significant digits recover the typed
  // value exactly for everything the cap allows.
  return Math.round(Number((n * 100).toPrecision(12))) / 100;
}

/**
 * Parse a typed tax rate. Rates aren't money: the store keeps them to 3
 * decimals (NYC's 8.875% must survive the trip), and nothing over 100% is
 * a percentage anyone charges at a till. ',' works as a decimal separator.
 */
export function parseRate(text) {
  const s = String(text ?? '').trim().replace(/,/g, '.');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  // Same dust guard as parseAmount: '0.5005' must round half-up like its
  // neighbours, not fall to 0.5 because 0.5005 × 1000 is 500.4999….
  return Math.round(Number((n * 1000).toPrecision(12))) / 1000;
}
