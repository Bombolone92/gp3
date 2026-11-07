import { REACTIONS } from "../facilitation/model.js";
import { validSession } from "./attention.js";

// Live reactions and raised hands are carried by authenticated peer
// packets, never by the board document or drawing history: a reaction is
// shown for a moment and gone, and a hand stays up only while its owner is
// on the board. Reactions use the same eight kinds as reactions on objects
// and comments.
export const LIVE_REACTIONS = REACTIONS.map(([type]) => type);
// A packet whose time is further than this from the receiver's clock is
// refused, as views are.
const SKEW = 15000;
// A person sends at most three reactions in any second. Others take up to
// five, as reactions sent a second apart can arrive together, and drop the
// rest, which relays then do not pass on either.
export const SEND_LIMIT = 3,
  RECEIVE_LIMIT = 5;

// A reaction as received, or null. Fields a later version may add are left
// out rather than refused.
export function readReaction(data, now) {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    !LIVE_REACTIONS.includes(data.type) ||
    !Number.isSafeInteger(data.at) ||
    Math.abs(now - data.at) > SKEW
  )
    return null;
  return { type: data.type, at: data.at };
}

// Counts each person's packets of one kind over the last second, to refuse
// those beyond a limit. People who stopped sending are forgotten first once
// many are kept, as in a room of hundreds.
export class Pace {
  constructor(limit, span = 1000) {
    this.limit = limit;
    this.span = span;
    this.times = new Map();
  }
  take(key, now = Date.now()) {
    const recent = (this.times.get(key) || []).filter(
      (time) => now - time < this.span && time <= now,
    );
    this.times.delete(key);
    if (recent.length >= this.limit) {
      this.times.set(key, recent);
      return false;
    }
    recent.push(now);
    this.times.set(key, recent);
    if (this.times.size > 512)
      this.times.delete(this.times.keys().next().value);
    return true;
  }
}

// A facilitator's request to lower one session's hand, or everyone's, as
// received, or null. Hands raised after its time stay up.
export function readLower(data, now) {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    (data.lower !== "all" && !validSession(data.lower)) ||
    !Number.isSafeInteger(data.at) ||
    Math.abs(now - data.at) > SKEW
  )
    return null;
  return { lower: data.lower, at: data.at };
}

// Raised hands in the order they went up, one per person on the board: a
// person with several tabs counts once, from the hand raised first, with
// every tab whose hand is up so lowering it lowers them all. `self` is
// this tab, whose own hand is not among the views.
export function raisedHands(views, roster, self) {
  const present = new Map(roster.map((p) => [p.session, p]));
  const people = new Map();
  const add = (session, hand) => {
    const person = present.get(session);
    if (!person || !hand) return;
    const key = person.user ?? session;
    const entry = people.get(key);
    if (!entry)
      people.set(key, {
        ...person,
        hand,
        sessions: [session],
        self: !!self && person.user === present.get(self.session)?.user,
      });
    else {
      entry.sessions.push(session);
      if (hand < entry.hand) Object.assign(entry, person, { hand });
    }
  };
  for (const [session, view] of views) add(session, view.hand);
  if (self) add(self.session, self.hand);
  return [...people.values()].sort(
    (a, b) => a.hand - b.hand || (a.session < b.session ? -1 : 1),
  );
}
