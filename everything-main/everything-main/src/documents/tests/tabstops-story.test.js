import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { zipSync, strToU8 } from 'fflate';
import { readTabStops } from '../src/lib/tabstops.js';

afterEach(() => vi.unstubAllGlobals());

it.each([
  [{ kind: 'story', storyType: 'headerFooterPart', refId: 'rIdHeader' }, 'header', 'parts/header-special.xml'],
  [{ kind: 'story', storyType: 'headerFooterPart', refId: 'rIdFooter' }, 'footer', '/word/footer3.xml'],
  [{ kind: 'story', storyType: 'footnote', noteId: '2' }, 'footnotes', 'notes/custom-footnotes.xml'],
  [{ kind: 'story', storyType: 'endnote', noteId: '2' }, 'endnotes', 'endnotes.xml'],
])('reads tab stops from the selected $storyType part', async (story, partType, path) => {
  const dom = new JSDOM('');
  vi.stubGlobal('DOMParser', dom.window.DOMParser);
  try {
    const p = (position) => `<w:p w14:paraId="A1"><w:pPr><w:tabs><w:tab w:val="right" w:pos="${position}"/></w:tabs></w:pPr></w:p>`;
    const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';
    const isNote = story.noteId != null;
    const contents = isNote ? `<w:${story.storyType} w:id="1">${p(720)}</w:${story.storyType}><w:${story.storyType} w:id="2">${p(1440)}</w:${story.storyType}>` : p(1440);
    const files = {
      'word/document.xml': `<w:document ${ns}><w:body>${p(2880)}</w:body></w:document>`,
      'word/_rels/document.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${story.refId || 'rIdNotes'}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${partType}" Target="${path}"/></Relationships>`,
      [path.startsWith('/') ? path.slice(1) : `word/${path}`]: `<w:root ${ns}>${contents}</w:root>`,
    };
    const blob = new Blob([zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))]);
    expect(await readTabStops(blob, 'A1', { story })).toEqual([{ position: 1440, alignment: 'right', leader: 'none' }]);
    expect(await readTabStops(blob, 'A1')).toEqual([{ position: 2880, alignment: 'right', leader: 'none' }]);
    const missing = isNote ? { ...story, noteId: '404' } : { ...story, refId: 'missing' };
    expect(await readTabStops(blob, 'A1', { story: missing })).toEqual([]);
  } finally { dom.window.close(); }
});
