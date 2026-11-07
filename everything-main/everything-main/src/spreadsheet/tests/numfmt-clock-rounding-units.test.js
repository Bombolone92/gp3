import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import native from './fixtures/reference-clock-rounding-units.json';

it('matches independent native clock workspaces and elapsed layouts across magnitudes', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r, [value, code, expected]] of native.clock.entries()) {
    wb.setCells(id, [
      { r, c: 0, cell: { v: value } },
      { r, c: 1, cell: { v: code } },
      { r, c: 2, cell: { f: `TEXT(A${r + 1},B${r + 1})` } },
    ]);
    expect(formatWithCode(value, code), `${value}: ${code}`).toBe(expected.error ? '#####' : expected);
    expect(wb.getValue(id, r, 2), `${value}: TEXT ${code}`).toEqual(expected);
  }
});

it('keeps native numeric and worksheet rounding distinct from clock rounding', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r, [serial, seconds, digits, numberText, timeText, rounded, workspace]] of native.numeric.entries()) {
    const decimals = '0'.repeat(digits), timeCode = `ss.${decimals}`;
    wb.setCells(id, [
      { r, c: 0, cell: { v: seconds } },
      { r, c: 1, cell: { f: `ROUND(A${r + 1},${digits})` } },
    ]);
    expect(formatWithCode(seconds, `0.${decimals}`), `${seconds}: numeric`).toBe(numberText);
    expect(formatWithCode(serial, timeCode), `${serial}: clock`).toBe(timeText);
    expect(formatWithCode(serial, `[DBNum1]General ${timeCode}`), `${serial}: workspace`).toBe(workspace);
    expect(wb.getValue(id, r, 1), `${seconds}: ROUND`).toBe(rounded);
  }
});
