// @vitest-environment jsdom
/** Wave 2 review: team sync through the worker. */
import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import { loadWorker, OWNER } from './review-team-helpers.js';
import * as team from '../src/team.js';

const URL_ = 'https://fleet-abc.puter.work';
afterEach(() => {
  delete globalThis.puter;
});

// 21 years of monthly buckets for each partitioned collection: a big import.
const months = Array.from({ length: 252 }, (_, i) => `${2006 + Math.floor(i / 12)}${String((i % 12) + 1).padStart(2, '0')}`);

describe('bumping bucket versions', () => {
  it('bumps every bucket, even more than one request takes', async () => {
    const w = loadWorker();
    globalThis.puter = { workers: { exec: w.exec(OWNER) } };
    const backend = team.createWorkerBackend(URL_);
    const names = ['vehicles', ...months.map((m) => `fuel_${m}`), 'settings'];
    const meta = await backend.bumpVersions(names);
    for (const n of names) expect(meta[n], n).toBe(1);
    const stored = (await w.api(OWNER, { op: 'meta' })).body.meta;
    for (const n of names) expect(stored[n], n).toBe(1);
  });

  it('reports the version each bump made', async () => {
    const w = loadWorker();
    globalThis.puter = { workers: { exec: w.exec(OWNER) } };
    const backend = team.createWorkerBackend(URL_);
    const names = months.map((m) => `meters_${m}`);
    await backend.bumpVersions(names);
    const meta = await backend.bumpVersions(names);
    expect(names.every((n) => meta[n] === 2)).toBe(true);
  });
});
