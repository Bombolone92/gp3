// @vitest-environment jsdom
/**
 * Second adversarial review: opening a child's documents. A file's object URL
 * belongs to the app's origin, so a document shown in a tab as HTML or SVG
 * would run its scripts with the director's session.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/files.js', async (orig) => ({ ...(await orig()), fileUrl: async () => 'blob:stored' }));

const made = [];
let opened;
let clicked;
beforeEach(() => {
  made.length = 0;
  opened = [];
  clicked = [];
  URL.createObjectURL = (b) => (made.push(b), `blob:new-${made.length}`);
  URL.revokeObjectURL = () => {};
  globalThis.fetch = async () => new Response(new Blob(['<script>steal()</script>'], { type: 'text/html' }));
  window.open = (url) => opened.push(url);
  HTMLAnchorElement.prototype.click = function () {
    clicked.push({ href: this.href, download: this.getAttribute('download') });
  };
});

describe('child documents', () => {
  it('an HTML or SVG document is downloaded, never opened in a tab', async () => {
    const { openAttachment } = await import('../src/views/common.js');
    for (const type of ['text/html', 'image/svg+xml', 'application/xhtml+xml', '']) {
      await openAttachment({ name: 'form.html', type, path: 'students/s1/x-form.html' });
    }
    expect(opened).toEqual([]);
    expect(clicked.map((c) => c.download)).toEqual(['form.html', 'form.html', 'form.html', 'form.html']);
    expect(made.every((b) => b.type === 'application/octet-stream')).toBe(true);
  });

  it('a PDF or photo still opens in a tab, typed as what it claims to be', async () => {
    const { openAttachment } = await import('../src/views/common.js');
    await openAttachment({ name: 'enrollment.pdf', type: 'application/pdf', path: 'students/s1/x-enrollment.pdf' });
    await openAttachment({ name: 'rash.jpg', type: 'IMAGE/JPEG', path: 'students/s1/x-rash.jpg' });
    expect(opened).toEqual(['blob:new-1', 'blob:new-2']);
    expect(made.map((b) => b.type)).toEqual(['application/pdf', 'image/jpeg']);
    expect(clicked).toEqual([]);
  });
});

describe('photo lightbox', () => {
  it('Download saves the photo instead of linking to a renderable object URL', async () => {
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute('open', '');
      };
      HTMLDialogElement.prototype.close = function () {
        this.removeAttribute('open');
      };
    }
    const { openLightbox } = await import('../src/views/common.js');
    openLightbox([{ name: 'park.svg', type: 'image/svg+xml', path: 'media/2026-10/x-park.svg' }]);
    await new Promise((r) => setTimeout(r, 10));
    const dlg = document.querySelector('dialog[open]');
    expect(dlg.querySelector('a[href^="blob:"]')).toBeNull();
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Download').click();
    await new Promise((r) => setTimeout(r, 10));
    expect(clicked.map((c) => c.download)).toEqual(['park.svg']);
    expect(made.at(-1).type).toBe('application/octet-stream');
  });
});
