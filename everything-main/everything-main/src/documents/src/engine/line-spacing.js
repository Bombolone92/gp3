// A new line value without a rule means auto, even above an inherited rule
// (ECMA-376 Part 1 §17.3.1.33). Other spacing attributes inherit independently.
export function mergeSpacing(base = {}, patch = {}) {
  return { ...base, ...patch, ...('line' in patch && !('lineRule' in patch) ? { lineRule: 'auto' } : {}) };
}

export function checkedLineSpacing(value) {
  if (!value || !['auto', 'exact', 'atLeast'].includes(value.lineRule)) throw new Error('Choose multiple, exact or minimum line spacing.');
  const { lineRule, lineSpacing } = value, multiple = lineRule === 'auto', scale = multiple ? 240 : 20;
  if (!Number.isFinite(lineSpacing) || lineSpacing < 0 || lineSpacing > (multiple ? 5 : 600)) throw new Error('Use 0–5 lines or 0–600 points.');
  if (!multiple && Math.abs(lineSpacing * scale - Math.round(lineSpacing * scale)) > 1e-6) throw new Error('Use twentieth-point steps for line spacing.');
  return { lineRule, lineSpacing: Math.round(lineSpacing * scale) / scale };
}
