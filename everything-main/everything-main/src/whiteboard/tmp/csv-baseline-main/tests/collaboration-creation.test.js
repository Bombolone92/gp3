import test from "node:test";
import assert from "node:assert/strict";
import { board, item } from "../src/model.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { encode } from "../src/collaboration/protocol.js";
import { environment, owner, editor } from "./collaboration-helpers.js";

function request(title = "Creation recovery") {
  const initial = board(title),
    doc = new SharedDocument();
  initial.items = [item("note", 0, 0, { text: title })];
  doc.commit(initial);
  const input = {
    op: "create",
    room: initial.id,
    update: encode(doc.update()),
  };
  doc.destroy();
  return input;
}

for (const failure of ["invalid", "snapshot", "metadata", "owner"])
  test(`shared board creation can retry a failed ${failure} write without losing its identity`, async () => {
    const env = environment(),
      input = request();
    const service = env.service,
      kv = service.kv;
    if (failure === "invalid") {
      await assert.rejects(
        service.call(owner, { ...input, update: "invalid!" }),
      );
    } else {
      const target = failure === "snapshot" ? service.puter.fs : kv;
      const method = failure === "snapshot" ? "write" : "set";
      const original = target[method];
      let failed = false;
      target[method] = async (...args) => {
        const shouldFail =
          !failed &&
          (failure === "snapshot" ||
            (failure === "metadata" && args[0].endsWith(":meta")) ||
            (failure === "owner" && args[0].endsWith(":member:" + owner.uuid)));
        if (shouldFail) {
          failed = true;
          // Also cover an acknowledgement lost after a durable metadata write.
          if (failure === "metadata") await original(...args);
          throw Error("Temporary storage failure");
        }
        return original(...args);
      };
      await assert.rejects(
        service.call(owner, input),
        /Temporary storage failure/,
      );
    }
    const prior = await kv.get(`wb:${input.room}:meta`);
    await service.call(owner, input);
    const joined = await service.call(owner, { op: "join", room: input.room });
    assert.equal(joined.member.role, "owner");
    const loaded = await service.load(input.room);
    try {
      assert.equal(loaded.doc.snapshot().items[0].text, "Creation recovery");
      if (prior)
        assert.deepEqual(
          loaded.meta,
          prior,
          "Retries retain the signing keys and initial snapshot",
        );
    } finally {
      loaded.doc.destroy();
    }
    await assert.rejects(service.call(editor, input), { status: 403 });
  });

test("concurrent creation keeps the first snapshot and lets a stale retry reopen it", async () => {
  const env = environment(),
    first = request("Original snapshot"),
    second = { ...request("Competing snapshot"), room: first.room };
  const service = env.service,
    kv = service.kv;
  let releaseWrite, enteredWrite, releaseRead, enteredRead;
  const writeGate = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  const writing = new Promise((resolve) => {
    enteredWrite = resolve;
  });
  const readGate = new Promise((resolve) => {
    releaseRead = resolve;
  });
  const reading = new Promise((resolve) => {
    enteredRead = resolve;
  });
  const write = service.puter.fs.write;
  service.puter.fs.write = async (...args) => {
    enteredWrite();
    await writeGate;
    return write(...args);
  };
  const creating = service.call(owner, first);
  await writing;
  // Active attempts still exclude competing snapshots.
  await assert.rejects(service.call(owner, second), { status: 409 });
  const get = kv.get;
  let delayRead = true;
  kv.get = async (key) => {
    const value = await get(key);
    if (delayRead && key === `wb:${first.room}:meta`) {
      delayRead = false;
      enteredRead();
      await readGate;
    }
    return value;
  };
  const retrying = service.call(owner, second);
  try {
    await reading;
    releaseWrite();
    await creating;
    const meta = await get(`wb:${first.room}:meta`);
    releaseRead();
    await retrying;
    assert.deepEqual(await get(`wb:${first.room}:meta`), meta);
    const loaded = await service.load(first.room);
    try {
      assert.equal(loaded.doc.snapshot().title, "Original snapshot");
    } finally {
      loaded.doc.destroy();
    }
  } finally {
    releaseWrite();
    releaseRead();
    await Promise.allSettled([creating, retrying]);
  }
});

test("a creation claim lapses on its own if the worker stops mid-creation", async () => {
  const env = environment(),
    input = request("Interrupted");
  const service = env.service,
    kv = service.kv;
  await service.call(owner, input);
  assert.ok(kv.expiries.get(`wb:${input.room}:creation`) > 0);
  assert.equal(await kv.get(`wb:${input.room}:creation`), null);
});
