export const PROTOCOL = 1;
export const SESSION_TTL = 90_000;
export const MAX_UPDATE = 240_000;
export const ID = /^[a-zA-Z0-9_-]{1,100}$/;
export const ASSET = /^asset:([a-f0-9]{64})$/;
export const enc = new TextEncoder();
// Board roles, from most to least capable. Commenters can discuss, react,
// and vote but not change content; viewers only read and follow.
export const ROLES = ["owner", "facilitator", "editor", "commenter", "viewer"];
export const canEditContent = (role) =>
  role === "owner" || role === "facilitator" || role === "editor";
export const canComment = (role) =>
  canEditContent(role) || role === "commenter";
export const canManage = (role) => role === "owner" || role === "facilitator";
export function encode(bytes) {
  let text = "";
  for (let n = 0; n < bytes.length; n += 8192)
    text += String.fromCharCode(...bytes.subarray(n, n + 8192));
  return btoa(text);
}
// Callers that read a commit or a peer message pass its own limit. A whole
// board's state has none beyond the board's limits, which it can outgrow as
// it is edited: a cap here would leave a large board impossible to open.
export function decode(value, max = Infinity) {
  // Base64 never has a length of one more than a multiple of four; atob
  // would throw its own exception for it rather than this message.
  if (
    typeof value !== "string" ||
    value.length > max ||
    value.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw Error("Invalid collaboration update.");
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
export async function hash(value) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        typeof value === "string" ? enc.encode(value) : value,
      ),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export async function keyPair() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey),
    publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey),
  };
}
// Imported keys by JWK. Peers sign and verify every packet with the same
// few keys, so each is imported once.
const imported = new Map();
function importKey(jwk, usage) {
  const id = usage + JSON.stringify(jwk);
  let key = imported.get(id);
  if (!key) {
    if (imported.size >= 1024) imported.delete(imported.keys().next().value);
    key = crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      [usage],
    );
    imported.set(id, key);
    key.catch(() => {
      if (imported.get(id) === key) imported.delete(id);
    });
  }
  return key;
}
export async function sign(key, value) {
  const k = await importKey(key, "sign");
  return encode(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        k,
        enc.encode(JSON.stringify(value)),
      ),
    ),
  );
}
export async function verify(key, value, signature) {
  try {
    const k = await importKey(key, "verify");
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      k,
      decode(signature, 200),
      enc.encode(JSON.stringify(value)),
    );
  } catch {
    return false;
  }
}
export function workerURL(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9-]+\.puter\.work$/.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error("Invalid Whiteboard server address.");
  return url.origin;
}
export function shareLink(server, room, token) {
  const url = new URL(location.href);
  url.hash = new URLSearchParams({
    server: workerURL(server),
    board: room,
    ...(token ? { invite: token } : {}),
  }).toString();
  return url.href;
}
export function parseLink(value) {
  const url = new URL(value, location.href);
  const p = new URLSearchParams(url.hash.slice(1));
  const room = p.get("board");
  if (!room || !ID.test(room)) throw Error("Invalid board invitation.");
  return {
    server: workerURL(p.get("server")),
    room,
    token: p.get("invite") || undefined,
  };
}
// The most people in one peer group.
export const PEER_GROUP = 32;
// Peer links for a roster. Up to eight sessions link to each other. Larger
// rooms form groups whose two relays link to every member and to all other
// relays. When the worker assigned every session a lasting group and join
// time, groups are those and relays are each group's longest present, so
// someone joining or leaving changes only their own links unless they
// relayed. Otherwise groups are runs of sessions in ID order, which anyone
// joining or leaving shifts.
export function topology(roster) {
  if (
    roster.length > 8 &&
    roster.every(
      (p) =>
        p.topology === 2 &&
        Number.isSafeInteger(p.group) &&
        p.group >= 0 &&
        Number.isFinite(p.since),
    )
  )
    return lastingTopology(roster);
  const ids = roster.map((p) => p.session).sort();
  const edges = new Map(ids.map((id) => [id, new Set()]));
  const groupOf = new Map(),
    primaryOf = new Map();
  const link = (a, b) => {
    if (a && b && a !== b) {
      edges.get(a).add(b);
      edges.get(b).add(a);
    }
  };
  if (ids.length <= 8) {
    for (const a of ids) for (const b of ids) link(a, b);
    return { edges, relays: new Set(ids), groupOf, primaryOf };
  }
  const relays = [];
  for (let i = 0; i < ids.length; i += PEER_GROUP) {
    const group = ids.slice(i, i + PEER_GROUP),
      heads = group.slice(0, 2);
    for (const id of group) {
      groupOf.set(id, i);
      primaryOf.set(id, heads[0]);
    }
    relays.push(...heads);
    for (const member of group) for (const head of heads) link(member, head);
  }
  for (const a of relays) for (const b of relays) link(a, b);
  return { edges, relays: new Set(relays), groupOf, primaryOf };
}
function lastingTopology(roster) {
  const edges = new Map(roster.map((p) => [p.session, new Set()]));
  const groupOf = new Map(),
    primaryOf = new Map(),
    groups = new Map(),
    relays = [];
  const link = (a, b) => {
    if (a !== b) {
      edges.get(a).add(b);
      edges.get(b).add(a);
    }
  };
  for (const p of roster) {
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group).push(p);
  }
  for (const [group, members] of groups) {
    members.sort(
      (a, b) =>
        a.since - b.since ||
        (a.session < b.session ? -1 : a.session > b.session ? 1 : 0),
    );
    const heads = members.slice(0, 2).map((p) => p.session);
    for (const { session } of members) {
      groupOf.set(session, group);
      primaryOf.set(session, heads[0]);
      for (const head of heads) link(session, head);
    }
    relays.push(...heads);
  }
  for (const a of relays) for (const b of relays) link(a, b);
  return { edges, relays: new Set(relays), groupOf, primaryOf };
}
