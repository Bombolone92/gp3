/**
 * Insert ▸ Symbols ▸ Equation: the math an equation text box holds.
 *
 * Equations are typed in a linear format that takes both UnicodeMath (a/b, x^2, x_i, √x,
 * ∑_(k=0)^n▒…, ■(a&b@c&d)) and the familiar backslash commands (\frac{a}{b}, \sqrt[n]{x}, \sum_{k=0}^{n},
 * \int_0^\infty, \alpha, \pm, \pmatrix{…}). The source parses to a small tree, and the tree is written as:
 *   - MathML, which the sheet and print views draw built up;
 *   - Office Math (OMML), which an XLSX text box carries inside a14:m;
 *   - linear text, the fallback readers without Office Math show;
 *   - the source again (from OMML read back out of a file), so an opened equation stays editable.
 *
 * Tree nodes (rows are arrays of nodes):
 *   { t: 'i'|'n'|'o'|'tx'|'fn', s }        identifier, number, operator, plain text, function name
 *   { t: 'frac', num, den, noBar? }         fraction (a stack when noBar)
 *   { t: 'scr', base, sub, sup }            sub/superscripts (sub or sup null when absent)
 *   { t: 'rad', deg, body }                 radical (deg null for a square root)
 *   { t: 'nary', chr, sub, sup, body }      large operator with limits
 *   { t: 'delim', open, close, body }       brackets ('' for an absent side)
 *   { t: 'func', name, arg }                function applied to an argument
 *   { t: 'lim', base, lim, upper? }         limit below (or above) a base
 *   { t: 'acc', chr, body }                 accent (a combining character)
 *   { t: 'bar', body }                      overbar
 *   { t: 'mat', rows }                      matrix: rows of cells, each a row
 */

export const PLACEHOLDER = '⬚';
/** 11 points, in the pixels text box sizes are kept in. */
export const EQUATION_DEFAULT_SIZE = 44 / 3;

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ',
  sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
const IDENTS = {
  ...GREEK, infty: '∞', partial: '∂', nabla: '∇', emptyset: '∅', hbar: 'ℏ', ell: 'ℓ', degree: '°', prime: '′', aleph: 'ℵ', beth: 'ℶ',
  Re: 'ℜ', Im: 'ℑ', wp: '℘', ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', angle: '∠', square: '□', qed: '∎', placeholder: PLACEHOLDER,
};
const OPERATORS = {
  pm: '±', mp: '∓', times: '×', div: '÷', cdot: '⋅', ast: '∗', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠',
  approx: '≈', equiv: '≡', cong: '≅', sim: '∼', simeq: '≃', propto: '∝', ll: '≪', gg: '≫', to: '→', rightarrow: '→', leftarrow: '←',
  uparrow: '↑', downarrow: '↓', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦', in: '∈',
  notin: '∉', ni: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖', wedge: '∧',
  vee: '∨', neg: '¬', forall: '∀', exists: '∃', nexists: '∄', therefore: '∴', because: '∵', circ: '∘', bullet: '∙', oplus: '⊕',
  otimes: '⊗', perp: '⊥', parallel: '∥', colon: ':', slash: '/', lparen: '(', rparen: ')', lbrack: '[', rbrack: ']',
  lbrace: '{', rbrace: '}', vert: '|', caret: '^', underscore: '_', amp: '&', at: '@', backslash: '∖',
};
const NARY = { sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮', bigcup: '⋃', bigcap: '⋂', bigvee: '⋁', bigwedge: '⋀' };
const NARY_CHARS = new Set(Object.values(NARY));
/** Integrals carry their limits beside the sign; the other large operators above and below it. */
export const naryLimitsBeside = chr => /[∫∬∭∮∯∰∱∲∳]/.test(chr);
const ACCENTS = { hat: '̂', check: '̌', tilde: '̃', dot: '̇', ddot: '̈', vec: '⃗', acute: '́', grave: '̀', breve: '̆' };
const ACCENT_SPACING = { '̂': '^', '̌': 'ˇ', '̃': '~', '̇': '˙', '̈': '¨', '⃗': '→', '́': '´', '̀': '`', '̆': '˘' };
export const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'arccot', 'arcsec', 'arccsc',
  'sinh', 'cosh', 'tanh', 'coth', 'sech', 'csch', 'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'gcd', 'lcm',
  'deg', 'dim', 'ker', 'arg', 'Pr', 'mod', 'sgn']);
/** Functions whose subscript is written under the name, as a limit. */
const LIMIT_FUNCTIONS = new Set(['lim', 'max', 'min', 'sup', 'inf']);
const OPEN = { '(': ')', '[': ']', '⟨': '⟩', '⌊': '⌋', '⌈': '⌉', '‖': '‖' };
const OP_CHARS = new Set([...'+-−=<>±∓×÷⋅·∗≤≥≠≈≡≅∼≃∝≪≫→←↑↓↔⇒⇐⇔↦∈∉∋⊂⊃⊆⊇∪∩∖∧∨¬∀∃∄∴∵∘∙⊕⊗⊥∥,;:!′″%']);
/** Operators that stay inside a fraction's, function's or large operator's operand. */
const BINDING_OPS = new Set([...'!′″%']);
const SPECIAL = new Set([...'^_/{}()[]|&@▒■√∛∜"⟨⟩⌊⌋⌈⌉‖¦┬┴¯']);

/* ---------- Tokens ---------- */

function tokenize(source) {
  const out = [];
  const text = String(source ?? '');
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; out.push({ k: 'space' }); continue; }
    if (ch === '\\') {
      const word = /^[A-Za-z]+/.exec(text.slice(i + 1))?.[0];
      if (word) {
        i += word.length + 1;
        if (['text', 'mathrm', 'textrm', 'operatorname'].includes(word)) {
          let j = i; while (text[j] === ' ') j++;
          if (text[j] === '{') {
            const end = text.indexOf('}', j + 1);
            const raw = text.slice(j + 1, end < 0 ? text.length : end);
            i = end < 0 ? text.length : end + 1;
            out.push(word === 'operatorname' ? { k: 'fn', v: raw } : { k: 'text', v: raw });
            continue;
          }
        }
        out.push({ k: 'cmd', v: word });
        continue;
      }
      const next = text[i + 1];
      i += 2;
      if (next === undefined) continue;
      if (next === '\\') out.push({ k: 'ch', v: '@' });
      else if (next === '{' || next === '}') out.push({ k: 'ch', v: next === '{' ? '\\{' : '\\}' });
      else if (next === '|') out.push({ k: 'ch', v: '‖' });
      else if (/[,;:! ]/.test(next)) out.push({ k: 'space' });
      else out.push({ k: 'op', v: next === '/' ? '/' : next });
      continue;
    }
    if (ch === '"') {
      const end = text.indexOf('"', i + 1);
      out.push({ k: 'text', v: text.slice(i + 1, end < 0 ? text.length : end) });
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const num = /^[0-9]+(?:\.[0-9]+)?/.exec(text.slice(i))[0];
      out.push({ k: 'num', v: num }); i += num.length; continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      const word = /^[A-Za-z]+/.exec(text.slice(i))[0];
      i += word.length;
      if (FUNCTIONS.has(word)) out.push({ k: 'fn', v: word });
      else for (const letter of word) out.push({ k: 'id', v: letter });
      continue;
    }
    const cp = String.fromCodePoint(text.codePointAt(i));
    i += cp.length;
    if (SPECIAL.has(cp)) out.push({ k: 'ch', v: cp });
    else if (NARY_CHARS.has(cp)) out.push({ k: 'nary', v: cp });
    else if (cp === "'") out.push({ k: 'op', v: '′' });
    else if (cp === '-') out.push({ k: 'op', v: '−' });
    else if (cp === '*') out.push({ k: 'op', v: '∗' });
    else if (OP_CHARS.has(cp)) out.push({ k: 'op', v: cp });
    else out.push({ k: 'id', v: cp });
  }
  // Spaces only separate words; drop them now that letters are split.
  return out.filter(t => t.k !== 'space');
}

/* ---------- Parser ---------- */

const isOpNode = n => n?.t === 'o' && !BINDING_OPS.has(n.s);
const unwrap = row => row.length === 1 && row[0].t === 'grp' ? row[0].body : row.length === 1 && row[0].t === 'delim' && row[0].open === '(' && row[0].close === ')' && !row[0].keep ? row[0].body : row;
/** Spread brace groups into the row they sit in (they only group). */
const flat = row => row.flatMap(n => n.t === 'grp' ? flat(n.body) : [n]);

class Parser {
  constructor(tokens) { this.tokens = tokens; this.i = 0; }
  peek(o = 0) { return this.tokens[this.i + o]; }
  next() { return this.tokens[this.i++]; }
  eof() { return this.i >= this.tokens.length; }
  is(tok, k, v) { return !!tok && tok.k === k && (v === undefined || tok.v === v); }

  /** A sequence until `stop` says so, with a/b built into fractions. */
  seq(stop) {
    const items = [];
    while (!this.eof() && !stop(this.peek())) {
      const t = this.peek();
      if (this.is(t, 'ch', '/')) { this.next(); items.push({ t: '/' }); continue; }
      if (this.is(t, 'ch', '¦')) { this.next(); items.push({ t: '¦' }); continue; }
      const node = this.element(stop);
      if (node) items.push(node);
    }
    return fractions(items);
  }

  /** An operand: what follows a large operator or a function name, up to the next operator. */
  operand(stop) {
    // A braced group is the whole operand, as \sin{x} and \sum{…} write it.
    if (this.is(this.peek(), 'ch', '{')) {
      const group = this.atom(stop);
      return flat(group.body);
    }
    let first = true;
    const operator = t => (t.k === 'op' && !BINDING_OPS.has(t.v)) || (t.k === 'cmd' && Object.hasOwn(OPERATORS, t.v) && !BINDING_OPS.has(OPERATORS[t.v]));
    const end = t => stop(t) || (!first && operator(t));
    const items = [];
    while (!this.eof() && !end(this.peek())) {
      const t = this.peek();
      if (this.is(t, 'ch', '▒')) { this.next(); continue; }
      if (this.is(t, 'ch', '/')) { this.next(); items.push({ t: '/' }); first = false; continue; }
      const node = this.element(stop);
      if (node) items.push(node);
      first = false;
    }
    const row = fractions(items);
    return row.length === 1 && row[0].t === 'grp' ? flat(row[0].body) : flat(row);
  }

  /** A script, radicand or \frac argument: one atom, with a parenthesised group's brackets removed. */
  arg(stop) {
    const t = this.peek();
    if (!t || stop(t)) return [];
    if (this.is(t, 'op', '−') || this.is(t, 'op', '+')) { this.next(); return [{ t: 'o', s: t.v }, ...this.arg(stop)]; }
    const node = this.atom(stop);
    return node ? flat(unwrap([node])) : [];
  }

  element(stop) {
    const node = this.atom(stop);
    if (!node) return null;
    return this.scripts(node, stop);
  }

  scripts(node, stop) {
    let sub = null, sup = null;
    while (this.is(this.peek(), 'ch', '_') || this.is(this.peek(), 'ch', '^')) {
      const which = this.next().v;
      const value = this.arg(stop);
      if (which === '_' && sub == null) sub = value;
      else if (which === '^' && sup == null) sup = value;
      else return { t: 'scr', base: [{ t: 'scr', base: baseRow(node), sub, sup }], sub: which === '_' ? value : null, sup: which === '^' ? value : null };
    }
    return sub || sup ? { t: 'scr', base: baseRow(node), sub, sup } : node;
  }

  atom(stop) {
    const t = this.next();
    if (!t) return null;
    switch (t.k) {
      case 'num': return { t: 'n', s: t.v };
      case 'id': return { t: 'i', s: t.v };
      case 'op': return { t: 'o', s: t.v };
      case 'text': return { t: 'tx', s: t.v };
      case 'fn': return this.func(t.v, stop);
      case 'nary': return this.nary(t.v, stop);
      case 'cmd': return this.command(t.v, stop);
      case 'ch': return this.special(t.v, stop);
      default: return null;
    }
  }

  special(ch, stop) {
    switch (ch) {
      case '{': {
        const body = this.seq(t => this.is(t, 'ch', '}'));
        if (this.is(this.peek(), 'ch', '}')) this.next();
        return { t: 'grp', body };
      }
      case '\\{': return this.delim('{', '\\}', '}', stop);
      case '|': return this.delim('|', '|', '|', stop);
      case '‖': return this.delim('‖', '‖', '‖', stop);
      case '√': case '∛': case '∜': {
        // UnicodeMath writes an index as √(n&x).
        const body = this.arg(stop);
        const amp = body.findIndex(n => n.t === 'amp');
        if (ch === '√' && amp >= 0) return { t: 'rad', deg: body.slice(0, amp), body: body.slice(amp + 1) };
        return { t: 'rad', deg: ch === '√' ? null : [{ t: 'n', s: ch === '∛' ? '3' : '4' }], body };
      }
      case '■': return this.matrix(null, stop);
      case '¯': return { t: 'bar', body: this.arg(stop) };
      case '}': case ')': case ']': case '⟩': case '⌋': case '⌉': return { t: 'o', s: ch };
      case '\\}': return { t: 'o', s: '}' };
      case '&': return { t: 'amp' };
      case '@': return { t: 'nl' };
      case '^': case '_': {
        // A script with nothing before it hangs on an empty base.
        this.i--;
        return this.scripts({ t: 'i', s: '' }, stop);
      }
      default:
        if (OPEN[ch]) return this.delim(ch, OPEN[ch], OPEN[ch], stop);
        return { t: 'o', s: ch };
    }
  }

  /** Brackets: `open` … `closeTok`; \right ends one as well. */
  delim(open, closeTok, close, stop) {
    const ends = t => this.is(t, 'ch', closeTok) || this.is(t, 'cmd', 'right');
    const start = this.i;
    const body = this.seq(t => ends(t) || stop(t));
    if (this.is(this.peek(), 'cmd', 'right')) { this.next(); return { t: 'delim', open, close: this.fence(), body: flat(body) }; }
    if (this.is(this.peek(), 'ch', closeTok)) { this.next(); return { t: 'delim', open, close, body: flat(body) }; }
    // No closing bracket: the opener was only a character.
    if (open === '|' || open === '‖') { this.i = start; return { t: 'o', s: open }; }
    return { t: 'delim', open, close: '', body: flat(body) };
  }

  /** The bracket character after \left or \right ('.' for none). */
  fence() {
    const t = this.next();
    if (!t || t.v === '.') return '';
    if (t.k === 'ch') return { '\\{': '{', '\\}': '}' }[t.v] ?? t.v;
    if (t.k === 'cmd') return { langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', vert: '|', Vert: '‖', lbrace: '{', rbrace: '}' }[t.v] ?? '';
    return t.v ?? '';
  }

  func(name, stop) {
    let head = { t: 'fn', s: name };
    let nameRow;
    if (LIMIT_FUNCTIONS.has(name) && this.is(this.peek(), 'ch', '_')) {
      this.next();
      const lim = this.arg(stop);
      nameRow = [{ t: 'lim', base: [head], lim }];
      if (this.is(this.peek(), 'ch', '^')) { this.next(); nameRow = [{ t: 'scr', base: nameRow, sub: null, sup: this.arg(stop) }]; }
    } else {
      head = this.scripts(head, stop);
      nameRow = [head];
    }
    return { t: 'func', name: nameRow, arg: this.operand(stop) };
  }

  nary(chr, stop) {
    let sub = null, sup = null;
    for (;;) {
      if (this.is(this.peek(), 'cmd', 'limits') || this.is(this.peek(), 'cmd', 'nolimits')) { this.next(); continue; }
      if (this.is(this.peek(), 'ch', '_') && sub == null) { this.next(); sub = this.arg(stop); continue; }
      if (this.is(this.peek(), 'ch', '^') && sup == null) { this.next(); sup = this.arg(stop); continue; }
      break;
    }
    if (this.is(this.peek(), 'ch', '▒')) this.next();
    return { t: 'nary', chr, sub, sup, body: this.operand(stop) };
  }

  matrix(open, stop) {
    const rows = [[]];
    const t = this.peek();
    const close = this.is(t, 'ch', '{') ? '}' : this.is(t, 'ch', '(') ? ')' : null;
    if (close) this.next();
    let cell = [];
    const items = this.seq(x => this.is(x, 'ch', close || '}') || this.is(x, 'cmd', 'end'));
    if (close && this.is(this.peek(), 'ch', close)) this.next();
    for (const n of items) {
      if (n.t === 'amp') { rows[rows.length - 1].push(flat(cell)); cell = []; }
      else if (n.t === 'nl') { rows[rows.length - 1].push(flat(cell)); cell = []; rows.push([]); }
      else cell.push(n);
    }
    rows[rows.length - 1].push(flat(cell));
    if (rows.length > 1 && rows[rows.length - 1].length === 1 && !rows[rows.length - 1][0].length) rows.pop();
    const width = Math.max(...rows.map(r => r.length));
    const mat = { t: 'mat', rows: rows.map(r => [...r, ...Array.from({ length: width - r.length }, () => [])]) };
    if (!open) return mat;
    return { t: 'delim', open: open[0], close: open[1], body: [mat] };
  }

  command(name, stop) {
    if (Object.hasOwn(IDENTS, name)) return { t: 'i', s: IDENTS[name] };
    if (Object.hasOwn(OPERATORS, name)) return { t: 'o', s: OPERATORS[name] };
    if (Object.hasOwn(NARY, name)) return this.nary(NARY[name], stop);
    if (FUNCTIONS.has(name)) return this.func(name, stop);
    if (Object.hasOwn(ACCENTS, name)) return { t: 'acc', chr: ACCENTS[name], body: this.arg(stop) };
    switch (name) {
      case 'frac': case 'dfrac': case 'tfrac': return { t: 'frac', num: this.arg(stop), den: this.arg(stop) };
      case 'stack': case 'atop': return { t: 'frac', num: this.arg(stop), den: this.arg(stop), noBar: true };
      case 'binom': return { t: 'delim', open: '(', close: ')', body: [{ t: 'frac', num: this.arg(stop), den: this.arg(stop), noBar: true }] };
      case 'sqrt': {
        let deg = null;
        if (this.is(this.peek(), 'ch', '[')) {
          this.next();
          deg = flat(this.seq(t => this.is(t, 'ch', ']')));
          if (this.is(this.peek(), 'ch', ']')) this.next();
        }
        return { t: 'rad', deg, body: this.arg(stop) };
      }
      case 'bar': case 'overline': return { t: 'bar', body: this.arg(stop) };
      case 'underset': case 'overset': {
        const lim = this.arg(stop), base = this.arg(stop);
        return { t: 'lim', base, lim, ...(name === 'overset' ? { upper: true } : {}) };
      }
      case 'matrix': return this.matrix(null, stop);
      case 'pmatrix': return this.matrix('()', stop);
      case 'bmatrix': return this.matrix('[]', stop);
      case 'vmatrix': return this.matrix('||', stop);
      case 'Vmatrix': return this.matrix('‖‖', stop);
      case 'cases': return this.matrix('{', stop);
      case 'left': return this.delimAfterLeft(stop);
      case 'langle': return this.delim('⟨', '⟩', '⟩', stop);
      case 'lfloor': return this.delim('⌊', '⌋', '⌋', stop);
      case 'lceil': return this.delim('⌈', '⌉', '⌉', stop);
      case 'rangle': return { t: 'o', s: '⟩' };
      case 'right': return null;
      default: return { t: 'tx', s: `\\${name}` };
    }
  }

  delimAfterLeft(stop) {
    const open = this.fence();
    const body = this.seq(t => this.is(t, 'cmd', 'right') || stop(t));
    let close = '';
    if (this.is(this.peek(), 'cmd', 'right')) { this.next(); close = this.fence(); }
    return { t: 'delim', open, close, body: flat(body), keep: true };
  }
}

const baseRow = node => node.t === 'grp' ? flat(node.body) : [node];

/** a/b: the numerator and denominator are the operands either side, up to an operator. */
function fractions(items) {
  if (!items.some(n => n.t === '/' || n.t === '¦')) return items;
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const n = items[i];
    if (n.t !== '/' && n.t !== '¦') { out.push(n); continue; }
    let start = out.length;
    while (start > 0 && !isOpNode(out[start - 1]) && out[start - 1].t !== 'amp' && out[start - 1].t !== 'nl') start--;
    const num = out.splice(start);
    const den = [];
    while (i + 1 < items.length && !isOpNode(items[i + 1]) && !['/', '¦', 'amp', 'nl'].includes(items[i + 1].t)) den.push(items[++i]);
    out.push({ t: 'frac', num: flat(unwrap(num)), den: flat(unwrap(den)), ...(n.t === '¦' ? { noBar: true } : {}) });
  }
  return out;
}

const clean = row => (row || []).map(cleanNode).filter(Boolean);
function cleanNode(n) {
  switch (n.t) {
    case 'amp': return { t: 'o', s: '&' };
    case 'nl': return null;
    case 'grp': return null;
    case 'frac': return { t: 'frac', num: clean(n.num), den: clean(n.den), ...(n.noBar ? { noBar: true } : {}) };
    case 'scr': return { t: 'scr', base: clean(n.base), sub: n.sub ? clean(n.sub) : null, sup: n.sup ? clean(n.sup) : null };
    case 'rad': return { t: 'rad', deg: n.deg?.length ? clean(n.deg) : null, body: clean(n.body) };
    case 'nary': return { t: 'nary', chr: n.chr, sub: n.sub ? clean(n.sub) : null, sup: n.sup ? clean(n.sup) : null, body: clean(n.body) };
    case 'delim': return { t: 'delim', open: n.open, close: n.close, body: clean(n.body) };
    case 'func': return { t: 'func', name: clean(n.name), arg: clean(n.arg) };
    case 'lim': return { t: 'lim', base: clean(n.base), lim: clean(n.lim), ...(n.upper ? { upper: true } : {}) };
    case 'acc': return { t: 'acc', chr: n.chr, body: clean(n.body) };
    case 'bar': return { t: 'bar', body: clean(n.body) };
    case 'mat': return { t: 'mat', rows: n.rows.map(r => r.map(clean)) };
    default: return { t: n.t, s: n.s };
  }
}

/** The tree of an equation's linear source. Never throws: anything unrecognised is kept as text. */
export function parseEquation(source) {
  const parser = new Parser(tokenize(source));
  const row = [];
  while (!parser.eof()) {
    row.push(...flat(parser.seq(() => false)));
    // A stray closer at the top level is a character.
    if (!parser.eof()) { const t = parser.next(); row.push({ t: 'o', s: t.v ?? '' }); }
  }
  return mergeNumbers(clean(row));
}

/** Adjacent digits read from OMML runs as one number, as typed. */
function mergeNumbers(row) {
  const out = [];
  for (const n of row) {
    const prev = out[out.length - 1];
    if (n.t === 'n' && prev?.t === 'n') prev.s += n.s;
    else out.push(n);
  }
  return out;
}

/* ---------- Linear text (the fallback readers show) ---------- */

const simple = row => row.length === 1 && ['i', 'n', 'fn', 'tx'].includes(row[0].t) || row.length === 1 && row[0].t === 'delim';
const opnd = row => (simple(row) ? linearRow(row) : `(${linearRow(row)})`);
export function linearRow(row) { return (row || []).map(linearNode).join(''); }
function linearNode(n) {
  switch (n.t) {
    case 'i': case 'n': case 'o': case 'fn': return n.s;
    case 'tx': return `"${n.s}"`;
    case 'frac': return `${opnd(n.num)}${n.noBar ? '¦' : '/'}${opnd(n.den)}`;
    case 'scr': return `${opnd(n.base)}${n.sub ? `_${opnd(n.sub)}` : ''}${n.sup ? `^${opnd(n.sup)}` : ''}`;
    case 'rad': return n.deg ? `√(${linearRow(n.deg)}&${linearRow(n.body)})` : `√${opnd(n.body)}`;
    case 'nary': return `${n.chr}${n.sub ? `_${opnd(n.sub)}` : ''}${n.sup ? `^${opnd(n.sup)}` : ''}▒${opnd(n.body)}`;
    case 'delim': return `${n.open}${linearRow(n.body)}${n.close}`;
    case 'func': return `${linearRow(n.name)}⁡${opnd(n.arg)}`;
    case 'lim': return `${linearRow(n.base)}${n.upper ? '┴' : '┬'}${opnd(n.lim)}`;
    case 'acc': return `${opnd(n.body)}${n.chr}`;
    case 'bar': return `¯${opnd(n.body)}`;
    case 'mat': return `■(${n.rows.map(r => r.map(linearRow).join('&')).join('@')})`;
    default: return '';
  }
}
/** The equation as one line of Unicode text. */
export const equationText = source => linearRow(parseEquation(source));

/* ---------- Source (what the editor shows) ---------- */

const NAME_OF = Object.fromEntries([
  ...Object.entries(OPERATORS).filter(([k]) => ['slash', 'lparen', 'rparen', 'lbrack', 'rbrack', 'lbrace', 'rbrace', 'vert', 'caret', 'underscore', 'amp', 'at'].includes(k)).map(([k, v]) => [v, k]),
]);
const NARY_NAME = Object.fromEntries(Object.entries(NARY).map(([k, v]) => [v, k]));
const ACCENT_NAME = Object.fromEntries(Object.entries(ACCENTS).map(([k, v]) => [v, k]));
const OPEN_NAME = { '⟨': '\\langle', '⌊': '\\lfloor', '⌈': '\\lceil', '{': '\\{', '‖': '\\|' };
const CLOSE_NAME = { '⟩': '\\rangle', '⌋': '\\rfloor', '⌉': '\\rceil', '}': '\\}', '‖': '\\|' };

const braced = row => {
  const s = sourceRow(row);
  return row.length === 1 && ['i', 'n'].includes(row[0].t) && [...s].length === 1 ? s : `{${s}}`;
};
function sourceAtom(n) {
  if (n.t === 'o') return NAME_OF[n.s] ? `\\${NAME_OF[n.s]} ` : n.s === '−' ? '-' : n.s;
  if (n.t === 'i') return /^[A-Za-z]+$/.test(n.s) || !n.s ? n.s : SPECIAL.has(n.s) ? `\\${NAME_OF[n.s] || 'text'}{${n.s}}` : n.s;
  return n.s;
}
export function sourceRow(row) {
  let out = '';
  for (const n of row || []) {
    const piece = sourceNode(n);
    // Keep words apart that would otherwise run together into a function name or a command.
    if (/[A-Za-z]$/.test(out) && /^[A-Za-z]/.test(piece)) {
      const run = (out.match(/(?:^|[^A-Za-z\\])([A-Za-z]+)$/)?.[1] || '') + piece.match(/^[A-Za-z]+/)[0];
      const command = /\\[A-Za-z]+$/.test(out);
      out += command || FUNCTIONS.has(run) || [...FUNCTIONS].some(f => run.includes(f)) ? ` ${piece}` : piece;
    } else if (/\\[A-Za-z]+$/.test(out) && /^[A-Za-z0-9]/.test(piece)) out += ` ${piece}`;
    else out += piece;
  }
  return out;
}
function sourceNode(n) {
  switch (n.t) {
    case 'i': case 'n': case 'o': return sourceAtom(n);
    case 'fn': return FUNCTIONS.has(n.s) ? `\\${n.s}` : `\\operatorname{${n.s}}`;
    case 'tx': return `\\text{${n.s}}`;
    case 'frac': return `\\${n.noBar ? 'stack' : 'frac'}{${sourceRow(n.num)}}{${sourceRow(n.den)}}`;
    case 'scr': {
      const base = n.base.length === 1 && !['scr', 'nary', 'func'].includes(n.base[0].t) ? sourceNode(n.base[0]) : `{${sourceRow(n.base)}}`;
      return `${base}${n.sub ? `_${braced(n.sub)}` : ''}${n.sup ? `^${braced(n.sup)}` : ''}`;
    }
    case 'rad': return n.deg ? `\\sqrt[${sourceRow(n.deg)}]{${sourceRow(n.body)}}` : `\\sqrt{${sourceRow(n.body)}}`;
    case 'nary': return `${NARY_NAME[n.chr] ? `\\${NARY_NAME[n.chr]}` : n.chr}${n.sub ? `_${braced(n.sub)}` : ''}${n.sup ? `^${braced(n.sup)}` : ''}{${sourceRow(n.body)}}`;
    case 'delim': {
      const one = n.body.length === 1 ? n.body[0] : null;
      if (one?.t === 'frac' && one.noBar && n.open === '(' && n.close === ')') return `\\binom{${sourceRow(one.num)}}{${sourceRow(one.den)}}`;
      if (one?.t === 'mat') {
        const kind = { '()': 'pmatrix', '[]': 'bmatrix', '||': 'vmatrix', '‖‖': 'Vmatrix', '{': 'cases' }[n.open + n.close];
        if (kind) return `\\${kind}${sourceNode(one).slice('\\matrix'.length)}`;
      }
      if (n.open === '(' && n.close === ')') return `(${sourceRow(n.body)})`;
      if (n.open === '[' && n.close === ']') return `[${sourceRow(n.body)}]`;
      if (n.open === '|' && n.close === '|') return `|${sourceRow(n.body)}|`;
      if (OPEN_NAME[n.open] && n.close === { '⟨': '⟩', '⌊': '⌋', '⌈': '⌉', '{': '}', '‖': '‖' }[n.open]) return `${OPEN_NAME[n.open]} ${sourceRow(n.body)}${CLOSE_NAME[n.close]}`;
      const side = (c, names) => (!c ? '.' : names[c] || ({ '(': '(', ')': ')', '[': '[', ']': ']', '|': '|' }[c]) || c);
      return `\\left${side(n.open, OPEN_NAME)} ${sourceRow(n.body)}\\right${side(n.close, CLOSE_NAME)}`;
    }
    case 'func': return `${n.name.map(sourceNode).join('')}{${sourceRow(n.arg)}}`;
    case 'lim': {
      const base = n.base.length === 1 && n.base[0].t === 'fn' && LIMIT_FUNCTIONS.has(n.base[0].s) && !n.upper ? `\\${n.base[0].s}_` : null;
      return base ? `${base}${braced(n.lim)}` : `\\${n.upper ? 'overset' : 'underset'}{${sourceRow(n.lim)}}{${sourceRow(n.base)}}`;
    }
    case 'acc': return `\\${ACCENT_NAME[n.chr] || 'hat'}{${sourceRow(n.body)}}`;
    case 'bar': return `\\overline{${sourceRow(n.body)}}`;
    case 'mat': return `\\matrix{${n.rows.map(r => r.map(sourceRow).join(' & ')).join(' \\\\ ')}}`;
    default: return '';
  }
}

/* ---------- MathML (the sheet's and the printout's drawing) ---------- */

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mrow = row => `<mrow>${mathRow(row)}</mrow>`;
function mathRow(row) {
  if (!row || !row.length) return `<mi class="eq-placeholder">${PLACEHOLDER}</mi>`;
  // A sign with nothing before it (or after another operator) is a prefix, spaced as one: −b, x<−∞.
  return row.map((n, i) => n.t === 'o' && /^[−+±∓]$/.test(n.s) && (i === 0 || isOpNode(row[i - 1]))
    ? `<mo form="prefix">${esc(n.s)}</mo>` : mathNode(n)).join('');
}
function mathNode(n) {
  switch (n.t) {
    case 'i': return n.s === PLACEHOLDER ? `<mi class="eq-placeholder">${PLACEHOLDER}</mi>` : `<mi>${esc(n.s)}</mi>`;
    case 'n': return `<mn>${esc(n.s)}</mn>`;
    case 'o': return `<mo>${esc(n.s)}</mo>`;
    case 'tx': return `<mtext>${esc(n.s)}</mtext>`;
    case 'fn': return `<mi mathvariant="normal">${esc(n.s)}</mi>`;
    case 'frac': return `<mfrac${n.noBar ? ' linethickness="0"' : ''}>${mrow(n.num)}${mrow(n.den)}</mfrac>`;
    case 'scr': {
      const base = mrow(n.base);
      if (n.sub && n.sup) return `<msubsup>${base}${mrow(n.sub)}${mrow(n.sup)}</msubsup>`;
      return n.sub ? `<msub>${base}${mrow(n.sub)}</msub>` : `<msup>${base}${mrow(n.sup)}</msup>`;
    }
    case 'rad': return n.deg ? `<mroot>${mrow(n.body)}${mrow(n.deg)}</mroot>` : `<msqrt>${mathRow(n.body)}</msqrt>`;
    case 'nary': {
      const op = `<mo largeop="true" movablelimits="false">${esc(n.chr)}</mo>`;
      const beside = naryLimitsBeside(n.chr);
      const [both, low, high] = beside ? ['msubsup', 'msub', 'msup'] : ['munderover', 'munder', 'mover'];
      const sign = n.sub && n.sup ? `<${both}>${op}${mrow(n.sub)}${mrow(n.sup)}</${both}>`
        : n.sub ? `<${low}>${op}${mrow(n.sub)}</${low}>` : n.sup ? `<${high}>${op}${mrow(n.sup)}</${high}>` : op;
      return `<mrow>${sign}${mrow(n.body)}</mrow>`;
    }
    case 'delim': return `<mrow>${n.open ? `<mo fence="true" stretchy="true">${esc(n.open)}</mo>` : ''}${n.body.length ? mathRow(n.body) : ''}${n.close ? `<mo fence="true" stretchy="true">${esc(n.close)}</mo>` : ''}</mrow>`;
    case 'func': return `<mrow>${mathRow(n.name)}<mo>⁡</mo><mspace width="0.1667em"/>${mrow(n.arg)}</mrow>`;
    case 'lim': return `<${n.upper ? 'mover' : 'munder'}>${mrow(n.base)}${mrow(n.lim)}</${n.upper ? 'mover' : 'munder'}>`;
    case 'acc': return `<mover accent="true">${mrow(n.body)}<mo>${esc(ACCENT_SPACING[n.chr] || n.chr)}</mo></mover>`;
    case 'bar': return `<mover accent="true">${mrow(n.body)}<mo stretchy="true">‾</mo></mover>`;
    case 'mat': return `<mtable>${n.rows.map(r => `<mtr>${r.map(c => `<mtd>${mathRow(c)}</mtd>`).join('')}</mtr>`).join('')}</mtable>`;
    default: return '';
  }
}
/** The equation as a MathML element's markup, drawn built up. */
export function equationMathML(source, { display = true } = {}) {
  return `<math xmlns="http://www.w3.org/1998/Math/MathML"${display ? ' display="block"' : ''}>${mrow(parseEquation(source))}</math>`;
}

/* ---------- Office Math (OMML) ---------- */

export const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const xmlEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const val = (name, v) => `<m:${name} m:val="${xmlEsc(v)}"/>`;

/** A run of math text; `props` is the DrawingML run formatting Excel puts in each one. */
function run(text, props, plain = false) {
  return `<m:r>${plain ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ''}${props(plain)}<m:t>${xmlEsc(text)}</m:t></m:r>`;
}
function ommlRow(row, props) {
  let out = '', pending = '';
  const flush = () => { if (pending) { out += run(pending, props); pending = ''; } };
  for (const n of row || []) {
    if (['i', 'n', 'o'].includes(n.t)) { pending += n.s; continue; }
    flush();
    out += ommlNode(n, props);
  }
  flush();
  return out;
}
const e = (row, props, tag = 'e') => `<m:${tag}>${ommlRow(row, props)}</m:${tag}>`;
function ommlNode(n, props) {
  switch (n.t) {
    case 'tx': return run(n.s, props, true);
    case 'fn': return run(n.s, props, true);
    case 'frac': return `<m:f>${n.noBar ? `<m:fPr>${val('type', 'noBar')}</m:fPr>` : ''}${e(n.num, props, 'num')}${e(n.den, props, 'den')}</m:f>`;
    case 'scr': {
      if (n.sub && n.sup) return `<m:sSubSup>${e(n.base, props)}${e(n.sub, props, 'sub')}${e(n.sup, props, 'sup')}</m:sSubSup>`;
      return n.sub ? `<m:sSub>${e(n.base, props)}${e(n.sub, props, 'sub')}</m:sSub>` : `<m:sSup>${e(n.base, props)}${e(n.sup, props, 'sup')}</m:sSup>`;
    }
    case 'rad': return `<m:rad>${n.deg ? '' : `<m:radPr>${val('degHide', '1')}</m:radPr>`}${n.deg ? e(n.deg, props, 'deg') : '<m:deg/>'}${e(n.body, props)}</m:rad>`;
    case 'nary': {
      const pr = `${n.chr === '∫' ? '' : val('chr', n.chr)}${val('limLoc', naryLimitsBeside(n.chr) ? 'subSup' : 'undOvr')}${n.sub ? '' : val('subHide', '1')}${n.sup ? '' : val('supHide', '1')}`;
      return `<m:nary><m:naryPr>${pr}</m:naryPr>${e(n.sub || [], props, 'sub')}${e(n.sup || [], props, 'sup')}${e(n.body, props)}</m:nary>`;
    }
    case 'delim': {
      const pr = `${n.open === '(' ? '' : val('begChr', n.open)}${n.close === ')' ? '' : val('endChr', n.close)}`;
      return `<m:d>${pr ? `<m:dPr>${pr}</m:dPr>` : ''}${e(n.body, props)}</m:d>`;
    }
    case 'func': return `<m:func>${e(n.name, props, 'fName')}${e(n.arg, props)}</m:func>`;
    case 'lim': return n.upper ? `<m:limUpp>${e(n.base, props)}${e(n.lim, props, 'lim')}</m:limUpp>` : `<m:limLow>${e(n.base, props)}${e(n.lim, props, 'lim')}</m:limLow>`;
    case 'acc': return `<m:acc><m:accPr>${val('chr', n.chr)}</m:accPr>${e(n.body, props)}</m:acc>`;
    case 'bar': return `<m:bar><m:barPr>${val('pos', 'top')}</m:barPr>${e(n.body, props)}</m:bar>`;
    case 'mat': {
      const cols = Math.max(1, ...n.rows.map(r => r.length));
      return `<m:m><m:mPr><m:mcs><m:mc><m:mcPr>${val('count', cols)}${val('mcJc', 'center')}</m:mcPr></m:mc></m:mcs></m:mPr>${n.rows.map(r => `<m:mr>${r.map(c => e(c, props)).join('')}</m:mr>`).join('')}</m:m>`;
    }
    default: return '';
  }
}

/** The equation as an m:oMathPara, with Excel's run formatting (Cambria Math at `size` points). */
export function equationOmml(source, { size = 11 } = {}) {
  const sz = Math.round(size * 100);
  const props = plain => `<a:rPr lang="en-US" sz="${sz}" b="0" i="${plain ? 0 : 1}"><a:latin typeface="Cambria Math" panose="02040503050406030204" pitchFamily="18" charset="0"/></a:rPr>`;
  return `<m:oMathPara xmlns:m="${M_NS}"><m:oMathParaPr>${val('jc', 'centerGroup')}</m:oMathParaPr><m:oMath>${ommlRow(parseEquation(source), props)}</m:oMath></m:oMathPara>`;
}

/* ---------- Reading OMML back ---------- */

/** Text of an OMML run as tree nodes: digits, letters and operators apart, as the parser makes them. */
/** Math italic letters (𝑎, 𝐴, ℎ) as the plain letters they stand for. */
const plainLetters = text => text.replace(/[\u{1D434}-\u{1D467}\u210E]/gu, ch => {
  if (ch === '\u210E') return 'h';
  const n = ch.codePointAt(0) - 0x1D434;
  return String.fromCharCode(n < 26 ? 65 + n : 97 + n - 26);
});

function runNodes(raw, plain, inName) {
  const text = plainLetters(raw);
  if (plain) return text.trim() ? [inName || FUNCTIONS.has(text.trim()) ? { t: 'fn', s: text.trim() } : { t: 'tx', s: text }] : [];
  const out = [];
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    if (/[0-9.]/.test(ch) && (/[0-9]/.test(ch) || out[out.length - 1]?.t === 'n')) {
      const prev = out[out.length - 1];
      if (prev?.t === 'n') prev.s += ch; else out.push({ t: 'n', s: ch });
    } else if (ch === '-') out.push({ t: 'o', s: '−' });
    else if (OP_CHARS.has(ch) || ['(', ')', '[', ']', '{', '}', '|', '/', '&', '^', '_'].includes(ch)) out.push({ t: 'o', s: ch });
    else if (NARY_CHARS.has(ch)) out.push({ t: 'o', s: ch });
    else out.push({ t: 'i', s: ch });
  }
  return out;
}

/**
 * Office Math, read from an XML tree whose nodes are { name (local), attrs (qualified names), children, text },
 * back into the tree; `node` is an m:oMathPara, m:oMath or any element holding one.
 */
export function ommlToTree(node) {
  const kids = (n, name) => (n?.children || []).filter(c => c.name === name);
  const kid = (n, name) => (n?.children || []).find(c => c.name === name);
  const attr = (n, name) => n?.attrs?.[`m:${name}`] ?? n?.attrs?.[name];
  const prop = (n, pr, name) => { const p = kid(kid(n, pr), name); return p ? (attr(p, 'val') ?? '1') : undefined; };
  const on = v => v != null && !['0', 'false', 'off'].includes(v);
  const textOf = n => (n.text || '') + (n.children || []).map(textOf).join('');
  let budget = 50000;
  const row = (n, inName = false, depth = 0) => {
    const out = [];
    for (const c of n?.children || []) out.push(...item(c, inName, depth + 1));
    return mergeNumbers(out);
  };
  const item = (c, inName, depth) => {
    if (depth > 64 || --budget < 0) return [];
    const r = (name, nm = false) => row(kid(c, name), nm, depth);
    switch (c.name) {
      case 'r': {
        const t = kids(c, 't').map(textOf).join('');
        const plain = on(prop(c, 'rPr', 'nor')) || prop(c, 'rPr', 'sty') === 'p';
        return runNodes(t, plain || (inName && /^[A-Za-z]{2,}$/.test(t.trim())), inName);
      }
      case 'f': return [{ t: 'frac', num: r('num'), den: r('den'), ...(prop(c, 'fPr', 'type') === 'noBar' ? { noBar: true } : {}) }];
      case 'sSup': return [{ t: 'scr', base: r('e', inName), sub: null, sup: r('sup') }];
      case 'sSub': return [{ t: 'scr', base: r('e', inName), sub: r('sub'), sup: null }];
      case 'sSubSup': return [{ t: 'scr', base: r('e', inName), sub: r('sub'), sup: r('sup') }];
      case 'sPre': return [{ t: 'scr', base: [{ t: 'i', s: '' }], sub: r('sub'), sup: r('sup') }, ...r('e')];
      case 'rad': return [{ t: 'rad', deg: on(prop(c, 'radPr', 'degHide')) || !row(kid(c, 'deg'), false, depth).length ? null : r('deg'), body: r('e') }];
      case 'nary': {
        const chr = prop(c, 'naryPr', 'chr') || '∫';
        return [{ t: 'nary', chr, sub: on(prop(c, 'naryPr', 'subHide')) ? null : r('sub'), sup: on(prop(c, 'naryPr', 'supHide')) ? null : r('sup'), body: r('e') }];
      }
      case 'd': {
        const open = prop(c, 'dPr', 'begChr'), close = prop(c, 'dPr', 'endChr');
        const sep = prop(c, 'dPr', 'sepChr') ?? '|';
        const body = kids(c, 'e').flatMap((x, i) => [...(i ? [{ t: 'o', s: sep }] : []), ...row(x, false, depth)]);
        return [{ t: 'delim', open: open ?? '(', close: close ?? ')', body }];
      }
      case 'func': return [{ t: 'func', name: r('fName', true), arg: r('e') }];
      case 'limLow': case 'limUpp': return [{ t: 'lim', base: r('e', inName), lim: r('lim'), ...(c.name === 'limUpp' ? { upper: true } : {}) }];
      case 'acc': return [{ t: 'acc', chr: prop(c, 'accPr', 'chr') || '̂', body: r('e') }];
      case 'bar': return [{ t: 'bar', body: r('e') }];
      case 'groupChr': return [{ t: 'lim', base: r('e'), lim: [{ t: 'o', s: prop(c, 'groupChrPr', 'chr') || '⏟' }], ...(prop(c, 'groupChrPr', 'pos') === 'top' ? { upper: true } : {}) }];
      case 'm': return [{ t: 'mat', rows: kids(c, 'mr').map(mr => kids(mr, 'e').map(x => row(x, false, depth))) }];
      case 'eqArr': return [{ t: 'mat', rows: kids(c, 'e').map(x => [row(x, false, depth)]) }];
      case 'box': case 'borderBox': case 'phant': return r('e', inName);
      case 'e': return row(c, inName, depth);
      case 'oMath': return row(c, inName, depth);
      case 'oMathPara': return kids(c, 'oMath').flatMap(x => row(x, inName, depth));
      default: return [];
    }
  };
  const find = n => (n?.name === 'oMathPara' || n?.name === 'oMath' ? n : (n?.children || []).map(find).find(Boolean));
  const root = find(node);
  return root ? clean(item(root, false, 0)) : [];
}

/** An editable source for Office Math read from a file. */
export const ommlToSource = node => sourceRow(ommlToTree(node));
/** The linear text of a tree. */
export const treeText = row => linearRow(row);

/* ---------- Built-in equations (Insert ▸ Equation ▸ arrow) ---------- */

export const BUILTIN_EQUATIONS = Object.freeze([
  { key: 'circle', label: 'Area of Circle', source: 'A=\\pi r^2' },
  { key: 'binomial', label: 'Binomial Theorem', source: '(x+a)^n=\\sum_{k=0}^{n}{\\binom{n}{k} x^k a^{n-k}}' },
  { key: 'sum', label: 'Expansion of a Sum', source: '(1+x)^n=1+\\frac{nx}{1!}+\\frac{n(n-1)x^2}{2!}+\\cdots' },
  { key: 'fourier', label: 'Fourier Series', source: 'f(x)=a_0+\\sum_{n=1}^{\\infty}{\\left(a_n \\cos{\\frac{n\\pi x}{L}}+b_n \\sin{\\frac{n\\pi x}{L}}\\right)}' },
  { key: 'pythagoras', label: 'Pythagorean Theorem', source: 'a^2+b^2=c^2' },
  { key: 'quadratic', label: 'Quadratic Formula', source: 'x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}' },
  { key: 'taylor', label: 'Taylor Expansion', source: 'e^x=1+\\frac{x}{1!}+\\frac{x^2}{2!}+\\frac{x^3}{3!}+\\cdots, -\\infty<x<\\infty' },
  { key: 'trig1', label: 'Trig Identity 1', source: '\\sin{\\alpha}\\pm\\sin{\\beta}=2\\sin{\\frac{1}{2}(\\alpha\\pm\\beta)}\\cos{\\frac{1}{2}(\\alpha\\mp\\beta)}' },
  { key: 'trig2', label: 'Trig Identity 2', source: '\\cos{\\alpha}+\\cos{\\beta}=2\\cos{\\frac{1}{2}(\\alpha+\\beta)}\\cos{\\frac{1}{2}(\\alpha-\\beta)}' },
]);
export const builtinEquation = key => BUILTIN_EQUATIONS.find(b => b.key === key) || null;

/** A first guess at the box an equation needs, in pixels at `size`, for when nothing can measure it. */
export function estimateEquationSize(source, size = EQUATION_DEFAULT_SIZE) {
  // How many stacked levels (fractions, limits, matrix rows) the tallest part has.
  const depth = row => Math.max(0, ...(row || []).map(n => {
    const inner = Math.max(0, ...['body', 'arg', 'base', 'sub', 'sup', 'num', 'den', 'name', 'lim'].filter(k => Array.isArray(n[k])).map(k => depth(n[k])));
    if (n.t === 'frac') return 1 + Math.max(depth(n.num), depth(n.den));
    if (n.t === 'mat') return n.rows.length - 1 + Math.max(0, ...n.rows.flat().map(depth));
    if (n.t === 'nary' && (n.sub || n.sup)) return 1 + inner;
    if (n.t === 'lim' || n.t === 'scr') return 0.5 + inner;
    return inner;
  }));
  const tree = parseEquation(source);
  const width = [...linearRow(tree)].length;
  return { w: Math.round(Math.min(900, Math.max(80, width * size * 0.5 + 24))), h: Math.round(Math.min(600, Math.max(36, (1.5 + depth(tree) * 1.1) * size + 16))) };
}
