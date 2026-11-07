/** Number and money formatting. */

const COMPACT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/* Constructing an Intl.NumberFormat resolves the locale and costs far more
   than formatting with one, and these run per card on the jobs grid and the
   offers list. Keep one per currency and shape — including the "Intl does
   not know this code" answer, so a bad code from a restored backup does not
   re-throw on every render either. Currency values come from the stored
   records, so the map is bounded by the dataset. */
const MONEY_FORMATS = new Map();

function moneyFormat(code, compact) {
  const key = `${compact ? 'c' : 'p'}:${code}`;
  if (MONEY_FORMATS.has(key)) return MONEY_FORMATS.get(key);
  let format = null;
  try {
    format = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      ...(compact ? { notation: 'compact', maximumFractionDigits: 1 } : { maximumFractionDigits: 0 }),
    });
  } catch {
    // Not a currency code Intl recognizes; the caller falls back below.
  }
  MONEY_FORMATS.set(key, format);
  return format;
}

/** '$120,000' — whole units, no cents. Falls back to a plain number for unknown codes. */
export function formatMoney(amount, currency = 'USD') {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '';
  // The default parameter only covers undefined; a null from a restored
  // backup would otherwise render literally as "null 120,000".
  const code = currency || 'USD';
  const format = moneyFormat(code, false);
  return format ? format.format(value) : `${code} ${value.toLocaleString()}`;
}

/** '$120k – $150k' for job cards; either bound may be missing. */
export function formatSalaryRange(min, max, currency = 'USD') {
  const lo = Number.isFinite(Number(min)) && min !== null && min !== '' ? Number(min) : null;
  const hi = Number.isFinite(Number(max)) && max !== null && max !== '' ? Number(max) : null;
  const code = currency || 'USD';
  const format = moneyFormat(code, true);
  const short = (v) => (format ? format.format(v) : `${code} ${COMPACT.format(v)}`);
  if (lo !== null && hi !== null) return lo === hi ? short(lo) : `${short(lo)} – ${short(hi)}`;
  if (lo !== null) return `From ${short(lo)}`;
  if (hi !== null) return `Up to ${short(hi)}`;
  return '';
}

export function plural(n, singular, pluralForm = `${singular}s`) {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/* Latin letters with a stroke or ligature have no NFKD decomposition, so
   the diacritic strip leaves them intact and the ASCII sweep would drop
   them — 'Łukasz' must not slug to 'ukasz'. */
const SLUG_FOLD = { ø: 'o', æ: 'ae', œ: 'oe', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ß: 'ss', ħ: 'h', ŋ: 'n', ı: 'i' };

/**
 * A person's name as a safe filename fragment: 'José García Jr.' →
 * 'jose-garcia-jr'. Diacritics fold to their base letters; when nothing
 * survives (a name in another script), the fallback stands in.
 */
export function fileSlug(name, fallback = 'candidate') {
  const slug = String(name ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[øæœłđðþßħŋı]/g, (ch) => SLUG_FOLD[ch])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

/** '824 B', '318 KB', '2.4 MB'; empty when the size is unknown. */
export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '';
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '';
  // Branch on the rounded value: picking the unit from the raw one lets
  // rounding overflow it ("1024 KB" for a size just under a megabyte).
  if (Math.round(value) < 1024) return `${Math.round(value)} B`;
  if (Math.round(value / 1024) < 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
