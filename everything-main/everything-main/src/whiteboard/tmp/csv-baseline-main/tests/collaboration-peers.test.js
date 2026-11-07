import test from "node:test";
import assert from "node:assert/strict";
import { PeerNetwork } from "../src/collaboration/peers.js";
import { keyPair, sign } from "../src/collaboration/protocol.js";

import { createPeerHub } from "./peer-hub.js";

async function until(fn) {
  const deadline = Date.now() + 4000;
  while (!fn() && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 5));
  assert.ok(fn(), "Peer protocol completed before deadline");
}
test("signed peer packets cross relay groups, survive a primary departure, and reject forged identities", async () => {
  const puter = createPeerHub(),
    roomKey = await keyPair(),
    received = new Map(),
    networks = [];
  try {
    for (let i = 0; i < 65; i++) {
      const session = String(i).padStart(3, "0"),
        keys = await keyPair();
      const network = new PeerNetwork({
        puter,
        session,
        keys,
        roomKey: roomKey.publicKey,
        room: "test-room",
        receive: (kind, data, ticket) => {
          const messages = received.get(session) || [];
          messages.push({ kind, data, from: ticket.user });
          received.set(session, messages);
        },
      });
      networks.push(network);
      await network.serve();
    }
    const roster = networks.map((n) => ({
      room: "test-room",
      session: n.session,
      user: n.session,
      username: "User " + n.session,
      role: "editor",
      publicKey: n.keys.publicKey,
      expires: Date.now() + 90000,
      invite: n.server.inviteCode,
    }));
    const signatures = await Promise.all(
      roster.map((t) => sign(roomKey.privateKey, t)),
    );
    networks.forEach((n, i) => n.update(roster[i], signatures[i], roster));
    await until(() =>
      networks.every((n) =>
        [...n.wanted].every((id) => n.links.get(id)?.whiteboardAuthorized),
      ),
    );
    puter.stats.sends = 0;
    await networks[10].broadcast("presence", { cursor: { x: 42, y: 55 } });
    await until(() => received.size === 64);
    assert.ok(
      puter.stats.sends < 300,
      "Relay traffic is bounded instead of flooding the relay mesh",
    );
    for (const messages of received.values()) {
      assert.equal(messages.length, 1);
      assert.equal(messages[0].from, "010");
    }
    received.clear();
    networks[0].close();
    await networks[10].broadcast("edit", { update: "test" });
    await until(() => received.size === 63);
    received.clear();
    const body = { v: 1, seq: 999, kind: "edit", data: { update: "forged" } };
    const packet = {
      body,
      ticket: roster[11],
      signature: signatures[11],
      proof: await sign(networks[10].keys.privateKey, body),
    };
    for (const conn of networks[10].links.values())
      conn.send(JSON.stringify(packet));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(received.size, 0);
  } finally {
    for (const network of networks) network.close();
  }
});
test("a failed handshake releases the connection slot so reconnect can retry", async () => {
  const puter = createPeerHub(),
    keys = await keyPair(),
    roomKey = await keyPair();
  const network = new PeerNetwork({
    puter,
    session: "a",
    keys,
    roomKey: roomKey.publicKey,
    room: "r",
    receive() {},
  });
  const remote = await puter.peer.serve();
  remote.addEventListener("connection", (event) =>
    setTimeout(() => event.conn.close(), 0),
  );
  try {
    const ticket = {
      room: "r",
      session: "a",
      user: "a",
      publicKey: keys.publicKey,
      expires: Date.now() + 90000,
      role: "editor",
    };
    network.update(ticket, await sign(roomKey.privateKey, ticket), [
      ticket,
      { session: "b", invite: remote.inviteCode },
    ]);
    await until(
      () => network.connections.size === 0 && !network.links.has("b"),
    );
    network.reconcile();
    assert.ok(network.links.has("b"), "A fresh attempt can reserve the slot");
  } finally {
    network.close();
    remote.close();
  }
});

test("disconnecting during identity verification cannot resurrect a dead link", async () => {
  const puter = createPeerHub(),
    roomKey = await keyPair(),
    networks = [],
    received = [];
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  try {
    for (const session of ["a", "b"]) {
      const n = new PeerNetwork({
        puter,
        session,
        keys: await keyPair(),
        roomKey: roomKey.publicKey,
        room: "verification-race",
        receive: (kind) => received.push(kind),
      });
      networks.push(n);
      await n.serve();
    }
    const roster = networks.map((n) => ({
      room: n.room,
      session: n.session,
      user: n.session,
      role: "editor",
      publicKey: n.keys.publicKey,
      expires: Date.now() + 90000,
      invite: n.server.inviteCode,
    }));
    let verifying = false;
    const validTicket = networks[0].validTicket.bind(networks[0]);
    networks[0].validTicket = async (packet) => {
      verifying = true;
      await gate;
      return validTicket(packet);
    };
    const signatures = await Promise.all(
      roster.map((ticket) => sign(roomKey.privateKey, ticket)),
    );
    for (const [i, n] of networks.entries())
      n.update(roster[i], signatures[i], roster);
    await until(() => verifying);
    const closed = [...networks[0].connections][0];
    closed.close();
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(
      networks[0].links.has("b"),
      false,
      "A completed asynchronous handshake cannot reinsert a closed connection",
    );
    networks[0].reconcile();
    await until(() =>
      networks.every((n) =>
        [...n.links.values()].some(
          (c) => c.connected && c.whiteboardAuthorized,
        ),
      ),
    );
    assert.notEqual(networks[0].links.get("b"), closed);
    await networks[0].broadcast("view-left", { at: Date.now() });
    networks[0].close();
    await until(() => received.includes("view-left"));
  } finally {
    release();
    for (const n of networks) n.close();
  }
});

test("a participant cannot relay another peer's challenge answer to take over their link", async () => {
  const puter = createPeerHub(),
    roomKey = await keyPair(),
    received = [];
  const make = async (session, receive = () => {}) => {
    const network = new PeerNetwork({
      puter,
      session,
      keys: await keyPair(),
      roomKey: roomKey.publicKey,
      room: "room",
      receive,
    });
    await network.serve();
    return network;
  };
  const b = await make("b", (kind) => received.push(kind)),
    v = await make("v");
  const attacker = await keyPair();
  const ticket = (session, role, publicKey, invite) => ({
    room: "room",
    session,
    user: session,
    username: session,
    role,
    publicKey,
    expires: Date.now() + 90000,
    invite,
  });
  const roster = [
    ticket("b", "editor", b.keys.publicKey, b.server.inviteCode),
    ticket("v", "editor", v.keys.publicKey, v.server.inviteCode),
    ticket("a", "viewer", attacker.publicKey, "none"),
  ];
  const signatures = await Promise.all(
    roster.map((t) => sign(roomKey.privateKey, t)),
  );
  b.update(roster[0], signatures[0], roster);
  v.update(roster[1], signatures[1], roster);
  try {
    await until(() => v.links.get("b")?.whiteboardAuthorized);
    const genuine = v.links.get("b");
    // The attacker passes V's challenge to B and B's answer back to V.
    const toV = await puter.peer.connect(v.server.inviteCode),
      toB = await puter.peer.connect(b.server.inviteCode);
    const opened = new Promise((resolve) =>
      toB.addEventListener("open", resolve),
    );
    let challenge,
      relayed = false;
    toV.addEventListener("message", (e) => {
      const packet = JSON.parse(e.data);
      if (packet.challenge && !packet.hello && !challenge) {
        challenge = packet.challenge;
        opened.then(() => toB.send(JSON.stringify({ challenge })));
      }
    });
    toB.addEventListener("message", (e) => {
      const packet = JSON.parse(e.data);
      if (packet.hello && packet.challenge === challenge) {
        relayed = true;
        toV.send(e.data);
      }
    });
    await until(() => relayed);
    await until(() => toV.closed);
    assert.equal(v.links.get("b"), genuine);
    assert.equal(genuine.closed, false);
    await v.broadcast("presence", { cursor: { x: 1, y: 1 } });
    await until(() => received.includes("presence"));
  } finally {
    b.close();
    v.close();
  }
});

test("a network rebuilt for the same session numbers its packets above the previous one", async () => {
  const puter = createPeerHub(),
    roomKey = await keyPair(),
    received = [];
  const b = new PeerNetwork({
    puter,
    session: "b",
    keys: await keyPair(),
    roomKey: roomKey.publicKey,
    room: "room",
    receive: (kind, data, ticket, seq) => received.push(seq),
  });
  await b.serve();
  const connect = async () => {
    const a = new PeerNetwork({
      puter,
      session: "a",
      keys: await keyPair(),
      roomKey: roomKey.publicKey,
      room: "room",
      receive() {},
    });
    await a.serve();
    const roster = [a, b].map((n) => ({
      room: "room",
      session: n.session,
      user: n.session,
      username: n.session,
      role: "editor",
      publicKey: n.keys.publicKey,
      expires: Date.now() + 90000,
      invite: n.server.inviteCode,
    }));
    const signatures = await Promise.all(
      roster.map((t) => sign(roomKey.privateKey, t)),
    );
    a.update(roster[0], signatures[0], roster);
    b.update(roster[1], signatures[1], roster);
    await until(() => a.links.get("b")?.whiteboardAuthorized);
    return a;
  };
  const networks = [b];
  try {
    const first = await connect();
    networks.push(first);
    for (let i = 0; i < 5; i++) await first.broadcast("presence", {});
    await until(() => received.length === 5);
    first.close();
    const second = await connect();
    networks.push(second);
    await second.broadcast("presence", {});
    await until(() => received.length === 6);
    assert.ok(received[5] > Math.max(...received.slice(0, 5)));
  } finally {
    for (const network of networks) network.close();
  }
});

test("peers on a device whose clock runs ahead still accept current tickets", async () => {
  const puter = createPeerHub(),
    roomKey = await keyPair(),
    networks = [];
  // Tickets carry the server's expiry; this device's clock is 70 s ahead.
  const server = Date.now;
  try {
    for (const [session, offset] of [
      ["a", 0],
      ["b", 70_000],
    ]) {
      const network = new PeerNetwork({
        puter,
        session,
        keys: await keyPair(),
        roomKey: roomKey.publicKey,
        room: "clock-room",
        receive: () => {},
        now: () => server(),
      });
      if (offset) {
        const check = network.validTicket;
        network.validTicket = function (packet) {
          const clock = Date.now;
          Date.now = () => clock() + offset;
          try {
            return check.call(this, packet);
          } finally {
            Date.now = clock;
          }
        };
      }
      networks.push(network);
      await network.serve();
    }
    // Checked in 40 s ago: 50 s of the tickets' 90 s remain.
    const roster = networks.map((n) => ({
      room: "clock-room",
      session: n.session,
      user: n.session,
      username: n.session,
      role: "editor",
      publicKey: n.keys.publicKey,
      expires: server() + 50_000,
      invite: n.server.inviteCode,
    }));
    const signatures = await Promise.all(
      roster.map((t) => sign(roomKey.privateKey, t)),
    );
    networks.forEach((n, i) => n.update(roster[i], signatures[i], roster));
    await until(() =>
      networks.every((n) =>
        [...n.wanted].every((id) => n.links.get(id)?.whiteboardAuthorized),
      ),
    );
  } finally {
    for (const n of networks) n.close();
  }
});

test("a slow peer service does not make each reconnection pass check in again", async () => {
  let resolve;
  const puter = {
    peer: { serve: () => new Promise((r) => (resolve = r)) },
  };
  let changes = 0;
  const network = new PeerNetwork({
    puter,
    session: "a",
    keys: await keyPair(),
    roomKey: (await keyPair()).publicKey,
    room: "slow-room",
    receive: () => {},
    changed: () => changes++,
  });
  try {
    network.ticket = {};
    network.roster = [];
    network.wanted = new Set();
    for (let n = 0; n < 3; n++) {
      network.reconcile();
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(changes, 0, "No check-in while the service is still starting");
    resolve({
      inviteCode: "code",
      addEventListener() {},
      close() {},
    });
    await until(() => network.server);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(changes, 1, "The new invite code is published once");
  } finally {
    network.close();
  }
});

test("a dial refused while connections are full is tried again later", async () => {
  const network = new PeerNetwork({
    puter: { peer: {} },
    session: "a",
    keys: await keyPair(),
    roomKey: (await keyPair()).publicKey,
    room: "full-room",
    receive: () => {},
  });
  try {
    const held = Array.from({ length: 64 }, () => ({ close() {} }));
    for (const conn of held) network.connections.add(conn);
    network.links.set("held", held[0]);
    const pending = { close() {} };
    network.links.set("b", pending);
    let closed = false;
    network.attach({ close: () => (closed = true) }, "b");
    assert.equal(closed, true);
    assert.equal(network.links.has("b"), false);
    // Links already made are kept.
    network.attach({ close() {} }, "held");
    assert.equal(network.links.get("held"), held[0]);
  } finally {
    network.close();
  }
});

test("packets sent before this end has checked the sender's hello wait for it instead of being lost", async () => {
  const roomKey = await keyPair(),
    received = [];
  const make = async (session) =>
    new PeerNetwork({
      puter: { peer: {} },
      session,
      keys: await keyPair(),
      roomKey: roomKey.publicKey,
      room: "early-room",
      receive: (kind, data) => received.push([kind, data]),
    });
  const a = await make("a"),
    b = await make("b");
  try {
    const roster = [a, b].map((n) => ({
      room: "early-room",
      session: n.session,
      user: n.session,
      username: n.session,
      role: "editor",
      publicKey: n.keys.publicKey,
      expires: Date.now() + 90_000,
    }));
    const signatures = await Promise.all(
      roster.map((t) => sign(roomKey.privateKey, t)),
    );
    b.update(roster[1], signatures[1], roster);
    const sent = [],
      listeners = {};
    const conn = {
      connected: true,
      send: (data) => sent.push(JSON.parse(data)),
      addEventListener: (type, fn) => (listeners[type] = fn),
      close() {
        this.connected = false;
        listeners.close?.();
      },
    };
    b.attach(conn);
    const { challenge } = sent.find((p) => p.challenge && !p.hello);
    const deliver = (packet) =>
      listeners.message({ data: JSON.stringify(packet) });
    // A already trusts B and sends an edit before B has checked A's hello.
    const body = { v: 1, seq: 1, kind: "committed", data: { id: "x" } };
    await deliver({
      ticket: roster[0],
      signature: signatures[0],
      body,
      proof: await sign(a.keys.privateKey, body),
    });
    assert.deepEqual(received, []);
    await deliver({
      hello: true,
      challenge,
      ticket: roster[0],
      signature: signatures[0],
      proof: await sign(a.keys.privateKey, {
        challenge,
        session: "a",
        local: [],
        remote: [],
      }),
    });
    await until(() => received.length === 1);
    assert.deepEqual(received, [["committed", { id: "x" }]]);
  } finally {
    a.close();
    b.close();
  }
});

test("a viewer's notice of a save is ignored rather than making everyone synchronize", async () => {
  const roomKey = await keyPair(),
    received = [];
  const make = async (session) =>
    new PeerNetwork({
      puter: { peer: {} },
      session,
      keys: await keyPair(),
      roomKey: roomKey.publicKey,
      room: "viewer-room",
      receive: (kind, data) => received.push(kind),
    });
  const a = await make("a"),
    b = await make("b");
  try {
    const roster = [a, b].map((n, index) => ({
      room: "viewer-room",
      session: n.session,
      user: n.session,
      username: n.session,
      role: index ? "editor" : "viewer",
      publicKey: n.keys.publicKey,
      expires: Date.now() + 90_000,
    }));
    const signatures = await Promise.all(
      roster.map((t) => sign(roomKey.privateKey, t)),
    );
    b.update(roster[1], signatures[1], roster);
    const sent = [],
      listeners = {};
    b.attach({
      connected: true,
      send: (data) => sent.push(JSON.parse(data)),
      addEventListener: (type, fn) => (listeners[type] = fn),
      close() {
        this.connected = false;
        listeners.close?.();
      },
    });
    const { challenge } = sent.find((p) => p.challenge && !p.hello);
    const deliver = (packet) =>
      listeners.message({ data: JSON.stringify(packet) });
    await deliver({
      hello: true,
      challenge,
      ticket: roster[0],
      signature: signatures[0],
      proof: await sign(a.keys.privateKey, {
        challenge,
        session: "a",
        local: [],
        remote: [],
      }),
    });
    for (const [seq, kind] of [
      [1, "committed"],
      [2, "presence"],
    ]) {
      const body = { v: 1, seq, kind, data: { id: "x" } };
      await deliver({
        ticket: roster[0],
        signature: signatures[0],
        body,
        proof: await sign(a.keys.privateKey, body),
      });
    }
    await until(() => received.length);
    assert.deepEqual(received, ["presence"]);
  } finally {
    a.close();
    b.close();
  }
});
