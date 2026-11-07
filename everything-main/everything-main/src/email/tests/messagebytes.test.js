import { describe, it, expect, vi } from 'vitest';
import {
  splitMessage, parseHeaders, extractText, extractHtml, previewText,
  listAttachments, listInlineParts,
} from '../src/lib/mime.js';
import { enrichMessage } from '../src/lib/mailbox.js';
import { createSampleMailbox } from '../src/lib/sample.js';
import { renderApp } from '../src/ui/app.js';

const bytes = (...parts) => new Uint8Array(parts.flatMap((part) =>
  [...(typeof part === 'string' ? new TextEncoder().encode(part) : part)]));
const parse = (raw) => {
  const { head, body } = splitMessage(raw);
  return { headers: parseHeaders(head), body };
};
const latin1 = bytes('From: Zoë <zoe@example.com>\r\nSubject: Byte decoding\r\n'
  + 'Content-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: 8bit\r\n\r\ncaf', [0xe9]);

describe('reading messages without losing bytes', () => {
  it('decodes 8-bit bodies using their charset and UTF-8 headers separately', async () => {
    const { headers, body } = parse(latin1);
    expect(headers.get('from')).toBe('Zoë <zoe@example.com>');
    expect(extractText(body, headers)).toBe('café');
    expect(previewText(body, headers)).toBe('café');
    const patch = await enrichMessage({ read: async () => new Blob([latin1]) }, { path: '/mail' });
    expect(patch.snippet).toBe('café');
    expect(patch.from.name).toBe('Zoë');
  });

  it('decodes each nested part independently, including transfer encodings', () => {
    const raw = bytes('Content-Type: multipart/mixed; boundary=mix\r\n\r\n'
      + '--mix\r\nContent-Type: multipart/alternative; boundary=alt\r\n\r\n'
      + '--alt\r\nContent-Type: text/html; charset=windows-1252\r\n\r\n<p>',
    [0x80], '</p>\r\n--alt\r\nContent-Type: text/plain; charset=utf-8\r\n'
      + 'Content-Transfer-Encoding: quoted-printable\r\n\r\ncaf=C3=A9\r\n--alt--\r\n'
      + '--mix\r\nContent-Type: application/octet-stream\r\n'
      + 'Content-Disposition: attachment; filename=data.bin\r\n'
      + 'Content-Transfer-Encoding: base64\r\n\r\nAP+A\r\n--mix--');
    const { headers, body } = parse(raw);
    expect(extractText(body, headers)).toBe('café');
    expect(extractHtml(body, headers)).toBe('<p>€</p>');
    expect([...listAttachments(body, headers)[0].bytes()]).toEqual([0, 255, 128]);
  });

  it('preserves every binary byte in attachments and inline parts', () => {
    const payload = Uint8Array.from({ length: 256 }, (_, i) => i);
    const { headers, body } = parse(bytes('Content-Type: multipart/mixed; boundary=mix\r\n\r\n'
      + '--mix\r\nContent-Type: application/octet-stream\r\n'
      + 'Content-Disposition: attachment; filename=data.bin\r\n'
      + 'Content-ID: <binary>\r\nContent-Transfer-Encoding: binary\r\n\r\n',
    payload, '\r\n--mix--'));
    expect(listAttachments(body, headers)[0].bytes()).toEqual(payload);
    expect(listInlineParts(body, headers)[0].bytes()).toEqual(payload);
  });

  it('keeps unencoded UTF-8 body text intact', () => {
    const { headers, body } = parse(bytes('Content-Type: text/plain; charset=utf-8\r\n\r\n日本語 📨'));
    expect(extractText(body, headers)).toBe('日本語 📨');
  });

  it('renders the decoded body and downloads the exact original bytes', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const { fs, mailPath, objectsPath } = createSampleMailbox();
    await fs.write(`${objectsPath}/2026-09-08/0199--${btoa('Byte decoding')}`, new Blob([latin1]));
    const made = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { made.push(blob); return 'blob:test'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      renderApp(root, { fs, mailPath, objectsPath, sample: true, account: { username: 'sample' } });
      const row = () => [...root.querySelectorAll('.row')]
        .find((node) => node.querySelector('.row-subject')?.textContent === 'Byte decoding');
      await vi.waitFor(() => expect(row()).toBeTruthy());
      row().click();
      await vi.waitFor(() => expect(root.querySelector('.msg-body')?.textContent).toBe('café'));
      root.querySelector('.msg-more').click();
      [...document.querySelectorAll('.menu-item')]
        .find((node) => node.textContent.trim() === 'Download original (.eml)').click();
      expect(new Uint8Array(await made[0].arrayBuffer())).toEqual(latin1);
    } finally {
      vi.restoreAllMocks();
      root.remove();
      document.querySelectorAll('.menu, .toast').forEach((node) => node.remove());
    }
  });
});
