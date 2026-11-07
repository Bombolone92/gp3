import { describe, it, expect } from 'vitest';
import { applyCommentOps, checkCommentOps, claimLocalComments, createThreadOps, deleteMessageOps, editMessageOps, mentionsIn, messagesOf, pinPosition, replyOps, resolveOps, splitMentions, visibleThreads } from '../src/features/collab/comments.js';
import { VDocument } from '../src/model/document.js';
import { serializeDocument, parseDocument } from '../src/features/files/format.js';
import { network, joinClient, shareNew, settle, alice, bob, cam } from './collab-helpers.js';

const A = { id: alice.uuid, name: 'alice' };
const B = { id: bob.uuid, name: 'bob' };

function thread(id = 't1', author = A, text = 'Hello', anchor = { x: 10, y: 20 }) {
  return applyCommentOps({ threads: {} }, createThreadOps({ id, messageId: `${id}m`, author, text, anchor, now: 1000 }));
}

describe('comment model', () => {
  it('creates threads with a first message and keeps concurrent replies', () => {
    let data = thread();
    const r1 = replyOps('t1', { id: 'r1', author: B, text: 'one', now: 2000 });
    const r2 = replyOps('t1', { id: 'r2', author: A, text: 'two', now: 2000 });
    const left = applyCommentOps(applyCommentOps(data, r1), r2);
    const right = applyCommentOps(applyCommentOps(data, r2), r1);
    expect(left).toEqual(right);
    expect(messagesOf(left.threads.t1).map((m) => m.text)).toEqual(['Hello', 'one', 'two']);
    // Creating again is a no-op.
    expect(applyCommentOps(left, r1)).toBe(left);
  });

  it('edits, deletes and resolves as field registers; deleted threads stop showing', () => {
    let data = thread();
    data = applyCommentOps(data, editMessageOps('t1', 't1m', 'Changed', 3000));
    expect(data.threads.t1.messages.t1m).toMatchObject({ text: 'Changed', edited: 3000 });
    data = applyCommentOps(data, resolveOps('t1', true, B, 4000));
    expect(data.threads.t1).toMatchObject({ resolved: true, resolvedBy: B });
    data = applyCommentOps(data, resolveOps('t1', false, null));
    expect(data.threads.t1.resolved).toBe(false);
    data = applyCommentOps(data, deleteMessageOps('t1', 't1m'));
    expect(data.threads.t1.messages.t1m).toMatchObject({ deleted: true, text: '' });
    expect(visibleThreads(data)).toHaveLength(0);
  });

  it('does not change the input data', () => {
    const data = thread();
    const copy = structuredClone(data);
    applyCommentOps(data, replyOps('t1', { id: 'x', author: B, text: 'hi' }));
    applyCommentOps(data, resolveOps('t1', true, B));
    expect(data).toEqual(copy);
  });

  it('finds @mentions and splits text for display', () => {
    expect(mentionsIn('Hi @bob and @Cam. Mail a@b.com @bob')).toEqual(['bob', 'cam']);
    expect(splitMentions('Thanks @bob!', new Set(['bob']))).toEqual([{ text: 'Thanks ' }, { text: '@bob', mention: 'bob' }, { text: '!' }]);
    expect(splitMentions('Thanks @nobody', new Set(['bob']))).toEqual([{ text: 'Thanks @nobody' }]);
  });

  it('pins on an object follow its bounds and fall back to the last point', () => {
    const t = { anchor: { x: 5, y: 5, node: 'p', dx: 2, dy: 3 } };
    expect(pinPosition(t, () => ({ x: 100, y: 200, w: 10, h: 10 }))).toEqual({ x: 102, y: 203, attached: true });
    expect(pinPosition(t, () => null)).toEqual({ x: 5, y: 5, attached: false });
  });

  it('gives local comments the owner identity when sharing', () => {
    const data = thread('t1', { id: 'local', name: 'You' });
    const claimed = claimLocalComments(data, A);
    expect(claimed.threads.t1.author).toEqual(A);
    expect(claimed.threads.t1.messages.t1m.author).toEqual(A);
  });

  it('checks authorship and roles', () => {
    const data = thread();
    const user = { uuid: bob.uuid };
    expect(() => checkCommentOps(data, replyOps('t1', { id: 'r', author: B, text: 'ok' }), user, 'commenter')).not.toThrow();
    expect(() => checkCommentOps(data, replyOps('t1', { id: 'r', author: A, text: 'pretend' }), user, 'commenter')).toThrow(/yourself/);
    expect(() => checkCommentOps(data, editMessageOps('t1', 't1m', 'hacked'), user, 'editor')).toThrow(/your own/);
    expect(() => checkCommentOps(data, deleteMessageOps('t1', 't1m'), user, 'commenter')).toThrow(/your own/);
    expect(() => checkCommentOps(data, resolveOps('t1', true, B), user, 'commenter')).not.toThrow();
    expect(() => checkCommentOps(data, resolveOps('t1', true, A), user, 'commenter')).toThrow(/yourself/);
    expect(() => checkCommentOps(data, [{ t: 't1', set: { anchor: { x: 1, y: 1 } } }], user, 'commenter')).toThrow(/author or an editor/);
    expect(() => checkCommentOps(data, [{ t: 't1', set: { anchor: { x: 1, y: 1 } } }], user, 'editor')).not.toThrow();
    expect(() => checkCommentOps(data, replyOps('t1', { id: 'r', author: B, text: 'x' }), user, 'viewer')).toThrow(/cannot comment/);
  });
});

describe('comments in files', () => {
  it('are saved with a personal document and do not enter undo', async () => {
    const doc = VDocument.create();
    doc.setComments(thread());
    expect(doc.dirty).toBe(true);
    expect(doc.undoStack).toHaveLength(0);
    const bytes = await serializeDocument(doc, { compress: false });
    const { doc: back } = await parseDocument(bytes);
    expect(visibleThreads(back.comments)).toHaveLength(1);
    expect(back.dirty).toBe(false);
    doc.markSaved();
    expect(doc.dirty).toBe(false);
  });
});

describe('shared comments', () => {
  it('sync live and merge concurrent replies', async () => {
    const net = network();
    const { room, client: a } = await shareNew(net);
    const { token } = await net.service.call(alice, { op: 'invite', room, role: 'commenter' });
    const b = await joinClient(net, bob, room, { invite: token });
    a.session.comment(createThreadOps({ id: 'th', messageId: 'm0', author: A, text: 'Look @bob', anchor: { x: 1, y: 2 } }));
    await settle(a, b);
    expect(visibleThreads(b.doc.comments)).toHaveLength(1);
    a.session.comment(replyOps('th', { id: 'ra', author: A, text: 'from a' }));
    b.session.comment(replyOps('th', { id: 'rb', author: B, text: 'from b' }));
    await settle(a, b);
    expect(messagesOf(a.doc.comments.threads.th).map((m) => m.text).sort()).toEqual(['Look @bob', 'from a', 'from b']);
    expect(a.doc.comments).toEqual(b.doc.comments);
    // Comments never enter undo.
    expect(a.doc.undoStack).toHaveLength(0);
  });

  it('the server refuses forged authorship and the client rolls it back', async () => {
    const net = network();
    const { room, client: a } = await shareNew(net);
    const { token } = await net.service.call(alice, { op: 'invite', room, role: 'commenter' });
    const b = await joinClient(net, bob, room, { invite: token });
    a.session.comment(createThreadOps({ id: 'th', messageId: 'm0', author: A, text: 'Mine', anchor: { x: 1, y: 2 } }));
    await settle(a, b);
    const rejected = [];
    b.session.on('rejected', (e) => rejected.push(e));
    b.session.comment(editMessageOps('th', 'm0', 'Forged'));
    expect(b.doc.comments.threads.th.messages.m0.text).toBe('Forged');
    await settle(a, b);
    expect(rejected).toHaveLength(1);
    expect(b.doc.comments.threads.th.messages.m0.text).toBe('Mine');
    expect(a.doc.comments.threads.th.messages.m0.text).toBe('Mine');
  });

  it('viewers cannot comment', async () => {
    const net = network();
    const { room } = await shareNew(net);
    const { token } = await net.service.call(alice, { op: 'invite', room, role: 'viewer' });
    const c = await joinClient(net, cam, room, { invite: token });
    expect(() => c.session.comment(replyOps('x', { id: 'y', author: { id: cam.uuid, name: 'cam' }, text: 'hi' }))).toThrow(/cannot comment/);
  });
});
