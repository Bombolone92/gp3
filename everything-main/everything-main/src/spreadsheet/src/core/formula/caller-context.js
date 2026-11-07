import { isWorkbookNameScope } from './tokenizer.js';
import { FUNCTIONS } from './functions.js';

// These readers can reach beyond their literal references or observe cell metadata.
const OPEN_INPUTS = new Set(['INDIRECT', 'OFFSET', 'SUMIF', 'AVERAGEIF', 'SUBTOTAL', 'AGGREGATE', 'AI']);
const ALL = ['row', 'col', 'sheet', 'index', 'order', 'count', 'compatibility', 'locale'];
/** Caller state observed by an expression, including named-formula definitions.
 * This walks syntax, not values: unavailable data must not hide caller reads in
 * another branch. Unknown bindings conservatively depend on the whole frame.
 * Link discovery expands the finite name graph fully; provenance may instead
 * use its conservative whole-frame fallback after the expansion budget. */
export function callerDependencies(ast, resolveName, { expandAllNames = false } = {}) {
  const flags = new Set(), definitions = [], expanded = new Set(), reads = [], externalNames = [];
  let open = !ast, styles = !ast, referenceIdentity = false;
  const pending = ast ? [{ node: ast, scope: null, nameScope: null, locals: new Set() }] : [];
  const add = (keys, scope) => {
    for (const key of keys) {
      if (scope && key === 'sheet') continue;
      flags.add(scope && key === 'index' ? 'order' : key);
    }
  };
  if (!ast) add(ALL);
  while (pending.length) {
    const { node, scope, nameScope, locals } = pending.pop();
    const push = children => { for (const child of children) pending.push({ node: child, scope, nameScope, locals }); };
    switch (node.type) {
      case 'num': case 'str': case 'bool': case 'err': case 'empty': break;
      case 'ref':
        reads.push({ ...node.ref, sheet: node.ref.sheet || scope });
        if (!node.ref.sheet && !scope) flags.add('sheet');
        if (node.ref.sheetEnd && !node.ref.sheet?.startsWith('[')) flags.add('order');
        break;
      case 'call': {
        if (node.sheet?.startsWith('[') && !isWorkbookNameScope(node.sheet)) externalNames.push({ sheet: node.sheet, name: node.name });
        if (!node.sheet && locals.has(node.name) && (node.bare || !FUNCTIONS[node.name])) { push(node.args); break; }
        if (!node.sheet && !node.bare && (node.name === 'LET' || node.name === 'LAMBDA')) {
          const bindings = new Set(locals), args = node.args;
          const step = node.name === 'LET' ? 2 : 1;
          for (let i = 0; i < args.length - 1; i += step) {
            const binding = args[i];
            if (step === 2 && args[i + 1]) pending.push({ node: args[i + 1], scope, nameScope, locals: new Set(bindings) });
            if (binding?.type === 'call' && binding.bare && !binding.sheet) bindings.add(binding.name);
            else { add(ALL, scope); open = true; }
          }
          if (args.length) pending.push({ node: args.at(-1), scope, nameScope, locals: bindings });
          break;
        }
        const fn = !node.bare && !node.sheet && FUNCTIONS[node.name];
        if (!fn) {
          const target = node.sheet || nameScope || scope;
          const frame = node.sheet && !isWorkbookNameScope(node.sheet) ? node.sheet : scope;
          const definition = resolveName?.(node.name, target);
          if (!definition) { add(ALL, frame); open = true; styles = true; }
          else {
            definitions.push(definition.signature);
            if (!node.sheet && !nameScope && !scope) flags.add('sheet');
            if (definition.relative) add(['row', 'col']);
            const expansion = JSON.stringify([definition.key, frame]);
            if (!expanded.has(expansion)) {
              expanded.add(expansion);
              if ((!expandAllNames && expanded.size > 64) || !definition.ast) { add(ALL, frame); open = styles = true; }
              else pending.push({ node: definition.ast, scope: frame, nameScope: definition.nameScope ?? target, locals: new Set() });
            }
          }
        } else {
          if (fn.volatile) add(ALL, scope);
          if (fn.localeContext !== false) flags.add('locale');
          if (OPEN_INPUTS.has(node.name)) open = true;
          if (['CELL', 'FORMULATEXT', 'ISFORMULA'].includes(node.name)) referenceIdentity = true;
          if (node.name === 'AI') styles = true;
          if (node.name === 'CELL' && (node.args[0]?.type !== 'str'
            || ['format', 'color', 'prefix', 'protect', 'width'].includes(node.args[0].value.toLowerCase()))) open = styles = true;
          add(typeof fn.callerContext === 'function' ? fn.callerContext(node.args) : fn.callerContext || [], scope);
        }
        push(node.args); break;
      }
      case 'unary':
        if (node.op === '@') add(['row', 'col']);
        else if (node.op !== '+') flags.add('locale');
        push([node.arg]); break;
      case 'percent': flags.add('locale'); push([node.arg]); break;
      case 'range': open = true; push([node.left, node.right]); break;
      case 'binary':
        if (!['=', '<>', '<', '>', '<=', '>='].includes(node.op)) flags.add('locale');
        push([node.left, node.right]); break;
      case 'intersection': push([node.left, node.right]); break;
      case 'union': push(node.parts); break;
      case 'array': for (const row of node.rows) push(row); break;
      case 'apply': push([node.fn, ...node.args]); break;
      case 'tref': add(ALL, scope); open = true; styles = true; break;
      default: add(ALL, scope); open = true; break;
    }
  }
  return { flags: [...flags], definitions, reads, externalNames, open, styles, referenceIdentity };
}
