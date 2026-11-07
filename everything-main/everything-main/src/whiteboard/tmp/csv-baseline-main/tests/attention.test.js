import test from "node:test";
import assert from "node:assert/strict";
import {
  captureCamera,
  cameraView,
  readView,
  followCycle,
} from "../src/collaboration/attention.js";
import { CollaborationSession } from "../src/collaboration/session.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { encode } from "../src/collaboration/protocol.js";
import { environment, owner, memoryStore } from "./collaboration-helpers.js";
const camera = { x: 100, y: -80, w: 1000, h: 500 };
test("camera traffic coalesces movement, renews idle views, and expires lost participants without document edits", async (ctx) => {
  const env = environment(),
    room = crypto.randomUUID(),
    seed = new SharedDocument(),
    sent = [],
    store = memoryStore();
  seed.commit({ version: 1, id: room, title: "Live view lease", items: [] });
  await env.service.call(owner, {
    op: "create",
    room,
    update: encode(seed.update()),
  });
  seed.destroy();
  ctx.mock.timers.enable({
    apis: ["Date", "setTimeout", "setInterval"],
    now: Date.now(),
  });
  env.service.now = () => Date.now();
  const s = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room,
    user: owner,
    store,
    changed() {},
    activity() {},
    status() {},
  });
  try {
    await s.start();
    const snapshot = s.shared.snapshot();
    let edits = 0;
    s.shared.doc.on("update", () => edits++);
    s.peers = {
      ticket: {},
      links: new Map(),
      update() {},
      close() {},
      broadcast: async (...args) => sent.push(args),
    };
    for (let n = 0; n < 100; n++) {
      s.view({ ...camera, x: n });
      ctx.mock.timers.tick(10);
    }
    assert.equal(
      sent.length,
      10,
      "100 camera changes produce at most ten packets per second",
    );
    assert.equal(sent.at(-1)[1].camera.x, 99);
    const before = sent.length;
    ctx.mock.timers.tick(3000);
    assert.ok(sent.length > before, "Idle views renew their lease");
    await s.receive(
      "view",
      { camera, following: null, at: Math.round(s.now()) },
      { session: "lost", role: "editor" },
      1,
    );
    assert.equal(s.views.size, 1);
    ctx.mock.timers.tick(14000);
    assert.equal(
      s.views.size,
      0,
      "A lost peer expires without waiting for the roster TTL",
    );
    assert.equal(edits, 0);
    assert.deepEqual(s.shared.snapshot(), snapshot);
  } finally {
    s.close();
    ctx.mock.timers.reset();
  }
});
test("following fits the same world region across screen sizes without invalid camera values", () => {
  const view = cameraView(camera, { width: 800, height: 600 });
  assert.deepEqual(view, { x: 320, y: 364, z: 0.8 });
  const rect = captureCamera(view, { width: 800, height: 600 });
  assert.equal(rect.x, camera.x);
  assert.equal(rect.y, camera.y);
  assert.ok(rect.w >= camera.w && rect.h >= camera.h);
  assert.equal(
    cameraView({ ...camera, w: NaN }, { width: 800, height: 600 }),
    null,
  );
  assert.equal(
    cameraView({ ...camera, w: 0 }, { width: 800, height: 600 }),
    null,
  );
  assert.equal(
    captureCamera({ x: 0, y: 0, z: 0 }, { width: 800, height: 600 }),
    null,
  );
  assert.equal(readView({ camera, at: 100000, following: null }, 116000), null);
  assert.equal(
    readView({ camera, at: 100000, following: "../invalid" }, 100001),
    null,
  );
});
test("follow chains reject direct and indirect cycles but allow multiple facilitators", () => {
  const views = new Map([
    ["a", { following: "b" }],
    ["b", { following: null }],
  ]);
  assert.equal(followCycle(views, "a", "c"), false);
  assert.equal(followCycle(views, "a", "b"), true);
  views.get("b").following = "a";
  assert.equal(followCycle(views, "a", "c"), true);
});
test("live camera and attention packets enforce age, ordering and editor authority without document writes", async () => {
  const env = environment(),
    changes = [],
    requests = [],
    sent = [],
    activity = [];
  const s = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: "room",
    user: owner,
    store: memoryStore(),
    changed() {
      throw Error("Camera packets never mutate the board");
    },
    activity: (people) => activity.push(people.size),
    status() {},
    viewChanged: (v) => changes.push(v.size),
    attention: (p) => requests.push(p),
  });
  const now = Math.round(s.now()),
    editor = {
      session: "editor",
      user: "editor-user",
      username: "Editor",
      role: "editor",
    },
    viewer = { ...editor, session: "viewer", role: "viewer" };
  try {
    await s.receive("view", { camera, following: null, at: now }, editor, 5);
    await s.receive(
      "view",
      { camera: { ...camera, x: 900 }, following: null, at: now },
      editor,
      4,
    );
    assert.equal(s.views.get("editor").camera.x, 100);
    await s.receive(
      "view",
      { camera: { ...camera, x: Infinity }, following: null, at: now },
      editor,
      6,
    );
    assert.equal(changes.length, 1);
    await s.receive(
      "attention",
      { camera, following: null, at: now, target: "all" },
      viewer,
      10,
    );
    assert.equal(requests.length, 0);
    await s.receive(
      "attention",
      { camera, following: null, at: now, target: "someone-else" },
      editor,
      10,
    );
    assert.equal(requests.length, 0);
    await s.receive(
      "attention",
      { camera, following: null, at: now, target: s.session },
      editor,
      3,
    );
    assert.equal(
      requests.length,
      1,
      "A newer view does not swallow an independent bring request",
    );
    assert.equal(requests[0].sequence, 5);
    await s.receive(
      "attention",
      { camera, following: null, at: now, target: s.session },
      editor,
      3,
    );
    await s.receive(
      "attention",
      { camera, following: null, at: now - 16000, target: s.session },
      editor,
      20,
    );
    assert.equal(requests.length, 1);
    s.peers = {
      ticket: {},
      links: new Map([
        ["editor", { connected: true, whiteboardAuthorized: true }],
      ]),
      broadcast: async (...data) => sent.push(data),
      close() {},
    };
    s.roster = [editor];
    s.connected = true;
    s.view(camera);
    assert.equal(
      await s.bring("all"),
      false,
      "Viewers cannot send bring requests",
    );
    s.readOnly = false;
    assert.equal(await s.bring("missing"), false);
    assert.equal(await s.bring("editor"), true);
    assert.equal(sent[0][0], "attention");
    assert.equal(s.shared.snapshot().items.length, 0);
    await s.receive(
      "presence",
      { cursor: { x: 3, y: 4 }, selection: ["note"], editing: "note" },
      editor,
      29,
    );
    assert.equal(s.people.has(editor.session), true);
    const shown = activity.length;
    await s.receive("view-left", { at: now }, editor, 30);
    assert.equal(s.views.has(editor.session), false);
    assert.equal(
      s.people.has(editor.session),
      false,
      "A departed participant's cursor and selection leave with them",
    );
    assert.equal(activity.length, shown + 1);
    await s.receive("presence", { cursor: { x: 5, y: 6 } }, editor, 28);
    assert.equal(s.people.has(editor.session), false);
    await s.receive("view", { camera, following: null, at: now }, editor, 31);
    assert.equal(
      s.views.has(editor.session),
      false,
      "Delayed packets cannot restart a departed view",
    );
    await s.finishView();
    assert.equal(sent.at(-1)[0], "view-left");
    const count = sent.length;
    await s.finishView();
    assert.equal(await s.bring(), false);
    s.broadcastView();
    assert.equal(
      sent.length,
      count,
      "A finished view cannot restart or send more requests",
    );
  } finally {
    s.close();
  }
});
test("a drag held still keeps its live position shown, and a large one still sends the cursor", () => {
  const env = environment(),
    sent = [];
  const s = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: "room",
    user: owner,
    store: memoryStore(),
    changed() {},
    activity() {},
    status() {},
  });
  s.peers = {
    broadcast: async (kind, data) => sent.push([kind, data]),
    close() {},
  };
  const preview = [{ id: "a", x: 300, y: 0, w: 100, h: 50, rotation: 0 }];
  try {
    // Others drop a drag preview 2.5 seconds after its last packet.
    s.latestPresence = { cursor: { x: 1, y: 2 }, selection: ["a"], preview };
    s.lastPresenceSent = Date.now() - 800;
    s.pulsePresence();
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0][1].preview, preview);
    s.pulsePresence();
    assert.equal(sent.length, 1, "no repeat sooner than needed");
    // A selection alone is repeated only every few seconds.
    s.latestPresence = { cursor: { x: 1, y: 2 }, selection: ["a"] };
    s.lastPresenceSent = Date.now() - 800;
    s.pulsePresence();
    assert.equal(sent.length, 1);
    s.lastPresenceSent = Date.now() - 4000;
    s.pulsePresence();
    assert.equal(sent.length, 2);
    // Positions too large for one packet are left out, not the packet.
    s.latestPresence = {
      cursor: { x: 5, y: 6 },
      selection: ["a"],
      preview: Array.from({ length: 100 }, (_, n) => ({
        id: `pen-${n}`,
        x: n,
        y: 0,
        w: 10,
        h: 10,
        type: "pen",
        color: "#000000",
        points: Array.from({ length: 256 }, (_, k) => [k / 3, k / 7]),
      })),
    };
    s.sendPresence();
    assert.deepEqual(sent.at(-1)[1].cursor, { x: 5, y: 6 });
    assert.deepEqual(sent.at(-1)[1].preview, []);
  } finally {
    s.close();
  }
});
