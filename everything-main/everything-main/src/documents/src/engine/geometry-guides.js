// ECMA-376 Part 1 §20.1.9.11: ordered DrawingML guide formulas.
// Values are resolved at import time; painting never evaluates source formulas.
const angle = Math.PI / 10800000;
const formulas = {
  '*/': (x, y, z) => x * y / z,
  '+-': (x, y, z) => x + y - z,
  '+/': (x, y, z) => (x + y) / z,
  '?:': (x, y, z) => x > 0 ? y : z,
  abs: x => Math.abs(x),
  at2: (x, y) => Math.atan2(y, x) / angle,
  cat2: (x, y, z) => x * Math.cos(Math.atan2(z, y)),
  cos: (x, y) => x * Math.cos(y * angle),
  max: (x, y) => Math.max(x, y),
  min: (x, y) => Math.min(x, y),
  mod: (x, y, z) => Math.hypot(x, y, z),
  pin: (x, y, z) => y < x ? x : y > z ? z : y,
  sat2: (x, y, z) => x * Math.sin(Math.atan2(z, y)),
  sin: (x, y) => x * Math.sin(y * angle),
  sqrt: x => Math.sqrt(x),
  tan: (x, y) => x * Math.tan(y * angle),
  val: x => x,
};
const fail = detail => { throw new Error(`Invalid drawing geometry: ${detail}.`); };
const bounded = value => {
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) fail('nonfinite or excessive guide value');
  return value;
};

export function geometryGuides(width, height, adjustments = [], guides = []) {
  if (!(Number.isFinite(width) && Number.isFinite(height) && width >= 0 && height >= 0)) fail('invalid shape dimensions');
  const values = new Map(Object.entries({ w: width, h: height, l: 0, t: 0, r: width, b: height,
    hc: width / 2, vc: height / 2, ss: Math.min(width, height), ls: Math.max(width, height),
    cd2: 10800000, cd4: 5400000, cd8: 2700000, '3cd4': 16200000, '3cd8': 8100000, '5cd8': 13500000, '7cd8': 18900000 }));
  for (const divisor of [2, 3, 4, 5, 6, 8, 10, 12, 16, 32]) {
    values.set(`wd${divisor}`, width / divisor); values.set(`hd${divisor}`, height / divisor);
    values.set(`ssd${divisor}`, Math.min(width, height) / divisor);
  }
  const builtins = new Set(values.keys());
  const resolve = raw => {
    if (typeof raw !== 'string') fail('missing coordinate');
    const name = raw.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
    if (/^[+-]?\d+$/.test(name)) return bounded(Number(name));
    if (!values.has(name)) fail(`unknown or forward guide ${name}`);
    return values.get(name);
  };
  // CT_GeomGuideList is unbounded; package byte limits bound imported input.
  for (const { name, formula } of [...adjustments, ...guides]) {
    if (!name || /\s/.test(name) || /^[+-]?\d+$/.test(name)) fail('invalid guide name');
    const tokens = typeof formula === 'string' ? formula.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '').split(/[ \t\r\n]+/) : [];
    const op = tokens.shift();
    if (!Object.hasOwn(formulas, op) || tokens.length !== formulas[op].length) fail('unknown formula or incorrect argument count');
    // An ordinary guide is bound to zero while its declaration is evaluated,
    // including redeclarations. Earlier computed guides retain their values.
    // Built-in self-reference behaves differently and remains unresolved.
    if (builtins.has(name) && tokens.includes(name)) fail('self-referential built-in guide');
    values.set(name, 0);
    values.set(name, bounded(formulas[op](...tokens.map(resolve))));
  }
  return resolve;
}
