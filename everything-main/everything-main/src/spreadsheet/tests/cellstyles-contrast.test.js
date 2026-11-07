import { expect, it } from 'vitest';
import { CELL_STYLES } from '../src/core/cellstyles.js';
import { parseColor, contrast } from './helpers/css.js';

// The Calculation preset wrote #b35a00 on #f2f1ee, 4.25:1, under the 4.5:1 that text needs.
// Every preset that sets both a text colour and a fill now reads at that ratio on its fill.
it('gives every preset with a text colour and a fill at least 4.5:1 between them', () => {
  const checked = [];
  for (const preset of CELL_STYLES) {
    if (!preset.patch.color || !preset.patch.bg) continue;
    checked.push(preset.key);
    expect(contrast(parseColor(preset.patch.color), parseColor(preset.patch.bg)), preset.label).toBeGreaterThanOrEqual(4.5);
  }
  expect(checked).toEqual(expect.arrayContaining(['input', 'calc', 'good', 'bad', 'neutral']));
  // The text colours on a plain white fill read too.
  for (const preset of CELL_STYLES) {
    if (!preset.patch.color || preset.patch.bg) continue;
    expect(contrast(parseColor(preset.patch.color), parseColor('#ffffff')), preset.label).toBeGreaterThanOrEqual(4.5);
  }
});
