import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { zipSync, strToU8 } from 'fflate';
import { hiddenRuns, hiddenCuts, hiddenReplacements, omitHidden, withoutHidden } from '../src/lib/export-hidden.js';

const spans = (cuts) => cuts.map(({ start, end }) => ({ start, end }));

beforeAll(() => { globalThis.DOMParser = new JSDOM('').window.DOMParser; });
afterAll(() => { delete globalThis.DOMParser; });

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const t = (s, hidden = false) => `<w:r>${hidden ? '<w:rPr><w:vanish/></w:rPr>' : ''}<w:t xml:space="preserve">${s}</w:t></w:r>`;
const docx = (body) => Buffer.from(zipSync({ 'word/document.xml': strToU8(`<w:document ${W}><w:body>${body}</w:body></w:document>`), 'word/media/big.bin': new Uint8Array(1000) })).toString('base64');
const api = (body) => ({ export: { toDocx: async () => ({ contentBase64: docx(body) }) } });

describe('hiddenRuns', () => {
  it('reads hidden runs with their offsets in the projection\'s coordinates', async () => {
    const body = `<w:p w14:paraId="00000001">${t('ab')}<w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:tab/></w:r>${t('A', true)}<w:r><w:br/></w:r>`
      + `<w:r><w:sym w:font="Wingdings" w:char="F0FC"/></w:r><w:r><w:noBreakHyphen/></w:r><w:r><w:softHyphen/></w:r>${t('C', true)}`
      + `<w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> DATE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${t('Jan')}<w:r><w:fldChar w:fldCharType="end"/></w:r>`
      + `<w:del w:id="1" w:author="a"><w:r><w:delText>gone</w:delText></w:r></w:del><w:ins w:id="2" w:author="a">${t('new', true)}</w:ins><w:hyperlink r:id="rIdL">${t('link')}${t('hid', true)}</w:hyperlink>${t('G😀', true)}`
      + `<w:r><w:rPr><w:vanish w:val="0"/></w:rPr><w:t>shown</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:drawing/></w:r><w:r><w:ptab w:alignment="right" w:relativeTo="margin" w:leader="none"/></w:r>${t('P', true)}</w:p>`
      + `<w:p w14:paraId="00000002">${t('whole', true)}</w:p><w:p>${t('no id', true)}</w:p>`
      + `<w:p w14:paraId="00000003"><w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:footnoteReference w:id="2"/></w:r></w:p>`;
    expect(await hiddenRuns(api(body))).toEqual([
      // "ab" 0-2, note reference 2-3, tab 3-4, A 4-5, break 5-6, symbol and hyphens nothing, C 6-7, field results "7" and "Jan" 7-11,
      // deleted "gone" 11-15 (the projection's coordinates count it), new 15-18, link 18-22, hid 22-25, then two UTF-16 units for the emoji.
      { blockId: '00000001', start: 4, end: 5, text: 'A' },
      { blockId: '00000001', start: 6, end: 7, text: 'C' },
      { blockId: '00000001', start: 15, end: 18, text: 'new' },
      { blockId: '00000001', start: 22, end: 25, text: 'hid' },
      { blockId: '00000001', start: 25, end: 28, text: 'G😀' },
      // "shown" 28-33; the drawing and the absolute tab have no width of their own.
      { blockId: '00000001', start: 33, end: 34, text: 'P' },
      { blockId: '00000002', start: 0, end: 5, text: 'whole' },
      // The second of the paragraph's two note references is hidden; the reference itself is the run.
      { blockId: '00000003', start: 1, end: 2, text: '\uFFFC', noteRef: 1 },
      { blockId: '00000003', start: 1, end: 2, text: '\uFFFC' },
    ]);
  });

  it('is empty without hidden text, without an export, or for unreadable XML', async () => {
    expect(await hiddenRuns(api(`<w:p w14:paraId="00000001">${t('plain')}</w:p>`))).toEqual([]);
    expect(await hiddenRuns({})).toEqual([]);
    expect(await hiddenRuns(api('<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>broken</w:p>'))).toEqual([]);
  });
});

describe('hiddenCuts', () => {
  const entry = (blockId, start, end, output) => ({ kind: 'text', blockId, output, source: { kind: 'text', coordinateSpace: 'tracked', segments: [{ blockId, range: { start, end } }] } });
  const projection = (content, entries, format = 'html') => ({ format, content, sourceMap: { entries } });

  it('cuts a hidden run that holds a tab, whose entity stands alone in the projection', () => {
    // "Q1<tab>answer": the projection writes the tab as its own "&#9;" entry.
    const entries = [entry('p1', 0, 2, { start: 3, end: 5 }), entry('p1', 2, 3, { start: 5, end: 9 }), entry('p1', 3, 9, { start: 9, end: 15 })];
    const html = projection('<p>Q1&#9;answer</p>', entries);
    expect(spans(hiddenCuts(html, [{ blockId: 'p1', start: 2, end: 9, text: '\tanswer' }]))).toEqual([{ start: 5, end: 9 }, { start: 9, end: 15 }]);
  });

  it('cuts a hidden run inside an entry, mapping through entities and Markdown escapes', () => {
    const html = projection('<p>a &amp; SECRET &lt;b</p>', [entry('p1', 0, 13, { start: 3, end: 22 })]);
    expect(spans(hiddenCuts(html, [{ blockId: 'p1', start: 4, end: 10, text: 'SECRET' }]))).toEqual([{ start: 11, end: 17 }]);
    const md = projection('a \\* SECRET \\< b', [entry('p1', 0, 14, { start: 0, end: 16 })], 'markdown');
    expect(spans(hiddenCuts(md, [{ blockId: 'p1', start: 4, end: 10, text: 'SECRET' }]))).toEqual([{ start: 5, end: 11 }]);
  });

  it('takes the emphasis around a hidden run whose text the projection split at an escaped character', () => {
    // "Secret sentence." is one hidden bold run; Markdown escapes its period, and the map has one entry each side of the escape.
    const md = projection('A: **Secret sentence\\.** after', [entry('p1', 0, 3, { start: 0, end: 3 }), entry('p1', 3, 18, { start: 5, end: 20 }), entry('p1', 18, 19, { start: 20, end: 22 }), entry('p1', 19, 25, { start: 24, end: 30 })], 'markdown');
    const cuts = hiddenCuts(md, [{ blockId: 'p1', start: 3, end: 19, text: 'Secret sentence.' }]);
    expect(spans(cuts)).toEqual([{ start: 3, end: 20 }, { start: 20, end: 24 }]);
    expect(omitHidden(md, [{ blockId: 'p1', start: 3, end: 19, text: 'Secret sentence.' }]).content).toBe('A:  after');
    // HTML: the wrapper the cut empties goes with it, however many.
    const html = projection('<p>A: <em><strong>Secret sentence.</strong></em> after</p>', [entry('p1', 0, 3, { start: 3, end: 6 }), entry('p1', 3, 19, { start: 18, end: 34 }), entry('p1', 19, 25, { start: 48, end: 54 })]);
    expect(spans(hiddenCuts(html, [{ blockId: 'p1', start: 3, end: 19, text: 'Secret sentence.' }]))).toEqual([{ start: 6, end: 48 }]);
    expect(omitHidden(html, [{ blockId: 'p1', start: 3, end: 19, text: 'Secret sentence.' }]).content).toBe('<p>A:  after</p>');
  });

  it('leaves text alone when the projected text does not match the hidden run', () => {
    const html = projection('<p>visible text</p>', [entry('p1', 0, 12, { start: 3, end: 15 })]);
    expect(hiddenCuts(html, [{ blockId: 'p1', start: 8, end: 12, text: 'gone' }])).toEqual([]);
    expect(hiddenCuts(html, [{ blockId: 'p2', start: 0, end: 4, text: 'visi' }])).toEqual([]);
    expect(hiddenCuts(html, [])).toEqual([]);
    // An entry spanning several segments is not mapped.
    const merged = { ...entry('p1', 0, 12, { start: 3, end: 15 }) };
    merged.source.segments.push({ blockId: 'p1', range: { start: 20, end: 22 } });
    expect(hiddenCuts(projection('<p>visible text</p>', [merged]), [{ blockId: 'p1', start: 0, end: 4, text: 'visi' }])).toEqual([]);
  });

  it('removes a paragraph whose every word was hidden, along with its tags', () => {
    const html = projection('<p>keep</p><p><strong>all</strong> hidden</p><p>next</p>', [
      entry('p1', 0, 4, { start: 3, end: 7 }), entry('p2', 0, 3, { start: 22, end: 25 }), entry('p2', 3, 10, { start: 34, end: 41 }), entry('p3', 0, 4, { start: 48, end: 52 })]);
    const cuts = hiddenCuts(html, [{ blockId: 'p2', start: 0, end: 3, text: 'all' }, { blockId: 'p2', start: 3, end: 10, text: ' hidden' }]);
    let content = html.content;
    for (const cut of [...cuts].reverse()) content = content.slice(0, cut.start) + content.slice(cut.end);
    expect(content).toBe('<p>keep</p><p>next</p>');
    const md = projection('keep\n\nall hidden\n\nnext', [entry('p1', 0, 4, { start: 0, end: 4 }), entry('p2', 0, 10, { start: 6, end: 16 }), entry('p3', 0, 4, { start: 18, end: 22 })], 'markdown');
    expect(spans(hiddenCuts(md, [{ blockId: 'p2', start: 0, end: 10, text: 'all hidden' }]))).toEqual([{ start: 6, end: 18 }]);
    // A paragraph that still shows a placeholder or a word keeps its tags.
    const partly = projection('<p>x hidden</p>', [entry('p1', 0, 1, { start: 3, end: 4 }), entry('p1', 1, 8, { start: 4, end: 11 })]);
    expect(spans(hiddenCuts(partly, [{ blockId: 'p1', start: 1, end: 8, text: ' hidden' }]))).toEqual([{ start: 4, end: 11 }]);
  });

  it('takes the emphasis markers with a hidden run in Markdown and removes a hidden heading whole', () => {
    const md = projection('keep\n\n**all hidden**\n\nvisible **gone** tail', [
      entry('p1', 0, 4, { start: 0, end: 4 }), entry('p2', 0, 10, { start: 8, end: 18 }), entry('p3', 0, 8, { start: 22, end: 30 }), entry('p3', 8, 12, { start: 32, end: 36 }), entry('p3', 12, 17, { start: 38, end: 43 })], 'markdown');
    const cuts = hiddenCuts(md, [{ blockId: 'p2', start: 0, end: 10, text: 'all hidden' }, { blockId: 'p3', start: 8, end: 12, text: 'gone' }]);
    let out = md.content;
    for (const cut of [...cuts].sort((a, b) => b.start - a.start)) out = out.slice(0, cut.start) + out.slice(cut.end);
    expect(out).toBe('keep\n\nvisible  tail');
    const heading = projection('<h1><em>Secret</em></h1><p>next</p>', [entry('h1', 0, 6, { start: 8, end: 14 }), entry('p2', 0, 4, { start: 27, end: 31 })]);
    expect(spans(hiddenCuts(heading, [{ blockId: 'h1', start: 0, end: 6, text: 'Secret' }]))).toEqual([{ start: 0, end: 24 }]);
    const mdHeading = projection('# Secret\n\nnext', [entry('h1', 0, 6, { start: 2, end: 8 }), entry('p2', 0, 4, { start: 10, end: 14 })], 'markdown');
    expect(spans(hiddenCuts(mdHeading, [{ blockId: 'h1', start: 0, end: 6, text: 'Secret' }]))).toEqual([{ start: 0, end: 10 }]);
    // Two hidden runs the engine merged into one entry still remove the paragraph whole.
    const merged = projection('<p>one two</p><p>next</p>', [entry('p1', 0, 7, { start: 3, end: 10 }), entry('p2', 0, 4, { start: 17, end: 21 })]);
    expect(spans(hiddenCuts(merged, [{ blockId: 'p1', start: 0, end: 4, text: 'one ' }, { blockId: 'p1', start: 4, end: 7, text: 'two' }]))).toEqual([{ start: 0, end: 14 }]);
  });

  it('cuts the placeholder of a hidden note reference so the note is not appended', () => {
    const firstNote = '<span data-document-placeholder="note">[footnote 1]</span>';
    const secondNote = '<span data-document-placeholder="note">[footnote 2]</span>';
    const content = `<p>a${firstNote}b${secondNote}</p>`;
    const firstLabel = content.indexOf('[footnote 1]');
    const secondLabel = content.indexOf('[footnote 2]');
    const between = 4 + firstNote.length;
    const secondStart = between + 1;
    const secondEnd = secondStart + secondNote.length;
    const html = projection(content, [
      entry('p1', 0, 1, { start: 3, end: 4 }),
      { kind: 'synthetic', role: 'placeholder', blockId: 'p1', output: { start: firstLabel, end: firstLabel + '[footnote 1]'.length } },
      entry('p1', 2, 3, { start: between, end: between + 1 }),
      { kind: 'synthetic', role: 'placeholder', blockId: 'p1', output: { start: secondLabel, end: secondLabel + '[footnote 2]'.length } },
    ]);
    const cuts = hiddenCuts(html, [{ blockId: 'p1', start: 3, end: 4, text: '\uFFFC', noteRef: 1 }]);
    expect(spans(cuts)).toEqual([{ start: secondStart, end: secondEnd }]);
    expect(html.content.slice(secondStart, secondEnd)).toBe(secondNote);
    // The projection loses the placeholder and its source-less entry; the entries before it keep their places.
    const out = omitHidden(html, [{ blockId: 'p1', start: 3, end: 4, text: '\uFFFC', noteRef: 1 }]);
    expect(out.content).toBe(`<p>a${firstNote}b</p>`);
    expect(out.sourceMap.entries.map((e) => [e.kind, e.output.start, e.output.end])).toEqual([['text', 3, 4], ['synthetic', firstLabel, firstLabel + '[footnote 1]'.length], ['text', between, between + 1]]);
  });

  it('cuts a hidden line break and fails the export when the document changed meanwhile', async () => {
    const html = projection('<p>a<br>b</p>', [entry('p1', 0, 1, { start: 3, end: 4 }), entry('p1', 1, 2, { start: 4, end: 8 }), entry('p1', 2, 3, { start: 8, end: 9 })]);
    expect(spans(hiddenCuts(html, [{ blockId: 'p1', start: 1, end: 2, text: '\n' }]))).toEqual([{ start: 4, end: 8 }]);
    const changed = { ...api(`<w:p w14:paraId="p1">${t('a', true)}</w:p>`), info: async () => ({ revision: '2' }) };
    await expect(hiddenReplacements(changed, { ...html, evaluatedRevision: '1' })).rejects.toThrow('document changed');
    expect(await hiddenReplacements({ ...changed, info: async () => ({ revision: '1' }) }, { ...html, evaluatedRevision: '1' })).toEqual([{ start: 3, end: 4, html: '' }]);
  });
});

describe('omitHidden', () => {
  const entry = (blockId, start, end, output) => ({ kind: 'text', blockId, output, source: { kind: 'text', coordinateSpace: 'tracked', segments: [{ blockId, range: { start, end } }] } });
  it('cuts the content and keeps the source map in step, splitting an entry cut in the middle', () => {
    const projection = { format: 'html', status: 'ok', content: '<p>ab HID cd</p><p>tail</p>', sourceMap: { entries: [
      entry('p1', 0, 9, { start: 3, end: 12 }),
      { kind: 'synthetic', role: 'placeholder', blockId: 'p1', output: { start: 12, end: 12 } },
      entry('p2', 0, 4, { start: 19, end: 23 }),
    ] } };
    const out = omitHidden(projection, [{ blockId: 'p1', start: 3, end: 6, text: 'HID' }]);
    expect(out.content).toBe('<p>ab  cd</p><p>tail</p>');
    expect(out.sourceMap.entries.map((e) => [e.blockId, e.output.start, e.output.end, e.source?.segments[0].range.start, e.source?.segments[0].range.end])).toEqual([
      ['p1', 3, 6, 0, 3], ['p1', 6, 9, 6, 9], ['p1', 9, 9, undefined, undefined], ['p2', 16, 20, 0, 4],
    ]);
    // Text later mapped through the split entries lands where it should: "cd" starts at source 7.
    expect(out.content.slice(out.sourceMap.entries[1].output.start)).toMatch(/^ cd/);
  });

  it('drops the entries of a paragraph removed whole and leaves an untouched projection alone', () => {
    const projection = { format: 'html', status: 'ok', content: '<p>keep</p><p>gone</p><p>next</p>', sourceMap: { entries: [
      entry('p1', 0, 4, { start: 3, end: 7 }), entry('p2', 0, 4, { start: 14, end: 18 }), entry('p3', 0, 4, { start: 25, end: 29 })] } };
    const out = omitHidden(projection, [{ blockId: 'p2', start: 0, end: 4, text: 'gone' }]);
    expect(out.content).toBe('<p>keep</p><p>next</p>');
    expect(out.sourceMap.entries.map((e) => [e.blockId, e.output.start, e.output.end])).toEqual([['p1', 3, 7], ['p3', 14, 18]]);
    expect(omitHidden(projection, [])).toBe(projection);
    expect(omitHidden(projection, [{ blockId: 'p9', start: 0, end: 1, text: 'x' }])).toBe(projection);
  });

  it('wraps the API so every projection comes back without the hidden runs', async () => {
    const projection = { format: 'html', status: 'ok', content: '<p>ab HID</p>', sourceMap: { entries: [entry('p1', 0, 6, { start: 3, end: 9 })] } };
    const api = { projectHtml: async () => projection, footnotes: { list: async () => ({ items: [], total: 0 }) } };
    const view = withoutHidden(api, [{ blockId: 'p1', start: 3, end: 6, text: 'HID' }]);
    expect((await view.projectHtml({})).content).toBe('<p>ab </p>');
    expect(view.footnotes).toBe(api.footnotes);
    expect(view.hiddenRunsApplied).toBe(true);
    expect(withoutHidden(api, []).hiddenRunsApplied).toBe(true);
    expect(withoutHidden(api, []).projectHtml).toBe(api.projectHtml);
  });
});
