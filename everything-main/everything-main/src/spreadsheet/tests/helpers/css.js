/**
 * Read the app's stylesheets and answer questions about them without a
 * layout engine: which declarations a selector carries (optionally inside a
 * media query), what a token resolves to in each theme, and the WCAG
 * contrast between two colours once translucent layers are composited.
 */
import fs from 'node:fs';
import path from 'node:path';

export function stylesheet(name) {
  // Not `new URL(…, import.meta.url)`: Vite rewrites that pattern as an asset reference.
  return fs.readFileSync(path.resolve(process.cwd(), 'src/styles', name), 'utf8');
}

/** Every rule as { selectors, body, media } where `media` lists the enclosing at-rule preludes. */
export function parseRules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = [];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      stack.push({ prelude: src.slice(start, i).trim(), bodyStart: i + 1, nested: false });
      start = i + 1;
    } else if (ch === '}') {
      const open = stack.pop();
      if (open && !open.nested) rules.push({ selectors: open.prelude.split(',').map((s) => s.trim()), body: src.slice(open.bodyStart, i), media: stack.map((s) => s.prelude) });
      if (stack.length) stack[stack.length - 1].nested = true;
      start = i + 1;
    } else if (ch === ';') {
      start = i + 1;
    }
  }
  return rules;
}

/** Split a declaration block on the semicolons outside quotes and parentheses (data URIs carry their own). */
function splitDeclarations(body) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (const ch of body) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ';' && !depth) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** The declarations of one block as { property: value }; a repeated property keeps its last value. */
export function declarations(body) {
  const out = {};
  for (const part of splitDeclarations(body)) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * The rules whose selector list names `selector` exactly. `media` keeps only
 * rules nested in an at-rule whose prelude contains that text; `null` keeps
 * every rule, `false` only rules outside any at-rule.
 */
export function rulesFor(css, selector, media = null) {
  return parseRules(css).filter((r) => r.selectors.includes(selector)
    && (media === null || (media === false ? !r.media.length : r.media.some((m) => m.includes(media)))));
}

/** The declarations every matching rule gives `selector`, merged in source order (later wins). */
export function declared(css, selector, media = null) {
  return Object.assign({}, ...rulesFor(css, selector, media).map((r) => declarations(r.body)));
}

/** The design tokens of one theme: 'light' from bare :root, 'dark' from the explicit stamp. */
export function themeTokens(theme) {
  const css = stylesheet('tokens.css');
  const selector = theme === 'dark' ? ':root[data-theme="dark"]' : ':root';
  const decls = declared(css, selector, false);
  const out = {};
  for (const [k, v] of Object.entries(decls)) if (k.startsWith('--')) out[k.slice(2)] = v;
  return out;
}

/** A CSS colour (#rgb, #rrggbb, rgb(), rgba(), white, transparent) as [r, g, b, a]. */
export function parseColor(c) {
  const s = String(c).trim();
  let m;
  if ((m = s.match(/^#([0-9a-f]{6})$/i))) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  if ((m = s.match(/^#([0-9a-f]{3})$/i))) return [...m[1]].map((h) => parseInt(h + h, 16)).concat(1);
  if ((m = s.match(/^rgba?\(([^)]+)\)$/))) { const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p[3] ?? 1]; }
  if (s === 'white') return [255, 255, 255, 1];
  if (s === 'transparent') return [0, 0, 0, 0];
  throw new Error(`cannot parse colour ${c}`);
}

/** `fg` laid over an opaque `bg`. */
export function over(fg, bg) {
  const a = fg[3];
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1);
}

export function luminance([r, g, b]) {
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two opaque colours. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
