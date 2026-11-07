import { describe, it, expect } from 'vitest';
import {
  BLOCK_SIZE, blockIndexOf, firstSeqOfBlock, lastSeqOfBlock, isFirstInBlock,
  mergeBlock, overlayKey, threadConvId, parentOfThread,
} from '../src/shared/blocks.js';

describe('block math', () => {
  it('maps sequence numbers onto fixed-size blocks', () => {
    expect(blockIndexOf(1)).toBe(0);
    expect(blockIndexOf(BLOCK_SIZE)).toBe(0);
    expect(blockIndexOf(BLOCK_SIZE + 1)).toBe(1);
    expect(blockIndexOf(BLOCK_SIZE * 7)).toBe(6);
    expect(blockIndexOf(BLOCK_SIZE * 7 + 1)).toBe(7);
  });

  it('block bounds are inverse of the index', () => {
    for (const n of [0, 1, 2, 99]) {
      expect(blockIndexOf(firstSeqOfBlock(n))).toBe(n);
      expect(blockIndexOf(lastSeqOfBlock(n))).toBe(n);
      expect(lastSeqOfBlock(n) - firstSeqOfBlock(n) + 1).toBe(BLOCK_SIZE);
    }
  });

  it('knows the first message of each block', () => {
    expect(isFirstInBlock(1)).toBe(true);
    expect(isFirstInBlock(2)).toBe(false);
    expect(isFirstInBlock(BLOCK_SIZE + 1)).toBe(true);
    expect(isFirstInBlock(BLOCK_SIZE)).toBe(false);
  });

  it('overlay keys never look like array indexes', () => {
    expect(overlayKey(12)).toBe('s12');
    expect(/^\d/.test(overlayKey(0))).toBe(false);
  });

  it('thread ids round-trip to their parent', () => {
    const id = threadConvId('abc123', 42);
    expect(parentOfThread(id)).toEqual({ conv: 'abc123', seq: 42 });
    expect(parentOfThread('abc123')).toBeNull();
    expect(parentOfThread('dm_x_t5')).toEqual({ conv: 'dm_x', seq: 5 });
  });
});

describe('mergeBlock', () => {
  const block = {
    m: [
      { s: 1, u: 'a', t: 'hello', ts: 100 },
      { s: 2, u: 'b', t: 'edited later', ts: 200, a: [{ id: 'f1', name: 'x.png' }] },
      { s: 3, u: 'a', t: 'gone', ts: 300 },
      { s: 4, u: 'a', t: 'gone but has replies', ts: 400 },
      null,
      { u: 'broken' },
    ],
    x: {
      s2: { t: 'edited now', e: 250, r: { heart: { a: 1 } } },
      s3: { d: 1 },
      s4: { d: 1, rc: 2, rt: 450 },
    },
  };

  it('applies overlays and drops malformed entries', () => {
    const out = mergeBlock(block);
    expect(out.map((m) => m.seq)).toEqual([1, 2, 4]);
    expect(out[1].text).toBe('edited now');
    expect(out[1].editedAt).toBe(250);
    expect(out[1].reactions).toEqual({ heart: { a: 1 } });
    expect(out[1].attachments).toHaveLength(1);
  });

  it('keeps a deleted message only when it anchors a thread', () => {
    const out = mergeBlock(block);
    const tomb = out.find((m) => m.seq === 4);
    expect(tomb.deleted).toBe(true);
    expect(tomb.replyCount).toBe(2);
    expect(out.find((m) => m.seq === 3)).toBeUndefined();
  });

  it('strips a tombstone of everything but its place and reply count', () => {
    const out = mergeBlock({
      m: [{ s: 1, u: 'a', t: 'secret @b', ts: 10, mn: ['b'], bc: 'channel', a: [{ id: 'f1', name: 'plan.pdf' }] }],
      x: { [overlayKey(1)]: { d: 1, rc: 2, rt: 20, r: { heart: { b: 1 } }, f: { a: 1, b: 1 }, uf: { url: 'https://x' } } },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ seq: 1, user: 'a', ts: 10, deleted: true, replyCount: 2, lastReplyAt: 20 });
    expect(out[0].text).toBe('');
    expect(out[0].mentions).toEqual([]);
    expect(out[0].attachments).toEqual([]);
    expect(out[0].reactions).toEqual({});
    expect(out[0].followers).toBeNull();
    expect(out[0].broadcast).toBeNull();
    expect(out[0].unfurl).toBeNull();
  });

  it('carries the client id a message was sent with', () => {
    const out = mergeBlock({ m: [{ s: 1, u: 'a', t: 'x', ts: 1, cid: 'c_123' }, { s: 2, u: 'a', t: 'y', ts: 2 }], x: {} });
    expect(out.map((m) => m.cid)).toEqual(['c_123', null]);
  });

  it('tolerates empty and missing blocks', () => {
    expect(mergeBlock(null)).toEqual([]);
    expect(mergeBlock({})).toEqual([]);
    expect(mergeBlock({ m: [] })).toEqual([]);
  });
});
