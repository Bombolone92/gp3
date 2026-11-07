import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The theme itself is one data attribute, but the browser chrome is told about
 * it separately, through the theme-color meta tags -- and those are the part
 * that used to drift out of step with the page.
 */

const META = [
  '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f8fafd">',
  '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#131314">',
].join('');

const LIGHT = '#f8fafd';
const DARK = '#131314';

const colours = () => [...document.querySelectorAll('meta[name="theme-color"]')]
  .map((meta) => meta.getAttribute('content'));

// The module tells the browser about the stored theme when it loads, so each
// case has to start from a document that has not seen it yet.
const load = async () => {
  vi.resetModules();
  return import('../src/ui/theme.js');
};

beforeEach(() => {
  document.head.innerHTML = META;
  delete document.documentElement.dataset.theme;
  localStorage.clear();
});

describe('theme', () => {
  it('reads the theme off the document', async () => {
    const { currentTheme } = await load();
    expect(currentTheme()).toBe('system');
    document.documentElement.dataset.theme = 'dark';
    expect(currentTheme()).toBe('dark');
    document.documentElement.dataset.theme = 'sideways';
    expect(currentTheme()).toBe('system');
  });

  it('stores an explicit choice and forgets a system one', async () => {
    const { applyTheme } = await load();
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('puter-mail:theme')).toBe('dark');

    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('puter-mail:theme')).toBeNull();
  });

  it('tells the browser about a theme chosen before it loaded', async () => {
    // index.html applies the stored theme before first paint, so by the time
    // this module runs the page is already dark while the meta tags -- which
    // only know the system scheme -- still say light.
    document.documentElement.dataset.theme = 'dark';
    await load();
    expect(colours()).toEqual([DARK, DARK]);
  });

  it('follows a later choice', async () => {
    const { applyTheme } = await load();
    expect(colours()).toEqual([LIGHT, LIGHT]);
    applyTheme('dark');
    expect(colours()).toEqual([DARK, DARK]);
    applyTheme('light');
    expect(colours()).toEqual([LIGHT, LIGHT]);
  });
});
