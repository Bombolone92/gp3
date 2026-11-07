// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { splitMarkdown, splitHtml, splitImport, CHUNK_LIMITS } from '../src/lib/import-chunks.js';

describe('splitting large imports', () => {
  it('leaves a document that fits one conversion alone', () => {
    expect(splitMarkdown('# Title\n\nOne paragraph.\n\n- a\n- b')).toBeNull();
    expect(splitHtml('<h1>Title</h1><p>One</p>')).toBeNull();
    expect(splitImport({ type: 'text', value: 'x\n'.repeat(5000) })).toBeNull();
  });

  it('splits Markdown at top-level blocks, counting the blocks a list hides', () => {
    const list = Array.from({ length: 10 }, (_, i) => `- item ${i}`).join('\n');
    const source = `# Title\n\n${list}\n\nAfter.`;
    const chunks = splitMarkdown(source, { ...CHUNK_LIMITS, blocks: 12 });
    // Each item is a list item and a paragraph: the title and five items fill the budget, the rest follow with "After.".
    expect(chunks).toHaveLength(2);
    expect(chunks[0].startsWith('# Title\n\n- item 0')).toBe(true);
    expect(chunks[0].endsWith('- item 4')).toBe(true);
    expect(chunks[1]).toBe('- item 5\n- item 6\n- item 7\n- item 8\n- item 9\n\nAfter.');
  });

  it('splits a list longer than the budget between its items, keeping their numbers', () => {
    const items = Array.from({ length: 30 }, (_, i) => `${i + 1}. item ${i + 1}`).join('\n');
    const chunks = splitMarkdown(`Intro.\n\n${items}`, { ...CHUNK_LIMITS, blocks: 20 });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].startsWith('Intro.\n\n1. item 1')).toBe(true);
    expect(chunks.at(-1).endsWith('30. item 30')).toBe(true);
    // Every item appears once, in order, with its own number.
    expect(chunks.join('\n').match(/^\d+\. item \d+$/gm)).toEqual(items.split('\n'));
  });

  it('numbers the pieces of a list written "1." on every line so they count on instead of restarting', () => {
    const items = Array.from({ length: 30 }, (_, i) => `1. item ${i + 1}`).join('\n');
    const chunks = splitMarkdown(`Intro.\n\n${items}`, { ...CHUNK_LIMITS, blocks: 20 });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].startsWith('Intro.\n\n1. item 1')).toBe(true);
    let seen = chunks[0].match(/^1\. item/gm).length;
    for (const chunk of chunks.slice(1)) {
      expect(chunk).toMatch(new RegExp(`^${seen + 1}\\. item ${seen + 1}(\\n|$)`));
      seen += chunk.match(/^\d+\. item/gm).length;
    }
    expect(seen).toBe(30);
    // A list that starts at another number counts on from it.
    const fromFive = splitMarkdown(Array.from({ length: 30 }, (_, i) => `${i ? 5 : 5}. item ${i + 1}`).join('\n'), { ...CHUNK_LIMITS, blocks: 20 });
    expect(fromFive[1].startsWith(`${5 + fromFive[0].match(/^\d+\. item/gm).length}. item`)).toBe(true);
  });

  it('carries the link and footnote definitions a piece refers to, and only those', () => {
    const source = 'See [docs][d] first.\n\nThen [more][d] here[^1].\n\n[d]: https://example.com\n\n[^1]: A note.';
    const chunks = splitMarkdown(source, { ...CHUNK_LIMITS, blocks: 1 });
    expect(chunks).toEqual(['See [docs][d] first.\n\n[d]: https://example.com', 'Then [more][d] here[^1].\n\n[d]: https://example.com\n\n[^1]: A note.']);
    // A bibliography of definitions would put every piece back over the budget if each carried them all.
    const paragraphs = Array.from({ length: 600 }, (_, i) => `Paragraph ${i} cites [source ${i}][s${i}].`);
    const definitions = Array.from({ length: 500 }, (_, i) => `[s${i}]: https://example.com/${i}`);
    const pieces = splitMarkdown(`${paragraphs.join('\n\n')}\n\n${definitions.join('\n\n')}`);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(splitMarkdown(piece)).toBeNull();
    expect(pieces[0]).toContain('[s0]: https://example.com/0');
    expect(pieces[0]).not.toContain('[s599]');
  });

  it('keeps every piece under the converter\'s real cap of 500,000 characters', () => {
    // 300 paragraphs of 1,720 characters: 516,000 characters in few blocks, which one conversion refuses.
    const html = Array.from({ length: 300 }, (_, i) => `<p>${String(i).padStart(4, '0')}${'x'.repeat(1710)}</p>`).join('');
    const pieces = splitHtml(html);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.length).toBeLessThan(400000);
    expect(pieces.join('')).toBe(html);
  });

  it('splits by links and by size as well', () => {
    const links = Array.from({ length: 8 }, (_, i) => `[l${i}](https://x.com/${i})`).join('\n\n');
    expect(splitMarkdown(links, { ...CHUNK_LIMITS, links: 3 })).toHaveLength(3);
    const long = Array.from({ length: 6 }, (_, i) => `${i} ${'word '.repeat(50)}`).join('\n\n');
    expect(splitMarkdown(long, { ...CHUNK_LIMITS, bytes: 600 })).toHaveLength(3);
  });

  it('splits HTML at the body\'s top-level elements without breaking any of them', () => {
    const items = Array.from({ length: 10 }, (_, i) => `<li>item ${i}</li>`).join('');
    const source = `<h1>Title</h1><ul>${items}</ul><p>After <a href="https://x.com">link</a></p>`;
    const chunks = splitHtml(source, { ...CHUNK_LIMITS, blocks: 11 });
    expect(chunks).toEqual(['<h1>Title</h1>', `<ul>${items}</ul>`, '<p>After <a href="https://x.com">link</a></p>']);
    const paragraphs = Array.from({ length: 1200 }, (_, i) => `<p>${i}</p>`).join('');
    const pieces = splitHtml(paragraphs);
    expect(pieces.length).toBe(3);
    expect(pieces.join('')).toBe(paragraphs);
  });
});

describe('splitting inside an element that is too big on its own', () => {
  const paragraphs = (n) => Array.from({ length: n }, (_, i) => `<p>Paragraph ${i}</p>`).join('');
  const count = (chunks, pattern) => chunks.join('').match(pattern)?.length ?? 0;

  it('opens a wrapper div up to its paragraphs, as a saved web page needs', () => {
    const chunks = splitHtml(`<div class="content"><h1>Title</h1>${paragraphs(1200)}</div>`, { ...CHUNK_LIMITS, blocks: 400 });
    expect(chunks.length).toBeGreaterThan(2);
    expect(count(chunks, /<p>/g)).toBe(1200);
    expect(chunks[0].startsWith('<h1>Title</h1><p>Paragraph 0</p>')).toBe(true);
    for (const chunk of chunks) expect((chunk.match(/<p>/g) || []).length).toBeLessThanOrEqual(400);
  });

  it('keeps the wrapper\'s direction and style on every piece it is opened up into', () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) => `<p>Paragraph ${i}</p>`).join('');
    const chunks = splitHtml(`<div dir="rtl" style="text-align:center"><p>Intro</p><div class="body">${paragraphs}</div></div>`, { ...CHUNK_LIMITS, blocks: 2 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.startsWith('<div dir="rtl" style="text-align:center">')).toBe(true);
      expect(chunk.endsWith('</div>')).toBe(true);
    }
    expect(chunks.join('').match(/<p>/g)).toHaveLength(7);
  });

  it('does not turn the whitespace and comments between a styled wrapper\'s paragraphs into empty paragraphs', () => {
    const paragraphs = Array.from({ length: 450 }, (_, i) => `  <p>Paragraph ${i}</p>\n`).join('  <!-- note -->\n');
    const pieces = splitHtml(`<div dir="rtl">\n${paragraphs}</div>`);
    expect(pieces.length).toBeGreaterThan(1);
    const shells = pieces.join('').match(/<div dir="rtl">/g).length;
    const kept = pieces.join('').match(/<p>/g).length;
    expect(kept).toBe(450);
    // One shell per paragraph and none for the whitespace or comments around them.
    expect(shells).toBe(450);
    expect(pieces.join('')).not.toMatch(/<div dir="rtl">\s*<\/div>/);
    expect(pieces.join('')).not.toMatch(/<div dir="rtl">\s*<!--/);
  });

  it('keeps a line of inline content, its label and its link, in one piece', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `Site ${i}: <a href="https://example.com/${i}">example ${i}</a><br>`).join('\n');
    const pieces = splitHtml(`<body>${lines}</body>`);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece).not.toMatch(/^\s*<a /);
      expect(piece).not.toMatch(/Site \d+: \s*$/);
    }
    expect(pieces.join('').match(/<a /g)).toHaveLength(300);
  });

  it('leaves a span or font that holds only inline content whole, whatever its size', () => {
    const inline = `<span>${'text <a href="https://example.com/">link</a> '.repeat(30)}</span>`;
    expect(splitHtml(`<p>Before</p>${inline}<p>After</p>`, { ...CHUNK_LIMITS, links: 10 })).toEqual(['<p>Before</p>', inline, '<p>After</p>']);
    // One that groups blocks is opened up like a div.
    const blocks = `<span>${Array.from({ length: 6 }, (_, i) => `<p>Block ${i}</p>`).join('')}</span>`;
    expect(splitHtml(blocks, { ...CHUNK_LIMITS, blocks: 2 }).length).toBeGreaterThan(1);
  });

  it('keeps a line with a span or font in it whole when a wrapper is opened up', () => {
    const line = 'Hello <span style="color:red">world</span> again<br>';
    const chunks = splitHtml(`<div>${paragraphs(3)}${line}${paragraphs(3)}</div>`, { ...CHUNK_LIMITS, blocks: 2 });
    expect(chunks.some((chunk) => chunk.includes(line.replace('<br>', '')))).toBe(true);
    expect(chunks.some((chunk) => /^<span style="color:red">world<\/span>/.test(chunk))).toBe(false);
  });

  it('splits one long list between its items, each piece still a list counting on', () => {
    const items = Array.from({ length: 300 }, (_, i) => `<li>Item ${i + 1}</li>`).join('');
    const chunks = splitHtml(`<ol start="5">${items}</ol>`, { ...CHUNK_LIMITS, blocks: 100 });
    expect(chunks.length).toBeGreaterThan(2);
    // As few lists as the limits allow, not one per item: the document gets three or four lists, not three hundred.
    expect(chunks.length).toBeLessThanOrEqual(4);
    expect(count([chunks[0]], /<li>/g)).toBeGreaterThan(50);
    expect(count(chunks, /<li>/g)).toBe(300);
    expect(chunks[0].startsWith('<ol start="5"><li>Item 1</li>')).toBe(true);
    // A later piece begins with the number its first item would have had in the whole list.
    expect(chunks[1]).toMatch(/^<ol start="(\d+)"><li>Item (\d+)<\/li>/);
    const [, start, item] = chunks[1].match(/^<ol start="(\d+)"><li>Item (\d+)<\/li>/);
    expect(Number(start)).toBe(Number(item) + 4);
  });

  it('splits a long quotation between its paragraphs, each still quoted', () => {
    const chunks = splitHtml(`<blockquote>${paragraphs(900)}</blockquote>`, { ...CHUNK_LIMITS, blocks: 400 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(count(chunks, /<p>/g)).toBe(900);
    for (const chunk of chunks) expect(chunk.startsWith('<blockquote>')).toBe(true);
  });

  it('leaves a table whole even when it is large: its rows cannot stand alone', () => {
    const rows = Array.from({ length: 600 }, (_, i) => `<tr><td>${i}</td></tr>`).join('');
    const chunks = splitHtml(`<p>Before</p><table>${rows}</table><p>After</p>`, { ...CHUNK_LIMITS, blocks: 400 });
    expect(chunks.some((chunk) => chunk.startsWith('<table>') && chunk.endsWith('</table>'))).toBe(true);
    expect(count(chunks, /<tr>/g)).toBe(600);
  });
});
