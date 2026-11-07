import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function sheetXml(bytes) {
  const zip = XLSX.CFB.read(new Uint8Array(bytes), { type: 'array' });
  return new TextDecoder().decode(XLSX.CFB.find(zip, 'sheet1.xml').content);
}

it('keeps validation messages within the 255 characters Excel accepts, while the app keeps the full text', async () => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  const message = 'Please enter a whole number of units. '.repeat(10).trim();
  const prompt = 'Units ordered, as a whole number. '.repeat(10).trim();
  expect(message.length).toBeGreaterThan(255);
  const promptTitle = 'A longer title for an imported input message';
  wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 4, c2: 0 }, type: 'number', min: 1, message, prompt, promptTitle });
  const bytes = await (await workbookToXlsx(wb)).arrayBuffer();
  const xml = sheetXml(bytes);
  const attr = (name) => xml.match(new RegExp(` ${name}="([^"]*)"`))?.[1];
  expect(attr('error')).toBe(message.slice(0, 255));
  expect(attr('prompt')).toBe(prompt.slice(0, 255));
  expect(attr('promptTitle')).toBe(promptTitle.slice(0, 32));
  const back = await workbookFromFile(bytes, 'saved.xlsx');
  expect(back.sheets[0].validations[0]).toMatchObject({ message, prompt, promptTitle });
});
