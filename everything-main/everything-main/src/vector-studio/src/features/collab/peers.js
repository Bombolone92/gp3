/**
 * Direct peer links between the people in a shared document (Puter's
 * peer service, WebRTC), for live cursors, selections, views and prompt
 * "an edit was saved" notices. Saved edits never travel here: they go
 * through the server, which orders them.
 *
 * Up to MAX_MESH sessions link to each other directly; larger rooms rely
 * on the server's presence check-ins alone. Each link is authenticated
 * both ways: the server signs a short-lived ticket naming the session,
 * account, role and a session public key, and each side proves it holds
 * that key by signing a challenge from the other side.
 */
import { sign, verify } from './protocol.js';

export const MAX_MESH = 8;
const CONNECT_TIMEOUT = 12000;
const RETRY_MS = 5000;

export class PeerMesh {
  constructor({ puter, session, keys, roomKey, room, receive, changed = () => {}, now = () => Date.now() }) {
    Object.assign(this, { puter, session, keys, roomKey, room, receive, changed, now });
    this.links = new Map(); // session -> conn (authorized) or a pending placeholder
    this.roster = [];
    this.ticket = null;
    this.closed = false;
    this.retry = setInterval(() => this.reconcile(), RETRY_MS);
  }

  get available() {
    return Boolean(this.puter?.peer?.serve && this.puter.peer.connect);
  }

  /** Start accepting links; resolves to the invite code others dial. */
  async serve() {
    if (!this.available || this.closed) return null;
    if (this.server) return this.server.inviteCode || null;
    if (!this.serving) {
      this.serving = (async () => {
        let timer;
        try {
          const server = await Promise.race([this.puter.peer.serve(), new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('Peer service timed out.')), CONNECT_TIMEOUT)))]);
          if (this.closed) {
            server.close?.();
            return null;
          }
          this.server = server;
          server.addEventListener?.('connection', (e) => this.attach(e.conn));
          server.addEventListener?.('close', () => {
            if (this.server === server) this.server = null;
            this.changed();
          });
          server.addEventListener?.('reconnect', () => this.changed());
          return server.inviteCode || null;
        } catch {
          return null;
        } finally {
          clearTimeout(timer);
          this.serving = null;
        }
      })();
    }
    return this.serving;
  }

  get invite() {
    return this.server?.inviteCode || null;
  }

  /** New ticket and roster from a presence check-in. */
  update(ticket, signature, roster) {
    this.ticket = ticket;
    this.signature = signature;
    this.roster = roster;
    this.reconcile();
  }

  wanted() {
    if (this.roster.length > MAX_MESH) return new Set();
    return new Set(this.roster.map((p) => p.session).filter((s) => s !== this.session));
  }

  reconcile() {
    if (this.closed || !this.ticket || !this.available) return;
    const wanted = this.wanted();
    for (const [id, link] of this.links) {
      if (!wanted.has(id)) {
        link.close?.();
        this.links.delete(id);
      }
    }
    for (const peer of this.roster) {
      // The session with the smaller id dials; the other accepts.
      if (!wanted.has(peer.session) || peer.session < this.session || !peer.invite || this.links.has(peer.session)) continue;
      const pending = { close() {}, pending: true };
      this.links.set(peer.session, pending);
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        if (this.links.get(peer.session) === pending) this.links.delete(peer.session);
      }, CONNECT_TIMEOUT);
      Promise.resolve()
        .then(() => this.puter.peer.connect(peer.invite))
        .then((conn) => {
          clearTimeout(timer);
          if (expired || this.closed || !this.wanted().has(peer.session)) {
            conn?.close?.();
            return;
          }
          this.attach(conn, peer.session);
        })
        .catch(() => {
          clearTimeout(timer);
          if (this.links.get(peer.session) === pending) this.links.delete(peer.session);
        });
    }
  }

  /** Authenticate a connection (both directions), then deliver its packets. */
  attach(conn, expected = null) {
    if (!conn || this.closed) {
      conn?.close?.();
      if (expected && this.links.get(expected)?.pending) this.links.delete(expected);
      return;
    }
    if (expected) this.links.set(expected, conn);
    const challenge = crypto.randomUUID();
    let peer = null;
    let ended = false;
    const send = (packet) => {
      try {
        conn.send(JSON.stringify(packet));
      } catch {
        // Reconnection repairs the link.
      }
    };
    const ask = () => send({ challenge });
    const timeout = setTimeout(() => {
      if (!peer) conn.close?.();
    }, CONNECT_TIMEOUT);
    const close = () => {
      if (ended) return;
      ended = true;
      clearTimeout(timeout);
      for (const [id, link] of this.links) if (link === conn) this.links.delete(id);
      if (peer) this.receive('left', null, peer);
      this.changed();
    };
    conn.addEventListener('open', ask);
    if (conn.connected) ask();
    conn.addEventListener('close', close);
    conn.addEventListener('error', () => {
      conn.close?.();
      close();
    });
    conn.addEventListener('message', async (event) => {
      try {
        if (ended || this.closed || typeof event.data !== 'string' || event.data.length > 64000) return;
        const packet = JSON.parse(event.data);
        if (typeof packet.challenge === 'string' && !packet.hello && packet.challenge.length < 100) {
          if (!this.ticket) return;
          const proof = await sign(this.keys.privateKey, { challenge: packet.challenge, session: this.session });
          send({ hello: true, challenge: packet.challenge, ticket: this.ticket, signature: this.signature, proof });
          return;
        }
        if (packet.hello) {
          const t = packet.ticket;
          const ok = packet.challenge === challenge && (await this.validTicket(t, packet.signature)) && (await verify(t.publicKey, { challenge, session: t.session }, packet.proof)) && (!expected || t.session === expected) && this.wanted().has(t.session);
          if (!ok) {
            conn.close?.();
            return;
          }
          if (ended || this.closed) return;
          peer = t;
          const prior = this.links.get(t.session);
          if (prior && prior !== conn) prior.close?.();
          this.links.set(t.session, conn);
          conn.vsAuthorized = true;
          this.changed();
          return;
        }
        if (!peer || !packet.kind) return;
        // Viewers never save edits, so their "saved" notices are ignored.
        if (packet.kind === 'committed' && peer.role === 'viewer') return;
        this.receive(packet.kind, packet.data, peer);
      } catch {
        // Malformed packets are ignored; saved state is recovered from the server.
      }
    });
  }

  async validTicket(t, signature) {
    if (!t || t.room !== this.room || !Number.isFinite(t.expires) || t.expires < this.now()) return false;
    if (!this.roster.some((p) => p.session === t.session && p.user === t.user && p.role === t.role)) return false;
    return verify(this.roomKey, t, signature);
  }

  /** Send to every authenticated link. */
  broadcast(kind, data) {
    if (this.closed) return;
    const text = JSON.stringify({ kind, data });
    if (text.length > 64000) return;
    for (const conn of this.links.values()) {
      if (!conn.vsAuthorized || conn.connected === false) continue;
      try {
        conn.send(text);
      } catch {
        // The retry loop reconnects.
      }
    }
  }

  /** Sessions with an authenticated link. */
  linked() {
    return [...this.links].filter(([, c]) => c.vsAuthorized).map(([id]) => id);
  }

  close() {
    this.closed = true;
    clearInterval(this.retry);
    for (const conn of this.links.values()) conn.close?.();
    this.links.clear();
    this.server?.close?.();
    this.server = null;
  }
}
