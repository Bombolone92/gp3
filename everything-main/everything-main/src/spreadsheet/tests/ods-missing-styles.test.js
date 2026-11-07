import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';

it('opens an ODS package that has no styles.xml', async () => {
  const wb = new Workbook();
  wb.setInput(wb.sheets[0].id, 0, 0, 'hello');
  wb.setInput(wb.sheets[0].id, 0, 1, '=2*21');
  const zip = XLSX.CFB.read(new Uint8Array(await (await workbookToOds(wb)).arrayBuffer()), { type: 'array' });
  const i = zip.FileIndex.findIndex((e) => e.name === 'styles.xml');
  expect(i).toBeGreaterThan(0);
  zip.FileIndex.splice(i, 1);
  zip.FullPaths.splice(i, 1);
  const bytes = XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
  const back = await workbookFromFile(bytes, 'bare.ods');
  const id = back.sheets[0].id;
  expect(back.getValue(id, 0, 0)).toBe('hello');
  expect(back.getValue(id, 0, 1)).toBe(42);
});
