import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';

it('formats long fraction denominators without scanning trillions of candidates', () => {
  // Isolate the reproduction: a synchronous formatter cannot be interrupted
  // by Vitest's timeout if an imported format locks up the main thread.
  const moduleUrl = new URL('../src/core/numfmt.js', import.meta.url).href;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { formatWithCode } from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify([
      formatWithCode(2.75, '# ?/????????????'),
      formatWithCode(1 / 123456789, '?/????????????'),
      formatWithCode(0.5, '?/' + '?'.repeat(400)),
    ]));
  `], { timeout: 3000, encoding: 'utf8' });
  // Each unused ? in the denominator pads with a space.
  expect(JSON.parse(output)).toEqual([`2 3/4${' '.repeat(11)}`, `0/1${' '.repeat(11)}`, `1/2${' '.repeat(399)}`]);
});

// Recalculated and saved in desktop Excel. Nearest-fraction enumeration is
// deliberately not the oracle: the format stops at a continued-fraction convergent.
it.each([
  [0, ['0/1', '0/1', '0/1']],
  [0.01, ['0/1', '0/1', '1/100']],
  [0.06, ['0/1', '3/50', '3/50']],
  [0.1, ['0/1', '1/10', '1/10']],
  [0.11, ['1/9', '10/91', '11/100']],
  [0.125, ['1/8', '1/8', '1/8']],
  [0.15, ['1/7', '3/20', '3/20']],
  [0.3, ['2/7', '3/10', '3/10']],
  [0.333, ['1/3', '1/3', '1/3']],
  [0.41421356237, ['2/5', '29/70', '408/985']],
  [0.7, ['2/3', '7/10', '7/10']],
  [0.75, ['3/4', '3/4', '3/4']],
  [0.94, ['1/1', '47/50', '47/50']],
  [0.999, ['1/1', '1/1', '998/999']],
  [1, ['1/1', '1/1', '1/1']],
  [2.71828, ['19/7', '193/71', '1264/465']],
])('matches native variable-denominator fractions for %s', (value, fractions) => {
  fractions.forEach((fraction, i) => {
    const [n, d] = fraction.split('/');
    for (const sign of [1, -1]) {
      expect(formatWithCode(sign * value, '?/' + '?'.repeat(i + 1)))
        .toBe((sign < 0 && Number(n) ? '-' : '') + n + '/' + d.padEnd(i + 1));
    }
  });
});
