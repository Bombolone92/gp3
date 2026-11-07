/**
 * Twelfth review pass, the lead's own checks: what the area sweeps left
 * between them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { boot, as, USERS } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';

const { alice } = USERS;
const HOUR = 3600_000;
let rt;

beforeEach(async () => {
  rt = await boot();
});

describe('a reminder note brought in with an imported workspace', () => {
  it('is cleaned as a note set here is: bidi overrides out, an invisible note emptied', async () => {
    const conv = 'impconv001';
    const header = {
      format: 'teamchat-export', version: 1, workspace: { id: 'impnote001', name: 'Old' },
      channels: { [conv]: { name: 'general', def: true } },
      members: { [alice.uuid]: { name: 'alice', username: 'alice', role: 'owner' } },
      memberDocs: { [alice.uuid]: { channels: [conv], dms: {}, reads: {}, notify: {} } },
      sched: [
        // A right-to-left override in front of the words, and a note of a zero-width joiner alone.
        { id: 'remimp0001', kind: 'reminder', u: alice.uuid, conv, seq: 1, note: '‮call back', dueAt: Date.now() + HOUR, createdAt: Date.now() - HOUR },
        { id: 'remimp0002', kind: 'reminder', u: alice.uuid, conv, seq: 1, note: '‍', dueAt: Date.now() + HOUR, createdAt: Date.now() - HOUR },
      ],
    };
    const created = await as(alice).post('/api/workspaces/import', { header });
    expect(created.ok).toBe(true);
    const queue = (await rt.kv.get(KEYS.sched(created.data.workspace.id))).m;
    expect(queue.remimp0001.note).toBe('call back');
    expect(queue.remimp0002.note).toBe('');
  });
});
