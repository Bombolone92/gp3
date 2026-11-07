// Shared helpers for the team review tests: the team worker running against
// in-memory stand-ins for the owner's KV and drive.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/worker/fleet-team-worker.js'), 'utf8');

export function fakeKV() {
  const data = new Map();
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return {
    data,
    async get(k) {
      await tick();
      return data.has(k) ? structuredClone(data.get(k)) : null;
    },
    async set(k, v) {
      await tick();
      if (Array.isArray(k)) for (const it of k) data.set(it.key, structuredClone(it.value));
      else data.set(k, structuredClone(v));
      return true;
    },
    async del(k) {
      await tick();
      data.delete(k);
      return true;
    },
    async expire() {
      return true;
    },
    // Atomic, like Puter KV: no await between the read and the write.
    async incr(k, paths = 1) {
      if (typeof paths === 'number') {
        const n = (Number(data.get(k)) || 0) + paths;
        data.set(k, n);
        return n;
      }
      const cur = data.get(k) || {};
      for (const [p, n] of Object.entries(paths)) cur[p] = (cur[p] || 0) + n;
      data.set(k, cur);
      return structuredClone(cur);
    },
    async list({ pattern, returnValues }) {
      await tick();
      const keys = [...data.keys()].filter((k) => k.startsWith(pattern)).sort();
      return { items: keys.map((k) => (returnValues ? { key: k, value: structuredClone(data.get(k)) } : k)) };
    },
  };
}

export function fakeFS() {
  const files = new Map();
  return {
    files,
    async write(path, blob, opts = {}) {
      if (opts.overwrite === false && files.has(path)) throw new Error('exists');
      files.set(path, blob);
    },
    async read(path) {
      if (!files.has(path)) throw new Error('not found');
      return files.get(path);
    },
    async delete(path) {
      files.delete(path);
    },
  };
}

export const person = (uuid, username) => ({ puter: { auth: { getUser: async () => ({ uuid, username }) } } });

export function loadWorker({ ownerGetUser = async () => ({ uuid: 'owner-1', username: 'olivia' }), kv = fakeKV() } = {}) {
  const routes = [];
  const router = { get: (p, fn) => routes.push(['GET', p, fn]), post: (p, fn) => routes.push(['POST', p, fn]) };
  new Function('router', SOURCE)(router);
  const fsys = fakeFS();
  const me = { puter: { kv, fs: fsys, auth: { getUser: (...a) => ownerGetUser(...a) } } };
  const handler = (method, path) => routes.find(([m, p]) => m === method && p === path)?.[2];
  return {
    kv,
    fsys,
    async api(user, body) {
      const res = await handler('POST', '/api')({ me, user, request: { json: async () => body, headers: new Headers() } });
      return { status: res.status, body: await res.json() };
    },
    async health() {
      return (await handler('GET', '/health')({ me })).json();
    },
    exec(user) {
      return async (url, init) => handler('POST', '/api')({ me, user, request: { json: async () => JSON.parse(init.body), headers: new Headers() } });
    },
  };
}

export const OWNER = person('owner-1', 'olivia');
export const SAM = person('user-2', 'sam');
export const ALEX = person('user-3', 'alex');
