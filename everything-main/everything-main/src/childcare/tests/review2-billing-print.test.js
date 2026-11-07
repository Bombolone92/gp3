import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// A tiny cascade over tokens.css and print.css: enough selectors to tell
// which custom property values <html> gets while printing.
const css = ['tokens.css', 'print.css'].map((f) => readFileSync(new URL(`../src/styles/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');

function rules(text) {
  const out = [];
  const walk = (src, media) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const head = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (depth && j < src.length) depth += src[j] === '{' ? 1 : src[j] === '}' ? -1 : 0, j++;
      const body = src.slice(open + 1, j - 1);
      if (head.startsWith('@media')) walk(body, [...media, head]);
      else if (!head.startsWith('@')) {
        const decls = Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
        for (const sel of head.split(',').map((x) => x.trim())) out.push({ sel, media, decls });
      }
      i = j;
    }
  };
  walk(text, []);
  return out;
}

function matches(sel, theme) {
  let spec = 0;
  let rest = sel;
  const attr = (a) => {
    const m = /^\[data-theme(?:='(\w+)')?\]$/.exec(a);
    if (!m) return null;
    return m[1] ? theme === m[1] : theme !== undefined;
  };
  while (rest) {
    let m;
    if ((m = /^:root/.exec(rest))) spec++;
    else if ((m = /^:not\((\[[^\]]+\])\)/.exec(rest))) {
      const r = attr(m[1]);
      if (r === null || r) return null;
      spec++;
    } else if ((m = /^\[[^\]]+\]/.exec(rest))) {
      const r = attr(m[0]);
      if (!r) return null;
      spec++;
    } else return null;
    rest = rest.slice(m[0].length);
  }
  return spec;
}

function printed(prop, { theme, systemDark }) {
  let best = null;
  rules(css).forEach((r, order) => {
    const ok = r.media.every((m) => (m.includes('print') ? true : m.includes('prefers-color-scheme: dark') ? systemDark : false));
    const spec = ok && prop in r.decls ? matches(r.sel, theme) : null;
    if (spec === null) return;
    if (!best || spec > best.spec || (spec === best.spec && order > best.order)) best = { spec, order, value: r.decls[prop] };
  });
  return best?.value;
}

describe('print: statements, reports, and menus print dark on white in every theme', () => {
  const states = [
    ['light theme', { theme: 'light', systemDark: true }],
    ['dark theme', { theme: 'dark', systemDark: false }],
    ['system theme on a dark system', { theme: undefined, systemDark: true }],
  ];
  for (const [name, state] of states) {
    it(`uses the light palette in the ${name}`, () => {
      expect(printed('--text', state)).toBe('#111');
      expect(printed('--surface', state)).toBe('#fff');
      // Status pills and colored text print with their light colors.
      expect(printed('--danger', state)).toBe('#c0262d');
      expect(printed('--success-soft', state)).toBe('#e5f4ec');
      expect(printed('--t-pink', state)).toBe('#b0246b');
    });
  }
});
