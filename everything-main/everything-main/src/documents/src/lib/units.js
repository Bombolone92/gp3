/**
 * The measurement unit: inches or centimeters. The engine's ruler, and the
 * app's page setup, indentation, tab stop, and table dialogs, all follow it.
 * The choice is remembered on this device and applied to every document as
 * it opens; the first default follows the locale.
 */

export const UNITS = [
  { id: 'in', label: 'Inches', short: 'in' },
  { id: 'cm', label: 'Centimeters', short: 'cm' },
];

const KEY = 'documents:unit';
const listeners = new Set();

/** Inches in the countries that still measure in them; centimeters elsewhere. */
export function defaultUnit(locale = (typeof navigator !== 'undefined' ? navigator.language : 'en-US')) {
  // A bare "en" is read as the US, as the date format does.
  return /^en$|-(US|LR|MM)$/i.test(String(locale || '')) ? 'in' : 'cm';
}

export function isUnit(value) {
  return UNITS.some((u) => u.id === value);
}

/** The remembered unit, or the locale's default. */
export function recallUnit(locale) {
  try {
    const v = localStorage.getItem(KEY);
    if (isUnit(v)) return v;
  } catch { /* storage unavailable */ }
  return defaultUnit(locale);
}

/** Keep the unit and tell every open listener (the editor applies it to the engine). */
export function rememberUnit(unit) {
  if (!isUnit(unit)) return false;
  try { localStorage.setItem(KEY, unit); } catch { /* storage unavailable */ }
  for (const fn of [...listeners]) { try { fn(unit); } catch (e) { console.error(e); } }
  return true;
}

/** Subscribe to unit changes; returns the unsubscribe function. */
export function onUnitChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The label for a unit id ("Inches"). */
export function unitLabel(unit) {
  return UNITS.find((u) => u.id === unit)?.label || UNITS[0].label;
}

/** Set the engine's unit when it differs from `unit`; resolves whether a change was made. */
export function applyUnit(controller, unit) {
  if (!controller?.setMeasurementUnit || !isUnit(unit)) return false;
  let current = null;
  try { current = controller.getMeasurementUnit?.() || null; } catch { current = null; }
  if (current === unit) return false;
  try { controller.setMeasurementUnit(unit); } catch (e) { console.error(e); return false; }
  return true;
}
