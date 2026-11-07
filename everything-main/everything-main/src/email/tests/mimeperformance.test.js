import { it, expect } from 'vitest';
import { splitMessage, parseHeaders, extractText, listAttachments } from '../src/lib/mime.js';

it('finds the header without copying attachment bytes and retains exact binary views', () => {
  const header = new TextEncoder().encode('Content-Type: application/octet-stream\r\n\r\n');
  const raw = new Uint8Array(header.length + 8 * 1024 * 1024);
  raw.set(header);
  raw[raw.length - 1] = 255;
  const split = splitMessage(raw);
  expect(split.body.buffer).toBe(raw.buffer);
  expect(split.body.byteOffset).toBe(header.length);
  expect(split.body.at(-1)).toBe(255);
});

it('agrees with the string parser across delimiter, newline and truncation variants', () => {
  for (const newline of ['\n', '\r\n']) for (const closing of ['', `--b--${newline}epilogue`, '--b-- \t']) {
    const wire = `Content-Type: multipart/mixed; boundary=b${newline}${newline}`
      + `preamble${newline}--b \t${newline}Content-Type: text/plain${newline}${newline}hello${newline}`
      + `--b${newline}Content-Type: application/octet-stream${newline}`
      + `Content-Disposition: attachment; filename=test.bin${newline}${newline}`
      + `\x00\x80\xff-not-a-delimiter${newline}--b-not-a-delimiter${newline}${closing}`;
    const parse = raw => {
      const { head, body } = splitMessage(raw);
      const headers = parseHeaders(head);
      return { text: extractText(body, headers), attachments: listAttachments(body, headers) };
    };
    const text = parse(wire);
    const bytes = parse(Uint8Array.from(wire, c => c.charCodeAt(0)));
    expect(bytes.text).toBe(text.text);
    expect(bytes.attachments.map(a => [a.filename, a.size])).toEqual(text.attachments.map(a => [a.filename, a.size]));
    expect([...bytes.attachments[0].bytes()]).toEqual([...wire.slice(wire.indexOf('\x00'), closing ? wire.lastIndexOf(`${newline}${closing}`) : undefined)].map(c => c.charCodeAt(0)));
  }
});
