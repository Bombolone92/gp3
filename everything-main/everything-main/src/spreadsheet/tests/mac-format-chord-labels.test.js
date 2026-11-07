// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// macOS takes ⌘+Shift+3, 4, 5 and 6 for screenshots before the page sees them, so on a Mac the
// number-format and border chords go with Control; the menus, the palette and the shortcuts dialog
// advertised ⌘ for them all the same, while ⌘+B and the other chords the page does receive keep ⌘.
vi.mock('../src/ui/dom.js', async (importOriginal) => ({ ...(await importOriginal()), IS_MAC: true, MOD_KEY: '⌘' }));

const { menubarMenus, menuLeaves } = await import('../src/ui/menubar.js');
const { paletteCommands } = await import('../src/ui/palette.js');
const { openShortcuts } = await import('../src/ui/shortcuts.js');
const { closeAllModals } = await import('../src/ui/modal.js');

afterEach(() => { closeAllModals(); document.body.replaceChildren(); });

describe('on a Mac', () => {
  it('labels the number-format and border chords with Control in the menus and keeps Command elsewhere', () => {
    const format = menuLeaves(menubarMenus({}).find((m) => m.id === 'format').items);
    const shortcut = (label) => format.find((it) => it.label === label)?.shortcut;
    for (const [label, key] of [['Automatic', '~'], ['Number', '!'], ['Currency', '$'], ['Percent', '%'], ['Date', '#'], ['Time', '@'], ['Scientific', '^'], ['Outer borders', '&'], ['No borders', '_']]) {
      expect(shortcut(label), label).toBe(`⌃+Shift+${key}`);
    }
    expect(shortcut('Bold')).toBe('⌘+B');
    expect(shortcut('Larger font')).toBe('⌘+Shift+>');
    expect(shortcut('Format Cells…')).toBe('⌘+1'); // the Format Cells chord
  });

  it('labels them the same way in the palette', () => {
    const palette = paletteCommands({});
    const shortcut = (label) => palette.find((c) => c.label === label)?.shortcut;
    expect(shortcut('Number format: Date')).toBe('⌃+Shift+#');
    expect(shortcut('Number format: Automatic')).toBe('⌃+Shift+~');
    expect(shortcut('Outer borders')).toBe('⌃+Shift+&');
    expect(shortcut('No borders')).toBe('⌃+Shift+_');
    expect(shortcut('Bold')).toBe('⌘+B');
  });

  it('and in the shortcuts dialog', () => {
    openShortcuts();
    const rows = [...document.querySelectorAll('.shortcut-row')].map((row) => [row.querySelector('.shortcut-what').textContent, row.querySelector('.shortcut-keys').textContent]);
    const keys = (what) => rows.find(([w]) => w.startsWith(what))?.[1];
    expect(keys('Number / time / date')).toBe('⌃+Shift+1/2/3/4/5/6');
    expect(keys('Automatic format')).toBe('⌃+Shift+~');
    expect(keys('Outline border')).toBe('⌃+Shift+7');
    expect(keys('Remove borders')).toBe('⌃+Shift+_');
    expect(keys('Bold')).toBe('⌘+B');
  });
});
