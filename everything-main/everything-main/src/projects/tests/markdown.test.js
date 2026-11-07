import { describe, it, expect } from 'vitest';
import { parseMarkdown, parseInline, safeHref, hasMarkdown, plainSummary } from '../src/lib/markdown.js';

const types = (blocks) => blocks.map((b) => b.type);
const text = (nodes) => nodes.map((n) => (n.type === 'text' ? n.value
  : n.type === 'break' ? '\n'
    : n.type === 'code' ? `\`${n.value}\``
      : text(n.children ?? []))).join('');

describe('safeHref', () => {
  it('allows only http(s)', () => {
    expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeHref('HTTP://EXAMPLE.COM')).toBe('HTTP://EXAMPLE.COM');
    expect(safeHref(' https://example.com ')).toBe('https://example.com');
  });

  it('rejects every scheme that could execute or exfiltrate', () => {
    for (const bad of [
      'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>',
      'vbscript:msgbox', 'file:///etc/passwd', '//evil.example.com',
      'mailto:me@example.com', '', null, undefined, 'https://ok.com/"onmouseover="x',
    ]) {
      expect(safeHref(bad)).toBeNull();
    }
  });
});

describe('block parsing', () => {
  it('splits paragraphs on blank lines', () => {
    const blocks = parseMarkdown('one\n\ntwo');
    expect(types(blocks)).toEqual(['paragraph', 'paragraph']);
    expect(text(blocks[0].inline)).toBe('one');
  });

  it('keeps single newlines as visible breaks', () => {
    const [block] = parseMarkdown('line one\nline two');
    expect(text(block.inline)).toBe('line one\nline two');
  });

  it('reads headings, quotes, and rules', () => {
    const blocks = parseMarkdown('## Spec\n\n> careful\n\n---');
    expect(types(blocks)).toEqual(['heading', 'quote', 'hr']);
    expect(blocks[0].level).toBe(2);
    expect(text(blocks[0].inline)).toBe('Spec');
    expect(text(blocks[1].inline)).toBe('careful');
  });

  it('reads bullet and ordered lists, including continuation lines', () => {
    const blocks = parseMarkdown('- one\n- two\n    still two\n\n2. a\n3. b');
    expect(types(blocks)).toEqual(['list', 'list']);
    expect(blocks[0].ordered).toBe(false);
    expect(blocks[0].items.map(text)).toEqual(['one', 'two still two']);
    expect(blocks[1].ordered).toBe(true);
    expect(blocks[1].start).toBe(2);
  });

  it('reads fenced code verbatim, markdown and all', () => {
    const [block] = parseMarkdown('```js\nconst a = **not bold**;\n```');
    expect(block).toMatchObject({ type: 'code', lang: 'js' });
    expect(block.text).toBe('const a = **not bold**;');
  });

  it('treats an unclosed fence as code to the end', () => {
    const [block] = parseMarkdown('```\nstill code');
    expect(block.text).toBe('still code');
  });

  it('starts a new block when a list interrupts a paragraph', () => {
    expect(types(parseMarkdown('intro\n- one'))).toEqual(['paragraph', 'list']);
  });

  it('returns nothing for empty input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('   \n\n')).toEqual([]);
    expect(parseMarkdown(null)).toEqual([]);
  });
});

describe('inline parsing', () => {
  it('handles bold, italic, and inline code', () => {
    expect(parseInline('**b** and *i* and `c`').map((n) => n.type))
      .toEqual(['strong', 'text', 'em', 'text', 'code']);
  });

  it('leaves snake_case alone', () => {
    const nodes = parseInline('file_name_here');
    expect(nodes).toEqual([{ type: 'text', value: 'file_name_here' }]);
  });

  it('does not format inside inline code', () => {
    const [node] = parseInline('`**not bold**`');
    expect(node).toEqual({ type: 'code', value: '**not bold**' });
  });

  it('links markdown links and bare URLs', () => {
    const [link] = parseInline('[docs](https://example.com/docs)');
    expect(link).toMatchObject({ type: 'link', href: 'https://example.com/docs' });
    expect(text(link.children)).toBe('docs');

    const nodes = parseInline('see https://example.com/x, then stop');
    const auto = nodes.find((n) => n.type === 'link');
    expect(auto.href).toBe('https://example.com/x'); // trailing comma excluded
  });

  it('starts a link at the innermost bracket, and two links in a row stay two', () => {
    const nodes = parseInline('[a [b](https://x.io/) c');
    expect(nodes.map((n) => n.type)).toEqual(['text', 'link', 'text']);
    expect(nodes[0].value).toBe('[a ');
    expect(text(nodes[1].children)).toBe('b');
    expect(parseInline('[a](https://a.io/)[b](https://b.io/)').map((n) => n.href))
      .toEqual(['https://a.io/', 'https://b.io/']);
  });

  // Every "[" used to be checked against the whole rest of the text, so a
  // brief holding a few thousand stray brackets froze the home page for
  // seconds per render. Bounded now: one look per bracket.
  it('parses a run of unclosed brackets in linear time', () => {
    const hostile = '['.repeat(50000);
    const started = performance.now();
    expect(parseInline(hostile)).toEqual([{ type: 'text', value: hostile }]);
    expect(plainSummary(hostile, 20).length).toBe(20);
    expect(hasMarkdown(hostile)).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('degrades an unsafe link to plain text', () => {
    expect(parseInline('[click](javascript:alert(1))')).toEqual([{ type: 'text', value: 'click' }]);
    expect(parseInline('[x](data:text/html,hi)')).toEqual([{ type: 'text', value: 'x' }]);
  });

  it('keeps raw HTML as text', () => {
    const nodes = parseInline('<img src=x onerror=alert(1)>');
    expect(nodes).toEqual([{ type: 'text', value: '<img src=x onerror=alert(1)>' }]);
  });

  it('honors backslash escapes', () => {
    expect(parseInline('\\*not italic\\*')).toEqual([{ type: 'text', value: '*not italic*' }]);
  });

  it('leaves unmatched markers as text', () => {
    expect(text(parseInline('2 * 3 * 4 = 24'))).toBe('2 * 3 * 4 = 24');
    expect(text(parseInline('a ** b'))).toBe('a ** b');
  });
});

describe('hasMarkdown', () => {
  it('spots formatting worth rendering', () => {
    expect(hasMarkdown('plain sentence')).toBe(false);
    expect(hasMarkdown('- a list')).toBe(true);
    expect(hasMarkdown('**bold**')).toBe(true);
    expect(hasMarkdown('see https://example.com')).toBe(true);
  });
});

describe('plainSummary', () => {
  it('flattens a brief into one line of plain text', () => {
    expect(plainSummary('# Goals\n\nShip the **beta** by Friday.'))
      .toBe('Goals Ship the beta by Friday.');
    expect(plainSummary('- one\n- two')).toBe('one · two');
    expect(plainSummary('see [the spec](https://example.com)')).toBe('see the spec');
  });

  it('collapses whitespace and has nothing to say about nothing', () => {
    expect(plainSummary('a\n\n\nb')).toBe('a b');
    expect(plainSummary('')).toBe('');
    expect(plainSummary(null)).toBe('');
    expect(plainSummary('---')).toBe('');
  });

  it('truncates to the length the caller has room for', () => {
    const long = plainSummary('word '.repeat(60), 40);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith('…')).toBe(true);
  });
});
