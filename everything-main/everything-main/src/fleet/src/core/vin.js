/**
 * VIN decoding with NHTSA's public vPIC service (a free US government API
 * that allows browser requests). Covers vehicles built for the North
 * American market; others decode partially or not at all.
 */
import { cleanVin } from './format.js';

const ENDPOINT = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/';

const TYPE_RULES = [
  [/truck-tractor/i, 'Semi truck'],
  [/pickup/i, 'Pickup truck'],
  [/sport utility|crossover/i, 'SUV'],
  [/\bbus\b/i, 'Bus'],
  [/trailer/i, 'Trailer'],
  [/van|minivan/i, 'Van'],
  [/sedan|saloon|hatchback|coupe|convertible|wagon|roadster/i, 'Car'],
  [/straight truck|incomplete|cab chassis|truck/i, 'Box truck'],
];

const FUEL_RULES = [
  [/electric/i, 'Electric'],
  [/diesel/i, 'Diesel'],
  [/compressed natural gas|cng/i, 'CNG'],
  [/propane|lpg/i, 'Propane'],
  [/gasoline|flexible|ethanol/i, 'Gasoline'],
];

const title = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

/** Turn one vPIC result row into the app's vehicle fields. Empty values are left out. */
export function parseVpic(row) {
  if (!row) return null;
  const out = {};
  const year = Number(row.ModelYear);
  if (year > 1900) out.year = year;
  if (row.Make) out.make = title(row.Make);
  if (row.Model) out.model = row.Model;
  const trim = [row.Trim, row.Series].filter(Boolean).join(' ').trim();
  if (trim) out.trim = trim;
  const body = [row.BodyClass, row.VehicleType].filter(Boolean).join(' ');
  for (const [re, t] of TYPE_RULES) if (re.test(body)) {
    out.type = t;
    break;
  }
  const level = String(row.ElectrificationLevel || '');
  const fuel = [/BEV/i.test(level) ? 'Electric' : '', row.FuelTypePrimary].join(' ');
  if (/PHEV|plug/i.test(level)) out.fuelType = 'Plug-in hybrid';
  else if (/hybrid|HEV/i.test(level) && !/BEV/i.test(level)) out.fuelType = 'Hybrid';
  else for (const [re, f] of FUEL_RULES) if (re.test(fuel)) {
    out.fuelType = f;
    break;
  }
  const disp = Number(row.DisplacementL);
  const cyl = Number(row.EngineCylinders);
  const engine = [disp ? `${Math.round(disp * 10) / 10}L` : '', cyl ? `${cyl} cylinder` : ''].filter(Boolean).join(' ');
  if (engine) out.engine = engine;
  if (row.TransmissionStyle) out.transmission = [row.TransmissionStyle, row.TransmissionSpeeds ? `${row.TransmissionSpeeds} speed` : ''].filter(Boolean).join(', ');
  if (row.GVWR) out.gvwr = row.GVWR.replace(/^Class \w+:\s*/, '');
  if (row.DriveType) out.drive = row.DriveType;
  const code = String(row.ErrorCode || '0').split(',')[0].trim();
  out.ok = code === '0' || Boolean(out.make);
  out.message = row.ErrorText ? String(row.ErrorText).split(';')[0] : '';
  return out;
}

/** Decode a VIN. Resolves to parsed fields, or throws with a readable message. */
export async function decodeVin(vin, fetchFn = globalThis.fetch) {
  const v = cleanVin(vin);
  if (v.length < 11) throw new Error('Enter at least the first 11 characters of the VIN.');
  let res;
  try {
    res = await fetchFn(`${ENDPOINT}${encodeURIComponent(v)}?format=json`);
  } catch {
    throw new Error('The VIN lookup service could not be reached. Check your connection.');
  }
  if (!res.ok) throw new Error('The VIN lookup service did not answer. Try again later.');
  let data = null;
  try {
    data = await res.json();
  } catch {
    // An error page from a proxy or an outage, not VIN data.
  }
  if (!Array.isArray(data?.Results)) throw new Error('The VIN lookup service sent an answer the app could not read. Try again later.');
  const parsed = parseVpic(data.Results[0]);
  if (!parsed?.make) throw new Error('No vehicle was found for this VIN. It may be for a vehicle sold outside North America.');
  return parsed;
}
