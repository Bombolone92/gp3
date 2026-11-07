import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { unzipSync, strFromU8 } from 'fflate';
import { DocxPackage, createDocx, WRITING_STYLES } from '../src/engine/docx.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { pageFieldSegments } from '../src/engine/docx-page-fields.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const field = type => ({ ...pageFieldSegments(new DOMParser().parseFromString(`<w:p xmlns:w="${W}"><w:fldSimple w:instr=" ${type} "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>`, 'application/xml').documentElement)[0].field, cachedText: '1' });

it('creates a footer with Page X of Y that DOCX readers reopen', async () => {
  const blank = createDocx([paragraph('Body')], undefined, undefined, undefined, [], {}, WRITING_STYLES);
  const pkg = await DocxPackage.open(new Uint8Array(await blank.export().arrayBuffer()));
  const body = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const path = pkg.addPageStory('footer');
  const story = new TextDocument([paragraph()], body.pageSettings, body.numbering, body.styles, [], body.assets);
  story.setParagraphFormat({ alignment: 'center' });
  story.replace('Page '); story.insertFieldRun(field('PAGE')); story.replace(' of '); story.insertFieldRun(field('NUMPAGES'));
  const bytes = new Uint8Array(await pkg.export(body.paragraphs, body.pageSettings, body.numbering, body.styles, body.tables, body.assets, { [path]: { paragraphs: story.paragraphs, tables: [] } }).arrayBuffer());
  const parts = unzipSync(bytes);
  expect(strFromU8(parts['word/document.xml'])).toMatch(/<w:footerReference w:type="default" r:id="rIdfooter1"\/>/);
  expect(strFromU8(parts['[Content_Types].xml'])).toMatch(/footer1.xml" ContentType="application\/vnd.openxmlformats-officedocument.wordprocessingml.footer\+xml"/);
  const footer = strFromU8(parts[path]);
  expect(footer).toMatch(/<w:jc w:val="center"\/>/);
  expect(footer).toMatch(/w:instr=" PAGE "/); expect(footer).toMatch(/w:instr=" NUMPAGES "/);
  const reopened = await DocxPackage.open(bytes);
  const stories = Object.entries(reopened.pageStories.stories);
  expect(stories).toHaveLength(1);
  expect(stories[0][1].kind).toBe('footer');
  expect(stories[0][1].paragraphs[0].runs.map(r => r.field?.type || r.text)).toEqual(['Page ', 'PAGE', ' of ', 'NUMPAGES']);
});

it('writes a different first-page header and odd/even setting that reopen as such', async () => {
  const blank = createDocx([paragraph('Body')], undefined, undefined, undefined, [], {}, WRITING_STYLES);
  const pkg = await DocxPackage.open(new Uint8Array(await blank.export().arrayBuffer()));
  const body = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const main = pkg.addPageStory('header'), first = pkg.addPageStory('header', { variant: 'first', section: 0 });
  pkg.setTitlePage(0, true); pkg.setEvenAndOdd(true);
  const story = text => { const d = new TextDocument([paragraph()], body.pageSettings, body.numbering, body.styles, [], body.assets); d.replace(text); return { paragraphs: d.paragraphs, tables: [] }; };
  const bytes = new Uint8Array(await pkg.export(body.paragraphs, body.pageSettings, body.numbering, body.styles, body.tables, body.assets, { [main]: story('Running head'), [first]: story('Cover') }).arrayBuffer());
  const parts = unzipSync(bytes);
  const xml = strFromU8(parts['word/document.xml']);
  expect(xml).toMatch(/<w:headerReference w:type="default" r:id="rIdheader1"\/>/);
  expect(xml).toMatch(/<w:headerReference w:type="first" r:id="rIdheader2"\/>/);
  expect(xml).toMatch(/<w:pgMar [^>]*\/><w:titlePg\/><\/w:sectPr>/);
  expect(strFromU8(parts['word/settings.xml'])).toMatch(/<w:defaultTabStop[^>]*\/><w:evenAndOddHeaders\/>|<w:evenAndOddHeaders\/>/);
  const reopened = await DocxPackage.open(bytes);
  const section = reopened.pageStories.sections[0];
  expect(section.firstPageDifferent).toBe(true);
  expect(reopened.pageStories.evenAndOdd).toBe(true);
  expect(reopened.pageStories.stories[section.header.first].paragraphs[0].runs.map(r => r.text).join('')).toBe('Cover');
  expect(reopened.pageStories.stories[section.header.default].paragraphs[0].runs.map(r => r.text).join('')).toBe('Running head');
});
