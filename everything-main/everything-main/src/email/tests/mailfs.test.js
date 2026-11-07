import { describe, it, expect, vi } from 'vitest';
import { createMailFS } from '../benchmarks/range-transport.js';

const setup = response => {
  const sdk = { APIOrigin: 'https://api.example.test', authToken: 'test-only-token',
    fs: { read: vi.fn(), readdir: vi.fn(function () { return this === sdk.fs; }) } };
  const fetch = vi.fn(async () => response);
  return { sdk, fetch, fs: createMailFS(sdk, '/user/.mail', { fetch }) };
};

describe('experimental range transport contract', () => {
  it('sends a real Range with the current account token and preserves SDK method binding', async () => {
    const { sdk, fs, fetch } = setup(new Response('1234', { status: 206, headers: { 'Content-Range': 'bytes 2-5/10000000' } }));
    sdk.authToken = 'new-test-token';
    expect(await (await fs.read('/user/.mail/objects/a?b', { byte_count: 4, offset: 2 })).text()).toBe('1234');
    const [url, options] = fetch.mock.calls[0];
    expect(new URL(url).searchParams.get('file')).toBe('/user/.mail/objects/a?b');
    expect(options.headers.Range).toBe('bytes=2-5');
    expect(options.headers.Authorization).toBe('Bearer new-test-token');
    expect(options.redirect).toBe('error');
    expect(await fs.readdir('/user/.mail')).toBe(true);
    await fs.read('/user/.mail/objects/a');
    expect(sdk.fs.read).toHaveBeenCalledTimes(1);
  });

  it('aborts ignored ranges before consuming a large Content-Length response', async () => {
    const response = new Response('too big', { headers: { 'Content-Length': '8388608' } });
    const { fs, fetch } = setup(response);
    await expect(fs.read('/user/.mail/a', { byte_count: 4 })).rejects.toThrow('byte range');
    expect(response.bodyUsed).toBe(false);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('bounds streamed responses without Content-Length and rejects wrong offsets', async () => {
    const { fs } = setup(new Response('123456789'));
    await expect(fs.read('/user/.mail/a', { byte_count: 4 })).rejects.toThrow('byte range');
    const wrong = setup(new Response('1234', { status: 206, headers: { 'Content-Range': 'bytes 0-3/8' } }));
    await expect(wrong.fs.read('/user/.mail/a', { byte_count: 4, offset: 4 })).rejects.toThrow('byte range');
  });

  it('does not fetch outside the account mailbox, follow redirects, or hide failures', async () => {
    const { fs, fetch } = setup(new Response('', { status: 403 }));
    await expect(fs.read('/other/.mail/a', { byte_count: 4 })).rejects.toThrow('Invalid');
    expect(fetch).not.toHaveBeenCalled();
    await expect(fs.read('/user/.mail/a', { byte_count: 4 })).rejects.toThrow('403');
  });
});
