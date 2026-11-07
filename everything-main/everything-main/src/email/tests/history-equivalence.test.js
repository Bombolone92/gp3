import { it, expect } from 'vitest';
import { conversationHistory, normalizeSubject, isReply, makeThread } from '../src/lib/thread.js';

// Frozen pairwise reference from bb3990e. Differential cases exercise the
// subtle fallback rules and duplicate-path discovery order, not just speed.
function referenceHistory(seeds, candidates, ownAddresses = new Set()) {
  const messages = [...seeds];
  const keys = new Set(seeds.map((message) => normalizeSubject(message.subject)));
  const ids = (message) => new Set([message.messageId, ...(message.references ?? [])].filter(Boolean));
  const people = (message) => new Set([message.from, ...(message.to ?? [])]
    .map((person) => person?.email?.toLowerCase()).filter((email) => email && !ownAddresses.has(email)));
  const related = (a, b) => {
    const aIds = ids(a);
    if ([...ids(b)].some((id) => aIds.has(id))) return true;
    // A headerless original cannot be referenced. Require a common correspondent
    // as well as a reply subject, and never override conflicting reference chains.
    if ((a.references?.length || b.references?.length) || (a.messageId && b.messageId)) return false;
    return (isReply(a.subject) || isReply(b.subject))
      && [...people(a)].some((email) => people(b).has(email));
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
      if (messages.some((known) => (message.path && known.path === message.path)
        || (message.messageId && known.messageId === message.messageId))) continue;
      if (messages.some((known) => related(known, message))) {
        messages.push(message);
        added = true;
      } else remaining.push(message);
    }
    if (!added) return makeThread(messages).messages;
    pending = remaining;
  }
}


it('preserves pairwise history semantics across reference chains and headerless replies', () => {
  let seed = 12345;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let run = 0; run < 200; run++) {
    const messages = Array.from({ length: 40 }, (_, i) => ({
      name: String(i).padStart(3, '0'), day: '2026-09-17', path: `/mail/${random(30)}`,
      subject: ['Topic', 'Re: Topic', 'Other', 'Re: Other', ''][random(5)],
      messageId: random(3) ? `<${random(30)}>` : '',
      references: random(3) ? [] : [`<${random(30)}>`, `<${random(30)}>`],
      from: { email: ['a@test', 'b@test', 'owner@test'][random(3)] },
      to: [{ email: ['A@test', 'c@test', 'owner@test'][random(3)] }],
    }));
    const seeds = messages.slice(0, 2);
    const own = new Set(['owner@test']);
    expect(conversationHistory(seeds, messages, own)).toEqual(referenceHistory(seeds, messages, own));
  }
});

it('keeps every message and its order in a large shared-reference history', () => {
  const messages = Array.from({ length: 10000 }, (_, i) => ({
    name: String(i).padStart(6, '0'), path: `/mail/${i}`, subject: 'Topic',
    messageId: `<${i}>`, references: i ? ['<0>'] : [],
  }));
  expect(conversationHistory([messages[0]], [...messages].reverse())).toEqual(messages);
});
