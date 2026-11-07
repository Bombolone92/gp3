/**
 * Huddles: a live audio (and, when wanted, video and screen) call inside a
 * channel or direct message. Shared by the worker, which
 * keeps who is in one, and the client, which carries the media.
 *
 * The worker holds nothing but a roster. A huddle in conversation `conv` is
 * `act.h[conv] = { by, at, m: { [uuid]: { at, j, inv, s } } }` in the
 * workspace's activity document: who started it and when, and for each
 * participant their last heartbeat (`at`), when they joined (`j`), the
 * invite code of the Puter Peer server they are running (`inv`), and a
 * session id of the tab holding the seat (`s`, kept on the worker alone: a
 * heartbeat from another tab of the same account does not take the seat
 * back from the tab that joined last). Media never touches the worker:
 * every participant serves their own peer and the others dial it, so the
 * roster is the whole directory a newcomer needs.
 *
 * A participant that has not been heard from for HUDDLE_TTL_MS has left
 * (their tab closed, their network went); the poll that notices prunes
 * them, and a huddle whose every participant is gone is over.
 */

/**
 * A participant not heard from for this long has left. Longer than a
 * minute on purpose: a browser aligns the timers of a tab hidden for a few
 * minutes to one wake-up a minute unless the tab holds a live WebRTC
 * connection, and a participant alone in a huddle holds none, so their
 * heartbeat then comes once a minute; a shorter bound would take them out
 * and end the huddle between beats, and the next beat would start it again,
 * with a line in the conversation each time.
 */
export const HUDDLE_TTL_MS = 90_000;
/** How often a participant re-posts their presence in the huddle. */
export const HUDDLE_HEARTBEAT_MS = 15_000;
/**
 * People one huddle holds. Media flows in a full mesh, so each participant
 * sends their audio to everyone else; twenty is where that stays comfortable
 * on an ordinary uplink.
 */
export const HUDDLE_MAX = 20;
/** An invite code from puter.peer.serve() (`NJ-7F3A9C`), or a room name; nothing else is written. */
export const INVITE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
/** A tab's session id for its seat, made by the client; nothing else is written. */
export const SESSION_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** One roster entry as stored, with only its live participants; null when nobody is left. */
export function liveHuddle(entry, now = Date.now()) {
  if (!entry || typeof entry !== 'object' || !entry.m || typeof entry.m !== 'object') return null;
  const m = {};
  for (const [uuid, p] of Object.entries(entry.m)) {
    if (!p || typeof p.at !== 'number' || now - p.at >= HUDDLE_TTL_MS) continue;
    m[uuid] = { at: p.at, j: typeof p.j === 'number' ? p.j : p.at, inv: typeof p.inv === 'string' ? p.inv : '' };
  }
  if (!Object.keys(m).length) return null;
  return { by: typeof entry.by === 'string' ? entry.by : null, at: typeof entry.at === 'number' ? entry.at : null, m };
}

/** Every live huddle in the activity document's `h` map, by conversation. */
export function liveHuddles(h, now = Date.now()) {
  const out = {};
  for (const [conv, entry] of Object.entries(h || {})) {
    const live = liveHuddle(entry, now);
    if (live) out[conv] = live;
  }
  return out;
}

/**
 * What a poll should tidy: `drop`, the paths of participants who have gone
 * quiet in huddles that carry on, and `ended`, the conversations whose
 * huddle has nobody live left (the whole entry goes, and the huddle is over).
 */
export function stalePaths(h, now = Date.now()) {
  const drop = [];
  const ended = [];
  for (const [conv, entry] of Object.entries(h || {})) {
    if (!entry || typeof entry !== 'object') {
      ended.push(conv);
      continue;
    }
    const live = liveHuddle(entry, now);
    if (!live) {
      ended.push(conv);
      continue;
    }
    for (const uuid of Object.keys(entry.m || {})) if (!live.m[uuid]) drop.push(`h.${conv}.m.${uuid}`);
  }
  return { drop, ended };
}

/**
 * Who dials whom when two participants both know about each other: the one
 * with the greater id. A newcomer dials everyone already listed regardless;
 * this settles the rest (a peer whose link was lost, one discovered on a
 * poll) and breaks the tie when both dial at once: the connection dialled
 * by the greater id is the one kept.
 */
export function shouldDial(me, peer) {
  return String(me) > String(peer);
}

/** "Ana is in a huddle", "Ana and Ben are in a huddle", "Ana, Ben, and 2 others are in a huddle". */
export function huddleLine(names) {
  if (!names.length) return 'Huddle in progress';
  if (names.length === 1) return `${names[0]} is in a huddle`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are in a huddle`;
  if (names.length === 3) return `${names[0]}, ${names[1]}, and ${names[2]} are in a huddle`;
  return `${names[0]}, ${names[1]}, and ${names.length - 2} others are in a huddle`;
}

/** A duration for the "huddle ended" line: "less than a minute", "12 min", "1 hr 5 min". */
export function durationText(ms) {
  const minutes = Math.round(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}
