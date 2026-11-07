import test from "node:test";
import assert from "node:assert/strict";
import { ListingQueue } from "../worker/listings.js";

test("listings wait in order and keep at most two storage requests running", async () => {
  const queue = new ListingQueue({ interval: 1 });
  let active = 0,
    peak = 0;
  const started = [];
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, n) =>
      queue.run(async () => {
        started.push(n);
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return n;
      }),
    ),
  );
  assert.equal(peak, 2);
  assert.deepEqual(started, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(results, started);
  assert.equal(queue.running.size, 0);
  assert.equal(queue.queue.length, 0);
});

test("a stalled listing cannot poison later requests", async () => {
  const queue = new ListingQueue({ limit: 1, timeout: 20, interval: 1 });
  const stalled = queue.run(() => new Promise(() => {}));
  const waiting = queue.run(() => "next");
  const results = await Promise.allSettled([stalled, waiting]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[0].reason.status, 503);
  assert.equal(queue.running.size, 0);
  assert.equal(queue.queue.length, 0);
  assert.equal(await queue.run(() => "recovered"), "recovered");
});

test("admission recovers metadata left by cancelled worker requests", async () => {
  const queue = new ListingQueue({ limit: 1 });
  queue.running.add({ at: Date.now() - 30_000, expires: Date.now() - 1 });
  queue.queue.push({ expires: Date.now() - 1 });
  assert.equal(await queue.run(() => "recovered"), "recovered");
  assert.equal(queue.running.size, 0);
  assert.equal(queue.queue.length, 0);
});

test("a refused listing releases its slot and preserves the storage error", async () => {
  const queue = new ListingQueue({ limit: 1 });
  const error = Object.assign(Error("Too many requests"), { status: 429 });
  await assert.rejects(
    queue.run(() => Promise.reject(error)),
    (caught) => caught === error,
  );
  assert.equal(await queue.run(() => "next"), "next");
});
