/**
 * Wake whoever might care that a workspace just changed. `audience` is null
 * for the whole workspace (every shard gets a write) or an array of member
 * uuids (only their shards do); either way the write lands as one small
 * document per shard, batched into a single kv().set call, so a
 * broadcast-sized audience costs one call rather than up to EV_SHARDS. A
 * signal is a courtesy on top of the write that produced it, never part of
 * its correctness (a subscriber that misses it still catches up on the next
 * safety poll), so a failure here is swallowed rather than allowed to fail
 * that write.
 *
 * Two kinds of subscriber read these writes. A client from before ring
 * entries watches `s{n}` (EV_SHARDS) and polls on every write there, which
 * every signal still makes. A client that reads ring entries watches
 * `r{n}:*` and `o{n}` (EV_RING_SHARDS) instead: `entries` (`{ conv, body,
 * slim? }`, see worker/ring.js) are sealed into its audience's ring shards,
 * and `o{n}` is written only for what they do not carry — every shard of the
 * audience when there are no entries, one of them is null, or they could
 * not be written, and otherwise only the shards of `others` (members whose
 * own documents the same change moved; null for every shard).
 *
 * Gated first on whether anything could possibly be watching: on every
 * deployment today (Events off in most regions, KV share handles nowhere),
 * writing shard documents nobody can subscribe to would be a pure cost
 * regression the feature is supposed to avoid.
 */
import { KEYS } from '../src/shared/blocks.js';
import { EV_SHARDS, evShard, EV_RING_SHARDS, evRingShard, RING_SLOTS } from '../src/shared/events.js';
import { kv, serverConfig } from './lib.js';
import { workerAppUid } from './events.js';
import { sealEntries } from './ring.js';

/**
 * The one cached verdict that means nobody at all can watch: `events.enabled`
 * itself is off in this worker's region, which blocks even the owner's own
 * direct subscription (mode: 'own', see eventsBlock), not only a member's
 * handle. Every other refusal (kv handles off, consent missing, the mint
 * budget, a rate limit) only ever blocks *members* — the owner's own
 * subscription still works, so signalling must keep going for their sake,
 * which is the whole point of the owners-first rollout step.
 */
const TERMINAL_CODE = 'events_disabled';

const allShards = (count) => Array.from({ length: count }, (_, n) => n);
const shardsOf = (uuids, fn) => [...new Set(uuids.map((u) => fn(u)))];

export async function signal(wsId, audience = null, { entries = null, ws = null, others = undefined } = {}) {
  try {
    // A user-scoped worker (see workerAppUid) has no namespace anything can
    // watch: the owner's browser lands in a different app-scoped namespace,
    // and a member's handle would be minted against os-global, which the
    // platform's app-binding check can never match.
    if (!workerAppUid()) return;
    const cfg = await serverConfig(); // in-process cached; at most one KV read per cold isolate
    const verdict = cfg.ev;
    // A verdict yet to be recorded (nobody has probed this worker yet) is
    // not evidence of anything: signal optimistically, and let the first
    // bootstrap or mint attempt record the real answer within seconds.
    if (verdict && verdict.why === TERMINAL_CODE && verdict.until > Date.now()) return;
    const shards = audience === null ? allShards(EV_SHARDS) : shardsOf(audience, evShard);
    const ringShards = audience === null ? allShards(EV_RING_SHARDS) : shardsOf(audience, evRingShard);
    if (!shards.length) return;
    // A null entry is a change its caller could not describe: the whole
    // signal then goes out as a plain one.
    const slots = entries?.length && entries.every(Boolean) ? await ringSlots(wsId, ws, entries, ringShards).catch(() => null) : null;
    let pings = ringShards;
    if (slots) pings = others === null ? allShards(EV_RING_SHARDS) : shardsOf(others || [], evRingShard);
    const t = Date.now();
    await kv().set([
      ...(slots || []),
      ...pings.map((n) => ({ key: KEYS.evPing(wsId, n), value: { t } })),
      ...shards.map((n) => ({ key: KEYS.evShard(wsId, n), value: { t } })),
    ]);
  } catch {
    /* a signal rides on top of the write that produced it, and must never fail it */
  }
}

/**
 * The slot writes carrying `entries` to each of `ringShards`, numbered from
 * each shard's own counter (one incr for every shard), or null when the
 * entries cannot be sealed.
 */
async function ringSlots(wsId, ws, entries, ringShards) {
  if (!ringShards.length) return null;
  const doc = ws || (await kv().get(KEYS.ws(wsId)));
  if (!doc) return null;
  const sealed = await sealEntries(doc, entries);
  if (!sealed?.length) return null;
  const counters = await kv().incr(KEYS.evCounter(wsId), Object.fromEntries(ringShards.map((n) => [`s${n}`, sealed.length])));
  const out = [];
  for (const n of ringShards) {
    const top = Number(counters?.[`s${n}`]);
    if (!Number.isFinite(top) || top < sealed.length) return null;
    sealed.forEach((s, i) => {
      const num = top - sealed.length + 1 + i;
      out.push({ key: KEYS.evRingSlot(wsId, n, num % RING_SLOTS), value: { n: num, ...s } });
    });
  }
  return out;
}
