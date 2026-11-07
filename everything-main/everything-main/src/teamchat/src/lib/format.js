/**
 * Message text to safe HTML. Escapes everything first, then applies a small
 * markdown subset: fenced code blocks, inline code, **bold**, _italic_,
 * ~strike~, > quotes, links, @mentions, and :emoji: shortcodes. Code spans
 * are lifted out before inline formatting runs so nothing inside them is
 * touched.
 */

import { replaceShortcodes } from './emoji.js';
import { BROADCASTS, LINK_RE, LINK_TAIL_PUNCT } from '../shared/limits.js';
import { normalize, CJK_RUN, CJK_UNIT } from '../shared/search.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

// Placeholders for lifted code spans: a private-use character no user text contains.
const PH = '';
// Runs on escaped text, so a quote or angle bracket arrives as an entity
// (&quot; &#39; &gt; &lt;) and must end the URL the way the character would;
// an ampersand arrives as &amp; and may end it (a URL ending in "&"). A
// bracket pair inside the address is part of it (Wikipedia's "Foo_(bar)",
// a query "?q=[1]"); a lone closing bracket ends it, as it does for one
// wrapped in brackets. A lifted code span's placeholder never is part of it,
// nor is a tag the emphasis rules wrote (they run first, so "(_x_)" inside
// an address has become "(<em>x</em>)" by now): the address ends before
// such a bracket group rather than carrying markup into its href, and an
// address never ends on an opening bracket. A quote or an angle bracket
// (an entity by now) is no more part of a group than of the rest of the
// address: "(it's)" ends the address at the apostrophe, as the worker's
// LINK_RE (shared/limits.js) does, rather than putting "&#39;" in the href.
const URL_END = '(?!&(?:quot|#39|gt|lt);)';
const URL_GROUP = `\\((?:${URL_END}[^\\s()<>${PH}])*\\)|\\[(?:${URL_END}[^\\s\\[\\]<>${PH}])*\\]`;
// A single character of the address: not the start of a bracket pair or of
// &amp; (those are taken whole, so that backtracking cannot take them apart).
const URL_CHAR = `(?!${URL_GROUP}|&amp;)${URL_END}`;
// An address ends at punctuation of any other script (see LINK_TAIL_PUNCT in
// shared/limits.js), wherever it stands, as before the ASCII marks at its end.
const URL_RE = new RegExp(`\\bhttps?:\\/\\/(?:${URL_GROUP}|&amp;|${URL_CHAR}[^\\s<>"')\\]${PH}${LINK_TAIL_PUNCT}])*(?:${URL_GROUP}|&amp;|${URL_CHAR}[^\\s<>"'().,;:!?\\[\\]${PH}${LINK_TAIL_PUNCT}])`, 'gi');
// The same lead as the worker's extractMentionNames, so what rings as a
// mention is what shows as one; a quote or bracket arrives as an entity here.
const MENTION_RE = /(^|[^a-z0-9_])@([a-z0-9][a-z0-9_.-]{0,39})/gi;
// Where an italic or struck run may open and close (see inline): after or
// before a tag the rules before it wrote, whichever way the tag faces. A
// user's angle bracket is an entity by then, so a tag here is always ours.
// Punctuation of every script bounds a run as the ASCII marks do: an
// Arabic comma or question mark, a CJK full stop, a closing guillemet or
// corner bracket after the closing mark (\p{Po}, \p{Pe}, \p{Pf}), an
// opening quote or bracket before the opening one (\p{Ps}, \p{Pi}). Not
// the connector "_" (\p{Pc}), so "_a_b_" is left as it is, nor a dash, nor
// an ampersand: here it opens an entity, the user's own character (the
// angle bracket of "_b_<c" is "&lt;" by now, and ends nothing), and it is
// no boundary in the raw text either. A lifted code span's placeholder (see
// inline) is a boundary as the <code> tag it stands for is, and as the
// space the worker puts in a span's place is (shared/limits.js
// mentionableText): read as neither, "`c`_@alice_" drew no chip and
// "_https://x.io/q_`c`" no link, while the worker rang alice and previewed
// the address. The same classes in previewText, highlightSnippet and
// shared/limits.js linkableText, so what is drawn as emphasis is what the
// others take off.
const EMPH_LEAD = `(^|[\\s(\\[\\p{Ps}\\p{Pi}${PH}]|&quot;|&#39;|<[^<>]+>)`;
const EMPH_END = `(?=[\\s.,!?;:)\\]\\p{Pe}\\p{Pf}${PH}]|(?!&)\\p{Po}|&quot;|&#39;|<|$)`;
const EM_RE = new RegExp(`${EMPH_LEAD}_([^_\\n]+?)_${EMPH_END}`, 'gu');
const STRIKE_RE = new RegExp(`${EMPH_LEAD}~([^~\\n]+?)~${EMPH_END}`, 'gu');

/**
 * @param {string} text
 * @param {object} opts
 *   members: { [username]: { uuid, name } } for resolving mentions
 *   me: current user's uuid (highlights mentions of them)
 */
export function formatMessage(text, opts = {}) {
  // The placeholder character is stripped from the input: text that already
  // contained it would otherwise be read as a lifted code span and come out
  // as a copy of someone else's code.
  const src = String(text || '').replace(/\r\n?/g, '\n').split(PH).join('');
  const parts = src.split(/(```[\s\S]*?```)/g);
  let out = '';
  for (const part of parts) {
    if (part.startsWith('```') && part.endsWith('```') && part.length >= 6) {
      let body = part.slice(3, -3);
      const nl = body.indexOf('\n');
      // A language hint on the first line is kept as an attribute for the
      // renderer (label, highlighting) and never shown as code.
      let lang = '';
      if (nl > -1 && /^[\w+-]{1,20}$/.test(body.slice(0, nl).trim())) {
        lang = body.slice(0, nl).trim().toLowerCase();
        body = body.slice(nl + 1);
      }
      const attr = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
      out += `<pre class="code-block"${attr}><code>${escapeHtml(body.replace(/^\n+|\n+$/g, ''))}</code></pre>`;
    } else if (part) {
      out += inline(part, opts);
    }
  }
  return out;
}

function inline(text, opts) {
  const codes = [];
  const lift = (html) => {
    codes.push(html);
    return `${PH}${codes.length - 1}${PH}`;
  };
  let s = escapeHtml(text).replace(/`([^`\n]+)`/g, (_, code) => lift(`<code class="code-inline">${code}</code>`));

  // Quotes: consecutive lines starting with "> " become one blockquote.
  s = s.replace(/(^|\n)((?:&gt; ?[^\n]*(?:\n|$))+)/g, (_, lead, block) => {
    const body = block.replace(/(^|\n)&gt; ?/g, '$1').replace(/\n$/, '');
    return `${lead}<blockquote class="quote">${body}</blockquote>`;
  });

  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  // An italic or struck run stands on its own: opened after a space, a
  // bracket or a quote, closed before a space, punctuation, a bracket, a
  // quote or the end ("_Note_: ..." and "(_sic_)" alike), never inside a
  // word (snake_case). Runs on escaped text, so a quote is an entity here;
  // shared/limits.js linkableText keeps the same rules on the raw text.
  // The rules before this one wrote tags where the words have a mark or the
  // quote's arrow, and a run may open right after one and close right before
  // one, whichever way it faces: "**_x_**", the first line of "> _x_", and
  // bold and italics with nothing between them ("**a**_b_", "_a_**b**").
  // That is what shared/limits.js linkableText says of
  // the raw text, where a bold mark leaves a space, so an address in italics
  // beside bold is the link there that it is here.
  s = s.replace(EM_RE, '$1<em>$2</em>');
  s = s.replace(STRIKE_RE, '$1<s>$2</s>');

  // Links are lifted out like code spans, so nothing that runs afterwards
  // (mentions, shortcodes) can rewrite the inside of an href.
  s = s.replace(URL_RE, (url) => {
    const safe = url.replace(/&amp;/g, '&');
    const chars = [...safe]; // whole characters: a cut through an emoji would show a broken glyph
    const label = chars.length > 64 ? `${chars.slice(0, 61).join('')}...` : safe;
    return lift(`<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(label)}</a>`);
  });

  const members = opts.members || {};
  s = s.replace(MENTION_RE, (m, lead, raw) => {
    // A period or hyphen the handle ends in is the sentence's, not the
    // name's ("thanks @alice."), as the worker's extractMentionNames reads
    // it: it stays after the chip rather than going with the match.
    const tail = /[.-]+$/.exec(raw)?.[0] || '';
    const name = raw.slice(0, raw.length - tail.length);
    const key = name.toLowerCase();
    // @channel, @here and @everyone reach a group and never resolve to a person.
    if (BROADCASTS.includes(key)) return `${lead}<span class="mention mention-broadcast">@${key}</span>${tail}`;
    // Own entries only: "@constructor" must not find Object.prototype's.
    const lookup = (k) => (Object.hasOwn(members, k) ? members[k] : null);
    const member = lookup(key);
    if (!member) return m;
    const cls = member.uuid === opts.me ? 'mention mention-me' : 'mention';
    return `${lead}<span class="${cls}" data-uuid="${escapeHtml(member.uuid)}">@${escapeHtml(member.name || name)}</span>${tail}`;
  });

  // Shortcodes are letters, digits, _ + - between colons: nothing an entity
  // or a tag produced above can contain, so this is safe on escaped text.
  s = replaceShortcodes(s);

  s = s.replace(/\n/g, '<br>');
  s = s.replace(/<\/blockquote><br>/g, '</blockquote>');
  s = s.replace(new RegExp(`${PH}(\\d+)${PH}`, 'g'), (_, i) => codes[Number(i)]);
  return s;
}

/**
 * An address fit for an href, or null: only http(s). Every worker checks
 * the links it stores (bookmarks, previews), but a shared channel's are
 * read from its host's worker, which is another owner's; what is drawn
 * from there is held to the same rule here.
 */
export function safeHref(url) {
  return /^https?:\/\//i.test(String(url || '')) ? String(url) : null;
}

/**
 * Plain-text preview for sidebars and notifications: the words as written,
 * with only the marks the renderer would consume taken off, by its rules
 * (a fenced block stands in as "[code]", inline code keeps its text and
 * loses its backticks). Taking every asterisk, underscore, tilde and
 * greater-than sign out instead read MAX_RETRIES as MAXRETRIES and
 * "x_train > 5" as "xtrain 5".
 */
export function previewText(text, max = 80, { appLink = null } = {}) {
  const codes = [];
  const s = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(PH).join('')
    // A fenced block's stand-in is lifted like a code span, and a span never
    // reaches across it (the placeholder is kept out of a span's text): the
    // renderer splits the message at its fences first, so a stray backtick
    // before a block and a span after it are separate things there ("it's
    // `broken```…``` and `fine`" draws "`broken" as written, then the block,
    // then "fine" as code), and read as one span they took the block's
    // stand-in into the span's text, where nothing laid it back.
    .replace(/```[\s\S]*?```/g, () => {
      codes.push(' [code] ');
      return `${PH}${codes.length - 1}${PH}`;
    })
    .replace(/`([^`\n\uE000]+)`/g, (_, code) => {
      codes.push(code);
      return `${PH}${codes.length - 1}${PH}`;
    })
    .replace(/(^|\n)> ?/g, '$1')
    // Italics and strikethrough before bold, whose marks stand here where
    // the renderer's tags stand by the time its rules run (see inline): a
    // run may open or close right against them ("**a**_b_", "_a_**b**",
    // "**_x_**"), and read "ab" as the message draws it, not "a_b_".
    // Punctuation of every script bounds a run, as EMPH_LEAD and EMPH_END
    // have it, and so does a lifted code span's placeholder (), as it
    // does there.
    .replace(/(^|[\s(["'\p{Ps}\p{Pi}]|\*\*)_([^_\n]+?)_(?=[\s.,!?;:)\]"'\p{Pe}\p{Pf}]|(?!&)\p{Po}|\*\*|$)/gu, '$1$2')
    .replace(/(^|[\s(["'\p{Ps}\p{Pi}]|\*\*)~([^~\n]+?)~(?=[\s.,!?;:)\]"'\p{Pe}\p{Pf}]|(?!&)\p{Po}|\*\*|$)/gu, '$1$2')
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    // A link the caller can name (`appLink`: a permalink into this
    // workspace, see ui/applink.js) reads as its words, the way the
    // renderer draws it; code is lifted, so an address inside a code span
    // stays as written. The words are someone's names (a channel's, the
    // people in a direct message), which may carry the placeholder
    // character as user text may: it is taken out of them as it is out
    // of the text, or the lifted code would be laid back into a name.
    .replace(LINK_RE, (url) => (appLink && !url.includes(PH) && String(appLink(url) || '').split(PH).join('')) || url)
    .replace(new RegExp(`${PH}(\\d+)${PH}`, 'g'), (_, i) => codes[Number(i)])
    .replace(/\s+/g, ' ')
    .trim();
  // Cut between characters as the reader sees them (an emoji written as a
  // sequence is one; see graphemes), never through one: a cut that fell
  // inside a surrogate pair left half of it before the dots, drawn as a
  // broken glyph in the sidebar, a pin, a notification.
  if (s.length <= max) return s;
  // Only as many characters as the preview can show, plus one to tell that
  // there are more (see firstGraphemes).
  const chars = firstGraphemes(s, max + 1);
  return chars.length > max ? `${chars.slice(0, Math.max(0, max - 3)).join('')}...` : s;
}

/**
 * One line of context around the first of `words` in a message, as HTML
 * with the words marked. The text is read word by word the way the index
 * reads it (letters and digits, compared lowercase with accents stripped),
 * so a search for "cafe" marks "Café" too. Matches are tagged in the plain
 * text with private-use characters before escaping, so a mark can never
 * land inside an entity.
 */
export function highlightSnippet(text, words = [], max = 180, { appLink = null } = {}) {
  const OPEN = '\uE001';
  const CLOSE = '\uE002';
  // The renderer's marks come off the way previewText takes them off, so the
  // line reads as the message does; code is indexed too, so it stays and
  // only the fences and backticks go. A link the caller can name (`appLink`)
  // reads as its words, as in previewText.
  // The marks come off the text after the links have been read as words:
  // the words are names, which may carry them as user text may, and left
  // in one they would open a highlight that nothing closes.
  // Code is lifted out whole before any of that, as the renderer and
  // previewText lift it, and laid back in before the words are marked: its
  // text is nobody's markup, and read as such a code span "_.map(a,
  // _.identity)" lost its underscores to the italic rule, "f(**a, **b)" its
  // asterisks to the bold one, and an address inside one read as a link
  // into the app; its words are still found and marked. A fenced block
  // keeps its text the same way, less the language hint the renderer takes
  // off its first line; a stray fence with no closing one goes as before.
  const codes = [];
  const lift = (code) => {
    codes.push(code);
    return `${PH}${codes.length - 1}${PH}`;
  };
  const plain = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(PH).join('')
    .replace(/```[\s\S]*?```/g, (fence) => {
      let body = fence.slice(3, -3);
      const nl = body.indexOf('\n');
      if (nl > -1 && /^[\w+-]{1,20}$/.test(body.slice(0, nl).trim())) body = body.slice(nl + 1);
      return ` ${lift(body)} `;
    })
    .replace(/```[\w+-]*/g, ' ')
    // Not across a lifted block (see previewText): a span reaching over one
    // took the block's placeholder into its own lifted text, where nothing
    // laid the block back, and the snippet showed the placeholder character
    // where the block's words, the very words searched for, had been.
    .replace(/`([^`\n\uE000]+)`/g, (_, code) => lift(code))
    .replace(/(^|\n)> ?/g, '$1')
    // Italics and strikethrough against bold and lifted code, as previewText takes them off.
    .replace(/(^|[\s(["'\p{Ps}\p{Pi}]|\*\*)_([^_\n]+?)_(?=[\s.,!?;:)\]"'\p{Pe}\p{Pf}]|(?!&)\p{Po}|\*\*|$)/gu, '$1$2')
    .replace(/(^|[\s(["'\p{Ps}\p{Pi}]|\*\*)~([^~\n]+?)~(?=[\s.,!?;:)\]"'\p{Pe}\p{Pf}]|(?!&)\p{Po}|\*\*|$)/gu, '$1$2')
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(LINK_RE, (url) => (appLink && !url.includes(PH) && appLink(url)) || url)
    .replace(new RegExp(`${PH}(\\d+)${PH}`, 'g'), (_, i) => codes[Number(i)])
    .replace(/[\uE001\uE002]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const wanted = new Set(words.map((w) => normalize(w)).filter(Boolean));
  const WORD = /[\p{L}\p{N}\p{M}]+/gu; // marks stay with their letters, as the tokenizer keeps them
  const hit = (w) => wanted.has(normalize(w));
  // A run of Chinese or Japanese is a clause, which the index reads as its
  // overlapping pairs of characters (see shared/search.js words), and the
  // query's words are such pairs: the stretch of the clause they cover is
  // what is marked (not the clause whole, and not nothing). Each character
  // is normalized on its own, as the tokenizer's units are.
  const cover = (run) => {
    const units = run.match(CJK_UNIT) || [];
    const covered = units.map(() => false);
    for (let i = 0; i + 1 < units.length; i++) if (wanted.has(normalize(units[i] + units[i + 1]))) covered[i] = covered[i + 1] = true;
    return { units, covered };
  };
  const markRun = (run) => {
    const { units, covered } = cover(run);
    if (!covered.some(Boolean)) return run;
    let out = '';
    for (let i = 0; i < units.length; i++) {
      if (covered[i] && !covered[i - 1]) out += OPEN;
      out += units[i];
      if (covered[i] && !covered[i + 1]) out += CLOSE;
    }
    return out;
  };
  // A word with a clause in it (iPhone\u7528\u30a2\u30d7\u30ea, caf\u00e9\u6771\u4eac) is read in parts,
  // as the tokenizer reads it: each clause by its pairs, and what stands
  // beside a clause as a word of its own. The parts, in order, each with its
  // offset in the word and whether it is a clause.
  const RUNS = new RegExp(CJK_RUN.source, CJK_RUN.flags);
  const parts = (w) => {
    const out = [];
    let last = 0;
    for (const m of w.matchAll(RUNS)) {
      if (m.index > last) out.push({ text: w.slice(last, m.index), at: last, run: false });
      out.push({ text: m[0], at: m.index, run: true });
      last = m.index + m[0].length;
    }
    if (last < w.length) out.push({ text: w.slice(last), at: last, run: false });
    return out;
  };
  const markWord = (w) => (hit(w) ? `${OPEN}${w}${CLOSE}` : parts(w).map((p) => (p.run ? markRun(p.text) : hit(p.text) ? `${OPEN}${p.text}${CLOSE}` : p.text)).join(''));
  // Where in a word the first match lies: the word's start, that of a part
  // beside a clause, or that of the first covered character of a clause; -1 for none.
  const hitAt = (w) => {
    if (hit(w)) return 0;
    for (const p of parts(w)) {
      if (!p.run) {
        if (hit(p.text)) return p.at;
        continue;
      }
      const { units, covered } = cover(p.text);
      const i = covered.indexOf(true);
      if (i > -1) return p.at + units.slice(0, i).join('').length;
    }
    return -1;
  };
  let start = 0;
  if (wanted.size) {
    let m;
    let at = -1;
    while ((m = WORD.exec(plain))) if ((at = hitAt(m[0])) > -1) break;
    if (m && m.index + at > max * 0.4) start = Math.max(0, m.index + at - Math.floor(max * 0.3));
  }
  let cut = plain.slice(start, start + max);
  if (start > 0) cut = `\u2026${cut.replace(/^\S*\s/, '')}`;
  if (start + max < plain.length) cut = `${cut.replace(/\s\S*$/, '')}\u2026`;
  const tagged = wanted.size ? cut.replace(WORD, markWord) : cut;
  return escapeHtml(tagged).split(OPEN).join('<mark>').split(CLOSE).join('</mark>');
}

/**
 * The characters of a word as the reader sees them: an emoji written as a
 * sequence (a family, a flag, a hand with a skin tone) is one character,
 * not the two to seven code points it is made of, so it is not cut apart.
 * Where the browser cannot tell (no Intl.Segmenter), whole code points.
 */
let segmenter = null;
export function graphemes(word) {
  if (typeof Intl === 'undefined' || !Intl.Segmenter) return [...word];
  segmenter = segmenter || new Intl.Segmenter();
  return [...segmenter.segment(word)].map((s) => s.segment);
}

/**
 * The first `n` characters of a text as the reader sees them (see
 * graphemes), read from the front and no further. A preview of eighty
 * characters cut from a message of four thousand had every one of the four
 * thousand segmented first, several milliseconds for each long line the
 * direct message list drew afresh on every poll.
 */
function firstGraphemes(text, n) {
  if (n <= 0) return [];
  if (typeof Intl === 'undefined' || !Intl.Segmenter) return [...text].slice(0, n);
  segmenter = segmenter || new Intl.Segmenter();
  const out = [];
  for (const s of segmenter.segment(text)) {
    out.push(s.segment);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * At most `max` characters as the platform counts them (UTF-16 units, the
 * count an input's maxlength and the workers' limits use), cut only between
 * whole characters as the reader sees them (see graphemes). Cut by the
 * count alone, a flag or a joined emoji standing at the edge lost its
 * second half, and a boxed letter, or half a family, stood in its place.
 */
export function cutText(s, max) {
  const text = String(s ?? '');
  if (text.length <= max) return text;
  let out = '';
  // At most `max` characters can fit (each is a unit at least), so no more are read (see firstGraphemes).
  for (const g of firstGraphemes(text, max)) {
    if (out.length + g.length > max) break;
    out += g;
  }
  return out;
}

/** Initials for an avatar: up to two characters (whole ones: an emoji in a name is not cut in half). */
export function initials(name) {
  const words = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = (w) => graphemes(w)[0] || '';
  if (words.length === 1) return graphemes(words[0]).slice(0, 2).join('').toUpperCase();
  return (first(words[0]) + first(words[words.length - 1])).toUpperCase();
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
