/**
 * The help center's connection to a desk's server. Visitors need no Puter
 * account: reads and requests go out as plain fetch() calls. A visitor who
 * is signed in to Puter sends request calls through puter.workers.exec(),
 * which attaches their session so "My requests" can list everything they
 * filed from any device.
 *
 * Request links carry a secret key. Keys for requests sent from this device
 * are remembered in localStorage, per help desk.
 */
import { sdk, isSignedIn } from './puter.js';

export class PortalError extends Error {
  constructor(status, body) {
    super(body?.message || PortalError.fallback(status));
    this.status = status;
    this.code = body?.error || (status === 0 ? 'offline' : 'error');
  }

  static fallback(status) {
    if (status === 0) return 'We could not reach the help center. Check your connection and try again.';
    if (status === 404) return 'We could not find that page.';
    if (status === 403) return 'This link is not valid.';
    if (status === 429) return 'Too many requests. Please wait a few minutes and try again.';
    return 'Something went wrong. Please try again.';
  }
}

export function serverOrigin(server) {
  return `https://${server}.puter.work`;
}

export class PortalApi {
  constructor(server, desk, { fetchImpl = null } = {}) {
    this.server = server;
    this.desk = desk;
    this.origin = serverOrigin(server);
    this.base = `/p/${encodeURIComponent(desk)}`;
    this.fetchImpl = fetchImpl;
  }

  signedIn() {
    return isSignedIn();
  }

  async call(method, path, { body = null, session = false, raw = false } = {}) {
    const url = `${this.origin}${this.base}${path}`;
    const init = { method, headers: {} };
    if (body !== null) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      if (session && this.signedIn() && sdk()?.workers?.exec) res = await sdk().workers.exec(url, init);
      else res = await (this.fetchImpl || fetch)(url, init);
    } catch {
      throw new PortalError(0, null);
    }
    if (raw && res.ok) return res;
    const type = res.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await res.json().catch(() => null) : null;
    if (!res.ok) throw new PortalError(res.status, data);
    return data;
  }

  info() { return this.call('GET', ''); }
  articles() { return this.call('GET', '/articles'); }
  article(id) { return this.call('GET', `/articles/${id}`); }
  vote(id, up) { return this.call('POST', `/articles/${id}/vote`, { body: { up: !!up } }); }
  submit(fields) { return this.call('POST', '/requests', { body: fields, session: true }); }
  request(id, key) { return this.call('GET', `/requests/${id}${key ? `?key=${encodeURIComponent(key)}` : ''}`, { session: true }); }
  reply(id, key, text) { return this.call('POST', `/requests/${id}/comments`, { body: { key, body: text }, session: true }); }
  solve(id, key) { return this.call('POST', `/requests/${id}/solve`, { body: { key }, session: true }); }
  rate(id, key, score, comment) { return this.call('POST', `/requests/${id}/rate`, { body: { key, score, comment }, session: true }); }
  mine() { return this.call('GET', '/mine', { session: true }); }

  async file(fid, ticket, key) {
    const res = await this.call('GET', `/files/${fid}?ticket=${ticket}${key ? `&key=${encodeURIComponent(key)}` : ''}`, { session: true, raw: true });
    return res.blob();
  }
}

/* ------------------------------------------------ requests on this device */

const MAX_SAVED = 100;

function storeKey(server, desk) {
  return `help-desk:portal:${server}/${desk}:requests`;
}

export function savedRequests(server, desk, storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(storage.getItem(storeKey(server, desk)) || '[]');
    return Array.isArray(list) ? list.filter((r) => r && Number(r.id) > 0 && typeof r.key === 'string') : [];
  } catch {
    return [];
  }
}

export function saveRequest(server, desk, entry, storage = globalThis.localStorage) {
  const list = savedRequests(server, desk, storage).filter((r) => Number(r.id) !== Number(entry.id));
  list.unshift({ id: Number(entry.id), key: entry.key, subject: entry.subject || '', at: entry.at || Date.now() });
  try {
    storage.setItem(storeKey(server, desk), JSON.stringify(list.slice(0, MAX_SAVED)));
  } catch {
    /* storage full or blocked */
  }
  return list;
}

export function keyFor(server, desk, id, storage = globalThis.localStorage) {
  return savedRequests(server, desk, storage).find((r) => Number(r.id) === Number(id))?.key || null;
}

// Words that say nothing about the topic ("how do I change my email").
const STOP_WORDS = new Set('a an and are as at be but by can could do does for from get got have how i if in into is it its me my no not of on or our so than that the their them then there these this to too us was we what when where which who why will with would you your'.split(' '));
// Scripts written without spaces, where a word can be one character.
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

const wordsOf = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Article search over the published summaries, best matches first. A query
 * word matches the start of a word ("pass" finds "password", "to" does not
 * find "customizing"); in unspaced scripts it matches anywhere.
 */
export function searchArticles(articles, q, limit = 50, { minScore = 1 } = {}) {
  let words = wordsOf(q).filter((w) => w.length > 1 || UNSPACED.test(w));
  const topical = words.filter((w) => !STOP_WORDS.has(w));
  if (topical.length) words = topical;
  if (!words.length) return [];
  const phrase = words.join(' ');
  const has = (w, text, list) => (UNSPACED.test(w) ? text.includes(w) : list.some((t) => t.startsWith(w)));
  return articles
    .map((a) => {
      const title = a.title.toLowerCase();
      const hay = `${a.excerpt || ''} ${(a.labels || []).join(' ')}`.toLowerCase();
      const titleWords = wordsOf(title);
      const hayWords = wordsOf(hay);
      let score = 0;
      for (const w of words) {
        if (has(w, title, titleWords)) score += 3;
        else if (has(w, hay, hayWords)) score += 1;
      }
      if (words.length > 1 && titleWords.join(' ').includes(phrase)) score += 4;
      return { a, score };
    })
    .filter((x) => x.score >= minScore)
    .sort((x, y) => y.score - x.score || (y.a.up || 0) - (x.a.up || 0))
    .slice(0, limit)
    .map((x) => x.a);
}
