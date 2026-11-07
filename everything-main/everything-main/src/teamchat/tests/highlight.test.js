/**
 * The code highlighter: it may only ever emit escaped text and tok- spans,
 * whatever the language rules do, and its colours must be readable.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { highlight, languageOf, SUPPORTED_LANGUAGES } from '../src/lib/highlight.js';
import { formatMessage } from '../src/lib/format.js';

/** Strip our own spans; what is left must be exactly the escaped source. */
const stripSpans = (html) => html.replace(/<span class="tok-[a-z]+">/g, '').replace(/<\/span>/g, '');
const escape = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SAMPLES = {
  js: 'const x = await fetch(`/api/${id}`); // note\nif (x.ok) return new Map([[1, "a"]]);',
  json: '{ "name": "teamchat", "n": 3, "ok": true, "list": [null] }',
  html: '<!doctype html>\n<div class="a" data-x=1>&amp; text <!-- c --><script>let a = 1;</script></div>',
  css: '@media (max-width: 20px) { .a:hover > b { color: #fff; margin: 1.5em !important; } }',
  sh: '#!/bin/sh\nnpm run build --silent && echo "$HOME" ${X:-y} | grep -v x',
  py: '@dec\ndef f(x: int) -> str:\n    """doc"""\n    return f"{x}" if x else None',
  sql: "SELECT count(*) FROM users u WHERE u.name = 'a''b' AND id > 10 -- c",
  diff: '--- a\n+++ b\n@@ -1,2 +1,2 @@\n-old\n+new\n same',
  md: '# Title\nSome **bold** and `code` and [link](https://x.io)\n> quote\n- item',
  yaml: 'name: app\nlist:\n  - one\n  - 2\n  - k: v\nnested:\n  inner: "s"\nok: true # c',
};

describe('highlight', () => {
  it('knows the hints it supports and their aliases', () => {
    expect(languageOf('JavaScript')).toBe('js');
    expect(languageOf('tsx')).toBe('js');
    expect(languageOf('bash')).toBe('sh');
    expect(languageOf('patch')).toBe('diff');
    expect(languageOf('rust')).toBeNull();
    expect(languageOf('')).toBeNull();
    for (const lang of Object.keys(SAMPLES)) expect(SUPPORTED_LANGUAGES).toContain(lang);
  });

  it('emits only escaped text and tok- spans, for every language and sample', () => {
    for (const [lang, src] of Object.entries(SAMPLES)) {
      const out = highlight(src, lang);
      expect(stripSpans(out), lang).toBe(escape(src));
      expect(out, lang).toContain('<span class="tok-');
      // No tag other than our spans.
      expect(out.replace(/<span class="tok-[a-z]+">|<\/span>/g, ''), lang).not.toMatch(/<|>/);
    }
  });

  it('cannot be tricked into markup by hostile code', () => {
    const evil = '</code></pre><script>alert(1)</script><img src=x onerror=alert(1)> `${"</span>"}` \'"';
    for (const lang of SUPPORTED_LANGUAGES) {
      const out = highlight(evil, lang);
      expect(stripSpans(out), lang).toBe(escape(evil));
      expect(out, lang).not.toContain('<script');
      expect(out, lang).not.toContain('<img');
    }
  });

  it('leaves unknown languages as plain escaped text', () => {
    expect(highlight('<b>x</b>', 'rust')).toBe('&lt;b&gt;x&lt;/b&gt;');
    expect(highlight('', 'js')).toBe('');
  });

  it('classifies the obvious things', () => {
    const js = highlight(SAMPLES.js, 'js');
    expect(js).toContain('<span class="tok-kw">const</span>');
    expect(js).toContain('<span class="tok-com">// note</span>');
    expect(js).toContain('<span class="tok-fn">fetch</span>');
    expect(js).toContain('<span class="tok-type">Map</span>');
    expect(js).toContain('<span class="tok-str">&quot;a&quot;</span>');
    const json = highlight(SAMPLES.json, 'json');
    expect(json).toContain('<span class="tok-attr">&quot;name&quot;</span>');
    expect(json).toContain('<span class="tok-str">&quot;teamchat&quot;</span>');
    expect(json).toContain('<span class="tok-lit">true</span>');
    const html = highlight(SAMPLES.html, 'html');
    expect(html).toContain('<span class="tok-tag">div</span>');
    expect(html).toContain('<span class="tok-attr">class</span>');
    expect(html).toContain('<span class="tok-str">&quot;a&quot;</span>');
    expect(html).toContain('<span class="tok-com">&lt;!-- c --&gt;</span>');
    expect(html).toContain('<span class="tok-kw">let</span>'); // script body highlighted as js
    const css = highlight(SAMPLES.css, 'css');
    expect(css).toContain('<span class="tok-kw">@media</span>');
    expect(css).toContain('<span class="tok-attr">color</span>');
    expect(css).toContain('<span class="tok-num">#fff</span>');
    const sh = highlight(SAMPLES.sh, 'sh');
    expect(sh).toContain('<span class="tok-com">#!/bin/sh</span>');
    expect(sh).toContain('<span class="tok-var">${X:-y}</span>');
    expect(sh).toContain('<span class="tok-str">&quot;$HOME&quot;</span>');
    expect(sh).toContain('<span class="tok-fn">grep</span>');
    expect(sh).toContain('<span class="tok-attr">--silent</span>');
    const py = highlight(SAMPLES.py, 'py');
    expect(py).toContain('<span class="tok-kw">def</span>');
    expect(py).toContain('<span class="tok-attr">@dec</span>');
    expect(py).toContain('<span class="tok-lit">None</span>');
    const sql = highlight(SAMPLES.sql, 'sql');
    expect(sql).toContain('<span class="tok-kw">SELECT</span>');
    expect(sql).toContain('<span class="tok-str">&#39;a&#39;&#39;b&#39;</span>');
    const diff = highlight(SAMPLES.diff, 'diff');
    expect(diff).toContain('<span class="tok-ins">+new</span>');
    expect(diff).toContain('<span class="tok-del">-old</span>');
    const md = highlight(SAMPLES.md, 'md');
    expect(md).toContain('<span class="tok-kw"># Title</span>');
    expect(md).toContain('<span class="tok-attr">https://x.io</span>');
    const yaml = highlight(SAMPLES.yaml, 'yaml');
    expect(yaml).toContain('<span class="tok-attr">name</span>');
    expect(yaml).toContain('<span class="tok-attr">  inner</span>');
    expect(yaml).toContain('<span class="tok-attr">k</span>');
    expect(yaml).toContain('<span class="tok-num">2</span>');
    expect(yaml).toContain('<span class="tok-lit">true</span>');
  });
});

describe('formatMessage and code blocks', () => {
  it('keeps the language hint as an attribute and the code inert', () => {
    expect(formatMessage('```js\nconst a = "<x>";\n```')).toBe('<pre class="code-block" data-lang="js"><code>const a = &quot;&lt;x&gt;&quot;;</code></pre>');
    expect(formatMessage('```\nplain\n```')).toBe('<pre class="code-block"><code>plain</code></pre>');
    // A hint that is not a word stays part of the code.
    expect(formatMessage('```<b>\nx\n```')).toBe('<pre class="code-block"><code>&lt;b&gt;\nx</code></pre>');
    const hostile = formatMessage('```js"><script>\n</code></pre><script>alert(1)</script>\n```');
    expect(hostile).not.toContain('<script');
    expect(hostile).toBe('<pre class="code-block"><code>js&quot;&gt;&lt;script&gt;\n&lt;/code&gt;&lt;/pre&gt;&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>');
  });
});

/* ---- contrast ------------------------------------------------------------ */

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

describe('token colours', () => {
  const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
  const blocks = {
    light: css.slice(0, css.indexOf('@media')),
    dark: css.slice(css.indexOf(':root[data-theme="dark"]')),
  };
  const surface = { light: '#f0efec', dark: '#222224' };

  for (const theme of ['light', 'dark']) {
    it(`clear 4.5:1 on the code background in ${theme}`, () => {
      const tokens = [...blocks[theme].matchAll(/--tok-([a-z]+):\s*(#[0-9a-fA-F]{6})/g)];
      expect(tokens.length).toBeGreaterThanOrEqual(13);
      for (const [, name, hex] of tokens) {
        expect(contrast(hex, surface[theme]), `${theme} --tok-${name} ${hex}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

describe('markdown fences', () => {
  it('runs a fenced block to its closing fence, and paints nothing after it as code', () => {
    const out = highlight('```js\nline one\nline two\n```\nafter the block', 'md');
    expect(out).toContain('<span class="tok-str">```js\nline one\nline two\n```</span>');
    expect(out.match(/tok-str/g)).toHaveLength(1);
    expect(out).toMatch(/<\/span>\nafter the block$/);
  });

  it('runs an unclosed fence to the end of the text', () => {
    const out = highlight('```\nstill code\nand more', 'md');
    expect(out).toBe('<span class="tok-str">```\nstill code\nand more</span>');
  });
});
