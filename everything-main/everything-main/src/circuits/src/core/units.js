// Every length in a design is an integer number of nanometres. Integers keep
// coordinates exact through edits and file round trips, and a float64 holds
// any board size exactly. Conversions to display units happen at the edges.

export const NM_PER_MM = 1_000_000;
export const NM_PER_MIL = 25_400;
export const NM_PER_INCH = 25_400_000;

export const mm = (v) => Math.round(v * NM_PER_MM);
export const mil = (v) => Math.round(v * NM_PER_MIL);
export const inch = (v) => Math.round(v * NM_PER_INCH);

export const toMm = (nm) => nm / NM_PER_MM;
export const toMil = (nm) => nm / NM_PER_MIL;

/** Schematic grid quantum: 100 mil, the conventional pin pitch. */
export const SCH_GRID = mil(100);

export const UNIT_INFO = {
  mm: { label: 'mm', perNm: 1 / NM_PER_MM, decimals: 3 },
  mil: { label: 'mil', perNm: 1 / NM_PER_MIL, decimals: 1 },
};

/** Formats a length for display, trimming trailing zeros: 0.250 mm -> "0.25mm". */
export function formatLength(nm, units = 'mm', { decimals, suffix = true } = {}) {
  const info = UNIT_INFO[units] || UNIT_INFO.mm;
  const d = decimals ?? info.decimals;
  let s = (nm * info.perNm).toFixed(d);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return suffix ? `${s}${info.label}` : s;
}

/**
 * Parses a user-entered length. Accepts a bare number in the default units or
 * a number followed by mm, mil, mils, in, inch, th, um or ". Returns null when
 * the text is not a length.
 */
export function parseLength(text, defaultUnits = 'mm') {
  if (typeof text === 'number') return Number.isFinite(text) ? Math.round(text / UNIT_INFO[defaultUnits].perNm) : null;
  const m = String(text).trim().toLowerCase().match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(mm|mils?|th|in|inch|inches|um|µm|")?$/);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  const u = m[2] || defaultUnits;
  switch (u) {
    case 'mm': return Math.round(v * NM_PER_MM);
    case 'mil': case 'mils': case 'th': return Math.round(v * NM_PER_MIL);
    case 'in': case 'inch': case 'inches': case '"': return Math.round(v * NM_PER_INCH);
    case 'um': case 'µm': return Math.round(v * 1000);
    default: return null;
  }
}

/** Snaps a coordinate to the nearest multiple of grid (grid <= 0 disables snapping). */
export function snap(v, grid) {
  if (!(grid > 0)) return Math.round(v);
  return Math.round(v / grid) * grid;
}

/** Standard grid choices, in nanometres, offered by the grid menu. */
export const GRID_PRESETS = {
  mm: [mm(0.01), mm(0.025), mm(0.05), mm(0.1), mm(0.25), mm(0.5), mm(1), mm(2.5)],
  mil: [mil(1), mil(5), mil(10), mil(25), mil(50), mil(100)],
};
export const SCH_GRID_PRESETS = [mil(10), mil(50), mil(100)];
