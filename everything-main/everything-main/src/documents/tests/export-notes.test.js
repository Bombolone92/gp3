// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { appendNotes } from '../src/lib/export-notes.js';

const ref = (type, n) => `<span data-document-placeholder="note">[${type} ${n}]</span>`;
const mark = '<span data-document-placeholder="unsupported">[unsupported content]</span>';
const notes = [
  { type: 'footnote', noteId: '1', displayNumber: '1', content: ' One & two' },
  { type: 'footnote', noteId: '2', displayNumber: '2', content: ' Two para A Two para B' },
  { type: 'endnote', noteId: '1', displayNumber: '1', content: ' End' },
];
function fakeApi({ limit = 200, project = true } = {}) {
  const stories = { 'footnote:1': ['One &amp; two'], 'footnote:2': ['Two para A', 'Two para B'], 'endnote:1': ['End'] };
  return {
    footnotes: { list: vi.fn(async ({ limit: max, offset }) => ({ total: notes.length, items: notes.slice(offset, offset + Math.min(max, limit)) })) },
    projectHtml: vi.fn(async ({ in: story }) => {
      if (!project) throw new Error('no story projection');
      const [first, ...rest] = stories[`${story.storyType}:${story.noteId}`];
      return { status: 'warning', content: `<p>${mark} ${first}</p>${rest.map((p) => `<p>${p}</p>`).join('')}` };
    }),
    projectMarkdown: vi.fn(async ({ in: story }) => {
      const [first, ...rest] = stories[`${story.storyType}:${story.noteId}`];
      return { status: 'warning', content: [`${mark} ${first}`, ...rest].join('\n\n') };
    }),
  };
}

describe('appendNotes', () => {
  it('numbers and links note references in HTML and appends the notes after the text', async () => {
    const api = fakeApi();
    const html = await appendNotes(api, 'html', `<p>first${ref('footnote', 1)} mid ${ref('footnote', 2)}</p><p>second${ref('endnote', 1)}</p>`);
    expect(html).toBe('<p>first<sup class="note-ref" id="footnote-1-ref"><a href="#footnote-1">1</a></sup> mid <sup class="note-ref" id="footnote-2-ref"><a href="#footnote-2">2</a></sup></p>'
      + '<p>second<sup class="note-ref" id="endnote-1-ref"><a href="#endnote-1">1</a></sup></p>'
      + '<section class="footnotes" role="doc-footnotes"><hr>'
      + '<div class="footnote" id="footnote-1" role="doc-footnote"><p><a class="note-number" href="#footnote-1-ref" role="doc-backlink">1</a> One &amp; two</p></div>'
      + '<div class="footnote" id="footnote-2" role="doc-footnote"><p><a class="note-number" href="#footnote-2-ref" role="doc-backlink">2</a> Two para A</p><p>Two para B</p></div></section>'
      + '<section class="footnotes" role="doc-endnotes"><hr><div class="footnote" id="endnote-1" role="doc-endnote"><p><a class="note-number" href="#endnote-1-ref" role="doc-backlink">1</a> End</p></div></section>');
    expect(api.projectHtml).toHaveBeenCalledWith({ in: { kind: 'story', storyType: 'footnote', noteId: '2' } });
  });

  it('writes Markdown footnote references and definitions, indenting a note\'s later paragraphs', async () => {
    const md = await appendNotes(fakeApi(), 'md', `first${ref('footnote', 1)} mid ${ref('footnote', 2)}\n\nsecond${ref('endnote', 1)}\n`);
    expect(md).toBe('first[^1] mid [^2]\n\nsecond[^e1]\n\n[^1]: One &amp; two\n\n[^2]: Two para A\n\n    Two para B\n\n[^e1]: End\n');
  });

  it('drops the reference mark after a heading, hides picture placeholders in a note, and indents a note\'s list', async () => {
    const api = fakeApi();
    api.projectHtml = async () => ({ status: 'warning', content: `<h1>${mark} Heading note <span data-document-placeholder="image">[image]</span></h1><p>more</p>` });
    api.projectMarkdown = async () => ({ status: 'warning', content: `# ${mark} Heading note\n\n<ol data-document-list-labels="explicit"><li><span data-document-list-label>1.</span> one</li><li><span data-document-list-label>2.</span> two</li></ol>` });
    const html = await appendNotes(api, 'html', `<p>x${ref('footnote', 1)}</p>`);
    expect(html).toContain('<h1><a class="note-number" href="#footnote-1-ref" role="doc-backlink">1</a> Heading note </h1><p>more</p>');
    expect(html).not.toContain('data-document-placeholder');
    const md = await appendNotes(api, 'md', `x${ref('footnote', 1)}`);
    expect(md).toBe('x[^1]\n\n[^1]: # Heading note\n\n    1. one\n    2. two\n');
  });

  it('drops a link left empty by its reference, and unwraps a Markdown link around one', async () => {
    const api = fakeApi();
    const html = await appendNotes(api, 'html', `<p>call<a href="https://x.example/">${ref('footnote', 1)}</a> now</p>`);
    expect(html).toContain('<p>call<sup class="note-ref" id="footnote-1-ref"><a href="#footnote-1">1</a></sup> now</p>');
    expect(html).not.toContain('<a href="https://x.example/"></a>');
    const md = await appendNotes(api, 'md', `[call](https://x.example/)[${ref('footnote', 1)}](https://x.example/) now`);
    expect(md).toMatch(/^\[call\]\(https:\/\/x\.example\/\)\[\^1\] now/);
  });

  it('moves a reference that ends a link\'s text out of the link', async () => {
    const html = await appendNotes(fakeApi(), 'html', `<p><a href="tel:+1555">call${ref('footnote', 1)}</a> now</p>`);
    expect(html).toContain('<a href="tel:+1555">call</a><sup class="note-ref" id="footnote-1-ref"><a href="#footnote-1">1</a></sup> now');
  });

  it('reads every page of notes and matches references to notes in order', async () => {
    const api = fakeApi({ limit: 1 });
    const html = await appendNotes(api, 'html', `<p>${ref('footnote', 1)}${ref('footnote', 2)}${ref('endnote', 1)}</p>`);
    expect(api.footnotes.list).toHaveBeenCalledTimes(3);
    expect(html.match(/<div class="footnote"/g)).toHaveLength(3);
  });

  it('falls back to the note\'s plain text when its story cannot be projected', async () => {
    const html = await appendNotes(fakeApi({ project: false }), 'html', `<p>x${ref('footnote', 1)}</p>`);
    expect(html).toContain('<div class="footnote" id="footnote-1" role="doc-footnote"><p><a class="note-number" href="#footnote-1-ref" role="doc-backlink">1</a> One &amp; two</p></div>');
    expect(html).not.toContain('footnote-2');
  });

  it('leaves content alone without note references, without a notes API, or for a reference no note answers to', async () => {
    const plain = '<p>no notes</p>';
    expect(await appendNotes(fakeApi(), 'html', plain)).toBe(plain);
    expect(await appendNotes({ projectHtml: async () => ({}) }, 'html', `<p>${ref('footnote', 1)}</p>`)).toBe(`<p>${ref('footnote', 1)}</p>`);
    const api = fakeApi();
    api.footnotes.list = async () => ({ total: 0, items: [] });
    expect(await appendNotes(api, 'html', `<p>${ref('footnote', 1)}</p>`)).toBe(`<p>${ref('footnote', 1)}</p>`);
  });
});
