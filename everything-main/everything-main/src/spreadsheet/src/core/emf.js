/** Bounded EMF vector reader. Implements the GDI polygon/path subset used by
 * embedded Office artwork, following MS-EMF. Unsupported drawing/state records
 * reject the whole preview rather than silently producing an incomplete image.
 * Original EMF bytes remain attached to the picture for lossless XLSX export.
 */
export function emfSvg(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 88 || bytes.length > 16 * 1024 * 1024) return null;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u = p => data.getUint32(p, true), i = p => data.getInt32(p, true);
  const fail = () => { throw new Error('Unsupported or invalid EMF'); };
  const color = v => '#' + [v & 255, (v >>> 8) & 255, (v >>> 16) & 255].map(c => c.toString(16).padStart(2, '0')).join('');
  const number = v => { if (!Number.isFinite(v) || Math.abs(v) > 1e9) fail(); return String(Math.round(v * 1e6) / 1e6); };
  try {
    if (u(0) !== 1 || u(4) < 88 || u(40) !== 0x464d4520 || u(48) !== bytes.length || u(52) > 50000) return null;
    const x = i(8), y = i(12), width = i(16) - x + 1, height = i(20) - y + 1;
    if (width <= 0 || height <= 0 || width > 1e7 || height > 1e7) return null;
    const handles = data.getUint16(56, true);
    if (!handles || handles > 4096) return null;
    const objects = new Map(), shapes = [];
    let brush = { kind: 'brush', color: '#ffffff' }, pen = { kind: 'pen', color: '#000000', width: 1 };
    let mode = 1, windowOrigin = [0, 0], viewportOrigin = [0, 0], windowSize = [1, 1], viewportSize = [1, 1], winding = 'evenodd';
    let current = [0, 0], figure = current, path = null, building = false, pointCount = 0, outputSize = 0, records = 0, ended = false;
    const scale = () => mode === 1 ? [1, 1] : viewportSize.map((v, j) => v / windowSize[j]);
    const point = (px, py) => {
      const s = scale();
      return [px, py].map((v, j) => Number(number((v - windowOrigin[j]) * s[j] + viewportOrigin[j])));
    };
    const pair = p => point(...p).map(number).join(' ');
    const emit = (commands, filled, stroked) => {
      if (!commands.length) return;
      let strokeWidth = pen.width;
      if (stroked && pen.color !== 'none' && pen.geometric) {
        const [sx, sy] = scale().map(Math.abs);
        if (Math.abs(sx - sy) > 1e-9) fail();
        strokeWidth *= sx;
      }
      const svg = `<path d="${commands.join(' ')}" fill="${filled ? brush.color : 'none'}" fill-rule="${winding}" stroke="${stroked ? pen.color : 'none'}" stroke-width="${number(strokeWidth)}" stroke-linecap="${pen.cap || 'round'}" stroke-linejoin="${pen.join || 'round'}"/>`;
      outputSize += svg.length;
      if (outputSize > 2 * 1024 * 1024 || shapes.length >= 20000) fail();
      shapes.push(svg);
    };
    const store = (id, object) => { if (!id || id >= handles || objects.has(id)) fail(); objects.set(id, object); };
    const stock = id => id <= 5 ? { kind: 'brush', color: ['#ffffff', '#c0c0c0', '#808080', '#404040', '#000000', 'none'][id] }
      : id <= 8 ? { kind: 'pen', color: ['#ffffff', '#000000', 'none'][id - 6], width: 1 } : null;
    for (let pos = 0; pos < bytes.length;) {
      if (pos + 8 > bytes.length || ++records > 50000) fail();
      const type = u(pos), size = u(pos + 4), end = pos + size;
      if (size < 8 || size % 4 || end > bytes.length) fail();
      const need = n => { if (size < n) fail(); };
      const at = offset => { need(offset + 4); return u(pos + offset); };
      const coords = offset => { need(offset + 8); return [i(pos + offset), i(pos + offset + 4)]; };
      const points = (offset, count) => {
        if (!count || (pointCount += count) > 100000 || offset + count * 4 > size) fail();
        return Array.from({ length: count }, (_, j) => [data.getInt16(pos + offset + j * 4, true), data.getInt16(pos + offset + j * 4 + 2, true)]);
      };
      switch (type) {
        case 1: if (pos) fail(); break;
        case 14: // EOF
          need(20); if (end !== bytes.length || building || records !== u(52)) fail(); ended = true; break;
        case 17: // SetMapMode: text or anisotropic mapping.
          mode = at(8); if (![1, 8].includes(mode)) fail(); break;
        case 18: if (![1, 2].includes(at(8))) fail(); break; // Background mode does not affect solid vector fills.
        case 19:
          if (![1, 2].includes(at(8))) fail(); winding = at(8) === 2 ? 'nonzero' : 'evenodd'; break;
        case 9: case 11: { // Window/viewport extents; ignored in MM_TEXT.
          const v = coords(8); if (!v[0] || !v[1]) fail();
          if (mode !== 1) { if (type === 9) windowSize = v; else viewportSize = v; }
          break;
        }
        case 10: windowOrigin = coords(8); break;
        case 12: viewportOrigin = coords(8); break;
        case 39: { // CreateBrushIndirect
          need(24); const style = at(12); if (![0, 1].includes(style)) fail();
          store(at(8), { kind: 'brush', color: style === 1 ? 'none' : color(at(16)) }); break;
        }
        case 38: case 95: { // CreatePen / ExtCreatePen, solid and null pens.
          need(type === 38 ? 28 : 52);
          const ext = type === 95, style = at(ext ? 28 : 12), kind = style & 15;
          if (![0, 5].includes(kind) || style & ~0x1330f) fail();
          if (ext && (at(16) || at(24) || at(36) || at(48))) fail();
          const cap = ['round', 'square', 'butt'][(style >>> 8) & 15], join = ['round', 'bevel', 'miter'][(style >>> 12) & 15];
          if (!cap || !join) fail();
          store(at(8), { kind: 'pen', color: kind === 5 ? 'none' : color(at(ext ? 40 : 24)), width: Math.max(1, at(ext ? 32 : 16)), geometric: !!(style & 0x10000), cap, join });
          break;
        }
        case 37: { // SelectObject (including predefined GDI objects).
          const id = at(8), obj = id & 0x80000000 ? stock(id & 0x7fffffff) : objects.get(id);
          if (!obj) fail(); if (obj.kind === 'brush') brush = obj; else pen = obj; break;
        }
        case 40: objects.delete(at(8)); break;
        case 59: path = []; building = true; break; // BeginPath replaces a previous path.
        case 60: if (!building) fail(); building = false; break;
        case 61: if (!building) fail(); path.push('Z'); current = figure; break;
        case 62: case 63: case 64: // FillPath / StrokeAndFillPath / StrokePath.
          need(24); if (building || !path) fail();
          if (type === 63) fail(); // Closing every open subpath for stroking needs separate handling.
          emit(path, type === 62, type === 64); path = null; break;
        case 27: // MoveToEx
          current = coords(8); figure = current;
          if (building) path.push('M ' + pair(current)); break;
        case 88: { // PolyBezierTo16: triples of control/control/end points.
          const count = at(24), pts = points(28, count), commands = building ? path : ['M ' + pair(current)];
          if (building && !commands.length) commands.push('M ' + pair(current));
          for (let j = 0; j + 2 < count; j += 3) { commands.push('C ' + pts.slice(j, j + 3).map(pair).join(' ')); current = pts[j + 2]; }
          if (!building) emit(commands, false, true); break;
        }
        case 91: { // PolyPolygon16, one compound path so winding preserves holes.
          const polygons = at(24), count = at(28);
          if (!polygons || polygons > 20000 || 32 + polygons * 4 > size) fail();
          const pts = points(32 + polygons * 4, count), commands = []; let cursor = 0;
          for (let j = 0; j < polygons; j++) {
            const n = at(32 + j * 4); if (n < 2 || cursor + n > count) fail();
            for (let k = 0; k < n; k++) commands.push((k ? 'L ' : 'M ') + pair(pts[cursor++]));
            commands.push('Z');
          }
          if (cursor !== count) fail();
          if (building) for (const command of commands) path.push(command);
          else emit(commands, true, true); break;
        }
        default: fail();
      }
      pos = end;
    }
    return ended && shapes.length ? `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}">${shapes.join('')}</svg>` : null;
  } catch { return null; }
}
