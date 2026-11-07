import { expect, it } from 'vitest';
import { worksheetMetadataXml } from '../src/core/xlsx-worksheet-metadata.js';
import { parseModelXml } from '../src/core/data-model-metadata.js';
it('retains namespace-qualified direct metadata while excluding cell markup, comments and CDATA lookalikes', () => {
  const xml = '<w:worksheet xmlns:w="urn:sheet" xmlns:r="urn:rel"><!-- <drawing r:id="wrong"/> --><w:sheetData><row><c><![CDATA[</w:sheetData><w:drawing r:id="fake"/>]]></c></row></w:sheetData><w:drawing r:id="real" note="a > b"/><w:extLst><ext><drawing/></ext></w:extLst></w:worksheet>';
  const result = worksheetMetadataXml(xml, ['drawing', 'extLst']);
  expect(result).not.toContain('fake'); expect(result).not.toContain('wrong'); expect(result).not.toContain('sheetData');
  expect(parseModelXml(result).getElementsByTagNameNS('urn:sheet', 'drawing')[0].getAttributeNS('urn:rel', 'id')).toBe('real');
  expect(result).toContain('<ext><drawing/></ext>');
});
it.each(['<worksheet><sheetData></worksheet>', '<worksheet/><worksheet/>', '<!DOCTYPE worksheet><worksheet/>', '<worksheet><sheetData>'])('rejects malformed structure or declarations: %s', xml => {
  expect(() => worksheetMetadataXml(xml, ['drawing'])).toThrow();
});
it('bounds retained metadata separately from discarded cell content', () => {
  expect(worksheetMetadataXml('<worksheet><sheetData>' + 'x'.repeat(1000) + '</sheetData></worksheet>', [], { maxLength: 30 })).toBe('<worksheet></worksheet>');
  expect(() => worksheetMetadataXml('<worksheet><drawing name="' + 'x'.repeat(1000) + '"/></worksheet>', ['drawing'], { maxLength: 30 })).toThrow(/size limit/);
});
it('accepts Unicode namespace prefixes and rejects text or CDATA outside the root', () => {
  const xml = '<α:worksheet xmlns:α="urn:sheet"><α:sheetData><行/></α:sheetData><α:drawing/></α:worksheet>';
  expect(worksheetMetadataXml(xml, ['drawing'])).toBe('<α:worksheet xmlns:α="urn:sheet"><α:drawing/></α:worksheet>');
  for (const invalid of ['text<worksheet/>', '<worksheet/>text', '<![CDATA[text]]><worksheet/>']) expect(() => worksheetMetadataXml(invalid, [])).toThrow();
});
