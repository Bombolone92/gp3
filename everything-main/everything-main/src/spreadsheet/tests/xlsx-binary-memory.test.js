import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as X from '../src/vendor/xlsx.mjs';

// A binary string maps each byte to the same code point, including 0x80–0x9f.
// TextDecoder('latin1') would silently turn those bytes into Windows-1252 text.
describe('ZIP binary output', () => {
  it.each([0, 257, 32767, 32768, 32769, 65537])('preserves %i payload bytes across conversion boundaries', size => {
    const bytes = Uint8Array.from({ length: size }, (_, i) => i % 256);
    const zip = X.CFB.utils.cfb_new();
    X.CFB.utils.cfb_add(zip, 'payload.bin', bytes);
    const binary = X.CFB.write(zip, { type: 'binary', fileType: 'zip' });
    const raw = X.CFB.write(zip, { type: 'array', fileType: 'zip' });
    expect(binary.length).toBe(raw.length);
    for (let i = 0; i < raw.length; i++) expect(binary.charCodeAt(i)).toBe(raw[i]);
  });

  it.each([true, false])('writes a large ZIP under a bounded heap (Buffer: %s)', buffer => {
    const script = `
      import assert from 'node:assert/strict';
      ${buffer ? '' : 'globalThis.Buffer = undefined;'}
      const X = await import(${JSON.stringify(new URL('../src/vendor/xlsx.mjs', import.meta.url).href)});
      const bytes = new Uint8Array(16 * 1024 * 1024 + 17);
      for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
      const zip = X.CFB.utils.cfb_new();
      X.CFB.utils.cfb_add(zip, 'payload.bin', bytes);
      const binary = X.CFB.write(zip, { type: 'binary', fileType: 'zip' });
      assert.ok(binary.length > bytes.length);
      // With no extra fields, the first local header is followed by its filename and payload.
      const offset = 30 + 'payload.bin'.length;
      for (let i = 0; i < bytes.length; i++) assert.equal(binary.charCodeAt(offset + i), bytes[i]);
      console.log('byte-exact');
    `;
    const result = spawnSync(process.execPath, ['--max-old-space-size=96', '--input-type=module', '-e', script], {
      encoding: 'utf8', timeout: 30_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('byte-exact');
  });
});
