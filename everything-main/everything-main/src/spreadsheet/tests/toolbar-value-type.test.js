import { expect, it } from 'vitest';
import { stylesheet, declared } from './helpers/css.js';

// The number-format, font and size pickers sit side by side and each shows a value, but they
// were set in three type styles (13px/600, 12.5px/500, 13px/600). One style for all three.
it('sets the format, font and size values in one type style', () => {
  const css = stylesheet('editor.css');
  const styles = ['.tb-fmt', '.tb-font-label', '.tb-size'].map((sel) => {
    const d = declared(css, sel);
    return `${d['font-size']}/${d['font-weight']}`;
  });
  expect(new Set(styles).size).toBe(1);
  expect(styles[0]).toMatch(/^\d+(\.\d+)?px\/\d+$/);
});
