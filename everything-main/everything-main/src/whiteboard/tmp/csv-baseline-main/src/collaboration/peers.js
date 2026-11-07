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
    now = () => Date.now(),
  }) {
    Object.assign(this, {
      puter,
      session,
      keys,
      roomKey,
      room,
      receive,
      changed,
      now,
    });
    this.links = new Map();
    this.connections = new Set();
    this.roster = [];
    this.seen = new Set();
    this.verified = new Map();
    this.closed = false;
    this.retry = setInterval(() => this.reconcile(), 5000);
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
    this.reconcile();
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
    const open = () => this.sendOn(conn, { challenge });
    conn.addEventListener("open", open);
    if (conn.connected) open();
    const close = () => {
      ended = true;
      early.length = 0;
      clearTimeout(timeout);
      clearInterval(heartbeat);
      soft?.close();
      this.connections.delete(conn);
      for (const [id, link] of this.links)
        if (link === conn) this.links.delete(id);
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
          alive = Date.now();
          for (const waiting of early.splice(0)) message(waiting);
          return;
        }
        if (!authorized) {
          if (packet.body && early.length < 8) early.push(event);
          return;
        }
        if (!(await this.validTicket(packet))) return;
        const { body, ticket } = packet;
        if (
          body?.v !== PROTOCOL ||
          !Number.isSafeInteger(body.seq) ||
          !(await verify(ticket.publicKey, body, packet.proof))
        )
          return;
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
        const key = `${ticket.session}:${body.seq}`;
        if (this.seen.has(key)) return;
        this.seen.add(key);
        if (this.seen.size > 4096)
          this.seen.delete(this.seen.values().next().value);
        alive = Date.now();
        await this.receive(body.kind, body.data, ticket, body.seq);
        if (this.isRelay && this.roster.length > 8) this.fanout(packet, conn);
      } catch {
        /* Ignore malformed packets; durable state is recovered separately. */
      }
    };
    conn.addEventListener("message", message);
    if (soft) soft.onmessage = message;
  }
  async validTicket(packet) {
    const t = packet.ticket;
    if (
      !t ||
      t.room !== this.room ||
      t.expires < this.now() ||
      !this.roster.some(
        (p) =>
          p.session === t.session && p.user === t.user && p.role === t.role,
      )
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
      if (packet.body?.kind === "presence") {
        const channel = conn.whiteboardPresence;
        if (channel?.readyState === "open" && channel.bufferedAmount < 16384)
          channel.send(JSON.stringify(packet));
      } else conn.send(JSON.stringify(packet));
    } catch {
      /* Reconnection will repair the link. */
    }
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
    const primaryConnected = this.links.get(primary)?.whiteboardAuthorized;
    for (const [id, conn] of this.links) {
      if (conn === except) continue;
      if (
        this.roster.length > 8 &&
        this.isRelay &&
        this.plan.groupOf.get(id) !== group
      ) {
        if (
          sourceGroup !== group ||
          (primary !== this.session && primaryConnected)
        )
          continue;
      }
      this.sendOn(conn, packet);
    }
  }
  close() {
    this.closed = true;
    clearInterval(this.retry);
    for (const conn of this.connections) conn.close();
    this.connections.clear();
    this.links.clear();
    this.server?.close();
    this.server = null;
  }
}
