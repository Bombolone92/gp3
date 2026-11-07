import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

function run(code, value) {
  // Isolate the original runaway string loops from the test runner.
  return spawnSync(process.execPath, ['--max-old-space-size=128', '--input-type=module', '-e', `
    import { Workbook } from './src/core/workbook.js';
    import { workbookFromFile, workbookToOds } from './src/core/io.js';
    const wb = new Workbook();
    wb.setCells(wb.activeSheetId, [{r: 0, c: 0, cell: {v: ${value}, s: {fmt: 'custom', code: ${JSON.stringify(code)}}}}]);
    try {
      const back = await workbookFromFile(await workbookToOds(wb), 'quoted.ods');
      console.log(JSON.stringify({ display: back.getDisplay(back.activeSheetId, 0, 0), value: back.getValue(back.activeSheetId, 0, 0) }));
    } catch (error) { console.log(JSON.stringify({ error: error.message })); }
  `], { cwd: new URL('../', import.meta.url), timeout: 2000, encoding: 'utf8' });
}

it.each([
  ['"a;b "0.00', 7.5, 'a;b 7.50'],
  ['0.00"; units"', 7.5, '7.50; units'],
  ['yyyy";"mm";"dd', 45306, '2024;01;15'],
  ['yyyy\\;mm\\;dd', 45306, '2024;01;15'],
  ['hh";"mm";"ss', 0.5, '12;00;00'],
  ['"a;b "0.00;[Red]-0.00', 7.5, 'a;b 7.50'],
  ['0.00;[Red]-0.00', 7.5, '7.50'],
  ['0.00" units"', 7.5, '7.50 units'],
])('saves quoted semicolons without truncating the format: %s', (code, value, expected) => {
  const result = run(code, value);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ display: expected, value });
  if (!code.includes('[Red]')) expect(result.stderr).not.toContain('Unsupported ODS Style Map');
});

// An unterminated literal once made the writer run past the end of the code; it must
// neither hang nor fail the export, since one cell's format must not make the book unsaveable.
it.each(['"unfinished', '0.00"unfinished', 'yyyy"unfinished', 'hh"unfinished', '$"unfinished', 'hh["unfinished]'])(
  'saves an unterminated quoted literal promptly: %s', (code) => {
    const result = run(code, 60);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ value: 60 });
  },
);
