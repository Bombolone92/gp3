/**
 * Link previews. The browser cannot read another origin's <meta> tags, so the
 * workspace's worker fetches the page: the first time this code reaches out
 * to the open internet, on the owner's dime, so it is careful about three
 * things.
 *
 * Reach: http and https only; loopback, private, link-local, multicast and
 * `.local`/`.internal` hosts are refused, redirects are followed by hand
 * (at most three) with the same check at every hop, and nothing from the
 * caller (headers, cookies) is forwarded. DNS rebinding cannot be checked
 * without a resolver, which the runtime does not offer; that limit is
 * documented.
 *
 * Budget: a five second timeout, the body read only until </head> or 200 KB,
 * an image copied only when it is an image and under 300 KB.
 *
 * Privacy: a hotlinked thumbnail would leak every reader's address to the
 * target, so the worker keeps a copy in the owner's drive and serves it to
 * members itself; readers never touch the target.
 */
import { KEYS } from '../src/shared/blocks.js';
import { LIMITS, cleanText } from '../src/shared/limits.js';
import { kv, fs, sha256 } from './lib.js';

const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
/**
 * What one preview may take in all, every fetch of it counted: the page
 * behind up to three redirects, then its picture behind up to three more,
 * each hop given five seconds, ran to forty seconds for a site slow at every
 * step, long past the twenty the sender's app waits for the card and past
 * what the platform lets one request run, which ended the request with
 * nothing written down, so the same link was fetched all over again the
 * next time it was posted. Each hop now gets what is left of this, and a
 * preview that runs out is a failed one, remembered for an hour like a dead
 * link (see unfurl).
 */
const TOTAL_MS = 12_000;
const CACHE_TTL_S = 7 * 86400;
const NEGATIVE_TTL_S = 3600;

/** Is this URL one the worker may fetch at all? Returns a URL object or null. */
export function allowedUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return null;
  if (isPrivateIp(host)) return null;
  return u;
}

/** Loopback, private, link-local, multicast, unspecified: v4 (including mapped) and v6. */
export function isPrivateIp(host) {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b, c] = [Number(v4[1]), Number(v4[2]), Number(v4[3])];
    if (v4.slice(1).some((n) => Number(n) > 255)) return true;
    // Also IETF protocol assignments (192.0.0.0/24) and the benchmarking
    // range (198.18.0.0/15), neither of which a public site lives in.
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19)) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const h = host.replace(/^\[|\]$/g, '');
  if (h.includes(':')) {
    const low = h.toLowerCase();
    if (low === '::' || low === '::1') return true;
    if (/^f[cd]/.test(low)) return true; // fc00::/7 unique local
    if (/^fe[89ab]/.test(low)) return true; // fe80::/10 link-local
    if (/^ff/.test(low)) return true; // multicast
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(low);
    if (mapped) return isPrivateIp(mapped[1]);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(low)) return true; // mapped in hex: treat as suspect
    if (/^::/.test(low)) return true; // IPv4-compatible (::7f00:1 is loopback), deprecated and never public
    if (/^64:ff9b:/.test(low)) return true; // NAT64: an IPv4 address (the metadata service's, say) behind a v6 prefix
    if (/^2001:db8:/.test(low)) return true; // documentation range
    if (/^2002:/.test(low)) return true; // 6to4: carries an IPv4 address the checks above cannot see
    return false;
  }
  return false;
}

/**
 * Fetch with the guards above; returns `[response, url]` — the final
 * Response and the address that answered, which after a redirect is not
 * the one asked for and is what a relative og:image or the site's name
 * must come from — or null. `deadline` is the moment the preview as a whole
 * must be done by (see TOTAL_MS): a hop gets the shorter of its own time and
 * what is left, and none starts once it has passed.
 */
async function guardedFetch(raw, accept, deadline = Date.now() + TOTAL_MS) {
  let url = allowedUrl(raw);
  for (let hop = 0; url && hop <= MAX_REDIRECTS; hop++) {
    const left = deadline - Date.now();
    if (left <= 0) return null;
    let res;
    try {
      res = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, left)),
        headers: { Accept: accept, 'User-Agent': 'Teamchat link preview (+https://github.com/HeyPuter/teamchat)' },
      });
    } catch {
      return null;
    }
    // The address that answered is held to the same rule as the one asked
    // for: a runtime that follows redirects on its own, whatever `manual`
    // says, hands back the last page of the chain under its own address
    // (Response.url is the final one), and a public link redirecting to a
    // private address (10.0.0.5/admin behind a short link) would otherwise
    // have that page's title and description read into a card for every
    // member to see. One with no address of its own is what was asked for.
    if (res.url && !allowedUrl(res.url)) {
      res.body?.cancel?.().catch?.(() => {});
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return null;
      try {
        url = allowedUrl(new URL(loc, url).toString());
      } catch {
        return null; // an unparsable Location ends the chase
      }
      continue;
    }
    return res.ok ? [res, res.url || url.toString()] : null;
  }
  return null;
}

/** A TextDecoder for an encoding label, or null when the platform does not know it. */
function decoderFor(label) {
  try {
    return new TextDecoder(label || 'utf-8');
  } catch {
    return null;
  }
}

/** The charset a Content-Type header or a meta tag's content declares, or ''. */
const charsetOf = (s) => (/charset\s*=\s*["']?\s*([a-z0-9_:.-]+)/i.exec(String(s || '')) || [])[1] || '';

/** Where a document's head closes, in either case (see readHead and parseHead). */
const HEAD_END = /<\/head\s*>/i;

/**
 * Read at most `max` bytes of a body (a Response or a Request) as text,
 * stopping early at `stopAt` when given (a string, a pattern, or a function
 * of the text read so far that says when to stop), decoded as `charset`
 * (utf-8 when unknown or not given). The bytes read are returned too, for a
 * caller that learns the encoding from the text itself.
 */
export async function readCapped(res, max, stopAt = null, charset = '') {
  const dec = decoderFor(charset) || new TextDecoder();
  const reader = res.body?.getReader?.();
  if (!reader) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    const t = dec.decode(bytes);
    return { text: t.slice(0, max), truncated: t.length > max, bytes };
  }
  const chunks = [];
  let out = '';
  let total = 0;
  const bytesRead = () => {
    const all = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      all.set(c, o);
      o += c.byteLength;
    }
    return all;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(value);
    out += dec.decode(value, { stream: true });
    // Over the cap only past it: a body of exactly `max` bytes is within
    // what the limit says (a webhook's payload "up to 16 KB" was refused
    // at 16,384 bytes, having passed the check on its declared length).
    if (total > max) {
      reader.cancel().catch(() => {});
      return { text: out.slice(0, max), truncated: true, bytes: bytesRead() };
    }
    // `stopAt` is a string, a pattern for a tag written in either case, or a function of the text so far.
    if (stopAt && (typeof stopAt === 'function' ? stopAt(out) : stopAt instanceof RegExp ? stopAt.test(out) : out.includes(stopAt))) {
      reader.cancel().catch(() => {});
      break;
    }
  }
  return { text: out, truncated: false, bytes: bytesRead() };
}

/**
 * A page's head as text: decoded as its Content-Type header says, or, when
 * the header names no charset, as the <meta charset> (or http-equiv
 * Content-Type) in the head says, read from a first utf-8 decoding whose
 * markup survives whatever the encoding is. Without either, utf-8.
 */
async function readHead(res, type) {
  const declared = charsetOf(type);
  // The head closes in either case (</HEAD> on a page written in capitals),
  // as parseHead reads it; looked for in lower case alone, such a page was
  // read on to the cap on every preview. And it closes where parseHead finds
  // it closing: on the text with comments, scripts and styles taken out (see
  // stripHidden). Looked for in the text as it came, a "</head>" inside a
  // comment or a script in the head (a commented-out block of an older
  // template, a script that writes a document from strings) ended the read
  // there when the live tags stood in a later piece of the body, and the
  // page got no card, though the same page read whole was read right.
  const { text, bytes } = await readCapped(res, LIMITS.unfurlBodyBytes, (soFar) => HEAD_END.test(stripHidden(soFar)), declared);
  if (declared) return text;
  // The declaration that stands, not one commented out above it or written
  // by a script (see stripHidden, which parseHead reads its tags through):
  // a page in utf-8 that kept its old `<meta charset="windows-1252">` in a
  // comment was decoded as that, and its title came out "CafÃ©".
  const meta = charsetOf((/<meta\s[^>]{0,400}charset[^>]{0,200}>/i.exec(stripHidden(text)) || [])[0]);
  const dec = meta && decoderFor(meta);
  if (!dec || dec.encoding === 'utf-8') return text;
  return dec.decode(bytes).slice(0, LIMITS.unfurlBodyBytes);
}

/** A numeric entity outside Unicode (a hostile page) decodes to nothing rather than throwing. */
const codePoint = (n) => {
  const cp = Number(n);
  return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '';
};
// The named entities a page's title or description commonly carries; the
// rest of the named set is rare in metadata and is left as written.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', laquo: '\u00ab', raquo: '\u00bb', middot: '\u00b7', bull: '\u2022', copy: '\u00a9', reg: '\u00ae', trade: '\u2122', times: '\u00d7', deg: '\u00b0', euro: '\u20ac', pound: '\u00a3', yen: '\u00a5' };
const decodeEntities = (s) => String(s || '')
  .replace(/&#[xX]([0-9a-fA-F]{1,6});/g, (m, n) => codePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (m, n) => codePoint(n))
  .replace(/&([a-zA-Z]{2,8});/g, (m, n) => Object.hasOwn(NAMED, n) ? NAMED[n] : m)
  .replace(/\s+/g, ' ').trim();

/**
 * A document with its comments, scripts and styles taken out: what they hold
 * is not the page's metadata. A template's commented-out block of tags
 * (`<!-- <meta property="og:image" content="old.png"> -->` above the live
 * ones, the shape a page keeps for a season's old banner), or a script in
 * the head that writes a title from a string, used to be read as the page's
 * own: the card carried the old title and fetched the old picture, and the
 * live tags after them were passed over as the second of their name. One
 * left open runs to the end, as a browser reads it. One pass, each opener
 * looked for from where the last cut ended, so a head built of thousands of
 * them is read in linear time (see the scans below, held to the same).
 */
function stripHidden(html) {
  const lower = html.toLowerCase();
  const kinds = [['<!--', '-->'], ['<script', '</script'], ['<style', '</style']];
  const next = kinds.map(() => -2); // where each opener next stands, from the last cut on; -1 once there is none
  let out = '';
  let i = 0;
  for (;;) {
    let k = -1;
    for (let j = 0; j < kinds.length; j++) {
      if (next[j] !== -1 && next[j] < i) next[j] = lower.indexOf(kinds[j][0], i);
      if (next[j] >= 0 && (k < 0 || next[j] < next[k])) k = j;
    }
    if (k < 0) return out + html.slice(i);
    const [opener, closer] = kinds[k];
    out += html.slice(i, next[k]);
    const end = lower.indexOf(closer, next[k] + opener.length);
    if (end < 0) return out;
    i = end + closer.length;
    if (closer !== '-->') {
      const gt = lower.indexOf('>', i);
      i = gt < 0 ? html.length : gt + 1;
    }
  }
}

/** Pull title, description, site, and image out of a document head. */
export function parseHead(html, baseUrl) {
  const shown = stripHidden(html);
  const end = shown.search(HEAD_END);
  const head = shown.slice(0, end > -1 ? end : shown.length);
  const metas = {};
  // An attribute's value ends at the quote that opened it, not at the other
  // kind: an apostrophe in a title ("What's new") is part of the title.
  const attr = (tag, name) => {
    const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
    return m ? m[1] ?? m[2] ?? m[3] : undefined;
  };
  // A tag and a title are read only so far: on a page built of a hundred
  // thousand "<meta " with no ">" an unbounded scan runs from each of them
  // to the end of the head (seconds of the worker's CPU for the 200 KB the
  // body is capped at), where a real tag is a few hundred characters.
  for (const m of head.matchAll(/<meta\s[^>]{0,4000}>/gi)) {
    const tag = m[0];
    const key = attr(tag, '(?:property|name)');
    const content = attr(tag, 'content');
    if (key && content !== undefined && !Object.hasOwn(metas, key.toLowerCase())) metas[key.toLowerCase()] = decodeEntities(content);
  }
  const titleTag = (/<title[^>]{0,200}>([\s\S]{0,4000}?)<\/title>/i.exec(head) || [])[1];
  const title = metas['og:title'] || metas['twitter:title'] || decodeEntities(titleTag || '');
  const desc = metas['og:description'] || metas['twitter:description'] || metas.description || '';
  let site = metas['og:site_name'] || '';
  try {
    if (!site) site = shownHost(new URL(baseUrl).hostname);
  } catch {
    /* keep empty */
  }
  let image = metas['og:image'] || metas['og:image:url'] || metas['twitter:image'] || metas['twitter:image:src'] || '';
  if (image) {
    try {
      image = new URL(image, baseUrl).toString();
    } catch {
      image = '';
    }
  }
  // Clamped between whole characters (see cleanText): cut by the count
  // alone, a title whose two-hundredth unit fell inside an emoji kept half
  // of it, a lone surrogate that is no character, drawn as a blank glyph at
  // the end of the card.
  return {
    title: cleanText(title, 200),
    desc: cleanText(desc, 400),
    site: cleanText(site, 80),
    image: image || null,
  };
}

const imagePath = (hash) => `teamchat-unfurls/${hash}`;

/**
 * Preview data for a URL, from the cache or the network. Returns
 * { title, desc, site, image (a hash the worker serves, or null), kind }
 * or null when nothing can be shown. Failures are cached briefly so a dead
 * link is not fetched again on every retry.
 */
export async function unfurl(url) {
  // The page a link leads to is the same whatever stands after "#": a
  // fragment is the reader's place within it (a heading, a line of a file)
  // and never reaches the server, so the preview is fetched and remembered
  // by the address without it; the card keeps the link the message carries
  // (see the unfurl route). Keyed by the whole link, as it used to be, two
  // links to one page at different places (two lines of one file, two
  // sections of one document) had the page and its picture fetched twice
  // over, and a page remembered as having no preview was asked for again
  // under the next place in it.
  const page = pageOf(url);
  const key = KEYS.unfurl(await sha256(page));
  const cached = await kv().get(key);
  // An entry past its time by its own stamp is passed over, whatever the
  // store made of the timer it was asked for: the entry is written and then
  // timed in two steps, and a failure of the second (let pass below) left a
  // "no preview" standing for good, so the link never got a card on this
  // server however often it was posted again. An entry without a stamp (from
  // before they carried one) is taken as the timer alone had it.
  if (cached && !stale(cached)) return cached.none ? null : cached;
  // Whatever a page does (malformed markup, a header the platform refuses)
  // is a failed preview, remembered like any other, never an error that
  // escapes to the route and leaves the URL to be fetched again and again.
  let result = null;
  try {
    result = await fetchPreview(page);
  } catch {
    result = null;
  }
  await kv().set(key, result || { none: true, ts: Date.now() });
  await kv().expire(key, result ? CACHE_TTL_S : NEGATIVE_TTL_S).catch(() => {});
  return result;
}

/** A link without its fragment: the address the server is asked for, which is all a preview can be of (see unfurl). */
const pageOf = (url) => {
  const s = String(url);
  const at = s.indexOf('#');
  return at < 0 ? s : s.slice(0, at);
};

/** Is a cached entry older than the time it was given: an hour for a failed preview, a week for a card (see unfurl)? */
const stale = (c) => Number(c?.ts) > 0 && Date.now() - Number(c.ts) > (c.none ? NEGATIVE_TTL_S : CACHE_TTL_S) * 1000;

async function fetchPreview(url) {
  if (!allowedUrl(url)) return null;
  // One budget for the page and its picture together (see TOTAL_MS).
  const deadline = Date.now() + TOTAL_MS;
  const fetched = await guardedFetch(url, 'text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5', deadline);
  if (!fetched) return null;
  const [res, finalUrl] = fetched;
  const type = (res.headers.get('content-type') || '').toLowerCase();
  const ts = Date.now();
  if (type.startsWith('image/')) {
    const image = await storeImage(res, finalUrl);
    return image ? { title: '', desc: '', site: hostOf(finalUrl), image, kind: 'image', ts } : null;
  }
  if (!/text\/html|application\/xhtml/.test(type)) return null;
  const meta = parseHead(await readHead(res, type), finalUrl);
  if (!meta.title && !meta.desc) return null;
  let image = null;
  if (meta.image) {
    // What is left of the budget once the page is read; none, and the card goes without its picture.
    const img = await guardedFetch(meta.image, 'image/*', deadline);
    if (img && (img[0].headers.get('content-type') || '').startsWith('image/')) image = await storeImage(img[0], meta.image);
  }
  return { title: meta.title, desc: meta.desc, site: meta.site, image, kind: 'page', ts };
}

function hostOf(url) {
  try {
    return shownHost(new URL(url).hostname);
  } catch {
    return '';
  }
}

/**
 * A host as its owner writes it, for the card's site line when the page
 * names no site of its own: `www.` dropped, and each label the URL parser
 * turned into punycode (`xn--…`) turned back into its letters, so a link to
 * bücher.example is credited to "bücher.example" and not to
 * "xn--bcher-kva.example", the encoding the parser keeps for the wire and
 * nobody writes. A label that does not decode (not punycode after all, or
 * malformed) stays as it came. The message keeps the address as it was
 * typed, so the card and the line above it agree.
 *
 * Not a label written in letters of two alphabets that look alike (see
 * mixedScripts): a Cyrillic а before "pple" decodes to a word the eye reads
 * as apple, and the card credited the page to it, a site line that vouched
 * for a look-alike. Browsers keep such a label as its punycode in the
 * address bar for the same reason, and so does the card: the host stands
 * as the parser wrote it, which reads as what it is.
 */
function shownHost(hostname) {
  return String(hostname || '').replace(/^www\./, '').split('.').map((label) => {
    if (!/^xn--/i.test(label)) return label;
    try {
      const shown = punycodeDecode(label.slice(4));
      return mixedScripts(shown) ? label : shown;
    } catch {
      return label;
    }
  }).join('.');
}

/**
 * Does a decoded label mix letters of the Latin, Cyrillic and Greek
 * alphabets, whose letters look alike (а and a, о and o, ρ and p)? A label
 * of one alphabet is what its owner wrote, whatever the alphabet; one of two
 * is the shape a look-alike is made in, and is not shown as its letters.
 * Digits, hyphens and combining marks belong to no alphabet and count for
 * nothing; a label mixing Latin with Han or kana is not this either.
 */
const ALPHABETS = [/\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Greek}/u];
function mixedScripts(label) {
  return ALPHABETS.filter((re) => re.test(label)).length > 1;
}

/**
 * RFC 3492 decoding of one label (the part after "xn--"): the ASCII letters
 * before the last hyphen as they are, then the encoded code points inserted
 * among them. Throws on anything that is not well-formed, which shownHost
 * reads as "leave the label alone". The runtime the worker runs in offers
 * no decoder of its own.
 */
function punycodeDecode(input) {
  const BASE = 36;
  const T_MIN = 1;
  const T_MAX = 26;
  const SKEW = 38;
  const DAMP = 700;
  const out = [];
  const cut = input.lastIndexOf('-');
  for (let j = 0; j < Math.max(0, cut); j++) {
    const c = input.charCodeAt(j);
    if (c >= 0x80) throw new RangeError('not basic');
    out.push(c);
  }
  const digit = (c) => (c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : BASE);
  const adapt = (delta, points, first) => {
    let d = first ? Math.floor(delta / DAMP) : delta >> 1;
    d += Math.floor(d / points);
    let k = 0;
    for (; d > ((BASE - T_MIN) * T_MAX) >> 1; k += BASE) d = Math.floor(d / (BASE - T_MIN));
    return Math.floor(k + ((BASE - T_MIN + 1) * d) / (d + SKEW));
  };
  let n = 128;
  let i = 0;
  let bias = 72;
  for (let idx = cut > 0 ? cut + 1 : 0; idx < input.length;) {
    const was = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (idx >= input.length) throw new RangeError('cut short');
      const d = digit(input.charCodeAt(idx++));
      if (d >= BASE || d > Math.floor((0x7fffffff - i) / w)) throw new RangeError('bad digit');
      i += d * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (d < t) break;
      if (w > Math.floor(0x7fffffff / (BASE - t))) throw new RangeError('overflow');
      w *= BASE - t;
    }
    const points = out.length + 1;
    bias = adapt(i - was, points, was === 0);
    if (Math.floor(i / points) > 0x7fffffff - n) throw new RangeError('overflow');
    n += Math.floor(i / points);
    i %= points;
    if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) throw new RangeError('not a character');
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}

/** Read a body as bytes, giving up (and cancelling the stream) past `max`. */
async function readBytes(res, max) {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength > max ? null : buf;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

/**
 * Keep a bounded copy of an image in the owner's drive; returns its hash or
 * null. The bound is enforced while reading: a response without a
 * Content-Length (or with a dishonest one) is dropped the moment it exceeds
 * the limit, never buffered whole. The copy is kept for as long as messages
 * point at it, which is indefinitely; the settings switch explains the cost.
 */
async function storeImage(res, url) {
  const len = Number(res.headers.get('content-length'));
  if (len > LIMITS.unfurlImageBytes) return null;
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(type)) return null;
  let bytes;
  try {
    bytes = await readBytes(res, LIMITS.unfurlImageBytes);
  } catch {
    return null;
  }
  if (!bytes || bytes.byteLength === 0) return null;
  const blob = new Blob([bytes], { type });
  const hash = await sha256(url);
  try {
    await fs().write(imagePath(hash), blob, { createMissingParents: true, overwrite: true });
    await kv().set(`tc:unfurlimg:${hash}`, { type, size: blob.size, ts: Date.now() });
  } catch {
    return null;
  }
  return hash;
}

/** The stored thumbnail, for the route that serves it to members. */
export async function readImage(hash) {
  if (!/^[0-9a-f]{64}$/.test(String(hash))) return null;
  const meta = await kv().get(`tc:unfurlimg:${hash}`);
  if (!meta) return null;
  try {
    return { blob: await fs().read(imagePath(hash)), type: meta.type };
  } catch {
    return null;
  }
}
