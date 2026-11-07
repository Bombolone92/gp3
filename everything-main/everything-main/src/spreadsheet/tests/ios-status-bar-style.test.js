import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';
import { stylesheet, declared, themeTokens } from './helpers/css.js';

// On an iPhone home-screen install, "black-translucent" means two things at once: draw the page under
// the status bar, and paint its clock, signal and battery WHITE. The page under it is .topbar on the
// editor and .home-head on the home screen, both --surface, which is #ffffff in the default light
// theme — white glyphs on white. The app does not paint that strip itself, so the status bar is left
// to the system, which picks a style that reads against its own backdrop.
const doc = new JSDOM(readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8')).window.document;
const meta = (name) => doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content');

it('leaves the iOS status bar to the system rather than forcing white glyphs over a white bar', () => {
  expect(meta('apple-mobile-web-app-status-bar-style')).toBe('default');
  // The reason it mattered: the bars behind the status bar are the light theme's white surface.
  expect(themeTokens('light').surface).toBe('#ffffff');
  expect(declared(stylesheet('editor.css'), '.editor-header').background).toBe('var(--surface)');
  expect(declared(stylesheet('views.css'), '.home-head').background).toBe('var(--surface)');
  // viewport-fit=cover stays: the landscape safe areas on a notched phone still need it.
  expect(meta('viewport')).toContain('viewport-fit=cover');
  expect(meta('apple-mobile-web-app-capable')).toBe('yes');
});
