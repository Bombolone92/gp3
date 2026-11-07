import { parseFormula } from './formula/parser.js';
import { FUNCTIONS } from './formula/functions.js';
import { parseTableSpec } from './tables.js';

/** Make legacy, non-array calculated-column intersections explicit for our array evaluator.
 * Only scalar expression paths need @. Range consumers (SUM, SUMIF, lookups, array
 * functions, etc.) keep their arguments intact, including nested array arithmetic.
 * This runs on native Excel table formulas, never on formulas authored in the app.
 */
export function intersectTableFormula(formula) {
  if (!formula?.includes('[')) return formula;
  let ast;
  try { ast = parseFormula(formula, { tablePositions: true, namePositions: true }); } catch { return formula; }
  const positions = [];
  const walk = node => {
    if (node.type === 'tref') {
      const spec = parseTableSpec(node.spec);
      if (spec && spec.rows !== 'this' && spec.cols && spec.cols[0] === spec.cols[1]) positions.push(node.start);
    } else if (node.type === 'binary') { walk(node.left); walk(node.right); }
    else if (node.type === 'percent' || (node.type === 'unary' && node.op !== '@')) walk(node.arg);
    else if (node.type === 'call' && !node.bare && !node.sheet) {
      if ((FUNCTIONS[node.name]?.elementwise && !FUNCTIONS[node.name]?.refArgs) || FUNCTIONS[node.name]?.lift
        || ['IF', 'IFERROR', 'IFNA', 'IFS', 'SWITCH', 'CHOOSE'].includes(node.name)) node.args.forEach(walk);
      // ROW/COLUMN return addressless arrays: legacy scalar evaluation takes
      // the first result, rather than intersecting the input reference first.
      else if (['ROW', 'COLUMN'].includes(node.name) && node.args.length) positions.push(node.start);
      // Direct logical ranges are aggregate arguments. Computed arguments
      // still use scalar expression semantics in non-array calculated columns.
      else if (['AND', 'OR'].includes(node.name)) for (const arg of node.args) {
        if (!['ref', 'tref', 'range', 'union', 'array'].includes(arg.type)) walk(arg);
      }
    }
  };
  walk(ast);
  for (const pos of positions.sort((a, b) => b - a)) formula = formula.slice(0, pos) + '@' + formula.slice(pos);
  return formula;
}
