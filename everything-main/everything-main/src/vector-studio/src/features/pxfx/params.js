/**
 * Filter parameter specs:
 *   P(key, label, min, max, default, { step, unit })   a number (slider + field)
 *   S(key, label, options, default)                     a choice
 *   C(key, label, default)                              a color '#rrggbb'
 *   B(key, label, default)                              an on/off switch
 */
export const P = (key, label, min, max, def, { step = 1, unit = '' } = {}) => ({ key, label, type: 'number', min, max, def, step, unit });
export const S = (key, label, options, def) => ({ key, label, type: 'select', options, def });
export const C = (key, label, def) => ({ key, label, type: 'color', def });
export const B = (key, label, def) => ({ key, label, type: 'check', def });

/** Parameter values for a filter: known keys only, defaults filled in, numbers clamped. */
export function cleanParams(filter, p = {}) {
  const out = {};
  for (const s of filter.params) {
    let v = p[s.key];
    if (s.type === 'number') {
      v = Number(v);
      if (!Number.isFinite(v)) v = s.def;
      v = Math.min(s.max, Math.max(s.min, v));
      if (s.step >= 1) v = Math.round(v);
    } else if (s.type === 'select') {
      if (!s.options.some((o) => o.value === v)) v = s.def;
    } else if (s.type === 'color') {
      v = /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : s.def;
    } else v = v === undefined ? s.def : Boolean(v);
    out[s.key] = v;
  }
  return out;
}

export function defaultParams(filter) {
  return cleanParams(filter, {});
}
