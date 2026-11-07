/** Hanword's equation language to Office Math (OMML). No evaluation or external fonts. */
import { xml } from './xml.js';

/** Lookup tables without a prototype: an identifier such as `constructor` must not resolve to a function. */
const table = (entries) => Object.assign(Object.create(null), entries);
const symbols = table({
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ϵ', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ', rho: 'ρ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω',
  times: '×', div: '÷', cdot: '⋅', ast: '∗', star: '⋆', circ: '∘', bullet: '∙', pm: '±', mp: '∓', plusminus: '±', minusplus: '∓', infinity: '∞', inf: '∞', partial: '∂', nabla: '∇', del: '∇', degree: '°', prime: '′',
  neq: '≠', ne: '≠', leq: '≤', le: '≤', geq: '≥', ge: '≥', ll: '≪', gg: '≫', equiv: '≡', approx: '≈', sim: '∼', simeq: '≃', cong: '≅', propto: '∝', doteq: '≐',
  in: '∈', notin: '∉', ni: '∋', owns: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', cup: '∪', cap: '∩', uplus: '⊎', sqcup: '⊔', sqcap: '⊓', emptyset: '∅', forall: '∀', exists: '∃', '!': '!',
  land: '∧', lor: '∨', wedge: '∧', vee: '∨', neg: '¬', lnot: '¬', oplus: '⊕', ominus: '⊖', otimes: '⊗', oslash: '⊘', odot: '⊙',
  rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', uparrow: '↑', downarrow: '↓', updownarrow: '↕', to: '→', rarrow: '→', larrow: '←', lrarrow: '↔', mapsto: '↦',
  therefore: '∴', because: '∵', cdots: '⋯', ldots: '…', vdots: '⋮', ddots: '⋱', dots: '…', angle: '∠', measuredangle: '∡', triangle: '△', square: '□', diamond: '◇', perp: '⊥', parallel: '∥', vert: '|', rtangle: '⊥', vdash: '⊢', hleft: '⊣',
  aleph: 'ℵ', hbar: 'ℏ', im: 'ℑ', re: 'ℜ', ell: 'ℓ', wp: '℘', ohm: 'Ω', angstrom: 'Å', liter: 'ℓ',
});
const capitals = table({ Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', Uparrow: '⇑', Downarrow: '⇓', Updownarrow: '⇕' });
Object.assign(capitals, { Alpha: 'Α', Beta: 'Β', Epsilon: 'Ε', Zeta: 'Ζ', Eta: 'Η', Iota: 'Ι', Kappa: 'Κ', Mu: 'Μ', Nu: 'Ν', Omicron: 'Ο', Rho: 'Ρ', Tau: 'Τ', Chi: 'Χ', LARROW: '⇐', RARROW: '⇒', LRARROW: '⇔', UPARROW: '⇑', DOWNARROW: '⇓', UDARROW: '⇕', VERT: '‖' });
Object.assign(symbols, { '+-': '±', '-+': '∓', '!=': '≠', '<=': '≤', '>=': '≥', '==': '≡', '<<': '≪', '>>': '≫', '<<<': '⋘', '>>>': '⋙', '->': '→', '<-': '←', '<->': '↔', '=>': '⇒', '<=>': '⇔', divide: '÷', bigcirc: '○', identical: '≡', exist: '∃', image: 'ℑ', reimage: 'ℜ', imag: 'ℑ', asymp: '≍', iso: '≃', xor: '⊻', dagger: '†', ddagger: '‡', imath: 'ı', jmath: 'ȷ', udarrow: '↕', nwarrow: '↖', searrow: '↘', nearrow: '↗', swarrow: '↙', hookleft: '↩', hookright: '↪', sqsubset: '⊏', sqsupset: '⊐', sqsubseteq: '⊑', sqsupseteq: '⊒', lll: '⋘', prec: '≺', succ: '≻', top: '⊤', bot: '⊥', models: '⊨', msangle: '∡', sangle: '∢', centigrade: '℃', fahrenheit: '℉' });
const operators = table({ sum: '∑', prod: '∏', coproduct: '∐', coprod: '∐', int: '∫', oint: '∮', dint: '∬', tint: '∭', odint: '∯', otint: '∰', bigcup: '⋃', bigcap: '⋂', bigsqcup: '⨆', bigvee: '⋁', bigwedge: '⋀' });
const accents = table({ acute: '́', grave: '̀', dot: '̇', ddot: '̈', hat: '̂', check: '̌', tilde: '̃', vec: '⃗', dyad: '⃡', arch: '͡' });
const functions = new Set('sin cos tan cot sec csc cosec sinh cosh tanh coth arcsin arccos arctan asin acos atan log ln lg exp det gcd lcm max min mod arg deg'.split(' '));
const unsupported = new Set('ladder sladder longdiv bigg scale color underbrace overbrace atopwith lcol rcol col lsub lsup rel buildrel'.split(' '));
const structural = new Set('sqrt root of left right matrix pmatrix bmatrix dmatrix cases pile lpile rpile eqalign lim liminf limsup bar overline under underline box binom over atop choose rm it bold'.split(' ').concat(Object.keys(operators), Object.keys(accents), [...unsupported]));
const tag = (name, body) => `<m:${name}>${body}</m:${name}>`;
const prop = (name, value) => `<m:${name} m:val="${xml(value)}"/>`;
const delimiter = (body, left, right) => tag('d', tag('dPr', prop('begChr', left) + prop('endChr', right)) + tag('e', body));

/** Returns null for syntax we cannot represent, retaining the entire source. */
export function equationToOmml(source, { size, color } = {}) {
  if (typeof source !== 'string' || !source.trim() || source.length > 65536) return null;
  // Tokens cover every non-space character; nothing unrecognized disappears.
  const matches = [...source.matchAll(/"(?:[^"\\]|\\.)*"|[A-Za-z]+|\d+(?:\.\d+)?|<->|<=>|<<<|>>>|\+-|-\+|!=|<=|>=|==|<<|>>|->|<-|=>|[^\s]/gu)];
  const tokens = matches.map((m) => m[0]);
  if (tokens.length > 16384) return null;
  let at = 0, depth = 0;
  const peek = () => tokens[at]?.toLowerCase();
  const fail = () => { throw new Error('Unsupported Hanword equation'); };
  const take = (expected) => { const t = tokens[at++]; if (!t || (expected && t.toLowerCase() !== expected)) fail(); return t; };
  function run(text, style = 'i', normal = false) {
    const formatting = (color ? `<w:color w:val="${xml(color)}"/>` : '') + (size ? `<w:sz w:val="${Math.max(1, Math.min(3276, Math.round(size / 50)))}"/>` : '');
    return tag('r', tag('rPr', normal ? '<m:nor/>' : prop('sty', style)) + (formatting ? `<w:rPr>${formatting}</w:rPr>` : '') + `<m:t xml:space="preserve">${xml(text)}</m:t>`);
  }
  const literal = (token, style) => run(capitals[token] || symbols[token.toLowerCase()] || token, functions.has(token.toLowerCase()) ? 'p' : style, functions.has(token.toLowerCase()));
  function scripts(style) {
    const result = {};
    while (peek() === '_' || peek() === '^') {
      const name = take() === '_' ? 'sub' : 'sup';
      if (result[name]) fail();
      result[name] = atom(style);
    }
    return result;
  }
  function scripted(base, style) {
    const { sub, sup } = scripts(style);
    if (!sub && !sup) return base;
    return tag(sub && sup ? 'sSubSup' : sub ? 'sSub' : 'sSup', tag('e', base) + (sub ? tag('sub', sub) : '') + (sup ? tag('sup', sup) : ''));
  }
  function group(style) { take('{'); const value = sequence(new Set(['}']), style); take('}'); return value; }
  function matrix(kind, style) {
    take('{'); const rows = [];
    while (true) {
      const cells = [];
      do { if (cells.length) take('&'); cells.push(sequence(new Set(['&', '#', '}']), style)); } while (peek() === '&');
      rows.push(cells);
      if (peek() !== '#') break;
      take('#');
    }
    take('}');
    const cols = Math.max(...rows.map((r) => r.length));
    if (cols > 100 || rows.length * cols > 4096) fail();
    let body = tag('m', tag('mPr', tag('mcs', tag('mc', tag('mcPr', prop('count', cols) + prop('mcJc', 'center'))))) + rows.map((row) => tag('mr', Array.from({ length: cols }, (_, i) => tag('e', row[i] || '')).join(''))).join(''));
    if (kind === 'pmatrix') body = delimiter(body, '(', ')');
    if (kind === 'bmatrix') body = delimiter(body, '[', ']');
    if (kind === 'dmatrix') body = delimiter(body, '|', '|');
    if (kind === 'cases') body = delimiter(body, '{', '');
    return body;
  }
  function atom(style) {
    if (++depth > 64) fail();
    let result;
    const word = peek();
    if (word === '{') result = group(style);
    else {
      const token = take();
      if (['}', '^', '_', '#', '&', 'right', 'over', 'atop', 'choose', 'of'].includes(word) || unsupported.has(word)) fail();
      if (word === 'sqrt' || word === 'root') {
        let degree = '';
        if (word === 'root') { degree = atom(style); take('of'); }
        result = tag('rad', tag('radPr', prop('degHide', degree ? 0 : 1)) + tag('deg', degree) + tag('e', atom(style)));
      } else if (word === 'left') {
        const chars = table({ lbrace: '{', rbrace: '}', langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', vert: '|', '.': '' });
        const begin = take(), body = sequence(new Set(['right']), style); take('right'); const end = take();
        result = delimiter(body, chars[begin.toLowerCase()] ?? begin, chars[end.toLowerCase()] ?? end);
      } else if (['matrix', 'pmatrix', 'bmatrix', 'dmatrix', 'cases'].includes(word)) result = matrix(word, style);
      else if (['pile', 'lpile', 'rpile', 'eqalign'].includes(word)) {
        take('{'); const rows = [];
        do { if (rows.length) take('#'); rows.push(sequence(new Set(['#', '}']), style, true)); } while (peek() === '#');
        take('}'); result = tag('eqArr', tag('eqArrPr', prop('baseJc', word === 'lpile' ? 'left' : word === 'rpile' ? 'right' : 'center')) + rows.map((v) => tag('e', v)).join(''));
      } else if (operators[word]) {
        const { sub, sup } = scripts(style);
        const base = at < tokens.length && !['}', '#', '&', 'right'].includes(peek()) ? scripted(atom(style), style) : '';
        result = tag('nary', tag('naryPr', prop('chr', operators[word]) + prop('limLoc', word.includes('int') ? 'subSup' : 'undOvr') + prop('subHide', sub ? 0 : 1) + prop('supHide', sup ? 0 : 1)) + tag('sub', sub || '') + tag('sup', sup || '') + tag('e', base));
      } else if (word === 'lim' || word === 'liminf' || word === 'limsup') {
        const { sub, sup } = scripts('p');
        result = run(token, 'p', true);
        if (sub) result = tag('limLow', tag('e', result) + tag('lim', sub));
        if (sup) result = tag('limUpp', tag('e', result) + tag('lim', sup));
      } else if (accents[word]) result = tag('acc', tag('accPr', prop('chr', accents[word])) + tag('e', atom(style)));
      else if (word === 'bar' || word === 'overline' || word === 'under' || word === 'underline') result = tag('bar', tag('barPr', prop('pos', word.startsWith('under') ? 'bot' : 'top')) + tag('e', atom(style)));
      else if (word === 'box') result = tag('borderBox', tag('e', atom(style)));
      else if (word === 'binom') result = delimiter(tag('f', tag('fPr', prop('type', 'noBar')) + tag('num', atom(style)) + tag('den', atom(style))), '(', ')');
      else if (token.startsWith('"')) result = run(token.slice(1, -1).replace(/\\(["\\])/g, '$1'), style, true);
      else if (word === '~' || word === '`') result = run(word === '~' ? ' ' : '\u2005', style, true);
      else if (word === '\\') { const escaped = take(); if (!/[{}|_#&%^\\]/.test(escaped)) fail(); result = run(escaped, style); }
      else {
        if (token === '"') fail();
        result = literal(token, style);
        // Whitespace delimits Hanword terms. Thus 10a^3 is one numerator,
        // and n=1 or x->0 is one subscript even without surrounding braces.
        while (at < tokens.length && matches[at].index === matches[at - 1].index + tokens[at - 1].length && !/^[{}_^#&~`"\\]$/.test(tokens[at]) && !structural.has(peek())) result += literal(take(), style);
      }
    }
    depth--; return result;
  }
  function sequence(stops, inherited = 'i', aligned = false) {
    const result = []; let style = inherited;
    while (at < tokens.length && !stops.has(peek())) {
      const word = peek();
      if (['rm', 'it', 'bold'].includes(word)) { take(); style = word === 'rm' ? 'p' : word === 'bold' ? (style === 'p' ? 'b' : 'bi') : 'i'; continue; }
      if (word === '&' && aligned) { take(); result.push(tag('r', '<m:rPr><m:aln/></m:rPr><m:t/>')); continue; }
      if (word === 'over' || word === 'atop' || word === 'choose') {
        take(); if (!result.length) fail(); const numerator = result.pop(), denominator = scripted(atom(style), style);
        let fraction = tag('f', (word === 'over' ? '' : tag('fPr', prop('type', 'noBar'))) + tag('num', numerator) + tag('den', denominator));
        if (word === 'choose') fraction = delimiter(fraction, '(', ')');
        result.push(fraction); continue;
      }
      result.push(scripted(atom(style), style));
    }
    return result.join('');
  }
  try {
    const lines = [];
    do { if (lines.length) take('#'); lines.push(sequence(new Set(['#']))); } while (peek() === '#');
    if (at !== tokens.length) return null;
    return tag('oMath', lines.length === 1 ? lines[0] : tag('eqArr', lines.map((line) => tag('e', line)).join('')));
  } catch { return null; }
}
