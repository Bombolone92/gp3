/**
 * The address book this app already had without knowing it.
 *
 * Every message the list has read is in the header index (search.js) with its
 * sender's name and address and its recipients', with the message's date
 * beside them, and with the messages this account sent marked as such. That
 * is an address book: who has written, who has been written to, and when it
 * last happened.
 * Nothing here reads a message, asks the network for anything, or stores
 * anything that was not being stored already; it is a second question asked of
 * a cache that was built to answer the first.
 *
 * Everything is a pure function over the flat list `index.addresses()` hands
 * over, so what a keystroke offers is tested here rather than through a
 * dropdown.
 */

// Six is what fits under the field without covering the message below it, and
// is about as far as anyone reads before typing another character.
export const SUGGESTION_LIMIT = 6;

const lower = (value) => String(value ?? '').trim().toLowerCase();

/**
 * One entry per address out of the flat list, newest and closest first.
 *
 * `written` is the difference between someone who has been sent a message and
 * someone who has merely sent one, and it is the strongest signal here: a
 * mailing list has written to you two hundred times and is never who you meant
 * to type, while an address you have written to even once is, by definition,
 * one you have chosen before. Only the recipients of mail this account sent
 * carry the flag: received mail has a To line too, with the reader's own
 * address on every message, and that is not anyone they wrote to.
 *
 * A name is taken from the most recent appearance that *had* one rather than
 * simply the most recent: plenty of mail carries a bare address, and letting
 * one of those erase a name already learned would make a contact flicker
 * between the two as mail arrives. A "name" that is just the address again is
 * no name, and is not recorded as one.
 */
export function mergeContacts(addresses = []) {
  const byEmail = new Map();

  for (const address of addresses ?? []) {
    const email = lower(address?.email);
    // Anything that is not an address is not a contact. The index holds what
    // the headers held, and a header can hold anything.
    if (!email.includes('@')) continue;

    const seconds = Number.isFinite(Number(address?.seconds)) ? Number(address.seconds) : 0;
    const name = String(address?.name ?? '').trim();
    const named = name && lower(name) !== email ? name : '';
    const written = address?.written === true;

    const held = byEmail.get(email);
    if (!held) {
      byEmail.set(email, {
        email,
        name: named,
        seconds,
        count: 1,
        written,
        // Not part of the answer -- only of how the name was chosen.
        nameSeconds: named ? seconds : -Infinity,
      });
      continue;
    }
    held.count++;
    held.written = held.written || written;
    if (seconds > held.seconds) held.seconds = seconds;
    if (named && seconds >= held.nameSeconds) {
      held.name = named;
      held.nameSeconds = seconds;
    }
  }

  return [...byEmail.values()]
    .map(({ nameSeconds, ...contact }) => contact)
    .sort(byRank);
}

/**
 * Which of two equally good matches to offer first. Written-to before
 * written-from, then how often, then how recently -- and the address itself
 * last, so the order is total and a rebuild of the same index cannot shuffle
 * it.
 */
const byRank = (a, b) =>
  Number(b.written) - Number(a.written)
  || b.count - a.count
  || b.seconds - a.seconds
  || (a.email < b.email ? -1 : a.email > b.email ? 1 : 0);

/**
 * How well a contact answers what has been typed, or -1 for not at all.
 *
 * A prefix is worth more than a match in the middle, because a prefix is what
 * someone typing a name or an address is producing. Three things count as one:
 * the address from its start, any word of the display name, and the domain --
 * typing a company name to reach the people at it is a real way to use this,
 * and one that a plain substring match would bury under every unrelated
 * address that happens to contain the letters.
 */
const matchTier = (contact, needle) => {
  const name = lower(contact.name);
  const domain = contact.email.slice(contact.email.indexOf('@') + 1);
  const words = name ? name.split(/[\s,.'"<>()-]+/).filter(Boolean) : [];
  if (contact.email.startsWith(needle)
    || domain.startsWith(needle)
    || words.some((word) => word.startsWith(needle))) return 2;
  if (contact.email.includes(needle) || name.includes(needle)) return 1;
  return -1;
};

/**
 * The contacts to offer for what has been typed, best first.
 *
 * `exclude` is the addresses the field already holds: a name already on the
 * message is not a suggestion, and offering it invites a second chip that the
 * field would only collapse again.
 *
 * An empty query matches everything, which is what makes this the same
 * function whether the caller wants "who might this be" or simply "who do I
 * write to" -- the ranking is the answer in both cases.
 */
export function rankContacts(contacts = [], query = '', {
  limit = SUGGESTION_LIMIT, exclude = [],
} = {}) {
  const needle = lower(query);
  const taken = new Set((exclude ?? []).map(lower).filter(Boolean));

  return (contacts ?? [])
    .filter((contact) => contact && !taken.has(lower(contact.email)))
    .map((contact) => ({ contact, tier: needle ? matchTier(contact, needle) : 0 }))
    .filter(({ tier }) => tier >= 0)
    .sort((a, b) => b.tier - a.tier || byRank(a.contact, b.contact))
    .slice(0, Math.max(0, limit))
    .map(({ contact }) => contact);
}
