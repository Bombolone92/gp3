// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createToolbar } from '../src/ui/toolbar.js';
import { Workbook } from '../src/core/workbook.js';

afterEach(() => document.body.replaceChildren());

function toolbarShowing(style) {
  const wb = new Workbook();
  const toolbar = createToolbar({
    wb, run() {}, activeCell: () => ({}), style: () => style, active: () => ({ r: 0, c: 0 }),
    range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId,
    grid: { editing: false }, subscribe: () => () => {},
  });
  document.body.append(toolbar.el);
  toolbar.refresh();
  const bars = toolbar.el.querySelectorAll('.color-bar');
  return { toolbar, text: bars[0], fill: bars[1] };
}

// The text and fill swatches showed the active cell's colours through `style.background`, which
// takes a url(): a colour string smuggled in through a pasted style could fetch an address the
// moment the cell was selected. Only a hex colour reaches the swatch now, and only as a colour.
describe('the toolbar colour swatches', () => {
  it('shows the resolved fill of a theme reference', () => {
    const { fill } = toolbarShowing({ bg: { theme: 4, base: '#286844', rgb: '#286844' } });
    expect(fill.style.backgroundColor).toBe('rgb(40, 104, 68)');
    expect(fill.classList.contains('no-fill')).toBe(false);
  });
  it('shows the resolved ink of a theme reference', () => {
    const { text } = toolbarShowing({ color: { theme: 4, base: '#286844', rgb: '#286844' } });
    expect(text.style.backgroundColor).toBe('rgb(40, 104, 68)');
  });

  it('show a hex colour as a background colour', () => {
    const { text, fill } = toolbarShowing({ color: '#c22a2a', bg: '#FDE8E8' });
    expect(text.style.backgroundColor).toBe('rgb(194, 42, 42)');
    expect(fill.style.backgroundColor).toBe('rgb(253, 232, 232)');
    expect(fill.classList.contains('no-fill')).toBe(false);
  });

  it('fall back to the defaults when the style carries something that is not a colour', () => {
    const { text, fill } = toolbarShowing({ color: 'url(https://x.example/y)', bg: 'url("https://x.example/z") no-repeat' });
    for (const bar of [text, fill]) {
      expect(bar.getAttribute('style') || '').not.toContain('url(');
      expect(bar.style.backgroundImage).toBe('');
    }
    expect(text.style.backgroundColor).toBe('var(--ink)');
    expect(fill.style.backgroundColor).toBe('transparent');
    expect(fill.classList.contains('no-fill')).toBe(true);
  });

  it('show the defaults for a plain cell', () => {
    const { text, fill } = toolbarShowing({});
    expect(text.style.backgroundColor).toBe('var(--ink)');
    expect(fill.style.backgroundColor).toBe('transparent');
    expect(fill.classList.contains('no-fill')).toBe(true);
  });
});
