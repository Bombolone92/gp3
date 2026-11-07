import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A complex number's formatter sweeps floating-point noise out of one part when it is negligible
// beside the other — e^(iπ) is -1, not -1+1.22E-16i — but a tiny number standing on its own scale
// is a value: COMPLEX(0, 1.5E-20) is 1.5E-20i, and the square root of -1E-30 is 1E-15i, not 0.
describe('tiny parts of a complex number', () => {
  const value = (formula) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, formula);
    return wb.getValue(id, 0, 0);
  };

  it('keeps a tiny part that stands on its own scale', () => {
    expect(value('=COMPLEX(0,1.5E-20)')).toBe('1.5E-20i');
    expect(value('=IMSQRT(-1E-30)')).toBe('1E-15i');
    expect(value('=COMPLEX(1E-15,1E-15)')).toBe('1E-15+1E-15i');
    expect(value('=COMPLEX(1E10,0.00001)')).toBe('10000000000+0.00001i');
  });

  it('still sweeps the noise of a calculation out of a part beside a real one', () => {
    expect(value('=IMEXP(COMPLEX(0,PI()))')).toBe('-1');
    expect(value('=IMPOWER("i",2)')).toBe('-1');
  });
});
