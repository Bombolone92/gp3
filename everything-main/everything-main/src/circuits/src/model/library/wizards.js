// Metadata-driven wizards. The UI renders a form from `fields` and calls
// `generate(values)`. Length fields hold nanometres (the UI parses and
// formats them in the user's units); other fields hold plain values.

import { mm, toMm } from '../../core/units.js';
import * as F from './footprints.js';
import { icSymbol } from './symbols.js';
import { PIN_TYPES } from '../schema.js';

const len = (key, label, defMm, min = 0.01, max = 100) => ({ key, label, type: 'length', default: mm(defMm), min: mm(min), max: mm(max) });
const int = (key, label, def, min, max, step = 1) => ({ key, label, type: 'int', default: def, min, max, step });
const select = (key, label, options, def) => ({ key, label, type: 'select', options, default: def ?? options[0].value ?? options[0] });
const opts = (values) => values.map((v) => ({ value: v, label: String(v) }));

/** Values with defaults filled in and lengths converted to mm for the generators. */
function resolve(fields, values = {}) {
  const out = {};
  for (const f of fields) {
    let v = values[f.key] ?? f.default;
    if (f.type === 'int') v = Math.round(Number(v));
    if (f.type === 'length') v = toMm(Number(v));
    if (f.type === 'bool') v = !!v;
    out[f.key] = v;
  }
  return out;
}

function wizard(def) {
  return { ...def, generate: (values) => def.build(resolve(def.fields, values)) };
}

export const FOOTPRINT_WIZARDS = [
  wizard({
    id: 'chip', name: 'Chip (resistor, capacitor, inductor, LED)',
    fields: [select('size', 'Size', opts(F.CHIP_SIZES), '0603'), select('kind', 'Kind', [
      { value: 'R', label: 'Resistor' }, { value: 'C', label: 'Capacitor' }, { value: 'L', label: 'Inductor' }, { value: 'D', label: 'Diode or LED' },
    ], 'R')],
    build: (v) => F.chip(v.size, v.kind),
  }),
  wizard({
    id: 'molded', name: 'Molded diode (SOD, SMA/SMB/SMC)',
    fields: [select('pkg', 'Package', opts(F.MOLDED_PACKAGES), 'SOD-123')],
    build: (v) => F.moldedBody(v.pkg),
  }),
  wizard({
    id: 'sot23', name: 'SOT-23',
    fields: [select('pins', 'Pins', opts([3, 5, 6]), 3)],
    build: (v) => F.sot23(Number(v.pins)),
  }),
  wizard({
    id: 'soic', name: 'SOIC / SOP / TSSOP',
    fields: [
      int('pins', 'Pins', 8, 4, 64, 2), len('pitch', 'Pitch', 1.27, 0.3, 2.54), len('span', 'Pad centre span', 5.4, 2, 15),
      len('padL', 'Pad length', 1.55, 0.2, 4), len('padW', 'Pad width', 0.6, 0.1, 2), len('bodyW', 'Body width', 3.9, 1, 12),
      len('height', 'Body height', 1.75, 0.3, 5), len('epad', 'Exposed pad (0 = none)', 0, 0, 10),
    ],
    build: (v) => {
      const p = v.pins - (v.pins % 2);
      return F.sop({ pins: p, pitch: v.pitch, C: v.span, padL: v.padL, padW: v.padW, bodyW: v.bodyW, height: v.height, epad: v.epad, family: v.pitch >= 1.2 ? 'SOIC' : 'SOP' });
    },
  }),
  wizard({
    id: 'qfn', name: 'QFN / DFN quad no-lead',
    fields: [
      int('pins', 'Pins', 32, 8, 128, 4), len('size', 'Body size', 5, 1, 15), len('pitch', 'Pitch', 0.5, 0.3, 1.27),
      len('epad', 'Exposed pad (0 = none)', 3.1, 0, 12), len('padL', 'Pad length', 0.8, 0.3, 2), len('height', 'Body height', 0.9, 0.3, 2),
    ],
    build: (v) => F.qfn({ pins: v.pins - (v.pins % 4), size: v.size, pitch: v.pitch, epad: v.epad, padL: v.padL, height: v.height }),
  }),
  wizard({
    id: 'qfp', name: 'QFP / LQFP / TQFP',
    fields: [
      int('pins', 'Pins', 48, 16, 256, 4), len('size', 'Body size', 7, 3, 30), len('pitch', 'Pitch', 0.5, 0.3, 1.0),
      len('padL', 'Pad length', 1.5, 0.5, 3), len('height', 'Body height', 1.6, 0.5, 4),
    ],
    build: (v) => F.qfp({ pins: v.pins - (v.pins % 4), size: v.size, pitch: v.pitch, padL: v.padL, height: v.height }),
  }),
  wizard({
    id: 'dip', name: 'DIP (dual in-line)',
    fields: [
      int('pins', 'Pins', 8, 4, 64, 2), len('rowSpacing', 'Row spacing', 7.62, 5, 30), len('pitch', 'Pitch', 2.54, 1.27, 5.08),
      len('drill', 'Drill', 0.8, 0.3, 3), len('pad', 'Pad diameter', 1.6, 0.6, 4),
    ],
    build: (v) => F.dip({ pins: v.pins - (v.pins % 2), rowSpacing: v.rowSpacing, pitch: v.pitch, drill: v.drill, pad: v.pad }),
  }),
  wizard({
    id: 'header', name: 'Pin header',
    fields: [
      select('rows', 'Rows', opts([1, 2]), 1), int('cols', 'Pins per row', 4, 1, 50), len('pitch', 'Pitch', 2.54, 1.0, 5.08),
      len('drill', 'Drill', 1.0, 0.3, 3), len('pad', 'Pad diameter', 1.7, 0.6, 4),
    ],
    build: (v) => F.header({ rows: Number(v.rows), cols: v.cols, pitch: v.pitch, drill: v.drill, pad: v.pad }),
  }),
  wizard({
    id: 'radial', name: 'Radial capacitor',
    fields: [
      len('d', 'Diameter', 5, 3, 30), len('pitch', 'Lead spacing', 2.0, 1.5, 12.5), len('height', 'Height', 11, 3, 60),
      len('drill', 'Drill', 0.8, 0.4, 2.5), len('pad', 'Pad diameter', 1.6, 0.8, 4),
    ],
    build: (v) => F.radialCap(v),
  }),
  wizard({
    id: 'axial', name: 'Axial (resistor, diode)',
    fields: [
      len('pitch', 'Lead spacing', 10.16, 5, 30), len('bodyL', 'Body length', 6.3, 2, 25), len('bodyD', 'Body diameter', 2.5, 1, 10),
      len('drill', 'Drill', 0.8, 0.4, 2.5), len('pad', 'Pad diameter', 1.6, 0.8, 4),
      select('polarized', 'Polarized', [{ value: false, label: 'No' }, { value: true, label: 'Yes (pad 1 cathode)' }], false),
    ],
    build: (v) => F.axial({ ...v, polarized: v.polarized === true || v.polarized === 'true' }),
  }),
  wizard({ id: 'to92', name: 'TO-92', fields: [], build: () => F.to92() }),
  wizard({ id: 'to220', name: 'TO-220 vertical', fields: [], build: () => F.to220() }),
  wizard({
    id: 'mountingHole', name: 'Mounting hole',
    fields: [len('drill', 'Drill', 3.2, 0.5, 10), len('pad', 'Copper ring diameter (0 = non-plated)', 6.0, 0, 20)],
    build: (v) => F.mountingHole(v),
  }),
];

export const findWizard = (id) => FOOTPRINT_WIZARDS.find((w) => w.id === id) || null;

// ---------------------------------------------------------------- symbol wizard

const TYPE_ALIASES = {
  in: 'input', i: 'input', input: 'input',
  out: 'output', o: 'output', output: 'output',
  io: 'bidir', 'i/o': 'bidir', bidir: 'bidir', bidirectional: 'bidir', inout: 'bidir',
  pwr: 'power', power: 'power', supply: 'power', gnd: 'power', ground: 'power',
  pas: 'passive', passive: 'passive', analog: 'passive',
  oc: 'opencollector', od: 'opencollector', opencollector: 'opencollector', 'open collector': 'opencollector', 'open drain': 'opencollector',
  oe: 'openemitter', openemitter: 'openemitter',
  tri: 'tristate', tristate: 'tristate', 'tri-state': 'tristate', '3state': 'tristate',
  nc: 'nc', 'no connect': 'nc', 'not connected': 'nc',
};

const SIDE_ALIASES = { l: 'left', left: 'left', r: 'right', right: 'right', t: 'top', top: 'top', b: 'bottom', bottom: 'bottom' };

const GROUNDISH = /^(gnd|vss|agnd|dgnd|pgnd|ground|v-|vee|ep|epad)/i;
const SUPPLYISH = /^(vcc|vdd|v\+|avcc|avdd|dvdd|vbat|vin|vio|3v3|5v|vs\+?)$/i;

export function normalizeType(t) {
  const k = String(t || '').trim().toLowerCase();
  if (!k) return null;
  const v = TYPE_ALIASES[k] || (PIN_TYPES.includes(k) ? k : null);
  return v;
}

/** Picks a side when none is given: supplies on top, grounds at the bottom, outputs right. */
export function defaultSide(pin) {
  if (GROUNDISH.test(pin.name)) return 'bottom';
  if (pin.type === 'power' || SUPPLYISH.test(pin.name)) return 'top';
  if (pin.type === 'output' || pin.type === 'opencollector' || pin.type === 'tristate') return 'right';
  return 'left';
}

/**
 * Parses a pasted pin table. Each line is "num, name, type, side" separated by
 * tabs, commas or semicolons; type and side are optional. A header row is
 * skipped. Returns { pins, errors }.
 */
export function parsePinTable(text) {
  const pins = [];
  const errors = [];
  const seen = new Set();
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const cols = line.split(/\t|;|,/).map((c) => c.trim());
    if (i === 0 && /^(pin|num|number|#|no\.?)$/i.test(cols[0])) return;
    const [num, name = '', type = '', side = ''] = cols;
    if (!num) { errors.push(`Line ${i + 1}: missing pin number`); return; }
    if (seen.has(num)) { errors.push(`Line ${i + 1}: pin ${num} is listed twice`); return; }
    seen.add(num);
    const t = normalizeType(type);
    if (type && !t) errors.push(`Line ${i + 1}: unknown pin type "${type}", using passive`);
    const pin = { num, name: name || num, type: t || (GROUNDISH.test(name) || SUPPLYISH.test(name) ? 'power' : 'passive') };
    const s = SIDE_ALIASES[side.toLowerCase()];
    if (side && !s) errors.push(`Line ${i + 1}: unknown side "${side}"`);
    pin.side = s || defaultSide(pin);
    pins.push(pin);
  });
  return { pins, errors };
}

/** Natural order for pin numbers: 2 before 10, A1 before A2. */
export function comparePinNums(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export const SYMBOL_WIZARD = {
  fields: [
    { key: 'name', label: 'Component name', type: 'text', default: 'New component' },
    { key: 'prefix', label: 'Designator prefix', type: 'text', default: 'U' },
    { key: 'minWidth', label: 'Minimum body width (mil)', type: 'int', default: 600, min: 400, max: 4000, step: 200 },
    { key: 'sort', label: 'Order pins', type: 'select', options: [{ value: 'table', label: 'As listed' }, { value: 'number', label: 'By number' }], default: 'table' },
  ],
  /**
   * pins: [{num, name, type, side}]. Returns a Symbol with the pins grouped by
   * side (left and right top to bottom, top and bottom left to right).
   */
  generate({ pins = [], minWidth = 600, sort = 'table' } = {}) {
    const list = sort === 'number' ? [...pins].sort((a, b) => comparePinNums(a.num, b.num)) : pins;
    const sides = { left: [], right: [], top: [], bottom: [] };
    for (const p of list) {
      const side = sides[p.side] ? p.side : defaultSide(p);
      sides[side].push({ num: String(p.num), name: p.name || String(p.num), type: normalizeType(p.type) || 'passive' });
    }
    return icSymbol({ ...sides, minWidth: Math.max(400, Number(minWidth) || 600) });
  },
};
