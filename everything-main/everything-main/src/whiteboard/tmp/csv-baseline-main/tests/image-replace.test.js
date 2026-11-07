import test from "node:test";
import assert from "node:assert/strict";
import { board, item, validateBoard } from "../src/model.js";
import { replacementContent, imageFromURL } from "../src/image-replace.js";
import { imageLayout, validCrop } from "../src/image-crop.js";
import { SharedDocument, rebase } from "../src/collaboration/document.js";
const asset = (n) => `asset:${String(n).repeat(64)}`;
const picture = (extra = {}) =>
  item("image", 100, 80, {
    w: 200,
    h: 100,
    src: "data:image/png;base64,AA==",
    ...extra,
  });

test("replacement fills the existing container without distortion and preserves its geometry, mask, identity and links", () => {
  const target = picture({
    rotation: 30,
    groupId: "g",
    text: "Custom label",
    objectLink: { url: "https://example.com/" },
    crop: { x: 0, y: 0, w: 1, h: 1, mask: "ellipse", sourceAspect: 2 },
  });
  const source = picture({ src: "data:image/png;base64,AQ==" });
  const before = structuredClone(target);
  const change = replacementContent(target, source, 100, 300);
  assert.equal(change.crop.w, 1);
  assert.equal(change.crop.h, 1 / 6);
  assert.equal(change.crop.y, 5 / 12);
  assert.equal(change.crop.mask, "ellipse");
  assert.ok(validCrop(change.crop));
  Object.assign(target, change);
  const layout = imageLayout(target, 100, 300);
  for (const key of ["x", "y", "w", "h"])
    assert.ok(Math.abs(layout.box[key] - target[key]) < 1e-8);
  for (const key of Object.keys(before).filter(
    (k) => !["src", "crop"].includes(k),
  ))
    assert.deepEqual(target[key], before[key]);
  validateBoard({ ...board(), items: [target] });
  assert.equal(source.crop, undefined);
});

test("replacement reuses a board image's visible crop, detects no-ops and rejects invalid decoded dimensions", () => {
  const target = picture({ w: 100, h: 100 }),
    source = picture({
      src: "data:image/png;base64,AQ==",
      crop: { x: 0.5, y: 0, w: 0.5, h: 1, mask: "ellipse" },
    });
  const result = replacementContent(target, source, 400, 200);
  assert.deepEqual(result.crop, {
    x: 0.5,
    y: 0,
    w: 0.5,
    h: 1,
    sourceAspect: 2,
  });
  Object.assign(target, result);
  assert.equal(replacementContent(target, source, 400, 200), null);
  for (const size of [0, NaN, Infinity, -1, 40_000_001])
    assert.throws(() => replacementContent(target, source, size, 1), /pixels/);
  assert.throws(
    () => replacementContent({ ...target, w: 0 }, source, 400, 200),
    /editable area/,
  );
  assert.throws(
    () =>
      replacementContent(
        { ...target, w: 0.001, h: 1e6 },
        source,
        40_000_000,
        1,
      ),
    /proportions/,
  );
  assert.ok(
    validCrop(
      replacementContent(
        { ...target, src: "data:image/png;base64,AA==", w: -100 },
        source,
        400,
        200,
      ).crop,
    ),
  );
});

test("URL replacement omits credentials and referrers, validates schemes and bounds unknown-length streams", async () => {
  let called = 0,
    captured;
  const load = async (files, point, options) => {
    assert.equal(files[0].size, 4);
    assert.equal(options.imagesOnly, true);
    assert.deepEqual(point, { x: 0, y: 0 });
    return [picture()];
  };
  const fetchImage = async (url, options) => {
    called++;
    captured = options;
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      headers: { "content-type": "image/png" },
    });
  };
  await imageFromURL("https://example.com/photo", { fetchImage, load });
  assert.equal(captured.credentials, "omit");
  assert.equal(captured.referrerPolicy, "no-referrer");
  assert.equal(captured.mode, "cors");
  for (const url of [
    "data:image/png;base64,AA==",
    "file:///tmp/image.png",
    "javascript:alert(1)",
    "https://user:password@example.com/image",
    "invalid",
  ])
    await assert.rejects(imageFromURL(url, { fetchImage, load }), /HTTP/);
  assert.equal(called, 1);
  await assert.rejects(
    imageFromURL("https://example.com/photo", {
      fetchImage: async () => {
        throw Error("CORS");
      },
      load,
    }),
    /Download it/,
  );
  let cancelled = false;
  const huge = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(5 * 1024 * 1024 + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    imageFromURL("https://example.com/photo", {
      fetchImage: async () => new Response(huge),
      load,
    }),
    /5 MB/,
  );
  assert.equal(cancelled, true);
});

test("shared image source and crop stay atomic through concurrent replacement/resize, legacy migration and undo", () => {
  const a = new SharedDocument(),
    b = new SharedDocument();
  try {
    const value = board();
    value.items = [picture({ src: asset(1) })];
    a.commit(value);
    b.apply(a.update());
    a.undo.clear();
    b.undo.clear();
    const left = a.snapshot(),
      right = b.snapshot();
    Object.assign(left.items[0], {
      src: asset(2),
      crop: { x: 0, y: 0.25, w: 1, h: 0.5, sourceAspect: 1 },
    });
    right.items[0].w = 400;
    a.commit(left);
    b.commit(right);
    a.apply(b.update());
    b.apply(a.update());
    assert.deepEqual(a.snapshot(), b.snapshot());
    const merged = a.snapshot().items[0];
    assert.deepEqual(
      merged,
      merged.src === asset(2) ? left.items[0] : right.items[0],
    );
    a.validate();
    b.validate();
    const entry = a.items.get(merged.id),
      geometry = { ...entry.get("geometry") };
    delete geometry.src;
    entry.set("src", merged.src);
    entry.set("geometry", geometry);
    assert.equal(a.snapshot().items[0].src, merged.src);
    a.validate();
    a.commit(a.snapshot());
    assert.equal(entry.get("geometry").src, merged.src);
    entry.set("src", "data:image/png;base64,AA==");
    assert.throws(() => a.validate(), /stored as files/);
    const removed = a.snapshot();
    removed.items[0].type = "rect";
    delete removed.items[0].src;
    delete removed.items[0].crop;
    a.commit(removed);
    assert.equal(a.snapshot().items[0].src, undefined);
    assert.equal(entry.has("src"), false);
    a.validate();
  } finally {
    a.destroy();
    b.destroy();
  }
});

test("rebase drops stale geometry against a replaced image while keeping unrelated edits; replacement undo retains remote text", () => {
  const value = board();
  value.items = [picture({ src: asset(1), text: "Label" })];
  const draft = structuredClone(value),
    remote = structuredClone(value);
  draft.items[0].x += 10;
  draft.items[0].text = "Local label";
  Object.assign(remote.items[0], {
    src: asset(2),
    crop: { x: 0, y: 0.25, w: 1, h: 0.5, sourceAspect: 1 },
  });
  const merged = rebase(draft, value, remote).items[0];
  assert.equal(merged.x, value.items[0].x);
  assert.equal(merged.src, asset(2));
  assert.deepEqual(merged.crop, remote.items[0].crop);
  assert.equal(merged.text, "Local label");
  const a = new SharedDocument(),
    b = new SharedDocument();
  try {
    a.commit(value);
    b.apply(a.update());
    a.undo.clear();
    a.commit(remote);
    b.apply(a.update());
    const label = b.snapshot();
    label.items[0].text = "Remote label";
    b.commit(label);
    a.apply(b.update());
    a.undo.undo();
    assert.equal(a.snapshot().items[0].src, asset(1));
    assert.equal(a.snapshot().items[0].crop, undefined);
    assert.equal(a.snapshot().items[0].text, "Remote label");
  } finally {
    a.destroy();
    b.destroy();
  }
});
