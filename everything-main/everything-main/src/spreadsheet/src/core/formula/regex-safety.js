/**
 * Guards for regular expressions written by users, shared by the REGEX* functions, QUERY and the find bar.
 */

/**
 * Characters a pattern's parts are judged against: ASCII, a few letters and symbols from other
 * scripts, and every literal the pattern itself names. A class is a set of these characters.
 */
const BASE_SAMPLES = [...Array.from({ length: 128 }, (_, i) => String.fromCharCode(i)),
  '\u00a0', '\u00e9', '\u00c9', '\u00df', '\u03a9', '\u044f', '\u05d0', '\u0627', '\u3042', '\u65e5', '\ud55c', '\u{1f600}', '\u2028', '\u200b', '\uffff'];

/** A set of first characters; `uncertain` when it could not be worked out, which counts as overlapping everything. */
const UNCERTAIN = { uncertain: true, chars: new Set() };
const NONE = { uncertain: false, chars: new Set() };
const charSet = (list) => ({ uncertain: false, chars: new Set(list) });
const union = (a, b) => (a.uncertain || b.uncertain ? UNCERTAIN : charSet([...a.chars, ...b.chars]));
function overlap(a, b) {
  if (a.uncertain || b.uncertain) return true;
  for (const ch of a.chars) if (b.chars.has(ch)) return true;
  return false;
}

const REFUSE = Symbol('refuse');

/**
 * The pattern as a tree: alternatives of sequences of atoms. An atom is a character, a class
 * (a bracket expression, an escape or the dot), a group with its own alternatives, a lookaround,
 * a backreference or a zero-width assertion, each with the repeat count its quantifier allows.
 */
function parse(p) {
  let i = 0;
  const literals = new Set();
  const quantifier = (atom) => {
    const ch = p[i];
    if (ch === '*') { atom.min = 0; atom.max = Infinity; i++; }
    else if (ch === '+') { atom.min = 1; atom.max = Infinity; i++; }
    else if (ch === '?') { atom.min = 0; atom.max = 1; i++; }
    else if (ch === '{') {
      const m = /^\{(\d+)(?:,(\d*))?\}/.exec(p.slice(i));
      if (!m) return; // a literal brace
      atom.min = Number(m[1]);
      atom.max = m[2] === undefined ? atom.min : m[2] === '' ? Infinity : Number(m[2]);
      i += m[0].length;
    } else return;
    if (p[i] === '?') i++; // lazy: the same choices in the other order
  };
  const alternation = (nested) => {
    const alts = [[]];
    while (i < p.length) {
      const ch = p[i];
      if (ch === ')') { if (!nested) throw new SyntaxError('unbalanced'); break; }
      if (ch === '|') { alts.push([]); i++; continue; }
      alts[alts.length - 1].push(atom());
    }
    return alts;
  };
  const atom = () => {
    const ch = p[i];
    let a;
    if (ch === '(') {
      i++;
      let kind = 'group';
      if (p[i] === '?') {
        i++;
        if (p[i] === ':') i++;
        else if (p[i] === '=' || p[i] === '!') { kind = 'look'; i++; }
        else if (p[i] === '<' && (p[i + 1] === '=' || p[i + 1] === '!')) { kind = 'look'; i += 2; }
        else if (p[i] === '<') { const end = p.indexOf('>', i); if (end < 0) throw new SyntaxError('name'); i = end + 1; } // (?<name>
        else throw new SyntaxError('group');
      }
      const alts = alternation(true);
      if (p[i] !== ')') throw new SyntaxError('unbalanced');
      i++;
      a = { kind, alts };
    } else if (ch === '[') {
      const start = i++;
      if (p[i] === '^') i++;
      if (p[i] === ']') i++;
      while (i < p.length && p[i] !== ']') i += p[i] === '\\' ? 2 : 1;
      if (i >= p.length) throw new SyntaxError('class');
      i++;
      a = { kind: 'class', source: p.slice(start, i) };
    } else if (ch === '\\') {
      const start = i;
      const e = p[i + 1];
      if (e === undefined) throw new SyntaxError('escape');
      i += 2;
      if (e === 'x') i += 2;
      else if (e === 'u') i = p[i] === '{' ? (p.indexOf('}', i) + 1 || p.length) : i + 4;
      else if (e === 'c') i += 1;
      else if ((e === 'p' || e === 'P') && p[i] === '{') i = p.indexOf('}', i) + 1 || p.length;
      else if (e === 'k' && p[i] === '<') i = p.indexOf('>', i) + 1 || p.length;
      const source = p.slice(start, i);
      if (e === 'b' || e === 'B') a = { kind: 'assert' };
      else if (e === 'k' || (e >= '1' && e <= '9')) a = { kind: 'backref' };
      else {
        a = { kind: 'class', source };
        const code = /^\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|u\{([0-9a-fA-F]+)\})$/.exec(source);
        if (code) literals.add(String.fromCodePoint(parseInt(code[1] || code[2] || code[3], 16)));
        else if (source.length === 2 && !/[dDwWsSnrtfv0]/.test(e)) literals.add(e); // an escaped literal such as \. or \/
      }
    } else if (ch === '.') { i++; a = { kind: 'class', source: '.' }; }
    else if (ch === '^' || ch === '$') { i++; a = { kind: 'assert', start: ch === '^' }; }
    else { i++; a = { kind: 'char', ch }; literals.add(ch); }
    a.min = 1;
    a.max = 1;
    quantifier(a);
    return a;
  };
  return { alts: alternation(false), literals };
}

/** First-character sets for the pattern's atoms, judged case-insensitively and in unicode mode so nothing is missed. */
function sampleSets(literals) {
  const samples = [...new Set([...BASE_SAMPLES, ...literals])];
  const cache = new Map();
  return {
    literal: (ch) => charSet([ch, ch.toLowerCase(), ch.toUpperCase()]),
    of: (source) => {
      let set = cache.get(source);
      if (set) return set;
      let re = null;
      for (const flags of ['isu', 'is']) {
        try { re = new RegExp(`^(?:${source})$`, flags); break; } catch { /* not valid with these flags */ }
      }
      const matched = re ? samples.filter((s) => re.test(s)) : [];
      set = matched.length ? charSet(matched) : UNCERTAIN;
      cache.set(source, set);
      return set;
    },
  };
}

/**
 * The first characters a sequence can start with, whether it can match nothing, whether its end
 * can take a run of any length, and the choices it leaves open at its end (`tails`: the
 * first-character set of every repeated or optional part that may still hand characters back to
 * whatever follows). Inside a group repeated without bound, a choice must be settled by the
 * character after it: a part that could consume the character the next part starts with lets
 * the engine split the text between them in many ways. `cost` notes a pair of overlapping open
 * parts anywhere in the pattern.
 */
function sequenceInfo(seq, inside, sets, cost) {
  let first = NONE;
  let nullable = true;
  let pending = []; // each earlier part still open: its tails, and whether it can take a run of any length
  for (const atom of seq) {
    const a = atomInfo(atom, inside, sets, cost);
    // Outside a repeated group a choice is settled once per starting position, so one open part the next
    // part could take up costs the square of the text's length at worst; a third open part overlapping
    // both in a row (a*a*a*b) costs its cube and more, which on a long cell is seconds. A part of bounded
    // length (a?, or an optional group of fixed words) multiplies the ways by a constant instead, so such
    // parts are counted among themselves: a?a?a?b is refused, (https?:\/\/)?([\w-]+\.)+[\w-]+ allowed.
    let open = 0;
    for (const part of pending) {
      if (!part.tails.some((tail) => overlap(tail, a.first))) continue;
      if (inside) throw REFUSE;
      if (a.tails.length && part.unbounded === a.unbounded && ++open > 1) {
        // A third open part in a row costs the cube of the text's length from every starting position.
        // Anchored to the start the pattern is tried from one position and stays within the square, so
        // the commonest extraction idioms — ^(.*?):\s*(.*)$, ^\s*(.*?)\s*$, ^(.*?)\s+(.*)$ — are
        // answered for a text held to PAIR_LIMIT instead of refused, as an unanchored pair already is.
        // A fourth open part is the cube again even from one position, and stays refused.
        if (!cost.anchored || open > 2) throw REFUSE;
        cost.chain = true;
      }
    }
    if (open && a.unbounded) cost.pair = true;
    if (nullable) first = union(first, a.first);
    if (!a.nullable) {
      nullable = false;
      // A part that must match something settles the choices before it, unless the run they were dividing
      // can go on through it: \d+\d+\d+x and a*aa*a*b divide a run three ways just as \d*\d*\d*x does.
      pending = pending.filter((part) => part.tails.some((tail) => overlap(tail, a.first)));
    }
    if (a.tails.length) pending.push({ tails: a.tails, unbounded: a.unbounded });
  }
  return { first, nullable, tails: pending.flatMap((part) => part.tails), unbounded: pending.some((part) => part.unbounded) };
}

/** The most ways a group repeated a bounded number of times may divide the text before it is refused. */
const BOUNDED_WAYS = 256;

/**
 * The longest text an atom can match and the most ways it can match it from one position, judged
 * from its text alone: a{0,2} is two characters three ways, (a|ab){3} six characters eight ways.
 * Infinity for a part that can take a run of any length, or that cannot be judged (a lookaround,
 * a backreference).
 */
function atomCost(atom) {
  if (atom.kind === 'assert') return { len: 0, ways: 1 };
  if (atom.kind === 'backref' || atom.kind === 'look') return { len: Infinity, ways: Infinity };
  const reps = atom.max - atom.min + 1;
  if (atom.kind !== 'group') return { len: atom.max, ways: reps };
  let len = 0;
  let ways = 0;
  for (const seq of atom.alts) {
    let l = 0;
    let w = 1;
    for (const part of seq) { const c = atomCost(part); l += c.len; w *= c.ways; }
    len = Math.max(len, l);
    ways += w;
  }
  return { len: len * atom.max, ways: reps * ways ** atom.max };
}

function atomInfo(atom, inside, sets, cost) {
  const choice = atom.min !== atom.max;
  const optional = atom.min === 0;
  const unbounded = atom.max > 2; // three or more repetitions divide a run as an unbounded repeat does
  if (atom.kind === 'assert') return { first: NONE, nullable: true, tails: [], unbounded: false };
  if (atom.kind === 'backref') return { first: UNCERTAIN, nullable: true, tails: choice ? [UNCERTAIN] : [], unbounded };
  if (atom.kind === 'look') {
    // Zero width, but its own repeated groups still run to completion before it fails.
    for (const seq of atom.alts) sequenceInfo(seq, false, sets, cost);
    return { first: NONE, nullable: true, tails: [], unbounded: false };
  }
  if (atom.kind === 'group') {
    // Three or more iterations multiply the ways the text divides between them as an unbounded repeat does:
    // (.*a){14} and (\w+\s?){6}x try them all before failing, while two stay within the square of the text's
    // length.
    let repeated = atom.max === Infinity || atom.max > 2;
    // A body of bounded length repeated a bounded number of times divides the text in a bounded number of
    // ways whatever the text's length: the three octets of (?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3} in an
    // IPv4 address are tried at most 6³ = 216 ways, where (a|ab){10} tries 1,024 and (a{0,2}){20} three
    // billion. Within the budget the group is judged as a plain one, but its choices stay open to what
    // follows, so a chain of such groups is still counted as a chain of open parts. Past the budget the
    // group is judged as a repeated one however few iterations it has, since two iterations of something
    // ambiguous are ambiguous as well: (?:(?:a?){16}){2}Z and (?:a?){20}Z each divide a run of a's a
    // million ways and take seconds on a ten-character cell.
    let bounded = false;
    if (atom.max !== Infinity && atom.max > 1) {
      const { len, ways } = atomCost(atom);
      if (len === Infinity) { /* judged by its parts, as an unbounded repeat is */ }
      else if (ways > BOUNDED_WAYS) repeated = true;
      else if (repeated) { repeated = false; bounded = true; }
    }
    const within = inside || repeated;
    const infos = atom.alts.map((seq) => sequenceInfo(seq, within, sets, cost));
    let first = NONE;
    for (const info of infos) first = union(first, info.first);
    if (within && infos.length > 1) {
      // Alternatives must be told apart by their first character, and none may match nothing: (a|a)+ and (a|ab)*
      // try every way of assigning the text to the alternatives.
      for (let k = 0; k < infos.length; k++) {
        if (infos[k].nullable) throw REFUSE;
        for (let m = k + 1; m < infos.length; m++) if (overlap(infos[k].first, infos[m].first)) throw REFUSE;
      }
    }
    // Around the end of a repeated group, a choice still open meets the group's own start: (a+)+, (\w+\s?)*, (x|y+)+.
    if (repeated) for (const info of infos) for (const tail of info.tails) if (overlap(tail, first)) throw REFUSE;
    const tails = infos.flatMap((info) => info.tails);
    if (choice || bounded) tails.push(first);
    return { first, nullable: optional || infos.some((info) => info.nullable), tails, unbounded: unbounded || infos.some((info) => info.unbounded) };
  }
  const first = atom.kind === 'char' ? sets.literal(atom.ch) : sets.of(atom.source);
  return { first, nullable: optional, tails: choice ? [first] : [], unbounded };
}

/**
 * What the pattern may cost: whether it is refused, whether two overlapping open parts stand in a
 * row anywhere in it, whether a third stands there that only the anchor saves from refusal, and
 * whether every alternative is anchored to the start of the text. Null for a pattern that does not
 * parse, which is left to the RegExp constructor to report.
 */
function analyzePattern(p) {
  let tree;
  try { tree = parse(String(p)); } catch { return null; }
  const sets = sampleSets(tree.literals);
  const cost = { refuse: false, pair: false, chain: false, anchored: tree.alts.every((seq) => seq[0]?.start) };
  try {
    for (const seq of tree.alts) sequenceInfo(seq, false, sets, cost);
  } catch (e) {
    if (e !== REFUSE) return null;
    cost.refuse = true;
  }
  return cost;
}

// A lifted REGEX call can check the same pattern thousands of times. Its
// safety analysis depends only on the pattern; the caller still checks each
// subject's length. Bound both the entry count and retained pattern text.
const analyses = new Map();
const ANALYSIS_ENTRIES = 128, ANALYSIS_CHARACTERS = 65536;
let analysisCharacters = 0;
function analyze(pattern) {
  let p;
  try { p = String(pattern); } catch { return null; }
  if (analyses.has(p)) {
    const cost = analyses.get(p);
    analyses.delete(p); analyses.set(p, cost);
    return cost;
  }
  const cost = analyzePattern(p);
  if (p.length <= ANALYSIS_CHARACTERS) {
    while (analyses.size && (analyses.size >= ANALYSIS_ENTRIES || analysisCharacters + p.length > ANALYSIS_CHARACTERS)) {
      const oldest = analyses.keys().next().value;
      analysisCharacters -= oldest.length; analyses.delete(oldest);
    }
    analyses.set(p, cost); analysisCharacters += p.length;
  }
  return cost;
}

/**
 * True when the pattern could make the engine backtrack for ever: a group repeated without
 * bound whose iterations can divide the same text in more than one way, as (a+)+, (\w+\s?)*,
 * (x|y+)+, (a|a)+ and (x+x)+ do, with no way to interrupt it. Linear patterns whose repeats
 * are separated by a character they cannot consume, like (\.\w+)+ or (,\s*\w+)+, are allowed.
 * The check is deliberately generous with refusals: whatever cannot be shown safe is refused.
 * A pattern that does not parse is left to the RegExp constructor to report.
 */
export function nestedRepeat(p) {
  return analyze(p)?.refuse ?? false;
}

/** The longest text a pattern with two overlapping repeats is tried on from every position. */
const PAIR_LIMIT = 1000;

/**
 * The longest text the pattern should be run on. Most have no limit; but two overlapping repeats in a
 * row, a*a*b or (\w+)\s*(\w+)=, divide a long run of text between them in every way, and tried from
 * every starting position that costs the cube of the text's length: a second from a thousand
 * characters, hours on the longest cell, with no way to interrupt it. Anchored to the start the
 * pattern is tried from one position and stays within the square, as a single repeat does from every
 * position, which the longest cell keeps to a second or two — unless a third open part stands in the
 * row (^\s*(.*?)\s*$), which is the square from that one position and takes the same limit. Callers
 * answer a longer text as they do a refused pattern.
 */
export function subjectLimit(p) {
  const cost = analyze(p);
  if (!cost || cost.refuse) return Infinity;
  return cost.chain || (cost.pair && !cost.anchored) ? PAIR_LIMIT : Infinity;
}
