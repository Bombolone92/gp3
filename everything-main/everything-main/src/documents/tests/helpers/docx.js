import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { escapeHtml } from '../../src/lib/importers.js';

/** A small valid DOCX for tests against the actual document engine. */
export function docxWithParagraphs(paragraphs) {
  const body = paragraphs.map(({ text, heading = false }) => `<w:p>${heading ? '<w:pPr><w:pStyle w:val="Heading1"/><w:outlineLvl w:val="0"/></w:pPr>' : ''}<w:r><w:t xml:space="preserve">${escapeHtml(text)}</w:t></w:r></w:p>`).join('');
  const files = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, xml]) => [name, strToU8(xml)])));
}

/** A body paragraph and a separate footnote story for scoped-operation tests. */
export function docxWithFootnote({ heading = false, text = 'note words' } = {}) {
  const files = unzipSync(docxWithParagraphs([{ text: 'body words' }]));
  files['[Content_Types].xml'] = strToU8(strFromU8(files['[Content_Types].xml']).replace('</Types>', '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>'));
  files['word/_rels/document.xml.rels'] = strToU8(strFromU8(files['word/_rels/document.xml.rels']).replace('</Relationships>', '<Relationship Id="rIdFootnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>'));
  files['word/document.xml'] = strToU8(strFromU8(files['word/document.xml']).replace('</w:p>', '<w:r><w:footnoteReference w:id="1"/></w:r></w:p>'));
  files['word/footnotes.xml'] = strToU8(`<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:footnote w:id="1"><w:p w14:paraId="00000001">${heading ? '<w:pPr><w:pStyle w:val="Heading1"/><w:outlineLvl w:val="0"/></w:pPr>' : ''}<w:r><w:t>${escapeHtml(text)}</w:t></w:r></w:p></w:footnote></w:footnotes>`);
  return zipSync(files);
}
