import test from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { item, board, validateBoard } from "../src/model.js";
import {
  COMMENT_LIMITS,
  commentThread,
  commentMessage,
  commentPoint,
  updateCommentAnchors,
  rebaseComments,
  validateCommentChanges,
  validateCommentLanguage,
  commentExcerpt,
} from "../src/comments.js";
import { SharedDocument, rebase } from "../src/collaboration/document.js";
import { environment, owner, editor } from "./collaboration-helpers.js";
import { encode, hash } from "../src/collaboration/protocol.js";
const alice = { id: owner.uuid, name: owner.username },
  bob = { id: editor.uuid, name: editor.username };

test("comment languages are bounded, language-only metadata and survive shared serialization", () => {
  const c = commentThread({ x: 0, y: 0 }, alice, "Hello bonjour");
  Object.assign(c.messages[0], {
    lang: "en",
    textRuns: [{ start: 6, end: 13, style: { lang: "fr" } }],
  });
  const b = { ...board(), comments: [c] };
  validateBoard(b);
  const a = new SharedDocument();
  a.commit(b);
  const peer = new SharedDocument(a.update());
  try {
    peer.validate();
    assert.deepEqual(peer.snapshot().comments, b.comments);
    const detached = peer.snapshot();
    detached.comments[0].messages[0].textRuns[0].style.lang = "es";
    assert.equal(
      peer.snapshot().comments[0].messages[0].textRuns[0].style.lang,
      "fr",
    );
    for (const patch of [
      { lang: 'fr"bad' },
      { lang: false },
      { lang: "x".repeat(65) },
      { textRuns: [{ start: 6, end: 99, style: { lang: "fr" } }] },
      { textRuns: [{ start: 6, end: 13, style: { bold: true } }] },
      { textRuns: [{ start: 6, end: 13, style: { lang: "bad_tag" } }] },
    ])
      assert.throws(() =>
        validateCommentLanguage({ ...c.messages[0], ...patch }),
      );
    const next = peer.snapshot();
    delete next.comments[0].messages[0].lang;
    delete next.comments[0].messages[0].textRuns;
    peer.commit(next);
    a.apply(peer.update());
    assert.equal(a.snapshot().comments[0].messages[0].lang, undefined);
    assert.equal(a.snapshot().comments[0].messages[0].textRuns, undefined);
  } finally {
    a.destroy();
    peer.destroy();
  }
});

test("simultaneous comment text and passage-language edits remain one valid revision", () => {
  for (const languageWins of [false, true]) {
    const seed = new SharedDocument();
    seed.commit({
      ...board(),
      comments: [commentThread({ x: 0, y: 0 }, alice, "Hello bonjour")],
    });
    const a = new SharedDocument(seed.update());
    const b = new SharedDocument(seed.update());
    a.doc.clientID = languageWins ? 2 : 1;
    b.doc.clientID = languageWins ? 1 : 2;
    try {
      const before = a.snapshot();
      const tagged = structuredClone(before);
      tagged.comments[0].messages[0].textRuns = [
        { start: 6, end: 13, style: { lang: "fr" } },
      ];
      const shortened = structuredClone(before);
      shortened.comments[0].messages[0].text = "Hi";
      a.commit(tagged);
      b.commit(shortened);
      a.apply(b.update());
      b.apply(a.update());
      assert.doesNotThrow(() => a.validate());
      assert.doesNotThrow(() => b.validate());
      assert.deepEqual(a.snapshot(), b.snapshot());
      const message = a.snapshot().comments[0].messages[0];
      assert.equal(message.text, languageWins ? "Hello bonjour" : "Hi");
      assert.deepEqual(
        message.textRuns || [],
        languageWins ? tagged.comments[0].messages[0].textRuns : [],
      );
      const queued = rebaseComments(
        tagged.comments,
        before.comments,
        shortened.comments,
      );
      validateCommentLanguage(queued[0].messages[0]);
    } finally {
      seed.destroy();
      a.destroy();
      b.destroy();
    }
  }
});

test("shared comment passage revisions reject unknown fields and invalid language ranges", () => {
  const initial = {
    ...board(),
    comments: [commentThread({ x: 0, y: 0 }, alice, "Hello bonjour")],
  };
  const seed = new SharedDocument();
  seed.commit(initial);
  try {
    for (const body of [
      { value: "Hello bonjour", textRuns: [], secret: "hidden data" },
      {
        value: "Hello bonjour",
        textRuns: [{ start: 0, end: 99, style: { lang: "fr" } }],
      },
      {
        value: "Hello bonjour",
        textRuns: [{ start: 0, end: 5, style: { lang: "invalid_tag" } }],
      },
      {
        value: "Hello bonjour",
        textRuns: [{ start: 0, end: 5, style: { bold: true } }],
      },
      { value: "Hello bonjour", textRuns: "fr" },
    ]) {
      const peer = new SharedDocument(seed.update());
      try {
        peer.comments
          .get(initial.comments[0].id)
          .get("messages")
          .get(initial.comments[0].messages[0].id)
          .set("text", body);
        assert.throws(() => peer.validate());
      } finally {
        peer.destroy();
      }
    }
  } finally {
    seed.destroy();
  }
});

test("comments validate bounded literal content, author metadata, positions and recoverable deletion", () => {
  const b = board(),
    c = commentThread(
      { x: -20, y: 40 },
      alice,
      "Literal <script> & café\nSecond line",
    );
  b.comments = [c];
  validateBoard(b);
  c.messages[0].deleted = true;
  validateBoard(b);
  for (const patch of [
    { x: Infinity },
    { dx: 1 },
    { resolved: 1 },
    { messages: [] },
    { unexpected: true },
  ])
    assert.throws(
      () => validateBoard({ ...b, comments: [{ ...c, ...patch }] }),
      /comment/i,
    );
  for (const patch of [
    { text: " " },
    { text: "x".repeat(4001) },
    { authorId: "" },
    { createdAt: Infinity },
    { createdAt: Number.MAX_SAFE_INTEGER },
    { deleted: "true" },
    { extra: "x" },
  ])
    assert.throws(
      () =>
        validateBoard({
          ...b,
          comments: [{ ...c, messages: [{ ...c.messages[0], ...patch }] }],
        }),
      /comment/i,
    );
  assert.throws(() => validateBoard({ ...b, comments: [c, c] }), /comment/i);
  assert.throws(
    () =>
      validateBoard({
        ...b,
        comments: [
          {
            ...c,
            messages: Array(COMMENT_LIMITS.replies + 1).fill(c.messages[0]),
          },
        ],
      }),
    /comment/i,
  );
  assert.equal(validateBoard(board()).comments, undefined);
});

test("object comments follow their anchor, stay at the last saved position without it, and follow it again when it returns, without modifying content", () => {
  const note = item("note", 20, 30),
    c = commentThread({ x: 80, y: 70 }, alice, "Review", note),
    before = structuredClone(c);
  note.x += 300;
  note.y -= 50;
  assert.deepEqual(commentPoint(c, new Map([[note.id, note]])), {
    x: 380,
    y: 20,
  });
  const updated = updateCommentAnchors([c], [note]);
  assert.equal(updated[0].x, 380);
  assert.equal(updated[0].anchorId, note.id);
  assert.deepEqual(c, before);
  const detached = updateCommentAnchors(updated, []);
  assert.equal(detached, updated);
  assert.equal(detached[0].anchorId, note.id);
  assert.equal(detached[0].x, 380);
  validateBoard({ ...board(), comments: detached });
  // Undoing the deletion brings the object back under the same ID.
  note.x += 100;
  const returned = updateCommentAnchors(detached, [note]);
  assert.equal(returned[0].x, 480);
  assert.equal(returned[0].y, 20);
});

test("concurrent replies and independent message edits survive CRDT updates, rebase and board undo", () => {
  const initial = {
    ...board(),
    items: [item("note", 0, 0)],
    comments: [commentThread({ x: 10, y: 20 }, alice, "Review this")],
  };
  const a = new SharedDocument();
  a.commit(initial);
  a.undo.clear();
  const b = new SharedDocument(a.update());
  try {
    const before = a.snapshot(),
      left = structuredClone(before),
      right = structuredClone(before);
    left.comments[0].messages.push(commentMessage(alice, "Alice reply"));
    right.comments[0].messages.push(commentMessage(bob, "Bob reply"));
    a.commit(left);
    b.commit(right);
    a.apply(b.update());
    b.apply(a.update());
    assert.equal(a.snapshot().comments[0].messages.length, 3);
    assert.deepEqual(a.snapshot(), b.snapshot());
    assert.equal(
      a.undo.undoStack.length,
      0,
      "Comment operations do not consume board undo",
    );
    const queued = structuredClone(before);
    queued.comments[0].messages[0].text = "Updated review";
    const merged = rebase(queued, before, a.snapshot());
    assert.equal(merged.comments[0].messages.length, 3);
    assert.equal(merged.comments[0].messages[0].text, "Updated review");
    merged.items[0].x = 50;
    a.commit(merged);
    a.undo.undo();
    assert.equal(a.snapshot().items[0].x, 0);
    assert.equal(a.snapshot().comments[0].messages.length, 3);
    const stale = rebaseComments([], [], a.snapshot().comments);
    stale[0].messages[0].text = "Independent";
    assert.notEqual(a.snapshot().comments[0].messages[0].text, "Independent");
    a.validate();
    b.validate();
  } finally {
    a.destroy();
    b.destroy();
  }
});

test("comment authorship is enforced by the real worker on replies, edits and tombstones", async () => {
  const env = environment(),
    initial = board();
  initial.comments = [commentThread({ x: 0, y: 0 }, alice, "Owner comment")];
  const seed = new SharedDocument();
  seed.commit(initial);
  await env.service.call(owner, {
    op: "create",
    room: initial.id,
    update: encode(seed.update()),
  });
  const invite = await env.service.call(owner, {
    op: "invite",
    room: initial.id,
    role: "editor",
  });
  await env.service.call(editor, {
    op: "join",
    room: initial.id,
    token: invite.token,
  });
  const commit = async (actor, document) => {
    const bytes = document.update();
    return env.service.call(actor, {
      op: "commit",
      room: initial.id,
      id: await hash(bytes),
      update: encode(bytes),
    });
  };
  const b = new SharedDocument(seed.update());
  const changed = b.snapshot();
  changed.comments[0].messages.push(commentMessage(bob, "My reply"));
  b.commit(changed);
  await commit(editor, b);
  for (const patch of [
    { text: "Forged edit" },
    { lang: "fr" },
    { textRuns: [{ start: 0, end: 5, style: { lang: "fr" } }] },
    { deleted: true },
    { authorId: editor.uuid },
    { authorName: "Impersonation" },
  ]) {
    const bad = new SharedDocument(b.update()),
      value = bad.snapshot();
    Object.assign(value.comments[0].messages[0], patch);
    bad.commit(value);
    await assert.rejects(commit(editor, bad), /author|account/i);
    bad.destroy();
  }
  const forged = new SharedDocument(b.update()),
    value = forged.snapshot();
  value.comments[0].messages.push(
    commentMessage(alice, "Pretending to be Alice"),
  );
  forged.commit(value);
  await assert.rejects(commit(editor, forged), /author|account/i);
  forged.destroy();
  const own = b.snapshot();
  own.comments[0].messages.find((m) => m.authorId === editor.uuid).deleted =
    true;
  b.commit(own);
  await commit(editor, b);
  assert.doesNotThrow(() =>
    validateCommentChanges(changed.comments, own.comments, editor),
  );
  for (const removeThread of [true, false]) {
    const bad = new SharedDocument(b.update());
    const id = initial.comments[0].id;
    if (removeThread) bad.comments.delete(id);
    else
      bad.comments
        .get(id)
        .get("messages")
        .delete(initial.comments[0].messages[0].id);
    await assert.rejects(commit(editor, bad), /removed|recoverable/);
    bad.destroy();
  }
  const ahead = structuredClone(own.comments),
    mine = ahead[0].messages.find((m) => m.authorId === editor.uuid);
  mine.editedAt = Date.now() + 2 * 86_400_000;
  assert.throws(
    () => validateCommentChanges(own.comments, ahead, editor),
    /time is not valid/,
  );
  mine.editedAt = Date.now();
  assert.doesNotThrow(() =>
    validateCommentChanges(own.comments, ahead, editor),
  );
  const removed = structuredClone(own.comments);
  removed[0].messages.shift();
  assert.throws(
    () => validateCommentChanges(own.comments, removed, editor),
    /recoverable/,
  );
  b.destroy();
  seed.destroy();
});

test("comments committed at once beyond the limits keep the board saveable, showing the oldest that fit", async () => {
  const env = environment(),
    initial = board();
  initial.comments = [commentThread({ x: 0, y: 0 }, alice, "First")];
  const seed = new SharedDocument();
  seed.commit(initial);
  const room = initial.id;
  await env.service.call(owner, {
    op: "create",
    room,
    update: encode(seed.update()),
  });
  const replies = async (count, from) => {
    const doc = new SharedDocument(seed.update()),
      value = doc.snapshot(),
      before = doc.vector();
    for (let i = 0; i < count; i++)
      value.comments[0].messages.push({
        ...commentMessage(alice, `Reply ${from + i}`),
        createdAt: from + i,
      });
    doc.commit(value);
    const update = doc.update(before);
    doc.destroy();
    return {
      op: "commit",
      room,
      id: await hash(update),
      update: encode(update),
    };
  };
  // Each commit stays within 100 messages; together they have 121.
  const opened = initial.comments[0].messages[0].createdAt;
  const batches = await Promise.all([
    replies(60, opened + 1),
    replies(60, opened + 1000),
  ]);
  await Promise.all(batches.map((input) => env.service.call(owner, input)));
  const { doc } = await env.service.load(room);
  try {
    const thread = doc.snapshot().comments[0];
    assert.equal(thread.messages.length, COMMENT_LIMITS.replies);
    assert.equal(thread.messages.at(-1).text, `Reply ${opened + 1000 + 38}`);
    doc.validate();
    // Everyone can keep saving, including new discussions.
    const next = doc.snapshot(),
      before = doc.vector();
    next.title = "Still saveable";
    next.comments.push(commentThread({ x: 5, y: 5 }, alice, "Another"));
    doc.commit(next);
    const update = doc.update(before);
    await env.service.call(owner, {
      op: "commit",
      room,
      id: await hash(update),
      update: encode(update),
    });
  } finally {
    doc.destroy();
    seed.destroy();
  }
  const { doc: saved } = await env.service.load(room);
  try {
    const value = saved.snapshot();
    assert.equal(value.title, "Still saveable");
    assert.equal(value.comments.length, 2);
    // A further reply to the full discussion is still refused.
    const before = saved.vector(),
      full = value.comments.find((t) => t.id === initial.comments[0].id);
    full.messages.push(commentMessage(alice, "One more"));
    saved.commit(value);
    const update = saved.update(before);
    await assert.rejects(
      env.service.call(owner, {
        op: "commit",
        room,
        id: await hash(update),
        update: encode(update),
      }),
      { status: 422 },
    );
  } finally {
    saved.destroy();
  }
  // Discussions beyond the limit keep the oldest ones.
  const many = Array.from({ length: COMMENT_LIMITS.threads + 1 }, (_, i) => ({
    ...commentThread({ x: i, y: 0 }, alice, `Thread ${i}`),
    messages: [{ ...commentMessage(alice, `Thread ${i}`), createdAt: i }],
  }));
  const shared = new SharedDocument();
  try {
    shared.commit({ ...board(), comments: many.slice(0, 250) });
    const other = new SharedDocument(shared.update());
    other.commit({ ...other.snapshot(), comments: many.slice(250) });
    shared.apply(other.update());
    other.destroy();
    const shown = shared.snapshot().comments;
    assert.equal(shown.length, COMMENT_LIMITS.threads);
    assert.ok(!shown.some((t) => t.id === many.at(-1).id));
    shared.validate();
  } finally {
    shared.destroy();
  }
});

test("malformed shared comment maps and hidden position properties are rejected", () => {
  const shared = new SharedDocument();
  shared.commit(board());
  const entry = new Y.Map();
  shared.comments.set("bad", entry);
  entry.set("position", { x: 0, y: 0, id: "forged" });
  entry.set("resolved", false);
  entry.set("messages", new Y.Map());
  assert.throws(() => shared.validate(), /shared comment/);
  shared.destroy();
});

test("shared anchors use restored geometry after undo, keep that location without their object, and follow it after its deletion is undone", () => {
  const initial = board(),
    note = item("note", 20, 30);
  initial.items = [note];
  initial.comments = [commentThread({ x: 80, y: 70 }, alice, "Anchored", note)];
  const shared = new SharedDocument();
  try {
    shared.commit(initial);
    shared.undo.clear();
    const moved = shared.snapshot();
    moved.items[0].x += 300;
    shared.commit(moved);
    assert.equal(shared.snapshot().comments[0].x, 380);
    shared.undo.undo();
    assert.equal(shared.snapshot().comments[0].x, 80);
    const removed = shared.snapshot();
    removed.items = [];
    shared.commit(removed);
    assert.equal(shared.snapshot().comments[0].x, 80);
    assert.equal(shared.snapshot().comments[0].anchorId, note.id);
    const restored = new SharedDocument(shared.update());
    assert.equal(restored.snapshot().comments[0].x, 80);
    restored.destroy();
    shared.undo.undo();
    const back = shared.snapshot();
    assert.equal(back.items[0].id, note.id);
    back.items[0].x += 50;
    shared.commit(back);
    assert.equal(shared.snapshot().comments[0].x, 130);
    shared.comments
      .get(initial.comments[0].id)
      .set("position", { x: 0, y: 0, anchorId: "absent", dx: Infinity, dy: 0 });
    assert.throws(() => shared.validate(), /comment/);
  } finally {
    shared.destroy();
  }
});

test("replies cannot be dated before their discussion began or far ahead, but offline replies stay welcome", async () => {
  const env = environment(),
    initial = board();
  initial.comments = [commentThread({ x: 0, y: 0 }, alice, "Question")];
  const opened = initial.comments[0].messages[0].createdAt;
  const seed = new SharedDocument();
  seed.commit(initial);
  const room = initial.id;
  await env.service.call(owner, {
    op: "create",
    room,
    update: encode(seed.update()),
  });
  const { token } = await env.service.call(owner, {
    op: "invite",
    room,
    role: "editor",
  });
  await env.service.call(editor, { op: "join", room, token });
  env.service.now = () => opened + 60_000;
  const reply = async (createdAt, text = "Reply") => {
    const { doc } = await env.service.load(room);
    try {
      const value = doc.snapshot(),
        before = doc.vector();
      value.comments[0].messages.push({
        ...commentMessage(bob, text),
        createdAt,
      });
      doc.commit(value);
      const update = doc.update(before);
      return env.service.call(editor, {
        op: "commit",
        room,
        id: await hash(update),
        update: encode(update),
      });
    } finally {
      doc.destroy();
    }
  };
  for (const createdAt of [0, opened - 1, opened + 2 * 86_400_000])
    await assert.rejects(reply(createdAt), { status: 422 }, String(createdAt));
  await reply(opened + 50_000, "Later");
  // Written offline before the reply above, sent afterwards.
  await reply(opened + 10_000, "Earlier, sent late");
  const { doc } = await env.service.load(room);
  try {
    assert.deepEqual(
      doc.snapshot().comments[0].messages.map((m) => m.text),
      ["Question", "Earlier, sent late", "Later"],
    );
  } finally {
    doc.destroy();
    seed.destroy();
  }
});

test("comment excerpts never end in half a character", () => {
  const text = "a".repeat(99) + "👍 done";
  assert.equal(commentExcerpt(text, 100), "a".repeat(99));
  assert.equal(commentExcerpt(text, 101), "a".repeat(99) + "👍");
  assert.ok(commentExcerpt("😀".repeat(200), 280).isWellFormed());
  assert.equal(commentExcerpt("Short", 280), "Short");
});

test("a reply reopens a discussion resolved at the same moment, but not one resolved after it", () => {
  const alice = { id: "alice", name: "Alice" },
    bob = { id: "bob", name: "Bob" };
  const initial = board("Review");
  initial.comments = [commentThread({ x: 0, y: 0 }, alice, "Is this final?")];
  const exchange = (a, b) => {
    for (let n = 0; n < 3; n++) {
      a.apply(b.update(a.vector()));
      b.apply(a.update(b.vector()));
    }
  };
  const resolve = (doc, resolved = true) => {
    const next = doc.snapshot();
    next.comments[0].resolved = resolved;
    doc.commit(next);
  };
  const reply = (doc, text) => {
    const next = doc.snapshot();
    next.comments[0].messages.push(
      commentMessage(bob, text, Date.now() + next.comments[0].messages.length),
    );
    next.comments[0].resolved = false;
    doc.commit(next);
  };
  for (let attempt = 0; attempt < 8; attempt++) {
    const seed = new SharedDocument();
    seed.commit(initial);
    const a = new SharedDocument(seed.update(), { merge: true }),
      b = new SharedDocument(seed.update(), { merge: true });
    seed.destroy();
    try {
      resolve(a);
      reply(b, "One more change");
      exchange(a, b);
      for (const doc of [a, b]) {
        const [thread] = doc.snapshot().comments;
        assert.equal(thread.resolved, false);
        assert.equal(thread.messages.length, 2);
      }
      // Resolved again by someone who has seen the reply, it stays so.
      resolve(a);
      exchange(a, b);
      for (const doc of [a, b])
        assert.equal(doc.snapshot().comments[0].resolved, true);
    } finally {
      a.destroy();
      b.destroy();
    }
  }
});
