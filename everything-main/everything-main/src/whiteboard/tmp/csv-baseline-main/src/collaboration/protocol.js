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
export function decode(value, max = 8_000_000) {
  if (
    typeof value !== "string" ||
    value.length > max ||
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
export async function sign(key, value) {
  const k = await crypto.subtle.importKey(
    "jwk",
    key,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
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
    const k = await crypto.subtle.importKey(
      "jwk",
      key,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
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
export function topology(roster) {
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
  for (let i = 0; i < ids.length; i += 32) {
    const group = ids.slice(i, i + 32),
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
