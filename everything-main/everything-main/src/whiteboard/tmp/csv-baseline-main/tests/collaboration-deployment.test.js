import test from "node:test";
import assert from "node:assert/strict";
import { deploy, refreshDeployment } from "../src/collaboration/api.js";
import { environment, owner, editor } from "./collaboration-helpers.js";

const key = "whiteboard-collaboration-worker-v1";
const server = "https://whiteboard-test.puter.work";
const source = "/* whiteboard-worker build=faceb00cfaceb00c at=200 */";
const previous = {
  name: "whiteboard-test",
  server,
  path: "whiteboard/whiteboard-worker.js",
  build: "0000000000000000",
  builtAt: 100,
};

async function fixture(t, config = previous) {
  const env = environment(),
    puter = env.sdk(owner);
  if (config) await puter.kv.set(key, config);
  const counts = { fetch: 0, write: 0, health: 0, create: 0 };
  const fetch = t.mock.method(globalThis, "fetch", async (url) => {
    counts.fetch++;
    assert.equal(url, "/worker/whiteboard-worker.js");
    return new Response(source);
  });
  const write = puter.fs.write;
  puter.fs.write = async (...args) => {
    counts.write++;
    return write(...args);
  };
  puter.workers.create = async () => {
    counts.create++;
    throw Error("Unexpected new worker");
  };
  puter.workers.exec = async (url, options) => {
    counts.health++;
    assert.equal(url, server + "/health");
    assert.equal(options.headers["x-puter-no-auth"], "1");
    return Response.json({ build: env.data.get(key).build });
  };
  return { env, puter, counts, fetch };
}

test("existing worker updates retain their URL and share one check across boards", async (t) => {
  const { env, puter, counts } = await fixture(t);
  const first = refreshDeployment(puter, server);
  assert.equal(refreshDeployment(puter, server), first);
  assert.equal(await first, server);
  assert.equal(await refreshDeployment(puter, server), server);
  assert.equal(env.files.get(previous.path), source);
  assert.deepEqual(env.data.get(key), {
    ...previous,
    build: "faceb00cfaceb00c",
    builtAt: 200,
  });
  assert.deepEqual(counts, { fetch: 1, write: 1, health: 1, create: 0 });
});

test("invitation servers and accounts without deployments cannot trigger worker writes", async (t) => {
  const { env, puter, counts } = await fixture(t);
  await refreshDeployment(env.sdk(editor), server);
  await refreshDeployment(puter, "https://another-owner.puter.work");
  await puter.kv.del(key);
  await refreshDeployment(puter, server);
  assert.deepEqual(counts, { fetch: 0, write: 0, health: 0, create: 0 });
  assert.equal(env.files.size, 0);
});

test("failed background updates can retry without replacing the deployment", async (t) => {
  const { env, puter, counts, fetch } = await fixture(t);
  fetch.mock.mockImplementationOnce(
    async () => new Response("Unavailable", { status: 503 }),
  );
  await assert.rejects(refreshDeployment(puter, server), /could not load/);
  assert.deepEqual(env.data.get(key), previous);
  assert.equal(counts.write, 0);
  assert.equal(await refreshDeployment(puter, server), server);
  assert.equal(counts.write, 1);
  assert.equal(counts.create, 0);
});

test("a worker newer than the downloaded bundle is not downgraded", async (t) => {
  const newer = { ...previous, builtAt: 300 };
  const { env, puter, counts } = await fixture(t, newer);
  await refreshDeployment(puter, server);
  assert.equal(counts.write, 0);
  assert.deepEqual(env.data.get(key), newer);
});

test("sharing a new board already satisfies the background deployment check", async (t) => {
  const { puter, counts } = await fixture(t);
  await deploy(puter);
  await refreshDeployment(puter, server);
  assert.deepEqual(counts, { fetch: 1, write: 1, health: 1, create: 0 });
});

test("changing accounts while the update loads cannot write to the next account", async (t) => {
  const { env, puter, counts, fetch } = await fixture(t);
  fetch.mock.mockImplementationOnce(async () => {
    puter.authToken = "another-account";
    return new Response(source);
  });
  await assert.rejects(refreshDeployment(puter, server), /account changed/);
  assert.equal(counts.write, 0);
  assert.deepEqual(env.data.get(key), previous);
  // The rejected check from the previous login cannot suppress this account's check.
  assert.equal(await refreshDeployment(puter, server), server);
  assert.equal(counts.write, 1);
});
