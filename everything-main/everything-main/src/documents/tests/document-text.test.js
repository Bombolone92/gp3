// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { readDocumentText } from '../src/lib/document-text.js';

const read = (html) => readDocumentText({ getHtml: async () => html });

it('preserves inline text, intentional empty paragraphs, and trailing line breaks', async () => {
  expect(await read('<p></p><p>  A <b>bold</b> &amp; &lt;literal&gt;\tvalue<br></p><p></p>'))
    .toBe('\n  A bold & <literal>\tvalue\n\n');
});

it('separates nested list items and empty table cells without duplicating boundaries', async () => {
  expect(await read('<ul><li>Parent<ul><li>Child</li></ul></li><li>Next</li></ul><table><thead><tr><th>A</th><th></th></tr></thead><tbody><tr><td></td><td><p>B</p><p></p></td></tr></tbody></table>'))
    .toBe('Parent\nChild\nNext\nA\t\n\tB\n');
});

it('omits non-content and object placeholders while keeping visible text', async () => {
  expect(await read('<p>Note\uFFFC here<!--comment--><img src="data:," /></p><script>hidden</script><style>hidden</style><p>End</p>'))
    .toBe('Note here\nEnd');
});

it('omits engine image placeholders in paragraphs and table cells, retaining literal labels', async () => {
  expect(await read('<p>A literal [image]</p><p><span data-document-placeholder="image">[image]</span></p><table><tr><td><p><span data-document-placeholder="image">[image]</span></p></td><td>Text</td></tr></table>'))
    .toBe('A literal [image]\n\n\tText');
});

it('keeps the engine\'s note for a table inside a cell instead of a blank cell', async () => {
  expect(await read('<table><tr><td><div data-document-placeholder="unsupportedTable">[nested table unavailable]</div></td><td>c</td></tr></table>'))
    .toBe('[nested table unavailable]\tc');
});

it('breaks the line at a page break inside a paragraph instead of joining the words', async () => {
  expect(await read('<p>before<span data-document-placeholder="page-break">[page break]</span>after</p><p>next</p>'))
    .toBe('before\nafter\nnext');
});

it('omits the engine placeholder for links it cannot resolve, keeping the link text', async () => {
  expect(await read('<p>Call <a>us</a><span data-document-placeholder="hyperlink-unresolved">[link unavailable]</span> now</p><p>Go to <a>target</a><span data-document-placeholder="hyperlink-unresolved">[link unavailable]</span></p>'))
    .toBe('Call us now\nGo to target');
});

it('surfaces projection failures instead of silently exporting joined paragraphs', async () => {
  const getText = vi.fn(async () => 'Joinedtext');
  await expect(readDocumentText({ getHtml: async () => null, getText })).rejects.toThrow('No content');
  expect(getText).not.toHaveBeenCalled();
});

it('leaves hidden text out when the engine can project the document with a source map', async () => {
  const { zipSync, strToU8 } = await import('fflate');
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body><w:p w14:paraId="p1"><w:r><w:t>shown</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t xml:space="preserve"> hidden</w:t></w:r></w:p></w:body></w:document>';
  const api = {
    getHtml: async () => '<p>shown hidden</p>',
    projectHtml: async () => ({ format: 'html', status: 'ok', evaluatedRevision: '1', content: '<p>shown hidden</p>', sourceMap: { entries: [{ kind: 'text', blockId: 'p1', output: { start: 3, end: 15 }, source: { segments: [{ blockId: 'p1', range: { start: 0, end: 12 } }] } }] } }),
    export: { toDocx: async () => ({ contentBase64: Buffer.from(zipSync({ 'word/document.xml': strToU8(xml) })).toString('base64') }) },
    info: async () => ({ revision: '1' }),
  };
  expect(await readDocumentText(api)).toBe('shown');
  // Without an export to read the hidden runs from, the HTML is read as it is.
  expect(await readDocumentText({ ...api, export: undefined })).toBe('shown hidden');
  expect(await readDocumentText({ ...api, projectHtml: async () => ({ status: 'failed' }) })).toBe('shown hidden');
});

it('shows note references as numbers and lists the notes after the text only when asked', async () => {
  const ref = (type, n) => `<span data-document-placeholder="note">[${type} ${n}]</span>`;
  const html = `<p>first${ref('footnote', '1')} mid ${ref('footnote', '2')}</p><p>second${ref('endnote', 'i')}</p>`;
  const stories = { 'footnote:1': '<p><span data-document-placeholder="unsupported">[unsupported content]</span> One &amp; two</p>', 'footnote:2': '<p>Two para A</p><p>Two para B</p>' };
  const api = {
    getHtml: async () => html,
    footnotes: { list: vi.fn(async () => ({ total: 3, items: [
      { type: 'footnote', noteId: '1', displayNumber: '1', content: 'One & two' },
      { type: 'footnote', noteId: '2', displayNumber: '2', content: 'Two para A Two para B' },
      { type: 'endnote', noteId: '1', displayNumber: 'i', content: 'The <end>' },
    ] })) },
    projectHtml: vi.fn(async ({ in: story }) => (story ? { status: 'ok', content: stories[`${story.storyType}:${story.noteId}`] ?? '' } : { status: 'failed' })),
  };
  expect(await readDocumentText(api, { notes: true })).toBe('first[1] mid [2]\nsecond[i]\n\nFootnotes\n[1] One & two\n[2] Two para A\n    Two para B\n\nEndnotes\n[i] The <end>');
  // Speech and the plain read leave the references out, as before.
  expect(await readDocumentText(api)).toBe('first mid \nsecond');
  expect(api.footnotes.list).toHaveBeenCalledTimes(1);
  // Without a notes API the numbers still stand in the text.
  expect(await readDocumentText({ getHtml: async () => html }, { notes: true })).toBe('first[1] mid [2]\nsecond[i]');
});
