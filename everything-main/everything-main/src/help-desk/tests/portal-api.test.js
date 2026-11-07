import { describe, it, expect, beforeEach } from 'vitest';
import { PortalApi, PortalError, savedRequests, saveRequest, keyFor, searchArticles } from '../src/client/portal-api.js';
import { onColor, brandText, brandFocus, statusLabel } from '../src/portal/portal.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

describe('requests remembered on this device', () => {
  let storage;
  beforeEach(() => {
    storage = memoryStorage();
  });

  it('saves, dedupes and finds keys per desk', () => {
    saveRequest('hd-a', 'desk111', { id: 1, key: 'k1', subject: 'One' }, storage);
    saveRequest('hd-a', 'desk111', { id: 2, key: 'k2', subject: 'Two' }, storage);
    saveRequest('hd-a', 'desk111', { id: 1, key: 'k1', subject: 'One again' }, storage);
    const list = savedRequests('hd-a', 'desk111', storage);
    expect(list.map((r) => r.id)).toEqual([1, 2]);
    expect(list[0].subject).toBe('One again');
    expect(keyFor('hd-a', 'desk111', 2, storage)).toBe('k2');
    expect(keyFor('hd-a', 'other111', 2, storage)).toBe(null);
  });

  it('ignores corrupt storage', () => {
    storage.setItem('help-desk:portal:hd-a/desk111:requests', '{nope');
    expect(savedRequests('hd-a', 'desk111', storage)).toEqual([]);
    storage.setItem('help-desk:portal:hd-a/desk111:requests', JSON.stringify([{ id: 'x' }, { id: 3, key: 'k' }]));
    expect(savedRequests('hd-a', 'desk111', storage)).toEqual([{ id: 3, key: 'k' }]);
  });
});

describe('article search', () => {
  const articles = [
    { id: 1, title: 'Reset your password', excerpt: 'Use the forgot password link', labels: [] },
    { id: 2, title: 'Export data to CSV', excerpt: 'Reports can be exported', labels: ['reports'] },
    { id: 3, title: 'Billing and invoices', excerpt: 'Change your billing address', labels: ['billing'] },
  ];

  it('ranks title matches above body matches', () => {
    expect(searchArticles(articles, 'password').map((a) => a.id)).toEqual([1]);
    expect(searchArticles(articles, 'reports export').map((a) => a.id)).toEqual([2]);
    expect(searchArticles(articles, 'billing')[0].id).toBe(3);
  });

  it('matches whole words or their beginnings, not letters inside words', () => {
    const more = [
      ...articles,
      { id: 4, title: 'Customizing your desktop', excerpt: 'Wallpaper and colors', labels: [] },
      { id: 5, title: 'Download the mobile app', excerpt: 'For phones', labels: [] },
      { id: 6, title: 'Cancel your plan', excerpt: 'Stop your subscription', labels: [] },
      { id: 7, title: '更改密码', excerpt: '', labels: [] },
    ];
    expect(searchArticles(more, 'I want to change my email address', 3, { minScore: 3 }).map((a) => a.id)).toEqual([]);
    expect(searchArticles(more, 'how do I cancel').map((a) => a.id)).toEqual([6]);
    expect(searchArticles(more, 'pass').map((a) => a.id)).toEqual([1]);
    expect(searchArticles(more, '密码').map((a) => a.id)).toEqual([7]);
    expect(searchArticles(more, '密').map((a) => a.id)).toEqual([7]);
  });

  it('returns nothing for empty or one-letter queries', () => {
    expect(searchArticles(articles, '')).toEqual([]);
    expect(searchArticles(articles, 'a')).toEqual([]);
  });
});

describe('PortalApi', () => {
  it('calls the desk server and maps errors', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/requests/9?key=bad')) return new Response(JSON.stringify({ error: 'forbidden', message: 'This link is not valid for that request' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const api = new PortalApi('hd-abc', 'desk1234', { fetchImpl });
    api.signedIn = () => false;
    await api.info();
    await api.submit({ email: 'a@b.co' });
    expect(calls[0].url).toBe('https://hd-abc.puter.work/p/desk1234');
    expect(calls[1].init.method).toBe('POST');
    expect(JSON.parse(calls[1].init.body).email).toBe('a@b.co');
    await expect(api.request(9, 'bad')).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('reports network failures as offline', async () => {
    const api = new PortalApi('hd-abc', 'desk1234', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
    api.signedIn = () => false;
    const err = await api.info().catch((e) => e);
    expect(err).toBeInstanceOf(PortalError);
    expect(err.status).toBe(0);
    expect(err.code).toBe('offline');
  });
});

describe('help center helpers', () => {
  it('picks readable text for brand colors', () => {
    expect(onColor('#ffffff')).toBe('#14161a');
    expect(onColor('#ffd400')).toBe('#14161a');
    expect(onColor('#1d3fb8')).toBe('#ffffff');
    expect(onColor('nope')).toBe('#ffffff');
    // Mid-tone brands read better with dark text.
    expect(onColor('#2ea44f')).toBe('#14161a');
    expect(onColor('#f57c00')).toBe('#14161a');
    expect(onColor('#00a0e0')).toBe('#14161a');
  });

  it('keeps brand-tinted text readable on both themes', () => {
    const ratio = (a, b) => {
      const lum = (hex) => {
        const n = parseInt(hex.slice(1), 16);
        const [r, g, bl] = [n >> 16, (n >> 8) & 255, n & 255].map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      };
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const light = { bg: '#ffffff', text: '#1d2126' };
    const dark = { bg: '#15171a', text: '#e8eaed' };
    for (const brand of ['#000080', '#3b0a45', '#1d3fb8', '#ffd400', '#2ea44f', '#ffffff', '#000000']) {
      expect(ratio(brandText(brand, light), light.bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(brandText(brand, dark), dark.bg)).toBeGreaterThanOrEqual(4.5);
    }
    // A brand that is already readable keeps its usual tint.
    expect(brandText('#1d3fb8', light)).toBe('#1d3898');
  });

  it('keeps tinted text on brand fills, and focus rings, readable in both themes', () => {
    const lum = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      const [r, g, bl] = [n >> 16, (n >> 8) & 255, n & 255].map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    // The soft brand fill: 12% brand over the page, as color-mix() in sRGB.
    const soft = (brand, bg) => {
      const c = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return `#${c(brand).map((v, i) => Math.round(v * 0.12 + c(bg)[i] * 0.88).toString(16).padStart(2, '0')).join('')}`;
    };
    const themes = [{ bg: '#ffffff', surface: '#ffffff', text: '#1d2126' }, { bg: '#15171a', surface: '#1b1e22', text: '#e8eaed' }];
    for (const brand of ['#ff5722', '#14b8a6', '#00c853', '#22c55e', '#3554d1', '#1d4ed8', '#ffd500', '#ffeb3b', '#000000', '#0f172a', '#1e3a8a', '#ffffff']) {
      for (const theme of themes) {
        const text = brandText(brand, theme);
        expect(ratio(text, soft(brand, theme.bg))).toBeGreaterThanOrEqual(4.5);
        expect(ratio(text, theme.surface)).toBeGreaterThanOrEqual(4.5);
        const focus = brandFocus(brand, theme);
        expect(ratio(focus, theme.bg)).toBeGreaterThanOrEqual(3);
        expect(ratio(focus, theme.surface)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('labels public statuses', () => {
    expect(statusLabel('pending')).toBe('Awaiting your reply');
    expect(statusLabel('weird')).toBe('Open');
  });
});
