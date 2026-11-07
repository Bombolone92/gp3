// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import * as P from '../src/lib/puter.js';

afterEach(() => { delete window.puter; });

// This machine, the local network, link-local addresses (where cloud metadata services answer), the
// names that resolve only there, and anything that is not a web address, in the spellings the URL
// parser accepts for them.
const NOT_PUBLIC = [
  'http://localhost/data.csv', 'http://LOCALHOST:8080/', 'http://api.localhost/', 'http://127.0.0.1/', 'http://127.1/', 'http://0x7f000001/',
  'http://2130706433/', 'http://0.0.0.0/', 'http://0/', 'http://10.1.2.3/', 'http://172.16.0.1/', 'http://172.31.255.255/', 'http://192.168.1.1/',
  'http://169.254.169.254/latest/meta-data/', 'http://100.64.0.1/', 'http://224.0.0.1/', 'http://255.255.255.255/',
  'http://[::1]/', 'http://[0:0:0:0:0:0:0:1]/', 'http://[::]/', 'http://[fe80::1]/', 'http://[fd12:3456::1]/', 'http://[fc00::1]/', 'http://[ff02::1]/',
  'http://[::ffff:127.0.0.1]/', 'http://[::ffff:c0a8:101]/', 'http://[::ffff:a9fe:a9fe]/',
  'http://router.local/', 'http://db.internal/', 'http://printer.home.arpa/',
  'ftp://example.com/x', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/csv,a', 'not a url', '', null,
];
const PUBLIC = [
  'https://example.com/data.csv', 'http://example.com./x', 'https://8.8.8.8/', 'https://[2606:4700::1111]/', 'https://172.32.0.1/', 'https://172.15.0.1/',
  'https://192.169.0.1/', 'https://11.0.0.1/', 'https://internal.example.com/', 'https://local.example.com/', 'https://100.128.0.1/',
];

it('tells addresses on the public internet from those of this machine and private networks', () => {
  for (const url of NOT_PUBLIC) expect(P.isPublicHttpUrl(url), String(url)).toBe(false);
  for (const url of PUBLIC) expect(P.isPublicHttpUrl(url), url).toBe(true);
});

// IMPORT* formulas and the URL dialogs passed any address to Puter's fetch, which fetches on the
// app's behalf: a formula could point it at what the browser itself could not reach.
it('refuses to fetch an address that is not on the public internet, before any request is made', async () => {
  const fetch = vi.fn(async () => ({ ok: true, async text() { return 'a,b'; } }));
  window.puter = { net: { fetch } };
  for (const url of NOT_PUBLIC.filter((u) => /^https?:/.test(u || ''))) await expect(P.fetchText(url), url).rejects.toMatchObject({ code: 'not-public' });
  await expect(P.fetchBytes('http://169.254.169.254/latest/meta-data/')).rejects.toMatchObject({ code: 'not-public', message: expect.stringContaining('169.254.169.254') });
  expect(fetch).not.toHaveBeenCalled();
  expect(await P.fetchText('https://example.com/data.csv')).toBe('a,b');
  expect(fetch).toHaveBeenCalledTimes(1);
});
