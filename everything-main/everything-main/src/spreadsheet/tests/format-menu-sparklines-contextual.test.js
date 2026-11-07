import { expect, it } from 'vitest';
import { menubarMenus } from '../src/ui/menubar.js';
import { paletteCommands } from '../src/ui/palette.js';

// The sparkline commands led the Format menu on every sheet, where on one without sparklines they could
// only answer that there was none, and they pushed Number and Text down the menu.
const formatMenu = (flags) => menubarMenus(flags).find((m) => m.id === 'format').items;
const labels = (items) => items.filter((item) => !item.separator).map((item) => item.label);

it('leads the Format menu with the sparkline commands only on a sheet that holds sparklines', () => {
  expect(labels(formatMenu({}))[0]).toBe('Number');
  expect(formatMenu({})[0].separator).toBeFalsy();
  expect(labels(formatMenu({ sparklines: true })).slice(0, 4)).toEqual(['Sparkline settings…', 'Sparkline grouping', 'Clear sparklines', 'Number']);
});

it('leaves the sparkline editing commands out of the palette on a sheet without sparklines, but keeps inserting them', () => {
  const without = paletteCommands({}).map((c) => c.label);
  expect(without).toContain('Sparklines…');
  expect(without).not.toContain('Sparkline settings…');
  expect(without).not.toContain('Clear selected sparklines');
  const withSparklines = paletteCommands({ sparklines: true }).map((c) => c.label);
  expect(withSparklines).toContain('Sparkline settings…');
  expect(withSparklines).toContain('Clear entire selected sparkline groups');
});
