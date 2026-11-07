import test from "node:test";
import assert from "node:assert/strict";
import { call } from "../src/collaboration/api.js";
import { tokenClaims } from "../src/collaboration/auth.js";
import { authenticate } from "../worker/auth.js";
import { hash, keyPair, sign } from "../src/collaboration/protocol.js";
import { environment, owner, editor } from "./collaboration-helpers.js";

const server = "https://invited.puter.work";
const input = { op: "join", room: "board" };

async function capture(puter, data = input, origin = server) {
  let request;
  puter.workers.exec = async (url, options) => {
    request = new Request(url, options);
    return Response.json({ ok: true });
  };
  await call(puter, origin, data);
  return request;
}

function caller(env, request) {
  return env.requestor(request.headers.get("puter-auth"));
}

test("restricted tokens authenticate through their owned proof without calling whoami", async () => {
  const env = environment(),
    request = await capture(env.sdk(owner)),
    user = caller(env, request);
  await assert.rejects(user.auth.getUser(), /Access tokens are not allowed/);
  assert.deepEqual(await authenticate(request, user, input), owner);
  user.fs.stat = async () => {
    throw Error("Token expired or revoked");
  };
  await assert.rejects(authenticate(request, user, input), { status: 401 });
});

test("compressed token subjects decode safely and ambiguous subjects are rejected", () => {
  const compact = Buffer.from(owner.uuid.replaceAll("-", ""), "hex").toString(
    "base64",
  );
  const claims = (body) =>
    tokenClaims("header." + btoa(JSON.stringify(body)) + ".signature");
  assert.equal(claims({ t: "t", uu: compact }).user_uid, owner.uuid);
  assert.equal(claims({ t: "t", uu: owner.uuid }).user_uid, owner.uuid);
  assert.equal(
    claims({ type: "access-token", user_uid: owner.uuid }).user_uid,
    owner.uuid,
  );
  for (const uu of ["", "not-a-uuid", "YWJj", null, {}, 42])
    assert.equal(claims({ t: "t", uu }).user_uid, undefined);
  assert.deepEqual(claims({ t: "t", uu: compact, user_uid: editor.uuid }), {});
});

test("Puter's compressed access tokens cannot bypass proof verification", async () => {
  const env = environment(),
    puter = env.sdk(owner);
  await puter.fs.write("proof.json", "{}");
  const url = new URL(await puter.fs.getReadURL("proof.json"));
  const token = url.searchParams.get("token");
  const request = new Request(server + "/api", {
    headers: { "puter-auth": token },
  });
  await assert.rejects(authenticate(request, env.requestor(token), input), {
    status: 401,
  });
});

test("legacy uncompressed credentials still support signed collaboration requests", async () => {
  const env = environment({ compressedTokens: false });
  const request = await capture(env.sdk(owner));
  assert.equal(
    (await authenticate(request, caller(env, request), input)).uuid,
    owner.uuid,
  );
});

test("unknown and ambiguous token types never enter the legacy authentication path", async () => {
  const puter = { auth: { getUser: async () => owner } };
  for (const claims of [
    null,
    [],
    {},
    { t: "unknown" },
    { type: "unknown" },
    { t: "t", type: "session" },
  ]) {
    const token = "header." + btoa(JSON.stringify(claims)) + ".signature";
    const request = new Request(server + "/api", {
      headers: { "puter-auth": token },
    });
    await assert.rejects(authenticate(request, puter, input), { status: 401 });
  }
  for (const claims of [
    { t: "s" },
    { t: "au" },
    { type: "session" },
    { type: "app-under-user" },
  ]) {
    const token = "header." + btoa(JSON.stringify(claims)) + ".signature";
    const request = new Request(server + "/api", {
      headers: { "puter-auth": token },
    });
    assert.equal((await authenticate(request, puter, input)).uuid, owner.uuid);
  }
});

test("an invited worker never receives the caller's app credential", async () => {
  const puter = environment().sdk(owner);
  let delegated;
  puter.workers.exec = async (_url, options) => {
    // Puter workers.exec supplies authToken when this header is absent.
    delegated = options.headers["puter-auth"] || puter.authToken;
    return Response.json({ ok: true });
  };
  await call(puter, "https://invited.puter.work", {
    op: "join",
    room: "board",
  });
  assert.notEqual(delegated, puter.authToken);
});

test("delegated credentials read only the public proof and still authenticate collaborators", async () => {
  const env = environment(),
    puter = env.sdk(owner);
  await puter.fs.write("whiteboard/private.json", "Private board");
  const request = await capture(puter);
  const user = caller(env, request);
  const proof = JSON.parse(request.headers.get("x-whiteboard-proof"));
  const file = JSON.parse(await (await user.fs.read(proof.path)).text());
  assert.deepEqual(Object.keys(file).sort(), ["publicKey", "version"]);
  assert.equal(file.publicKey.d, undefined);
  await assert.rejects(user.fs.read("whiteboard/private.json"), {
    status: 403,
  });
  assert.throws(() => user.fs.write(proof.path, "overwrite"), { status: 403 });
  assert.throws(() => user.kv.get("private"), { status: 403 });
  assert.throws(() => user.kv.set("private", "overwrite"), { status: 403 });
  assert.equal((await authenticate(request, user, input)).uuid, owner.uuid);
});

test("a captured credential cannot change rooms, operations, bodies, or destination servers", async () => {
  const env = environment(),
    request = await capture(env.sdk(owner));
  const user = caller(env, request);
  for (const data of [
    { ...input, room: "another-board" },
    { ...input, op: "role", user: editor.uuid, role: "owner" },
    { ...input, token: "another-invitation" },
  ])
    await assert.rejects(authenticate(request, user, data), { status: 401 });
  const forwarded = new Request("https://another-owner.puter.work/api", {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(input),
  });
  await assert.rejects(authenticate(forwarded, user, input), { status: 401 });
  for (const proof of [null, "not JSON", "{}", "x".repeat(4097)]) {
    const headers = new Headers(request.headers);
    if (proof === null) headers.delete("x-whiteboard-proof");
    else headers.set("x-whiteboard-proof", proof);
    await assert.rejects(
      authenticate(new Request(request.url, { headers }), user, input),
      { status: 401 },
    );
  }
});

test("an attacker cannot substitute their own publicly readable proof file", async () => {
  const env = environment(),
    request = await capture(env.sdk(owner));
  const user = caller(env, request);
  const keys = await keyPair(),
    path = "whiteboard/attacker-proof.json";
  const attacker = env.sdk(editor);
  await attacker.fs.write(
    path,
    JSON.stringify({ version: 1, publicKey: keys.publicKey }),
  );
  // Even if the storage service allows this public read, the file is not owned
  // by the person authenticated by the stolen credential.
  // Puter's stat response reports is_shared:null when the caller does not
  // own a readable file. Use the victim's filesystem context for that check.
  user.fs = env.sdk(owner).fs;
  const headers = new Headers(request.headers);
  headers.set(
    "x-whiteboard-proof",
    JSON.stringify({
      version: 1,
      path,
      signature: await sign(keys.privateKey, [
        server,
        path,
        await hash(JSON.stringify(input)),
      ]),
    }),
  );
  await assert.rejects(
    authenticate(new Request(request.url, { headers }), user, input),
    { status: 401 },
  );
});

test("revocation is checked even while a proof is cached", async () => {
  const env = environment(),
    request = await capture(env.sdk(owner));
  const user = caller(env, request);
  await authenticate(request, user, input);
  env.credentials.get(request.headers.get("puter-auth")).revoked = true;
  await assert.rejects(authenticate(request, user, input), { status: 401 });
});

test("credentials are reused across boards and reloads, and renewed before expiry", async (t) => {
  const env = environment(),
    puter = env.sdk(owner);
  const now = Date.now();
  t.mock.method(Date, "now", () => now);
  const a = await capture(puter);
  const b = await capture(
    puter,
    { ...input, room: "another-board" },
    "https://other.puter.work",
  );
  const c = await capture(env.sdk(owner));
  assert.equal(env.credentials.size, 1);
  assert.equal(a.headers.get("puter-auth"), b.headers.get("puter-auth"));
  assert.equal(a.headers.get("puter-auth"), c.headers.get("puter-auth"));
  t.mock.method(Date, "now", () => now + 24 * 60 * 60_000);
  const renewed = await capture(puter);
  assert.equal(env.credentials.size, 2);
  assert.notEqual(
    renewed.headers.get("puter-auth"),
    a.headers.get("puter-auth"),
  );
  assert.equal(
    (await authenticate(renewed, caller(env, renewed), input)).uuid,
    owner.uuid,
  );
});

test("concurrent calls share a mint and concurrent first-time tabs retain usable proofs", async () => {
  const env = environment(),
    puter = env.sdk(owner);
  puter.workers.exec = async () => Response.json({});
  await Promise.all(
    Array.from({ length: 20 }, () => call(puter, server, input)),
  );
  assert.equal(env.credentials.size, 1);
  const other = environment();
  const requests = await Promise.all([
    capture(other.sdk(owner)),
    capture(other.sdk(owner)),
  ]);
  for (const request of requests)
    assert.equal(
      (await authenticate(request, caller(other, request), input)).uuid,
      owner.uuid,
    );
});

test("failed setup retries without sending an app credential, and account changes discard pending authorization", async () => {
  const env = environment(),
    puter = env.sdk(owner);
  let sends = 0;
  puter.workers.exec = async () => {
    sends++;
    return Response.json({});
  };
  const mint = puter.fs.getReadURL;
  puter.fs.getReadURL = async () => {
    throw Error("Temporary mint failure");
  };
  await assert.rejects(call(puter, server, input), /Temporary mint failure/);
  assert.equal(sends, 0);
  puter.fs.getReadURL = mint;
  await call(puter, server, input);
  assert.equal(sends, 1);
  const next = env.sdk(editor),
    nextMint = next.fs.getReadURL;
  next.workers.exec = puter.workers.exec;
  next.fs.getReadURL = async (...args) => {
    const url = await nextMint(...args);
    next.authToken = puter.authToken;
    return url;
  };
  await assert.rejects(call(next, server, input), /account changed/);
  assert.equal(sends, 1);
});

test("signing covers the exact JSON body even if its input mutates during credential setup", async () => {
  const env = environment(),
    puter = env.sdk(owner);
  const data = { ...input },
    mint = puter.fs.getReadURL;
  puter.fs.getReadURL = async (...args) => {
    data.room = "changed-in-flight";
    return mint(...args);
  };
  const request = await capture(puter, data);
  const sent = await request.json();
  assert.equal(sent.room, "board");
  assert.equal(
    (await authenticate(request, caller(env, request), sent)).uuid,
    owner.uuid,
  );
});

test("an unscoped credential returned by storage is rejected before contacting a worker", async () => {
  const env = environment(),
    puter = env.sdk(owner);
  puter.fs.getReadURL = async () =>
    `https://api.puter.test/token-read?token=${encodeURIComponent(puter.authToken)}`;
  await assert.rejects(capture(puter), /restricted collaboration credential/);
  assert.equal(
    await puter.kv.get(
      `whiteboard-collaboration-auth-v1:${await hash(puter.authToken)}`,
    ),
    null,
  );
});

test("commits carrying edits for clocks the board has not seen are refused", async () => {
  const Y = await import("yjs");
  const encoding = await import("lib0/encoding");
  const { SharedDocument } = await import("../src/collaboration/document.js");
  const { board: newBoard, item } = await import("../src/model.js");
  const { encode, hash } = await import("../src/collaboration/protocol.js");
  const { environment, owner, viewer } =
    await import("./collaboration-helpers.js");
  const env = environment();
  const b = newBoard("Workshop");
  b.items = [item("note", 0, 0, { text: "Existing" })];
  const seed = new SharedDocument();
  seed.commit(b);
  await env.service.call(owner, {
    op: "create",
    room: b.id,
    update: encode(seed.update()),
  });
  const { token } = await env.service.call(owner, {
    op: "invite",
    room: b.id,
    role: "commenter",
  });
  await env.service.call(viewer, { op: "join", room: b.id, token });
  // A delete set for the owner's future edits, which no check can see.
  const { doc } = await env.service.load(b.id);
  const [client, clock] = [...Y.decodeStateVector(doc.vector())][0];
  doc.destroy();
  const e = encoding.createEncoder();
  for (const n of [0, 1, client, 1, clock, 1_000_000])
    encoding.writeVarUint(e, n);
  const forged = encoding.toUint8Array(e);
  await assert.rejects(
    env.service.call(viewer, {
      op: "commit",
      room: b.id,
      id: await hash(forged),
      update: encode(forged),
    }),
    { status: 409 },
  );
});

test("mentions ignore punctuation that ends a sentence", async () => {
  const { mentions } = await import("../worker/service.js");
  assert.deepEqual(mentions("Thanks @alice. Ping @bob-, and (@carol)"), [
    "alice",
    "bob",
    "carol",
  ]);
  assert.deepEqual(mentions("email me at a@b.ca"), []);
});

test("a credential the worker stops accepting is replaced once, not reused until it expires", async () => {
  const env = environment(),
    puter = env.sdk(owner),
    tokens = [];
  let refuse = (token) => token === tokens[0];
  puter.workers.exec = async (url, options) => {
    const token = new Request(url, options).headers.get("puter-auth");
    tokens.push(token);
    return refuse(token)
      ? Response.json(
          { message: "Could not verify this collaboration request." },
          { status: 401 },
        )
      : Response.json({ ok: true });
  };
  // The first credential is accepted until it is not.
  refuse = () => false;
  await call(puter, server, input);
  refuse = (token) => token === tokens[0];
  assert.deepEqual(await call(puter, server, input), { ok: true });
  assert.equal(tokens.length, 3);
  assert.notEqual(tokens[2], tokens[0], "a new credential is minted");
  const saved = [...env.data.entries()].find(([key]) =>
    key.startsWith("whiteboard-collaboration-auth-v1:"),
  )[1];
  assert.equal(saved.token, tokens[2], "and saved for the next reload");
  // Refused again at once, it is not minted again in a loop.
  refuse = () => true;
  await assert.rejects(call(puter, server, input), { status: 401 });
  assert.equal(tokens.length, 4);
});

test("requests refused at the same time all go again with one new credential", async () => {
  const env = environment(),
    puter = env.sdk(owner),
    tokens = [];
  let first;
  puter.workers.exec = async (url, options) => {
    const token = new Request(url, options).headers.get("puter-auth");
    tokens.push(token);
    first ??= token;
    // Both requests are in flight before either is refused.
    await new Promise((r) => setTimeout(r, 20));
    return token === first
      ? Response.json({ message: "Refused" }, { status: 401 })
      : Response.json({ ok: true });
  };
  const results = await Promise.all([
    call(puter, server, input),
    call(puter, server, input),
  ]);
  assert.deepEqual(results, [{ ok: true }, { ok: true }]);
  assert.equal(new Set(tokens).size, 2, "one new credential for both");
});
