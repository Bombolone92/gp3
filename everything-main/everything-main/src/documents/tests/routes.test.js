// @vitest-environment jsdom
import { beforeAll, describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/puter.js', async (original) => ({ ...await original(), hasSDK: () => false }));
let parseHash;
beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  ({ parseHash } = await import('../src/main.js'));
});

describe('route parsing', () => {
  it.each(['#/edit/%', '#/edit/%E0%A4%A', '#/new/%XX', '#/new/%ED%A0%80'])('recovers from malformed escapes in %s', (hash) => {
    expect(parseHash(hash)).toEqual({ route: 'home' });
  });

  it('preserves encoded file paths, Unicode, percent signs, and template identifiers', () => {
    const path = 'Documents/한글 100%.docx';
    expect(parseHash(`#/edit/${encodeURIComponent(path)}`)).toEqual({ route: 'edit', path });
    expect(parseHash('#/new/meeting-notes')).toEqual({ route: 'new', template: 'meeting-notes' });
    expect(parseHash('#/new')).toEqual({ route: 'new', template: null });
    expect(parseHash('#/home')).toEqual({ route: 'home' });
  });

  it('opens the app, at its root or with no hash at all, in a new document', () => {
    expect(parseHash('')).toEqual({ route: 'new', template: null });
    expect(parseHash('#')).toEqual({ route: 'new', template: null });
    expect(parseHash('#/')).toEqual({ route: 'new', template: null });
  });
});
