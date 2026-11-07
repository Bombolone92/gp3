/**
 * Syntax highlighting for fenced code blocks, loaded on demand (the message
 * renderer imports this module the first time it meets a block with a
 * language hint, so the initial bundle never carries it).
 *
 * Safety first: the input is the block's plain text, every token is escaped
 * with escapeHtml before it is emitted, and the only markup ever produced is
 * a fixed set of `<span class="tok-…">` wrappers. Nothing from the message
 * can reach the output unescaped, whatever the language rules do.
 *
 * Languages are small rule lists, tried in order at the current position;
 * a few (html, css) keep a little state. Unknown hints highlight nothing.
 */
import { escapeHtml } from './format.js';

const ALIASES = {
  js: 'js', javascript: 'js', mjs: 'js', cjs: 'js', jsx: 'js',
  ts: 'js', typescript: 'js', tsx: 'js',
  json: 'json', jsonc: 'json', json5: 'json',
  html: 'html', htm: 'html', xml: 'html', svg: 'html', vue: 'html',
  css: 'css', scss: 'css', less: 'css',
  sh: 'sh', bash: 'sh', zsh: 'sh', shell: 'sh', console: 'sh',
  py: 'py', python: 'py',
  sql: 'sql', mysql: 'sql', postgres: 'sql', postgresql: 'sql', sqlite: 'sql',
  diff: 'diff', patch: 'diff',
  md: 'md', markdown: 'md',
  yml: 'yaml', yaml: 'yaml',
};

/** The canonical language for a fence hint, or null when it is not one we know. */
export function languageOf(hint) {
  return ALIASES[String(hint || '').toLowerCase()] || null;
}

const span = (cls, text) => (cls ? `<span class="tok-${cls}">${escapeHtml(text)}</span>` : escapeHtml(text));

/** Turn a word list into a sticky regex with word boundaries. */
const words = (list, flags = '') => new RegExp(`(?:${list.split(' ').join('|')})\\b`, `y${flags}`);

const JS_KW = 'as async await break case catch class const continue debugger default delete do else enum export extends finally for from function get if implements import in instanceof interface let new of package private protected public return set static super switch this throw try type typeof var void while with yield declare namespace abstract readonly keyof satisfies';
const JS_LIT = 'true false null undefined NaN Infinity';
const PY_KW = 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case';
const PY_LIT = 'True False None';
const PY_BUILTIN = 'print len range str int float list dict set tuple open isinstance type super enumerate zip map filter sorted sum min max abs any all input repr id hash iter next';
const SH_KW = 'if then else elif fi for while until do done case esac in function select time return exit export local readonly source alias unset';
const SQL_KW = 'select from where and or not in is null as join left right inner outer full cross on group by order having limit offset insert into values update set delete create table index view drop alter add column primary key foreign references unique default check constraint distinct union all exists between like case when then else end begin commit rollback with recursive returning if asc desc';
const SQL_TYPES = 'int integer bigint smallint serial text varchar char boolean bool date timestamp timestamptz time numeric decimal real float double json jsonb uuid bytea';

/** A generic rule-list scanner: rules are [stickyRegex, class]. */
function scan(text, rules, fallback = /[\s\S]/y) {
  let out = '';
  let i = 0;
  outer:
  while (i < text.length) {
    for (const [re, cls, fn] of rules) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m && m[0].length) {
        out += fn ? fn(m) : span(cls, m[0]);
        i += m[0].length;
        continue outer;
      }
    }
    fallback.lastIndex = i;
    const m = fallback.exec(text);
    const chunk = m && m[0].length ? m[0] : text[i];
    out += escapeHtml(chunk);
    i += chunk.length;
  }
  return out;
}

/* ---- languages ---------------------------------------------------------- */

const JS_RULES = [
  [/\/\/[^\n]*/y, 'com'],
  [/\/\*[\s\S]*?(?:\*\/|$)/y, 'com'],
  [/`(?:\\[\s\S]|[^`\\])*`?/y, 'str'],
  [/'(?:\\.|[^'\\\n])*'?/y, 'str'],
  [/"(?:\\.|[^"\\\n])*"?/y, 'str'],
  [/\b0[xX][\da-fA-F_]+n?\b|\b0[bB][01_]+n?\b|\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?n?\b/y, 'num'],
  [words(JS_KW), 'kw'],
  [words(JS_LIT), 'lit'],
  [/@[A-Za-z_$][\w$]*/y, 'attr'],
  [/\b[A-Z][\w$]*\b/y, 'type'],
  [/\b[a-z_$][\w$]*(?=\s*\()/y, 'fn'],
  [/[{}()[\];,.]/y, 'punc'],
  [/=>|\.\.\.|[-+*/%=<>!&|^~?:]+/y, 'op'],
  [/\b[A-Za-z_$][\w$]*\b/y, null],
];

const JSON_RULES = [
  [/\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y, 'com'],
  [/"(?:\\.|[^"\\\n])*"(?=\s*:)/y, 'attr'],
  [/"(?:\\.|[^"\\\n])*"?/y, 'str'],
  [/-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y, 'num'],
  [words('true false null'), 'lit'],
  [/[{}[\],:]/y, 'punc'],
];

const PY_RULES = [
  [/#[^\n]*/y, 'com'],
  [/(?:[rRbBuUfF]{1,2})?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$))/y, 'str'],
  [/(?:[rRbBuUfF]{1,2})?(?:'(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?)/y, 'str'],
  [/@[\w.]+/y, 'attr'],
  [/\b0[xX][\da-fA-F_]+\b|\b\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?j?\b/y, 'num'],
  [/\b(?:def|class)\b/y, 'kw'],
  [words(PY_KW), 'kw'],
  [words(PY_LIT), 'lit'],
  [words(PY_BUILTIN), 'fn'],
  [/\b[A-Z]\w*\b/y, 'type'],
  [/\b[a-z_]\w*(?=\s*\()/y, 'fn'],
  [/[{}()[\];,.]/y, 'punc'],
  [/->|[-+*/%=<>!&|^~@:]+/y, 'op'],
  [/\b\w+\b/y, null],
];

const SH_RULES = [
  [/#[^\n]*/y, 'com'],
  [/'[^']*'?/y, 'str'],
  [/"(?:\\.|[^"\\])*"?/y, 'str'],
  [/\$\{[^}]*\}|\$[\w@#?*!$-]+|\$\((?:[^()]|\([^()]*\))*\)/y, 'var'],
  [/(?<=^|[\s;|&])(?:--?[\w-]+)/y, 'attr'],
  [/(?<=^|[;|&]\s*|\n\s*|\$\(\s*|`\s*)[A-Za-z_][\w.-]*(?=\s|$)/y, 'fn'],
  [words(SH_KW), 'kw'],
  [/\b\d+\b/y, 'num'],
  [/\|\||&&|[|&;<>]+|\(\)|[{}()[\]]/y, 'op'],
  [/[\w./-]+/y, null],
];

const SQL_RULES = [
  [/--[^\n]*/y, 'com'],
  [/\/\*[\s\S]*?(?:\*\/|$)/y, 'com'],
  [/'(?:''|[^'])*'?/y, 'str'],
  [/"(?:""|[^"])*"?|`[^`]*`?/y, 'attr'],
  [/\b\d+(?:\.\d+)?\b/y, 'num'],
  [words(SQL_KW, 'i'), 'kw'],
  [words(SQL_TYPES, 'i'), 'type'],
  [/\b[A-Za-z_]\w*(?=\s*\()/y, 'fn'],
  [/[(),;.]/y, 'punc'],
  [/<>|<=|>=|!=|\|\||[-+*/%=<>]/y, 'op'],
  [/\b\w+\b/y, null],
];

const DIFF_RULES = [
  [/^(?:diff |index |--- |\+\+\+ |rename |new file |deleted file |similarity )[^\n]*/my, 'com'],
  [/^@@[^\n]*/my, 'meta'],
  [/^\+[^\n]*/my, 'ins'],
  [/^-[^\n]*/my, 'del'],
  [/^[^\n]*\n?/my, null],
];

const MD_RULES = [
  [/^#{1,6}[ \t][^\n]*/my, 'kw'],
  // The block runs to its closing fence or to the end of the text: with the
  // m flag, $ would have matched at the end of the block's first line, so
  // the closing fence opened a new "block" that painted the prose after it.
  [/^(?:```|~~~)[^\n]*\n[\s\S]*?(?:\n(?:```|~~~)|(?![\s\S]))/my, 'str'],
  [/`[^`\n]+`/y, 'str'],
  [/^>[^\n]*/my, 'com'],
  [/^[ \t]*(?:[-*+]|\d+\.)[ \t]/my, 'punc'],
  [/!?\[[^\]\n]*\]\([^)\n]*\)/y, null, (m) => {
    const i = m[0].indexOf('](');
    return span('fn', m[0].slice(0, i + 1)) + span('punc', '(') + span('attr', m[0].slice(i + 2, -1)) + span('punc', ')');
  }],
  [/\*\*[^*\n]+\*\*|__[^_\n]+__/y, 'type'],
  [/\*[^*\n]+\*|_[^_\n]+_/y, 'lit'],
  [/https?:\/\/[^\s<>)]+/y, 'attr'],
  [/[^\n`*_#>[!h]+|[\s\S]/y, null],
];

const YAML_RULES = [
  [/#[^\n]*/y, 'com'],
  [/^---[^\n]*|^\.\.\.[^\n]*/my, 'meta'],
  [/^[ \t]*-(?=[ \t]|$)/my, 'punc'],
  [/^[ \t]*(?:"[^"\n]*"|'[^'\n]*'|[^\s#:-][^\n:]*?)(?=:(?:[ \t]|$))/my, 'attr'],
  [/(?<=^[ \t]*-[ \t]+)(?:"[^"\n]*"|'[^'\n]*'|[^\s#:-][^\n:]*?)(?=:(?:[ \t]|$))/my, 'attr'],
  [/[ \t]+/y, null],
  [/"(?:\\.|[^"\\\n])*"?|'(?:''|[^'\n])*'?/y, 'str'],
  [/(?<=:[ \t]+|-[ \t]+)(?:true|false|null|~|yes|no|on|off)\b/y, 'lit'],
  [/(?<=:[ \t]+|-[ \t]+)-?\d[\d_]*(?:\.\d+)?\b/y, 'num'],
  [/[&*][\w-]+/y, 'var'],
  [/:(?=[ \t]|$)|[{}[\],|>]/my, 'punc'],
  [/[^\n:#"'{}[\],&*-]+|[\s\S]/y, null],
];

/** HTML keeps a little state: inside a tag, attribute names and values differ from text. */
function html(text) {
  let out = '';
  let i = 0;
  const rest = () => text.slice(i);
  while (i < text.length) {
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i);
      const stop = end === -1 ? text.length : end + 3;
      out += span('com', text.slice(i, stop));
      i = stop;
      continue;
    }
    let m = /^<!(?:doctype|DOCTYPE)[^>]*>?/.exec(rest());
    if (m) {
      out += span('meta', m[0]);
      i += m[0].length;
      continue;
    }
    m = /^<\/?[A-Za-z][\w:.-]*/.exec(rest());
    if (m) {
      out += span('punc', m[0].startsWith('</') ? '</' : '<') + span('tag', m[0].replace(/^<\/?/, ''));
      i += m[0].length;
      // Attributes until the tag closes.
      for (;;) {
        const a = /^(\s+)([^\s=/>]+)(\s*=\s*)?/.exec(rest());
        if (a) {
          out += escapeHtml(a[1]) + span('attr', a[2]);
          i += a[1].length + a[2].length;
          if (a[3]) {
            out += span('op', a[3]);
            i += a[3].length;
            const v = /^(?:"[^"]*"?|'[^']*'?|[^\s>]+)/.exec(rest());
            if (v) {
              out += span('str', v[0]);
              i += v[0].length;
            }
          }
          continue;
        }
        const close = /^\s*\/?>/.exec(rest());
        if (close) {
          out += span('punc', close[0]);
          i += close[0].length;
        }
        break;
      }
      // Script and style bodies get their own rules.
      const opened = /<(script|style)\b/i.exec(m[0]);
      if (opened && !m[0].startsWith('</')) {
        const name = opened[1].toLowerCase();
        const endRe = new RegExp(`</${name}\\s*>`, 'i');
        const at = rest().search(endRe);
        const body = at === -1 ? rest() : rest().slice(0, at);
        out += name === 'script' ? scan(body, JS_RULES) : css(body);
        i += body.length;
      }
      continue;
    }
    m = /^&[#\w]+;/.exec(rest());
    if (m) {
      out += span('lit', m[0]);
      i += m[0].length;
      continue;
    }
    m = /^[^<&]+/.exec(rest());
    const chunk = m ? m[0] : text[i];
    out += escapeHtml(chunk);
    i += chunk.length;
  }
  return out;
}

/** CSS: selectors outside braces, properties and values inside. */
function css(text) {
  let out = '';
  let i = 0;
  let depth = 0;
  const rules = {
    any: [
      [/\/\*[\s\S]*?(?:\*\/|$)/y, 'com'],
      [/"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/y, 'str'],
    ],
    selector: [
      [/@[\w-]+/y, 'kw'],
      [/[.#][\w-]+/y, 'attr'],
      [/::?[\w-]+(?:\([^)]*\))?/y, 'lit'],
      [/\[[^\]]*\]/y, 'str'],
      [/\b[a-zA-Z][\w-]*\b/y, 'tag'],
      [/[>+~,*]/y, 'op'],
    ],
    block: [
      [/[\w-]+(?=\s*:)/y, 'attr'],
      [/!important\b/y, 'kw'],
      [/#[\da-fA-F]{3,8}\b/y, 'num'],
      [/-?\d*\.?\d+(?:%|[a-zA-Z]+)?/y, 'num'],
      [/\b[a-zA-Z-]+(?=\()/y, 'fn'],
      [/(?:--)?[\w-]+/y, null],
      [/[:;,()]/y, 'punc'],
    ],
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{') {
      depth++;
      out += span('punc', ch);
      i++;
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      out += span('punc', ch);
      i++;
      continue;
    }
    let matched = false;
    for (const [re, cls] of rules.any.concat(depth ? rules.block : rules.selector)) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m && m[0].length) {
        out += span(cls, m[0]);
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += escapeHtml(ch);
      i++;
    }
  }
  return out;
}

const LANGS = {
  js: (t) => scan(t, JS_RULES, /[^\s'"`/@A-Za-z0-9_$.{}()[\];,=<>!&|^~?:+*%-]+|\s+|[\s\S]/y),
  json: (t) => scan(t, JSON_RULES, /[^"{}[\],:\d\-tfn/]+|[\s\S]/y),
  py: (t) => scan(t, PY_RULES, /[^\s#'"@\w{}()[\];,.=<>!&|^~:+*%-]+|\s+|[\s\S]/y),
  sh: (t) => scan(t, SH_RULES, /\s+|[\s\S]/y),
  sql: (t) => scan(t, SQL_RULES, /[^\s\w'"`(),;.=<>!|+*/%-]+|\s+|[\s\S]/y),
  diff: (t) => scan(t, DIFF_RULES),
  md: (t) => scan(t, MD_RULES),
  yaml: (t) => scan(t, YAML_RULES),
  html,
  css,
};

/**
 * highlight(text, hint) -> HTML string made of escaped text and tok- spans,
 * or plain escaped text when the language is unknown.
 */
export function highlight(text, hint) {
  const lang = languageOf(hint);
  const src = String(text || '');
  if (!lang) return escapeHtml(src);
  try {
    return LANGS[lang](src);
  } catch {
    return escapeHtml(src);
  }
}

export const SUPPORTED_LANGUAGES = Object.keys(LANGS);
