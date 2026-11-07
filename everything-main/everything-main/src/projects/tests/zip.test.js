import { describe, it, expect } from 'vitest';
import { zipFiles, unzip, crc32 } from '../src/lib/zip.js';

const text = (s) => new Blob([s], { type: 'text/plain' });

describe('crc32', () => {
  it('matches the known value for a standard string', () => {
    expect(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog')))
      .toBe(0x414fa339);
  });

  it('is 0 for empty input', () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('zip round trip', () => {
  it('writes and reads entries back byte for byte', async () => {
    const zip = await zipFiles([
      { name: 'backup.json', blob: text('{"app":"project-management"}') },
      { name: 'attachments/p1/t1/a1-notes.txt', blob: text('hello world') },
    ]);
    expect(zip.type).toBe('application/zip');

    const entries = await unzip(zip);
    expect(entries.map((e) => e.name)).toEqual([
      'backup.json', 'attachments/p1/t1/a1-notes.txt',
    ]);
    expect(await entries[0].blob.text()).toBe('{"app":"project-management"}');
    expect(await entries[1].blob.text()).toBe('hello world');
  });

  it('survives binary payloads and unicode names', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 13, 10, 0]);
    const zip = await zipFiles([{ name: 'files/ünïcode — ok.bin', blob: new Blob([bytes]) }]);
    const [entry] = await unzip(zip);
    expect(entry.name).toBe('files/ünïcode — ok.bin');
    expect(new Uint8Array(await entry.blob.arrayBuffer())).toEqual(bytes);
  });

  it('handles an empty archive and empty files', async () => {
    expect(await unzip(await zipFiles([]))).toEqual([]);
    const [entry] = await unzip(await zipFiles([{ name: 'empty.txt', blob: text('') }]));
    expect(await entry.blob.text()).toBe('');
  });

  it('normalizes leading slashes and refuses to escape the archive', async () => {
    const [entry] = await unzip(await zipFiles([{ name: '/a/b.txt', blob: text('x') }]));
    expect(entry.name).toBe('a/b.txt');
    await expect(zipFiles([{ name: '../escape.txt', blob: text('x') }])).rejects.toThrow(/Unsafe/);
  });

  it('rejects data that is not a ZIP', async () => {
    await expect(unzip(text('definitely not a zip'))).rejects.toThrow(/Not a ZIP/);
  });

  it('reads a deflated entry written by another tool', async () => {
    // Compress with the platform's deflate-raw, then hand-build the archive
    // the way an external zipper would, to prove the reader is not
    // stored-only.
    const source = 'x'.repeat(4096);
    const deflated = new Uint8Array(await new Response(
      new Blob([source]).stream().pipeThrough(new CompressionStream('deflate-raw')),
    ).arrayBuffer());
    const raw = new TextEncoder().encode(source);
    const name = new TextEncoder().encode('big.txt');
    const crc = crc32(raw);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 8, true); // deflate
    local.setUint32(14, crc, true);
    local.setUint32(18, deflated.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(10, 8, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, deflated.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, 0, true);

    const cdSize = 46 + name.length;
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, 1, true);
    eocd.setUint16(10, 1, true);
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, 30 + name.length + deflated.length, true);

    const blob = new Blob([
      new Uint8Array(local.buffer), name, deflated,
      new Uint8Array(cd.buffer), name,
      new Uint8Array(eocd.buffer),
    ]);
    const [entry] = await unzip(blob);
    expect(await entry.blob.text()).toBe(source);
  });
});
