export const CURRENCIES = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'SEK', name: 'Swedish Krona' },
  { code: 'NOK', name: 'Norwegian Krone' },
  { code: 'DKK', name: 'Danish Krone' },
  { code: 'PLN', name: 'Polish Zloty' },
  { code: 'CZK', name: 'Czech Koruna' },
  { code: 'HUF', name: 'Hungarian Forint' },
  { code: 'TRY', name: 'Turkish Lira' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'ARS', name: 'Argentine Peso' },
  { code: 'CLP', name: 'Chilean Peso' },
  { code: 'ZAR', name: 'South African Rand' },
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'ILS', name: 'Israeli Shekel' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
  { code: 'KRW', name: 'South Korean Won' },
  { code: 'THB', name: 'Thai Baht' },
  { code: 'IDR', name: 'Indonesian Rupiah' },
  { code: 'PHP', name: 'Philippine Peso' },
  { code: 'MYR', name: 'Malaysian Ringgit' },
  { code: 'VND', name: 'Vietnamese Dong' },
  { code: 'NGN', name: 'Nigerian Naira' },
  { code: 'KES', name: 'Kenyan Shilling' },
  { code: 'EGP', name: 'Egyptian Pound' },
];

export const CURRENCY_CODES = new Set(CURRENCIES.map((c) => c.code));

const SYMBOLS = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', '₩': 'KRW', '₺': 'TRY', 'R$': 'BRL', 'zł': 'PLN', 'Kč': 'CZK', 'CHF': 'CHF', '₪': 'ILS', '₫': 'VND', '₦': 'NGN', '฿': 'THB' };

/** Map an OCR'd currency hint (code or symbol) to an ISO code, or null. */
export function resolveCurrency(hint, fallback = null) {
  if (!hint) return fallback;
  const s = String(hint).trim();
  const up = s.toUpperCase();
  if (CURRENCY_CODES.has(up)) return up;
  for (const [sym, code] of Object.entries(SYMBOLS)) {
    if (s.includes(sym)) return code;
  }
  return fallback;
}
