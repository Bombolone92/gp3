import test from "node:test";
import assert from "node:assert/strict";
import { board, item, validateBoard } from "../src/model.js";
import {
  changeTimer,
  timerPhase,
  timerRemaining,
  timerText,
  MAX_TIMER,
} from "../src/timer.js";
import { SharedDocument, rebase } from "../src/collaboration/document.js";
import { CollaborationSession } from "../src/collaboration/session.js";
import { encode, hash } from "../src/collaboration/protocol.js";
import {
  environment,
  owner,
  viewer,
  memoryStore,
} from "./collaboration-helpers.js";

test("timer deadlines survive suspended displays, pause, resume, extension, reset and expiry", () => {
  let timer = changeTimer(undefined, "start", {
    now: 10000.4,
    duration: 60000,
    id: () => "run",
  });
  assert.equal(timerText(timerRemaining(timer, 10500)), "1:00");
  assert.equal(timerText(timerRemaining(timer, 11001)), "0:59");
  timer = changeTimer(timer, "pause", { now: 30400.2 });
  assert.equal(timer.remaining, 39600);
  assert.equal(timerRemaining(timer, 100000), 39600);
  timer = changeTimer(timer, "extend", { extra: 60000 });
  assert.equal(timer.remaining, 99600);
  timer = changeTimer(timer, "resume", { now: 200000 });
  assert.equal(timer.endsAt, 299600);
  timer = changeTimer(timer, "extend", { now: 200600, extra: 300000 });
  assert.equal(timer.endsAt, 599600);
  assert.equal(timerPhase(timer, 600000), "finished");
  assert.equal(timerRemaining(timer, 900000), 0);
  assert.equal(changeTimer(timer, "pause", { now: 900000 }), timer);
  const reset = changeTimer(timer, "stop");
  assert.equal(reset.state, "idle");
  assert.equal(reset.remaining, 420000);
  assert.equal(reset.endsAt, 0);
  assert.notEqual(changeTimer(reset, "start").id, timer.id);
  const nearEnd = changeTimer(
    changeTimer(undefined, "start", { now: 10000, duration: 1000 }),
    "pause",
    { now: 10999.8 },
  );
  assert.equal(
    nearEnd.remaining,
    1,
    "A fractional last millisecond remains resumable",
  );
});

test("timer validation rejects unsafe durations, states and payloads at board and CRDT boundaries", () => {
  const b = board();
  const good = changeTimer(undefined, "start", {
    now: 10000,
    duration: MAX_TIMER,
  });
  for (const timer of [
    null,
    [],
    {},
    { ...good, duration: MAX_TIMER + 1 },
    { ...good, duration: 0 },
    { ...good, remaining: NaN },
    { ...good, endsAt: 0 },
    { ...good, state: "paused" },
    { ...good, state: "finished" },
    { ...good, id: "../run" },
    { ...good, unknown: true },
  ])
    assert.throws(() => validateBoard({ ...b, timer }), /timer/i);
  assert.throws(() => changeTimer(good, "extend", { now: 10000 }), /24 hours/);
  assert.doesNotThrow(() => validateBoard({ ...b, timer: good }));
  const doc = new SharedDocument();
  try {
    doc.commit(b);
    doc.timer.set("state", { ...good, duration: 1e10 });
    assert.throws(() => doc.validate(), /timer/i);
    doc.timer.delete("state");
    doc.timer.set("rogue", "data");
    assert.throws(() => doc.validate(), /timer structure/i);
  } finally {
    doc.destroy();
  }
});

test("concurrent timer commands converge atomically and never consume drawing undo or redo", () => {
  const b = board();
  b.items.push(item("note", 0, 0));
  const seed = new SharedDocument();
  seed.commit(b);
  const a = new SharedDocument(seed.update()),
    c = new SharedDocument(seed.update());
  try {
    const moved = a.snapshot();
    moved.items[0].x = 100;
    a.commit(moved);
    a.undo.stopCapturing();
    const timer = changeTimer(undefined, "start", { now: 10000 });
    a.setTimer(timer);
    c.apply(a.update());
    a.undo.undo();
    assert.equal(a.snapshot().items[0].x, 0);
    assert.deepEqual(a.snapshot().timer, timer);
    a.setTimer(changeTimer(timer, "pause", { now: 11000 }));
    c.setTimer(changeTimer(timer, "extend", { now: 12000 }));
    a.undo.redo();
    assert.equal(
      a.snapshot().items[0].x,
      100,
      "Timer edits retain drawing redo",
    );
    const au = a.update(),
      cu = c.update();
    a.apply(cu);
    c.apply(au);
    assert.deepEqual(a.snapshot(), c.snapshot());
    assert.doesNotThrow(() => a.validate());
    assert.ok(["paused", "running"].includes(a.snapshot().timer.state));
  } finally {
    a.destroy();
    c.destroy();
    seed.destroy();
  }
});

test("queued timer commands survive incoming drawings and accept remote timers when unchanged", () => {
  const before = board();
  before.timer = changeTimer(undefined, "start", { now: 10000 });
  const local = structuredClone(before),
    remote = structuredClone(before);
  local.timer = changeTimer(local.timer, "pause", { now: 20000 });
  remote.items.push(item("note", 10, 10));
  const merged = rebase(local, before, remote);
  assert.deepEqual(merged.timer, local.timer);
  assert.equal(merged.items.length, 1);
  remote.timer = changeTimer(remote.timer, "extend", { now: 11000 });
  assert.deepEqual(rebase(before, before, remote).timer, remote.timer);
  merged.timer.remaining = 10;
  assert.notEqual(local.timer.remaining, 10);
});

test("worker clock synchronization tolerates device skew and timer updates enforce viewer permissions", async () => {
  const env = environment(),
    b = board(),
    seed = new SharedDocument();
  seed.commit(b);
  const session = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: b.id,
    user: owner,
    store: memoryStore(),
    changed() {},
    activity() {},
    status() {},
  });
  try {
    await env.service.call(owner, {
      op: "create",
      room: b.id,
      update: encode(seed.update()),
    });
    env.now += 3600000;
    const response = await session.request("join");
    assert.equal(response.serverTime, env.now);
    assert.ok(Math.abs(session.now() - env.now) < 1000);
    assert.ok(session.now() > Date.now() + 3590000);
    const timer = changeTimer(undefined, "start", { now: session.now() });
    seed.setTimer(timer);
    const result = await env.service.call(owner, {
      op: "commit",
      id: await hash(seed.update()),
      room: b.id,
      update: encode(seed.update()),
    });
    assert.equal(result.serverTime, env.now);
    const invitation = await env.service.call(owner, {
      op: "invite",
      room: b.id,
      role: "viewer",
    });
    await env.service.call(viewer, {
      op: "join",
      room: b.id,
      token: invitation.token,
    });
    seed.setTimer(changeTimer(timer, "pause", { now: session.now() }));
    await assert.rejects(
      env.service.call(viewer, {
        op: "commit",
        room: b.id,
        update: encode(seed.update()),
      }),
      /read.only|forbidden|permission/i,
    );
    env.now += 60000;
    await session.request("sync");
    assert.ok(Math.abs(session.now() - env.now) < 1000);
  } finally {
    session.close();
    seed.destroy();
  }
});
