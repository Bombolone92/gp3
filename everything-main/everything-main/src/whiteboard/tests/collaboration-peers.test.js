import test from "node:test";
import assert from "node:assert/strict";
import { PeerNetwork } from "../src/collaboration/peers.js";
import { keyPair, sign } from "../src/collaboration/protocol.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { item } from "../src/model.js";

import { createPeerHub } from "./peer-hub.js";

async function until(fn) {
  const deadline = Date.now() + 10000;
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
test("packets reach everyone through lasting peer groups, also after a primary relay leaves", async () => {
  const puter = createPeerHub(),
    roomKey = await keyPair(),
    received = new Map(),
    networks = [];
  try {
    for (let i = 0; i < 65; i++) {
      const session = crypto.randomUUID(),
        keys = await keyPair();
      const network = new PeerNetwork({
        puter,
        session,
        keys,
        roomKey: roomKey.publicKey,
        room: "test-room",
        receive: (kind, data, ticket) => {
          const messages = received.get(session) || [];
          messages.push({ kind, from: ticket.user });
          received.set(session, messages);
        },
      });
      networks.push(network);
      await network.serve();
    }
    // Groups as the worker fills them: in order of joining.
    const roster = networks.map((n, i) => ({
      room: "test-room",
      session: n.session,
      user: "user-" + i,
      username: "User " + i,
      role: "editor",
      publicKey: n.keys.publicKey,
      topology: 2,
      group: Math.floor(i / 32),
      since: i,
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
    assert.ok(networks[0].isRelay && networks[1].isRelay);
    assert.ok(!networks[40].isRelay);
    puter.stats.sends = 0;
    await networks[40].broadcast("presence", { cursor: { x: 1, y: 2 } });
    await until(() => received.size === 64);
    assert.ok(puter.stats.sends < 300, `${puter.stats.sends} sends`);
    for (const messages of received.values()) assert.equal(messages.length, 1);
    received.clear();
    // The first group's primary relay leaves; its other relay takes over.
    networks[0].close();
    await networks[10].broadcast("edit", { update: "test" });
    await until(() => received.size === 63);
  } finally {
    for (const network of networks) network.close();
  }
});
// A room in lasting groups of 32, whose members record what they receive.
// `refuse` stands in for a session that refuses a packet, as one past its
// sender's limit.
async function peerRoom(count, bounds, related, refuse) {
  const puter = createPeerHub(),
    roomKey = await keyPair(),
    received = new Map(),
    networks = [];
  for (let i = 0; i < count; i++) {
    const session = String(i).padStart(3, "0");
    received.set(session, []);
    const network = new PeerNetwork({
      puter,
      session,
      keys: await keyPair(),
      roomKey: roomKey.publicKey,
      room: "view-room",
      bounds,
      related,
      receive: (kind, data, ticket) => {
        received
          .get(session)
          .push({ kind, data, from: ticket.session, at: Date.now() });
        return refuse?.(kind, data, session);
      },
    });
    networks.push(network);
    await network.serve();
  }
  const roster = networks.map((n, i) => ({
    room: "view-room",
    session: n.session,
    user: n.session,
    username: n.session,
    role: "editor",
    publicKey: n.keys.publicKey,
    topology: 2,
    group: Math.floor(i / 32),
    since: i,
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
  // Each step a sender's presence reached a session, in order.
  const steps = (session, from) =>
    received
      .get(session)
      .filter((m) => m.kind === "presence" && m.from === from)
      .map((m) => m.data.step);
  return { networks, received, steps, puter, roomKey };
}
// Cameras 10,000 apart, so no view is near another's.
const camera = (i) => ({ x: i * 10000, y: 0, w: 1000, h: 800 });
const far = { x: 0, y: 50000 };
for (const reordered of [false, true])
  test(`relays pass on presence in full only near each member's view, and the rest once a second${reordered ? " with reordered verification" : ""}`, async () => {
    const note = { x: 120000 - 50, y: -50, w: 100, h: 100 };
    const { networks, received, steps } = await peerRoom(40, (id) =>
      id === "note" ? note : null,
    );
    try {
      // 36 sends; 10 and 37 look where its cursor goes, in each group, and 12
      // where the object it selects is; 20 shares no view. 0, 1, 32 and 33
      // relay.
      const sender = networks[36],
        cursor = [10, 37],
        selected = [12],
        unknown = [20],
        relays = [0, 1, 32, 33];
      assert.ok(relays.every((i) => networks[i].isRelay));
      if (reordered)
        for (const index of [32, 33]) {
          const n = networks[index],
            check = n.check.bind(n),
            fanout = n.fanout.bind(n);
          let later = false,
            release;
          n.check = async (packet) => {
            const valid = await check(packet);
            if (
              packet.body.kind === "presence" &&
              packet.body.data.step === 14 &&
              !later
            )
              await new Promise((resolve) => (release = resolve));
            return valid;
          };
          n.fanout = (packet, except) => {
            fanout(packet, except);
            if (
              packet.body.kind === "presence" &&
              packet.body.data.step === 15
            ) {
              later = true;
              release?.();
            }
          };
        }
      const viewers = networks.filter((n, i) => !unknown.includes(i));
      for (const [i, n] of networks.entries())
        if (!unknown.includes(i))
          await n.broadcast("view", {
            camera: camera(i === 37 ? 10 : i),
            following: null,
            at: Date.now(),
          });
      await until(() =>
        networks.every(
          (n) =>
            received.get(n.session).filter((m) => m.kind === "view").length ===
            viewers.filter((v) => v !== n).length,
        ),
      );
      const others = networks.filter((n) => n !== sender).map((n) => n.session);
      const sent = [];
      const send = async (data) => {
        sent.push(data);
        await sender.broadcast("presence", { step: sent.length, ...data });
      };
      // Settling, ending a preview and starting or ending an edit reach
      // everyone, though all of it is far from every view. Settling again
      // does not.
      await send({ cursor: far, preview: [{ id: "x", ...far, w: 9, h: 9 }] });
      await send({ cursor: far, preview: [] });
      await send({ cursor: far, settling: true });
      await send({ cursor: far, settling: true });
      await send({ cursor: far, editing: "draft" });
      await send({ cursor: far, editing: null });
      await until(() =>
        others.every((s) => steps(s, sender.session).length >= 5),
      );
      const forced = Date.now();
      await send({ cursor: far });
      // Where 10 and 37 look.
      for (let k = 0; k < 5; k++)
        await send({ cursor: { x: 100000 + k * 10, y: k } });
      // Far away, with an object selected where 12 looks.
      for (let k = 0; k < 3; k++)
        await send({ cursor: { ...far, x: k }, selection: ["note"] });
      // Edits are not held back with presence.
      for (let k = 0; k < 3; k++)
        await sender.broadcast("edit", { update: String(k) });
      const all = sent.map((_, i) => i + 1);
      await until(() =>
        others.every(
          (s) =>
            received
              .get(s)
              .filter((m) => m.kind === "edit" && m.from === sender.session)
              .length === 3,
        ),
      );
      for (const i of cursor)
        await until(() =>
          [8, 9, 10, 11, 12].every((n) =>
            steps(networks[i].session, sender.session).includes(n),
          ),
        );
      for (const i of selected)
        await until(() =>
          [13, 14, 15].every((n) =>
            steps(networks[i].session, sender.session).includes(n),
          ),
        );
      for (const i of [...unknown, ...relays])
        await until(
          () =>
            steps(networks[i].session, sender.session).length === all.length,
        );
      const distant = networks.filter(
        (n, i) =>
          n !== sender &&
          ![...cursor, ...selected, ...unknown, ...relays].includes(i),
      );
      await new Promise((r) => setTimeout(r, 50));
      assert.ok(Date.now() - forced < 900, "Checked within the second");
      // Presence uses an unordered channel and asynchronous verification. Check
      // which packets arrive; the session applies their sequence numbers.
      for (const n of distant)
        assert.deepEqual(
          steps(n.session, sender.session).sort((a, b) => a - b),
          [1, 2, 3, 5, 6],
        );
      // The latest presence reaches everyone once a second has passed.
      await until(() =>
        others.every((s) => steps(s, sender.session).includes(15)),
      );
      for (const n of distant) {
        assert.deepEqual(
          steps(n.session, sender.session).sort((a, b) => a - b),
          [1, 2, 3, 5, 6, 15],
        );
        const times = received
          .get(n.session)
          .filter((m) => m.kind === "presence" && m.from === sender.session)
          .map((m) => m.at);
        assert.ok(times[5] - times[4] >= 900, `${times[5] - times[4]} ms`);
      }
      for (const i of [...unknown, ...relays])
        assert.deepEqual(
          steps(networks[i].session, sender.session).sort((a, b) => a - b),
          all,
        );
    } finally {
      for (const network of networks) network.close();
    }
  });
test("live reactions reach everyone through relays, which do not pass on those their session refused", async () => {
  // Relays refuse a sender's reactions past the third, as sessions do past
  // their limit; versions that know nothing of reactions take them as any
  // other packet, which relays pass on whole.
  const { networks, received } = await peerRoom(
    40,
    undefined,
    undefined,
    (kind, data) => (kind === "reaction" && data.n >= 3 ? false : undefined),
  );
  try {
    const sender = networks[20];
    assert.ok(!sender.isRelay);
    for (let n = 0; n < 6; n++)
      await sender.broadcast("reaction", { type: "heart", n, at: Date.now() });
    const others = networks.filter((n) => n !== sender);
    const reactions = (session) =>
      received
        .get(session)
        .filter((m) => m.kind === "reaction")
        .map((m) => m.data.n);
    await until(() => others.every((n) => reactions(n.session).includes(2)));
    await new Promise((r) => setTimeout(r, 100));
    for (const network of others) {
      const got = reactions(network.session);
      // A relay hears the sender directly; everyone else only what a
      // relay passed on.
      if (network.isRelay && network.wanted.has(sender.session))
        assert.deepEqual(got.sort(), [0, 1, 2, 3, 4, 5]);
      else
        assert.deepEqual(got.sort(), [0, 1, 2], `${network.session}: ${got}`);
    }
  } finally {
    for (const network of networks) network.close();
  }
});
test("relays pass on in full the presence that moves connectors in a member's view", async () => {
  // A, far from every view, is dragged and then typed in. Connector C runs
  // from A to B, where 10 looks. Connector D runs from A to E, where 12
  // looks, though its own box, as last saved, is still by A. 14 looks
  // elsewhere.
  const at = (id, type, x, y, extra) => ({ ...item(type, x, y, extra), id });
  const doc = new SharedDocument();
  doc.commit({
    version: 1,
    id: "board",
    title: "Connectors",
    items: [
      at("a", "rect", 0, 50000),
      at("b", "rect", 100000, 0),
      at("e", "rect", 120000, 0),
      at("c", "arrow", 95, 50000, {
        w: 99905,
        h: -49840,
        startId: "a",
        endId: "b",
      }),
      at("d", "arrow", 95, 50000, { w: 10, h: 10, startId: "a", endId: "e" }),
    ],
  });
  const { networks, received, steps } = await peerRoom(
    40,
    (id) => doc.items.get(id)?.get("geometry"),
    (id, out, n) => doc.related(id, out, n),
  );
  try {
    const sender = networks[36];
    for (const [i, n] of networks.entries())
      await n.broadcast("view", {
        camera: camera(i),
        following: null,
        at: Date.now(),
      });
    await until(() =>
      networks.every(
        (n) =>
          received.get(n.session).filter((m) => m.kind === "view").length ===
          39,
      ),
    );
    const started = Date.now();
    for (let k = 1; k <= 5; k++)
      await sender.broadcast("presence", {
        step: k,
        cursor: far,
        preview: [{ id: "a", x: k, y: 50000, w: 190, h: 160 }],
      });
    for (let k = 6; k <= 8; k++)
      await sender.broadcast("presence", {
        step: k,
        cursor: far,
        editing: "a",
        text: "x".repeat(k),
      });
    const all = [1, 2, 3, 4, 5, 6, 7, 8];
    await until(() =>
      ["010", "012"].every((s) => steps(s, "036").length === all.length),
    );
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(Date.now() - started < 900, "Checked within the second");
    // Presence travels on an unordered channel, so a busy machine can
    // deliver two packets the other way round; each must arrive in full.
    for (const s of ["010", "012"])
      assert.deepEqual(
        steps(s, "036").toSorted((a, b) => a - b),
        all,
      );
    assert.deepEqual(steps("014", "036"), [1, 6]);
  } finally {
    for (const network of networks) network.close();
    doc.destroy();
  }
});
for (const delayedVerification of [false, true])
  test(`a member who looks somewhere new gets the latest presence there at once${delayedVerification ? " after delayed initial verification" : ""}`, async () => {
    const { networks, received, steps } = await peerRoom(40);
    try {
      // 36 moves its cursor where 20 looks; 10 and 35, in each group, look
      // elsewhere and then go there too. 12 stays away.
      const sender = networks[36],
        movers = [10, 35];
      if (delayedVerification) {
        const delayed = networks[0],
          check = delayed.check.bind(delayed);
        delayed.check = async (packet) => {
          const valid = await check(packet);
          if (packet.body.kind === "presence" && packet.body.data.step === 1)
            await new Promise((resolve) => setTimeout(resolve, 40));
          return valid;
        };
      }
      for (const [i, n] of networks.entries())
        await n.broadcast("view", {
          camera: camera(i),
          following: null,
          at: Date.now(),
        });
      await until(() =>
        networks.every(
          (n) =>
            received.get(n.session).filter((m) => m.kind === "view").length ===
            39,
        ),
      );
      await sender.broadcast("presence", {
        step: 1,
        cursor: { x: 200001, y: 0 },
      });
      // Verification is asynchronous. Establish the first packet at every
      // relay before the burst, so each relay filters from the same baseline.
      await until(() =>
        networks
          .filter((n) => n.isRelay)
          .every(
            (n) => n.latest.get(sender.session)?.packet.body.data.step === 1,
          ),
      );
      await until(() =>
        networks
          .filter((n) => n !== sender)
          .every((n) => steps(n.session, sender.session).includes(1)),
      );
      for (let k = 2; k <= 5; k++)
        await sender.broadcast("presence", {
          step: k,
          cursor: { x: 200000 + k, y: 0 },
        });
      await until(() => steps("020", "036").length === 5);
      for (const i of [...movers, 12])
        assert.deepEqual(steps(networks[i].session, "036"), [1]);
      const moved = Date.now();
      for (const i of movers)
        await networks[i].broadcast("view", {
          camera: camera(20),
          following: null,
          at: Date.now(),
        });
      await until(() =>
        movers.every((i) => steps(networks[i].session, "036").includes(5)),
      );
      assert.ok(Date.now() - moved < 500, `${Date.now() - moved} ms`);
      for (const i of movers)
        assert.deepEqual(steps(networks[i].session, "036"), [1, 5]);
      assert.deepEqual(steps("012", "036"), [1]);
    } finally {
      for (const network of networks) network.close();
    }
  });
test("a group's other relay passes its packets on within seconds of its first relay going silent", async () => {
  const { networks, received } = await peerRoom(40);
  try {
    // 0 and 1 relay for group 0, 32 and 33 for group 1.
    const secondary = networks[1],
      across = ["032", "033"].map((id) => secondary.links.get(id));
    let passed = 0;
    const sendOn = secondary.sendOn.bind(secondary);
    secondary.sendOn = (conn, packet) => {
      if (packet.body?.data?.step && across.includes(conn)) passed++;
      sendOn(conn, packet);
    };
    const heard = (k) =>
      received.get("035").some((m) => m.from === "010" && m.data?.step >= k);
    // While the first relay is there, if quiet, the second passes nothing
    // on to other groups.
    await new Promise((r) => setTimeout(r, 2500));
    await networks[10].broadcast("edit", { step: 1 });
    await until(() => heard(1));
    assert.equal(passed, 0);
    // The first relay stops answering without leaving, as when its device
    // crashes, and nobody is told.
    for (const conn of networks[0].connections) conn.drop();
    networks[0].close();
    const lost = Date.now();
    let step = 1;
    const sending = setInterval(
      () =>
        networks[10]
          .broadcast(step % 5 ? "presence" : "edit", { step: ++step })
          .catch(() => {}),
      50,
    );
    try {
      await until(() => heard(2));
    } finally {
      clearInterval(sending);
    }
    assert.ok(Date.now() - lost < 2500, `${Date.now() - lost} ms`);
    assert.ok(passed > 0);
  } finally {
    for (const network of networks) network.close();
  }
});
test("members whose relays all leave check in at once for the relays that follow", async () => {
  const { networks, received } = await peerRoom(40);
  try {
    const asked = [];
    for (const n of networks.slice(2)) n.changed = () => asked.push(n.session);
    // Both of group 0's relays leave. Its members have no link left, and
    // in a large room no board events either, until they check in.
    networks[0].close();
    networks[1].close();
    const members = networks.slice(2, 32).map((n) => n.session);
    await until(() => members.every((s) => asked.includes(s)));
    assert.equal(asked.length, members.length, "Once each, group 0 only");
    // The check-ins bring the roster without them, in which 2 and 3 relay,
    // to the rest a little before group 0's members. Those refuse the new
    // relays' first links; the next try comes a second later, not at the
    // regular retry, held off here for five seconds.
    for (const n of networks) {
      clearInterval(n.retry);
      n.retry = setInterval(() => n.reconcile(), 5000);
    }
    const roster = networks.slice(2).map((n) => n.ticket);
    for (const n of networks.slice(2))
      if (!members.includes(n.session) || n.session < "004")
        n.update(n.ticket, n.signature, roster);
    assert.ok(networks[2].isRelay && networks[3].isRelay);
    await new Promise((r) => setTimeout(r, 300));
    const updated = Date.now();
    for (const n of networks.slice(4, 32))
      n.update(n.ticket, n.signature, roster);
    await until(() =>
      networks
        .slice(2)
        .every((n) =>
          [...n.wanted].every((id) => n.links.get(id)?.whiteboardAuthorized),
        ),
    );
    assert.ok(Date.now() - updated < 2000, `${Date.now() - updated} ms`);
    await networks[10].broadcast("edit", { step: 1 });
    await until(() =>
      networks
        .slice(2)
        .filter((n) => n !== networks[10])
        .every((n) => received.get(n.session).some((m) => m.data?.step === 1)),
    );
  } finally {
    for (const network of networks) network.close();
  }
});
test("a member checks each packet's signature once though both relays pass it on", async () => {
  const { networks, received } = await peerRoom(40);
  try {
    const member = networks[20];
    let checks = 0;
    const validTicket = member.validTicket.bind(member);
    member.validTicket = (packet) => {
      if (packet.body) checks++;
      return validTicket(packet);
    };
    for (let k = 0; k < 20; k++) {
      await networks[10].broadcast("presence", { step: k });
      await networks[36].broadcast("presence", { step: k });
    }
    await until(
      () =>
        received.get("020").filter((m) => m.kind === "presence").length === 40,
    );
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(checks, 40);
  } finally {
    for (const network of networks) network.close();
  }
});
test("relays pass a sender's views once a second to members who do not follow it, and every view to those who do", async () => {
  const { networks, received } = await peerRoom(40);
  try {
    // 36 moves its view; 10 follows it, 12 does not. 0, 1, 32 and 33 relay.
    for (const [i, n] of networks.entries())
      if (i !== 36)
        await n.broadcast("view", {
          camera: camera(i),
          following: i === 10 ? "036" : null,
          at: Date.now(),
        });
    await until(() =>
      networks.every(
        (n) =>
          received.get(n.session).filter((m) => m.kind === "view").length >=
          (n.session === "036" ? 39 : 38),
      ),
    );
    const views = (i) =>
      received
        .get(networks[i].session)
        .filter((m) => m.kind === "view" && m.from === "036")
        .map((m) => m.data);
    const start = Date.now();
    for (let k = 1; k <= 10; k++)
      await networks[36].broadcast("view", {
        camera: { ...camera(36), x: k },
        following: null,
        at: Date.now(),
      });
    await until(() => views(10).length === 10);
    for (const i of [0, 1, 32, 33]) await until(() => views(i).length === 10);
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(Date.now() - start < 900, "Checked within the second");
    // Verification is asynchronous, so which view went first may vary.
    assert.equal(views(12).length, 1);
    // Following someone else is passed on at once.
    await networks[36].broadcast("view", {
      camera: { ...camera(36), x: 11 },
      following: "005",
      at: Date.now(),
    });
    await until(() => views(12).length === 2);
    assert.equal(views(12)[1].following, "005");
    // Where the view last stopped arrives once the second has passed.
    await networks[36].broadcast("view", {
      camera: { ...camera(36), x: 12 },
      following: "005",
      at: Date.now(),
    });
    await until(() => views(12).length === 3);
    assert.equal(views(12)[2].camera.x, 12);
    assert.ok(Date.now() - start >= 900);
  } finally {
    for (const network of networks) network.close();
  }
});
test("relays pass on a raised or lowered hand at once, between views spaced a second apart", async () => {
  const { networks, received } = await peerRoom(40);
  try {
    for (const [i, n] of networks.entries())
      await n.broadcast("view", {
        camera: camera(i),
        following: null,
        at: Date.now(),
      });
    await until(() =>
      networks.every(
        (n) =>
          received.get(n.session).filter((m) => m.kind === "view").length >= 39,
      ),
    );
    const views = () =>
      received
        .get("012")
        .filter((m) => m.kind === "view" && m.from === "036")
        .map((m) => m.data);
    const start = Date.now(),
      hand = Date.now();
    await networks[36].broadcast("view", {
      camera: { ...camera(36), x: 1 },
      following: null,
      hand,
      at: Date.now(),
    });
    await until(() => views().at(-1)?.hand === hand);
    await networks[36].broadcast("view", {
      camera: { ...camera(36), x: 2 },
      following: null,
      at: Date.now(),
    });
    await until(() => views().length >= 3 && !views().at(-1).hand);
    assert.ok(Date.now() - start < 900, "Neither waited for the second");
  } finally {
    for (const network of networks) network.close();
  }
});
test("a follower's relays pass on in full the presence where the followed person looks", async () => {
  const { networks, steps } = await peerRoom(40);
  try {
    // 10 follows 36, whose view moves far from where 10's own camera was
    // last renewed. 20 is looked at by nobody.
    for (const [i, n] of networks.entries())
      if (i !== 20)
        await n.broadcast("view", {
          camera: camera(i),
          following: i === 10 ? "036" : null,
          at: Date.now(),
        });
    await networks[36].broadcast("view", {
      camera: { ...camera(36), x: 500000 },
      following: null,
      at: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 100));
    for (let k = 1; k <= 5; k++)
      await networks[20].broadcast("presence", {
        step: k,
        cursor: { x: 500000 + k, y: 0 },
      });
    await until(() => steps("010", "020").length === 5);
    assert.equal(steps("012", "020").length, 1, "Held back elsewhere");
  } finally {
    for (const network of networks) network.close();
  }
});
test("views wait while a link is behind, and edits do not", () => {
  const network = new PeerNetwork({
    puter: { peer: {} },
    session: "a",
    keys: {},
    roomKey: {},
    room: "room",
    receive() {},
  });
  clearInterval(network.retry);
  clearInterval(network.watch);
  const sent = [],
    conn = {
      connected: true,
      whiteboardAuthorized: true,
      whiteboardPresence: { readyState: "open", bufferedAmount: 20000 },
      send: (data) => sent.push(JSON.parse(data).body.kind),
    };
  for (const kind of ["view", "edit", "view-left", "attention"])
    network.sendOn(conn, { body: { kind } });
  assert.deepEqual(sent, ["edit", "view-left", "attention"]);
  conn.whiteboardPresence.bufferedAmount = 0;
  network.sendOn(conn, { body: { kind: "view" } });
  assert.deepEqual(sent.at(-1), "view");
  network.close();
});
test("rooms of up to eight pass on all presence whatever the views", async () => {
  const { networks, steps } = await peerRoom(5);
  try {
    for (const [i, n] of networks.entries())
      await n.broadcast("view", {
        camera: camera(i),
        following: null,
        at: Date.now(),
      });
    await new Promise((r) => setTimeout(r, 30));
    for (let k = 1; k <= 5; k++)
      await networks[0].broadcast("presence", { step: k, cursor: far });
    await until(() =>
      networks.slice(1).every((n) => steps(n.session, "000").length === 5),
    );
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
test("members accept a participant who checked in after their roster, but not one removed or lowered before it", async () => {
  const roomKey = await keyPair(),
    now = Date.now();
  const network = new PeerNetwork({
    puter: { peer: {} },
    session: "m",
    keys: await keyPair(),
    roomKey: roomKey.publicKey,
    room: "late-room",
    receive() {},
  });
  const ticket = async (session, role, issued) => {
    const t = {
      room: "late-room",
      session,
      user: session,
      username: session,
      role,
      publicKey: (await keyPair()).publicKey,
      expires: issued + 90_000,
    };
    return { ticket: t, signature: await sign(roomKey.privateKey, t) };
  };
  try {
    const own = await ticket("m", "editor", now),
      lowered = await ticket("v", "viewer", now - 5000);
    network.update(own.ticket, own.signature, [own.ticket, lowered.ticket]);
    const accepts = async (packet) => network.validTicket(packet);
    // Members of a large room fetch the roster only every 20 to 45 seconds.
    // Someone who joined since, or rejoined, or was given another role,
    // holds a ticket newer than this member's roster.
    assert.equal(
      await accepts(await ticket("new", "editor", now + 1000)),
      true,
    );
    assert.equal(await accepts(await ticket("v", "editor", now + 1000)), true);
    // A ticket from before the roster is checked against it: one removed,
    // or lowered to viewer, before the roster was read stays refused.
    assert.equal(
      await accepts(await ticket("gone", "editor", now - 1000)),
      false,
    );
    assert.equal(await accepts(await ticket("v", "editor", now - 1000)), false);
    assert.equal(await accepts(lowered), true);
    // Newer tickets must still be the room's own and current.
    const forged = await ticket("new", "editor", now + 1000);
    forged.ticket.role = "owner";
    assert.equal(await accepts(forged), false);
    const other = await ticket("new", "editor", now + 1000);
    other.ticket.room = "other-room";
    other.signature = await sign(roomKey.privateKey, other.ticket);
    assert.equal(await accepts(other), false);
    network.now = () => now + 200_000;
    assert.equal(
      await accepts(await ticket("new", "editor", now + 1000)),
      false,
    );
  } finally {
    network.close();
  }
});
test("a newcomer's edits reach members of a large room before their next check-in", async () => {
  const { networks, received, puter, roomKey } = await peerRoom(40);
  const newcomer = new PeerNetwork({
    puter,
    session: "040",
    keys: await keyPair(),
    roomKey: roomKey.publicKey,
    room: "view-room",
    receive() {},
  });
  try {
    await newcomer.serve();
    // The newcomer and the relays, who have board events, know of the
    // check-in; the rest of the room learns of it at its own check-ins.
    const ticket = {
      ...networks[39].ticket,
      session: "040",
      user: "040",
      username: "040",
      publicKey: newcomer.keys.publicKey,
      since: 40,
      expires: Date.now() + 91_000,
      invite: newcomer.server.inviteCode,
    };
    const roster = [...networks.map((n) => n.ticket), ticket];
    newcomer.update(ticket, await sign(roomKey.privateKey, ticket), roster);
    for (const n of networks.filter((n) => n.isRelay))
      n.update(n.ticket, n.signature, roster);
    await until(() =>
      [...newcomer.wanted].every(
        (id) => newcomer.links.get(id)?.whiteboardAuthorized,
      ),
    );
    await newcomer.broadcast("edit", { step: 1 });
    await until(() =>
      networks.every((n) =>
        received.get(n.session).some((m) => m.from === "040"),
      ),
    );
  } finally {
    newcomer.close();
    for (const network of networks) network.close();
  }
});
test("members whose links all drop are told to catch up then and when a link returns", async () => {
  const { networks } = await peerRoom(40);
  try {
    const lost = [],
      back = [];
    for (const n of networks.slice(2)) {
      n.changed = (stranded) => stranded && lost.push(n.session);
      n.relinked = () => back.push(n.session);
    }
    // Edits relays pass on while a member has no link never reach it.
    networks[0].close();
    networks[1].close();
    const members = networks.slice(2, 32).map((n) => n.session);
    await until(() => members.every((s) => lost.includes(s)));
    assert.equal(lost.length, members.length);
    const roster = networks.slice(2).map((n) => n.ticket);
    for (const n of networks.slice(2)) n.update(n.ticket, n.signature, roster);
    await until(() => members.every((s) => back.includes(s)));
    assert.equal(back.length, members.length, "Once each, group 0 only");
  } finally {
    for (const network of networks) network.close();
  }
});
test("members whose links all drop are told to catch up then and when a link returns", async () => {
  const { networks } = await peerRoom(40);
  try {
    const lost = [],
      back = [];
    for (const n of networks.slice(2)) {
      n.changed = (stranded) => stranded && lost.push(n.session);
      n.relinked = () => back.push(n.session);
    }
    // Edits relays pass on while a member has no link never reach it.
    networks[0].close();
    networks[1].close();
    const members = networks.slice(2, 32).map((n) => n.session);
    await until(() => members.every((s) => lost.includes(s)));
    assert.equal(lost.length, members.length);
    const roster = networks.slice(2).map((n) => n.ticket);
    for (const n of networks.slice(2)) n.update(n.ticket, n.signature, roster);
    await until(() => members.every((s) => back.includes(s)));
    assert.equal(back.length, members.length, "Once each, group 0 only");
  } finally {
    for (const network of networks) network.close();
  }
});
test("peers send a ticket until the other end keeps it, then name it, and never to older clients", async () => {
  const { networks, received, steps } = await peerRoom(3);
  // 002 runs an older client: it never says it keeps tickets.
  const older = networks[2],
    sendOn = older.sendOn.bind(older);
  older.sendOn = (conn, packet) =>
    packet.known ||
    sendOn(conn, packet.hello ? { ...packet, compact: undefined } : packet);
  for (const conn of older.links.values()) conn.close();
  await until(() =>
    networks.every((n) =>
      [...n.wanted].every((id) => n.links.get(id)?.whiteboardAuthorized),
    ),
  );
  // What goes over each link, as sent.
  const wire = [];
  const watch = (network) => {
    const original = network.wire.bind(network);
    network.wire = (conn, packet) => {
      const text = original(conn, packet);
      const to = [...network.links].find(([, c]) => c === conn)?.[0];
      wire.push({ from: network.session, to, text });
      return text;
    };
  };
  networks.forEach(watch);
  try {
    for (let k = 1; k <= 5; k++) {
      await networks[0].broadcast("presence", { step: k, cursor: far });
      await new Promise((r) => setTimeout(r, 20));
    }
    await until(() =>
      networks.slice(1).every((n) => steps(n.session, "000").length === 5),
    );
    const sent = (to) =>
      wire.filter(
        (w) => w.from === "000" && w.to === to && w.text.includes('"body"'),
      );
    // The first packet carries the ticket; once 001 says it keeps it, the
    // rest name it.
    assert.match(sent("001")[0].text, /"ticket"/);
    assert.ok(
      sent("001")
        .slice(2)
        .every((w) => /"ref"/.test(w.text)),
    );
    assert.ok(sent("001").at(-1).text.length < sent("001")[0].text.length / 2);
    // The older client always gets the ticket.
    assert.ok(sent("002").every((w) => /"ticket"/.test(w.text)));
    // A link that lost the ticket says so and gets it again.
    const link = networks[1].links.get("000");
    link.whiteboardTickets.clear();
    await networks[0].broadcast("presence", { step: 6, cursor: far });
    await new Promise((r) => setTimeout(r, 50));
    await networks[0].broadcast("presence", { step: 7, cursor: far });
    await until(() => steps("001", "000").includes(7));
    // A packet naming a ticket with someone else's signature, or a ticket
    // this link never carried, is not taken.
    await networks[1].broadcast("presence", { step: 1, cursor: far });
    await until(() => steps("000", "001").length === 1);
    await until(() => networks[1].links.get("000").whiteboardKnown?.size);
    const before = received.get("000").length;
    const body = { v: 1, seq: 9999, kind: "presence", data: { cursor: far } };
    const forged = await sign(networks[2].keys.privateKey, body);
    const toZero = networks[1].links.get("000");
    const name = [...networks[0].links.get("001").whiteboardTickets.keys()][0];
    toZero.send(JSON.stringify({ ref: name, body, proof: forged }));
    toZero.send(JSON.stringify({ ref: "002:1", body, proof: forged }));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(received.get("000").length, before);
  } finally {
    for (const network of networks) network.close();
  }
});
