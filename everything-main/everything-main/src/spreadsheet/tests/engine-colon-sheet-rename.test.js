import { describe, expect, it } from 'vitest';
import { renameSheetInFormula } from '../src/core/refs.js';

// A sheet from an .ods file may be called A:B until the import renames it (an .xlsx sheet name
// cannot hold a colon). Quoted, the name reads as a span of the sheets A and B, so the rename never found it
// and every reference to the sheet became #REF!.
describe('renaming a sheet whose name holds a colon', () => {
  it('renames the quoted name as one sheet, not as a span of two', () => {
    expect(renameSheetInFormula("'A:B'!A2*2", 'A:B', 'A B')).toBe("'A B'!A2*2");
    expect(renameSheetInFormula("'A/B:C*'!A1", 'A/B:C*', 'Renamed')).toBe('Renamed!A1');
    expect(renameSheetInFormula("SUM('A:B'!$A$1:$B$3)+'a:b'!C1", 'A:B', 'Data')).toBe('SUM(Data!$A$1:$B$3)+Data!C1');
  });

  it('leaves a genuine span a span, renaming only the endpoint it names', () => {
    expect(renameSheetInFormula("'Sheet1:Sheet3'!A1", 'Other', 'X')).toBe('Sheet1:Sheet3!A1');
    expect(renameSheetInFormula("'Sheet1:Sheet3'!A1", 'Sheet1', 'Jan')).toBe('Jan:Sheet3!A1');
    expect(renameSheetInFormula("'Sheet1:Sheet3'!A1", 'Sheet3', 'Q3 Data')).toBe("'Sheet1:Q3 Data'!A1");
    expect(renameSheetInFormula('Sheet1:Sheet3!A1', 'Sheet3', 'Mar')).toBe('Sheet1:Mar!A1');
  });
});
