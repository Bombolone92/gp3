/** Validation limits shared by the worker (enforced) and the UI (hinted). */
export const LIMITS = {
  workspaceName: 60,
  channelName: 40,
  channelTopic: 250,
  channelDescription: 500,
  displayName: 60,
  title: 80,
  statusText: 60,
  avatarBytes: 300 * 1024,
  /** A workspace's icon, uploaded by an admin; square and small like a photo. */
  workspaceIconBytes: 300 * 1024,
  messageText: 4000,
  attachmentsPerMessage: 5,
  attachmentBytes: 10 * 1024 * 1024,
  dmMembers: 9,
  /** Direct message conversations one member may be in per workspace; each is an entry on their own document, kept for good. */
  dmsPerMember: 500,
  mentionsPerMessage: 20,
  messagesPerFetch: 100,
  /** Failed join attempts one account may make per window before a 429. */
  joinAttempts: 8,
  joinWindowSeconds: 600,
  searchQuery: 200,
  pinsPerConversation: 100,
  inboxItems: 300,
  threadsFollowed: 300,
  savedItems: 200,
  scheduledPerMember: 50,
  webhooksPerWorkspace: 50,
  webhookName: 40,
  webhookBodyBytes: 16 * 1024,
  /** Calls one webhook or bot token may make per minute. */
  hookRatePerMinute: 60,
  /** Link previews a member, and a workspace, may trigger per ten minutes. */
  unfurlsPerMember: 30,
  unfurlsPerWorkspace: 300,
  unfurlWindowSeconds: 600,
  unfurlBodyBytes: 200 * 1024,
  /** Files one member may upload per window, and bytes per day; every upload sits in the owner's storage. */
  uploadsPerMember: 100,
  uploadWindowSeconds: 600,
  uploadBytesPerDay: 500 * 1024 * 1024,
  unfurlImageBytes: 300 * 1024,
  remindersPerMember: 100,
  bookmarksPerChannel: 10,
  bookmarkLabel: 40,
  bookmarkUrl: 500,
  /** Workspaces one channel can be shared with. */
  connectionsPerChannel: 20,
  /** Fresh events handles one member may ask for per workspace per window when the one they hold is refused (see worker/events.js). */
  evRemintsPerMember: 3,
  evRemintWindowSeconds: 3600,
};

/**
 * Reserved mention names that reach a group rather than a person. A member
 * whose username happens to be one of these is never mentioned by it.
 */
export const BROADCASTS = ['channel', 'here', 'everyone'];
export const BROADCAST_POLICIES = ['everyone', 'admins'];
/** Members one broadcast may notify; matches the workspace member cap. */
export const BROADCAST_FANOUT = 500;

/**
 * The broadcast a text asks for, or null. `everyone` outranks `channel`, which
 * outranks `here`: each reaches everyone the next one does, and more. Read as
 * BROADCASTS reversed, `here` came before `channel`, and "@here @channel"
 * notified only those active at that moment.
 */
const BROADCAST_RANK = ['everyone', 'channel', 'here'];
export function broadcastKind(names) {
  for (const k of BROADCAST_RANK) if (names.includes(k)) return k;
  return null;
}

/** Per-conversation notification levels a member can choose. */
export const NOTIFY_LEVELS = ['all', 'mentions', 'nothing'];

/** Who may post in a channel, and who may reply in its threads. */
export const POST_POLICIES = ['members', 'admins'];
export const THREAD_POLICIES = ['everyone', 'admins', 'off'];

/** How long an invite stays valid; admins pick one when rotating. */
export const INVITE_TTLS = {
  '1d': { seconds: 86400, label: '1 day' },
  '7d': { seconds: 7 * 86400, label: '7 days' },
  '30d': { seconds: 30 * 86400, label: '30 days' },
};
export const DEFAULT_INVITE_TTL = '7d';

/**
 * Channel names: lowercase letters, digits, hyphens. Returns the
 * cleaned name or null when nothing usable is left.
 */
export function cleanChannelName(input) {
  const s = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    // Cut to length before the end is trimmed: a name cut right after a
    // hyphen (or a space, which became one) otherwise kept it as its last letter.
    .slice(0, LIMITS.channelName)
    .replace(/-+$/, '');
  return s || null;
}

/**
 * `s` cut to at most `max` UTF-16 units (the count the app's own fields and
 * the workers' limits use), between whole characters as the reader sees
 * them: an emoji written as a sequence of code points (a family, a flag, a
 * keycap, a hand with a skin tone) is one character, and is not cut apart.
 * Cut by the count alone, with only the half of a two-unit character that
 * the cut left behind going with the half it took, a sequence standing at
 * the edge lost its tail and drew as whatever its head drew alone: a man in
 * place of a family, a boxed letter in place of a flag, a bare digit in
 * place of a keycap. The characters are told apart from the start of the
 * text up to a little past the cut (as many as the cut keeps, and no more:
 * bounding a very long text costs no more than the cut did), never from a
 * point inside it: where a character ends depends on what stands before it
 * (two regional indicators make a flag, and which two pair up is settled
 * from the first of the run), so read from a point sixty-four units before
 * the cut, a run of flags that began off that point paired up the wrong
 * way from there on, and the cut fell between the two halves of a flag.
 * Where the runtime cannot tell characters apart (no Intl.Segmenter), or
 * where no whole character ends before the cut (one run of combining marks
 * longer than the text kept), the cut falls between code points as before.
 */
let segmenter = null;
/** How far past the cut is read, so that the character the cut falls in is seen whole. */
const CUT_LOOKAHEAD = 64;
function cutWhole(s, max) {
  if (s.length <= max) return s;
  const byUnits = () => {
    const cut = s.slice(0, max);
    return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
  };
  if (typeof Intl === 'undefined' || !Intl.Segmenter) return byUnits();
  segmenter = segmenter || new Intl.Segmenter();
  let end = 0;
  for (const seg of segmenter.segment(s.slice(0, max + CUT_LOOKAHEAD))) {
    const stop = seg.index + seg.segment.length;
    if (stop > max) break;
    end = stop;
  }
  return end > 0 ? s.slice(0, end) : byUnits();
}

/**
 * Trim and clamp free text; returns '' for non-strings. The clamp counts
 * UTF-16 units, as the app's own counters do, and falls only between whole
 * characters as the reader sees them (see cutWhole); what a cut leaves at
 * the end is trimmed as the start is.
 */
export function cleanText(input, max) {
  if (typeof input !== 'string') return '';
  const s = input.replace(/\r\n?/g, '\n').trim();
  return s.length <= max ? s : cutWhole(s, max).trimEnd();
}

/**
 * The text a mention is looked for in: what the renderer draws as one. Code
 * is left out, a fenced block and an inline span alike, told apart exactly
 * as lib/format.js tells them (a fence is closed; a span is non-empty and
 * on one line), and each piece is looked at on its own, as the renderer
 * looks at each. An @channel in a snippet, or a name in one, drew as plain
 * code and rang everyone all the same; a member's snippet holding @channel
 * was refused in #general as a notice only admins may send. The renderer's
 * emphasis marks come off next, by its rules (see emphasisOff), and then
 * every address goes (see LINK_RE): the renderer lifts an address out whole
 * before it looks for mentions, so a handle inside one
 * (https://mastodon.social/@alice) is a path segment and draws no chip,
 * and one it draws in italics (_@alice_) is a chip, the underscore being a
 * tag by then. Read from the raw text, the address rang alice, badged her
 * and put a mention nothing showed in her Activity, an address holding
 * @channel asked the sender to notify everyone (and was refused where only
 * admins may), and the italic handle rang nobody.
 */
function mentionableText(text) {
  return String(text || '').split(/(```[\s\S]*?```)/g)
    .map((part) => (part.startsWith('```') && part.endsWith('```') && part.length >= 6 ? ' ' : emphasisOff(part.replace(/`[^`\n]+`/g, ' ')).replace(LINK_RE, ' ')))
    .join(' ');
}

/** Usernames mentioned in text, in order of first appearance, lowercased. Nothing inside code or an address counts (see mentionableText). */
export function extractMentionNames(text) {
  const seen = new Set();
  const re = /(^|[^a-z0-9_])@([a-z0-9][a-z0-9_.-]{0,39})/gi;
  let m;
  while ((m = re.exec(mentionableText(text))) !== null) {
    seen.add(m[2].toLowerCase().replace(/[.-]+$/, ''));
  }
  return [...seen];
}

/**
 * A link as the renderer draws it (lib/format.js): a bracket pair inside the
 * address belongs to it, a lone closing bracket or trailing punctuation
 * ends it, and it never ends on an opening bracket. Kept in step so what is
 * unfurled is what is clickable.
 */
const LINK_GROUP = '\\([^\\s()<>"\']*\\)|\\[[^\\s\\[\\]<>"\']*\\]';
/**
 * Punctuation of other scripts that ends an address as the ASCII marks do:
 * a full stop, comma, question or exclamation mark of Chinese, Japanese and
 * Arabic, a closing corner bracket or guillemet, a curly quote, an ellipsis.
 * "見て https://x.io/a。" carried the full stop into the address, and the
 * link led nowhere. None of them is ever written raw inside an address, so
 * one cuts it wherever it stands ("https://x.io/a、b" is the address and a
 * comma), where a Latin full stop is part of one until the end. Named, not
 * \p{Po}: that class holds "/" and "#" too, and an address ending in a
 * slash would have lost it. Shared with the renderer's URL_RE
 * (lib/format.js), kept to the same shapes.
 */
export const LINK_TAIL_PUNCT = '。、，．！？；：」』）】》〉〕…‥«»“”‘’‚„‹›¡¿،؛؟';
export const LINK_RE = new RegExp(`\\bhttps?:\\/\\/(?:${LINK_GROUP}|(?!${LINK_GROUP})[^\\s<>"')\\]${LINK_TAIL_PUNCT}])*(?:${LINK_GROUP}|(?!${LINK_GROUP})[^\\s<>"'().,;:!?\\[\\]${LINK_TAIL_PUNCT}])`, 'gi');

/**
 * The text a link is looked for in: code spans and blocks left out (an
 * address in code is not a link), and the renderer's emphasis marks taken
 * off the way lib/format.js takes them (its rules, in its order), so an
 * address written in bold or italics is found as it is drawn — without
 * the closing marks, and at all for `_https://…_`, where the underscore
 * would otherwise deny the address its word boundary.
 */
export function linkableText(text) {
  return emphasisOff(String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' '));
}

/**
 * The renderer's emphasis marks taken off a text with no code in it, by the
 * renderer's rules in its order (see lib/format.js inline), as the text
 * stands by the time it looks for links and mentions.
 */
function emphasisOff(text) {
  return text
    // Bold marks stand in for the tags the renderer has made of them by the
    // time it looks for links, which end an address as a space does: taken
    // off with nothing in their place, "https://x.io/a**b**" read as an
    // address nobody wrote, and "see**https://x.io/a**" as no address at all.
    .replace(/\*\*([^*\n]+?)\*\*/g, ' $1 ')
    // The renderer's italic and strike rules on the raw text (there, quotes
    // are entities). A quote's arrow at the start of a line is the
    // renderer's blockquote tag by the time it looks for italics, and a run
    // may open right after it (">_x_" quotes italics as "> _x_" does), so
    // the arrow is a lead here too; it stays where it is, since a caller
    // reading this line by line tells a quoted line by it (see
    // ui/message.js firstQuotableLink).
    // Punctuation of every script bounds a run, as the renderer's EMPH_LEAD
    // and EMPH_END have it (an opening quote or bracket before; any other
    // punctuation after, but the connector "_", a dash and an ampersand).
    // The closing mark leaves a space, as a bold mark does: the tag the
    // renderer has made of it by the time it looks for links and mentions
    // ends an address and stands before a handle as a space does, so
    // "~fixed~@alice" is alice's chip there ("fixed" struck, then the
    // mention); with the mark taken off and nothing in its place, the
    // handle read as the tail of "fixed@alice", a word, and rang nobody.
    .replace(/(^|[\s(["'\p{Ps}\p{Pi}]|(?:^|\n)> ?)_([^_\n]+?)_(?=[\s.,!?;:)\]"'\p{Pe}\p{Pf}]|(?!&)\p{Po}|$)/gu, '$1$2 ')
    .replace(/(^|[\s(["'\p{Ps}\p{Pi}]|(?:^|\n)> ?)~([^~\n]+?)~(?=[\s.,!?;:)\]"'\p{Pe}\p{Pf}]|(?!&)\p{Po}|$)/gu, '$1$2 ');
}

/** The first http(s) link in a text, as the renderer would draw it, or null. */
export function firstLinkOf(text) {
  const m = new RegExp(LINK_RE.source, 'i').exec(linkableText(text));
  return m ? m[0] : null;
}

/**
 * A link into the app itself: its fragment is one of the app's routes
 * (#/ws/…, #/join/…, #/connect/…). Recognized by shape rather than origin —
 * the app is served from wherever it is served, and the workspace reference
 * inside the fragment already names the worker — so the client and every
 * worker agree without either knowing the app's address. The page behind
 * such a link is always the app shell (a fragment is never sent to the
 * server), whose generic card says nothing; a link to the app's front page
 * itself, with no route, is a deliberate share and keeps its preview.
 */
export function isAppLink(url) {
  try {
    return /^#\/(ws|join|connect)\//.test(new URL(String(url)).hash);
  } catch {
    return false;
  }
}

/** The first link worth a preview: like firstLinkOf, but a link into the app itself is passed over. */
export function firstUnfurlableLink(text) {
  for (const m of linkableText(text).matchAll(LINK_RE)) {
    if (!isAppLink(m[0])) return m[0];
  }
  return null;
}
