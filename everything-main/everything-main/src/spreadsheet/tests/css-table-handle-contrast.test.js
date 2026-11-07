import { expect, it } from 'vitest';
import { stylesheet, declared, themeTokens, parseColor, over, contrast } from './helpers/css.js';

// A table's resize corner is the third ink faded to 0.7 on the sheet, which is paper in every theme:
// 2.96:1, where a control that has to be found needs 3:1 (WCAG 1.4.11), as the outline brackets were fixed for.
it('draws the table resize corner at 3:1 on the paper sheet', () => {
  const corner = declared(stylesheet('grid.css'), '.table-handle::after', false);
  expect(corner['border-color']).toContain('var(--ink-3)');
  const opacity = Number(corner.opacity);
  const t = themeTokens('light');
  const paper = parseColor(t.surface);
  expect(contrast(over([...parseColor(t['ink-3']).slice(0, 3), opacity], paper), paper)).toBeGreaterThanOrEqual(3);
});
