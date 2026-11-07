/**
 * Fuel and energy math. A fuel entry:
 *   { vehicleId, date, time, meter, volume, price, total (cents),
 *     fuelType, vendorId, partial: bool, reset: bool, kind: 'fuel'|'charge' }
 *
 * Economy is measured between full fill-ups: the distance since the
 * previous full fill-up divided by everything pumped since then (partial
 * fills included). An entry marked `reset` (a fill-up was missed) starts a
 * new measurement instead.
 */
import { economyValue, formatDecimal } from './format.js';
import { roundCents } from './money.js';

const byMeter = (a, b) => (Number(a.meter) || 0) - (Number(b.meter) || 0) || String(a.date).localeCompare(String(b.date)) || String(a.time || '').localeCompare(String(b.time || ''));

/** Total from volume and unit price, in cents. */
export function fuelTotal(volume, price) {
  const v = Number(volume);
  const p = Number(price);
  if (!(v > 0) || !(p >= 0)) return 0;
  return roundCents(v * p * 100);
}

/** Unit price from total cents and volume (currency units per volume unit). */
export function unitPrice(totalCents, volume) {
  const v = Number(volume);
  if (!(v > 0)) return null;
  return Math.round((totalCents / 100 / v) * 1000) / 1000;
}

/**
 * Per-entry derived values for ONE vehicle's entries:
 *   Map(id -> { usage, economy, costPerMeter })
 * usage is the meter distance since the previous entry.
 */
export function fuelDerived(entries, meterUnit = 'mi', volumeUnit = 'gal') {
  const hasMeter = (e) => e.meter !== null && e.meter !== undefined && e.meter !== '';
  const list = entries.filter(hasMeter).sort(byMeter);
  // Fill-ups logged without an odometer still put fuel in the tank: their
  // volume counts toward the measurement running when they happened.
  const when = (e) => `${e.date || ''}T${e.time || ''}`;
  const loose = entries.filter((e) => !hasMeter(e)).sort((a, b) => when(a).localeCompare(when(b)));
  let li = 0;
  const out = new Map();
  let prev = null;
  let lastFull = null; // meter at the last full fill-up that starts a measurement
  let volSince = 0;
  for (const e of list) {
    for (; li < loose.length && when(loose[li]) < when(e); li++) volSince += Number(loose[li].volume) || 0;
    const meter = Number(e.meter);
    const usage = prev ? meter - Number(prev.meter) : null;
    const vol = Number(e.volume) || 0;
    let economy = null;
    let measured = null;
    if (e.reset) {
      lastFull = e.partial ? null : meter;
      volSince = 0;
    } else {
      volSince += vol;
      if (!e.partial) {
        if (lastFull !== null && meter > lastFull) {
          measured = { distance: meter - lastFull, volume: volSince };
          economy = economyValue(measured.distance, measured.volume, meterUnit, volumeUnit);
        }
        lastFull = meter;
        volSince = 0;
      }
    }
    out.set(e.id, {
      usage: usage !== null && usage >= 0 ? usage : null,
      economy,
      costPerMeter: usage > 0 ? Math.round((Number(e.total) || 0) / usage) : null,
      measured,
    });
    prev = e;
  }
  for (const e of entries) if (!out.has(e.id)) out.set(e.id, { usage: null, economy: null, costPerMeter: null, measured: null });
  return out;
}

/**
 * Fleet-wide derived values: group by vehicle and by kind (a plug-in
 * hybrid's fill-ups and charging sessions are separate measurements, in
 * gallons and kWh), derive each group, merge.
 */
export function fuelDerivedAll(entries, vehicleOf, volumeUnit) {
  const groups = new Map();
  for (const e of entries) {
    const k = `${e.vehicleId}|${e.kind === 'charge' ? 'charge' : 'fuel'}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const out = new Map();
  for (const [k, list] of groups) {
    const [vid, kind] = k.split('|');
    const unit = vehicleOf(vid)?.meterUnit || 'mi';
    for (const [id, d] of fuelDerived(list, unit, kind === 'charge' ? 'kWh' : volumeUnit)) out.set(id, d);
  }
  return out;
}

/** Summary over a set of entries: totals and averages. */
export function fuelSummary(entries, derived, { meterUnit = 'mi', volumeUnit = 'gal' } = {}) {
  let cost = 0;
  let volume = 0;
  let distance = 0;
  let mDistance = 0;
  let mVolume = 0;
  for (const e of entries) {
    cost += Number(e.total) || 0;
    volume += Number(e.volume) || 0;
    const d = derived?.get(e.id);
    if (d?.usage > 0) distance += d.usage;
    if (d?.measured) {
      mDistance += d.measured.distance;
      mVolume += d.measured.volume;
    }
  }
  return {
    count: entries.length,
    cost,
    volume,
    distance,
    avgPrice: volume > 0 ? cost / 100 / volume : null,
    // Total measured distance over total measured volume, the same way a
    // single measurement works (not an average of averages).
    avgEconomy: mDistance > 0 && mVolume > 0 ? economyValue(mDistance, mVolume, meterUnit, volumeUnit) : null,
    costPerMeter: distance > 0 ? cost / distance : null,
  };
}

/**
 * Warnings for a fuel entry before it is saved: a meter lower than an
 * earlier reading, or a volume larger than the tank.
 */
export function fuelWarnings(entry, vehicle, others = [], { volumeUnit = '' } = {}) {
  const out = [];
  const meter = Number(entry.meter);
  if (entry.meter !== '' && entry.meter != null && Number.isFinite(meter)) {
    // Earlier by date, and by time of day on the same date when both have one.
    const before = (o) => o.date < entry.date || (o.date === entry.date && (!o.time || !entry.time || o.time <= entry.time));
    const earlier = others.filter((o) => o.id !== entry.id && o.vehicleId === entry.vehicleId && before(o) && o.meter != null && o.meter !== '');
    const maxEarlier = earlier.reduce((m, o) => Math.max(m, Number(o.meter) || 0), 0);
    if (maxEarlier && meter < maxEarlier) out.push(`The odometer is lower than an earlier fuel entry (${maxEarlier.toLocaleString()}).`);
  }
  // The tank holds fuel; a charging session's kWh are not compared with it.
  const tank = Number(vehicle?.specs?.fuelCapacity);
  if (entry.kind !== 'charge' && tank > 0 && Number(entry.volume) > tank * 1.05) out.push(`The volume is more than this vehicle's tank holds (${formatDecimal(tank, 1)}${volumeUnit ? ` ${volumeUnit}` : ''}).`);
  return out;
}
