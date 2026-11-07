// A small JavaScript highlighter for the script editor: one pass over the
// text, producing escaped HTML with a span per token class. It knows
// comments, strings and template literals (with nested ${…}), numbers,
// regular expression literals, keywords and the `studio` API name; anything
// else stays plain text. It never throws on unfinished code.

export type TokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'literal' | 'regex' | 'api' | 'function' | 'punct' | 'text';
export type Token = { kind: TokenKind; text: string };

const keywords = new Set(
  'await async break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return static super switch throw try typeof var void while with yield get set'.split(' '),
);
const literals = new Set(['true', 'false', 'null', 'undefined', 'this', 'NaN', 'Infinity']);
// After these, a slash starts a regular expression rather than a division.
const regexAfter = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const regexAfterWord = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

/** Split source into tokens; concatenating their texts gives the source back. */
export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  // Last significant token, for the regex/division decision.
  let prev = '';
  // Brace depth of each open template substitution.
  const templates: number[] = [];
  let depth = 0;
  const push = (kind: TokenKind, text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind && (kind === 'text' || kind === 'punct')) last.text += text;
    else out.push({ kind, text });
  };
  const templateBody = () => {
    // From inside a template literal up to and including its end or "${".
    const start = i;
    while (i < src.length) {
      if (src[i] === '\\') i += 2;
      else if (src[i] === '`') {
        i++;
        push('string', src.slice(start, i));
        prev = 'x';
        return;
      } else if (src[i] === '$' && src[i + 1] === '{') {
        push('string', src.slice(start, i));
        push('punct', '${');
        i += 2;
        templates.push(depth);
        depth++;
        prev = '{';
        return;
      } else i++;
    }
    push('string', src.slice(start, i));
  };
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      push('comment', src.slice(i, stop));
      i = stop;
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      push('comment', src.slice(i, stop));
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      j = Math.min(src.length, j + 1);
      push('string', src.slice(i, j));
      i = j;
      prev = 'x';
    } else if (c === '`') {
      const start = i;
      i++;
      // Emit the opening quote with the body that follows.
      const before = out.length;
      templateBody();
      const first = out[before];
      if (first) first.text = src.slice(start, start + 1) + first.text;
      else push('string', '`');
    } else if (c === '}' && templates.length && depth - 1 === templates[templates.length - 1]) {
      templates.pop();
      depth--;
      push('punct', '}');
      i++;
      templateBody();
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(n ?? ''))) {
      const m = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?/.exec(src.slice(i));
      const text = m ? m[0] : c;
      push('number', text);
      i += text.length;
      prev = 'x';
    } else if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))!;
      const word = m[0];
      const next = /^\s*\(/.test(src.slice(i + word.length));
      push(keywords.has(word) ? 'keyword' : literals.has(word) ? 'literal' : word === 'studio' ? 'api' : next ? 'function' : 'text', word);
      i += word.length;
      prev = keywords.has(word) && regexAfterWord.has(word) ? '(' : 'x';
    } else if (c === '/' && (prev === '' || regexAfter.has(prev))) {
      // A regular expression literal: up to the closing slash outside a class.
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') j += 2;
        else if (src[j] === '[') (inClass = true), j++;
        else if (src[j] === ']') (inClass = false), j++;
        else if (src[j] === '/' && !inClass) break;
        else j++;
      }
      if (src[j] === '/') {
        j++;
        while (/[a-z]/.test(src[j] ?? '')) j++;
        push('regex', src.slice(i, j));
        i = j;
        prev = 'x';
      } else {
        push('punct', c);
        i++;
        prev = c;
      }
    } else if (/\s/.test(c)) {
      let j = i;
      while (j < src.length && /\s/.test(src[j])) j++;
      push('text', src.slice(i, j));
      i = j;
    } else {
      if (c === '{') depth++;
      else if (c === '}') depth = Math.max(0, depth - 1);
      push('punct', c);
      i++;
      prev = c === ')' || c === ']' ? 'x' : c;
    }
  }
  return out;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Highlighted HTML: tokens other than plain text become `<span class="tok-…">`. */
export function highlight(src: string): string {
  return tokenize(src)
    .map((t) => (t.kind === 'text' || t.kind === 'punct' ? escapeHtml(t.text) : `<span class="tok-${t.kind}">${escapeHtml(t.text)}</span>`))
    .join('');
}
