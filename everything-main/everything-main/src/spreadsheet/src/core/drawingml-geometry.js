/** Bounded DrawingML guide evaluation and path resolution. No source expressions execute as JS. */
const child = (node, name) => node?.children.find(n => n.name === name);
const TURN = 21600000;
const RAD = Math.PI / 10800000;
const coordinate = value => Number.isFinite(value) && Math.abs(value) <= 1e15;

function scaledAngle(angle, sx, sy) {
  if (sx === sy) return angle;
  const turns = Math.floor(angle / TURN), wrapped = angle - turns * TURN;
  let result = Math.atan2(Math.sin(wrapped * RAD) * sy, Math.cos(wrapped * RAD) * sx) / RAD;
  if (result < 0) result += TURN;
  return result + turns * TURN;
}

const OPS = {
  val: [1, x => x], '+-': [3, (x, y, z) => x + y - z], '*/': [3, (x, y, z) => z === 0 ? 0 : x * y / z],
  '+/': [3, (x, y, z) => z === 0 ? 0 : (x + y) / z], '?:': [3, (x, y, z) => x > 0 ? y : z],
  abs: [1, Math.abs], min: [2, Math.min], max: [2, Math.max], sqrt: [1, x => Math.sqrt(Math.max(0, x))],
  mod: [3, Math.hypot], pin: [3, (x, y, z) => Math.max(x, Math.min(y, z))],
  at2: [2, (x, y) => Math.atan2(y, x) / RAD],
  sin: [2, (x, y) => x * Math.sin(y * RAD)], cos: [2, (x, y) => x * Math.cos(y * RAD)], tan: [2, (x, y) => x * Math.tan(y * RAD)],
  cat2: [3, (x, y, z) => x * Math.cos(Math.atan2(z, y))], sat2: [3, (x, y, z) => x * Math.sin(Math.atan2(z, y))],
};

function customGeometry(node) {
  const sourcePaths = child(node, 'pathLst')?.children || [];
  if (sourcePaths.length > 256 || sourcePaths.some(p => p.name !== 'path' || p.children.length > 10000)
    || ['avLst', 'gdLst'].some(name => (child(node, name)?.children.length || 0) > 10000)) return null;
  const guides = name => (child(node, name)?.children || []).map(g => [g.attrs.name, g.attrs.fmla]);
  const rect = child(node, 'rect');
  const paths = sourcePaths.map(path => ({ ...path.attrs,
    commands: path.children.map(cmd => {
      if (cmd.name === 'arcTo') return ['A', ...['wR', 'hR', 'stAng', 'swAng'].map(k => cmd.attrs[k])];
      const kind = { moveTo: 'M', lnTo: 'L', cubicBezTo: 'C', quadBezTo: 'Q', close: 'Z' }[cmd.name];
      return [kind, ...cmd.children.flatMap(pt => pt.name === 'pt' ? [pt.attrs.x, pt.attrs.y] : [null])];
    }),
  }));
  const connections = (child(node, 'cxnLst')?.children || []).slice(0, 1024).map(c => [child(c, 'pos')?.attrs.x, child(c, 'pos')?.attrs.y, c.attrs.ang]);
  return { adjustments: guides('avLst'), guides: guides('gdLst'), rect: ['l', 't', 'r', 'b'].map(k => rect?.attrs[k] || k), paths, connections };
}

/** Numeric paths, text rectangle and indexed connection sites in shape coordinates.
 * A connection site is [x, y, approachAngle], with the angle in 1/60000 degrees.
 */
export function drawingGeometry(node, w, h, presets = {}) {
  if (!(w >= 0 && h >= 0) || ![w, h].every(coordinate) || !node) return null;
  const preset = node.name === 'prstGeom';
  const definition = preset ? Object.hasOwn(presets, node.attrs.prst) && presets[node.attrs.prst] : customGeometry(node);
  if (!definition || !definition.paths.length || definition.paths.length > 256) return null;
  const values = Object.assign(Object.create(null), { w, h, l: 0, t: 0, r: w, b: h, hc: w / 2, vc: h / 2, ss: Math.min(w, h), ls: Math.max(w, h) });
  let budget = 10000;
  const value = token => {
    if (--budget < 0 || token == null || token === '' || String(token).length > 100) throw 0;
    if (Object.hasOwn(values, token)) return values[token];
    if (/^-?\d+(?:\.\d+)?$/.test(token)) { const n = Number(token); if (Number.isFinite(n)) return n; }
    let m = String(token).match(/^(w|h|ss)d([1-9]\d*)$/);
    if (m) return values[m[1]] / Number(m[2]);
    m = String(token).match(/^(\d*)cd([1-9]\d*)$/);
    if (m) return (Number(m[1]) || 1) * TURN / Number(m[2]);
    throw 0;
  };
  const guide = ([name, formula]) => {
    if (typeof name !== 'string' || name.length > 100 || typeof formula !== 'string' || formula.length > 500) throw 0;
    const [op, ...args] = formula.trim().split(/\s+/), spec = Object.hasOwn(OPS, op) && OPS[op];
    if (!spec || args.length !== spec[0]) throw 0;
    const n = spec[1](...args.map(value));
    if (!Number.isFinite(n)) throw 0;
    values[name] = n;
  };
  try {
    definition.adjustments.forEach(guide);
    if (preset) for (const g of child(node, 'avLst')?.children || []) guide([g.attrs.name, g.attrs.fmla]);
    definition.guides.forEach(guide);
    const paths = definition.paths.map(path => {
      const pw = path.w == null ? w : value(path.w), ph = path.h == null ? h : value(path.h);
      if (!(pw >= 0 && ph >= 0) || (path.w != null && pw === 0) || (path.h != null && ph === 0)) throw 0;
      const sx = path.w == null ? 1 : w / pw, sy = path.h == null ? 1 : h / ph;
      const commands = path.commands.map(([kind, ...args]) => {
        if (--budget < 0) throw 0;
        if (args.length !== ({ M: 2, L: 2, C: 6, Q: 4, A: 4, Z: 0 })[kind]) throw 0;
        const numbers = args.map(value);
        if (kind === 'A') {
          if (numbers[0] < 0 || numbers[1] < 0 || Math.abs(numbers[3]) > TURN) throw 0;
          // Fixed path coordinates scale as a whole. Nonuniform scaling also
          // changes polar angles; scaling only the radii disconnects cloud arcs.
          const start = scaledAngle(numbers[2], sx, sy), end = scaledAngle(numbers[2] + numbers[3], sx, sy);
          return [kind, numbers[0] * sx, numbers[1] * sy, start, end - start];
        }
        return [kind, ...numbers.map((v, i) => v * (i % 2 ? sy : sx))];
      });
      if (commands.some(cmd => !cmd.slice(1).every(coordinate))) throw 0;
      return { commands, fill: path.fill || 'norm', stroke: !['0', 'false'].includes(path.stroke) };
    });
    const rect = definition.rect.map(value);
    // Bad connection-site declarations must neither shift later site indices
    // nor prevent the otherwise valid shape geometry from rendering.
    const connections = (definition.connections || []).slice(0, 1024).map(site => {
      try { const values = site.map(value); return values.length === 3 && values.every(coordinate) ? values : null; }
      catch { return null; }
    });
    return rect.every(coordinate) ? { paths, rect, connections } : null;
  } catch { return null; }
}

/** Ellipse point at a DrawingML polar angle (not an ellipse's parametric angle). */
export function ellipsePoint(rx, ry, angle) {
  const a = angle * RAD, x = Math.cos(a), y = Math.sin(a);
  const scale = Math.hypot(ry * x, rx * y);
  return scale ? [rx * ry * x / scale, rx * ry * y / scale] : [0, 0];
}

/** SVG arc segments, split at half-turns so a full circle cannot disappear. */
export function drawingArc(x, y, rx, ry, start, sweep, project = (x, y) => [x, y]) {
  if (!rx || !ry || !sweep) return { commands: [], points: [[x, y]] };
  const first = ellipsePoint(rx, ry, start), cx = x - first[0], cy = y - first[1];
  const steps = Math.ceil(Math.abs(sweep) / (TURN / 2)), commands = [], points = [];
  for (let i = 1; i <= steps; i++) {
    const p = ellipsePoint(rx, ry, start + sweep * i / steps);
    commands.push(['A', rx, ry, 0, 0, sweep > 0 ? 1 : 0, cx + p[0], cy + p[1]]);
  }
  // Extrema after the enclosing group's affine transform. Local cardinal
  // points alone would clip a rotated ellipse that extends outside its group.
  points.push([x, y], commands.at(-1).slice(-2));
  const center = project(cx, cy), horizontal = project(cx + rx, cy), vertical = project(cx, cy + ry);
  for (const axis of [0, 1]) {
    const theta = Math.atan2(vertical[axis] - center[axis], horizontal[axis] - center[axis]);
    for (const t of [theta, theta + Math.PI]) {
      const px = rx * Math.cos(t), py = ry * Math.sin(t), angle = Math.atan2(py, px) / RAD;
      const distance = ((sweep > 0 ? angle - start : start - angle) % TURN + TURN) % TURN;
      if (distance <= Math.abs(sweep)) points.push([cx + px, cy + py]);
    }
  }
  return { commands, points };
}
