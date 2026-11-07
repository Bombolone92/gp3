import { describe, expect, it } from 'vitest';
import { stylesheet, declared, rulesFor, themeTokens, parseColor, over, contrast } from './helpers/css.js';

const components = stylesheet('components.css');
const tokens = stylesheet('tokens.css');

// A text field has the same fill as the panel it sits on, so its border is the only thing that
// says "type here"; WCAG 1.4.11 asks 3:1 of such a boundary. The hairline it borrowed was 1.5:1
// in light and 1.9:1 in dark. Fields now have their own token, translucent so it reads on the
// dialog surface, the menus' surface and the home page alike.
describe('text field boundary', () => {
  it('draws the field border with its own token and keeps the hairline for decoration', () => {
    const field = declared(components, '.input');
    expect(field.border).toBe('1px solid var(--field-border)');
    expect(declared(components, '.select').border).toBe('1px solid var(--field-border)');
    expect(field['background-color']).toBe('var(--surface)');
    // Focus and error states still take over the border colour.
    expect(declared(components, '.input:focus')['border-color']).toBe('var(--accent)');
    expect(declared(components, '.input[aria-invalid="true"]')['border-color']).toBe('var(--critical)');
    expect(declared(components, '.btn-outline')['border-color']).toBe('var(--hairline-strong)');
  });

  it.each(['light', 'dark'])('reaches 3:1 on every surface a field sits on in the %s theme', (theme) => {
    const t = themeTokens(theme);
    expect(t['field-border']).toBeTruthy();
    const border = parseColor(t['field-border']);
    for (const name of ['surface', 'surface-2', 'page']) {
      const bg = parseColor(t[name]);
      expect(contrast(over(border, bg), bg), `${theme}: on ${name}`).toBeGreaterThanOrEqual(3);
    }
    // Stronger than the decorative hairline, but still a translucent mid-grey rather than ink.
    const surface = parseColor(t.surface);
    expect(contrast(over(border, surface), surface)).toBeLessThan(6);
    expect(contrast(over(parseColor(t['hairline-strong']), surface), surface)).toBeLessThan(3);
  });

  it('is defined for the OS-dark and printed palettes too', () => {
    const media = rulesFor(tokens, ':root:where(:not([data-theme="light"]))', 'prefers-color-scheme: dark');
    expect(media).toHaveLength(1);
    expect(media[0].body).toContain('--field-border: rgba(255, 255, 255, 0.4)');
    expect(media[0].body).toContain(themeTokens('dark')['field-border']);
    const print = rulesFor(tokens, ':root', 'print');
    expect(print).toHaveLength(1);
    expect(print[0].body).toContain(`--field-border: ${themeTokens('light')['field-border']}`);
  });
});
