/**
 * LAMBDA values and how they are called. Kept apart from the evaluator so
 * the function library can invoke a lambda (MAP, REDUCE, ...) without
 * importing the evaluator, which imports the library.
 *
 * A lambda is { lambda: true, params: string[], body: ast, ctx } where ctx
 * is the evaluation context it was created in (with its LET bindings), so
 * a lambda bound by LET can call itself by name. A built-in function named
 * without parentheses (SUM in GROUPBY(A2:A9, B2:B9, SUM)) is a lambda too:
 * { lambda: true, native: def, name, ctx }.
 */

const err = (code) => ({ error: code });

export const runtime = { evaluate: null, callLazy: null, callNative: null };

export const isLambda = (v) => v != null && typeof v === 'object' && v.lambda === true;

const MAX_DEPTH = 400;
let depth = 0;
const active = []; // active[i]: the lambda whose body is evaluating at nesting level i

export function invoke(fn, args) {
  if (!isLambda(fn)) return err('#VALUE!');
  // A built-in passed by name (GROUPBY(..., SUM), MAP(range, TRIM)) is called as itself.
  if (fn.native) {
    // Higher-order functions already hold values; deferred built-ins still
    // need readers and the evaluator's array-aware conditional handling.
    if (fn.native.lazy) return runtime.callLazy(fn.name, fn.native, args.map((value) => () => value ?? null), fn.ctx);
    // The evaluator applies a single-value function cell by cell over an array, as for a direct call.
    return runtime.callNative ? runtime.callNative(fn.native, args, fn.ctx) : fn.native.fn(args, fn.ctx);
  }
  if (args.length > fn.params.length) return err('#VALUE!');
  // Every required parameter needs a slot in the call: LAMBDA(x,x)() is #VALUE!.
  // A slot left empty, as in fn(1,), is an omission ISOMITTED can see.
  for (let i = args.length; i < fn.params.length; i++) {
    if (!fn.optional?.includes(fn.params[i])) return err('#VALUE!');
  }
  if (depth >= MAX_DEPTH) return err('#NUM!');
  const locals = new Map(fn.ctx.locals || []);
  const omitted = new Set(fn.ctx.omitted || []);
  fn.params.forEach((p, i) => {
    const given = i < args.length && args[i] !== undefined;
    locals.set(p, given ? args[i] : null);
    if (given) omitted.delete(p); else omitted.add(p);
  });
  active[depth] = fn;
  depth++;
  try {
    return runtime.evaluate(fn.body, { ...fn.ctx, locals, omitted });
  } catch (e) {
    if (recursionOverflow(e)) return err('#NUM!');
    throw e;
  } finally {
    depth--;
    active[depth] = undefined;
  }
}

/**
 * Whether `e` is the call stack running out under a lambda calling itself. A body that nests
 * calls can exhaust the stack under the depth cap, and how soon depends on the engine's state;
 * either way the recursion went deeper than the engine can run, which the cap reports as #NUM!.
 * The lambdas of one formula share its cell, so a lambda active twice among the innermost
 * levels of one cell is recursing. An overflow under lambdas of different cells is a chain of
 * cells each reading the one before, left to the workbook, which unwinds it and evaluates the
 * chain from its far end.
 */
function recursionOverflow(e) {
  let overflow = e instanceof RangeError;
  // In the frame where the stack ran out even this check may fail: that is the overflow.
  if (overflow) try { overflow = /call stack/i.test(e.message); } catch { overflow = true; }
  if (!overflow) return false;
  const inner = active[depth - 1].ctx;
  const bodies = new Set();
  for (let i = depth - 1; i >= 0 && sameCell(active[i].ctx, inner); i--) {
    if (bodies.has(active[i].body)) return true;
    bodies.add(active[i].body);
  }
  return false;
}

function sameCell(a, b) {
  return a.currentSheet === b.currentSheet && a.cell?.r === b.cell?.r && a.cell?.c === b.cell?.c;
}
