// In-memory stand-ins for the Puter services the collaboration worker and
// sessions use, so tests run the real server code against several clients.
import { DocService } from '../worker/service.js';
import { CollabSession } from '../src/features/collab/session.js';
import { memoryOutbox } from '../src/features/collab/outbox.js';
import { VDocument } from '../src/model/document.js';

export const alice = { uuid: '11111111-1111-4111-8111-111111111111', username: 'alice' };
export const bob = { uuid: '22222222-2222-4222-8222-222222222222', username: 'bob' };
export const cam = { uuid: '33333333-3333-4333-8333-333333333333', username: 'cam' };
export const SERVER = 'https://vs-test.puter.work';

export function memoryPuter(owner = alice) {
  const data = new Map();
  const files = new Map();
  const kv = {
    data,
    async get(key) {
      return Array.isArray(key) ? key.map((k) => structuredClone(data.get(k) ?? null)) : structuredClone(data.get(key) ?? null);
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
      return true;
    },
    async del(key) {
      data.delete(key);
      return true;
    },
    async incr(key, n = 1) {
      const v = (data.get(key) || 0) + n;
      data.set(key, v);
      return v;
    },
    async expire() {
      return true;
    },
    async list({ pattern, returnValues, cursor, limit = 1000 }) {
      const keys = [...data.keys()].filter((k) => k.startsWith(pattern.replace(/\*$/, ''))).sort();
      const at = Number(cursor || 0);
      const end = at + Math.min(limit, 3);
      return { items: keys.slice(at, end).map((key) => (returnValues ? { key, value: structuredClone(data.get(key)) } : key)), cursor: end < keys.length ? String(end) : undefined };
    },
  };
  const fs = {
    files,
    async write(path, text) {
      files.set(path, String(text));
      return { path };
    },
    async read(path) {
      if (!files.has(path)) throw new Error(`Missing ${path}`);
      return new Blob([files.get(path)]);
    },
  };
  return { kv, fs, auth: { getUser: async () => owner } };
}

/** A network between clients and one server, which tests can take down. */
export function network(owner = alice) {
  const puter = memoryPuter(owner);
  const service = new DocService(puter);
  const net = { puter, service, offline: new Set(), calls: [], lostAck: false };
  net.transport = (user) => ({
    async call(input) {
      net.calls.push({ user: user.username, op: input.op });
      if (net.offline.has(user.uuid)) throw Object.assign(new Error('offline'), { offline: true });
      try {
        const out = structuredClone(await service.call(user, structuredClone(input)));
        if (net.lostAck && input.op === 'commit') {
          net.lostAck = false;
          throw Object.assign(new Error('lost'), { offline: true });
        }
        return out;
      } catch (err) {
        if (err.offline) throw err;
        throw Object.assign(new Error(err.message), { status: err.status || 500 });
      }
    },
  });
  return net;
}

/** A joined client: { session, doc, editor }. */
export async function joinClient(net, user, room, { invite = null, outbox = memoryOutbox() } = {}) {
  const session = new CollabSession({ transport: net.transport(user), server: SERVER, room, user, outbox, timers: false });
  const data = await session.join(invite);
  const doc = VDocument.fromJSON({ nodes: data.nodes, assets: data.assets, comments: data.comments });
  const editor = { doc };
  session.bind(editor);
  return { session, doc, editor, outbox };
}

/** Share a new document as `owner` and return its client and room id. */
export async function shareNew(net, owner = alice, doc = VDocument.create({ name: 'Shared' })) {
  const room = `room${Math.random().toString(36).slice(2, 10)}`;
  const session = new CollabSession({ transport: net.transport(owner), server: SERVER, room, user: owner, outbox: memoryOutbox(), timers: false });
  await session.create(doc, doc.name);
  session.bind({ doc });
  return { room, client: { session, doc, editor: { doc } } };
}

/** Let every client send what it has and read everyone else's edits. */
export async function settle(...clients) {
  for (let round = 0; round < 3; round++) {
    for (const c of clients) {
      await c.session.sending;
      await c.session.sync();
      await c.session.sending;
    }
  }
}

export function rect(id, x = 0, y = 0, extra = {}) {
  const pt = (px, py) => ({ x: px, y: py, ix: px, iy: py, ox: px, oy: py });
  return { id, type: 'path', name: '', anchors: [pt(x, y), pt(x + 10, y), pt(x + 10, y + 10), pt(x, y + 10)], closed: true, fill: { type: 'solid', color: '#ff0000' }, stroke: null, ...extra };
}

/** Comparable document content: nodes without derived caches. */
export function content(doc) {
  const out = {};
  for (const [id, n] of doc.nodes) out[id] = n;
  // A loaded root carries parent: null, a new one none: the same thing.
  const json = JSON.parse(JSON.stringify(out));
  if (json.root) delete json.root.parent;
  return json;
}
