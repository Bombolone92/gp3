import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';

/**
 * An image attachment opens in place; everything else downloads.
 */

const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

let root;
let made;

const mount = (extra = {}) => {
  const { fs, mailPath, objectsPath } = createSampleMailbox();
  renderApp(root, {
    fs, mailPath, objectsPath, sample: true, account: { username: 'sample' }, ...extra,
  });
};

const open = async (subject) => {
  if (!root.querySelector('.row')) await settle(400);
  [...root.querySelectorAll('.row')]
    .find((row) => row.querySelector('.row-subject').textContent === subject)
    .click();
  await settle();
};

const dialog = () => document.querySelector('.modal-root');

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
  made = [];
  URL.createObjectURL = (blob) => { made.push(blob); return `blob:${made.length}`; };
  URL.revokeObjectURL = () => {};
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.toast, .modal-root').forEach((node) => node.remove());
});

describe('previewing an image attachment', () => {
  it('opens the image in a dialog rather than downloading it', async () => {
    mount();
    await open('Print files, final versions');
    const chip = root.querySelector('.attachment');
    expect(chip.title).toBe('Preview swatch.png');
    chip.click();
    await settle(50);

    expect(dialog()).not.toBe(null);
    expect(dialog().querySelector('.modal-title').textContent).toBe('swatch.png');
    const image = dialog().querySelector('.preview-image');
    expect(image.getAttribute('src')).toBe('blob:1');
    expect(image.alt).toBe('swatch.png');
    expect(made[0].type).toBe('image/png');
  });

  it('keeps the download inside the preview', async () => {
    mount();
    await open('Print files, final versions');
    root.querySelector('.attachment').click();
    await settle(50);
    const clicked = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicked.push(this.getAttribute('download')); };
    try {
      dialog().querySelector('.preview-actions .btn-primary').click();
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
    expect(clicked).toEqual(['swatch.png']);
  });

  it('offers Save to Puter in the preview where the shell can', async () => {
    const given = [];
    mount({ saveToPuter: async (blob, name) => { given.push(name); return { name }; } });
    await open('Print files, final versions');
    root.querySelector('.attachment').click();
    await settle(50);
    [...dialog().querySelectorAll('.preview-actions .btn')]
      .find((btn) => btn.textContent.includes('Save to Puter')).click();
    await settle(50);
    expect(given).toEqual(['swatch.png']);
  });

  it('still downloads a file that is not an image', async () => {
    mount();
    await open('Q3 usage report attached');
    const chip = root.querySelector('.attachment');
    expect(chip.title).toBe('Download q3-usage.csv');
    const clicked = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicked.push(this.getAttribute('download')); };
    try {
      chip.click();
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
    expect(clicked).toEqual(['q3-usage.csv']);
    expect(dialog()).toBe(null);
  });

  /**
   * An image the message's HTML shows by `cid:` is layout, not a file, and
   * is not listed beside the message. The reader hands the ids it found to
   * the attachment list rather than letting it walk the message again, so
   * this is also what says the two are looking at the same message.
   */
  it('does not list an inline image the message shows', async () => {
    mount();
    await open('Issue 214: Interfaces that disappear');
    expect(root.querySelector('.msg-attachments')).toBe(null);
    expect(root.querySelector('.msg-format')).not.toBe(null);
  });
});
