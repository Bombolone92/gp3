/**
 * Rich text helpers shared by the worker and the app. Comments and articles
 * are stored as a small, safe subset of HTML. The sanitizer below rebuilds
 * the markup from tokens against an allowlist, so nothing from the input is
 * passed through verbatim; it needs no DOM, which lets the worker clean what
 * it stores and the app clean again what it renders.
 */

const ALLOWED = new Set([
  'p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'code', 'pre',
  'blockquote', 'ul', 'ol', 'li', 'a', 'h2', 'h3', 'h4', 'hr', 'img', 'table', 'thead', 'tbody',
  'tr', 'th', 'td', 'sub', 'sup', 'mark',
]);
const VOID = new Set(['br', 'hr', 'img']);
/** Elements whose content is dropped along with them. */
const DROP_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math',
  'textarea', 'select', 'title', 'head', 'xmp', 'noembed', 'noframes', 'frameset', 'canvas',
]);
const RENAME = { b: 'strong', i: 'em', strike: 's', del: 's', div: 'p' };

const ENTITY = /&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/gi;

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape text that may already contain valid entities, keeping them. */
function escapeText(text) {
  return String(text)
    .replace(/&(?!(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c' };

export function decodeEntities(text) {
  return String(text).replace(ENTITY, (all, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    const v = NAMED[body.toLowerCase()];
    return v === undefined ? all : v;
  });
}

function safeUrl(raw, { image = false } = {}) {
  const url = decodeEntities(String(raw || '')).trim().replace(/[\u0000- ]+/g, '');
  if (!url) return '';
  if (image) return /^https:\/\//i.test(url) ? url : '';
  if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
  // In-page links (#section) are dropped: element ids are not kept, so they
  // could never find their target, and in this hash-routed app following
  // one leaves the page (the help center reloads as the agent app).
  return '';
}

function parseAttrs(source) {
  const attrs = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(source))) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

function renderOpen(tag, attrs) {
  if (tag === 'a') {
    const href = safeUrl(attrs.href);
    const parts = ['<a'];
    if (href) parts.push(` href="${escapeHtml(href)}"`);
    if (href) parts.push(' target="_blank" rel="noopener noreferrer nofollow"');
    if (attrs.title) parts.push(` title="${escapeHtml(decodeEntities(attrs.title)).slice(0, 300)}"`);
    return parts.join('') + '>';
  }
  if (tag === 'img') {
    const src = safeUrl(attrs.src, { image: true });
    if (!src) return '';
    const alt = attrs.alt ? escapeHtml(decodeEntities(attrs.alt)).slice(0, 300) : '';
    return `<img src="${escapeHtml(src)}" alt="${alt}" loading="lazy">`;
  }
  if (tag === 'ol' && /^\d+$/.test(attrs.start || '')) return `<ol start="${attrs.start}">`;
  return `<${tag}>`;
}

/**
 * For each position, the index of the ">" that would close a tag whose
 * attributes start there (skipping quoted values), or -1 if none would.
 * Worked out back to front in one pass: scanning ahead from every "<"
 * instead takes seconds on a long message full of unterminated tags.
 */
function tagEnds(src) {
  const ends = new Int32Array(src.length + 1).fill(-1);
  let nextDouble = -1;
  let nextSingle = -1;
  for (let i = src.length - 1; i >= 0; i--) {
    const c = src.charCodeAt(i);
    if (c === 62 /* > */) ends[i] = i;
    else if (c === 34 /* " */) ends[i] = nextDouble === -1 ? -1 : ends[nextDouble + 1];
    else if (c === 39 /* ' */) ends[i] = nextSingle === -1 ? -1 : ends[nextSingle + 1];
    else ends[i] = ends[i + 1];
    if (c === 34) nextDouble = i;
    else if (c === 39) nextSingle = i;
  }
  return ends;
}

/**
 * Clean untrusted HTML down to the allowlist. Unknown tags are dropped but
 * their text kept; script-like elements are dropped with their content;
 * attributes other than a link's href and an image's https src are removed;
 * every open tag is closed.
 */
export function sanitizeHtml(input, { maxLength = 256 * 1024 } = {}) {
  const src = String(input ?? '').slice(0, maxLength * 2);
  const out = [];
  const stack = [];
  // The regex finds where a tag starts; where it ends comes from tagEnds, so
  // an unterminated tag is rejected without scanning ahead from every "<".
  const token = /<!--[\s\S]*?(?:-->|$)|<![^>]*>?|<\?[^>]*>?|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/g;
  const ends = tagEnds(src);
  let last = 0;
  let dropUntil = null;
  let m;
  let size = 0;
  // Stop at whole tokens once over budget, so the output never ends inside a tag.
  const push = (str) => {
    out.push(str);
    size += str.length;
  };
  while ((m = token.exec(src)) && size < maxLength) {
    let attrSource = '';
    if (m[2]) {
      const end = ends[token.lastIndex];
      if (end === -1) {
        // Never closed: not a tag, so it stays as text.
        token.lastIndex = m.index + 1;
        continue;
      }
      attrSource = src.slice(token.lastIndex, end);
      token.lastIndex = end + 1;
    }
    const text = src.slice(last, m.index);
    last = token.lastIndex;
    if (dropUntil) {
      if (m[2] && m[1] && m[2].toLowerCase() === dropUntil) dropUntil = null;
      continue;
    }
    if (text) push(escapeText(text).slice(0, Math.max(0, maxLength - size)));
    if (!m[2]) continue; // comment, doctype, processing instruction
    const closing = m[1] === '/';
    const raw = m[2].toLowerCase();
    if (DROP_CONTENT.has(raw)) {
      if (!closing && !/\/\s*$/.test(attrSource)) dropUntil = raw;
      continue;
    }
    if (!ALLOWED.has(raw)) continue;
    const tag = RENAME[raw] || raw;
    if (closing) {
      const at = stack.lastIndexOf(tag);
      if (at === -1) continue;
      while (stack.length > at) push(`</${stack.pop()}>`);
      continue;
    }
    if (VOID.has(tag)) {
      push(tag === 'img' ? renderOpen(tag, parseAttrs(attrSource)) : `<${tag}>`);
      continue;
    }
    // Paragraphs never nest; a new one closes the open one.
    if (tag === 'p' && stack.includes('p')) {
      while (stack.length && stack[stack.length - 1] !== 'p') push(`</${stack.pop()}>`);
      if (stack.length) push(`</${stack.pop()}>`);
    }
    if (stack.length > 40) continue;
    push(renderOpen(tag, parseAttrs(attrSource)));
    stack.push(tag);
  }
  if (!dropUntil && size < maxLength) {
    const rest = src.slice(last);
    if (rest) push(escapeText(rest).slice(0, Math.max(0, maxLength - size)));
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join('').replace(/<p><\/p>/g, '');
}

/** Plain text from stored HTML, for previews, search and email bodies. */
export function htmlToText(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<\/(p|div|h[1-6]|li|blockquote|pre|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g;

/** Plain text (a portal request, an email) to the stored HTML subset. */
export function textToHtml(text) {
  const blocks = String(text ?? '').replace(/\r\n?/g, '\n').trim().split(/\n{2,}/);
  return blocks
    .filter((b) => b.trim())
    .map((block) => {
      const escaped = escapeHtml(block);
      const linked = escaped.replace(URL_RE, (url) => {
        const href = url.replace(/&amp;/g, '&');
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>`;
      });
      return `<p>${linked.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

/** A short single-line preview of a comment. */
export function preview(html, max = 160) {
  const text = htmlToText(html).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}\u2026` : text;
}
