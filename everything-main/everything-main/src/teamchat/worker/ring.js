/**
 * Ring entries on the worker side: the secret every conversation key is
 * derived from, the keys themselves, and sealing entries for worker/signal.js.
 *
 * A conversation's root key is HMAC(secret, workspace, conversation, epoch,
 * access). `access` is the private channel's member list, so a membership
 * change replaces its key on its own; the workspace epoch (`ws.ke`) is
 * bumped wherever someone loses access some other way (see bumpRingEpoch).
 * Nothing per conversation is stored, so every conversation, old or new,
 * has a key as soon as the secret exists.
 */
import { KEYS, parentOfThread } from '../src/shared/blocks.js';
import { evRingShard } from '../src/shared/events.js';
import { b64urlDecode, b64urlEncode, ringKeysFrom, sealEntry, threadTag } from '../src/shared/ring.js';
import { kv, serverConfig, setServerConfig, resetServerConfigCache } from './lib.js';

const SECRET_LOCK = 'tc:evs:lock';

/** A sealed entry this long (base64url characters) is sent without its message body or patch; Events drops values past 16 KB. */
export const RING_ENTRY_MAX = 12_000;

/**
 * The secret, created once per worker. The config is read afresh first (an
 * isolate's cached copy may predate the secret, and writing a second one
 * would orphan every key already handed out), then creation is claimed with
 * incr, so two first requests at once cannot each write their own; one that
 * loses reads the config again, and gets null (no ring entries this time) if
 * the winner's write has not landed.
 */
export async function ringSecret() {
  const cfg = await serverConfig();
  if (typeof cfg.evs === 'string' && cfg.evs) return cfg.evs;
  resetServerConfigCache();
  const fresh = await serverConfig();
  if (typeof fresh.evs === 'string' && fresh.evs) return fresh.evs;
  const claim = await kv().incr(SECRET_LOCK).catch(() => 0);
  if (claim === 1) {
    await kv().expire(SECRET_LOCK, 60).catch(() => {});
    const evs = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    await setServerConfig({ evs });
    return evs;
  }
  resetServerConfigCache();
  const again = await serverConfig();
  return typeof again.evs === 'string' && again.evs ? again.evs : null;
}

/** Who may read a conversation, as far as its key goes, or null for one that has no key (not a channel or DM of this workspace). */
function accessOf(ws, base) {
  if (base.startsWith('dm_')) return 'd';
  const ch = ws.channels && Object.hasOwn(ws.channels, base) ? ws.channels[base] : null;
  if (!ch) return null;
  if (!ch.private) return 'o';
  return `p:${[...new Set(ch.members || [])].sort().join(',')}`;
}

// A bootstrap derives a key for every conversation its caller reads, so
// both the imported secret and the derived roots are kept for the isolate.
const rootCache = new Map();
const ROOT_CACHE_MAX = 2000;
let secretKey = { secret: null, key: null };
const enc = new TextEncoder();

function importedSecret(secret) {
  if (secretKey.secret !== secret) {
    secretKey = { secret, key: crypto.subtle.importKey('raw', b64urlDecode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) };
  }
  return secretKey.key;
}

/** The root key of a conversation (a thread's is its parent's), base64url, or null when it has none. */
export async function rootKeyFor(ws, conv, secret) {
  const base = parentOfThread(conv)?.conv || conv;
  const access = accessOf(ws, base);
  if (!access || !secret) return null;
  const input = `tcr1|${ws.id}|${base}|${Number(ws.ke) || 0}|${access}`;
  const cacheKey = `${secret}|${input}`;
  const hit = rootCache.get(cacheKey);
  if (hit) return hit;
  const root = b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', await importedSecret(secret), enc.encode(input))));
  if (rootCache.size >= ROOT_CACHE_MAX) rootCache.delete(rootCache.keys().next().value);
  rootCache.set(cacheKey, root);
  return root;
}

/** Root keys for the bootstrap: `{ conv: root }` for each conversation given, or null without a secret. */
export async function ringKeysFor(ws, convs) {
  const secret = await ringSecret().catch(() => null);
  if (!secret) return null;
  const roots = await Promise.all(convs.map((conv) => rootKeyFor(ws, conv, secret)));
  const out = {};
  convs.forEach((conv, i) => { if (roots[i]) out[conv] = roots[i]; });
  return out;
}

/**
 * The bootstrap's `ring` block, beside its `events` block (which it leaves
 * as it was, for clients from before ring entries): the member's ring shard
 * `rs`, the shard's entry counter `rn` as read with the activity document
 * (`counters`, the evCounter document), the workspace epoch `ke`, and the
 * root key of every conversation in `convs`. `okey`/`rkey` name the keys to
 * watch in `own` mode; through a handle they are `o{rs}` and `r{rs}:*`.
 * Null without an `events` block, or without a secret to derive keys from.
 */
export async function ringBlock(ws, uuid, events, convs, counters = null) {
  if (!events) return null;
  const ek = await ringKeysFor(ws, convs);
  if (!ek) return null;
  const rs = evRingShard(uuid);
  const out = { rs, rn: Number(counters?.[`s${rs}`]) || 0, ke: Number(ws.ke) || 0, ek };
  if (events.mode === 'own') {
    out.okey = KEYS.evPing(ws.id, rs);
    out.rkey = KEYS.evRingPrefix(ws.id, rs);
  }
  return out;
}

/** The caller's ring counter for a sync answer, from the evCounter document read beside the activity document. */
export function ringCount(counters, uuid) {
  return Number(counters?.[`s${evRingShard(uuid)}`]) || 0;
}

/**
 * Seal ring entries (`{ conv, body, slim? }`): `[{ g, d, e }]`, one per
 * entry, or null when any of them cannot be sealed, since a ring write that
 * carries only part of a change would leave the rest unannounced. `slim` is
 * what goes instead of `body` when the sealed body would be too large.
 */
export async function sealEntries(ws, entries) {
  const secret = await ringSecret();
  if (!secret) return null;
  const e = Number(ws.ke) || 0;
  const out = [];
  for (const entry of entries) {
    const root = await rootKeyFor(ws, entry.conv, secret);
    if (!root) return null;
    const { tag, aes } = await ringKeysFrom(root);
    const thread = parentOfThread(entry.conv);
    const g = thread ? threadTag(tag, thread.seq) : tag;
    let d = await sealEntry(aes, g, entry.body);
    if (d.length > RING_ENTRY_MAX) d = await sealEntry(aes, g, entry.slim || { a: entry.body.a });
    out.push({ g, d, e });
  }
  return out;
}

/**
 * Replace every conversation key of a workspace: for someone losing access
 * other than by a private channel's member list (removed from the workspace,
 * a guest leaving a public channel, a role taken down). Every member's next
 * bootstrap carries the new keys; callers bump the workspace stamp, which
 * brings that bootstrap.
 */
export async function bumpRingEpoch(wsId) {
  await kv().incr(KEYS.ws(wsId), { ke: 1 });
}
