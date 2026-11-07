import { readView } from "./attention.js";
import { PROTOCOL, topology, sign, verify } from "./protocol.js";

// The certificate fingerprints of a connection's encrypted transport, which
// differ on every connection. Signing them with a challenge ties the answer
// to this connection, so another participant cannot pass a challenge on to
// someone else and present their answer as their own.
function fingerprints(description) {
  const found = description?.sdp?.match(/^a=fingerprint:.+$/gim) || [];
  return [...new Set(found.map((line) => line.trim().toLowerCase()))].sort();
}
function binding(conn) {
  const pc = conn.peerconnection;
  return {
    local: fingerprints(pc?.localDescription),
    remote: fingerprints(pc?.remoteDescription),
  };
}

// Peers drop packets numbered at or below ones they already received from a
// session. Numbers keep rising across networks, so one rebuilt for the same
// session, as after access is refused and restored, is not ignored.
let lastSequence = 0;
const nextSequence = () =>
  (lastSequence = Math.max(lastSequence + 1, Date.now()));

// In rooms over eight, a relay passes each sender's presence to a member of
// its group in full only near the member's view, elsewhere at most once a
// second. Spacing is measured in sequence numbers, which follow the sender's
// clock, so a group's two relays pick the same packets and members verify
// each once. The latest packet held back goes once its sender pauses, or,
// if at most FRESH old, as soon as the member looks where it shows
// something.
const SPACING = 1000,
  QUIET = 300,
  FRESH = 2000;
// A group's first relay passes its packets to other groups. The second
// asks after it once a link has been quiet for ASK, and does so itself
// while it has heard nothing on it for SILENT, as when the first relay's
// device crashed or lost its network and nobody was told.
const ASK = 1000,
  SILENT = 2000;
// A link whose presence channel holds this much unsent is behind: presence
// and camera views, which are soon replaced, wait for the next ones.
const BACKLOG = 16384;
// Tickets a link keeps for the packets that name them; see wire().
const KEPT_TICKETS = 1024;
const ticketName = (ticket) => `${ticket.session}:${ticket.expires}`;
// Widens box `n` of `a` ([left, top, right, bottom]) to hold an object's box,
// or a rotated one's reach.
function grow(a, n, g) {
  if (!g || typeof g !== "object") return;
  const { x, y, w, h } = g;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(w) ||
    !Number.isFinite(h)
  )
    return;
  let left = Math.min(x, x + w),
    top = Math.min(y, y + h),
    right = Math.max(x, x + w),
    bottom = Math.max(y, y + h);
  if (g.rotation) {
    const r = Math.hypot(w, h) / 2,
      cx = x + w / 2,
      cy = y + h / 2;
    left = cx - r;
    top = cy - r;
    right = cx + r;
    bottom = cy + r;
  }
  if (left < a[n]) a[n] = left;
  if (top < a[n + 1]) a[n + 1] = top;
  if (right > a[n + 2]) a[n + 2] = right;
  if (bottom > a[n + 3]) a[n + 3] = bottom;
}
function empty(a, n) {
  a[n] = a[n + 1] = Infinity;
  a[n + 2] = a[n + 3] = -Infinity;
}
function near(view, a, n) {
  for (let i = 0; i < n; i += 4)
    if (
      a[i] <= view.right &&
      a[i + 2] >= view.left &&
      a[i + 1] <= view.bottom &&
      a[i + 3] >= view.top
    )
      return true;
  return false;
}
const hasPreview = (data) =>
  Array.isArray(data?.preview) && data.preview.length > 0;
const editingOf = (data) =>
  typeof data?.editing === "string" ? data.editing : null;
// What a member was last sent of a sender's presence.
function record(state, packet, time, close) {
  const data = packet.body.data;
  state.seq = packet.body.seq;
  state.time = time;
  state.near = close;
  state.preview = hasPreview(data);
  state.editing = editingOf(data);
  state.settling = data?.settling === true;
  state.pending = null;
}

export class PeerNetwork {
  // `now` is the server's time, which tickets' expiry is measured in; a
  // device clock running ahead would otherwise refuse every peer.
  constructor({
    puter,
    session,
    keys,
    roomKey,
    room,
    receive,
    changed,
    relinked,
    now = () => Date.now(),
    // An object's geometry on this board, by ID, for filtering presence;
    // and the connectors attached to it with their other ends, written into
    // `out` from index `n` while it has room, returning the next index.
    bounds = () => null,
    related = (id, out, n) => n,
  }) {
    Object.assign(this, {
      puter,
      session,
      keys,
      roomKey,
      room,
      receive,
      changed,
      relinked,
      now,
      bounds,
      related,
    });
    this.links = new Map();
    this.connections = new Set();
    this.roster = [];
    this.seen = new Set();
    this.checking = new Map();
    this.verified = new Map();
    // For relays: group members' widened views and everyone's widened
    // camera, what each sender's presence and view last sent each member,
    // senders with presence or views held back, and each sender's latest
    // presence with where it shows something.
    this.views = new Map();
    this.cameras = new Map();
    this.forwarded = new Map();
    this.viewed = new Map();
    this.held = new Set();
    this.heldViews = new Set();
    this.latest = new Map();
    this.areas = new Float64Array(16);
    this.relatedIds = new Array(100);
    this.closed = false;
    this.retry = setInterval(() => this.reconcile(), 5000);
    this.watch = setInterval(() => this.askPrimary(), 500);
  }
  async serve() {
    if (this.closed || this.serving) return;
    this.serving = true;
    let expired = false,
      timer;
    try {
      const pending = this.puter.peer.serve();
      pending
        .then((server) => {
          if (expired || this.closed) server.close();
        })
        .catch(() => {});
      const server = await Promise.race([
        pending,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            expired = true;
            reject(Error("Peer service timed out."));
          }, 12000);
        }),
      ]);
      if (this.closed) {
        server.close();
        return;
      }
      this.server = server;
      server.addEventListener("connection", (e) => this.attach(e.conn));
      server.addEventListener("close", () => {
        if (this.server !== server) return;
        this.server = null;
        this.changed?.();
      });
      server.addEventListener("reconnect", () => this.changed?.());
    } finally {
      clearTimeout(timer);
      this.serving = false;
    }
  }
  update(ticket, signature, roster) {
    this.ticket = ticket;
    this.signature = signature;
    this.roster = roster;
    const plan = topology(roster);
    this.plan = plan;
    this.isRelay = plan.relays.has(this.session);
    this.wanted = plan.edges.get(this.session) || new Set();
    for (const id of this.views.keys())
      if (!this.filtered(id)) this.views.delete(id);
    for (const sent of [this.forwarded, this.viewed])
      for (const [sender, members] of sent)
        if (!plan.groupOf.has(sender)) sent.delete(sender);
        else
          for (const id of members.keys())
            if (!this.filtered(id)) members.delete(id);
    for (const id of this.cameras.keys())
      if (!plan.groupOf.has(id)) this.cameras.delete(id);
    for (const sender of this.latest.keys())
      if (!plan.groupOf.has(sender)) this.latest.delete(sender);
    this.reconcile();
    // A peer refuses a link until it has this roster too, which often
    // reaches it moments later, as when a group's members all check in at
    // once; dialling again then beats the regular retry.
    clearTimeout(this.again);
    this.again = setTimeout(() => this.reconcile(), 1000);
  }
  // Whether presence this relay sends a session is filtered by its view.
  filtered(id) {
    const groupOf = this.plan?.groupOf;
    return (
      this.isRelay &&
      this.roster.length > 8 &&
      !this.plan.relays.has(id) &&
      groupOf.get(id) === groupOf.get(this.session)
    );
  }
  async reconcile() {
    if (this.closed || !this.ticket) return;
    // Only a new server has a new invite code to publish; a request still
    // under way publishes its own when it finishes.
    if (!this.server && !this.serving)
      this.serve()
        .then(() => this.server && this.changed?.())
        .catch(() => {});
    for (const [id, link] of this.links)
      if (!this.wanted.has(id)) {
        link.close();
        this.links.delete(id);
      }
    for (const peer of this.roster) {
      if (
        !this.wanted.has(peer.session) ||
        peer.session < this.session ||
        !peer.invite ||
        this.links.has(peer.session)
      )
        continue;
      const pending = { close() {} };
      this.links.set(peer.session, pending);
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        if (this.links.get(peer.session) === pending)
          this.links.delete(peer.session);
      }, 12000);
      this.puter.peer
        .connect(peer.invite)
        .then((conn) => {
          clearTimeout(timer);
          if (expired || this.closed || !this.wanted.has(peer.session)) {
            conn.close();
            return;
          }
          this.attach(conn, peer.session);
        })
        .catch(() => {
          clearTimeout(timer);
          if (this.links.get(peer.session) === pending)
            this.links.delete(peer.session);
        });
    }
  }
  attach(conn, expected) {
    if (!conn || this.closed || this.connections.size >= 64) {
      conn?.close();
      // A refused dial must not leave its placeholder, which would stop the
      // link from ever being dialled again.
      const link = expected && this.links.get(expected);
      if (link && !this.connections.has(link)) this.links.delete(expected);
      return;
    }
    this.connections.add(conn);
    if (expected) this.links.set(expected, conn);
    let authorized = null,
      ended = false,
      alive = Date.now();
    // The other end may finish checking our hello first and start sending
    // before we have checked theirs. A few such packets wait for that check
    // instead of being lost; the rest are dropped.
    const early = [];
    const challenge = crypto.randomUUID();
    let soft;
    try {
      soft = conn.peerconnection.createDataChannel("whiteboard-presence", {
        negotiated: true,
        id: 4,
        ordered: false,
        maxRetransmits: 0,
      });
      conn.whiteboardPresence = soft;
    } catch {
      /* Older SDKs can still exchange committed edits. */
    }
    const timeout = setTimeout(() => {
      if (!authorized) conn.close();
    }, 12000);
    const heartbeat = setInterval(() => {
      if (Date.now() - alive > 25000) conn.close();
      else this.sendOn(conn, { challenge });
    }, 8000);
    const ask = () => this.sendOn(conn, { challenge });
    conn.addEventListener("open", ask);
    if (conn.connected) ask();
    conn.whiteboardAsk = ask;
    conn.whiteboardHeard = Date.now();
    const close = () => {
      const lost = !ended && authorized;
      ended = true;
      early.length = 0;
      clearTimeout(timeout);
      clearInterval(heartbeat);
      soft?.close();
      this.connections.delete(conn);
      for (const [id, link] of this.links)
        if (link === conn) this.links.delete(id);
      if (lost) this.linkLost(lost);
    };
    conn.addEventListener("close", close);
    conn.addEventListener("error", () => {
      conn.close();
      close();
    });
    const message = async (event) => {
      try {
        if (
          ended ||
          this.closed ||
          typeof event.data !== "string" ||
          event.data.length > 64_000
        )
          return;
        conn.whiteboardHeard = Date.now();
        const packet = JSON.parse(event.data);
        if (
          typeof packet.challenge === "string" &&
          !packet.hello &&
          packet.challenge.length < 100
        ) {
          if (!this.ticket) return;
          const { local, remote } = binding(conn);
          const proof = await sign(this.keys.privateKey, {
            challenge: packet.challenge,
            session: this.session,
            local,
            remote,
          });
          if (ended || this.closed) return;
          this.sendOn(conn, {
            hello: true,
            challenge: packet.challenge,
            ticket: this.ticket,
            signature: this.signature,
            proof,
            // This client keeps the tickets it is sent; see wire().
            compact: 1,
          });
          return;
        }
        if (packet.hello) {
          // The other end signed its view of this connection: our remote
          // certificate is its local one. Clients from before this binding
          // sign the challenge alone; an updated client never does, so its
          // answers cannot be relayed.
          const { local, remote } = binding(conn);
          const proven = async () =>
            (await verify(
              packet.ticket.publicKey,
              {
                challenge,
                session: packet.ticket.session,
                local: remote,
                remote: local,
              },
              packet.proof,
            )) ||
            (await verify(
              packet.ticket.publicKey,
              { challenge, session: packet.ticket.session },
              packet.proof,
            ));
          if (
            packet.challenge !== challenge ||
            !(await this.validTicket(packet)) ||
            !(await proven()) ||
            (expected && packet.ticket.session !== expected) ||
            !this.wanted?.has(packet.ticket.session)
          ) {
            conn.close();
            return;
          }
          // Identity checks yield to close events. Never restore a dead link.
          if (ended || this.closed) return;
          authorized = packet.ticket.session;
          const prior = this.links.get(authorized);
          if (prior && prior !== conn) prior.close();
          this.links.set(authorized, conn);
          conn.whiteboardAuthorized = true;
          conn.whiteboardCompact = packet.compact === 1;
          alive = Date.now();
          for (const waiting of early.splice(0)) message(waiting);
          if (this.stranded) {
            this.stranded = false;
            this.relinked?.();
          }
          return;
        }
        if (!authorized) {
          if (packet.body && early.length < 8) early.push(event);
          return;
        }
        // The other end keeps a ticket it was sent, or lost one; see wire().
        if (typeof packet.known === "string" && packet.known.length < 200) {
          if (!conn.whiteboardKnown) conn.whiteboardKnown = new Set();
          conn.whiteboardKnown.add(packet.known);
          if (conn.whiteboardKnown.size > KEPT_TICKETS)
            conn.whiteboardKnown.delete(
              conn.whiteboardKnown.values().next().value,
            );
          return;
        }
        if (typeof packet.unknown === "string") {
          conn.whiteboardKnown?.delete(packet.unknown);
          return;
        }
        // A packet naming a ticket this link was sent before is checked as
        // the packet with that ticket would be.
        const named = typeof packet.ref === "string" && packet.ref;
        if (named) {
          const kept = conn.whiteboardTickets?.get(named);
          if (!kept) {
            this.sendOn(conn, { unknown: named });
            return;
          }
          packet.ticket = kept.ticket;
          packet.signature = kept.signature;
          delete packet.ref;
        }
        // In a large room each packet arrives from both of the group's
        // relays, often together. A copy arriving while another is checked
        // waits for that check, and is checked itself only if that copy
        // proved forged. Only verified packets are recorded as seen, so a
        // forged copy cannot hide the real one.
        const key = `${packet.ticket?.session}:${packet.body?.seq}`;
        if (this.seen.has(key)) return;
        const pending = this.checking.get(key);
        if (pending && (await pending)) return;
        const check = this.check(packet);
        this.checking.set(key, check);
        const valid = await check;
        if (this.checking.get(key) === check) this.checking.delete(key);
        if (!valid) return;
        const { body, ticket } = packet;
        // A ticket that proved valid is kept, and the other end told, so its
        // later packets can name it.
        if (!named && conn.whiteboardCompact) {
          const name = ticketName(ticket);
          const kept = (conn.whiteboardTickets ??= new Map());
          if (!kept.has(name)) {
            kept.set(name, { ticket, signature: packet.signature });
            if (kept.size > KEPT_TICKETS) kept.delete(kept.keys().next().value);
            this.sendOn(conn, { known: name });
          }
        }
        // A signed packet already received may finish verification after its
        // transport closes (for example, a participant's final view-left).
        if (this.closed) return;
        // Viewers never save edits, so neither their edits nor notices of
        // saves, which make everyone synchronize, are taken or passed on.
        if (
          ["edit", "committed"].includes(body.kind) &&
          ticket.role === "viewer"
        )
          return;
        if (this.seen.has(key)) return;
        this.seen.add(key);
        if (this.seen.size > 4096)
          this.seen.delete(this.seen.values().next().value);
        alive = Date.now();
        if (body.kind === "view" || body.kind === "view-left")
          this.noteView(ticket.session, body);
        // A packet the session refused as one too many, such as a live
        // reaction past its sender's limit, is not passed on either.
        const taken = await this.receive(
          body.kind,
          body.data,
          ticket,
          body.seq,
        );
        if (taken !== false && this.isRelay && this.roster.length > 8)
          this.fanout(packet, conn);
      } catch {
        /* Ignore malformed packets; durable state is recovered separately. */
      }
    };
    conn.addEventListener("message", message);
    if (soft) soft.onmessage = message;
  }
  // Whether a packet is signed by a current member of this room.
  async check(packet) {
    try {
      const { body, ticket } = packet;
      return (
        (await this.validTicket(packet)) &&
        body?.v === PROTOCOL &&
        Number.isSafeInteger(body.seq) &&
        (await verify(ticket.publicKey, body, packet.proof))
      );
    } catch {
      return false;
    }
  }
  // Members of a large room read the roster only every 20 to 45 seconds. A
  // ticket issued after this one, which came with the roster, is newer than
  // the roster, as for someone who joined since or was given another role,
  // and stands on its own signature. Older tickets must match the roster, so
  // a removal or lowered role it shows still applies.
  async validTicket(packet) {
    const t = packet.ticket;
    if (
      !t ||
      t.room !== this.room ||
      !Number.isFinite(t.expires) ||
      t.expires < this.now() ||
      (!(this.ticket && t.expires > this.ticket.expires) &&
        !this.roster.some(
          (p) =>
            p.session === t.session && p.user === t.user && p.role === t.role,
        ))
    )
      return false;
    const key = JSON.stringify(t) + packet.signature;
    if (this.verified.has(key)) return true;
    if (!(await verify(this.roomKey, t, packet.signature))) return false;
    if (this.verified.size > 1024) this.verified.clear();
    this.verified.set(key, true);
    return true;
  }
  sendOn(conn, packet) {
    try {
      if (!conn.connected || (packet.body && !conn.whiteboardAuthorized))
        return;
      // Views go on the ordered channel, whose backlog the peer service does
      // not show. Both channels share one transport, so a backed-up presence
      // channel says the link is behind; the next view renews a skipped one.
      const channel = conn.whiteboardPresence;
      if (packet.body?.kind === "presence") {
        if (channel?.readyState === "open" && channel.bufferedAmount < BACKLOG)
          channel.send(this.wire(conn, packet));
      } else if (
        packet.body?.kind !== "view" ||
        !(channel?.bufferedAmount >= BACKLOG)
      )
        conn.send(this.wire(conn, packet));
    } catch {
      /* Reconnection will repair the link. */
    }
  }
  // A packet as sent on one link. Most of a small packet, such as a cursor's,
  // is its sender's ticket and the two signatures; a peer that said it keeps
  // a ticket (see attach) is sent the packet naming it instead, so a relay
  // passing a large room's presence on sends a fraction of the bytes. The
  // full packet goes until the peer says it has the ticket, as presence
  // travels on a channel that may lose or reorder packets, and older
  // clients, which never say so, always get it in full.
  wire(conn, packet) {
    const name = packet.body && packet.ticket && ticketName(packet.ticket);
    if (!name || !conn.whiteboardKnown?.has(name))
      return JSON.stringify(packet);
    return JSON.stringify({
      ref: name,
      body: packet.body,
      proof: packet.proof,
    });
  }
  async broadcast(kind, data) {
    if (this.closed || !this.ticket) return;
    const body = { v: PROTOCOL, seq: nextSequence(), kind, data };
    const packet = {
      ticket: this.ticket,
      signature: this.signature,
      body,
      proof: await sign(this.keys.privateKey, body),
    };
    if (this.closed || JSON.stringify(packet).length > 64_000) return;
    this.seen.add(`${this.session}:${body.seq}`);
    if (this.seen.size > 4096)
      this.seen.delete(this.seen.values().next().value);
    this.fanout(packet);
  }
  fanout(packet, except) {
    const group = this.plan?.groupOf.get(this.session);
    const sourceGroup = this.plan?.groupOf.get(packet.ticket.session);
    const primary = this.plan?.primaryOf.get(this.session);
    const now = Date.now();
    const link = this.links.get(primary),
      primaryConnected =
        link?.whiteboardAuthorized && now - link.whiteboardHeard < SILENT;
    const relaying = this.roster.length > 8 && this.isRelay;
    const areas =
      relaying && packet.body.kind === "presence"
        ? this.presenceAreas(packet.body.data)
        : -1;
    const viewing = relaying && packet.body.kind === "view";
    if (areas >= 0) this.keepLatest(packet, areas, now);
    for (const [id, conn] of this.links) {
      if (conn === except) continue;
      if (relaying && this.plan.groupOf.get(id) !== group) {
        if (
          sourceGroup !== group ||
          (primary !== this.session && primaryConnected)
        )
          continue;
      } else if (
        (areas >= 0 || viewing) &&
        conn.connected &&
        conn.whiteboardAuthorized &&
        !this.plan.relays.has(id) &&
        !(viewing
          ? this.passesView(packet, id, now)
          : this.passes(packet, id, areas, now))
      )
        continue;
      this.sendOn(conn, packet);
    }
  }
  // A participant's camera, widened by half its size on each side, and whom
  // it follows. Members of this group look where it shows.
  noteView(session, body) {
    if (body.kind === "view-left") {
      this.views.delete(session);
      this.cameras.delete(session);
      return;
    }
    if (!this.isRelay || this.roster.length <= 8) return;
    const view = readView(body.data, this.now());
    if (!view || body.seq <= (this.cameras.get(session)?.seq ?? 0)) return;
    const { x, y, w, h } = view.camera;
    const widened = {
      left: x - w,
      top: y - h,
      right: x + w,
      bottom: y + h,
      seq: body.seq,
      following: view.following,
    };
    this.cameras.delete(session);
    this.cameras.set(session, widened);
    if (this.cameras.size > 512)
      this.cameras.delete(this.cameras.keys().next().value);
    if (this.filtered(session)) {
      const before = this.views.get(session)?.following;
      this.views.set(session, widened);
      // Someone who starts following gets the followed view held back.
      if (view.following && view.following !== before) {
        const state = this.viewed.get(view.following)?.get(session);
        if (state?.pending) state.due = 0;
        this.release();
      }
    }
    for (const [member, seen] of this.views)
      if (member === session || seen.following === session)
        this.catchUp(member, this.viewOf(member));
  }
  // Where a member looks. A follower's own camera is renewed only now and
  // then, so it looks where the person it follows does.
  viewOf(member) {
    const view = this.views.get(member);
    return (view?.following && this.cameras.get(view.following)) || view;
  }
  keepLatest(packet, areas, now) {
    const sender = packet.ticket.session;
    let last = this.latest.get(sender);
    if (last && last.packet.body.seq >= packet.body.seq) return;
    if (!last) {
      if (this.latest.size >= 512)
        this.latest.delete(this.latest.keys().next().value);
      this.latest.set(
        sender,
        (last = { boxes: new Float64Array(this.areas.length) }),
      );
    }
    last.packet = packet;
    last.areas = areas;
    last.at = now;
    last.boxes.set(this.areas);
  }
  // Sends a member who looks somewhere new the latest presence of each
  // sender now near its view that it was not sent, rather than leaving
  // cursors there up to a second behind.
  catchUp(member, view) {
    const conn = this.links.get(member);
    if (!conn?.whiteboardAuthorized) return;
    const now = Date.now();
    for (const [sender, last] of this.latest) {
      const { packet } = last;
      if (
        sender === member ||
        now - last.at > FRESH ||
        !near(view, last.boxes, last.areas)
      )
        continue;
      const members = this.membersOf(sender);
      let state = members.get(member);
      if (state?.seq >= packet.body.seq) continue;
      if (!state) {
        members.set(member, (state = { member }));
        if (members.size > 64) members.delete(members.keys().next().value);
      }
      record(state, packet, packet.body.seq + now - last.at, true);
      this.sendOn(conn, packet);
    }
  }
  // Where a presence packet shows something, as boxes in this.areas: its
  // cursor, its previews, its selected or edited objects as this board has
  // them, and the connectors attached to edited or moving objects with
  // their other ends, which others' boards redraw as those change. Returns
  // how many numbers it wrote.
  presenceAreas(data) {
    const a = this.areas;
    if (!data || typeof data !== "object") return 0;
    let n = 0;
    const cursor = data.cursor;
    if (cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y)) {
      a[0] = a[2] = cursor.x;
      a[1] = a[3] = cursor.y;
      n = 4;
    }
    empty(a, n);
    if (Array.isArray(data.preview))
      for (let i = 0; i < data.preview.length && i < 100; i++)
        grow(a, n, data.preview[i]);
    if (a[n] <= a[n + 2]) n += 4;
    empty(a, n);
    if (Array.isArray(data.selection))
      for (let i = 0; i < data.selection.length && i < 100; i++)
        if (typeof data.selection[i] === "string")
          grow(a, n, this.bounds(data.selection[i]));
    if (typeof data.editing === "string") grow(a, n, this.bounds(data.editing));
    if (a[n] <= a[n + 2]) n += 4;
    empty(a, n);
    const ids = this.relatedIds;
    let k =
      typeof data.editing === "string" ? this.related(data.editing, ids, 0) : 0;
    if (Array.isArray(data.preview))
      for (let i = 0; i < data.preview.length && i < 100 && k < 100; i++) {
        const id = data.preview[i]?.id;
        if (typeof id === "string") k = this.related(id, ids, k);
      }
    for (let i = 0; i < k; i++) grow(a, n, this.bounds(ids[i]));
    if (a[n] <= a[n + 2]) n += 4;
    return n;
  }
  membersOf(sender, sent = this.forwarded) {
    let members = sent.get(sender);
    if (!members) {
      sent.set(sender, (members = new Map()));
      if (sent.size > 512) sent.delete(sent.keys().next().value);
    }
    return members;
  }
  // Everyone receives and verifies everyone's view, so a member of this
  // group is passed a sender's view at most once a second, spaced as
  // presence is, unless it follows the sender or the view changes whom the
  // sender follows, the slide shown, or whether their hand is raised. The latest view held back goes once
  // the second has passed, so the member learns where the sender stopped.
  passesView(packet, member, now) {
    const { data, seq } = packet.body,
      sender = packet.ticket.session;
    if (member === sender) return false;
    if (this.views.get(member)?.following === sender) return true;
    const members = this.membersOf(sender, this.viewed),
      key = JSON.stringify([
        data?.following ?? null,
        data?.slide ?? null,
        data?.hand ?? null,
      ]);
    let state = members.get(member);
    if (state && seq <= Math.max(state.seq, state.pending?.body.seq ?? 0))
      return false;
    if (state && state.key === key && seq - state.time < SPACING) {
      state.pending = packet;
      state.arrived = now;
      state.due = now + state.time + SPACING - seq;
      this.heldViews.add(sender);
      this.heldTimer ??= setTimeout(() => this.release(), 100);
      return false;
    }
    if (!state) {
      members.set(member, (state = { member }));
      if (members.size > 64) members.delete(members.keys().next().value);
    }
    Object.assign(state, { seq, time: seq, key, pending: null });
    return true;
  }
  // Whether a sender's presence goes to a member of this group now. Starting
  // or ending settling, ending a preview or changing what is edited always
  // does, and so does the first packet after one near the member's view,
  // which moves it away.
  passes(packet, member, areas, now) {
    const { data, seq } = packet.body,
      sender = packet.ticket.session;
    if (member === sender) return false;
    const members = this.membersOf(sender);
    let state = members.get(member);
    const view = this.viewOf(member),
      close = !view || near(view, this.areas, areas);
    // Verification and the presence channel are unordered. An older packet
    // must not replace the latest one held back or regress the sent state.
    if (state && seq <= Math.max(state.seq, state.pending?.body.seq ?? 0))
      return close;
    if (
      state &&
      !close &&
      !state.near &&
      (data?.settling === true) === state.settling &&
      editingOf(data) === state.editing &&
      (hasPreview(data) || !state.preview) &&
      seq - state.time < SPACING
    ) {
      state.pending = packet;
      state.arrived = now;
      state.due = now + Math.max(QUIET, state.time + SPACING - seq);
      this.held.add(sender);
      this.heldTimer ??= setTimeout(() => this.release(), 100);
      return false;
    }
    if (!state) {
      members.set(member, (state = { member }));
      if (members.size > 64) members.delete(members.keys().next().value);
    }
    record(state, packet, seq, close);
    return true;
  }
  // Sends the presence and views held back whose time has come.
  release() {
    clearTimeout(this.heldTimer);
    this.heldTimer = null;
    if (this.closed) return;
    const now = Date.now();
    for (const sender of this.held) {
      let waiting = false,
        packet = null,
        areas = 0;
      for (const state of this.forwarded.get(sender)?.values() || []) {
        if (!state.pending) continue;
        if (now < state.due) {
          waiting = true;
          continue;
        }
        if (state.pending !== packet)
          areas = this.presenceAreas((packet = state.pending).body.data);
        const view = this.viewOf(state.member);
        // On the sender's clock, as spacing is measured.
        record(
          state,
          packet,
          packet.body.seq + now - state.arrived,
          !view || near(view, this.areas, areas),
        );
        const conn = this.links.get(state.member);
        if (conn?.whiteboardAuthorized) this.sendOn(conn, packet);
      }
      if (!waiting) this.held.delete(sender);
    }
    for (const sender of this.heldViews) {
      let waiting = false;
      for (const state of this.viewed.get(sender)?.values() || []) {
        const packet = state.pending;
        if (!packet) continue;
        if (now < state.due) {
          waiting = true;
          continue;
        }
        state.seq = packet.body.seq;
        state.time = packet.body.seq + now - state.arrived;
        state.pending = null;
        const conn = this.links.get(state.member);
        if (conn?.whiteboardAuthorized) this.sendOn(conn, packet);
      }
      if (!waiting) this.heldViews.delete(sender);
    }
    if (this.held.size || this.heldViews.size)
      this.heldTimer = setTimeout(() => this.release(), 100);
  }
  // Members of a large room learn of new relays at check-ins, which come
  // every 20 to 45 seconds. One whose relays have all gone asks for the
  // roster at once. Edits relayed while it has no link never reach it, so
  // it is also told to catch up, and again once a link returns.
  linkLost(id) {
    if (
      this.closed ||
      this.roster.length <= 8 ||
      this.isRelay ||
      !this.wanted?.has(id) ||
      [...this.links.values()].some(
        (l) => l.connected && l.whiteboardAuthorized,
      )
    )
      return;
    this.stranded = true;
    if (Date.now() - (this.rosterAsked || 0) < 10000) return;
    this.rosterAsked = Date.now();
    this.changed?.(true);
  }
  askPrimary() {
    const primary = this.plan?.primaryOf.get(this.session);
    if (!this.isRelay || this.roster.length <= 8 || primary === this.session)
      return;
    const link = this.links.get(primary);
    if (link?.whiteboardAuthorized && Date.now() - link.whiteboardHeard >= ASK)
      link.whiteboardAsk();
  }
  close() {
    this.closed = true;
    clearInterval(this.retry);
    clearInterval(this.watch);
    clearTimeout(this.again);
    clearTimeout(this.heldTimer);
    for (const conn of this.connections) conn.close();
    this.connections.clear();
    this.links.clear();
    this.server?.close();
    this.server = null;
  }
}
