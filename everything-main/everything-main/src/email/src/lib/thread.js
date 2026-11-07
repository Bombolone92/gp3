/**
 * Conversations: grouping a folder's messages into threads the way Gmail
 * groups them.
 *
 * Everything here is a pure function over the listed messages, so the awkward
 * cases -- a reply whose client dropped `References`, a mailing list that
 * rewrites the subject, two unrelated notices that happen to share one -- are
 * tested here rather than in the DOM.
 *
 * What a message has to carry: `subject`, `messageId`, `references`, and the
 * `day`/`name` the mailbox orders by. The first three come from the same 8 KB
 * head read the list already does per row, so threading needs no reads of its
 * own beyond the ones the rows were going to cost anyway.
 */

/**
 * One reply or forward prefix. Repeated rather than made `+` in the pattern
 * because "Re: Fwd: Re: x" is three, and each one has to be recognised for
 * what is left to be the subject.
 *
 * The list is the prefixes mail actually arrives with: English, plus the
 * German, Dutch, Nordic, French, Italian, Spanish, Portuguese, Polish and
 * Turkish ones that Outlook and Apple Mail localise to. `Re[2]:` and `Re(2):`
 * are the counted forms some clients emit.
 */
/*
 * The space before the counted form is inside the optional group, not beside
 * it. Written as `\s*(?:[[(]\d+[\])])?\s*:` the two runs of whitespace can be
 * divided between them in as many ways as there are spaces, and every one of
 * them is tried before a subject like `Re` followed by sixty thousand spaces
 * is admitted not to be a prefix -- which is five seconds of frozen tab, per
 * message, while a folder is grouped into conversations. Inside the group
 * there is only one way to read it. The two accept exactly the same subjects.
 */
const PREFIX = /^\s*(?:re|fwd?|aw|wg|sv|vs|tr|odp|res|enc|rif|ref|antw(?:oord)?|doorst|ynt|rép|rep)(?:\s*[[(]\d+[\])])?\s*:\s*/i;

// A mailing list tag, which is part of the subject rather than a prefix.
const TAG = /^\s*(\[[^\]]{1,60}\])\s*/;

/**
 * The subject with its reply and forward prefixes taken off, and whether
 * there were any -- which is the difference between a message that answers
 * something and one that starts it.
 */
export const stripPrefixes = (subject = '') => {
  let text = String(subject);
  let replied = false;

  const eat = () => {
    for (;;) {
      const next = text.replace(PREFIX, '');
      if (next === text) return;
      text = next;
      replied = true;
    }
  };

  eat();
  // A list that rewrites the subject puts its tag in front of the prefix
  // ("[dev] Re: patch"); the client that replied put the prefix in front of
  // the tag ("Re: [dev] patch"). Both are the same conversation, so the tag
  // is stepped over and then kept -- dropping it would merge two lists that
  // happen to be discussing the same thing.
  const tag = TAG.exec(text);
  if (tag) {
    text = text.slice(tag[0].length);
    eat();
    text = `${tag[1]} ${text}`;
  }
  return { text: text.trim(), replied };
};

/** The form two subjects are compared as. */
export const normalizeSubject = (subject = '') =>
  stripPrefixes(subject).text.replace(/\s+/g, ' ').trim().toLowerCase();

/** Whether this subject is an answer to something rather than a new start. */
export const isReply = (subject = '') => stripPrefixes(subject).replied;

// -- message ids ---------------------------------------------------------------

// RFC 5322 writes every id in angle brackets, so matching them is also what
// rejects a malformed header rather than letting half of one into the map.
const MSG_ID = /<[^<>\s]+>/g;

export const parseMessageId = (headers) =>
  (headers?.get('message-id') || '').match(MSG_ID)?.[0] ?? '';

/**
 * Every id this message answers: the `References` chain plus `In-Reply-To`,
 * which is usually the last of them and occasionally the only one there is.
 */
export const parseReferences = (headers) => {
  const chain = `${headers?.get('references') || ''} ${headers?.get('in-reply-to') || ''}`;
  return [...new Set(chain.match(MSG_ID) ?? [])];
};

/**
 * The two references worth caching: the first, which is the conversation's
 * root and is repeated by every message in it, and the last, which is the
 * message's own parent.
 *
 * A `References` header can carry twenty ids of forty characters each, and the
 * header index has to fit in a single key-value entry -- so keeping the whole
 * chain per message would be most of the payload. Root and parent are what
 * actually do the linking: the root joins a conversation even where the middle
 * of it was never delivered here, which is more than a parent chain manages.
 */
export const keyReferences = (references = []) =>
  (references.length <= 2
    ? [...references]
    : [...new Set([references[0], references[references.length - 1]])]);

// -- grouping ------------------------------------------------------------------

// The mailbox orders by day folder and filename, both of which sort
// chronologically as text. Threads are ordered the same way, so a conversation
// reads oldest to newest without anyone having to trust a Date header.
const sortKey = (message) => `${message.day ?? ''}/${message.name ?? ''}`;

/**
 * One conversation over a set of messages, oldest first -- which is reading
 * order, and the order the reader stacks them in.
 *
 * `id` is the oldest message's filename. Filenames are stable and a
 * conversation only ever grows at the newest end, so the id of a conversation
 * on screen does not change under it.
 */
export function makeThread(messages) {
  const ordered = [...messages].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const oldest = ordered[0];
  const latest = ordered[ordered.length - 1];
  return {
    id: oldest?.name ?? '',
    key: normalizeSubject(oldest?.subject ?? ''),
    messages: ordered,
    oldest,
    latest,
    // The subject as the conversation's first message wrote it. Not the
    // stripped form: for a conversation of one -- which most of them are --
    // the row has to say what the message says.
    subject: oldest?.subject ?? '',
    count: ordered.length,
  };
}

/** One conversation of one message, for the folders and views that don't thread. */
export const singleThread = (message) => makeThread([message]);

/** Add conversation history from other folders without merging unrelated subjects. */
export function conversationHistory(seeds, candidates, ownAddresses = new Set()) {
  const messages = [...seeds];
  const keys = new Set(seeds.map((message) => normalizeSubject(message.subject)));
  const ids = (message) => new Set([message.messageId, ...(message.references ?? [])].filter(Boolean));
  const people = (message) => new Set([message.from, ...(message.to ?? [])]
    .map((person) => person?.email?.toLowerCase()).filter((email) => email && !ownAddresses.has(email)));
  const knownPaths = new Set();
  const knownIds = new Set();
  const mentionedIds = new Set();
  const noReferences = { all: new Set(), replies: new Set() };
  const noId = { all: new Set(), replies: new Set() };
  const index = (message) => {
    if (message.path) knownPaths.add(message.path);
    if (message.messageId) knownIds.add(message.messageId);
    for (const id of ids(message)) mentionedIds.add(id);
    if (message.references?.length) return;
    for (const email of people(message)) {
      for (const group of message.messageId ? [noReferences] : [noReferences, noId]) {
        group.all.add(email);
        if (isReply(message.subject)) group.replies.add(email);
      }
    }
  };
  for (const message of messages) index(message);
  const related = (message) => {
    for (const id of ids(message)) if (mentionedIds.has(id)) return true;
    // A headerless original cannot be referenced. Keep the same fallback:
    // no references on either side, at least one missing id, a reply subject,
    // and a shared correspondent other than the account owner.
    if (message.references?.length) return false;
    const group = message.messageId ? noId : noReferences;
    const eligible = isReply(message.subject) ? group.all : group.replies;
    for (const email of people(message)) if (eligible.has(email)) return true;
    return false;
  };
  const seen = new Set(seeds.map((message) => message.messageId || message.path).filter(Boolean));
  let pending = candidates.filter((message) => {
    const id = message.messageId || message.path;
    if (!keys.has(normalizeSubject(message.subject)) || (id && seen.has(id))) return false;
    if (id) seen.add(id);
    return true;
  });
  for (;;) {
    const remaining = [];
    let added = false;
    for (const message of pending) {
      if ((message.path && knownPaths.has(message.path))
        || (message.messageId && knownIds.has(message.messageId))) continue;
      if (related(message)) {
        messages.push(message);
        index(message);
        added = true;
      } else remaining.push(message);
    }
    if (!added) return makeThread(messages).messages;
    pending = remaining;
  }
}

/**
 * Group a listing into conversations, newest conversation first.
 *
 * Three rules, in order of how much they can be trusted:
 *
 * 1. A message that references another message in the folder joins it --
 *    unless the subject changed, which Gmail treats as the start of something
 *    new and so does this.
 * 2. Two messages that reference the *same* id join each other, even when the
 *    message they both answer was never delivered here. This is what threads
 *    a conversation the middle of which is in another folder.
 * 3. Where neither of those linked anything, one subject with a reply among
 *    its messages is a conversation. This catches the clients that drop
 *    `References` -- and, just as importantly, does *not* catch two unrelated
 *    "Invoice" notices, because neither of those is a reply to anything.
 */
export function groupThreads(messages) {
  const parent = messages.map((unused, i) => i);
  const find = (i) => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    let walk = i;
    while (parent[walk] !== root) {
      const next = parent[walk];
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  // Whether a message was joined to anything by its headers, which is what
  // decides if rule 3 gets a say about it at all.
  const linked = messages.map(() => false);
  const union = (a, b) => {
    linked[a] = true;
    linked[b] = true;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const keys = messages.map((message) => normalizeSubject(message.subject ?? ''));

  // The first message holding each id. A duplicate id -- the same message
  // delivered twice -- is left pointing at one of them, which is enough to
  // join both.
  const owner = new Map();
  messages.forEach((message, i) => {
    if (message.messageId && !owner.has(message.messageId)) owner.set(message.messageId, i);
  });

  // Keyed by subject as well as id, so a reference shared under two different
  // subjects does not merge them. The two halves are joined by a NUL, which is
  // the one character neither a subject nor a message id can contain -- and it
  // is written as an escape rather than as the byte itself, because a literal
  // NUL in the source makes git call this file binary and stop diffing it.
  const mentions = new Map();
  messages.forEach((message, i) => {
    for (const reference of message.references ?? []) {
      const target = owner.get(reference);
      if (target !== undefined && target !== i && keys[target] === keys[i]) union(i, target);
      const shared = `${keys[i]}\u0000${reference}`;
      const first = mentions.get(shared);
      if (first === undefined) mentions.set(shared, i);
      else if (first !== i) union(first, i);
    }
  });

  const bySubject = new Map();
  messages.forEach((message, i) => {
    // A message with no subject at all has nothing to be grouped by: an empty
    // subject is not something two messages have in common.
    if (linked[i] || !keys[i]) return;
    const list = bySubject.get(keys[i]);
    if (list) list.push(i);
    else bySubject.set(keys[i], [i]);
  });
  for (const list of bySubject.values()) {
    if (list.length < 2) continue;
    if (!list.some((i) => isReply(messages[i].subject ?? ''))) continue;
    for (const i of list.slice(1)) union(list[0], i);
  }

  // The listing is newest first, so the first member seen of a conversation is
  // its latest message -- which means collecting them in listing order puts
  // the conversations themselves in newest-first order too, with no second
  // sort and no reliance on a Date header.
  const groups = new Map();
  messages.forEach((message, i) => {
    const root = find(i);
    const found = groups.get(root);
    if (found) found.push(message);
    else groups.set(root, [message]);
  });
  return [...groups.values()].map(makeThread);
}

// -- the quoted copy at the end of a reply --------------------------------------

/**
 * The line that introduces a quoted copy -- "On Tuesday, Jane wrote:" -- in
 * English and in the languages the common clients localise it to: German,
 * Dutch, the Nordic languages, French, Spanish, Portuguese and Italian. It
 * opens with the word those clients open it with and ends with the verb and
 * the colon the quote hangs off. `INTRODUCES` is the loose form, the verb and
 * the colon alone, for a line read on its own.
 */
const VERB = '(?:wrote|schrieb|schreef|skrev|a écrit|escribió|escreveu|ha scritto)';
const INTRODUCTION = new RegExp(`^\\s*(?:On|Am|Op|Den|Le|El|Em|Il)\\b[\\s\\S]*\\b${VERB}[^:]*:\\s*$`, 'i');
const INTRODUCES = new RegExp(`\\b${VERB}[^:]*:\\s*$`, 'i');

// The blank line between a message and the quote below it is separation
// rather than part of either, so neither half keeps it.
const cut = (lines, at) => ({
  text: lines.slice(0, at).join('\n').replace(/\s+$/, ''),
  quoted: lines.slice(at).join('\n').replace(/^\n+/, '').replace(/\s+$/, ''),
});

/**
 * Split off the copy of the previous message that a reply carries at the end
 * of itself. In a conversation view that copy is on screen twice: once as the
 * message above, and again inside every answer to it.
 *
 * Only a trailing block is taken, and only when there is a message left in
 * front of it -- a message that is nothing but a quote is shown whole, because
 * hiding it would leave nothing at all.
 */
export function splitQuotedTail(text = '') {
  const whole = String(text);
  const lines = whole.split('\n');

  // Outlook and Exchange fence the quoted copy off with a rule rather than
  // quoting its lines, so nothing below is marked as quoted at all.
  const fence = lines.findIndex((line) =>
    /^\s*(-{2,}\s*original message\s*-{2,}|_{10,})\s*$/i.test(line));
  if (fence > 0) {
    const split = cut(lines, fence);
    if (split.text.trim()) return split;
  }

  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  let start = end;
  let quoted = 0;
  while (start > 0) {
    const line = lines[start - 1];
    if (/^\s*>/.test(line)) {
      quoted++;
      start--;
      continue;
    }
    // A blank line inside the quote is part of it; one below the message is
    // not, which is why the count has to have started.
    if (!line.trim() && quoted) {
      start--;
      continue;
    }
    break;
  }
  // One quoted line is as likely to be a quotation the writer meant as it is
  // to be a copy of the message above.
  if (quoted < 2) return { text: whole, quoted: '' };
  // "On Tuesday, Jane wrote:" introduces the quote rather than being part of
  // what was written, and goes with it. Gmail wraps that line at 76 columns
  // -- the date and the name on one line, "wrote:" on the next -- and read
  // one line at a time, the date and the name were left dangling as the last
  // line of the message, over the fold that hid what they introduced. So up
  // to three lines above the quote, with no blank line among them, are read
  // together, and the longest run that reads as an introduction is taken.
  let intro = 0;
  for (let take = 1; take <= 3 && start - take >= 0; take++) {
    const block = lines.slice(start - take, start);
    if (!block[0].trim()) break;
    const joined = block.join(' ');
    if (INTRODUCTION.test(joined)) intro = take;
    else if (take === 1 && INTRODUCES.test(joined)) intro = 1;
  }
  start -= intro;

  const split = cut(lines, start);
  return split.text.trim() ? split : { text: whole, quoted: '' };
}
