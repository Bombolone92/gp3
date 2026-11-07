// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createToolbar } from '../src/ui/toolbar.js';
import { Workbook } from '../src/core/workbook.js';
import { stylesheet, declared } from './helpers/css.js';

afterEach(() => document.body.replaceChildren());

const css = stylesheet('editor.css');
const px = (v) => parseFloat(v);

// With a mouse the toolbar wraps instead of scrolling, but a group is one unbreakable item: the
// widest one was 406px of buttons, so under about 420px it stuck out past the window and the whole
// page grew a sideways scrollbar. Groups now stay narrower than a phone-sized window and, should a
// window be narrower still, wrap inside themselves.
describe('the toolbar in a narrow fine-pointer window', () => {
  it('keeps every group inside a 400px window with the toolbar gutters and a separator beside it', () => {
    const wb = new Workbook();
    const toolbar = createToolbar({
      wb, run() {}, activeCell: () => null, style: () => ({}), active: () => ({ r: 0, c: 0 }),
      range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId,
      grid: { editing: false }, subscribe: () => () => {},
    });
    document.body.append(toolbar.el);
    // Button widths as the stylesheet fixes them: the value pickers are sized, the icon buttons take their minimum.
    const widthOf = (button) => {
      if (button.classList.contains('tb-fmt')) return px(declared(css, '.tb-fmt').width);
      if (button.classList.contains('tb-font')) return px(declared(css, '.tb-font').width);
      if (button.classList.contains('tb-size')) return px(declared(css, '.tb-size')['min-width']);
      return px(declared(css, '.tb-btn')['min-width']);
    };
    const gap = px(declared(css, '.tb-group').gap);
    const groups = [...toolbar.el.querySelectorAll('.tb-group')];
    expect(groups.length).toBeGreaterThanOrEqual(7);
    const widths = groups.map((g) => { const b = [...g.querySelectorAll('.tb-btn')]; return b.reduce((w, x) => w + widthOf(x), 0) + gap * (b.length - 1); });
    const gutter = px(declared(css, '.toolbar').padding.split(/\s+/).at(-1)); // "0 8px": each side
    const separator = px(declared(css, '.tb-sep', false).width) + 2 * px(declared(css, '.tb-sep', false).margin.split(/\s+/).at(-1));
    const room = 400 - 2 * gutter - separator;
    for (const [i, w] of widths.entries()) expect(w, `group ${i} (${groups[i].querySelector('.tb-btn')?.getAttribute('aria-label')}…) is ${w}px`).toBeLessThanOrEqual(room);
    // No group holds more than eight buttons: the insert tools and the data tools are separate groups.
    expect(Math.max(...groups.map((g) => g.querySelectorAll('.tb-btn').length))).toBeLessThanOrEqual(8);
    expect(toolbar.el.querySelectorAll('.tb-btn')).toHaveLength(38);
    toolbar.destroy();
  });

  it('lets a group wrap inside itself where the toolbar wraps', () => {
    const rule = declared(css, '.tb-group', 'pointer: fine');
    expect(rule['flex-wrap']).toBe('wrap');
    expect(rule['min-width']).toBe('0');
    expect(rule.flex).toBe('0 1 auto');
    // Touch screens keep the swipe: outside that media block a group is still one rigid item.
    expect(declared(css, '.tb-group', false).flex).toBe('none');
  });
});
