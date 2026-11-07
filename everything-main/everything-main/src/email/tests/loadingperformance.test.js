import { it, expect, vi } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { pagedFs } from './pagedfs.js';

it.each([false, true])('bounds listing and header reads and reuses reopened bodies (native paging: %s)', async (native) => {
  const root = document.createElement('div');
  document.body.append(root);
  const objectsPath = '/tester/.mail/objects';
  const day = '2026-09-17';
  const files = Array.from({ length: 1000 }, (_, i) => {
    const name = `${String(i).padStart(5, '0')}--${btoa(`Message ${i}`)}`;
    return { name, path: `${objectsPath}/${day}/${name}`, is_dir: false };
  });
  const paged = pagedFs(objectsPath, { [day]: files.map((file) => file.name) });
  const fs = {
    readdir: vi.fn(native ? paged.readdir : async (path) => path === objectsPath
      ? [{ name: day, is_dir: true }] : files),
    read: vi.fn(async (path) => new Blob([
      `From: Sender <sender@example.com>\r\nMessage-ID: <${path}>\r\n`
      + 'Content-Type: text/plain\r\n\r\nThe message body.',
    ])),
  };
  try {
    renderApp(root, { fs, objectsPath, mailPath: '/tester/.mail', sample: true, account: { username: 'tester' } });
    await vi.waitFor(() => expect(root.querySelectorAll('.row')).toHaveLength(60));
    expect(fs.read).toHaveBeenCalledTimes(60);
    expect(fs.read.mock.calls.every(([, options]) => options.byte_count === 8192)).toBe(true);
    expect(fs.readdir).toHaveBeenCalledTimes(2);
    if (native) expect(paged.calls.map((call) => call.count)).toEqual([1, 61]);

    root.querySelector('.row').click();
    await vi.waitFor(() => expect(root.querySelector('.msg-body')?.textContent).toBe('The message body.'));
    root.querySelector('[aria-label="Back to list"]').click();
    root.querySelector('.row').click();
    await vi.waitFor(() => expect(root.querySelector('.msg-body')?.textContent).toBe('The message body.'));
    // Short header ranges reached EOF, so opening reuses the exact full bytes.
    expect(fs.read.mock.calls.filter(([, options]) => !options?.byte_count)).toHaveLength(0);

    root.querySelector('[aria-label="Back to list"]').click();
    root.querySelector('.btn-more').click();
    await vi.waitFor(() => expect(root.querySelectorAll('.row')).toHaveLength(120));
    expect(fs.read.mock.calls.filter(([, options]) => options?.byte_count)).toHaveLength(120);
    expect(fs.readdir).toHaveBeenCalledTimes(native ? 3 : 2);
    if (native) expect(paged.calls.map((call) => call.count)).toEqual([1, 61, 60]);
  } finally {
    root.remove();
    document.querySelectorAll('.toast').forEach((node) => node.remove());
  }
});
