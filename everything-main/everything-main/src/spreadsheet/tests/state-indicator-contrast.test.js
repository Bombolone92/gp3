import { describe, expect, it } from 'vitest';
import { stylesheet, declared, themeTokens, parseColor, over, contrast } from './helpers/css.js';

const css = stylesheet('components.css');
const themes = ['light', 'dark'].map((name) => [name, themeTokens(name)]);
const color = (tokens, name) => parseColor(tokens[name]);

// A state a control shows only by colour needs 3:1 against what surrounds it (WCAG 1.4.11). Two
// indicators were a surface shift of about 1.1:1: the command palette's highlighted row, which is
// the only sign of what Enter will run while focus stays in the search field, and the chosen
// theme in the account menu's segmented switch.
describe('state indicators that rely on colour alone', () => {
  it('rings the highlighted palette row with the accent at 3:1 or better in both themes', () => {
    const rule = declared(css, '.palette-item[aria-selected="true"]', false); // the theme's own rule: forced colours give the row the system's selection pair instead
    expect(rule.background).toBe('var(--accent-wash)');
    expect(rule['box-shadow']).toBe('inset 0 0 0 2px var(--accent)');
    for (const [name, t] of themes) {
      const surface = color(t, 'surface');
      const wash = over(color(t, 'accent-wash'), surface);
      expect(contrast(color(t, 'accent'), surface), `${name}: ring on the panel`).toBeGreaterThanOrEqual(3);
      expect(contrast(color(t, 'accent'), wash), `${name}: ring on the washed row`).toBeGreaterThanOrEqual(3);
      // The row's text still reads on the wash.
      expect(contrast(color(t, 'ink'), wash), `${name}: label on the wash`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('fills the chosen segment with the accent, at 3:1 against the track and 4.5:1 under its label', () => {
    // The theme's own rule, as above: forced colours give the chosen segment the system's selection pair.
    const rule = declared(css, '.segmented button[aria-checked="true"]', false);
    expect(rule.background).toBe('var(--accent)');
    expect(rule.color).toBe('var(--accent-ink)');
    expect(declared(css, '.segmented').background).toBe('var(--surface-2)');
    for (const [name, t] of themes) {
      expect(contrast(color(t, 'accent'), color(t, 'surface-2')), `${name}: pill on the track`).toBeGreaterThanOrEqual(3);
      expect(contrast(color(t, 'accent-ink'), color(t, 'accent')), `${name}: label on the pill`).toBeGreaterThanOrEqual(4.5);
    }
    // The same treatment the print dialog's segments already use.
    expect(declared(css, '.seg-btn[aria-checked="true"]', false)).toMatchObject({ background: 'var(--accent)', color: 'var(--accent-ink)' });
  });
});
