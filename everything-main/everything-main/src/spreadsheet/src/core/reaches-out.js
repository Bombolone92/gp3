/**
 * Formulas that reach outside the spreadsheet the moment they are shown: the
 * workbook's external providers (IMPORT*, the AI, translation) under every name
 * they answer to, and IMAGE with anything but an inline picture. A file from
 * elsewhere, or a paste from a web page, could send the sheet's contents
 * anywhere through them, so both ask before such a formula runs. One list
 * serves the scan at open time and the one at paste time, so neither drifts.
 *
 * A function runs when its name is followed by arguments, and also when the
 * bare name is handed to another function or bound to a variable, which the
 * evaluator turns into the function itself: MAP(A1, IMPORTDATA) and
 * LET(f, IMPORTDATA, f(A1)) fetch as surely as IMPORTDATA(A1), and so does a
 * defined name whose definition is the bare name. The scan reads a formula the
 * way the evaluator will, so it finds the name wherever it stands. Text that
 * does not parse is looked through for the spelling with parentheses, which
 * reads as a call whether or not it is one, and for a bare name: an entry that
 * stops short of its closing parentheses is closed before it runs, so it is
 * judged closed, and a bare reaching name in text the scan cannot read at all,
 * or cannot read to the end, asks rather than passes; that only costs a question.
 */

import { upperName } from './formula/tokenizer.js';
import { parseFormula } from './formula/parser.js';

/** The reaching functions under every name they answer to; IMAGE joins them unless its picture is inline. */
const REACHING_NAMES = new Set(['IMPORTDATA', 'IMPORTHTML', 'IMPORTXML', 'IMPORTRANGE', 'WEBSERVICE', 'AI', 'TRANSLATE', 'GOOGLETRANSLATE', 'DETECTLANGUAGE', 'IMAGE']);

/** The call spelling of a reaching function, in text folded as the evaluator folds names. */
export const REACHES_OUT = /\b(?:IMPORTDATA|IMPORTHTML|IMPORTXML|IMPORTRANGE|WEBSERVICE|AI|TRANSLATE|GOOGLETRANSLATE|DETECTLANGUAGE)\s*\(|\bIMAGE\s*\((?!\s*"data:)/i;
// A reaching name standing as a word of its own, the only text worth parsing: run into letters,
// digits, underscores or periods it is part of another name, and beside a $ it is a column ($AI$1).
const MENTIONS_NAME = /(?<![\w$.])(?:IMPORTDATA|IMPORTHTML|IMPORTXML|IMPORTRANGE|WEBSERVICE|AI|TRANSLATE|GOOGLETRANSLATE|DETECTLANGUAGE|IMAGE)(?![\w$.])/;

/** Does an IMAGE argument open with the text of an inline picture, as the call scan lets pass? */
function inlinePicture(arg) {
  while (arg?.type === 'binary' && arg.op === '&') arg = arg.left;
  return arg?.type === 'str' && /^data:/i.test(arg.value);
}

/** Is the node a reaching function, called or named bare? */
const reachingCall = (node) => node.type === 'call' && REACHING_NAMES.has(node.name) && !(node.name === 'IMAGE' && !node.bare && inlinePicture(node.args[0]));

function holds(node, test) {
  // Long operator chains are valid and evaluate without recursion. Walking their left-deep AST
  // recursively can overflow and make the scan mistake a runnable request for an invalid formula.
  const pending = [node];
  while (pending.length) {
    const current = pending.pop();
    if (test(current)) return true;
    // Push right-to-left to inspect the formula in its written order, without allocating
    // a children array for every leaf or flattening large array constants.
    switch (current.type) {
      case 'unary': case 'percent': pending.push(current.arg); break;
      case 'binary': case 'range': case 'intersection': pending.push(current.right, current.left); break;
      case 'call': case 'apply':
        for (let i = current.args.length - 1; i >= 0; i--) pending.push(current.args[i]);
        if (current.type === 'apply') pending.push(current.fn);
        break;
      case 'array':
        for (let r = current.rows.length - 1; r >= 0; r--) {
          for (let c = current.rows[r].length - 1; c >= 0; c--) pending.push(current.rows[r][c]);
        }
        break;
      case 'union':
        for (let i = current.parts.length - 1; i >= 0; i--) pending.push(current.parts[i]);
        break;
    }
  }
  return false;
}

/**
 * The closing parentheses the workbook adds to an entry that stops short of them, as
 * Workbook#_closeParentheses counts them (kept in step by hand: it is the only repair an
 * entry gets), or null when none is left open. The closed text is what runs, so it is what
 * the scan judges.
 */
function closedParentheses(formula) {
  let open = 0;
  let quoted = false;
  for (const ch of formula) {
    if (ch === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (ch === '(') open++;
    else if (ch === ')') open--;
  }
  return open > 0 ? formula + ')'.repeat(open) : null;
}

// The evaluator looks a function up by its name folded to upper case, so =ımportdata(…) (a dotless ı)
// and =tranſlate(…) (a long ſ) run as IMPORTDATA and TRANSLATE: the scan reads the text folded the
// same way, or those spellings would reach out without the question. The parser folds names itself.
function reaches(text) {
  const folded = upperName(text);
  if (REACHES_OUT.test(folded)) return true;
  if (!MENTIONS_NAME.test(folded)) return false;
  const body = text.replace(/^\s*=/, '');
  try { return holds(parseFormula(body), reachingCall); } catch (e) {
    // Too deep for the scan's parser is not too deep for every evaluator: a bare reaching
    // name the scan cannot read to the end asks rather than passes.
    if (e instanceof RangeError) return true;
  }
  // =MAP(A1,IMPORTDATA runs as =MAP(A1,IMPORTDATA) once entered, so the text is judged as it
  // will run; a bare reaching name in text that cannot be read even closed asks rather than passes.
  const closed = closedParentheses(body);
  if (closed) {
    try { return holds(parseFormula(closed), reachingCall); } catch { /* unreadable closed too */ }
  }
  return true;
}

/** Does a formula (without its leading "=") reach out? Text that merely looks like one counts too; that only costs a question. */
export const formulaReachesOut = (f) => typeof f === 'string' && reaches(f);

/** Does typed or pasted text amount to such a formula? */
export const textReachesOut = (text) => typeof text === 'string' && /^\s*=/.test(text) && reaches(text);
