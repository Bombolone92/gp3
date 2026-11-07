import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { JSDOM } from "jsdom";
import { validateBoard } from "../src/model.js";
import { validateTextRuns } from "../src/rich-text.js";
import { validateTextBlocks } from "../src/text-blocks.js";
import { TAG_COLORS } from "../src/tags.js";
import {
  convertMiroBoard,
  decodeEntities,
  htmlToRichText,
  htmlToText,
  miroColor,
  miroShape,
  miroFontSize,
  embedImage,
  formatIssue,
  reportTotals,
  ISSUE_TEXT,
  MIRO_COLORS,
} from "../src/migration/miro-convert.js";
import {
  createMiroClient,
  retryDelay,
  MiroError,
} from "../src/migration/miro-client.js";
import {
  mapRole,
  userKind,
  parseDomains,
  parseEmailMap,
  boardEntry,
  userDirectory,
  loadInventory,
  summarizeInventory,
  planPhases,
  createLog,
  parseLog,
  logEntry,
  ensureEntries,
  updateEntry,
  shouldSkip,
  runMigration,
  rollbackTargets,
  rollbackBoards,
  summarizeLog,
  csvCell,
  logToCSV,
  logToJSON,
  inventoryToCSV,
} from "../src/migration/miro-plan.js";
import { createMiroMigration } from "../src/migration/migration-ui.js";

// ---------------------------------------------------------------------------
// Fixtures shaped like documented Miro REST API v2 responses.

const BOARD_ID = "uXjVOD6LSME=";
const ALICE = "3458764517517819001";
const BOB = "3458764517517819002";
const GUEST = "3458764517517819003";
const CAROL = "3458764517517819004";

const png = (width, height) => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
};
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);

const miroBoard = (overrides = {}) => ({
  id: BOARD_ID,
  type: "board",
  name: "Sprint planning",
  description: "Quarterly planning",
  createdAt: "2024-01-10T12:00:00Z",
  modifiedAt: "2024-03-05T09:30:00Z",
  createdBy: { id: ALICE, type: "user", name: "Alice Tremblay" },
  modifiedBy: { id: BOB, type: "user", name: "Bob Singh" },
  owner: { id: ALICE, type: "user", name: "Alice Tremblay" },
  team: { id: "3458764517517811111", type: "team", name: "Digital Services" },
  currentUserMembership: { id: ALICE, name: "Alice", role: "owner" },
  policy: {
    permissionsPolicy: {
      collaborationToolsStartAccess: "all_editors",
      copyAccess: "team_members",
      sharingAccess: "team_members_with_editing_rights",
    },
    sharingPolicy: {
      access: "private",
      inviteToAccountAndBoardLinkAccess: "no_access",
      organizationAccess: "private",
      teamAccess: "edit",
    },
  },
  viewLink: `https://miro.com/app/board/${BOARD_ID}`,
  links: { self: `https://api.miro.com/v2/boards/${BOARD_ID}` },
  ...overrides,
});
const pos = (x, y, relativeTo = "canvas_center") => ({
  x,
  y,
  origin: "center",
  relativeTo,
});
const IMAGE_URL = (id) =>
  `https://api.miro.com/v2/boards/${BOARD_ID}/resources/images/${id}?format=preview&redirect=false`;

const ITEMS = [
  {
    id: "F1",
    type: "frame",
    data: {
      format: "custom",
      title: "Discovery &amp; research",
      type: "freeform",
      showContent: true,
    },
    style: { fillColor: "#ffffffff" },
    position: pos(0, 0),
    geometry: { width: 1000, height: 800 },
    createdAt: "2024-01-10T12:00:00Z",
    createdBy: { id: ALICE, type: "user" },
    links: { self: "https://api.miro.com/v2/boards/x/frames/F1" },
  },
  {
    id: "S1",
    type: "sticky_note",
    data: {
      content: "<p>Research <strong>users</strong></p>",
      shape: "square",
    },
    style: {
      fillColor: "light_yellow",
      textAlign: "center",
      textAlignVertical: "top",
    },
    position: pos(100, 150, "parent_top_left"),
    geometry: { width: 199, height: 228 },
    parent: { id: "F1" },
    tagIds: ["T1", "T2"],
  },
  {
    id: "S2",
    type: "sticky_note",
    data: {
      content:
        "<p>Next steps</p><ul><li>Interview</li><li>Synthesize</li></ul>",
      shape: "rectangle",
    },
    style: { fillColor: "blue", textAlign: "left" },
    position: pos(900, 500),
    geometry: { width: 350, height: 228 },
  },
  {
    id: "X1",
    type: "text",
    data: { content: "<p>Goals</p>" },
    style: {
      color: "#ff0000",
      fillColor: "transparent",
      fontFamily: "roboto_mono",
      fontSize: "36",
      textAlign: "left",
    },
    position: pos(700, -300),
    geometry: { width: 320, rotation: 15 },
  },
  {
    id: "SH1",
    type: "shape",
    data: { content: "<p>Decision?</p>", shape: "rhombus" },
    style: {
      borderColor: "#1a1a1a",
      borderOpacity: "1.0",
      borderStyle: "normal",
      borderWidth: "2.0",
      color: "#1a1a1a",
      fillColor: "#8fd14f",
      fillOpacity: "1.0",
      fontFamily: "arial",
      fontSize: "14",
      textAlign: "center",
      textAlignVertical: "middle",
    },
    position: pos(1400, 0),
    geometry: { width: 200, height: 120, rotation: 350 },
  },
  {
    id: "SH2",
    type: "shape",
    data: { content: "", shape: "circle" },
    style: { fillColor: "#fff", fillOpacity: "1.0" },
    position: pos(1400, 300),
    geometry: { width: 100, height: 100 },
  },
  {
    id: "SH3",
    type: "shape",
    data: { content: "<p>Stop</p>", shape: "octagon" },
    style: { fillColor: "red", fillOpacity: "0.0" },
    position: pos(1600, 300),
    geometry: { width: 100, height: 100 },
  },
  {
    id: "SH4",
    type: "shape",
    data: { content: "", shape: "left_brace" },
    style: {},
    position: pos(1800, 300),
    geometry: { width: 40, height: 200 },
  },
  {
    id: "SH5",
    type: "shape",
    data: { content: "<p>DB</p>", shape: "can" },
    style: { fillColor: "light_blue" },
    position: pos(100, 100, "parent_top_left"),
    geometry: { width: 80, height: 120 },
    parent: { id: "F1" },
  },
  {
    id: "IM1",
    type: "image",
    data: { imageUrl: IMAGE_URL("IM1"), title: "Architecture diagram" },
    position: pos(-900, 0),
    geometry: { width: 400, height: 300, rotation: 90 },
  },
  {
    id: "IM2",
    type: "image",
    data: { imageUrl: IMAGE_URL("IM2"), title: "Animated" },
    position: pos(-900, 500),
    geometry: { width: 200, height: 200 },
  },
  {
    id: "C1",
    type: "card",
    data: {
      title: "Ship feature",
      description: "<p>Details <em>here</em></p>",
      assigneeId: BOB,
      dueDate: "2024-04-01T00:00:00Z",
    },
    style: { cardTheme: "#2d9bf0" },
    position: pos(0, 900),
    geometry: { width: 320, height: 94 },
  },
  {
    id: "A1",
    type: "app_card",
    data: {
      title: "JIRA-12",
      description: "",
      fields: [
        { value: "High", tooltip: "Priority", fillColor: "#ff0000" },
        { value: "" },
      ],
      status: "disconnected",
    },
    style: { fillColor: "#fbe983" },
    position: pos(400, 900),
    geometry: { width: 320, height: 94 },
  },
  {
    id: "D1",
    type: "document",
    data: {
      documentUrl: `https://api.miro.com/v2/boards/${BOARD_ID}/resources/documents/D1?redirect=false`,
      title: "Spec.pdf",
    },
    position: pos(800, 900),
    geometry: { width: 200, height: 250 },
  },
  {
    id: "E1",
    type: "embed",
    data: {
      url: "https://www.youtube.com/watch?v=abc",
      providerName: "YouTube",
      mode: "inline",
      previewUrl: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
    },
    position: pos(1200, 900),
    geometry: { width: 320, height: 180 },
  },
  {
    id: "P1",
    type: "preview",
    data: { url: "https://www.canada.ca/en/services.html" },
    position: pos(1600, 900),
  },
  {
    id: "M1",
    type: "mindmap_node",
    data: { nodeView: { data: { content: "Root" } } },
    position: pos(2400, 0),
  },
];
const CONNECTORS = [
  {
    id: "K1",
    type: "connector",
    shape: "elbowed",
    startItem: { id: "S1", position: { x: "100%", y: "50%" }, snapTo: "right" },
    endItem: { id: "SH1", position: { x: "0%", y: "50%" }, snapTo: "left" },
    style: {
      color: "#1a1a1a",
      fontSize: "14",
      startStrokeCap: "none",
      endStrokeCap: "filled_triangle",
      strokeColor: "#1a1a1a",
      strokeStyle: "dashed",
      strokeWidth: "2.0",
      textOrientation: "horizontal",
    },
    captions: [
      { content: "<p>yes</p>", position: "50%", textAlignVertical: "middle" },
    ],
  },
  {
    id: "K2",
    type: "connector",
    shape: "straight",
    startItem: { id: "SH1" },
    endItem: { id: "F1" },
    style: {
      startStrokeCap: "oval",
      endStrokeCap: "erd_one",
      strokeWidth: "30",
    },
  },
  {
    id: "K3",
    type: "connector",
    shape: "curved",
    startItem: { id: "X1" },
    endItem: { id: "X1" },
    style: {},
  },
  {
    id: "K4",
    type: "connector",
    shape: "curved",
    startItem: { id: "S2" },
    endItem: { id: "M1" },
    style: { strokeStyle: "dotted" },
    captions: [{ content: "<p>one</p>" }, { content: "<p>two</p>" }],
  },
  {
    id: "K5",
    type: "connector",
    startItem: { id: "SH2" },
    endItem: { id: "SH5" },
    style: {},
  },
];
const TAGS = [
  { id: "T1", type: "tag", title: "Urgent", fillColor: "red" },
  { id: "T2", type: "tag", title: " urgent ", fillColor: "blue" },
  { id: "T3", type: "tag", title: "Research", fillColor: "cyan" },
  { id: "T4", type: "tag", title: "   ", fillColor: "gray" },
];
const content = () =>
  structuredClone({
    board: miroBoard(),
    items: ITEMS,
    connectors: CONNECTORS,
    tags: TAGS,
  });
const fetchImage = async (url) => {
  if (url.includes("IM1"))
    return { bytes: png(800, 600), contentType: "image/png" };
  if (url.includes("IM2")) return { bytes: GIF, contentType: "image/gif" };
  throw Error("download failed");
};
let counter = 0;
const makeId = () => `id-${++counter}`;
const find = (board, text) => board.items.find((i) => i.text === text);

// ---------------------------------------------------------------------------
// Conversion

test("converts every Miro item type into a valid board with a full report", async () => {
  const { board, report } = await convertMiroBoard(content(), {
    fetchImage,
    makeId,
    users: { [BOB]: { name: "Bob Singh", email: "bob@canada.ca" } },
  });
  assert.ok(board);
  validateBoard(board);
  assert.equal(board.title, "Sprint planning");
  assert.equal(board.updated, Date.parse("2024-03-05T09:30:00Z"));

  // Frame: center origin converts to top-left, title entities decoded.
  const frame = board.items.find((i) => i.type === "frame");
  assert.deepEqual(
    [frame.x, frame.y, frame.w, frame.h],
    [-500, -400, 1000, 800],
  );
  assert.equal(frame.text, "Discovery & research");
  assert.equal(frame.color, "#ffffff");
  assert.equal(frame.order, 0);

  // Frame child: relative to the parent's top-left corner.
  const s1 = find(board, "Research users");
  assert.equal(s1.type, "note");
  assert.equal(s1.x, -500 + 100 - 199 / 2);
  assert.equal(s1.y, -400 + 150 - 228 / 2);
  assert.equal(s1.parentId, frame.id);
  assert.equal(s1.color, MIRO_COLORS.light_yellow);
  assert.equal(s1.textAlign, "center");
  assert.deepEqual(s1.textRuns, [{ start: 9, end: 14, style: { bold: true } }]);
  assert.equal(s1.tagIds.length, 1, "duplicate tag names merge");
  assert.equal(board.tags.find((t) => t.id === s1.tagIds[0]).name, "Urgent");
  assert.equal(
    board.tags.find((t) => t.id === s1.tagIds[0]).color,
    TAG_COLORS[0],
  );
  const cylinder = board.items.find((i) => i.shape === "cylinder");
  assert.equal(cylinder.parentId, frame.id);
  assert.equal(cylinder.x, -500 + 100 - 40);

  // Lists become list blocks.
  const s2 = find(board, "Next steps\nInterview\nSynthesize");
  assert.equal(s2.color, MIRO_COLORS.blue);
  assert.deepEqual(s2.textBlocks, [
    { start: 11, list: "bullet", indent: 0 },
    { start: 21, list: "bullet", indent: 0 },
  ]);
  assert.equal(s2.parentId, undefined);

  // Text: rotation, font, size, color, auto height.
  const x1 = find(board, "Goals");
  assert.equal(x1.type, "text");
  assert.equal(x1.rotation, 15);
  assert.equal(x1.fontFamily, "roboto-mono");
  assert.equal(x1.fontSize, 36);
  assert.equal(x1.textColor, "#ff0000");
  assert.equal(x1.textAlign, "left");
  assert.equal(x1.autoHeight, true);
  assert.equal(x1.w, 320);

  // Shapes: exact, approximate, and unknown mappings.
  const diamond = find(board, "Decision?");
  assert.deepEqual([diamond.type, diamond.shape], ["rect", "diamond"]);
  assert.equal(diamond.rotation, -10);
  assert.equal(diamond.color, "#8fd14f");
  assert.equal(
    diamond.textColor,
    undefined,
    "Miro default text color is omitted",
  );
  assert.equal(board.items.filter((i) => i.type === "ellipse").length, 1);
  const octagon = find(board, "Stop");
  assert.equal(octagon.shape, "hexagon");
  assert.equal(octagon.color, "#ffffff", "transparent fill");
  // A clear shape covers nothing: it goes behind every other object.
  assert.equal(board.items[0], octagon);
  assert.ok(
    report.warnings.some(
      (w) => w.code === "fill-transparent" && w.id === "SH3",
    ),
  );
  assert.equal(
    report.warnings.filter((w) => w.code === "fill-transparent").length,
    1,
    "Opaque shapes keep their place",
  );
  assert.ok(
    report.warnings.some(
      (w) => w.code === "shape-approximated" && w.id === "SH3",
    ),
  );
  assert.ok(
    report.warnings.some((w) => w.code === "shape-unknown" && w.id === "SH4"),
  );

  // Images: embedded or placeholder with a warning.
  const image = board.items.find((i) => i.type === "image");
  assert.match(image.src, /^data:image\/png;base64,/);
  assert.equal(image.text, "Architecture diagram");
  assert.equal(image.rotation, 90);
  assert.deepEqual([image.w, image.h], [400, 300]);
  const placeholder = find(board, "Image not migrated: Animated");
  assert.equal(placeholder.type, "rect");
  assert.ok(
    report.warnings.some(
      (w) =>
        w.code === "image-failed" &&
        w.id === "IM2" &&
        /unsupported format/.test(w.message),
    ),
  );
  assert.deepEqual(report.images, { embedded: 1, failed: 1 });

  // Cards keep assignee and due date in text.
  const card = board.items.find((i) => i.text?.startsWith("Ship feature"));
  assert.equal(card.type, "note");
  assert.equal(
    card.text,
    "Ship feature\nDetails here\nAssignee: Bob Singh\nDue: 2024-04-01",
  );
  assert.deepEqual(card.textRuns, [
    { start: 0, end: 12, style: { bold: true } },
    { start: 21, end: 25, style: { italic: true } },
  ]);
  assert.match(card.color, /^#[\da-f]{6}$/);
  const app = board.items.find((i) => i.text?.startsWith("JIRA-12"));
  assert.equal(app.text, "JIRA-12\nPriority: High\nStatus: disconnected");

  // Documents, and embeds the board cannot embed, become link cards. A
  // document's Miro API address needs a token, so it links to the board.
  const doc = find(board, "Spec.pdf");
  assert.equal(doc.type, "link");
  assert.equal(doc.url, miroBoard().viewLink);
  assert.ok(report.warnings.some((w) => w.code === "document-link"));
  const embed = find(board, "YouTube");
  assert.deepEqual(
    [embed.type, embed.url],
    ["link", "https://www.youtube.com/watch?v=abc"],
  );
  const preview = board.items.find(
    (i) => i.url === "https://www.canada.ca/en/services.html",
  );
  assert.equal(preview.text, "www.canada.ca");
  assert.deepEqual(
    [preview.w, preview.h],
    [280, 115],
    "missing geometry uses defaults",
  );

  // Unsupported items are skipped with reasons.
  assert.deepEqual(report.skipped.map((s) => [s.id, s.code]).sort(), [
    ["K3", "connector-self"],
    ["M1", "unsupported-type"],
  ]);
  assert.equal(
    report.skipped.find((s) => s.id === "M1").message,
    "Unsupported Miro item type: mindmap_node.",
  );

  // Connectors.
  const arrows = board.items.filter((i) => i.type === "arrow");
  assert.equal(arrows.length, 4);
  const k1 = arrows.find((a) => a.text === "yes");
  assert.equal(k1.startId, s1.id);
  assert.equal(k1.endId, diamond.id);
  assert.equal(k1.lineType, "elbow");
  assert.equal(k1.lineStyle, "dashed");
  assert.equal(k1.lineWidth, 2);
  assert.equal(k1.startCap, "none");
  assert.equal(k1.endCap, "arrow");
  assert.equal(k1.color, "#1a1a1a");
  assert.equal(k1.fontSize, 14);
  const k2 = arrows.find((a) => a.startId === diamond.id && !a.endId);
  assert.equal(k2.lineType, undefined, "straight is the default");
  assert.equal(k2.startCap, "circle");
  assert.equal(k2.endCap, "arrow");
  assert.equal(k2.lineWidth, 12, "stroke width is clamped");
  assert.equal(
    k2.x + k2.w,
    0,
    "frame endpoint is left free at the frame center",
  );
  assert.ok(report.warnings.some((w) => w.code === "connector-frame-endpoint"));
  assert.ok(
    report.warnings.some(
      (w) => w.code === "cap-approximated" && w.params.cap === "erd_one",
    ),
  );
  const k4 = arrows.find((a) => a.text === "one\ntwo");
  assert.equal(k4.startId, s2.id);
  assert.equal(k4.endId, undefined);
  assert.equal(k4.lineStyle, "dotted");
  assert.equal(k4.x + k4.w, 2400, "missing endpoint uses the Miro item center");
  assert.ok(report.warnings.some((w) => w.code === "connector-captions"));
  assert.ok(
    report.warnings.some((w) => w.code === "connector-endpoint-missing"),
  );
  const k5 = arrows.find((a) => a.endId === cylinder.id);
  assert.equal(
    k5.lineType,
    "curved",
    "Miro's default connector shape is curved",
  );

  // Report counts.
  assert.equal(report.source.sticky_note, 2);
  assert.equal(report.source.connector, 5);
  assert.equal(report.source.tag, 4);
  assert.equal(
    report.converted.image,
    1,
    "placeholders are not counted as converted",
  );
  assert.equal(report.converted.connector, 4);
  assert.equal(report.converted.tag, 3);
  assert.equal(report.converted.shape, 5);
  assert.equal(report.output.arrow, 4);
  assert.equal(report.objectCount, board.items.length);
  assert.equal(board.tags.length, 2);
  assert.ok(report.warnings.some((w) => w.code === "tag-merged"));
  assert.ok(report.warnings.some((w) => w.code === "tag-invalid"));
  const totals = reportTotals(report);
  assert.equal(totals.source, ITEMS.length + CONNECTORS.length);
  assert.equal(totals.skipped, 2);
  assert.equal(totals.converted, board.items.length - 1);
});

test("HTML text keeps paragraphs, blank lines, breaks, lists, entities, and links", () => {
  const cases = [
    ["<p>One</p><p>Two</p>", "One\nTwo"],
    ["<p>One</p><p></p><p>Three</p>", "One\n\nThree"],
    ["<p>One<br>Two<br/>Three</p>", "One\nTwo\nThree"],
    [
      "<p>A &amp; B &lt;tag&gt; &#233;t&#xE9; &nbsp;x</p>",
      "A & B <tag> été  x",
    ],
    ["plain\ntext", "plain\ntext"],
    ["<p>  spaced   out  </p>", "spaced out"],
    ["<div>Block</div>after", "Block\nafter"],
    ["<p>Safe<script>alert(1)</script></p><!-- note -->", "Safe"],
    ["", ""],
    [null, ""],
  ];
  for (const [html, text] of cases) assert.equal(htmlToText(html), text, html);
  // Unclosed markup is kept as text, and a long run of it stays fast.
  assert.equal(htmlToText("a <!-- b"), "a <!-- b");
  assert.equal(htmlToText("<p>x</p><script>y"), "x\ny");
  for (const run of ["<!--", "<a ", "<script", "<style x"]) {
    const html = run.repeat(Math.round(100000 / run.length));
    const started = performance.now();
    assert.equal(htmlToText(html).length, html.trim().length);
    assert.ok(performance.now() - started < 500, run);
  }
  // Unclosed inline tags and closing tags that match nothing stay fast too.
  for (const html of [
    "<b>x".repeat(40000),
    "<b>".repeat(10000) + "<span>x".repeat(10000) + "</b>x".repeat(10000),
    "<p>x".repeat(20000) + "</div>".repeat(20000),
  ]) {
    const started = performance.now();
    const rich = htmlToRichText(html);
    assert.ok(performance.now() - started < 1000, html.slice(0, 20));
    validateTextRuns(rich.text, rich.runs);
  }
  assert.deepEqual(htmlToRichText("<b>x".repeat(40000)).runs, [
    { start: 0, end: 40000, style: { bold: true } },
  ]);

  const nested = htmlToRichText(
    '<ol><li>First</li><li>Second<ul><li>Child</li></ul></li></ol><p>Tail with <a href="https://example.com/x">link</a> and <a href="javascript:alert(1)">bad</a></p>',
  );
  assert.equal(nested.text, "First\nSecond\nChild\nTail with link and bad");
  assert.deepEqual(nested.blocks, [
    { start: 0, list: "number", indent: 0 },
    { start: 6, list: "number", indent: 0 },
    { start: 13, list: "bullet", indent: 1 },
  ]);
  assert.deepEqual(nested.runs, [
    { start: 29, end: 33, style: { link: "https://example.com/x" } },
  ]);
  validateTextRuns(nested.text, nested.runs);
  validateTextBlocks(nested.text, nested.blocks);
  // Text after a list is its own line, not part of the last item.
  const after = htmlToRichText("<ul><li>x</li><li>y</li></ul>after");
  assert.equal(after.text, "x\ny\nafter");
  assert.deepEqual(
    after.blocks.map((b) => b.start),
    [0, 2],
  );

  // Quill markup puts the list kind and indent on each item.
  const quill = htmlToRichText(
    '<ol><li data-list="bullet">a</li><li data-list="bullet" class="ql-indent-2">b</li><li data-list="ordered">c</li></ol>',
  );
  assert.deepEqual(
    quill.blocks.map((b) => [b.list, b.indent]),
    [
      ["bullet", 0],
      ["bullet", 2],
      ["number", 0],
    ],
  );
  const styled = htmlToRichText(
    '<p><span style="font-weight:700">B</span> <u>U</u> <s>S</s> <em><strong>BI</strong></em></p>',
  );
  assert.equal(styled.text, "B U S BI");
  validateTextRuns(styled.text, styled.runs);
  assert.deepEqual(styled.runs.at(-1), {
    start: 6,
    end: 8,
    style: { italic: true, bold: true },
  });
});

test("Miro named and hex colors map to #rrggbb", () => {
  for (const name of [
    "light_yellow",
    "yellow",
    "orange",
    "light_green",
    "green",
    "dark_green",
    "cyan",
    "light_pink",
    "pink",
    "violet",
    "red",
    "light_blue",
    "blue",
    "dark_blue",
    "gray",
    "black",
    "white",
  ])
    assert.match(miroColor(name), /^#[\da-f]{6}$/, name);
  assert.equal(miroColor("LIGHT-YELLOW"), MIRO_COLORS.light_yellow);
  assert.equal(miroColor("#ABC"), "#aabbcc");
  assert.equal(miroColor("#1A2B3C"), "#1a2b3c");
  assert.equal(miroColor("1a2b3c"), "#1a2b3c");
  assert.equal(miroColor("#ffffffff"), "#ffffff");
  assert.equal(miroColor("#12345600", "#eeeeee"), "#eeeeee");
  assert.equal(miroColor("rgb(255, 0, 16)"), "#ff0010");
  assert.equal(miroColor("transparent", "#ffffff"), "#ffffff");
  assert.equal(miroColor("not-a-color", null), null);
  assert.equal(miroColor(undefined, "#000000"), "#000000");
});

test("style names that match Object properties fall back to defaults", async () => {
  const at = { position: { x: 0, y: 0 } };
  for (const name of ["constructor", "__proto__", "toString"]) {
    assert.equal(miroColor(name, null), null, name);
    assert.deepEqual(miroShape(name), { type: "rect", unknown: true });
    assert.equal(mapRole(name), "viewer");
    const { board, report } = await convertMiroBoard({
      board: { id: "b", name: "B" },
      items: [
        { id: "1", type: "sticky_note", style: { fillColor: name }, ...at },
        {
          id: "2",
          type: "card",
          data: { title: "c" },
          style: { fillColor: name, cardTheme: name },
          ...at,
        },
        {
          id: "3",
          type: "shape",
          data: { shape: name },
          style: { fillColor: name, fillOpacity: "0.5" },
          ...at,
        },
        {
          id: "4",
          type: "text",
          data: { content: `<${name}>t</${name}>` },
          style: { fontFamily: name, color: name },
          ...at,
        },
        { id: "5", type: "frame", style: { fillColor: name }, ...at },
      ],
      connectors: [
        {
          id: "c",
          shape: name,
          startItem: { id: "1" },
          endItem: { id: "3" },
          style: {
            strokeStyle: name,
            startStrokeCap: name,
            endStrokeCap: name,
          },
        },
      ],
    });
    assert.equal(report.skipped.length, 0, name);
    assert.equal(board.items.length, 6, name);
    assert.equal(board.items.find((i) => i.type === "text").runs, undefined);
  }
});

test("shape names, font sizes, and image limits", () => {
  assert.deepEqual(miroShape("rectangle"), { type: "rect" });
  assert.deepEqual(miroShape("round_rectangle"), { type: "rect" });
  assert.deepEqual(miroShape("circle"), { type: "ellipse" });
  assert.deepEqual(miroShape("triangle"), { type: "rect", shape: "triangle" });
  assert.deepEqual(miroShape("flow_chart_terminator"), {
    type: "rect",
    shape: "terminator",
  });
  assert.deepEqual(miroShape("star"), { type: "rect", shape: "star" });
  assert.deepEqual(miroShape("parallelogram"), {
    type: "rect",
    shape: "parallelogram",
  });
  assert.deepEqual(miroShape("hexagon"), { type: "rect", shape: "hexagon" });
  assert.deepEqual(miroShape("trapezoid"), {
    type: "rect",
    shape: "parallelogram",
    approximate: true,
  });
  assert.deepEqual(miroShape("cross"), { type: "rect", unknown: true });
  // Flowchart shapes the app draws exactly are not approximated.
  for (const [miro, shape] of [
    ["flow_chart_document", "document"],
    ["flow_chart_multidocuments", "multi-document"],
    ["flow_chart_predefined_process", "predefined-process"],
    ["flow_chart_manual_input", "manual-input"],
    ["flow_chart_manual_operation", "manual-operation"],
    ["flow_chart_delay", "delay"],
    ["flow_chart_display", "display"],
    ["flow_chart_off_page_connector", "off-page"],
    ["flow_chart_or", "or"],
    ["flow_chart_summing_junction", "summing-junction"],
    ["flow_chart_internal_storage", "internal-storage"],
    ["flow_chart_merge", "merge"],
    ["cloud", "cloud"],
  ])
    assert.deepEqual(miroShape(miro), { type: "rect", shape }, miro);
  assert.equal(miroFontSize("4"), 8);
  assert.equal(miroFontSize("400"), 100);
  assert.equal(miroFontSize("14.6"), 15);
  assert.equal(miroFontSize("auto", 19), 19);

  assert.match(embedImage(png(10, 10)).src, /^data:image\/png;base64,/);
  assert.equal(embedImage({ bytes: png(10, 20).buffer }).height, 20);
  assert.throws(() => embedImage(GIF), /unsupported format/);
  assert.throws(() => embedImage(png(10000, 5000)), /40 million pixels/);
  const big = new Uint8Array(5 * 1024 * 1024 + 1);
  big.set(png(10, 10));
  assert.throws(() => embedImage(big), /larger than 5 MB/);
  assert.throws(() => embedImage(new Uint8Array()), /empty/);
});

test("shape fill opacity blends with white, and clear shapes go behind", async () => {
  const shape = (id, style, x) => ({
    id,
    type: "shape",
    data: { content: `<p>${id}</p>`, shape: "rectangle" },
    style,
    position: { x, y: 0, origin: "center", relativeTo: "canvas_center" },
    geometry: { width: 100, height: 100 },
  });
  const { board, report } = await convertMiroBoard(
    {
      board: { id: "b", name: "Fills" },
      items: [
        shape("half", { fillColor: "#000000", fillOpacity: "0.5" }, 0),
        shape("none", { fillColor: "transparent", fillOpacity: "1.0" }, 200),
        shape("full", { fillColor: "#ff0000" }, 400),
        shape("hex", { fillColor: "#ff000000" }, 600),
        shape("rgba", { fillColor: "rgba(255, 0, 0, 0)" }, 800),
        shape("odd", { fillColor: "not-a-color" }, 1000),
      ],
      connectors: [],
      tags: [],
    },
    { makeId },
  );
  const byText = (text) => find(board, text);
  assert.equal(byText("half").color, "#808080");
  assert.equal(byText("full").color, "#ff0000");
  assert.equal(byText("none").color, "#ffffff");
  assert.equal(byText("odd").color, "#ffffff");
  assert.deepEqual(
    board.items.map((i) => i.text),
    ["none", "hex", "rgba", "half", "full", "odd"],
  );
  assert.deepEqual(
    report.warnings.map((w) => [w.code, w.id]),
    [
      ["fill-transparent", "none"],
      ["fill-transparent", "hex"],
      ["fill-transparent", "rgba"],
    ],
  );
});

test("boards above 5,000 objects are reported, not truncated, and nothing is downloaded", async () => {
  const items = Array.from({ length: 5001 }, (_, n) => ({
    id: `s${n}`,
    type: n === 0 ? "image" : "sticky_note",
    data: n === 0 ? { imageUrl: IMAGE_URL("big") } : { content: `<p>${n}</p>` },
    position: pos(n * 10, 0),
    geometry: { width: 100, height: 100 },
  }));
  let downloads = 0;
  const { board, report } = await convertMiroBoard(
    { board: miroBoard(), items, connectors: [], tags: [] },
    { fetchImage: async () => downloads++ },
  );
  assert.equal(board, null);
  assert.equal(report.overLimit, true);
  assert.equal(report.objectCount, 5001);
  assert.equal(downloads, 0);
  assert.equal(report.errors[0].code, "over-limit");
  assert.match(report.errors[0].message, /5001 objects.*up to 5,000/);
  assert.equal(report.source.sticky_note, 5000);

  // Exactly 5,000 objects is allowed.
  const ok = await convertMiroBoard({
    board: miroBoard(),
    items: items.slice(1),
  });
  assert.equal(ok.board.items.length, 5000);
  validateBoard(ok.board);
});

test("text, tag, coordinate, and title limits are enforced with warnings", async () => {
  const long = "x".repeat(19999) + "\u{1F600}" + "y".repeat(10);
  const tags = Array.from({ length: 10 }, (_, n) => ({
    id: `t${n}`,
    title: `Tag ${n}`,
    fillColor: "violet",
  }));
  const { board, report } = await convertMiroBoard({
    board: miroBoard({ name: "N".repeat(250) }),
    items: [
      {
        id: "long",
        type: "sticky_note",
        data: { content: long },
        position: pos(0, 0),
        tagIds: tags.map((t) => t.id).concat("missing"),
      },
      {
        id: "far",
        type: "text",
        data: { content: "far" },
        position: pos(2e6, 0),
      },
      {
        id: "tagged-shape",
        type: "shape",
        data: { shape: "rectangle" },
        position: pos(0, 500),
        tagIds: ["t1"],
      },
      {
        id: "tiny",
        type: "text",
        data: { content: "t" },
        style: { fontSize: "2" },
        position: pos(0, 800),
      },
    ],
    tags,
  });
  validateBoard(board);
  assert.equal(board.title.length, 200);
  const note = board.items.find((i) => i.type === "note");
  assert.equal(note.text.length, 19999, "a surrogate pair is never split");
  assert.equal(note.tagIds.length, 8);
  assert.ok(report.warnings.some((w) => w.code === "text-truncated"));
  assert.ok(report.warnings.some((w) => w.code === "tags-truncated"));
  assert.ok(report.warnings.some((w) => w.code === "tag-unknown"));
  assert.ok(
    report.warnings.some(
      (w) => w.code === "tags-dropped" && w.id === "tagged-shape",
    ),
  );
  assert.deepEqual(
    report.skipped.map((s) => [s.id, s.code]),
    [["far", "out-of-range"]],
  );
  assert.equal(board.items.find((i) => i.text === "t").fontSize, 8);
  assert.equal(board.tags[0].color, TAG_COLORS[8]);

  const untitled = await convertMiroBoard({ board: { name: "  " }, items: [] });
  assert.equal(untitled.board.title, "Untitled board");
  const french = await convertMiroBoard(
    { board: {}, items: [] },
    { labels: { untitled: "Tableau sans titre" } },
  );
  assert.equal(french.board.title, "Tableau sans titre");
});

test("documents download as attachments when a file fetcher is provided", async () => {
  const doc = ITEMS.find((i) => i.id === "D1");
  const big = {
    ...structuredClone(doc),
    id: "D2",
    data: {
      documentUrl: doc.data.documentUrl.replace("D1", "D2"),
      title: "Big.pdf",
    },
  };
  const { board, report } = await convertMiroBoard(
    { board: miroBoard(), items: [doc, big] },
    {
      fetchFile: async (url) =>
        url.includes("/D1")
          ? new Uint8Array([37, 80, 68, 70])
          : Promise.reject(Error("larger than 10 MB")),
    },
  );
  validateBoard(board);
  const file = board.items.find((i) => i.type === "file");
  assert.equal(file.fileName, "Spec.pdf");
  assert.equal(file.data, "data:application/octet-stream;base64,JVBERg==");
  const fallback = board.items.find((i) => i.type === "link");
  assert.equal(fallback.text, "Big.pdf");
  // Miro's API address needs a token; the link opens the Miro board.
  assert.equal(fallback.url, miroBoard().viewLink);
  assert.ok(
    report.warnings.some(
      (w) => w.code === "document-failed" && /10 MB/.test(w.message),
    ),
  );
});

test("every report issue has a French translation", async () => {
  const dom = new JSDOM("<body></body>");
  globalThis.document = dom.window.document;
  const { setLanguage, t } = await import("../src/i18n.js");
  try {
    setLanguage("fr");
    for (const template of Object.values(ISSUE_TEXT))
      assert.notEqual(t(template), template, template);
    assert.equal(
      formatIssue({ code: "unsupported-type", params: { type: "kanban" } }, t),
      "Type d’élément Miro non pris en charge : kanban.",
    );
    // Reasons the migration gives are translated; titles are not.
    assert.match(
      formatIssue(
        {
          code: "image-failed",
          params: { title: "Logo", reason: "unsupported format" },
        },
        t,
      ),
      /Logo.*\(format non pris en charge\)/,
    );
  } finally {
    setLanguage("en");
    dom.window.close();
    delete globalThis.document;
  }
});

test("migration sources contain no em dashes", () => {
  const dash = String.fromCharCode(0x2014);
  const files = [
    ...readdirSync("src/migration").map((f) => `src/migration/${f}`),
    "tests/miro-migration.test.js",
  ];
  for (const file of files)
    assert.ok(!readFileSync(file, "utf8").includes(dash), file);
});

// ---------------------------------------------------------------------------
// Client

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (init.signal?.aborted) throw init.signal.reason;
    const u = new URL(url);
    for (const [pattern, handler] of routes) {
      if (typeof pattern === "string") {
        if (url.startsWith(pattern)) return handler(u, init);
        continue;
      }
      const match = u.host === "api.miro.com" && u.pathname.match(pattern);
      if (match) return handler(u, init, match);
    }
    return json({ status: 404, code: "notFound", message: "Not found" }, 404);
  };
  return { fetch, calls };
}
const offsetPage = (all, u, size) => {
  const offset = Number(u.searchParams.get("offset") || 0),
    limit = Number(u.searchParams.get("limit"));
  const data = all.slice(offset, offset + Math.min(limit, size ?? limit));
  return json({
    data,
    total: all.length,
    size: data.length,
    offset,
    limit,
    type: "list",
  });
};
const cursorPage = (all, u, size = 2, useLinks = false) => {
  const start = Number(u.searchParams.get("cursor") || 0);
  const data = all.slice(start, start + size);
  const next = start + size < all.length ? String(start + size) : undefined;
  return json({
    data,
    total: all.length,
    size: data.length,
    limit: Number(u.searchParams.get("limit")),
    ...(useLinks ? {} : { cursor: next }),
    links: {
      self: u.href,
      ...(next
        ? { next: `${u.origin}${u.pathname}?limit=50&cursor=${next}` }
        : {}),
    },
    type: "cursor-list",
  });
};

test("client pages offset and cursor lists and sends the token only to Miro", async () => {
  const boards = Array.from({ length: 7 }, (_, n) =>
    miroBoard({ id: `b${n}`, name: `Board ${n}` }),
  );
  const { fetch, calls } = fakeFetch([
    [/^\/v2\/boards$/, (u) => offsetPage(boards, u, 3)],
    [/^\/v2\/boards\/[^/]+\/items$/, (u) => cursorPage(ITEMS, u, 5)],
    [
      /^\/v2\/boards\/[^/]+\/connectors$/,
      (u) => cursorPage(CONNECTORS, u, 2, true),
    ],
    [/^\/v2\/boards\/[^/]+\/tags$/, (u) => offsetPage(TAGS, u, 3)],
  ]);
  const client = createMiroClient({ fetch, token: "secret-token" });
  const listed = await client.listBoards();
  assert.deepEqual(
    listed.map((b) => b.id),
    boards.map((b) => b.id),
  );
  assert.equal(calls.length, 3);
  assert.equal(new URL(calls[1].url).searchParams.get("offset"), "3");
  assert.equal(new URL(calls[0].url).searchParams.get("sort"), "last_created");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret-token");

  const items = await client.listItems(BOARD_ID);
  assert.equal(items.length, ITEMS.length);
  assert.match(
    calls.at(-1).url,
    new RegExp(
      `/v2/boards/${encodeURIComponent(BOARD_ID)}/items\\?limit=50&cursor=15`,
    ),
  );
  assert.equal(
    (await client.listConnectors(BOARD_ID)).length,
    CONNECTORS.length,
    "links.next cursors",
  );
  assert.equal((await client.listTags(BOARD_ID)).length, TAGS.length);
  assert.equal(await client.countItems(BOARD_ID), ITEMS.length);
  // Miro rejects page sizes below 10.
  assert.equal(new URL(calls.at(-1).url).searchParams.get("limit"), "10");
});

test("client stops on repeated cursors and empty pages", async () => {
  let n = 0;
  const { fetch } = fakeFetch([
    [
      /items$/,
      () => json({ data: [{ id: `i${n++}` }], cursor: "same", total: 99 }),
    ],
  ]);
  const client = createMiroClient({ fetch, token: "t" });
  assert.equal((await client.listItems("b")).length, 2);
});

test("client retries 429 with Retry-After and transient 5xx, then reports errors", async () => {
  let attempts = 0;
  const delays = [];
  const retries = [];
  const { fetch } = fakeFetch([
    [
      /^\/v2\/boards\/b1$/,
      () =>
        ++attempts === 1
          ? json({ status: 429 }, 429, { "retry-after": "2" })
          : attempts === 2
            ? json({}, 503)
            : json(miroBoard()),
    ],
    [/^\/v2\/boards\/b2$/, () => json({}, 502)],
    [/^\/v2\/boards\/b3$/, () => json({ code: "tokenInvalid" }, 401)],
  ]);
  const client = createMiroClient({
    fetch,
    token: "t",
    retryBase: 100,
    maxRetries: 3,
    sleep: async (ms) => delays.push(ms),
    onRetry: (r) => retries.push(r.status),
  });
  assert.equal((await client.getBoard("b1")).name, "Sprint planning");
  assert.deepEqual(delays, [2000, 200]);
  assert.deepEqual(retries, [429, 503]);
  delays.length = 0;
  await assert.rejects(client.getBoard("b2"), (e) => {
    assert.ok(e instanceof MiroError);
    assert.equal(e.status, 502);
    assert.equal(e.message, "Miro returned an error (502).");
    return true;
  });
  assert.deepEqual(delays, [100, 200, 400]);
  await assert.rejects(
    client.getBoard("b3"),
    (e) =>
      e.status === 401 &&
      e.code === "tokenInvalid" &&
      /token was rejected/.test(e.message),
  );
  assert.equal(retryDelay("3"), 3000);
  assert.equal(
    retryDelay(
      "Wed, 21 Oct 2015 07:28:10 GMT",
      Date.parse("Wed, 21 Oct 2015 07:28:00 GMT"),
    ),
    10000,
  );
  assert.equal(retryDelay("soon"), null);
  // A date already past falls back to the usual backoff.
  assert.equal(
    retryDelay(
      "Wed, 21 Oct 2015 07:28:10 GMT",
      Date.parse("Wed, 21 Oct 2015 07:30:00 GMT"),
    ),
    null,
  );
});

test("client network failures retry and abort signals stop waiting", async () => {
  let calls = 0;
  const flaky = async () => {
    if (++calls < 3) throw TypeError("fetch failed");
    return json(miroBoard());
  };
  const client = createMiroClient({
    fetch: flaky,
    token: "t",
    sleep: async () => {},
  });
  assert.equal((await client.getBoard("x")).id, BOARD_ID);

  const controller = new AbortController();
  const slow = createMiroClient({
    fetch: async () => json({}, 429, { "retry-after": "60" }),
    token: "t",
  });
  const pending = slow.getBoard("x", { signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, (e) => e.name === "AbortError");
  assert.throws(() => createMiroClient({ fetch, token: "" }), /access token/);

  // Without Retry-After, a 429 waits until Miro's credits reset.
  const waits = [];
  let limited = true;
  const reset = createMiroClient({
    fetch: async () => {
      if (!limited) return json(miroBoard());
      limited = false;
      return json({}, 429, {
        "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 45),
      });
    },
    token: "t",
    sleep: async (ms) => waits.push(ms),
  });
  assert.equal((await reset.getBoard("x")).id, BOARD_ID);
  assert.ok(waits[0] > 40_000 && waits[0] <= 45_000, String(waits[0]));
  // A reset time already past, as with a clock running ahead, still waits.
  limited = true;
  const skewed = createMiroClient({
    fetch: async () => {
      if (!limited) return json(miroBoard());
      limited = false;
      return json({}, 429, {
        "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) - 90),
      });
    },
    token: "t",
    sleep: async (ms) => waits.push(ms),
  });
  assert.equal((await skewed.getBoard("x")).id, BOARD_ID);
  assert.ok(waits[1] > 0, String(waits[1]));
});

test("organization endpoints degrade on 403 and 404", async () => {
  const { fetch } = fakeFetch([
    [/\/v2\/orgs\/o1\/members$/, () => json({ code: "forbidden" }, 403)],
    [
      /\/v2\/orgs\/o1\/teams$/,
      (u) => cursorPage([{ id: "t1", name: "Team" }], u, 100),
    ],
  ]);
  const client = createMiroClient({ fetch, token: "t" });
  assert.deepEqual(await client.listOrgMembers("o1"), {
    available: false,
    status: 403,
    data: [],
  });
  assert.deepEqual(await client.listOrgTeams("o1"), {
    available: true,
    data: [{ id: "t1", name: "Team" }],
  });
  assert.equal((await client.listOrgTeams("missing")).available, false);
});

test("an original image the app cannot use falls back to Miro's preview", async () => {
  const bytes = png(10, 10);
  const { fetch, calls } = fakeFetch([
    [
      /\/resources\/images\/IM1$/,
      (u) =>
        json({
          type: "image",
          url: `https://files.example.net/${u.searchParams.get("format")}.png`,
        }),
    ],
    [
      "https://files.example.net/original",
      () => new Response(GIF, { headers: { "content-type": "image/gif" } }),
    ],
    [
      "https://files.example.net/preview",
      () => new Response(bytes, { headers: { "content-type": "image/png" } }),
    ],
  ]);
  const client = createMiroClient({ fetch, token: "secret" });
  const { board, report } = await convertMiroBoard(
    {
      board: { id: BOARD_ID, name: "Logos" },
      items: [
        {
          id: "IM1",
          type: "image",
          data: { imageUrl: IMAGE_URL("IM1"), title: "logo.gif" },
          position: { x: 0, y: 0, origin: "center" },
          geometry: { width: 100, height: 100 },
        },
      ],
    },
    { fetchImage: (url, options) => client.downloadImage(url, options) },
  );
  assert.equal(board.items[0].type, "image");
  assert.match(board.items[0].src, /^data:image\/png;base64,/);
  assert.deepEqual(report.images, { embedded: 1, failed: 0 });
  assert.ok(
    calls.some((c) => c.url === "https://files.example.net/preview.png"),
  );
  // A preview that cannot be used either leaves a placeholder saying why.
  const broken = createMiroClient({
    fetch: fakeFetch([
      [
        /\/resources\/images\/IM1$/,
        () => json({ type: "image", url: "https://files.example.net/g.gif" }),
      ],
      [
        "https://files.example.net/g.gif",
        () => new Response(GIF, { headers: { "content-type": "image/gif" } }),
      ],
    ]).fetch,
    token: "secret",
  });
  await assert.rejects(
    broken.downloadImage(IMAGE_URL("IM1"), { accept: embedImage }),
    /unsupported format/,
  );
});

test("resource downloads follow Miro's JSON indirection without the token", async () => {
  const bytes = png(10, 10);
  const { fetch, calls } = fakeFetch([
    [
      /\/resources\/images\/IM1$/,
      (u) =>
        json({
          type: "image",
          url: `https://files.example.net/${u.searchParams.get("format")}.png?sig=1`,
        }),
    ],
    [
      "https://files.example.net/original",
      () =>
        new Response(new Uint8Array(6 * 1024 * 1024), {
          headers: { "content-type": "image/png" },
        }),
    ],
    [
      "https://files.example.net/preview",
      () => new Response(bytes, { headers: { "content-type": "image/png" } }),
    ],
  ]);
  const client = createMiroClient({ fetch, token: "secret" });
  const result = await client.downloadImage(IMAGE_URL("IM1"));
  assert.deepEqual([...result.bytes], [...bytes]);
  assert.equal(result.contentType, "image/png");
  const miroCalls = calls.filter((c) =>
    c.url.startsWith("https://api.miro.com"),
  );
  const fileCalls = calls.filter((c) =>
    c.url.startsWith("https://files.example.net"),
  );
  assert.ok(
    miroCalls.every((c) => c.init.headers.Authorization === "Bearer secret"),
  );
  assert.ok(fileCalls.every((c) => !c.init.headers.Authorization));
  assert.match(miroCalls[0].url, /format=original/);
  assert.match(miroCalls[1].url, /format=preview/);
  await assert.rejects(client.downloadResource("ftp://x/y"), /unsupported/);
  // The token is never sent to Miro's host over plain HTTP.
  const plain = fakeFetch([
    [
      "http://api.miro.com/",
      () => new Response(bytes, { headers: { "content-type": "image/png" } }),
    ],
  ]);
  await createMiroClient({
    fetch: plain.fetch,
    token: "secret",
  }).downloadResource("http://api.miro.com/v2/boards/b/resources/images/1");
  assert.equal(plain.calls.length, 1);
  assert.equal(plain.calls[0].init.headers.Authorization, undefined);
  // A document that is itself a JSON file is downloaded, not followed.
  const file = JSON.stringify({ url: "https://elsewhere.example/x" });
  const docs = fakeFetch([
    [
      /\/resources\/documents\/D1$/,
      () => json({ type: "document", url: "https://files.example.net/d1" }),
    ],
    ["https://files.example.net/d1", () => json(JSON.parse(file))],
  ]);
  const saved = await createMiroClient({
    fetch: docs.fetch,
    token: "secret",
  }).downloadResource(
    "https://api.miro.com/v2/boards/b/resources/documents/D1",
  );
  assert.equal(new TextDecoder().decode(saved.bytes), file);
  assert.ok(docs.calls.every((c) => !c.url.startsWith("https://elsewhere")));
});

// ---------------------------------------------------------------------------
// Planning

const DOMAINS = ["canada.ca", "gc.ca"];
const MEMBERS = [
  { id: ALICE, name: "Alice Tremblay", role: "owner", type: "board_member" },
  { id: BOB, name: "Bob Singh", role: "coowner", type: "board_member" },
  { id: GUEST, name: "Gina Vendor", role: "editor", type: "board_member" },
  { id: CAROL, name: "Carol", role: "commenter", type: "board_member" },
  {
    id: "3458764517517819005",
    name: "Dan",
    role: "viewer",
    type: "board_member",
  },
];
const ORG_MEMBERS = [
  {
    id: ALICE,
    email: "Alice.Tremblay@canada.ca",
    role: "organization_internal_admin",
    license: "full",
    active: true,
  },
  {
    id: BOB,
    email: "bob@tbs-sct.gc.ca",
    role: "organization_internal_user",
    license: "full",
    active: true,
  },
  {
    id: GUEST,
    email: "gina@vendor.com",
    role: "organization_external_user",
    license: "free",
    active: true,
  },
  {
    id: CAROL,
    email: "carol@canada.ca",
    role: "organization_team_guest_user",
    license: "free_restricted",
    active: true,
  },
];

test("roles, guests, domains, and email mappings", () => {
  assert.equal(mapRole("owner"), "owner");
  assert.equal(mapRole("coowner"), "facilitator");
  assert.equal(mapRole("editor"), "editor");
  assert.equal(mapRole("commenter"), "commenter");
  assert.equal(mapRole("viewer"), "viewer");
  assert.equal(mapRole("something_new"), "viewer");
  assert.deepEqual(
    parseDomains(" Canada.ca, @gc.ca; *.example.org  bad  gc.ca"),
    ["canada.ca", "gc.ca", "example.org"],
  );
  assert.equal(userKind({ email: "a@canada.ca" }, DOMAINS), "internal");
  assert.equal(userKind({ email: "a@tbs-sct.gc.ca" }, DOMAINS), "internal");
  assert.equal(userKind({ email: "a@notcanada.ca" }, DOMAINS), "guest");
  assert.equal(userKind({ email: "a@vendor.com" }, DOMAINS), "guest");
  assert.equal(
    userKind(
      { email: "a@canada.ca", orgRole: "organization_team_guest_user" },
      DOMAINS,
    ),
    "guest",
  );
  assert.equal(userKind({ email: null }, DOMAINS), "unknown");
  assert.equal(userKind({ email: "a@canada.ca" }, []), "unknown");
  const mapping = parseEmailMap(
    "miro_user_id,email\n123, A@Canada.ca\n456;b@gc.ca\n\n# comment\nbroken line\n789\tc@x.org",
  );
  assert.deepEqual(mapping.map, {
    123: "a@canada.ca",
    456: "b@gc.ca",
    789: "c@x.org",
  });
  assert.deepEqual(mapping.invalid, [6]);
});

test("inventory rows keep the owner, map member roles, and flag guests", () => {
  const directory = userDirectory({
    orgMembers: ORG_MEMBERS,
    emailMap: { "3458764517517819005": "dan@canada.ca" },
  });
  const entry = boardEntry(
    miroBoard(),
    [...MEMBERS, { id: BOB, role: "owner" }],
    { directory, domains: DOMAINS, itemCount: 42 },
  );
  assert.equal(entry.ownerEmail, "alice.tremblay@canada.ca");
  assert.equal(entry.teamName, "Digital Services");
  assert.equal(entry.itemCount, 42);
  assert.equal(entry.sharing.teamAccess, "edit");
  assert.deepEqual(
    entry.members.map((m) => [m.name, m.role, m.kind]),
    [
      ["Alice Tremblay", "owner", "internal"],
      ["Bob Singh", "facilitator", "internal"],
      ["Gina Vendor", "editor", "guest"],
      ["Carol", "commenter", "guest"],
      ["Dan", "viewer", "internal"],
    ],
  );
  assert.equal(entry.members.filter((m) => m.role === "owner").length, 1);
  assert.equal(entry.guests, 2);
  assert.equal(entry.unresolved, 0);
  const bare = boardEntry(
    miroBoard({ owner: { id: "x", name: "X" }, team: null }),
    [],
    { domains: DOMAINS },
  );
  assert.equal(bare.ownerEmail, null);
  assert.equal(bare.unresolved, 1);
  assert.equal(bare.members[0].kind, "unknown");
});

function fakeClient({
  boards,
  failing = new Set(),
  members = MEMBERS,
  org = true,
} = {}) {
  const created = [];
  return {
    created,
    listBoards: async ({ onPage }) => {
      onPage?.({ loaded: boards.length, total: boards.length });
      return boards;
    },
    listOrgMembers: async () =>
      org
        ? { available: true, data: ORG_MEMBERS }
        : { available: false, data: [] },
    listOrgTeams: async () => ({
      available: org,
      data: org ? [{ id: "t2", name: "Policy Lab" }] : [],
    }),
    listMembers: async (id) => {
      if (failing.has(id))
        throw new MiroError("The Miro resource was not found.", {
          status: 404,
        });
      return members;
    },
    countItems: async () => ITEMS.length,
    fetchBoardContent: async (id) => {
      if (failing.has(id))
        throw new MiroError("Miro returned an error (500).", { status: 500 });
      return { ...content(), board: boards.find((b) => b.id === id) };
    },
    downloadImage: (url) => fetchImage(url),
    downloadResource: async () => {
      throw Error("not needed");
    },
  };
}
const boardsFixture = () => [
  miroBoard({ id: "b1", name: "Alpha" }),
  miroBoard({ id: "b2", name: "Bravo", team: { id: "t2" } }),
  miroBoard({
    id: "b3",
    name: "Charlie",
    owner: { id: BOB, name: "Bob Singh" },
  }),
  miroBoard({ id: "b4", name: "Delta", team: null }),
  miroBoard({ id: "b5", name: "Echo" }),
];

test("inventory loads every board and records per-board failures", async () => {
  const progress = [];
  const inventory = await loadInventory(
    fakeClient({ boards: boardsFixture(), failing: new Set(["b4"]) }),
    {
      orgId: "o1",
      domains: DOMAINS,
      onProgress: (p) => progress.push(p.stage),
      now: () => Date.parse("2026-09-26T12:00:00Z"),
    },
  );
  assert.equal(inventory.boards.length, 5);
  assert.equal(inventory.loadedAt, "2026-09-26T12:00:00.000Z");
  assert.deepEqual(inventory.org, { members: true, teams: true });
  assert.equal(
    inventory.boards[1].teamName,
    "Policy Lab",
    "team names come from the org directory",
  );
  assert.equal(inventory.boards[2].ownerEmail, "bob@tbs-sct.gc.ca");
  assert.equal(inventory.boards[3].error, "The Miro resource was not found.");
  // A count that fails keeps the board's members.
  const client = fakeClient({ boards: boardsFixture() });
  client.countItems = async () => {
    throw Error("Miro returned an error (400).");
  };
  const uncounted = await loadInventory(client, {
    orgId: "o1",
    domains: DOMAINS,
  });
  assert.ok(uncounted.boards.every((b) => !b.error && b.members.length > 1));
  assert.ok(uncounted.boards.every((b) => b.itemCount === null));
  assert.equal(
    inventory.boards[3].members.length,
    1,
    "the owner is still known",
  );
  assert.ok(
    progress.includes("boards") &&
      progress.includes("organization") &&
      progress.includes("members"),
  );
  const summary = summarizeInventory(inventory);
  assert.deepEqual(summary, {
    boards: 5,
    teams: 2,
    owners: 2,
    users: 5,
    guests: 2,
    unresolved: 1,
    items: ITEMS.length * 4,
    errors: 1,
  });
  const csv = inventoryToCSV(inventory);
  assert.match(
    csv,
    /alice\.tremblay@canada\.ca:owner \| bob@tbs-sct\.gc\.ca:facilitator \| gina@vendor\.com:editor:guest/,
  );
});

test("phases split boards by team, owner, or count", () => {
  const boards = boardsFixture().map((b) =>
    boardEntry(b, [], {
      directory: userDirectory({ orgMembers: ORG_MEMBERS }),
    }),
  );
  const byTeam = planPhases(boards, { by: "team", size: 2 });
  assert.deepEqual(
    byTeam.map((p) => [p.label, p.part, p.parts, p.boardIds]),
    [
      ["Digital Services", 1, 2, ["b1", "b3"]],
      ["Digital Services", 2, 2, ["b5"]],
      ["", 1, 1, ["b2"]],
      ["", 1, 1, ["b4"]],
    ],
  );
  assert.deepEqual(
    byTeam.map((p) => p.id),
    ["phase-1", "phase-2", "phase-3", "phase-4"],
  );
  const byOwner = planPhases(boards, { by: "owner" });
  assert.deepEqual(
    byOwner.map((p) => [p.label, p.boardIds]),
    [
      ["alice.tremblay@canada.ca", ["b1", "b2", "b4", "b5"]],
      ["bob@tbs-sct.gc.ca", ["b3"]],
    ],
  );
  const byCount = planPhases(boards, { by: "count", size: 3 });
  assert.deepEqual(
    byCount.map((p) => p.boardIds),
    [
      ["b1", "b2", "b3"],
      ["b4", "b5"],
    ],
  );
  assert.equal(
    planPhases(boards, { by: "count", size: "nonsense" })[0].boardIds.length,
    5,
  );
});

async function inventoryFor(client) {
  return loadInventory(client, { orgId: "o1", domains: DOMAINS });
}

test("runs a phase, logs each board, skips migrated boards, and rolls back", async () => {
  const client = fakeClient({
    boards: boardsFixture(),
    failing: new Set(["b4"]),
  });
  const inventory = await inventoryFor(client);
  const log = createLog(() => 0);
  const saved = [];
  const created = [];
  let n = 0;
  const createBoard = async (board, options) => {
    validateBoard(board);
    created.push({ board, options });
    return { id: `wb-${++n}` };
  };
  const phases = planPhases(inventory.boards, { by: "count", size: 10 });
  const first = await runMigration({
    client,
    boards: inventory.boards,
    log,
    createBoard,
    saveLog: async (text) => saved.push(JSON.parse(text)),
    phaseOf: () => phases[0].id,
    fallbackOwnerEmail: "migration@canada.ca",
    now: () => Date.parse("2026-09-26T12:00:00Z"),
  });
  assert.deepEqual(
    first.results.map((r) => r.status),
    ["migrated", "migrated", "migrated", "failed", "migrated"],
  );
  assert.equal(saved.length, 5, "the log is saved after every board");
  assert.equal(created[0].options.ownerEmail, "alice.tremblay@canada.ca");
  assert.equal(created[2].options.ownerEmail, "bob@tbs-sct.gc.ca");
  assert.equal(created[0].options.source.provider, "miro");
  assert.equal(created[0].options.source.boardId, "b1");
  assert.equal(created[0].options.asTemplate, false);
  assert.deepEqual(
    created[0].options.members.map((m) => [m.email, m.role, m.guest]),
    [
      ["alice.tremblay@canada.ca", "owner", false],
      ["bob@tbs-sct.gc.ca", "facilitator", false],
      ["gina@vendor.com", "editor", true],
      ["carol@canada.ca", "commenter", true],
      [null, "viewer", false],
    ],
  );
  const failed = logEntry(log, "b4");
  assert.equal(failed.status, "failed");
  // Its members could not be read, so it is not migrated without them.
  assert.match(failed.error, /members could not be read/);
  assert.equal(failed.attempts, 1);
  const done = logEntry(log, "b1");
  assert.equal(done.status, "migrated");
  assert.equal(done.createdBoardId, "wb-1");
  assert.equal(done.phase, "phase-1");
  assert.equal(done.counts.source, ITEMS.length + CONNECTORS.length);
  assert.ok(done.warnings.length > 0);
  assert.equal(done.finishedAt, "2026-09-26T12:00:00.000Z");
  assert.deepEqual(summarizeLog(log), {
    pending: 0,
    migrated: 4,
    failed: 1,
    "rolled-back": 0,
  });
  assert.ok(
    log.events.some((e) => e.action === "failed" && e.miroBoardId === "b4"),
  );

  // Idempotent re-run: migrated boards are skipped and the failure is retried.
  const retry = await runMigration({
    client,
    boards: inventory.boards,
    log,
    createBoard,
  });
  assert.deepEqual(
    retry.results.map((r) => r.status),
    ["skipped", "skipped", "skipped", "failed", "skipped"],
  );
  assert.equal(logEntry(log, "b4").attempts, 2);
  assert.equal(shouldSkip(log, "b1"), true);
  assert.equal(shouldSkip(log, "b1", { force: true }), false);

  // Forced re-migration keeps the earlier copy for rollback.
  const forced = await runMigration({
    client,
    boards: [inventory.boards[0]],
    log,
    createBoard,
    force: true,
    asTemplate: true,
  });
  assert.equal(forced.results[0].status, "migrated");
  assert.equal(created.at(-1).options.asTemplate, true);
  assert.deepEqual(logEntry(log, "b1").previousBoardIds, ["wb-1"]);
  assert.deepEqual(rollbackTargets(log, { boardIds: ["b1", "b2", "b4"] }), [
    "wb-5",
    "wb-1",
    "wb-2",
  ]);
  assert.deepEqual(rollbackTargets(log, { phase: "phase-1" }).sort(), [
    "wb-1",
    "wb-2",
    "wb-3",
    "wb-4",
    "wb-5",
  ]);
  assert.deepEqual(rollbackTargets(log, { phase: "phase-9" }), []);
  // A forced re-migration that fails keeps the copies it would replace.
  const broken = await runMigration({
    client,
    boards: [inventory.boards[0]],
    log,
    createBoard: async () => {
      throw Error("The worker is unavailable.");
    },
    force: true,
  });
  assert.equal(broken.results[0].status, "failed");
  assert.equal(logEntry(log, "b1").status, "migrated");
  assert.equal(logEntry(log, "b1").error, "The worker is unavailable.");
  assert.deepEqual(rollbackTargets(log, { boardIds: ["b1"] }), [
    "wb-5",
    "wb-1",
  ]);

  const deleted = [];
  const rolled = await rollbackBoards({
    log,
    boardIds: ["b1", "b2", "b3"],
    deleteBoard: async (id) => {
      if (id === "wb-3") throw Error("permission denied");
      deleted.push(id);
    },
  });
  assert.deepEqual(deleted, ["wb-5", "wb-1", "wb-2"]);
  assert.deepEqual(
    rolled.results.map((r) => r.status),
    ["rolled-back", "rolled-back", "failed"],
  );
  assert.equal(logEntry(log, "b1").status, "rolled-back");
  assert.equal(
    logEntry(log, "b3").status,
    "migrated",
    "failed rollbacks can be retried",
  );
  assert.match(logEntry(log, "b3").error, /permission denied/);
  assert.deepEqual(rollbackTargets(log), ["wb-3", "wb-4"]);

  // Rolled-back boards migrate again on the next run.
  const again = await runMigration({
    client,
    boards: [inventory.boards[0]],
    log,
    createBoard,
  });
  assert.equal(again.results[0].status, "migrated");
  assert.deepEqual(logEntry(log, "b1").previousBoardIds, []);
});

test("dry runs leave the log untouched and oversized boards fail with a reason", async () => {
  const client = fakeClient({ boards: boardsFixture() });
  const inventory = await inventoryFor(client);
  const log = createLog();
  let creates = 0;
  const dry = await runMigration({
    client,
    boards: inventory.boards.slice(0, 2),
    log,
    dryRun: true,
    createBoard: async () => creates++,
  });
  assert.deepEqual(
    dry.results.map((r) => r.status),
    ["dry-run", "dry-run"],
  );
  assert.equal(creates, 0);
  assert.equal(log.entries.length, 0);
  assert.ok(dry.results[0].report.converted.sticky_note);

  const huge = {
    ...client,
    fetchBoardContent: async () => ({
      board: miroBoard(),
      items: Array.from({ length: 5001 }, (_, n) => ({
        id: `n${n}`,
        type: "sticky_note",
        position: pos(0, 0),
      })),
    }),
  };
  const result = await runMigration({
    client: huge,
    boards: [inventory.boards[0]],
    log,
    createBoard: async () => ({ id: "x" }),
  });
  assert.equal(result.results[0].status, "failed");
  assert.match(logEntry(log, "b1").error, /5001 objects/);
  assert.equal(logEntry(log, "b1").counts.skipped, 0);
});

test("a failed log save stops the run and cancellation stops between boards", async () => {
  const client = fakeClient({ boards: boardsFixture() });
  const inventory = await inventoryFor(client);
  const log = createLog();
  let creates = 0;
  const stopped = await runMigration({
    client,
    boards: inventory.boards,
    log,
    createBoard: async () => ({ id: `wb-${++creates}` }),
    saveLog: async () => {
      throw Error("disk full");
    },
    sleep: async () => {},
  });
  assert.equal(creates, 1);
  assert.match(stopped.fatal, /could not be saved/);
  assert.equal(
    logEntry(log, "b1").createdBoardId,
    "wb-1",
    "the created board is still recorded in memory",
  );

  const controller = new AbortController();
  const cancelled = await runMigration({
    client,
    boards: inventory.boards.slice(1),
    log,
    signal: controller.signal,
    createBoard: async () => {
      controller.abort();
      return { id: `wb-${++creates}` };
    },
  });
  assert.equal(cancelled.cancelled, true);
  assert.deepEqual(
    cancelled.results.map((r) => r.status),
    ["migrated"],
  );
  assert.equal(
    logEntry(log, "b2").status,
    "migrated",
    "a board created during cancellation is kept for rollback",
  );
});

test("logs export as CSV with escaping and as JSON, and parse back", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell('say "hi", ok'), '"say ""hi"", ok"');
  assert.equal(csvCell("two\nlines"), '"two\nlines"');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell("-2"), "'-2");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(3), "3");

  const log = createLog(() => 0);
  ensureEntries(log, [
    {
      id: "b1",
      name: 'Plan, "Q1"\nDraft',
      ownerEmail: "a@canada.ca",
      teamName: "=Team",
      members: [{}, {}],
      guests: 1,
    },
  ]);
  const csv = logToCSV(log);
  assert.equal(
    csv.charCodeAt(0),
    0xfeff,
    "UTF-8 byte order mark for spreadsheets",
  );
  const lines = csv.slice(1).split("\r\n");
  assert.match(
    lines[0],
    /^miro_board_id,board_name,phase,status,created_board_id,owner_email/,
  );
  assert.ok(
    lines[1].startsWith(
      'b1,"Plan, ""Q1""\nDraft",,pending,,a@canada.ca,\'=Team,2,1,',
    ),
  );
  const parsed = parseLog(logToJSON(log));
  assert.deepEqual(parsed.entries, log.entries);
  assert.deepEqual(parseLog(log).entries, log.entries);
  assert.throws(() => parseLog("{not json"), /could not be read/);
  assert.throws(() => parseLog({ kind: "other" }), /could not be read/);
  assert.equal(
    parseLog({
      ...log,
      entries: [
        ...log.entries,
        { miroBoardId: 1, status: "migrated" },
        { miroBoardId: "x", status: "weird" },
      ],
    }).entries.length,
    1,
  );
});

// ---------------------------------------------------------------------------
// Dialog

function miroAPI() {
  const boards = [
    miroBoard({ id: "b1", name: "Alpha" }),
    miroBoard({
      id: "b2",
      name: "Bravo",
      team: { id: "t9", name: "Policy Lab" },
    }),
    miroBoard({
      id: "b3",
      name: "Charlie <script>",
      owner: { id: GUEST, name: "Gina" },
    }),
  ];
  let throttled = false;
  return fakeFetch([
    [
      /^\/v2\/boards$/,
      (u) => {
        if (!throttled) {
          throttled = true;
          return json({}, 429, { "retry-after": "1" });
        }
        return offsetPage(boards, u, 2);
      },
    ],
    [/^\/v2\/orgs\/o1\/members$/, (u) => cursorPage(ORG_MEMBERS, u, 100)],
    [/^\/v2\/orgs\/o1\/teams$/, () => json({ code: "forbidden" }, 403)],
    [
      /^\/v2\/boards\/([^/]+)$/,
      (u, init, m) =>
        json(boards.find((b) => encodeURIComponent(b.id) === m[1])),
    ],
    [/^\/v2\/boards\/[^/]+\/members$/, (u) => offsetPage(MEMBERS, u)],
    [
      /^\/v2\/boards\/[^/]+\/items$/,
      (u) => cursorPage(ITEMS.slice(0, 6), u, 50),
    ],
    [
      /^\/v2\/boards\/[^/]+\/connectors$/,
      (u) => cursorPage(CONNECTORS.slice(0, 1), u, 50),
    ],
    [/^\/v2\/boards\/[^/]+\/tags$/, (u) => offsetPage(TAGS, u)],
  ]);
}
function dialogHarness(overrides = {}) {
  const dom = new JSDOM("<body><button id='opener'>Open</button></body>");
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const doc = dom.window.document;
  const api = miroAPI();
  const state = {
    created: [],
    deleted: [],
    saved: [],
    downloads: [],
    toasts: [],
  };
  let n = 0;
  const deps = {
    modal(title, html, ready) {
      const d = doc.createElement("dialog");
      d.setAttribute("aria-label", title);
      d.innerHTML = `<div class="dialog-header"><h2>${title}</h2></div>${html}`;
      d.close = () => d.remove();
      doc.body.append(d);
      ready(d);
      return d;
    },
    toast: (m) => state.toasts.push(m),
    fetch: api.fetch,
    sleep: async () => {},
    createBoard: async (board, options) => {
      validateBoard(board);
      state.created.push({ board, options });
      return { id: `wb-${++n}` };
    },
    deleteBoard: async (id) => state.deleted.push(id),
    saveLog: async (text) => state.saved.push(text),
    loadLog: async () => null,
    download: (name, text, type) => state.downloads.push({ name, text, type }),
    now: () => Date.parse("2026-09-26T12:00:00Z"),
    ...overrides,
  };
  const until = async (check, label) => {
    for (let i = 0; i < 400; i++) {
      if (check()) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw Error(`Timed out waiting for ${label}`);
  };
  return {
    dom,
    doc,
    deps,
    state,
    calls: api.calls,
    until,
    $: (s) => doc.querySelector(s),
    set(selector, value) {
      const el = doc.querySelector(selector);
      if (el.type === "checkbox") el.checked = value;
      else el.value = value;
      el.dispatchEvent(
        new dom.window.Event(
          el.tagName === "SELECT" || el.type === "checkbox"
            ? "change"
            : "input",
        ),
      );
    },
    submit() {
      doc
        .querySelector("#miro-connect")
        .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    },
    close() {
      dom.window.close();
      if (previous === undefined) delete globalThis.document;
      else globalThis.document = previous;
    },
  };
}

test("dialog flow: load inventory, dry run, migrate, report, and roll back", async () => {
  const h = dialogHarness();
  try {
    createMiroMigration(h.deps).open();
    const dialog = h.$("dialog");
    assert.equal(dialog.getAttribute("aria-label"), "Migrate from Miro");
    // Labelled fields and live regions.
    for (const id of [
      "miro-token",
      "miro-org",
      "miro-domains",
      "miro-email-map",
      "miro-fallback-owner",
    ])
      assert.equal(h.$(`#${id}`).closest("label")?.tagName, "LABEL", id);
    assert.equal(h.$("#miro-token").type, "password");
    assert.equal(h.$("#miro-token").getAttribute("autocomplete"), "off");
    assert.equal(h.$("#miro-status").getAttribute("role"), "status");
    assert.equal(h.$("#miro-error").getAttribute("role"), "alert");
    assert.equal(h.doc.activeElement, h.$("#miro-token"));
    assert.equal(h.$("#miro-inventory").hidden, true);

    h.submit();
    assert.equal(h.$("#miro-error").textContent, "Enter a Miro access token.");
    h.set("#miro-token", "  token-123 ");
    h.set("#miro-org", "o1");
    h.set("#miro-domains", "canada.ca, gc.ca");
    h.set("#miro-email-map", "3458764517517819005,dan@canada.ca");
    h.submit();
    await h.until(() => !h.$("#miro-inventory").hidden, "inventory");
    assert.ok(
      h.calls.every(
        (c) =>
          !c.url.startsWith("https://api.miro.com") ||
          c.init.headers.Authorization === "Bearer token-123",
      ),
    );
    assert.match(
      h.$("#miro-summary").textContent,
      /^3 boards, 5 people \(2 guests, 0 without email\)/,
    );
    assert.equal(h.doc.activeElement, h.$("#miro-inventory-heading"));
    const rows = [...h.doc.querySelectorAll("[data-board]")];
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.checked));
    assert.match(h.$("#miro-board-list").innerHTML, /Charlie &lt;script&gt;/);
    assert.equal(h.$("#miro-selection").textContent, "3 of 3 boards selected");
    assert.match(
      h.$("#miro-board-list").textContent,
      /alice\.tremblay@canada\.ca · Digital Services · 6 items · 2 guests · Not migrated/,
    );

    // Phases by team and filtering.
    assert.deepEqual(
      [...h.$("#miro-phase").options].map((o) => o.textContent),
      [
        "All boards (3)",
        "Phase 1: Digital Services (2)",
        "Phase 2: Policy Lab (1)",
      ],
    );
    h.set("#miro-phase", "phase-1");
    assert.equal(h.$("#miro-selection").textContent, "2 of 2 boards selected");
    h.set("#miro-filter", "charlie");
    assert.equal(h.doc.querySelectorAll("[data-board]").length, 1);
    h.set("#miro-filter", "");
    h.set("[data-board='b3']", false);
    assert.equal(h.$("#miro-selection").textContent, "1 of 2 boards selected");

    // Dry run converts without saving.
    h.$("#miro-dry-run").click();
    await h.until(
      () => /Dry run complete/.test(h.$("#miro-status").textContent),
      "dry run",
    );
    assert.equal(
      h.$("#miro-status").textContent,
      "Dry run complete: 1 ready, 0 with errors.",
    );
    assert.equal(h.state.created.length, 0);
    assert.equal(h.state.saved.length, 0);
    assert.equal(h.doc.querySelectorAll("#miro-results > li").length, 1);
    assert.match(
      h.$("#miro-results").textContent,
      /Ready to migrate · 7 of 7 objects converted/,
    );
    assert.match(h.$("#miro-results table").textContent, /Sticky notes22/);

    // Migrate the selected phase boards.
    h.$("[data-board='b3']").click();
    h.$("#miro-template").click();
    h.$("#miro-run").click();
    await h.until(
      () => /Migration complete/.test(h.$("#miro-status").textContent),
      "migration",
    );
    assert.equal(
      h.$("#miro-status").textContent,
      "Migration complete: 2 migrated, 0 failed, 0 already migrated.",
    );
    assert.equal(h.state.toasts.length, 1);
    assert.equal(h.state.created.length, 2);
    assert.equal(
      h.state.created[0].options.ownerEmail,
      "alice.tremblay@canada.ca",
    );
    assert.equal(h.state.created[0].options.asTemplate, true);
    assert.equal(h.state.created[1].options.ownerEmail, "gina@vendor.com");
    assert.equal(
      h.state.created[0].options.members.find((m) => m.miroRole === "coowner")
        .role,
      "facilitator",
    );
    assert.equal(h.state.saved.length, 2);
    const saved = parseLog(h.state.saved.at(-1));
    assert.deepEqual(
      saved.entries.map((e) => [e.miroBoardId, e.status, e.createdBoardId]),
      [
        ["b1", "migrated", "wb-1"],
        ["b3", "migrated", "wb-2"],
      ],
    );
    assert.ok(
      !h.state.saved.at(-1).includes("token-123"),
      "the token is never written to the log",
    );
    assert.match(h.$("#miro-board-list").textContent, /Migrated/);
    assert.equal(h.$("#miro-cancel").hidden, true);

    // Running again skips migrated boards.
    h.$("#miro-run").click();
    await h.until(
      () => /0 migrated/.test(h.$("#miro-status").textContent),
      "idempotent run",
    );
    assert.equal(h.state.created.length, 2);

    // Reports.
    h.$("#miro-csv").click();
    h.$("#miro-json").click();
    h.$("#miro-inventory-csv").click();
    await h.until(() => h.state.downloads.length === 3, "downloads");
    const files = Object.fromEntries(h.state.downloads.map((d) => [d.name, d]));
    assert.deepEqual(
      Object.values(files)
        .map((d) => [d.name, d.type])
        .sort(),
      [
        ["miro-inventory-2026-09-26.csv", "text/csv"],
        ["miro-migration-2026-09-26.csv", "text/csv"],
        ["miro-migration-2026-09-26.json", "application/json"],
      ],
    );
    assert.equal(
      parseLog(files["miro-migration-2026-09-26.json"].text).entries.length,
      2,
    );
    assert.match(
      files["miro-inventory-2026-09-26.csv"].text,
      /^\ufeffmiro_board_id,board_name,team,owner_name,owner_email/,
    );
    assert.match(
      files["miro-migration-2026-09-26.csv"].text,
      /b3,Charlie <script>,phase-1: Digital Services,migrated,wb-2,gina@vendor\.com/,
    );

    // Rollback asks for confirmation, then deletes the phase's boards.
    h.$("#miro-rollback").click();
    await h.until(() => h.$("#miro-rollback").dataset.confirm, "confirmation");
    assert.equal(
      h.$("#miro-rollback").textContent,
      "Confirm rollback of 2 boards",
    );
    assert.equal(h.state.deleted.length, 0);
    h.$("#miro-rollback").click();
    await h.until(
      () => /Rollback complete/.test(h.$("#miro-status").textContent),
      "rollback",
    );
    assert.deepEqual(h.state.deleted.sort(), ["wb-1", "wb-2"]);
    assert.equal(
      h.$("#miro-status").textContent,
      "Rollback complete: 2 boards removed, 0 failed.",
    );
    assert.deepEqual(
      parseLog(h.state.saved.at(-1)).entries.map((e) => e.status),
      ["rolled-back", "rolled-back"],
    );
    h.$("#miro-rollback").click();
    await h.until(
      () => /Nothing to roll back/.test(h.$("#miro-status").textContent),
      "empty rollback",
    );
  } finally {
    h.close();
  }
});

test("dialog resumes a saved log, cancels a run, and translates to French", async () => {
  const dom = new JSDOM("<body></body>");
  globalThis.document = dom.window.document;
  const i18n = await import("../src/i18n.js");
  delete globalThis.document;
  const log = createLog(() => 0);
  ensureEntries(log, [{ id: "b1", name: "Alpha" }]);
  Object.assign(log.entries[0], {
    status: "migrated",
    createdBoardId: "wb-old",
  });
  let release;
  const h = dialogHarness({
    loadLog: async () => JSON.stringify(log),
    createBoard: () => new Promise((resolve) => (release = resolve)),
  });
  try {
    i18n.setLanguage("fr");
    h.deps.t = i18n.t;
    const migration = createMiroMigration(h.deps);
    migration.open();
    assert.equal(
      h.$("dialog").getAttribute("aria-label"),
      "Migrer depuis Miro",
    );
    assert.match(
      h.$("#miro-token").closest("label").textContent,
      /Jeton d’accès Miro/,
    );
    h.set("#miro-token", "tok");
    h.set("#miro-remember", true);
    h.submit();
    await h.until(() => !h.$("#miro-inventory").hidden, "inventory");
    assert.match(
      h.$("#miro-summary").textContent,
      /Sans domaines d’organisation/,
    );
    assert.match(h.$("#miro-board-list").textContent, /Migré/);
    assert.match(
      h.$("#miro-phase").options[0].textContent,
      /^Tous les tableaux \(3\)$/,
    );
    // It selects the boards the filter shows, not "the display".
    assert.equal(
      h.$("#miro-select-all").textContent,
      "Sélectionner les tableaux affichés",
    );

    // Cancel while a board is being created; the created board is still logged.
    h.set("#miro-force", true);
    h.$("#miro-run").click();
    await h.until(() => release, "createBoard");
    assert.equal(h.$("#miro-cancel").hidden, false);
    assert.equal(h.doc.activeElement, h.$("#miro-cancel"));
    h.$("#miro-cancel").click();
    release({ id: "wb-new" });
    await h.until(
      () => /Migration annulée/.test(h.$("#miro-status").textContent),
      "cancel",
    );
    const saved = parseLog(h.state.saved.at(-1));
    assert.equal(saved.entries[0].createdBoardId, "wb-new");
    assert.deepEqual(saved.entries[0].previousBoardIds, ["wb-old"]);
    assert.equal(
      logEntry(saved, "b2").status,
      "pending",
      "later boards were not started",
    );

    // The token can be kept in memory for the next dialog only when chosen.
    h.$("dialog").remove();
    migration.open();
    assert.equal(h.$("#miro-token").value, "tok");
  } finally {
    i18n.setLanguage("en");
    h.close();
  }
});

test("dialog reports unreadable logs and connection errors", async () => {
  const h = dialogHarness({
    loadLog: async () => "{broken",
    fetch: async () => json({ code: "tokenInvalid" }, 401),
  });
  try {
    createMiroMigration(h.deps).open();
    await h.until(
      () => /could not be read/.test(h.$("#miro-error").textContent),
      "log warning",
    );
    h.set("#miro-token", "bad");
    h.set("#miro-email-map", "not a mapping");
    h.submit();
    assert.equal(
      h.$("#miro-error").textContent,
      "Check email mapping lines: 1",
    );
    h.set("#miro-email-map", "");
    h.submit();
    await h.until(
      () => /token was rejected/.test(h.$("#miro-error").textContent),
      "401",
    );
    assert.equal(h.$("#miro-inventory").hidden, true);
    assert.equal(h.$("#miro-load").disabled, false);
  } finally {
    h.close();
  }
});

test("the dialog says why it is waiting to retry Miro", async () => {
  const replies = [
    () => {
      throw TypeError("Failed to fetch");
    },
    () => json({}, 503),
    () => json({}, 429, { "Retry-After": "2" }),
    () => json({ code: "tokenInvalid" }, 401),
  ];
  const waits = [];
  const h = dialogHarness({
    fetch: async () => replies.shift()(),
    sleep: async () => waits.push(h.$("#miro-status").textContent),
  });
  try {
    createMiroMigration(h.deps).open();
    h.set("#miro-token", "token");
    h.submit();
    await h.until(
      () => /token was rejected/.test(h.$("#miro-error").textContent),
      "401",
    );
    assert.deepEqual(waits, [
      "Miro could not be reached. Retrying in 1 s.",
      "Miro could not be reached. Retrying in 2 s.",
      "Miro asked to slow down. Retrying in 2 s.",
    ]);
  } finally {
    h.close();
  }
});

test("the dialog counts one board, item, or guest in the singular", async () => {
  const solo = miroBoard({ id: "b1", name: "Solo" });
  const api = fakeFetch([
    [/^\/v2\/boards$/, (u) => offsetPage([solo], u)],
    [/^\/v2\/boards\/b1$/, () => json(solo)],
    [/^\/v2\/boards\/b1\/members$/, (u) => offsetPage(MEMBERS.slice(0, 3), u)],
    [/^\/v2\/boards\/b1\/items$/, (u) => cursorPage(ITEMS.slice(0, 1), u, 50)],
    [/^\/v2\/boards\/b1\/(connectors|tags)$/, (u) => offsetPage([], u)],
  ]);
  const h = dialogHarness({ fetch: api.fetch });
  try {
    createMiroMigration(h.deps).open();
    h.set("#miro-token", "token");
    h.set("#miro-domains", "canada.ca");
    h.set(
      "#miro-email-map",
      [
        `${ALICE},alice@canada.ca`,
        `${BOB},bob@canada.ca`,
        `${GUEST},gina@vendor.com`,
      ].join("\n"),
    );
    h.submit();
    await h.until(() => !h.$("#miro-inventory").hidden, "inventory");
    assert.match(h.$("#miro-board-list").textContent, / 1 item · 1 guest · /);
    h.$("#miro-run").click();
    await h.until(
      () => /Migration complete/.test(h.$("#miro-status").textContent),
      "migration",
    );
    h.$("#miro-rollback").click();
    await h.until(
      () => /Confirm/.test(h.$("#miro-rollback").textContent),
      "confirmation",
    );
    assert.equal(
      h.$("#miro-rollback").textContent,
      "Confirm rollback of 1 board",
    );
  } finally {
    h.close();
  }
});

test("named entities keep the case of accented capitals", () => {
  assert.equal(
    decodeEntities(
      "&Eacute;quipe &eacute;t&eacute; &Agrave; &Ccedil;a &OElig;uvre &AMP;",
    ),
    "\u00c9quipe \u00e9t\u00e9 \u00c0 \u00c7a \u0152uvre &",
  );
  assert.equal(decodeEntities("&Xacute; &bogus;"), "&Xacute; &bogus;");
  assert.equal(
    decodeEntities("&constructor; &toString; &VALUEOF;"),
    "&constructor; &toString; &VALUEOF;",
  );
});

test("listing boards survives edits and new boards during the inventory", async () => {
  // Boards 0-119, newest first; offset pages of 50.
  let boards = Array.from({ length: 120 }, (_, n) => ({
    id: "b" + n,
    created: 1000 - n,
    modified: 1000 - n,
  }));
  let pages = 0;
  const client = createMiroClient({
    token: "t",
    sleep: async () => {},
    fetch: async (href) => {
      const url = new URL(href);
      const key =
        url.searchParams.get("sort") === "last_created"
          ? "created"
          : "modified";
      if (pages++ === 1) {
        // Between pages someone edits an unread board and creates one.
        boards.find((b) => b.id === "b110").modified = 5000;
        boards = [{ id: "new", created: 5000, modified: 5000 }, ...boards];
      }
      const sorted = [...boards].sort((a, b) => b[key] - a[key]);
      const offset = Number(url.searchParams.get("offset")),
        limit = Number(url.searchParams.get("limit"));
      return json({
        data: sorted.slice(offset, offset + limit).map((b) => miroBoard(b)),
        total: sorted.length,
        offset,
        limit,
      });
    },
  });
  const ids = (await client.listBoards()).map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "each board once");
  for (let n = 0; n < 120; n++) assert.ok(ids.includes("b" + n), "b" + n);
});

test("the template option is offered only where templates can be saved", () => {
  for (const [canTemplate, shown] of [
    [() => false, false],
    [() => true, true],
    [undefined, true],
  ]) {
    const h = dialogHarness({ canTemplate });
    try {
      createMiroMigration(h.deps).open();
      assert.equal(!!h.$("#miro-template"), shown);
    } finally {
      h.close();
    }
  }
});

test("a migration log that cannot be loaded blocks migrating over it", async () => {
  const h = dialogHarness({
    loadLog: async () => {
      throw Error("Network request failed");
    },
  });
  try {
    createMiroMigration(h.deps).open();
    await h.until(
      () => /could not be loaded/.test(h.$("#miro-error").textContent),
      "warning",
    );
    h.set("#miro-token", "tok");
    h.submit();
    await h.until(() => !h.$("#miro-inventory").hidden, "inventory");
    h.$("[data-board]").click();
    h.$("#miro-run").click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(h.state.created.length, 0);
    assert.equal(h.state.saved.length, 0);
    assert.match(h.$("#miro-error").textContent, /could not be loaded/);
  } finally {
    h.close();
  }
});

test("rolling back all boards includes boards Miro no longer lists", async () => {
  const log = createLog();
  ensureEntries(log, [{ id: "gone", name: "Deleted in Miro" }]);
  updateEntry(
    log,
    { id: "gone", name: "Deleted in Miro" },
    { status: "migrated", createdBoardId: "wb-gone" },
  );
  const h = dialogHarness({ loadLog: async () => JSON.stringify(log) });
  try {
    createMiroMigration(h.deps).open();
    h.set("#miro-token", "tok");
    h.submit();
    await h.until(() => !h.$("#miro-inventory").hidden, "inventory");
    assert.equal(h.$("#miro-phase").value, "all");
    h.$("#miro-rollback").click();
    await h.until(() => h.$("#miro-rollback").dataset.confirm, "confirm");
    h.$("#miro-rollback").click();
    await h.until(
      () => /Rollback complete/.test(h.$("#miro-status").textContent),
      "rollback",
    );
    assert.deepEqual(h.state.deleted, ["wb-gone"]);
    assert.equal(
      h.$("#miro-status").textContent,
      "Rollback complete: 1 board removed, 0 failed.",
    );
  } finally {
    h.close();
  }
});

test("a running migration ignores Escape and outside clicks and reports a close", async () => {
  let release;
  const h = dialogHarness({
    createBoard: () => new Promise((resolve) => (release = resolve)),
  });
  try {
    createMiroMigration(h.deps).open();
    const d = h.$("dialog");
    let outside = 0;
    d.addEventListener("click", (e) => e.target === d && outside++);
    h.set("#miro-token", "tok");
    h.submit();
    await h.until(() => !h.$("#miro-inventory").hidden, "inventory");
    h.$("[data-board]").click();
    h.$("#miro-run").click();
    await h.until(() => release, "running");
    const escape = new h.doc.defaultView.Event("cancel", { cancelable: true });
    d.dispatchEvent(escape);
    assert.equal(escape.defaultPrevented, true);
    d.dispatchEvent(
      new h.doc.defaultView.MouseEvent("click", { bubbles: true }),
    );
    assert.equal(outside, 0, "a click outside does not close it");
    d.dispatchEvent(new h.doc.defaultView.Event("close"));
    assert.match(h.state.toasts.at(-1), /Migration stopped/);
  } finally {
    h.close();
  }
});

test("closing while boards load or roll back says what stopped", async () => {
  // Loading boards changes nothing, so Escape closes the dialog quietly.
  const loading = dialogHarness({
    fetch: (url, init) =>
      new Promise((_, reject) =>
        init.signal.addEventListener("abort", () => reject(Error("aborted"))),
      ),
  });
  try {
    createMiroMigration(loading.deps).open();
    loading.set("#miro-token", "tok");
    loading.submit();
    await loading.until(() => !loading.$("#miro-cancel").hidden, "loading");
    const d = loading.$("dialog");
    const escape = new loading.dom.window.Event("cancel", { cancelable: true });
    d.dispatchEvent(escape);
    assert.equal(escape.defaultPrevented, false);
    d.dispatchEvent(new loading.dom.window.Event("close"));
    assert.deepEqual(loading.state.toasts, []);
  } finally {
    loading.close();
  }
  // A rollback in progress is guarded like a migration and named on close.
  const log = createLog();
  ensureEntries(log, [{ id: "b1", name: "Alpha" }]);
  updateEntry(
    log,
    { id: "b1", name: "Alpha" },
    { status: "migrated", createdBoardId: "wb-1" },
  );
  let started;
  const h = dialogHarness({
    loadLog: async () => JSON.stringify(log),
    deleteBoard: () => new Promise(() => (started = true)),
  });
  try {
    createMiroMigration(h.deps).open();
    h.set("#miro-token", "tok");
    h.submit();
    await h.until(() => !h.$("#miro-inventory").hidden, "inventory");
    h.$("#miro-rollback").click();
    await h.until(() => h.$("#miro-rollback").dataset.confirm, "confirm");
    h.$("#miro-rollback").click();
    await h.until(() => started, "rolling back");
    const d = h.$("dialog");
    const escape = new h.dom.window.Event("cancel", { cancelable: true });
    d.dispatchEvent(escape);
    assert.equal(escape.defaultPrevented, true);
    d.dispatchEvent(new h.dom.window.Event("close"));
    assert.deepEqual(h.state.toasts, [
      "Rollback stopped. Boards not rolled back yet are kept in the log.",
    ]);
  } finally {
    h.close();
  }
});

test("unticking Keep the token forgets it right away", async () => {
  const h = dialogHarness();
  try {
    const migration = createMiroMigration(h.deps);
    migration.open();
    h.set("#miro-token", "secret-token");
    h.set("#miro-remember", true);
    h.submit();
    await h.until(() => !h.$("#miro-inventory").hidden, "inventory");
    h.$("dialog").remove();
    migration.open();
    assert.equal(h.$("#miro-token").value, "secret-token");
    const keep = h.$("#miro-remember");
    keep.checked = false;
    keep.dispatchEvent(new h.doc.defaultView.Event("change"));
    h.$("dialog").remove();
    migration.open();
    assert.equal(h.$("#miro-token").value, "");
  } finally {
    h.close();
  }
});

test("boards migrated to this device appear in the library, and rollback removes them", async () => {
  const { IDBFactory } = await import("fake-indexeddb");
  const { appBundle } = await import("./app-bundle.js");
  const { createCanvas } = await import("./canvas.js");
  const dom = new JSDOM('<div id="app"></div><div id="toast"></div>', {
    url: "https://whiteboard.test",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.structuredClone = (value) => w.JSON.parse(w.JSON.stringify(value));
  w.TextEncoder = TextEncoder;
  w.TextDecoder = TextDecoder;
  Object.defineProperty(w.crypto, "subtle", { value: crypto.subtle });
  w.indexedDB = new IDBFactory();
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.HTMLCanvasElement.prototype.getContext = function () {
    this._native ??= createCanvas(this.width, this.height);
    return this._native.getContext("2d");
  };
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new w.Event("close"));
  };
  const files = new Map();
  w.puter = {
    auth: {
      isSignedIn: () => true,
      getUser: async () => ({ uuid: "u1", username: "alice" }),
    },
    fs: {
      write: async (path, text) => files.set(path, text),
      read: async (path) => {
        if (!files.has(path))
          throw Object.assign(Error("missing"), { code: "ENOENT" });
        return new Blob([files.get(path)]);
      },
    },
    net: { fetch: miroAPI().fetch },
  };
  try {
    await w.eval(`(async()=>{${await appBundle()}\n})()`);
    const doc = w.document;
    const tick = () => new Promise((r) => setTimeout(r, 25));
    const until = async (check, label) => {
      const deadline = Date.now() + 8000;
      while (!check() && Date.now() < deadline) await tick();
      assert.ok(check(), label);
    };
    const cards = () =>
      [...doc.querySelectorAll("#board-grid .board-info h3")].map(
        (h) => h.textContent,
      );
    const allCount = () =>
      doc.querySelector('[data-filter="all"] > span:last-child').textContent;
    await until(() => doc.querySelector("#board-grid"), "Library shown");
    assert.deepEqual(cards(), []);
    doc.querySelector('[data-action="migrate-miro"]').click();
    await until(() => doc.querySelector("#miro-connect"), "Dialog opened");
    const set = (selector, value) => {
      const el = doc.querySelector(selector);
      if (el.type === "checkbox") el.checked = value;
      else el.value = value;
      el.dispatchEvent(new w.Event("input", { bubbles: true }));
      el.dispatchEvent(new w.Event("change", { bubbles: true }));
    };
    set("#miro-token", "token-123");
    set("#miro-org", "o1");
    doc
      .querySelector("#miro-connect")
      .dispatchEvent(new w.Event("submit", { cancelable: true }));
    await until(
      () => !doc.querySelector("#miro-inventory").hidden,
      "Inventory loaded",
    );
    set("[data-board='b2']", false);
    set("[data-board='b3']", false);
    doc.querySelector("#miro-run").click();
    await until(
      () =>
        /Migration complete/.test(
          doc.querySelector("#miro-status").textContent,
        ),
      "Migration finished",
    );
    assert.deepEqual(cards(), ["Alpha"], "The library shows the new board");
    assert.equal(allCount(), "1");
    // The log names the device the board is on.
    const [logPath] = [...files.keys()];
    const saved = files.get(logPath);
    const device = w.localStorage
      .getItem("whiteboard-comment-author")
      .slice("device:".length);
    assert.match(saved, new RegExp(`"local:${device}:`));
    // Rolling back from another device leaves the board and says why.
    const rollback = async (done) => {
      doc.querySelector("#miro-rollback").click();
      await until(
        () => doc.querySelector("#miro-rollback").dataset.confirm,
        "Rollback asks to confirm",
      );
      doc.querySelector("#miro-rollback").click();
      await until(
        () => done.test(doc.querySelector("#miro-status").textContent),
        "Rollback finished",
      );
    };
    const reopen = async () => {
      doc.querySelector("dialog").close();
      doc.querySelector('[data-action="migrate-miro"]').click();
      await until(() => doc.querySelector("#miro-connect"), "Dialog opened");
      set("#miro-token", "token-123");
      set("#miro-org", "o1");
      doc
        .querySelector("#miro-connect")
        .dispatchEvent(new w.Event("submit", { cancelable: true }));
      await until(
        () => !doc.querySelector("#miro-inventory").hidden,
        "Inventory loaded",
      );
    };
    files.set(
      logPath,
      saved.replaceAll(`local:${device}:`, `local:${"0".repeat(36)}:`),
    );
    await reopen();
    await rollback(/Rollback complete/);
    assert.match(doc.querySelector("#miro-status").textContent, /1 failed/);
    assert.match(
      doc.querySelector("#miro-results").textContent,
      /another device/,
    );
    assert.deepEqual(cards(), ["Alpha"]);
    files.set(logPath, saved);
    await reopen();
    doc.querySelector("#miro-rollback").click();
    await until(
      () => doc.querySelector("#miro-rollback").dataset.confirm,
      "Rollback asks to confirm",
    );
    doc.querySelector("#miro-rollback").click();
    await until(
      () =>
        /Rollback complete/.test(doc.querySelector("#miro-status").textContent),
      "Rollback finished",
    );
    assert.deepEqual(cards(), [], "Rolled-back boards leave the library");
    assert.equal(allCount(), "0");
  } finally {
    w.close();
  }
});

test("a board that cannot be converted is summarized in French", async () => {
  const dom = new JSDOM("<body></body>");
  globalThis.document = dom.window.document;
  const i18n = await import("../src/i18n.js");
  delete globalThis.document;
  const base = miroAPI();
  const many = Array.from({ length: 5001 }, (_, n) => ({
    id: `s${n}`,
    type: "sticky_note",
    data: { content: "x" },
    position: { x: n, y: 0, origin: "center", relativeTo: "canvas_center" },
    geometry: { width: 10, height: 10 },
  }));
  const h = dialogHarness({
    fetch: async (url, init) =>
      /^\/v2\/boards\/[^/]+\/items$/.test(new URL(url).pathname)
        ? cursorPage(many, new URL(url), 1000)
        : base.fetch(url, init),
  });
  try {
    i18n.setLanguage("fr");
    h.deps.t = i18n.t;
    createMiroMigration(h.deps).open();
    h.set("#miro-token", "tok");
    h.submit();
    await h.until(() => !h.$("#miro-inventory").hidden, "inventory");
    h.set("[data-board='b2']", false);
    h.set("[data-board='b3']", false);
    h.$("#miro-dry-run").click();
    await h.until(() => h.$("#miro-results > li"), "dry run");
    const summary = h.$("#miro-results > li small").textContent;
    assert.match(summary, /5001/);
    assert.doesNotMatch(summary, /This board has/);
    assert.ok(
      summary.includes(
        formatIssue({ code: "over-limit", params: { count: 5001 } }, i18n.t),
      ),
    );
  } finally {
    i18n.setLanguage("en");
    h.close();
  }
});

test("report reasons with Miro status codes and validation read in French", async () => {
  const dom = new JSDOM("<body></body>");
  globalThis.document = dom.window.document;
  const i18n = await import("../src/i18n.js");
  delete globalThis.document;
  const base = miroAPI();
  const image = ITEMS.find((i) => i.id === "IM1");
  const h = dialogHarness({
    fetch: async (url, init) => {
      const { pathname } = new URL(url);
      if (/^\/v2\/boards\/[^/]+\/items$/.test(pathname))
        return cursorPage([image], new URL(url), 50);
      if (pathname.includes("/resources/")) return json({}, 500);
      return base.fetch(url, init);
    },
  });
  try {
    i18n.setLanguage("fr");
    h.deps.t = i18n.t;
    createMiroMigration(h.deps).open();
    h.set("#miro-token", "tok");
    h.submit();
    await h.until(() => !h.$("#miro-inventory").hidden, "inventory");
    h.set("[data-board='b2']", false);
    h.set("[data-board='b3']", false);
    h.$("#miro-dry-run").click();
    await h.until(() => h.$("#miro-results > li"), "dry run");
    const details = h.$("#miro-results details").textContent;
    assert.match(details, /Miro a renvoyé une erreur \(500\)/);
    assert.doesNotMatch(details, /Miro returned/);
    assert.equal(
      formatIssue(
        {
          code: "board-invalid",
          params: { reason: "The board contains an invalid object." },
        },
        i18n.t,
      ),
      "Le tableau converti n’a pas passé la validation : Le tableau contient un objet non valide.",
    );
  } finally {
    i18n.setLanguage("en");
    h.close();
  }
});

test("Miro embeds of content the board can embed stay embedded", async () => {
  const at = (id, type, data) => ({
    id,
    type,
    data,
    style: {},
    position: { x: 0, y: 0, origin: "center", relativeTo: "canvas_center" },
    geometry: { width: 400, height: 300 },
  });
  const { board, report } = await convertMiroBoard(
    {
      board: { id: "b", name: "Embeds" },
      items: [
        at("e1", "embed", {
          url: "https://youtu.be/dQw4w9WgXcQ",
          title: "Launch video",
        }),
        at("e2", "embed", { url: "https://example.org/widget" }),
        at("e3", "preview", {
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        }),
      ],
      connectors: [],
      tags: [],
    },
    { makeId },
  );
  validateBoard(board);
  assert.deepEqual(
    board.items.map((i) => [i.type, i.provider, i.url, i.text]),
    [
      [
        "embed",
        "youtube",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "Launch video",
      ],
      ["link", undefined, "https://example.org/widget", "example.org"],
      [
        "link",
        undefined,
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "www.youtube.com",
      ],
    ],
  );
  assert.deepEqual(report.warnings, []);
});

test("a board whose members could not be read is not migrated with its owner only", async () => {
  let failing = true;
  const client = {
    listBoards: async () => [
      { id: "b1", name: "Board", owner: { id: "u1", name: "Owner" } },
    ],
    listMembers: async () => {
      if (failing)
        throw new MiroError("Miro returned an error (503).", { status: 503 });
      return [{ id: "u2", name: "Ada", email: "ada@gc.ca", role: "editor" }];
    },
    countItems: async () => 0,
    fetchBoardContent: async () => ({
      board: { id: "b1", name: "Board" },
      items: [],
      connectors: [],
      tags: [],
    }),
    downloadImage: async () => null,
    downloadResource: async () => null,
  };
  const created = [];
  const run = async (boards, log) =>
    runMigration({
      client,
      boards,
      log,
      fallbackOwnerEmail: "owner@gc.ca",
      createBoard: async (board, options) => {
        created.push(options.members);
        return { id: `local:x:${created.length}` };
      },
    });
  const log = createLog();
  const unread = await loadInventory(client, { domains: ["gc.ca"] });
  assert.ok(unread.boards[0].error);
  const first = await run(unread.boards, log);
  assert.equal(first.results[0].status, "failed");
  assert.match(first.results[0].error, /members could not be read/);
  assert.equal(created.length, 0);
  assert.equal(logEntry(log, "b1").status, "failed");
  // Once the members can be read, the board migrates with them.
  failing = false;
  const read = await loadInventory(client, { domains: ["gc.ca"] });
  const second = await run(read.boards, log);
  assert.equal(second.results[0].status, "migrated");
  assert.ok(created[0].some((m) => m.email === "ada@gc.ca"));
});

test("a dialog opened while a stopped run finishes waits for its log", async () => {
  let release;
  const created = [];
  const h = dialogHarness({
    loadLog: async () => h.state.saved.at(-1) || null,
    createBoard: (board) => {
      created.push(board.title);
      return created.length === 1
        ? new Promise((resolve) => (release = resolve))
        : { id: `wb-${created.length}` };
    },
  });
  try {
    const migration = createMiroMigration(h.deps);
    migration.open();
    h.set("#miro-token", "tok");
    h.submit();
    await h.until(() => !h.$("#miro-inventory").hidden, "inventory");
    h.$("#miro-run").click();
    await h.until(() => release, "the first board is being created");
    // Closing stops the run, but the board being created still arrives.
    const first = h.$("dialog");
    first.dispatchEvent(new h.dom.window.Event("close"));
    first.remove();
    migration.open();
    assert.match(h.$("#miro-status").textContent, /Finishing the migration/);
    h.set("#miro-token", "tok");
    h.submit();
    release({ id: "wb-1" });
    await h.until(() => !h.$("#miro-inventory").hidden, "inventory again");
    h.$("#miro-run").click();
    await h.until(
      () => /Migration complete/.test(h.$("#miro-status").textContent),
      "second run",
    );
    // The board created before closing is not copied again, and the log
    // still tracks it.
    assert.equal(created.filter((t) => t === created[0]).length, 1);
    const saved = parseLog(h.state.saved.at(-1));
    assert.equal(saved.entries[0].createdBoardId, "wb-1");
  } finally {
    h.close();
  }
});

test("Miro text links and styles read their own attributes, not data- ones", () => {
  const link = htmlToRichText(
    '<p><a data-href="https://evil.example" href="https://good.example">x</a></p>',
  );
  assert.equal(link.runs[0].style.link, "https://good.example/");
  const styled = htmlToRichText(
    '<p><span data-style="font-weight:bold" style="font-style:italic">y</span></p>',
  );
  assert.deepEqual(styled.runs[0].style, { italic: true });
});

test("stopping a rollback says the rollback stopped", async () => {
  const log = createLog();
  const boards = [
    { id: "b1", name: "Alpha" },
    { id: "b2", name: "Beta" },
  ];
  ensureEntries(log, boards);
  boards.forEach((b, n) =>
    updateEntry(log, b, { status: "migrated", createdBoardId: `wb-${n}` }),
  );
  let release;
  const h = dialogHarness({
    loadLog: async () => JSON.stringify(log),
    deleteBoard: () => new Promise((resolve) => (release = resolve)),
  });
  try {
    createMiroMigration(h.deps).open();
    h.set("#miro-token", "tok");
    h.submit();
    await h.until(() => !h.$("#miro-inventory").hidden, "inventory");
    h.$("#miro-rollback").click();
    await h.until(() => h.$("#miro-rollback").dataset.confirm, "confirm");
    h.$("#miro-rollback").click();
    await h.until(() => release, "rolling back");
    h.$("#miro-cancel").click();
    release();
    await h.until(
      () => /stopped/.test(h.$("#miro-status").textContent),
      "stopped",
    );
    assert.equal(
      h.$("#miro-status").textContent,
      "Rollback stopped. Boards not rolled back yet are kept in the log.",
    );
  } finally {
    h.close();
  }
});

test("migrating into a shared board keeps no copy of its images on this device", async () => {
  const { createMigrationHost } = await import("../src/migration/host.js");
  const { CollaborationSession } =
    await import("../src/collaboration/session.js");
  const { local } = await import("../src/storage.js");
  const kept = [];
  const sent = [];
  const put = local.collaborationPut;
  const request = CollaborationSession.prototype.request;
  local.collaborationPut = async (row) => kept.push(row);
  CollaborationSession.prototype.request = async (op, data) => {
    sent.push({ op, ...data });
    return {};
  };
  const base = miroAPI();
  // The listing is asked to slow down once; that wait is not under test.
  await base.fetch("https://api.miro.com/v2/boards?limit=50");
  const fetch = async (url, init) => {
    const { pathname } = new URL(url);
    if (/^\/v2\/boards\/[^/]+\/items$/.test(pathname))
      return cursorPage(
        ITEMS.filter((i) => i.id === "IM1"),
        new URL(url),
        50,
      );
    if (pathname.includes("/resources/"))
      return json({ type: "image", url: "https://files.example.net/im1" });
    if (url.startsWith("https://files.example.net/"))
      return new Response(png(10, 10), {
        headers: { "content-type": "image/png" },
      });
    return base.fetch(url, init);
  };
  const h = dialogHarness();
  try {
    createMigrationHost({
      org: {
        server: "https://whiteboard-test.puter.work",
        isAdmin: true,
        isMember: true,
        request: async (op) => {
          sent.push({ op });
          return {};
        },
      },
      puter: () => ({
        net: { fetch },
        auth: { getUser: async () => ({ uuid: "admin", username: "Ada" }) },
        fs: {
          write: async () => {},
          read: async () => {
            throw Object.assign(Error("missing"), { code: "ENOENT" });
          },
        },
      }),
      modal: h.deps.modal,
      toast: () => {},
      download: () => {},
      addLocalBoard: async () => assert.fail("not a local board"),
      removeLocalBoard: async () => {},
    }).open();
    h.set("#miro-token", "tok");
    h.submit();
    await h.until(() => !h.$("#miro-inventory").hidden, "inventory");
    h.set("[data-board='b2']", false);
    h.set("[data-board='b3']", false);
    h.$("#miro-run").click();
    await h.until(
      () => /complete/.test(h.$("#miro-status").textContent),
      "migration",
    );
    assert.match(h.$("#miro-status").textContent, /1 migrated/);
    assert.deepEqual(
      sent.map((c) => c.op),
      ["create", "asset.put", "migration.apply"],
    );
    assert.match(sent[1].data, /^data:image\/png;base64,/);
    assert.deepEqual(kept, [], "nothing is written to this device");
  } finally {
    local.collaborationPut = put;
    CollaborationSession.prototype.request = request;
    h.close();
  }
});

test("a large tag catalog does not slow down checking each object", async () => {
  const notes = Array.from({ length: 2000 }, (_, n) => ({
    id: `n${n}`,
    type: "sticky_note",
    data: { content: `<p>Note ${n}</p>` },
    tagIds: [`t${n % 1000}`],
    position: pos(n * 10, 0),
  }));
  const catalog = (size) =>
    Array.from({ length: size }, (_, n) => ({
      id: `t${n}`,
      title: `Tag ${n}`,
      fillColor: "red",
    }));
  // The fastest of a few runs, so a busy machine does not decide the result.
  const fastest = async (tags) => {
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      const { board } = await convertMiroBoard(
        {
          board: { id: "b", name: "Tags" },
          items: notes,
          connectors: [],
          tags,
        },
        { makeId },
      );
      best = Math.min(best, performance.now() - started);
      assert.equal(board.items.length, notes.length);
      assert.equal(board.tags.length, tags.length);
    }
    return best;
  };
  const few = await fastest(catalog(1));
  const many = await fastest(catalog(1000));
  assert.ok(
    many < few * 3,
    `${Math.round(many)} ms against ${Math.round(few)} ms`,
  );
});

test("images and files past the import size budget keep placeholders", async () => {
  // One 36 MB image, shared by every download so the test stays small.
  const src = `${embedImage(png(10, 10)).src.replace(/=+$/, "")}${"A".repeat(36 * 1024 * 1024)}`;
  const at = (id, type, data) => ({
    id,
    type,
    data,
    position: { x: 0, y: 0, origin: "center", relativeTo: "canvas_center" },
    geometry: { width: 100, height: 100 },
  });
  const images = [];
  const files = [];
  const { board, report } = await convertMiroBoard(
    {
      board: { id: "b", name: "Photos" },
      items: [
        ...[0, 1, 2, 3].map((n) =>
          at(`i${n}`, "image", {
            imageUrl: `https://files.example.net/${n}.png`,
            title: `Photo ${n}`,
          }),
        ),
        at("d1", "document", {
          documentUrl: "https://files.example.net/plan.pdf",
          title: "Plan",
        }),
      ],
      connectors: [],
      tags: [],
    },
    {
      makeId,
      concurrency: 1,
      fetchImage: async (url) => {
        images.push(url);
        return { src, width: 10, height: 10 };
      },
      fetchFile: async (url) => {
        files.push(url);
        return new Uint8Array(10);
      },
    },
  );
  validateBoard(board);
  // The third image passes the budget; nothing after it is downloaded.
  assert.equal(images.length, 3);
  assert.equal(files.length, 0);
  assert.deepEqual(report.images, { embedded: 2, failed: 2 });
  assert.deepEqual(
    board.items.map((o) => o.type),
    ["image", "image", "rect", "rect", "link"],
  );
  assert.deepEqual(
    report.warnings.map((w) => [w.code, w.params.reason]),
    [
      ["image-failed", "board over 100 MB"],
      ["image-failed", "board over 100 MB"],
      ["document-failed", "board over 100 MB"],
    ],
  );
  assert.equal(report.bytes, JSON.stringify(board).length);
  const dom = new JSDOM("<body></body>");
  globalThis.document = dom.window.document;
  const { setLanguage, t } = await import("../src/i18n.js");
  try {
    setLanguage("fr");
    assert.match(
      formatIssue(report.warnings[0], t),
      /\(tableau de plus de 100 Mo\)/,
    );
  } finally {
    setLanguage("en");
    dom.window.close();
    delete globalThis.document;
  }
});

test("a board the log cannot record is removed, or named when it cannot be", async () => {
  const client = fakeClient({ boards: boardsFixture() });
  const inventory = await inventoryFor(client);
  const waits = [];
  // A save that fails once is tried again and the run goes on.
  let busy = 1;
  const retried = await runMigration({
    client,
    boards: inventory.boards.slice(0, 2),
    log: createLog(),
    createBoard: async () => ({ id: "wb-1" }),
    saveLog: async () => {
      if (busy-- > 0) throw Error("busy");
    },
    sleep: async (ms) => waits.push(ms),
  });
  assert.equal(retried.fatal, undefined);
  assert.deepEqual(
    retried.results.map((r) => r.status),
    ["migrated", "migrated"],
  );
  assert.equal(waits.length, 1);

  // A log that cannot be saved at all: the new board is removed, so
  // rollback has nothing to miss and migrating again does not copy it twice.
  const log = createLog();
  const deleted = [];
  let saves = 0;
  const removed = await runMigration({
    client,
    boards: inventory.boards,
    log,
    createBoard: async () => ({ id: "wb-2" }),
    deleteBoard: async (id) => deleted.push(id),
    saveLog: async () => {
      saves++;
      throw Error("disk full");
    },
    sleep: async () => {},
  });
  assert.equal(saves, 3, "the save is tried a few times");
  assert.deepEqual(deleted, ["wb-2"]);
  assert.match(removed.fatal, /no board is left untracked/);
  assert.deepEqual(
    removed.results.map((r) => r.status),
    ["failed"],
  );
  assert.equal(logEntry(log, "b1").status, "pending");
  assert.equal(logEntry(log, "b1").createdBoardId, null);

  // A board that cannot be removed either is named in the error.
  const kept = createLog();
  const named = await runMigration({
    client,
    boards: inventory.boards,
    log: kept,
    createBoard: async () => ({ id: "room:r-3" }),
    deleteBoard: async () => {
      throw Error("offline");
    },
    saveLog: async () => {
      throw Error("disk full");
    },
    sleep: async () => {},
  });
  assert.match(named.fatal, /Alpha \(room:r-3\)/);
  assert.deepEqual(
    named.results.map((r) => [r.status, r.createdBoardId]),
    [["migrated", "room:r-3"]],
  );
  assert.equal(logEntry(kept, "b1").createdBoardId, "room:r-3");
});

test("the dialog removes a board the log cannot record and names one it keeps", async () => {
  const dom = new JSDOM("<body></body>");
  globalThis.document = dom.window.document;
  const i18n = await import("../src/i18n.js");
  delete globalThis.document;
  const saveLog = async () => {
    throw Error("disk full");
  };
  const h = dialogHarness({ saveLog });
  try {
    createMiroMigration(h.deps).open();
    h.set("#miro-token", "tok");
    h.submit();
    await h.until(() => !h.$("#miro-inventory").hidden, "inventory");
    h.$("#miro-run").click();
    await h.until(() => h.$("#miro-error").textContent, "stopped");
    assert.deepEqual(h.state.deleted, ["wb-1"]);
  } finally {
    h.close();
  }
  const f = dialogHarness({
    saveLog,
    deleteBoard: async () => {
      throw Error("offline");
    },
  });
  try {
    i18n.setLanguage("fr");
    f.deps.t = i18n.t;
    createMiroMigration(f.deps).open();
    f.set("#miro-token", "tok");
    f.submit();
    await f.until(() => !f.$("#miro-inventory").hidden, "inventory");
    f.$("#miro-run").click();
    await f.until(() => f.$("#miro-error").textContent, "stopped");
    assert.match(f.$("#miro-error").textContent, /^Le journal.*Alpha \(wb-1\)/);
  } finally {
    i18n.setLanguage("en");
    f.close();
  }
});

test("a run or rollback stopped by the log says it stopped, not complete", async () => {
  const log = createLog();
  ensureEntries(log, [{ id: "b1", name: "Alpha" }]);
  updateEntry(
    log,
    { id: "b1", name: "Alpha" },
    { status: "migrated", createdBoardId: "wb-0" },
  );
  const h = dialogHarness({
    loadLog: async () => JSON.stringify(log),
    saveLog: async () => {
      throw Error("disk full");
    },
  });
  try {
    createMiroMigration(h.deps).open();
    h.set("#miro-token", "tok");
    h.submit();
    await h.until(() => !h.$("#miro-inventory").hidden, "inventory");
    h.$("#miro-run").click();
    await h.until(() => h.$("#miro-error").textContent, "run stopped");
    assert.equal(
      h.$("#miro-status").textContent,
      "Migration stopped. Boards already migrated are kept in the log.",
    );
    assert.deepEqual(h.state.toasts, []);
    h.$("#miro-error").textContent = "";
    h.$("#miro-rollback").click();
    await h.until(() => h.$("#miro-rollback").dataset.confirm, "confirm");
    h.$("#miro-rollback").click();
    await h.until(() => h.$("#miro-error").textContent, "rollback stopped");
    assert.equal(
      h.$("#miro-status").textContent,
      "Rollback stopped. Boards not rolled back yet are kept in the log.",
    );
  } finally {
    h.close();
  }
});
