import { BoardService } from "../worker/service.js";
import { authenticate } from "../worker/auth.js";
export const owner = {
  uuid: "11111111-1111-4111-8111-111111111111",
  username: "Alice",
};
export const editor = {
  uuid: "22222222-2222-4222-8222-222222222222",
  username: "Bob",
};
export const viewer = {
  uuid: "33333333-3333-4333-8333-333333333333",
  username: "Cam",
};

export function memoryStore() {
  const rows = new Map();
  return {
    rows,
    async collaborationRows(scope) {
      return [...rows.values()]
        .filter((r) => r.scope === scope)
        .map((r) => structuredClone(r));
    },
    async collaborationPut(row) {
      rows.set(row.id, structuredClone(row));
    },
    async collaborationDelete(id) {
      rows.delete(id);
    },
  };
}
export function environment({ compressedTokens = true } = {}) {
  const data = new Map(),
    files = new Map(),
    fileInfo = new Map(),
    credentials = new Map(),
    handles = new Map(),
    listeners = new Map(),
    calls = [];
  const env = {
    data,
    files,
    credentials,
    calls,
    offline: false,
    dropEvents: false,
    lostAck: false,
    now: Date.now(),
  };
  const kv = {
    async get(key) {
      return structuredClone(data.get(key) ?? null);
    },
    async incr(key) {
      const value = (data.get(key) || 0) + 1;
      data.set(key, value);
      return value;
    },
    // Expiry is recorded, not enforced.
    expiries: new Map(),
    async expire(key, seconds) {
      kv.expiries.set(key, seconds);
      return true;
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
      if (!env.dropEvents)
        for (const [subject, fn] of listeners) {
          const direct = subject === `kv:app-whiteboard:${key}`;
          const handle = [...handles].find(
            ([h, prefix]) =>
              subject === `kv:${h}:signal` && key === prefix + "signal",
          );
          if (direct || handle) queueMicrotask(() => fn({ event: { key } }));
        }
    },
    // Top-level paths only, written as ["field"], as the worker uses them.
    async update(key, paths) {
      const value = structuredClone(data.get(key) ?? {});
      for (const [path, next] of Object.entries(paths)) {
        const field = /^\["(.+)"\]$/.exec(path)?.[1] ?? path;
        value[field] = structuredClone(next);
      }
      data.set(key, value);
      return structuredClone(value);
    },
    async del(key) {
      data.delete(key);
    },
    async list({ pattern, cursor, limit, returnValues, reverse }) {
      const keys = [...data.keys()]
        .filter((k) => k.startsWith(pattern.replace(/\*$/, "")))
        .sort();
      if (reverse) keys.reverse();
      const at = Number(cursor || 0),
        end = at + Math.min(limit, 3);
      return {
        items: keys
          .slice(at, end)
          .map((key) =>
            returnValues ? { key, value: structuredClone(data.get(key)) } : key,
          ),
        cursor: end < keys.length ? String(end) : undefined,
      };
    },
  };
  const fsFor = (user) => ({
    async delete(path) {
      for (const key of [...files.keys()])
        if (key === path || key.startsWith(path + "/")) files.delete(key);
    },
    async write(path, value) {
      files.set(path, typeof value === "string" ? value : await value.text());
      fileInfo.set(path, { owner: { username: user.username } });
      return { path };
    },
    async read(path) {
      if (!files.has(path)) throw Error("Missing file: " + path);
      return new Blob([files.get(path)]);
    },
    async stat(path) {
      if (!files.has(path)) throw Error("Missing file: " + path);
      return {
        path,
        size: new TextEncoder().encode(files.get(path)).length,
        is_shared:
          fileInfo.get(path).owner.username === user.username ? false : null,
        ...fileInfo.get(path),
      };
    },
    async getReadURL(path) {
      if (!files.has(path)) throw Error("Missing file: " + path);
      const token =
        "header." +
        btoa(
          JSON.stringify({
            ...(compressedTokens
              ? {
                  t: "t",
                  v: "2",
                  uu: Buffer.from(
                    user.uuid.replaceAll("-", ""),
                    "hex",
                  ).toString("base64"),
                }
              : { type: "access-token", user_uid: user.uuid }),
            token_uid: crypto.randomUUID(),
            exp: Math.floor(Date.now() / 1000) + 86400,
          }),
        ) +
        ".signature";
      credentials.set(token, { user, path });
      return `https://api.puter.test/token-read?uid=proof&token=${encodeURIComponent(token)}`;
    },
  });
  const fs = fsFor(owner);
  const puter = {
    kv,
    fs,
    auth: { getUser: async () => owner },
    APIOrigin: "https://api.puter.test",
    authToken:
      "header." +
      btoa(JSON.stringify({ app_uid: "app-whiteboard" })) +
      ".signature",
  };
  const service = new BoardService(puter, {
    now: () => env.now,
    fetcher: async (url, options) => {
      if (options.method === "DELETE") {
        handles.delete(url.split("/").at(-1));
        return Response.json({});
      }
      const { granteeUid, prefix } = JSON.parse(options.body),
        handle = "handle-" + granteeUid;
      handles.set(handle, prefix);
      return Response.json({ handle });
    },
  });
  env.service = service;
  env.requestor = (token) => {
    const credential = credentials.get(token);
    if (!credential)
      throw Object.assign(Error("Invalid credential"), { status: 401 });
    const denied = () => {
      throw Object.assign(Error("Restricted credential"), { status: 403 });
    };
    const readOnly = fsFor(credential.user);
    const allowed = (path) => {
      if (credential.revoked)
        throw Object.assign(Error("Revoked credential"), { status: 401 });
      if (path !== credential.path) denied();
    };
    return {
      authToken: token,
      auth: {
        getUser: async () => {
          throw Object.assign(
            Error("Access tokens are not allowed to access this resource"),
            { code: "forbidden" },
          );
        },
      },
      fs: {
        stat: async (path) => {
          allowed(path);
          return readOnly.stat(path);
        },
        read: async (path) => {
          allowed(path);
          return readOnly.read(path);
        },
        write: denied,
      },
      kv: { get: denied, set: denied },
    };
  };
  env.sdk = (user) => ({
    ...puter,
    // Client KV belongs to the signed-in account. The worker's KV remains the
    // owner's, so a guest cannot discover or update the owner's deployment.
    kv:
      user.uuid === owner.uuid
        ? kv
        : {
            get: (key) => kv.get(`account:${user.uuid}:${key}`),
            set: (key, ...args) =>
              kv.set(`account:${user.uuid}:${key}`, ...args),
            incr: (key) => kv.incr(`account:${user.uuid}:${key}`),
            del: (key) => kv.del(`account:${user.uuid}:${key}`),
            async list(options) {
              const prefix = `account:${user.uuid}:`;
              const page = await kv.list({
                ...options,
                pattern: prefix + options.pattern,
              });
              return {
                ...page,
                items: page.items.map((item) =>
                  typeof item === "string"
                    ? item.slice(prefix.length)
                    : { ...item, key: item.key.slice(prefix.length) },
                ),
              };
            },
          },
    fs: fsFor(user),
    authToken:
      "header." +
      btoa(
        JSON.stringify({
          ...(compressedTokens
            ? { t: "au", v: "2" }
            : { type: "app-under-user" }),
          app_uid: "app-whiteboard",
          user_uid: user.uuid,
        }),
      ) +
      ".signature",
    env: "web",
    auth: {
      isSignedIn: () => true,
      signIn: async () => {},
      getUser: async () => user,
    },
    events: {
      onLocal: async (subject, fn) => {
        listeners.set(
          subject + (listeners.has(subject) ? "duplicate" : ""),
          fn,
        );
        return { off: () => listeners.delete(subject) };
      },
    },
    workers: {
      exec: async (url, options) => {
        if (env.offline) throw Error("Network unavailable");
        const input = JSON.parse(options.body);
        calls.push({ user: user.uuid, ...input });
        try {
          const token = options.headers["puter-auth"];
          const identity = await authenticate(
            // Only HTTP data crosses into the worker, not the browser's
            // AbortSignal (which belongs to a different realm in jsdom).
            new Request(url, {
              method: options.method,
              headers: options.headers,
              body: options.body,
            }),
            env.requestor(token),
            input,
          );
          const result = await service.call(identity, input);
          if (input.op === "commit" && env.lostAck) {
            env.lostAck = false;
            throw Error("Lost acknowledgement");
          }
          return Response.json(result);
        } catch (error) {
          return Response.json(
            { message: error.message },
            { status: error.status || 500 },
          );
        }
      },
    },
  });
  return env;
}
