// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { menubarMenus, menuLeaves } from '../src/ui/menubar.js';
import { openMenu, closeMenu } from '../src/ui/menu.js';
import { stylesheet, rulesFor, themeTokens, parseColor, contrast } from './helpers/css.js';

// The sheet is paper in every theme, but the Cell styles samples took the menu's tokens: in dark mode a Note
// sample was near-white ink on its pale yellow fill (1.02:1) and a Heading navy on black (1.66:1), where the
// cell the style makes is dark ink on white paper. The samples now take the paper's tokens, as the sheet does.
afterEach(() => { closeMenu(); document.body.replaceChildren(); });

it('scopes the paper palette to samples of the sheet, as to the sheet itself', () => {
  const tokens = stylesheet('tokens.css');
  const paper = rulesFor(tokens, '.sheet-paper', false);
  expect(paper.length).toBeGreaterThan(0);
  const light = themeTokens('light');
  // The scope declares the light ink and surface, so a preset's own colours are judged against them.
  expect(contrast(parseColor(light.ink), parseColor('#fff2cc'))).toBeGreaterThanOrEqual(4.5);
  expect(contrast(parseColor('#1f3b73'), parseColor(light.surface))).toBeGreaterThanOrEqual(4.5);
});

it('draws the Format menu’s Cell styles samples on the paper scope', () => {
  const items = menuLeaves(menubarMenus({}).find((m) => m.id === 'format').items).filter((it) => it.cmd === 'cellStyle');
  expect(items.every((it) => it.paper)).toBe(true);
  openMenu({ x: 0, y: 0, items: items.map((it) => ({ ...it, onSelect() {} })) });
  const labels = [...document.querySelectorAll('.menu .menu-label')];
  expect(labels).toHaveLength(items.length);
  for (const label of labels) expect(label.classList.contains('sheet-paper'), label.textContent).toBe(true);
});

it('keeps an ordinary menu label out of the paper scope', () => {
  openMenu({ x: 0, y: 0, items: [{ label: 'Bold', onSelect() {} }] });
  expect(document.querySelector('.menu .menu-label').classList.contains('sheet-paper')).toBe(false);
});
