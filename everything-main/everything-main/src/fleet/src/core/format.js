/** Display helpers for records. Pure functions, safe to unit test. */

export function vehicleName(v) {
  if (!v) return 'Unknown vehicle';
  return v.name || [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Unnamed vehicle';
}

/** "2019 Ford Transit 250" style description, or '' */
export function vehicleDescription(v) {
  return v ? [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ') : '';
}

export function contactName(c) {
  if (!c) return '';
  return [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.email || 'Unnamed contact';
}

export function initials(name) {
  const parts = String(name || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function pluralize(n, one, many = `${one}s`) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

const numFormats = new Map();
export function formatNumber(n, digits = 0) {
  if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) return '';
  let f = numFormats.get(digits);
  if (!f) {
    f = new Intl.NumberFormat(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
    numFormats.set(digits, f);
  }
  return f.format(Number(n));
}

/** Number with up to `max` decimals, no trailing zeros. */
export function formatDecimal(n, max = 2) {
  if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) return '';
  const key = `d${max}`;
  let f = numFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(undefined, { maximumFractionDigits: max });
    numFormats.set(key, f);
  }
  return f.format(Number(n));
}

export const METER_UNITS = {
  mi: { short: 'mi', long: 'miles', one: 'mile' },
  km: { short: 'km', long: 'kilometers', one: 'kilometer' },
  hr: { short: 'hr', long: 'hours', one: 'hour' },
};

export const VOLUME_UNITS = {
  gal: { short: 'gal', long: 'gallons', one: 'gallon' },
  L: { short: 'L', long: 'liters', one: 'liter' },
  kWh: { short: 'kWh', long: 'kilowatt hours', one: 'kilowatt hour' },
};

export function formatMeter(value, unit = 'mi') {
  if (value === null || value === undefined || value === '') return '';
  return `${formatNumber(value)} ${METER_UNITS[unit]?.short || unit}`;
}

export function formatVolume(value, unit = 'gal') {
  if (value === null || value === undefined || value === '') return '';
  return `${formatDecimal(value, 3)} ${VOLUME_UNITS[unit]?.short || unit}`;
}

/**
 * Fuel economy display. Distance over volume for miles and gallons
 * ("24.5 mpg"); metric fleets read consumption ("9.6 L/100 km"); hour
 * meters read volume per hour.
 */
export function economyUnit(meterUnit, volumeUnit) {
  if (meterUnit === 'hr') return `${VOLUME_UNITS[volumeUnit]?.short || volumeUnit}/hr`;
  if (meterUnit === 'mi' && volumeUnit === 'gal') return 'mpg';
  if (meterUnit === 'km' && volumeUnit === 'L') return 'L/100 km';
  if (volumeUnit === 'kWh') return meterUnit === 'km' ? 'kWh/100 km' : 'mi/kWh';
  return `${meterUnit}/${VOLUME_UNITS[volumeUnit]?.short || volumeUnit}`;
}

/** Economy value in the display unit from a distance and a volume. */
export function economyValue(distance, volume, meterUnit, volumeUnit) {
  if (!(distance > 0) || !(volume > 0)) return null;
  if (meterUnit === 'hr') return volume / distance;
  if (meterUnit === 'km' && (volumeUnit === 'L' || volumeUnit === 'kWh')) return (volume / distance) * 100;
  return distance / volume;
}

/** Whether a higher economy number is better in this unit. */
export function economyHigherIsBetter(meterUnit, volumeUnit) {
  if (meterUnit === 'hr') return false;
  if (meterUnit === 'km' && (volumeUnit === 'L' || volumeUnit === 'kWh')) return false;
  return true;
}

export function formatEconomy(value, meterUnit, volumeUnit) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return `${formatDecimal(value, 2)} ${economyUnit(meterUnit, volumeUnit)}`;
}

/** Colors for avatars and charts: distinct hues readable with white text. */
export const AVATAR_COLORS = ['#3b46c4', '#0f7b6c', '#b4441c', '#7a3fc2', '#b0306a', '#4b6b16', '#a1520b', '#2f6f9f', '#55606e', '#8e2f2f'];

export function colorFor(key) {
  let hash = 0;
  for (const ch of String(key || '')) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** Case- and accent-insensitive search normalization. */
export function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function matches(haystack, query) {
  const q = normalize(query).trim();
  if (!q) return true;
  const h = normalize(haystack);
  return q.split(/\s+/).every((t) => h.includes(t));
}

export function telHref(number) {
  const digits = String(number || '').replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : null;
}

export function mapsUrl(address) {
  const q = String(address || '').trim();
  return q ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}` : null;
}

/** Normalize a VIN: uppercase, no spaces, letters I, O and Q are invalid. */
export function cleanVin(vin) {
  return String(vin || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

const VIN_VALUES = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * Check a 17-character VIN. Returns 'ok', 'checkdigit' (valid characters,
 * but the North American check digit does not match; common for vehicles
 * built for other markets), or 'invalid'.
 */
export function checkVin(vin) {
  const v = cleanVin(vin);
  if (v.length !== 17 || /[IOQ]/.test(v)) return 'invalid';
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = v[i];
    const val = /\d/.test(ch) ? Number(ch) : VIN_VALUES[ch];
    if (val === undefined) return 'invalid';
    sum += val * VIN_WEIGHTS[i];
  }
  const check = sum % 11 === 10 ? 'X' : String(sum % 11);
  return v[8] === check ? 'ok' : 'checkdigit';
}

/** Model year from the VIN's 10th character (the most recent matching cycle). */
export function vinYear(vin, nowYear = new Date().getFullYear()) {
  const v = cleanVin(vin);
  if (v.length !== 17) return null;
  const codes = 'ABCDEFGHJKLMNPRSTVWXY123456789';
  const i = codes.indexOf(v[9]);
  if (i < 0) return null;
  let year = 1980 + i;
  while (year + 30 <= nowYear + 1) year += 30;
  return year;
}

export function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
