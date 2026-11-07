/**
 * Flat Float64Array codec shared by the main thread and the worker.
 *
 * Input:  [paramCount, params..., shapeCount, per shape:
 *           flags, key, subpathCount, per subpath: closed, anchorCount, (x y ix iy ox oy)*]
 * Output: [recordCount, per record: owner, flags, coverCount, cover...,
 *           subpathCount, per subpath: closed, anchorCount, (x y ix iy ox oy)*]
 *
 * Shape flags: 1 filled, 2 even-odd fill rule, 4 string (an open cutting
 * line: it divides faces but has no area). Record flags: 1 unchanged.
 */

export const OP = Object.freeze({
  UNITE: 0,
  INTERSECT: 1,
  EXCLUDE: 2,
  MINUS_FRONT: 3,
  MINUS_BACK: 4,
  DIVIDE: 5,
  TRIM: 6,
  MERGE: 7,
  CROP: 8,
  OUTLINE: 9,
  SUBTRACT_EACH: 10,
  DIVIDE_BELOW: 11,
  SLICE_EACH: 12,
  STROKE: 13,
  OFFSET: 14,
  SIMPLIFY: 15,
  NORMALIZE: 16,
  UNITE_GROUPS: 17,
});

export const FLAG_FILLED = 1;
export const FLAG_EVENODD = 2;
export const FLAG_STRING = 4;

/** Number of f64 values needed to encode the input. */
function encodedLength(shapes, params) {
  let n = 2 + params.length;
  for (const s of shapes) {
    n += 3;
    for (const sp of s.subpaths) n += 2 + sp.anchors.length * 6;
  }
  return n;
}

/**
 * Encode shapes: [{ subpaths: [{ anchors, closed }], filled, evenodd, string, key }].
 * Writes into `target` (a Float64Array view) when given, else allocates.
 */
export function encode(shapes, params = [], target = null) {
  const len = encodedLength(shapes, params);
  const out = target || new Float64Array(len);
  let i = 0;
  out[i++] = params.length;
  for (const p of params) out[i++] = p;
  out[i++] = shapes.length;
  for (const s of shapes) {
    out[i++] = (s.filled ? FLAG_FILLED : 0) | (s.evenodd ? FLAG_EVENODD : 0) | (s.string ? FLAG_STRING : 0);
    out[i++] = s.key ?? -1;
    out[i++] = s.subpaths.length;
    for (const sp of s.subpaths) {
      out[i++] = sp.closed ? 1 : 0;
      out[i++] = sp.anchors.length;
      for (const a of sp.anchors) {
        out[i++] = a.x;
        out[i++] = a.y;
        out[i++] = a.ix;
        out[i++] = a.iy;
        out[i++] = a.ox;
        out[i++] = a.oy;
      }
    }
  }
  return out;
}


/** Decode result records: [{ owner, unchanged, cover, subpaths: [{ closed, anchors }] }]. */
export function decode(buf) {
  let i = 0;
  const count = buf[i++] | 0;
  const out = [];
  for (let r = 0; r < count; r++) {
    const owner = buf[i++] | 0;
    const flags = buf[i++] | 0;
    const cc = buf[i++] | 0;
    const cover = [];
    for (let k = 0; k < cc; k++) cover.push(buf[i++] | 0);
    const sc = buf[i++] | 0;
    const subpaths = [];
    for (let s = 0; s < sc; s++) {
      const closed = buf[i++] !== 0;
      const n = buf[i++] | 0;
      const anchors = new Array(n);
      for (let k = 0; k < n; k++) {
        anchors[k] = { x: buf[i], y: buf[i + 1], ix: buf[i + 2], iy: buf[i + 3], ox: buf[i + 4], oy: buf[i + 5] };
        i += 6;
      }
      subpaths.push({ closed, anchors });
    }
    out.push({ owner, unchanged: Boolean(flags & 1), cover, subpaths });
  }
  return out;
}

/** Rough cost of a job (anchor count), to decide whether to use the worker. */
export function jobSize(shapes) {
  let n = 0;
  for (const s of shapes) for (const sp of s.subpaths) n += sp.anchors.length;
  return n;
}
