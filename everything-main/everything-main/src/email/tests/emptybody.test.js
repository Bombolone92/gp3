import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';

/**
 * A message with no text of its own -- a photo sent from a phone with nothing
 * typed under it, which is most of the mail anyone gets from a phone.
 *
 * The reader says so where the body would be. That note is about the message,
 * not part of it, so it must not travel: an answer that quotes
 * "> (no text content)" is putting this app's own words into the writer's
 * message, and sending them to whoever the answer goes to.
 */

const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

const DAY = '2026-09-14';
const NAME = '019965b0-0000-7000-8000-000000000001--UGhvdG8';

const RAW = new TextEncoder().encode([
  'From: Ana Petrova <ana@meridianlabs.example>',
  'To: sample@puter.email',
  'Subject: Photo',
  'Date: Mon, 14 Sep 2026 09:00:00 +0000',
  'Message-ID: <photo-1@meridianlabs.example>',
  'Content-Type: image/png; name="beach.png"',
  'Content-Disposition: attachment; filename="beach.png"',
  'Content-Transfer-Encoding: base64',
  '',
  'iVBORw0KGgo=',
  '',
].join('\r\n'));

const mailPath = '/sample/.mail';
const objectsPath = `${mailPath}/objects`;
const path = `${objectsPath}/${DAY}/${NAME}`;

const fs = {
  async readdir(dir) {
    if (dir === objectsPath) return [{ name: DAY, path: `${objectsPath}/${DAY}`, is_dir: true }];
    if (dir === `${objectsPath}/${DAY}`) {
      return [{ name: NAME, path, is_dir: false, size: RAW.length, modified: 1789376400 }];
    }
    throw new Error(`No such directory: ${dir}`);
  },
  async read(at, opts = {}) {
    if (at !== path) throw new Error(`No such file: ${at}`);
    return new Blob([opts.byte_count ? RAW.slice(0, opts.byte_count) : RAW]);
  },
};

let root;
let prefills;

const button = (label) => [...root.querySelectorAll('.msg-reply .btn')]
  .find((btn) => btn.textContent.trim() === label);

beforeEach(async () => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
  prefills = [];
  renderApp(root, {
    fs, mailPath, objectsPath, sample: true, account: { username: 'sample' },
    onCompose: (prefill) => prefills.push(prefill),
  });
  await settle(500);
  root.querySelector('.row').click();
  await settle(500);
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.toast, .menu, .modal-root').forEach((node) => node.remove());
});

describe('a message with no text', () => {
  it('says so where the body would be', () => {
    expect(root.querySelector('.msg-body').textContent).toBe('(no text content)');
    expect(root.querySelector('.attachment-name').textContent).toBe('beach.png');
  });

  it('is answered with an empty quote rather than with the note', () => {
    button('Reply').click();
    expect(prefills).toHaveLength(1);
    expect(prefills[0].body).not.toContain('no text content');
    expect(prefills[0].body).toContain('Ana Petrova wrote:');
  });

  it('is forwarded without the note', () => {
    button('Forward').click();
    expect(prefills).toHaveLength(1);
    expect(prefills[0].body).not.toContain('no text content');
    expect(prefills[0].body).toContain('---------- Forwarded message ----------');
    expect(prefills[0].attachments.map((file) => file.filename)).toEqual(['beach.png']);
  });
});
