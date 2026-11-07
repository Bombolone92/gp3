import { expect, it } from 'vitest';
import { stylesheet, declared } from './helpers/css.js';

const px = (v) => parseFloat(v);
const sides = (shorthand) => { const p = shorthand.split(/\s+/).map(px); return { block: p[0], inline: p[1] ?? p[0] }; };

// The sort button and the search field share one centred row on the home page but were 33px and
// 38px tall: an uneven pair. Both now settle on the same minimum height, above either one's
// natural height, so the row lines up.
it('gives the home sort button and search field the same height', () => {
  const views = stylesheet('views.css');
  const components = stylesheet('components.css');
  const lineHeight = px(declared(stylesheet('base.css'), 'body')['line-height']);
  const search = declared(views, '.home-search');
  const sort = { ...declared(components, '.btn'), ...declared(components, '.btn-sm'), ...declared(views, '.home-sort') };
  expect(search['min-height']).toBe(sort['min-height']);
  const target = px(sort['min-height']);
  expect(target).toBeGreaterThanOrEqual(24);
  // The minimum governs: each control's own text and padding come to less.
  const natural = (rule, border) => px(rule['font-size']) * lineHeight + 2 * sides(rule.padding).block + border;
  expect(natural(search, 2)).toBeLessThanOrEqual(target);
  expect(natural(sort, 2)).toBeLessThanOrEqual(target);
});

// Neither control can give ground on a 320px screen: the sort button never wraps "Last modified" and
// the search field asks for the whole row under 480px, on top of an <input>'s own intrinsic minimum.
// Letting the row wrap keeps the pair inside the viewport rather than giving the home screen a
// sideways scrollbar (WCAG 1.4.10). Precautionary: not reproduced, and free when there is room.
it('lets the home tools row wrap rather than overflow a narrow screen', () => {
  const views = stylesheet('views.css');
  expect(declared(views, '.home-list-tools')['flex-wrap']).toBe('wrap');
  expect(declared(views, '.home-sort')['white-space']).toBe('nowrap');
  expect(declared(views, '.home-search', 'max-width: 480px').width).toBe('100%');
  expect(declared(views, '.home-list-tools', 'max-width: 560px').width).toBe('100%');
});
