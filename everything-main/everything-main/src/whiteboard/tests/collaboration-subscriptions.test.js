import test from "node:test";
import assert from "node:assert/strict";
import { CollaborationSession } from "../src/collaboration/session.js";
import { memoryStore, owner } from "./collaboration-helpers.js";

function fixture(onLocal) {
  const session = new CollaborationSession({
    puter: { events: { onLocal } },
    server: "https://whiteboard-test.puter.work",
    room: "subscription-race",
    user: owner,
    store: memoryStore(),
    changed() {},
    activity() {},
    status() {},
  });
  session.eventDescriptor = { app: "app-whiteboard", key: "signal" };
  session.request = async () => ({});
  return session;
}

test("overlapping subscription requests share one listener and closing releases it", async () => {
  let release;
  const ready = new Promise((resolve) => {
    release = resolve;
  });
  let registrations = 0,
    active = 0;
  const session = fixture(async () => {
    registrations++;
    await ready;
    active++;
    let open = true;
    return {
      off() {
        if (open) active--;
        open = false;
      },
    };
  });
  const first = session.subscribe(),
    second = session.subscribe();
  try {
    release();
    await Promise.all([first, second]);
    assert.equal(registrations, 1, "Only one registration is in flight");
    assert.equal(active, 1);
    session.close();
    assert.equal(active, 0, "Every created listener is released");
  } finally {
    release();
    session.close();
  }
});

test("a late error from an old listener cannot close its replacement", async () => {
  const attempts = [];
  const session = fixture(async (_subject, _listener, options) => {
    const attempt = { options, off: 0 };
    attempts.push(attempt);
    return { off: () => attempt.off++ };
  });
  try {
    await session.subscribe();
    attempts[0].options.onError();
    assert.equal(session.subscription, null);
    await session.subscribe();
    const replacement = session.subscription;
    attempts[0].options.onError();
    assert.equal(attempts[1].off, 0, "The replacement stays subscribed");
    assert.equal(session.subscription, replacement);
  } finally {
    session.close();
  }
});

test("an error during registration cannot install a failed subscription", async () => {
  let registrations = 0,
    releases = 0;
  const session = fixture(async (_subject, _listener, options) => {
    if (++registrations === 1) options.onError();
    return { off: () => releases++ };
  });
  try {
    await session.subscribe();
    assert.ok(!session.subscription);
    assert.equal(releases, 1);
    await session.subscribe();
    assert.equal(registrations, 2, "A failed registration can retry");
    assert.ok(session.subscription);
  } finally {
    session.close();
  }
});

test("a notification delivered after leaving cannot schedule more synchronization", async () => {
  let notify;
  const session = fixture(async (_subject, listener) => {
    notify = listener;
    return { off() {} };
  });
  await session.subscribe();
  session.close();
  notify();
  try {
    assert.ok(
      !session.eventTimer,
      "No new work is scheduled for a closed board",
    );
  } finally {
    clearTimeout(session.eventTimer);
  }
});
test("clients without a connected peer network subscribe to events in large rooms", async () => {
  let registrations = 0;
  const session = fixture(async () => {
    registrations++;
    return { off() {} };
  });
  try {
    session.roster = Array.from({ length: 12 }, (_, n) => ({
      session: `s${n}`,
    }));
    await session.subscribe();
    assert.equal(registrations, 1);
    assert.ok(session.subscription);
    // Non-relay peers in large rooms receive changes through their relays,
    // once a link to one connects.
    session.subscription.off();
    session.subscription = null;
    const link = { connected: false, whiteboardAuthorized: true };
    session.peers = {
      isRelay: false,
      links: new Map([["s1", link]]),
      close() {},
    };
    await session.subscribe();
    assert.equal(registrations, 2, "No link has connected yet");
    session.subscription.off();
    session.subscription = null;
    link.connected = true;
    await session.subscribe();
    assert.equal(registrations, 2);
  } finally {
    session.close();
  }
});

test("peer commit notices neither cancel nor postpone handling of board events", async () => {
  let notify;
  const session = fixture(async (_subject, listener) => {
    notify = listener;
    return { off() {} };
  });
  let syncs = 0,
    checkIns = 0;
  session.synchronize = async () => void syncs++;
  session.eventCheckIn = () => void checkIns++;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const committed = () =>
    session.receive("committed", {}, { session: "peer", role: "editor" }, 1);
  try {
    await session.subscribe();
    // Someone joining signals an event; a peer's commit notice follows.
    notify();
    await committed();
    await wait(300);
    assert.equal(checkIns, 1, "The event's check-in still happens");
    assert.ok(syncs >= 1);
    // A steady stream of events and notices is still handled promptly.
    syncs = checkIns = 0;
    for (let i = 0; i < 8; i++) {
      notify();
      await committed();
      await wait(60);
    }
    assert.ok(checkIns >= 2, `Check-ins during the stream: ${checkIns}`);
    assert.ok(syncs >= 2, `Synchronizations during the stream: ${syncs}`);
  } finally {
    session.close();
  }
});
