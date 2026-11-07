import { parseFormula } from './parser.js';
import { upperName } from './tokenizer.js';

/**
 * Names that evaluate in workbook scope; optionally include function calls. `builtin(name)` tells a
 * built-in function's spelling: a call of one beside a LET name of that spelling which plainly holds
 * a value is then the built-in, as the evaluator reads it (LET(sum,1,sum+SUM(A1)) adds the built-in's
 * sum), and counts as free; a name that holds, or may hold, a LAMBDA keeps its call.
 */
export function freeNameTokens(formula, tokens, { includeCalls = false, includeQualified = false, builtin = null } = {}) {
  return scopedTokens(formula, tokens, false, includeCalls, includeQualified, builtin);
}

/** Actual table references, excluding optional LAMBDA parameter declarations. */
export function tableReferenceTokens(formula, tokens) {
  return scopedTokens(formula, tokens, true).filter((t) => t.type === 'tref');
}

/** Built-ins that hand an argument back as they find it, so their answer may be a LAMBDA. */
const PASS_THROUGH = new Set(['IF', 'IFS', 'IFERROR', 'IFNA', 'CHOOSE', 'SWITCH', 'LET']);

function scopedTokens(formula, tokens, includeTables = false, includeCalls = false, includeQualified = false, builtin = null) {
  const bare = tokens.filter((t, i) => (t.type === 'name' && (includeQualified || !t.sheet) && (includeCalls || tokens[i + 1]?.type !== 'lparen')) || (includeTables && t.type === 'tref'));
  const nativeName = (name) => includeCalls ? name.replace(/^(?:_XLFN\.|_XLWS\.)+/, '') : name;
  if (!tokens.some((t) => t.type === 'name' && ['LET', 'LAMBDA', 'ISOMITTED'].includes(nativeName(t.value)))) return bare;
  const offset = formula.startsWith('=') ? 1 : 0;
  let ast;
  try { ast = parseFormula(formula.slice(offset), { namePositions: true, tablePositions: includeTables }); } catch { return []; }
  const free = new Map();
  const binding = (node) => node?.type === 'call' && node.bare && !node.sheet ? node.name
    : node?.type === 'tref' && node.table === null && /^[\p{L}_\\][\p{L}\p{M}\p{N}_.\\?]*$/u.test(node.spec.trim()) ? upperName(node.spec.trim()) : null;
  // What a LET name holds: a LAMBDA, plainly a value (a number, text, a reference, arithmetic, a
  // built-in's answer), or what may be either (a name, a lambda's answer, IF's choice). A LAMBDA
  // parameter holds whatever it is given.
  const holds = (node) => {
    if (node?.type === 'call' && !node.bare && !node.sheet) {
      const name = nativeName(node.name);
      if (name === 'LAMBDA') return 'lambda';
      return builtin?.(name) && !PASS_THROUGH.has(name) ? 'value' : 'unknown';
    }
    return ['num', 'str', 'bool', 'ref', 'array', 'binary', 'unary', 'percent', 'range', 'union', 'empty'].includes(node?.type) ? 'value' : 'unknown';
  };
  const names = (locals) => new Set(locals.keys());
  // `locals` maps each name in scope to what it holds.
  const walk = (node, locals, captured = locals) => {
    if (!node) return;
    if (includeTables && node.type === 'tref') {
      free.set(node.start + offset, names(locals));
    } else if (node.type === 'call') {
      if (node.sheet) {
        if (includeQualified && (includeCalls || node.bare)) free.set(node.start + offset, new Set());
        for (const arg of node.args) walk(arg, locals, captured); return;
      }
      // A local shadows its spelling, except that a built-in's call beside a LET name plainly holding a value is the built-in.
      const shadowed = locals.has(node.name) && !(!node.bare && locals.get(node.name) === 'value' && builtin?.(nativeName(node.name)));
      if (includeCalls && !shadowed) free.set(node.start + offset, names(locals));
      if (node.bare) {
        if (!locals.has(node.name)) free.set(node.start + offset, names(locals));
        return;
      }
      if (!shadowed && nativeName(node.name) === 'ISOMITTED') return;
      if (!shadowed && nativeName(node.name) === 'LAMBDA') {
        const scope = new Map(captured);
        for (const arg of node.args.slice(0, -1)) { const name = binding(arg); if (name) scope.set(name, 'unknown'); }
        walk(node.args.at(-1), scope);
        return;
      }
      if (!shadowed && nativeName(node.name) === 'LET') {
        const scope = new Map(locals), complete = new Map(locals);
        // LAMBDA captures LET's live scope; later bindings become visible to
        // that closure. A nested LET instead copies the scope when it runs.
        for (let i = 0; i < node.args.length - 1; i += 2) { const name = binding(node.args[i]); if (name) complete.set(name, holds(node.args[i + 1])); }
        for (let i = 0; i + 1 < node.args.length - 1; i += 2) {
          walk(node.args[i + 1], scope, complete);
          const name = binding(node.args[i]); if (name) scope.set(name, holds(node.args[i + 1]));
        }
        walk(node.args.at(-1), scope);
        return;
      }
      for (const arg of node.args) walk(arg, locals, captured);
    } else if (node.type === 'binary' || node.type === 'intersection') {
      // A legal operator chain can have thousands of left-deep nodes. Its operands share
      // the same scope, so visit the spine without spending a stack frame on each term.
      let leftmost = node;
      while (leftmost.type === 'binary' || leftmost.type === 'intersection') { walk(leftmost.right, locals, captured); leftmost = leftmost.left; }
      walk(leftmost, locals, captured);
    } else if (node.type === 'range') {
      walk(node.left, locals, captured); walk(node.right, locals, captured);
    } else if (node.type === 'unary' || node.type === 'percent') walk(node.arg, locals, captured);
    else if (node.type === 'apply') {
      walk(node.fn, locals, locals);
      for (const arg of node.args) walk(arg, locals, captured);
    } else if (node.type === 'array') {
      for (const row of node.rows) for (const item of row) walk(item, locals, captured);
    } else if (node.type === 'union') {
      for (const part of node.parts) walk(part, locals, captured);
    }
  };
  walk(ast, new Map());
  return tokens.filter((t) => free.has(t.start)).map((t) => ({ ...t, locals: free.get(t.start) }));
}
