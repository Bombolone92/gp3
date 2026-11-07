import { readView, validCamera, validSession } from "./attention.js";
import { decodeUpdate, mergeUpdates } from "yjs";
import { SharedDocument, LOCAL, REPAIR, rebase } from "./document.js";
import { PeerNetwork } from "./peers.js";
import {
  ASSET,
  canComment,
  canEditContent,
  encode,
  decode,
  hash,
  keyPair,
  verify,
} from "./protocol.js";
import { call } from "./api.js";
import { local } from "../storage.js";
// Encoded update characters the worker accepts in one commit, and a batch
// size below it so merged edits always fit.
const UPDATE_LIMIT = 8_000_000,
  BATCH_SIZE = 6_000_000;

// Queued edits are stored by content hash, so the browser returns them in
// no useful order. Each carries the order it was made in, because the worker
// refuses a batch that builds on edits it has not received yet.
let lastSequence = 0;
const sequence = () => (lastSequence = Math.max(Date.now(), lastSequence + 1));
function queued(rows) {
  const updates = rows.filter((row) => row.kind === "update");
  // Rows saved before sequence numbers follow their Yjs clock instead.
  const clock = (row) => {
    try {
      return decodeUpdate(decode(row.update)).structs[0]?.id.clock ?? Infinity;
    } catch {
      return Infinity;
    }
  };
  const keyed = updates.map((row) => [row.seq ?? 0, clock(row), row]);
  keyed.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return [
    ...rows.filter((row) => row.kind !== "update"),
    ...keyed.map((entry) => entry[2]),
  ];
}

export class CollaborationSession {
  constructor({
    puter,
    server,
    room,
    user,
    changed,
    activity,
    status,
    viewChanged = () => {},
    attention = () => {},
    rejected = () => {},
    store = local,
  }) {
    Object.assign(this, {
      puter,
      server,
      room,
      user,
      changed,
      activity,
      status,
      viewChanged,
      attention,
      rejected,
      store,
    });
    // What this session last showed, for a save with nothing to upload.
    this.status = (text) => {
      this.shown = text;
      status(text);
    };
    this.scope = `${server}|${room}|${user.uuid}`;
    this.session = crypto.randomUUID();
    this.shared = new SharedDocument(undefined, { merge: true });
    this.assets = new Map();
    this.assetDownloads = new Map();
    this.assetIds = new Map();
    this.pendingAssets = new Set();
    this.pending = new Map();
    this.people = new Map();
    this.views = new Map();
    this.attentionSequence = new Map();
    this.endedViews = new Set();
    this.lastAction = new Map();
    this.queue = Promise.resolve();
    this.closed = false;
    this.readOnly = true;
    // readOnly already blocks content until a role is known.
    this.contentReadOnly = false;
    this.localWrites = 0;
  }
  // readOnly blocks every write. Commenters may still write comments, so the
  // editor separately checks contentReadOnly before changing board content.
  // An archived board is read-only for everyone but administrators, whatever
  // their role on it.
  applyRole(role, archived = false) {
    const wasReadOnly = this.readOnly;
    this.role = role;
    this.denied = false;
    this.readOnly = archived || !canComment(role);
    this.contentReadOnly = archived || !canEditContent(role);
    // Uploads stop while read-only; send what waited once access returns.
    if (wasReadOnly && !this.readOnly && this.poll && this.pending.size)
      this.scheduleFlush();
  }
  async connectPeers() {
    if (!this.puter.peer?.serve || this.peers || this.closed) return;
    const peers = (this.peers = new PeerNetwork({
      puter: this.puter,
      room: this.room,
      session: this.session,
      keys: this.keys,
      roomKey: this.publicKey,
      receive: (...args) => this.receive(...args),
      changed: () => this.heartbeat().catch(() => {}),
      now: () => this.now(),
    }));
    await peers.serve().catch(() => {});
    if (this.closed || this.peers !== peers) peers.close();
  }
  async request(op, data = {}) {
    const started = performance.now();
    const result = await call(this.puter, this.server, {
      op,
      room: this.room,
      ...data,
    });
    const received = performance.now(),
      elapsed = received - started;
    // The quickest round trip gives the best estimate of the server's clock:
    // a slow one, such as a sync that loads the board and sends it back,
    // can put it seconds out, and the shared timer with it. A sample a few
    // minutes old gives way so the estimate follows drift, and so does one
    // this reply shows to be further out than its own uncertainty, as after
    // the device slept, when the monotonic clock may not have advanced.
    const estimate = result.serverTime + elapsed / 2;
    if (
      Number.isSafeInteger(result.serverTime) &&
      result.serverTime > 0 &&
      elapsed < 10000 &&
      (!this.clock ||
        elapsed <= this.clock.elapsed ||
        received - this.clock.monotonic > 300_000 ||
        Math.abs(estimate - this.now()) > elapsed / 2 + 1000)
    )
      this.clock = { server: estimate, monotonic: received, elapsed };
    return result;
  }
  now() {
    return this.clock
      ? this.clock.server + performance.now() - this.clock.monotonic
      : Date.now();
  }
  async start(token) {
    try {
      return await this.connect(token);
    } catch (error) {
      // Before the outbox listener and timers exist, a partial start must not
      // leave subscriptions or peer links that can make the session writable.
      // Later failures (the initial upload) recover through the running timers.
      if (!this.poll) this.close();
      throw error;
    }
  }
  async connect(token) {
    if (this.closed) return;
    const joined = await this.request("join", { token });
    if (this.closed) return;
    this.applyRole(joined.member.role, joined.archived);
    this.eventDescriptor = joined.events;
    this.settings = joined.settings || null;
    this.guest = !!joined.member.guest;
    this.publicKey = joined.publicKey;
    const rows = await this.store.collaborationRows(this.scope);
    if (this.closed) return;
    for (const row of queued(rows)) {
      if (row.kind === "asset") {
        this.assets.set(row.asset, row.data);
        this.assetIds.set(row.data, row.asset);
        if (row.pending) this.pendingAssets.add(row.asset);
      }
      if (row.kind === "snapshot")
        this.shared.apply(decode(row.update), "load");
      if (row.kind === "update") {
        this.shared.apply(decode(row.update), "load");
        this.pending.set(row.digest, row);
      }
    }
    this.keys = await keyPair();
    if (this.closed) return;
    await this.connectPeers();
    if (this.closed) return;
    await this.subscribe();
    if (this.closed) return;
    await this.synchronize();
    if (this.closed) return;
    await this.heartbeat();
    if (this.closed) return;
    this.track();
    // Large rooms check in less often so the board's worker stays within its
    // storage request quota; peers still carry live edits between check-ins.
    // Presence expires after SESSION_TTL, only two check-ins apart in a large
    // room, so a check-in that fails is tried again soon until one succeeds.
    const checkIn = () =>
      this.heartbeat().catch((e) => {
        this.failure(e);
        const refused = e?.status >= 400 && e.status < 500 && e.status !== 429;
        if (this.closed || refused || this.checkInTimer) return;
        this.checkInTimer = setTimeout(
          () => {
            this.checkInTimer = null;
            if (!this.closed) checkIn();
          },
          8000 + Math.random() * 4000,
        );
      });
    const beat = () => {
      this.poll = setTimeout(
        () => {
          if (this.closed) return;
          checkIn();
          this.synchronize().catch((e) => this.failure(e));
          this.flush().catch((e) => this.failure(e));
          beat();
        },
        ((this.roster?.length || 0) > 30 ? 40000 : 20000) +
          Math.random() * 5000,
      );
    };
    beat();
    this.viewPulse = setInterval(() => this.broadcastView(), 3000);
    // Others forget a participant's selection 10 seconds after their last
    // update, and an object's live position during a drag after 2.5
    // seconds; repeat them while someone keeps an object selected or open,
    // or holds it still mid-drag.
    this.presencePulse = setInterval(() => this.pulsePresence(), 1000);
    this.expire = setInterval(() => {
      let viewsChanged = false;
      for (const [id, v] of this.views)
        if (Date.now() - v.received > 12000) {
          this.views.delete(id);
          viewsChanged = true;
        }
      if (viewsChanged) this.viewChanged(this.views, this.roster || []);
      for (const [id, p] of this.people)
        if (Date.now() - p.at > 10000) this.people.delete(id);
      this.activity(this.people, this.roster || []);
    }, 2000);
    this.online = () => {
      this.heartbeat().catch((e) => this.failure(e));
      this.synchronize().catch((e) => this.failure(e));
      this.flush().catch((e) => this.failure(e));
    };
    globalThis.addEventListener?.("online", this.online);
    globalThis.document?.addEventListener("visibilitychange", this.online);
    // Joined, synchronized and checking in: live features work even if
    // uploading edits queued offline fails now and is retried later.
    this.connected = true;
    await this.flush();
    if (this.closed) return;
    return joined;
  }
  // Record this browser's document changes in the outbox before uploading.
  track() {
    const shared = this.shared;
    shared.doc.on("update", (update, origin) => {
      if (origin !== LOCAL && origin !== REPAIR && origin !== shared.undo)
        return;
      this.localWrites++;
      this.written = (this.written || 0) + 1;
      this.status("Saving shared changes…");
      this.queue = this.queue
        .then(async () => {
          // Rejection recovery replaced this document and discarded its edits.
          if (this.shared !== shared) return;
          const digest = await hash(update),
            value = encode(update);
          const row = {
            id: `${this.scope}|op:${digest}`,
            scope: this.scope,
            kind: "update",
            digest,
            update: value,
            seq: sequence(),
          };
          this.pending.set(digest, row);
          // Rows are replayed over the snapshot on reload, so the full
          // snapshot is rewritten after uploads rather than per keystroke.
          await this.store.collaborationPut(row);
          this.recoveryFailed = false;
        })
        .catch(() => {
          this.recoveryFailed = true;
          this.status("Local recovery failed. Keep this tab open.");
        })
        .finally(() => {
          this.localWrites--;
        });
      this.scheduleFlush();
    });
  }
  async subscribe() {
    if (
      this.closed ||
      this.subscription ||
      !this.eventDescriptor ||
      !this.puter.events?.onLocal ||
      // Large rooms relay live changes over peers; clients without a peer
      // network still need events.
      (this.roster?.length > 8 && this.peers && !this.peers.isRelay)
    )
      return;
    if (this.subscribing) return this.subscribing;
    const d = this.eventDescriptor;
    const subject = d.handle
      ? `kv:${d.handle}:${d.key}`
      : `kv:${d.app}:${d.key}`;
    this.subscribing = (async () => {
      let sub,
        failed = false;
      try {
        sub = await this.puter.events.onLocal(
          subject,
          () => {
            if (this.closed || failed || (sub && this.subscription !== sub))
              return;
            // A burst of events is handled once, shortly after it starts;
            // restarting the wait would postpone it while events continue.
            if (this.eventTimer) return;
            this.eventTimer = setTimeout(() => {
              this.eventTimer = null;
              this.synchronize().catch((e) => this.failure(e));
              this.eventCheckIn();
            }, 150);
          },
          {
            onError: () => {
              if (failed) return;
              failed = true;
              // An old listener's delayed error must not stop a replacement.
              if (this.subscription === sub) this.subscription = null;
              sub?.off();
            },
          },
        );
        // The SDK may report failure before its registration promise settles.
        if (this.closed || failed) sub.off();
        else this.subscription = sub;
      } catch {
        if (!this.closed) this.status("Connected · periodic sync");
      }
    })().finally(() => {
      this.subscribing = null;
    });
    return this.subscribing;
  }
  // Board events signal both edits and people joining or leaving. Checking
  // in on each would cost every participant a presence write per edit, so
  // it happens at most every five seconds, with one more after a burst.
  eventCheckIn() {
    if (this.closed || this.eventBeatTimer) return;
    const wait = (this.lastBeat || 0) + 5000 - Date.now();
    if (wait <= 0) return void this.heartbeat().catch((e) => this.failure(e));
    this.eventBeatTimer = setTimeout(() => {
      this.eventBeatTimer = null;
      if (!this.closed) this.heartbeat().catch((e) => this.failure(e));
    }, wait);
  }
  async heartbeat() {
    if (this.closed) return;
    // Peers connect with the invite code a check-in publishes. One renewed
    // while a check-in is running is published right after it, not at the
    // next poll.
    if (this.beating) return void (this.beatAgain = true);
    this.beating = true;
    this.beatAgain = false;
    this.lastBeat = Date.now();
    let invite = this.peers?.server?.inviteCode;
    try {
      const checkIn = () =>
        this.request("presence", {
          session: this.session,
          publicKey: this.keys.publicKey,
          invite,
        });
      const result = await checkIn().catch((error) => {
        // Another participant took this session's ID after it lapsed, as
        // while the tab slept. Continue under a new session instead.
        if (error?.status !== 409 || this.closed) throw error;
        this.session = crypto.randomUUID();
        this.peers?.close();
        this.peers = null;
        invite = undefined;
        return checkIn();
      });
      if (this.closed) return;
      this.applyRole(result.role, result.archived);
      // Peer links closed when access was refused come back with it.
      if (!this.peers) this.connectPeers().catch(() => {});
      this.roster = result.roster;
      this.peers?.update(result.ticket, result.signature, result.roster);
      if (result.roster.length > 8 && this.peers && !this.peers.isRelay) {
        this.subscription?.off();
        this.subscription = null;
      }
      for (const id of this.people.keys())
        if (!this.roster.some((p) => p.session === id)) this.people.delete(id);
      for (const id of this.views.keys())
        if (!this.roster.some((p) => p.session === id)) this.views.delete(id);
      this.viewChanged(this.views, this.roster);
      this.activity(this.people, this.roster);
      if (
        !this.eventDescriptor &&
        (!this.peers || result.roster.length <= 8 || this.peers.isRelay) &&
        (!this.eventProbe || Date.now() - this.eventProbe > 60000)
      ) {
        this.eventProbe = Date.now();
        this.eventDescriptor = (await this.request("events")).events;
      }
      await this.subscribe();
    } finally {
      this.beating = false;
      // A delayed presence write can finish after close() removed the session.
      if (this.closed)
        await this.request("leave", { session: this.session }).catch(() => {});
      else if (
        this.beatAgain &&
        this.peers?.server?.inviteCode &&
        this.peers.server.inviteCode !== invite
      )
        this.heartbeat().catch((e) => this.failure(e));
      this.beatAgain = false;
    }
  }
  async cache() {
    await this.store.collaborationPut({
      id: `${this.scope}|snapshot`,
      scope: this.scope,
      kind: "snapshot",
      update: encode(this.shared.update()),
    });
    await this.forgetAssets();
  }
  // Images and files no longer on the board, such as replaced or deleted
  // ones and those of earlier versions looked at, are not stored on this
  // device; the board's server still has them. Uploads still waiting stay.
  // This session keeps them in memory, so undoing a deletion shows the image
  // again even without a connection.
  async forgetAssets() {
    if (!this.assets.size) return;
    this.unstored ??= new Set();
    const used = new Set();
    for (const entry of this.shared.items.values()) {
      if (!entry?.get) continue;
      for (const value of [
        entry.get("geometry")?.src,
        entry.get("src"),
        entry.get("data"),
      ]) {
        const m = typeof value === "string" && ASSET.exec(value);
        if (m) used.add(m[1]);
      }
    }
    for (const [asset, data] of [...this.assets])
      if (used.has(asset)) {
        // Back on the board, as after an undo: stored again.
        if (this.unstored.delete(asset))
          await this.store.collaborationPut({
            id: `${this.scope}|asset:${asset}`,
            scope: this.scope,
            kind: "asset",
            asset,
            data,
            pending: false,
          });
      } else if (!this.pendingAssets.has(asset) && !this.unstored.has(asset)) {
        this.unstored.add(asset);
        await this.store.collaborationDelete(`${this.scope}|asset:${asset}`);
      }
  }
  async prepare(board) {
    const copy = structuredClone(board);
    for (const i of copy.items)
      for (const key of ["src", "data"]) {
        if (!i[key] || ASSET.test(i[key])) continue;
        let asset = this.assetIds.get(i[key]);
        if (!asset) {
          asset = await hash(i[key]);
          this.assets.set(asset, i[key]);
          this.assetIds.set(i[key], asset);
          this.pendingAssets.add(asset);
          await this.store.collaborationPut({
            id: `${this.scope}|asset:${asset}`,
            scope: this.scope,
            kind: "asset",
            asset,
            data: i[key],
            pending: true,
          });
        }
        i[key] = "asset:" + asset;
      }
    return copy;
  }
  async uploadAssets() {
    for (const asset of this.pendingAssets) {
      await this.request("asset.put", { asset, data: this.assets.get(asset) });
      await this.store.collaborationPut({
        id: `${this.scope}|asset:${asset}`,
        scope: this.scope,
        kind: "asset",
        asset,
        data: this.assets.get(asset),
        pending: false,
      });
      this.pendingAssets.delete(asset);
    }
  }
  // The board as it stood at an earlier version, with shared media hydrated.
  async versionBoard(at) {
    const { update } = await this.request("history.state", { at });
    const doc = new SharedDocument(decode(update));
    let board;
    try {
      board = doc.snapshot(this.room);
    } finally {
      doc.destroy();
    }
    return this.hydrate(board);
  }
  materialize() {
    return this.hydrate(this.shared.snapshot(this.room));
  }
  // Files and images replace their asset references. One that cannot be
  // downloaded keeps its reference, so the rest of the board still opens
  // and saves leave the file in place; the next publish tries again.
  async hydrate(board) {
    const wanted = new Set();
    for (const i of board.items)
      for (const key of ["src", "data"]) {
        const m = ASSET.exec(i[key] || "");
        if (m && !this.assets.has(m[1])) wanted.add(m[1]);
      }
    // A few downloads at a time, rather than one after another. Each keeps
    // its own result, so it is used even if unused media is let go of
    // meanwhile.
    const queue = [...wanted],
      downloaded = new Map();
    await Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length) {
          const asset = queue.shift();
          await this.downloadAsset(asset)
            .then((data) => downloaded.set(asset, data))
            .catch(() => {});
        }
      }),
    );
    for (const i of board.items)
      for (const key of ["src", "data"]) {
        const m = ASSET.exec(i[key] || "");
        const data = m && (this.assets.get(m[1]) ?? downloaded.get(m[1]));
        if (data) i[key] = data;
      }
    return board;
  }
  downloadAsset(asset) {
    if (!this.assetDownloads.has(asset)) {
      const pending = (async () => {
        const { data } = await this.request("asset.get", { asset });
        if ((await hash(data)) !== asset)
          throw Error("Shared asset checksum does not match.");
        this.assets.set(asset, data);
        this.assetIds.set(data, asset);
        await this.store.collaborationPut({
          id: `${this.scope}|asset:${asset}`,
          scope: this.scope,
          kind: "asset",
          asset,
          data,
          pending: false,
        });
        return data;
      })().finally(() => {
        // Failed transfers must be retryable; verified bytes remain in assets.
        this.assetDownloads.delete(asset);
      });
      this.assetDownloads.set(asset, pending);
    }
    return this.assetDownloads.get(asset);
  }
  // Only changed fields enter the document; editor integration serializes calls to this method.
  async commit(board, before) {
    if (this.readOnly || this.closed) return;
    const prepared = await this.prepare(board);
    const baseline = before ? await this.prepare(before) : null;
    if (this.closed || this.readOnly) return;
    let next = baseline
      ? rebase(prepared, baseline, this.shared.snapshot())
      : prepared;
    // Commenters change only comments and workshop registers such as votes.
    // Anything else this device changed, such as text heights measured with
    // its own fonts, stays local instead of getting the whole save refused.
    if (this.contentReadOnly) {
      const { comments, workshop } = next;
      next = this.shared.snapshot();
      delete next.comments;
      delete next.workshop;
      if (comments !== undefined) next.comments = comments;
      if (workshop !== undefined) next.workshop = workshop;
    }
    const written = this.written;
    this.shared.commit(next, { content: !this.contentReadOnly });
    await this.publish();
    await this.queue;
    // A save that changed nothing shared leaves nothing to upload, so the
    // status goes back to what it was rather than "Saving…" until the next
    // check.
    if (
      written === this.written &&
      !this.pending.size &&
      !this.flushing &&
      !this.closed
    )
      this.status(this.shown || this.savedStatus());
  }
  // Batch edits for longer in large rooms; see the heartbeat above.
  batchDelay() {
    const people = this.roster?.length || 0;
    return people > 30 ? 3000 : people > 8 ? 1200 : 400;
  }
  scheduleFlush() {
    if (this.flushTimer || this.closed) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch((e) => this.failure(e));
    }, this.batchDelay());
  }
  async flush() {
    if (this.closed || this.readOnly) return;
    // An edit made during an upload may miss it; send it once it finishes
    // rather than at the next retry.
    if (this.flushing) return void (this.flushAgain = true);
    clearTimeout(this.retryTimer);
    this.flushing = true;
    try {
      await this.queue;
      // Only people who can change content may upload media. Images queued
      // before access was lowered wait for it to return rather than stopping
      // everything else, such as comments, from being saved.
      if (!this.contentReadOnly) await this.uploadAssets();
      // With nothing uploaded the document is unchanged, so the local copy
      // is not rewritten nor the board redrawn, as periodic checks usually
      // find nothing to send.
      let sent = false;
      for (let batch = 0; this.pending.size && batch < 4; batch++) {
        const rows = this.batch();
        try {
          await this.send(rows);
          sent = true;
          this.batchRows = 128;
        } catch (error) {
          // The worker has not yet received edits these build on; they are
          // kept and sent again shortly.
          if (error.status === 409 && !this.closed) {
            this.soon = true;
            break;
          }
          // A batch too large for the worker is sent in halves.
          if (error.status === 413 && rows.length > 1 && !this.closed) {
            this.batchRows = Math.ceil(rows.length / 2);
            this.soon = true;
            continue;
          }
          if (![413, 422].includes(error.status) || this.closed) throw error;
          await this.recover(rows);
          sent = true;
        }
        if (this.closed) return;
      }
      // Each upload already kept the acknowledged state on this device.
      if (!this.closed) {
        this.status(
          this.pending.size ? "Saving shared changes…" : this.savedStatus(),
        );
        if (sent) await this.publish();
      }
    } finally {
      this.flushing = false;
      if (this.pending.size && !this.closed && !this.readOnly)
        this.retryTimer = setTimeout(
          () => this.flush().catch((e) => this.failure(e)),
          this.soon ? 1500 : this.flushAgain ? this.batchDelay() : 10000,
        );
      this.soon = this.flushAgain = false;
    }
  }
  // Pending rows in order, up to a count and a total size the worker
  // accepts in one commit; always at least one.
  batch() {
    const rows = [];
    let size = 0;
    for (const row of this.pending.values()) {
      size += row.update.length;
      if (
        rows.length &&
        (rows.length >= (this.batchRows || 128) || size > BATCH_SIZE)
      )
        break;
      rows.push(row);
    }
    return rows;
  }
  async send(rows) {
    // An edit the worker could never accept is handled like a refused one.
    if (rows.some((row) => row.update.length > UPDATE_LIMIT))
      throw Object.assign(Error("This change is too large to save."), {
        status: 413,
      });
    const update = mergeUpdates(rows.map((row) => decode(row.update)));
    const digest = await hash(update);
    const result = await this.request("commit", {
      id: digest,
      update: encode(update),
      vector: encode(this.shared.vector()),
    });
    if (this.closed) return;
    if (result.receipt?.id !== digest)
      throw Error("The server did not acknowledge this edit.");
    this.shared.apply(decode(result.update));
    // Keep the acknowledged edits locally before removing their rows.
    await this.cache();
    for (const row of rows) {
      await this.store.collaborationDelete(row.id);
      this.pending.delete(row.digest);
    }
    this.peers
      ?.broadcast("edit", {
        update: encode(update),
        receipt: result.receipt,
        receiptProof: result.receiptProof,
      })
      .catch(() => {});
    this.peers?.broadcast("committed", { id: digest }).catch(() => {});
  }
  // The worker deterministically rejects edits that cannot join the shared
  // state, such as concurrent additions crossing a board limit. Retrying them
  // would block every later save. Later rows continue the rejected row's Yjs
  // clock and could only be applied partially, so save the accepted prefix,
  // discard the rest, and return to the authoritative document.
  async recover(rows) {
    if (rows.length > 1)
      for (const row of rows) {
        try {
          await this.send([row]);
        } catch (error) {
          if (![413, 422].includes(error.status)) throw error;
          break;
        }
        if (this.closed) return;
      }
    const result = await this.request("sync");
    if (this.closed) return;
    await this.queue;
    if (this.closed) return;
    const discarded = [...this.pending.values()],
      previous = this.shared;
    this.pending.clear();
    // A fresh document also receives a fresh client ID for later edits.
    this.shared = new SharedDocument(decode(result.update), { merge: true });
    this.track();
    previous.destroy();
    for (const row of discarded) await this.store.collaborationDelete(row.id);
    await this.cache();
    await this.publish();
    if (!this.closed) this.rejected();
  }
  synchronize() {
    if (this.closed) return Promise.resolve();
    // A change can land after the running request was sent. Run one more pass
    // afterwards instead of dropping this request until the next poll.
    if (this.syncing) {
      this.resync = true;
      return this.syncing;
    }
    this.syncing = (async () => {
      try {
        do {
          this.resync = false;
          await this.synchronizeOnce();
        } while (this.resync && !this.closed);
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  }
  async synchronizeOnce() {
    const result = await this.request("sync", {
      vector: encode(this.shared.vector()),
    });
    if (this.closed) return;
    // Polls and notices usually bring nothing new. Rewriting the local copy
    // and redrawing the whole board is then skipped, unless access changed.
    let changed = !this.synchronized;
    const noticed = () => (changed = true);
    const access = [this.role, this.readOnly, this.contentReadOnly].join();
    this.shared.doc.on("update", noticed);
    try {
      this.shared.apply(decode(result.update));
    } finally {
      this.shared.doc.off("update", noticed);
    }
    this.shared.validate();
    this.applyRole(result.role, result.archived);
    if (access !== [this.role, this.readOnly, this.contentReadOnly].join())
      changed = true;
    if (changed) {
      await this.cache();
      await this.publish();
      this.synchronized = true;
    }
    if (!this.pending.size) this.status(this.savedStatus());
  }
  // Changes arrive live through board events or a verified peer link; in
  // large rooms most people have only the latter.
  savedStatus() {
    const linked = [...(this.peers?.links.values() || [])].some(
      (link) => link.connected && link.whiteboardAuthorized,
    );
    return this.subscription || linked
      ? "Saved · live"
      : "Saved · periodic sync";
  }
  async publish() {
    const generation = (this.publishGeneration =
      (this.publishGeneration || 0) + 1);
    const cached = this.shared.snapshot(this.room);
    let missing = 0;
    for (const item of cached.items)
      for (const key of ["src", "data"]) {
        const match = ASSET.exec(item[key] || "");
        if (!match) continue;
        if (this.assets.has(match[1])) item[key] = this.assets.get(match[1]);
        else missing++;
      }
    if (!this.closed) this.changed(cached);
    if (!missing) return;
    // Images and files still downloading appear when they arrive, rather
    // than holding back every other change, and later saves, until then.
    this.materialize()
      .then((board) => {
        const left = board.items.reduce(
          (n, i) =>
            n +
            ["src", "data"].filter((key) => ASSET.test(i[key] || "")).length,
          0,
        );
        if (
          !this.closed &&
          generation === this.publishGeneration &&
          left < missing
        )
          this.changed(board);
        this.retryAssets(board);
      })
      .catch(() => {});
  }
  // An image or file that could not be downloaded is tried again after a
  // while, waiting longer each time, even when nothing else changes. After
  // several tries, as for one the server no longer has, only later updates
  // to the board try again.
  retryAssets(board) {
    const missing = board.items.some((i) =>
      ["src", "data"].some((key) => ASSET.test(i[key] || "")),
    );
    if (!missing) {
      this.assetDelay = this.assetTries = 0;
      return;
    }
    if (this.assetTimer || this.closed) return;
    if ((this.assetTries || 0) >= 8) return;
    this.assetDelay = Math.min(60_000, (this.assetDelay || 2500) * 2);
    this.assetTimer = setTimeout(() => {
      this.assetTimer = null;
      this.assetTries = (this.assetTries || 0) + 1;
      if (!this.closed) this.publish().catch(() => {});
    }, this.assetDelay);
  }
  // Remember each session's last completed action, bounded like other
  // per-session state and ordered by recent activity.
  acted(session, sequence) {
    const last = Math.max(sequence, this.lastAction.get(session) || 0);
    this.lastAction.delete(session);
    this.lastAction.set(session, last);
    if (this.lastAction.size > 512)
      this.lastAction.delete(this.lastAction.keys().next().value);
  }
  async receive(kind, data, ticket, sequence) {
    if (this.closed || ticket.session === this.session) return;
    if (!data || typeof data !== "object") return;
    if (kind === "view-left") {
      if (
        !Number.isSafeInteger(data.at) ||
        Math.abs(this.now() - data.at) > 15000 ||
        !Number.isSafeInteger(sequence) ||
        sequence <= (this.views.get(ticket.session)?.sequence || 0)
      )
        return;
      this.endedViews.add(ticket.session);
      if (this.endedViews.size > 512)
        this.endedViews.delete(this.endedViews.values().next().value);
      this.views.delete(ticket.session);
      this.viewChanged(this.views, this.roster || []);
      // They left the board: their cursor, selection and editing tag go too,
      // rather than lingering until their presence expires.
      if (this.people.delete(ticket.session))
        this.activity(this.people, this.roster || []);
      return;
    }
    if (kind === "view" || kind === "attention") {
      if (this.endedViews.has(ticket.session)) return;
      if (!Number.isSafeInteger(sequence) || sequence <= 0) return;
      const v = readView(data, this.now());
      if (!v) return;
      if (
        kind === "attention" &&
        (!canEditContent(ticket.role) ||
          !["all", this.session].includes(data.target) ||
          sequence <= (this.attentionSequence.get(ticket.session) || 0))
      )
        return;
      const previous = this.views.get(ticket.session);
      if (kind === "view" && previous && sequence <= previous.sequence) return;
      const person =
        previous && sequence <= previous.sequence
          ? previous
          : { ...ticket, ...v, sequence, received: Date.now() };
      this.views.set(ticket.session, person);
      if (this.views.size > 512)
        this.views.delete(this.views.keys().next().value);
      this.viewChanged(this.views, this.roster || []);
      if (kind === "attention") {
        this.attentionSequence.set(ticket.session, sequence);
        if (this.attentionSequence.size > 512)
          this.attentionSequence.delete(
            this.attentionSequence.keys().next().value,
          );
        this.attention(person);
      }
      return;
    }
    if (kind === "presence") {
      const prev = this.people.get(ticket.session);
      if (
        this.endedViews.has(ticket.session) ||
        (prev && sequence <= prev.sequence) ||
        sequence <= (this.lastAction.get(ticket.session) || 0)
      )
        return;
      if (
        data.cursor &&
        ![data.cursor.x, data.cursor.y].every(
          (n) => Number.isFinite(n) && Math.abs(n) <= 1e6,
        )
      )
        return;
      const selection = Array.isArray(data.selection)
        ? data.selection.filter((id) => typeof id === "string").slice(0, 100)
        : [];
      let preview = [];
      if (canEditContent(ticket.role) && Array.isArray(data.preview))
        preview = data.preview
          .slice(0, 100)
          .filter(
            (i) =>
              typeof i.id === "string" &&
              [i.x, i.y, i.w, i.h].every(
                (n) => Number.isFinite(n) && Math.abs(n) <= 1e6,
              ),
          )
          .map(({ id, x, y, w, h, type, color, points, rotation }) => ({
            id,
            x,
            y,
            w,
            h,
            ...(Number.isFinite(rotation) && rotation >= -180 && rotation < 180
              ? { rotation }
              : {}),
            ...(["pen", "arrow"].includes(type) &&
            /^#[a-f0-9]{6}$/i.test(color) &&
            Array.isArray(points) &&
            points.length <= 256 &&
            points.every(
              (p) =>
                Array.isArray(p) &&
                p.length === 2 &&
                p.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e6),
            )
              ? { type, color, points }
              : {}),
          }));
      let editing = typeof data.editing === "string" ? data.editing : null,
        text =
          canEditContent(ticket.role) && typeof data.text === "string"
            ? data.text.slice(0, 20000)
            : null,
        settling = null;
      // A finished move or edit reaches this device after the presence
      // saying it ended. What was last shown stays until the edit arrives,
      // for a few seconds at most, rather than jumping back meanwhile.
      if (data.settling === true && prev) {
        const since = prev.settling || Date.now();
        if (Date.now() - since <= 3000) {
          if (!preview.length && prev.preview?.length) {
            preview = prev.preview;
            settling = since;
          }
          if (editing === null && prev.editing && prev.text !== null) {
            editing = prev.editing;
            text = prev.text;
            settling = since;
          }
        }
      }
      this.people.set(ticket.session, {
        ...ticket,
        cursor: data.cursor,
        selection,
        preview,
        editing,
        text,
        settling,
        sequence,
        at: Date.now(),
      });
      this.activity(this.people, this.roster || []);
    } else if (kind === "edit" && canComment(ticket.role)) {
      try {
        const update = decode(data.update, 60000);
        if (
          data.receipt?.room !== this.room ||
          data.receipt.author !== ticket.user ||
          data.receipt.id !== (await hash(update)) ||
          !(await verify(this.publicKey, data.receipt, data.receiptProof)) ||
          this.closed
        )
          return;
        const trial = new SharedDocument(this.shared.update());
        try {
          trial.apply(update);
          trial.validate();
        } finally {
          trial.destroy();
        }
        this.shared.apply(update);
        this.acted(ticket.session, sequence);
        const person = this.people.get(ticket.session);
        if (person) {
          person.preview = [];
          person.text = null;
          person.settling = null;
        }
        this.publish().catch(() => {});
      } catch {
        /* Invalid or incomplete peer state never replaces the last rendered board. */
      }
    } else if (kind === "committed") {
      this.acted(ticket.session, sequence);
      // What they last showed stays until the board has their edit.
      const person = this.people.get(ticket.session);
      if (person && !person.settling) {
        person.preview = [];
        person.text = null;
      }
      (this.committedPeople ||= new Set()).add(ticket.session);
      // Separate from board events, whose check-in this must not cancel.
      if (!this.committedTimer)
        this.committedTimer = setTimeout(() => {
          this.committedTimer = null;
          const settled = this.committedPeople;
          this.committedPeople = new Set();
          const end = () => {
            let ended = false;
            for (const session of settled) {
              const p = this.people.get(session);
              if (!p?.settling) continue;
              p.preview = [];
              p.text = null;
              p.settling = null;
              ended = true;
            }
            if (ended && !this.closed)
              this.activity(this.people, this.roster || []);
          };
          this.synchronize()
            .then(end, (e) => {
              end();
              this.failure(e);
            })
            .catch(() => {});
        }, 200);
    }
  }
  view(camera, following = null) {
    if (
      this.closed ||
      this.viewEnded ||
      !validCamera(camera) ||
      (following !== null && !validSession(following))
    )
      return;
    const next = { camera: { ...camera }, following },
      key = JSON.stringify(next);
    if (this.viewKey === key && Date.now() - (this.lastViewSent || 0) < 3000)
      return;
    this.viewKey = key;
    this.latestView = next;
    if (!this.viewTimer)
      this.viewTimer = setTimeout(() => {
        this.viewTimer = null;
        this.broadcastView();
      }, 100);
  }
  broadcastView() {
    if (
      this.closed ||
      this.viewEnded ||
      !this.latestView ||
      !this.peers?.ticket
    )
      return;
    this.lastViewSent = Date.now();
    this.peers
      .broadcast("view", { ...this.latestView, at: Math.round(this.now()) })
      .catch(() => {});
  }
  async finishView() {
    if (this.closed || this.viewEnded) return;
    this.viewEnded = true;
    clearTimeout(this.viewTimer);
    this.viewTimer = null;
    await this.peers
      ?.broadcast("view-left", { at: Math.round(this.now()) })
      .catch(() => {});
  }
  async bring(target = "all") {
    if (
      this.closed ||
      this.viewEnded ||
      this.readOnly ||
      this.contentReadOnly ||
      !this.connected ||
      !this.latestView ||
      !this.peers?.ticket ||
      ![...this.peers.links.values()].some(
        (p) => p.connected && p.whiteboardAuthorized,
      ) ||
      (target !== "all" &&
        (!validSession(target) ||
          target === this.session ||
          !this.roster?.some((p) => p.session === target)))
    )
      return false;
    await this.peers.broadcast("attention", {
      ...this.latestView,
      following: null,
      at: Math.round(this.now()),
      target,
    });
    return true;
  }
  presence(data) {
    this.latestPresence = data;
    if (this.presenceTimer || this.closed) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      this.sendPresence();
    }, 40);
  }
  pulsePresence() {
    const p = this.latestPresence,
      quiet = Date.now() - (this.lastPresenceSent || 0);
    if (
      p &&
      !this.presenceTimer &&
      ((p.preview?.length && quiet >= 750) ||
        ((p.selection?.length || p.editing) && quiet >= 4000))
    )
      this.sendPresence();
  }
  sendPresence() {
    this.lastPresenceSent = Date.now();
    // Peers refuse packets over 64 KB. Without the live positions of a
    // large selection, the cursor and selection still reach them.
    let data = this.latestPresence;
    if (data?.preview?.length && JSON.stringify(data).length > 48_000)
      data = { ...data, preview: [] };
    this.peers?.broadcast("presence", data).catch(() => {});
  }
  failure(error) {
    if (this.closed) return;
    // Refused, or the board deleted (it can be brought back from the trash).
    if (error.status === 403 || error.status === 404) {
      this.readOnly = true;
      this.contentReadOnly = true;
      // The role last granted no longer applies, as after a removal.
      this.denied = true;
      this.peers?.close();
      this.peers = null;
      // Until access returns, nobody else's presence is known; the regular
      // expiry would otherwise show the previous roster again.
      this.roster = [];
      this.people.clear();
      this.views.clear();
      this.viewChanged(this.views, []);
      this.status(
        error.status === 404
          ? "Board unavailable · local changes retained"
          : "Access changed · local changes retained",
      );
      this.activity(this.people, []);
    } else
      this.status(
        this.recoveryFailed
          ? "Local recovery failed. Keep this tab open."
          : "Offline · changes saved on this device",
      );
  }
  get unsaved() {
    return (
      this.localWrites > 0 ||
      this.pending.size > 0 ||
      this.pendingAssets.size > 0
    );
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    for (const timer of [
      this.poll,
      this.expire,
      this.viewPulse,
      this.presencePulse,
    ])
      clearInterval(timer);
    for (const timer of [
      this.flushTimer,
      this.retryTimer,
      this.checkInTimer,
      this.eventBeatTimer,
      this.eventTimer,
      this.committedTimer,
      this.presenceTimer,
      this.viewTimer,
      this.assetTimer,
    ])
      clearTimeout(timer);
    this.subscription?.off();
    this.peers?.close();
    globalThis.removeEventListener?.("online", this.online);
    globalThis.document?.removeEventListener("visibilitychange", this.online);
    this.request("leave", { session: this.session }).catch(() => {});
    this.queue.finally(() => this.shared.destroy());
  }
}
