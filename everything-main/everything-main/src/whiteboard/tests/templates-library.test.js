import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { objectNameHTML } from "../src/accessibility/object-content.js";
import { language, setLanguage } from "../src/i18n.js";
import { createCanvas } from "./canvas.js";
import { Image } from "@napi-rs/canvas";
import {
  board,
  bounds,
  validateBoard,
  assertImagePixels,
  imageSize,
} from "../src/model.js";
import {
  TEMPLATE_CATALOG,
  TEMPLATE_CATEGORIES,
  fromTemplate,
  searchTemplates,
} from "../src/templates.js";
import { orderedFrames, frameItems } from "../src/scene.js";
import { SHAPES, SHAPE_FAMILIES } from "../src/shapes.js";
import { searchShapes } from "../src/libraries.js";
import { shapePreview } from "../src/shape-art.js";
import { drawIconNode } from "../src/svg-path.js";
import {
  ICONS,
  ICON_CATEGORIES,
  STICKERS,
  ICON_COLORS,
  searchIcons,
  renderIcon,
  iconItem,
} from "../src/icon-library.js";
import {
  COMPONENTS,
  COMPONENT_GROUPS,
  componentItems,
  searchComponents,
} from "../src/component-library.js";

// En and em dashes, built from code points so the source stays dash free.
const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const strings = (entry) => [
  ...entry.name,
  ...(entry.description || []),
  ...entry.keywords,
];

test("built-in template content keeps its language when the interface changes", () => {
  const dom = new JSDOM("<body></body>");
  const previousDocument = globalThis.document,
    previousLanguage = language;
  globalThis.document = dom.window.document;
  try {
    for (const [source, tag, ui] of [
      ["fr", "fr-CA", "en"],
      ["en", "en", "fr"],
    ]) {
      setLanguage(ui);
      for (const template of TEMPLATE_CATALOG) {
        const b = fromTemplate(template.id, source);
        validateBoard(b);
        const restored = validateBoard(JSON.parse(JSON.stringify(b)));
        for (const i of restored.items) {
          const text = i.text || i.cells?.flat().filter(Boolean).join(" · ");
          if (!text) continue;
          assert.equal(i.lang, tag, `${template.id}: ${text.slice(0, 80)}`);
          dom.window.document.body.innerHTML = objectNameHTML(i);
          const authored = dom.window.document.querySelector(
            "[data-user-content]",
          );
          assert.equal(authored.lang, tag);
          assert.equal(dom.window.document.documentElement.lang, ui);
          assert.equal(authored.querySelector("script,img"), null);
        }
      }
    }
  } finally {
    setLanguage(previousLanguage);
    globalThis.document = previousDocument;
    dom.window.close();
  }
});

test("the icon library offers a curated, bilingual, uniquely named set", () => {
  assert.ok(ICONS.length >= 150, `${ICONS.length} icons`);
  const ids = [...ICONS, ...STICKERS].map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  const categories = new Set(ICON_CATEGORIES.map((c) => c.id));
  for (const icon of ICONS) {
    assert.ok(Array.isArray(icon.node) && icon.node.length, icon.id);
    assert.ok(categories.has(icon.category), icon.id);
    assert.equal(icon.name.length, 2);
    assert.equal(icon.keywords.length, 2);
    for (const s of strings(icon)) {
      assert.ok(s.trim(), icon.id);
      assert.doesNotMatch(s, dashes, icon.id);
    }
  }
  for (const c of ICON_CATEGORIES) {
    assert.ok(c.name[0] && c.name[1], c.id);
    if (c.id !== "stickers")
      assert.ok(
        ICONS.some((i) => i.category === c.id),
        c.id,
      );
  }
  assert.ok(ICON_COLORS.every((c) => /^#[\da-f]{6}$/i.test(c.value)));
  // Icons are told apart by name in either language.
  for (const n of [0, 1]) {
    const names = ICONS.map((i) => i.name[n].toLowerCase());
    assert.equal(new Set(names).size, names.length, `language ${n}`);
  }
});

test("facilitation stickers include every required badge", () => {
  for (const id of [
    "thumbs-up",
    "heart",
    "question",
    "star",
    "check",
    "idea",
    "warning",
    "plus-one",
  ]) {
    const sticker = STICKERS.find((s) => s.id === `sticker-${id}`);
    assert.ok(sticker, id);
    assert.equal(sticker.category, "stickers");
    assert.match(sticker.background, /^#[\da-f]{6}$/i);
    assert.ok(sticker.node || sticker.label, id);
  }
  assert.equal(STICKERS.find((s) => s.id === "sticker-plus-one").label, "+1");
});

test("sticker symbols stand out from their badges", () => {
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((v) =>
      v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const rgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  };
  const contrast = (a, b) => {
    const [x, y] = [luminance(a) + 0.05, luminance(b) + 0.05];
    return Math.max(x, y) / Math.min(x, y);
  };
  for (const sticker of STICKERS) {
    // WCAG asks 3:1 for graphics and 4.5:1 for the +1 text.
    const needed = sticker.label ? 4.5 : 3;
    assert.ok(
      contrast(rgb(sticker.glyph), rgb(sticker.background)) >= needed,
      sticker.id,
    );
    // The symbol is drawn in that color.
    const size = 96,
      data = renderIcon(sticker, { size, createCanvas })
        .getContext("2d")
        .getImageData(0, 0, size, size).data,
      [r, g, b] = rgb(sticker.glyph);
    let drawn = 0;
    for (let n = 0; n < data.length; n += 4)
      if (
        data[n + 3] > 250 &&
        Math.abs(data[n] - r) +
          Math.abs(data[n + 1] - g) +
          Math.abs(data[n + 2] - b) <
          12
      )
        drawn++;
    assert.ok(drawn > 50, sticker.id);
  }
});

test("icon search matches both languages, ignores accents, and filters by category", () => {
  const ids = (query, category) =>
    searchIcons(query, category).map((i) => i.id);
  assert.ok(ids("team").includes("users"));
  assert.ok(ids("équipe").includes("users"));
  assert.ok(ids("equipe").includes("users"));
  assert.ok(ids("accessibilité").includes("accessibility"));
  assert.ok(ids("ACCESSIBILITE").includes("accessibility"));
  assert.ok(ids("institution").includes("landmark"));
  assert.ok(ids("thumbs").includes("sticker-thumbs-up"));
  assert.ok(ids("pouce").includes("sticker-thumbs-up"));
  // Typed apostrophes and ligatures match the French text.
  assert.ok(ids("coeur").includes("heart"));
  assert.deepEqual(ids("team people"), ids("people team"));
  assert.equal(ids("no such pictogram").length, 0);
  assert.equal(ids("", "stickers").length, STICKERS.length);
  assert.ok(
    searchIcons("", "security").every((i) => i.category === "security"),
  );
  assert.equal(
    searchIcons("").length,
    ICONS.length + STICKERS.length,
    "An empty query lists everything",
  );
});

const decode = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = Buffer.from(src.split(",")[1], "base64");
  });
const inkedPixels = (image) => {
  const canvas = createCanvas(image.width, image.height),
    ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;
  let count = 0;
  for (let n = 3; n < data.length; n += 4) if (data[n] > 128) count++;
  return count;
};

test("icon insertion produces valid, crisp, non-empty PNG images", async () => {
  for (const entry of [
    ICONS.find((i) => i.id === "users"),
    STICKERS.find((s) => s.id === "sticker-heart"),
    STICKERS.find((s) => s.id === "sticker-plus-one"),
  ]) {
    const i = iconItem(entry, 40, 60, {
      color: "#26374a",
      size: 120,
      lang: "fr",
      createCanvas,
    });
    assert.equal(i.type, "image");
    assert.equal(i.w, 120);
    assert.equal(i.h, 120);
    assert.equal(i.x, 40);
    assert.equal(i.text, entry.name[1]);
    assert.equal(i.alt, entry.name[1], "the name describes the icon");
    assert.equal(i.lang, "fr");
    assert.match(i.src, /^data:image\/png;base64,/);
    validateBoard({ ...board(), items: [i] });
    assertImagePixels([i]);
    const size = imageSize(i.src);
    assert.ok(size.width >= 240, "Rendered at twice the display size");
    assert.equal(size.width, size.height);
    const image = await decode(i.src);
    assert.ok(inkedPixels(image) > 200, entry.id);
  }
  const small = iconItem(ICONS[0], 0, 0, { createCanvas });
  assert.equal(small.w, 96);
  assert.equal(imageSize(small.src).width, 192);
  assert.equal(small.text, ICONS[0].name[0]);
  // Colors reach the rendered strokes.
  const canvas = renderIcon(
    ICONS.find((i) => i.id === "circle-check"),
    {
      color: "#ff0000",
      size: 96,
      createCanvas,
    },
  );
  const data = canvas.getContext("2d").getImageData(0, 0, 96, 96).data;
  let red = 0;
  for (let n = 0; n < data.length; n += 4)
    if (data[n] > 200 && data[n + 1] < 60 && data[n + 3] > 200) red++;
  assert.ok(red > 50);
});

test("every component builds valid grouped objects in both languages", () => {
  assert.ok(COMPONENTS.length >= 40, `${COMPONENTS.length} components`);
  const ids = COMPONENTS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  const groups = new Set(COMPONENT_GROUPS.map((g) => g.id));
  for (const g of groups)
    assert.ok(
      COMPONENTS.some((c) => c.group === g),
      g,
    );
  for (const c of COMPONENTS) {
    assert.ok(groups.has(c.group), c.id);
    for (const s of strings(c)) assert.doesNotMatch(s, dashes, c.id);
    const en = componentItems(c.id, "en"),
      fr = componentItems(c.id, "fr");
    assert.equal(en.length, fr.length, c.id);
    for (const items of [en, fr]) {
      validateBoard({ ...board(), items });
      assert.ok(!items.some((i) => i.type === "frame"), `${c.id} has frames`);
      if (items.length > 1) {
        const groupIds = new Set(items.map((i) => i.groupId));
        assert.equal(groupIds.size, 1, `${c.id} is one group`);
        assert.ok([...groupIds][0], c.id);
      }
      for (const i of items)
        for (const s of [i.text || "", ...(i.cells || []).flat()])
          assert.doesNotMatch(s, dashes, c.id);
      for (const i of items)
        if (i.type !== "arrow")
          assert.ok(i.fontSize == null || i.fontSize >= 12, c.id);
      // The modal dialog shape draws its own placeholder title and
      // buttons, which would show behind a component's real ones.
      if (items.length > 1)
        assert.ok(!items.some((i) => i.shape === "wf-modal"), c.id);
    }
    // Text keeps the language it was inserted in.
    for (const [items, lang] of [
      [en, "en"],
      [fr, "fr-CA"],
    ])
      for (const i of items)
        if (i.text) assert.equal(i.lang, lang, `${c.id} ${i.text}`);
    // Each insertion receives fresh identities.
    const again = componentItems(c.id, "en");
    assert.ok(!again.some((i) => en.some((j) => j.id === i.id)), c.id);
    // Attached connectors stay within the component.
    const own = new Set(en.map((i) => i.id));
    for (const i of en)
      for (const key of ["startId", "endId"])
        if (i[key]) assert.ok(own.has(i[key]), c.id);
  }
  assert.throws(() => componentItems("missing"), /Unknown component/);
});

test("web design system components are searchable and contain no logos", () => {
  const web = COMPONENTS.filter((c) => c.group === "web");
  assert.ok(web.length >= 15);
  for (const c of web)
    for (const lang of ["en", "fr"])
      assert.ok(
        !componentItems(c.id, lang).some((i) => i.type === "image"),
        c.id,
      );
  const ids = (query, group) => searchComponents(query, group).map((c) => c.id);
  assert.ok(ids("header").includes("web-header"));
  assert.ok(ids("en-tête").includes("web-header"));
  assert.ok(ids("en-tete site web").includes("web-header"));
  assert.ok(ids("alerte").includes("web-alert-danger"));
  assert.ok(ids("bouton").includes("web-buttons"));
  assert.ok(ids("", "web").length === web.length);
  assert.ok(ids("systeme de design", "").includes("web-footer"));
  assert.ok(
    searchComponents("", "wireframe").every((c) => c.group === "wireframe"),
  );
  assert.equal(ids("no such component").length, 0);
  const header = componentItems("web-header", "fr")
    .map((i) => i.text)
    .join(" ");
  assert.match(header, /\[Logo de l’organisation\]/);
  assert.match(header, /English/);
});

const REQUIRED_TEMPLATES = [
  "scrum-board",
  "kanban",
  "sprint-planning",
  "retro",
  "retro-ssc",
  "retro-msg",
  "retro-4ls",
  "retro-sailboat",
  "daily-standup",
  "sprint-review",
  "backlog-refinement",
  "user-story-map",
  "product",
  "roadmap-quarterly",
  "okrs",
  "gantt",
  "dependency-map",
  "prioritization-matrix",
  "rice",
  "lean-canvas",
  "business-model-canvas",
  "logic-model",
  "analysis",
  "pestle",
  "personas",
  "empathy-map",
  "design-thinking",
  "journey",
  "service",
  "ecosystem-map",
  "stakeholder-map",
  "user-flow",
  "wireframe",
  "wireframe-desktop",
  "usability-synthesis",
  "affinity-map",
  "crazy-8s",
  "brainstorm",
  "icebreaker",
  "workshop",
  "design-critique",
  "project-kickoff",
  "lightning-decision-jam",
  "fishbone",
  "five-whys",
  "decision-matrix",
  "raci",
  "risk-register",
  "mindmap",
];
const boardText = (b) =>
  b.items.flatMap((i) => [i.text || "", ...(i.cells || []).flat()]);

test("the template catalog covers every required ritual and category", () => {
  assert.ok(TEMPLATE_CATALOG.length >= 40, `${TEMPLATE_CATALOG.length}`);
  const ids = TEMPLATE_CATALOG.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of REQUIRED_TEMPLATES) assert.ok(ids.includes(id), id);
  assert.deepEqual(
    TEMPLATE_CATEGORIES.map((c) => c.id),
    [
      "agile",
      "product",
      "ux",
      "service",
      "strategy",
      "workshops",
      "analysis",
      "project",
      "diagramming",
    ],
  );
  for (const c of TEMPLATE_CATEGORIES) {
    assert.ok(c.name[0] && c.name[1], c.id);
    assert.ok(
      TEMPLATE_CATALOG.some((d) => d.categoryId === c.id),
      `${c.id} has templates`,
    );
  }
  for (const d of TEMPLATE_CATALOG) {
    assert.ok(
      TEMPLATE_CATEGORIES.some((c) => c.id === d.categoryId),
      d.id,
    );
    for (const s of [...d.name, ...d.description, ...d.keywords]) {
      assert.ok(s.trim(), d.id);
      assert.doesNotMatch(s, dashes, d.id);
    }
  }
  assert.ok(TEMPLATE_CATALOG.filter((d) => d.playbook).length >= 3);
});

test("every template builds a valid, tidy, bilingual board within limits", () => {
  for (const def of TEMPLATE_CATALOG) {
    const en = fromTemplate(def.id, "en"),
      fr = fromTemplate(def.id, "fr");
    for (const [b, n] of [
      [en, 0],
      [fr, 1],
    ]) {
      assert.equal(validateBoard(b), b, def.id);
      assert.equal(b.title, def.name[n]);
      assert.ok(b.items.length >= 8 && b.items.length <= 400, def.id);
      const box = bounds(b.items);
      assert.ok(box.w <= 8000 && box.h <= 8000, `${def.id} size`);
      for (const s of boardText(b)) assert.doesNotMatch(s, dashes, def.id);
      for (const i of b.items)
        assert.ok(i.fontSize == null || i.fontSize >= 12, def.id);
    }
    assert.equal(en.items.length, fr.items.length, def.id);
    assert.notDeepEqual(boardText(en), boardText(fr), `${def.id} French`);
    const frames = en.items.filter((i) => i.type === "frame");
    if (def.id !== "mindmap") {
      assert.ok(frames.length, `${def.id} has frames`);
      assert.ok(
        en.items.some((i) => i.parentId),
        `${def.id} content in frames`,
      );
    } else assert.ok(en.items.filter((i) => i.mindMap).length >= 10);
    assert.equal(
      new Set(frames.map((f) => f.order)).size,
      frames.length,
      `${def.id} frame order`,
    );
    for (const f of frames) assert.ok(Number.isFinite(f.order), def.id);
    for (let a = 0; a < frames.length; a++)
      for (let c = a + 1; c < frames.length; c++) {
        const p = frames[a],
          q = frames[c];
        assert.ok(
          p.x >= q.x + q.w ||
            q.x >= p.x + p.w ||
            p.y >= q.y + q.h ||
            q.y >= p.y + p.h,
          `${def.id}: ${p.text} overlaps ${q.text}`,
        );
      }
  }
});

test("playbooks walk through ordered, timed facilitation steps", () => {
  for (const def of TEMPLATE_CATALOG.filter((d) => d.playbook))
    for (const lang of ["en", "fr"]) {
      const b = fromTemplate(def.id, lang),
        frames = orderedFrames(b.items);
      assert.ok(frames.length >= 4, def.id);
      for (const f of frames) {
        const members = frameItems(b.items, f.id);
        assert.ok(
          /\d+\s*min/.test(f.text) ||
            b.items.some(
              (i) => members.has(i.id) && /\d+\s*min/.test(i.text || ""),
            ),
          `${def.id}: ${f.text} has a duration`,
        );
      }
    }
});

test("presentation and onboarding templates are decks of 16:9 slides", () => {
  for (const id of ["presentation-deck", "team-onboarding"])
    for (const lang of ["en", "fr"]) {
      const b = fromTemplate(id, lang),
        slides = orderedFrames(b.items);
      assert.equal(slides.length, 6, `${id} ${lang}`);
      for (const [n, f] of slides.entries()) {
        assert.deepEqual([f.w, f.h], [1280, 720], `${id} ${lang} ${f.text}`);
        // Presenting leaves the frame title out, so each slide has a heading.
        const members = frameItems(b.items, f.id);
        assert.ok(
          b.items.some((i) => members.has(i.id) && i.type === "text" && i.bold),
          `${id} ${lang}: slide ${n + 1} has a heading`,
        );
        // Slides read left to right, then down.
        if (n)
          assert.ok(
            f.y > slides[n - 1].y ||
              (f.y === slides[n - 1].y && f.x > slides[n - 1].x),
          );
      }
    }
  for (const [query, id] of [
    ["slides", "presentation-deck"],
    ["présentation", "presentation-deck"],
    ["onboarding", "team-onboarding"],
    ["nouvel employé", "team-onboarding"],
  ])
    assert.ok(
      searchTemplates(query).some((d) => d.id === id),
      `${query} finds ${id}`,
    );
});

test("template search matches names, descriptions and categories in both languages", () => {
  const ids = (query, category) =>
    searchTemplates(query, category).map((d) => d.id);
  assert.equal(ids("").length, TEMPLATE_CATALOG.length);
  assert.ok(ids("retrospective").includes("retro-4ls"));
  assert.ok(ids("rétrospective").includes("retro-4ls"));
  assert.ok(ids("retrospective").includes("playbook-retro"));
  assert.ok(ids("gantt").includes("gantt"));
  assert.ok(ids("parcours client").includes("journey"));
  assert.ok(ids("plan de service").includes("service"));
  assert.ok(ids("Ishikawa").includes("fishbone"));
  assert.ok(ids("diagramme d'Ishikawa").includes("fishbone"));
  assert.ok(ids("carte d'empathie").includes("empathy-map"));
  assert.ok(ids("conception de services").includes("ecosystem-map"));
  assert.ok(ids("service design").includes("stakeholder-map"));
  assert.ok(ids("MAQUETTE").includes("wireframe-desktop"));
  // Design-thinking terms find the templates for each stage.
  for (const query of ["design thinking", "pensée design"])
    for (const id of [
      "design-thinking",
      "empathy-map",
      "crazy-8s",
      "wireframe",
      "usability-synthesis",
    ])
      assert.ok(ids(query).includes(id), `${query}: ${id}`);
  assert.deepEqual(ids("double diamond"), ["playbook-discovery"]);
  for (const query of ["digital transformation", "transformation numérique"])
    for (const id of ["service", "journey", "roadmap-quarterly"])
      assert.ok(ids(query).includes(id), `${query}: ${id}`);
  assert.deepEqual(ids("board scrum"), ids("scrum board"));
  // Plurals, run-together and hyphenated spellings find the same templates.
  for (const [query, id] of [
    ["retrospectives", "retro-4ls"],
    ["rétrospectives", "retro-4ls"],
    ["roadmaps", "roadmap-quarterly"],
    ["wireframes", "wireframe"],
    ["journey maps", "journey"],
    ["kanban boards", "kanban"],
    ["cartes mentales", "mindmap"],
    ["mindmap", "mindmap"],
    ["mind-map", "mindmap"],
    ["kickoff", "project-kickoff"],
    ["user stories", "user-story-map"],
    ["activities", "logic-model"],
  ])
    assert.ok(ids(query).includes(id), `${query}: ${id}`);
  // Templates named by the query come first; short words match whole
  // words only.
  assert.equal(ids("retrospective")[0], "retro");
  assert.equal(ids("map")[0], "user-story-map");
  assert.deepEqual(ids("PI planning"), []);
  assert.equal(ids("zzz no match").length, 0);
  const agile = searchTemplates("", "agile");
  assert.ok(agile.length >= 8);
  assert.ok(agile.every((d) => d.categoryId === "agile"));
  assert.ok(ids("canvas", "strategy").includes("lean-canvas"));
  assert.ok(ids("canvas", "strategy").includes("business-model-canvas"));
  assert.ok(
    searchTemplates("canvas", "strategy").every(
      (d) => d.categoryId === "strategy",
    ),
  );
});

test("shape families list every specialist shape with bilingual search", () => {
  const listed = new Set(
    SHAPE_FAMILIES.flatMap((f) => f.shapes.map((s) => s.key)),
  );
  for (const s of SHAPES) assert.ok(listed.has(s.key), s.key);
  const keys = (query, family) =>
    searchShapes(query, family).flatMap((f) => f.shapes.map((s) => s.key));
  assert.ok(keys("gateway").includes("gateway-parallel"));
  assert.ok(keys("passerelle").includes("gateway-parallel"));
  assert.ok(keys("pare-feu").includes("firewall"));
  assert.ok(keys("bouton").includes("wf-button"));
  assert.ok(keys("point de friction").includes("pain-point"));
  assert.ok(keys("", "wireframe").includes("browser"));
  assert.ok(keys("", "bpmn").every((k) => k !== "browser"));
  assert.equal(keys("no such shape").length, 0);
  assert.deepEqual(
    searchShapes("", "", true)[0].shapes.map((s) => s.key),
    ["note", "text"],
  );
  for (const s of SHAPES) {
    const svg = shapePreview(s.key);
    assert.match(svg, /^<svg [^>]*viewBox/, s.key);
    assert.match(svg, /<(path|rect|ellipse|polygon)/, s.key);
  }
});

test("template objects sit inside the frames they belong to", () => {
  for (const def of TEMPLATE_CATALOG)
    for (const lang of ["en", "fr"]) {
      const b = fromTemplate(def.id, lang);
      const byId = new Map(b.items.map((i) => [i.id, i]));
      for (const i of b.items) {
        const f = byId.get(i.parentId);
        if (!f || i.type === "arrow") continue;
        const box = bounds([i]);
        assert.ok(
          box.x >= f.x - 1 &&
            box.y >= f.y - 1 &&
            box.x + box.w <= f.x + f.w + 1 &&
            box.y + box.h <= f.y + f.h + 1,
          `${def.id}/${lang}: "${i.text || i.type}" leaves its frame`,
        );
      }
    }
});

test("journey map feelings are readable labels grouped with their faces", () => {
  for (const lang of ["en", "fr"]) {
    const b = fromTemplate("journey", lang);
    const faces = b.items.filter((i) => i.shape?.startsWith("emotion-"));
    assert.equal(faces.length, 5);
    for (const face of faces) {
      assert.equal(face.text, "");
      const label = b.items.find(
        (i) => i.type === "text" && i.groupId && i.groupId === face.groupId,
      );
      assert.ok(label?.text, `${lang}: a label for ${face.shape}`);
      assert.equal(label.fontSize, 16);
    }
  }
});

test("template text on light shapes stays dark in the dark theme", () => {
  const light = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return (
      (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 >
      0.6
    );
  };
  for (const def of TEMPLATE_CATALOG)
    for (const lang of ["en", "fr"]) {
      const items = fromTemplate(def.id, lang).items;
      const fills = items.filter(
        (i) =>
          ["rect", "ellipse", "note", "table"].includes(i.type) &&
          light(i.color || "#000000"),
      );
      for (const i of items.filter(
        (i) => i.type === "text" && i.text && !i.textColor,
      )) {
        const x = i.x + Math.min(i.w, 40) / 2,
          y = i.y + i.h / 2;
        assert.ok(
          !fills.some(
            (f) =>
              items.indexOf(f) < items.indexOf(i) &&
              x >= f.x &&
              x <= f.x + f.w &&
              y >= f.y &&
              y <= f.y + f.h,
          ),
          `${def.id} ${lang}: ${i.text}`,
        );
      }
    }
});

test("template lines stay visible on the light and the dark theme's board", () => {
  const luminance = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) =>
      v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [x, y] = [luminance(a) + 0.05, luminance(b) + 0.05];
    return Math.max(x, y) / Math.min(x, y);
  };
  // WCAG asks 3:1 for graphics; the boards are #f3f4f6 and #19212d. Light
  // grey dividers are decorative on the light board.
  for (const def of TEMPLATE_CATALOG)
    for (const i of fromTemplate(def.id, "en").items)
      if (i.type === "arrow")
        for (const board of ["#f3f4f6", "#19212d"])
          if (board === "#19212d" || i.color !== "#a2aaa0")
            assert.ok(
              contrast(i.color, board) >= 3,
              `${def.id}: ${i.color} on ${board}`,
            );
});

test("icons stay visible on the light and the dark theme's board", () => {
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((v) =>
      v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const rgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  };
  const contrast = (a, b) => {
    const [x, y] = [luminance(a) + 0.05, luminance(b) + 0.05];
    return Math.max(x, y) / Math.min(x, y);
  };
  const size = 96,
    opaque = (data, x, y) =>
      x >= 0 &&
      y >= 0 &&
      x < size &&
      y < size &&
      data[(y * size + x) * 4 + 3] > 128;
  // The pixels of an icon image placed on a board of the given color.
  const onBoard = (icon, board) => {
    const canvas = createCanvas(size, size),
      ctx = canvas.getContext("2d");
    ctx.fillStyle = board;
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(icon, 0, 0);
    return ctx.getImageData(0, 0, size, size).data;
  };
  // Where the icon meets the board: the edge of what it draws.
  const edge = (data, x, y) =>
    opaque(data, x, y) &&
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dy]) => !opaque(data, x + dx, y + dy));
  for (const id of ["users", "circle-check", "lightbulb"]) {
    const entry = ICONS.find((i) => i.id === id);
    for (const { value } of ICON_COLORS) {
      const icon = renderIcon(entry, { color: value, size, createCanvas });
      // On the light board, #f3f4f6, the icon looks exactly like its
      // strokes alone always have.
      const plain = createCanvas(size, size);
      drawIconNode(plain.getContext("2d"), entry.node, {
        x: 4,
        y: 4,
        size: 88,
        color: value,
      });
      const now = onBoard(icon, "#f3f4f6"),
        before = onBoard(plain, "#f3f4f6");
      assert.ok(
        now.every((v, n) => Math.abs(v - before[n]) <= 2),
        `${id} ${value} on the light board`,
      );
      // On the dark board, #19212d, where the icon meets the board reaches
      // the 3:1 WCAG asks for graphics.
      const alpha = icon.getContext("2d").getImageData(0, 0, size, size).data,
        dark = onBoard(icon, "#19212d");
      let edges = 0,
        seen = 0;
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++)
          if (edge(alpha, x, y)) {
            edges++;
            const n = (y * size + x) * 4;
            if (contrast([...dark.slice(n, n + 3)], rgb("#19212d")) >= 3)
              seen++;
          }
      assert.ok(
        edges && seen / edges > 0.95,
        `${id} ${value} on the dark board`,
      );
    }
  }
});

test("component text on the bare board stays readable in the dark theme", () => {
  const luminance = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) =>
      v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  // The dark theme's board is #19212d.
  const onDarkBoard = (hex) =>
    (luminance(hex) + 0.05) / (luminance("#19212d") + 0.05);
  for (const c of COMPONENTS) {
    const items = componentItems(c.id, "en");
    const shapes = [];
    for (const i of items)
      if (["rect", "ellipse", "note", "table"].includes(i.type)) shapes.push(i);
      else if (i.type === "text" && i.textColor) {
        const x = i.x + Math.min(i.w, 40) / 2,
          y = i.y + i.h / 2;
        if (
          !shapes.some(
            (f) => x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h,
          )
        )
          assert.ok(onDarkBoard(i.textColor) >= 4.5, `${c.id}: ${i.text}`);
      }
  }
  const [label] = componentItems("web-text-field", "en");
  assert.equal(label.text, "Full name");
  assert.equal(label.textColor, undefined);
});

test("auto-fitted template labels stay at 12px or more", async () => {
  const { fitTextLayout, canAutoFitText } = await import("../src/text.js");
  const ctx = createCanvas(10, 10).getContext("2d");
  for (const def of TEMPLATE_CATALOG)
    for (const lang of ["en", "fr"])
      for (const i of fromTemplate(def.id, lang).items)
        if (i.autoFontSize && i.text && canAutoFitText(i))
          assert.ok(
            fitTextLayout(i, ctx, i.text).style.size >= 12,
            `${def.id} ${lang}: ${i.text}`,
          );
});

test("template frame titles clear the content below them in both languages", async () => {
  const { textStyle, cachedWrapText, autoHeightLayout, growsWithText } =
    await import("../src/text.js");
  const ctx = createCanvas(10, 10).getContext("2d");
  const overlaps = [];
  for (const def of TEMPLATE_CATALOG)
    for (const lang of ["en", "fr"]) {
      const items = fromTemplate(def.id, lang).items;
      for (const f of items.filter((i) => i.type === "frame" && i.text)) {
        const style = textStyle(f);
        ctx.font = style.font;
        const lines = cachedWrapText(
          ctx,
          f.text,
          Math.max(20, f.w - style.padding * 2),
        );
        const title = {
          x: f.x + style.padding,
          y: f.y + style.padding,
          w: Math.max(...lines.map((l) => ctx.measureText(l).width)),
          h: lines.length * style.size * 1.35,
        };
        for (const i of items) {
          // An ellipse's box corner is empty, so a title may sit there.
          if (i === f || ["arrow", "frame", "ellipse"].includes(i.type))
            continue;
          const h = growsWithText(i) ? autoHeightLayout(i, ctx).height : i.h;
          const box = {
            x: Math.min(i.x, i.x + i.w),
            y: i.y,
            w: Math.abs(i.w),
            h,
          };
          if (
            box.x < title.x + title.w - 1 &&
            title.x < box.x + box.w - 1 &&
            box.y < title.y + title.h - 1 &&
            title.y < box.y + box.h - 1
          )
            overlaps.push(`${def.id} ${lang}: ${f.text}`);
        }
      }
    }
  assert.deepEqual(overlaps, []);
});

test("labelled connectors in templates keep their line and arrowhead in view", async () => {
  // Labels are measured with canvas text, as on the board.
  const previous = globalThis.document;
  globalThis.document ??= {
    documentElement: {},
    createElement: () => createCanvas(10, 10),
  };
  try {
    const { connectorLabel, connectorPath } =
      await import("../src/connectors.js");
    for (const def of TEMPLATE_CATALOG)
      for (const lang of ["en", "fr"])
        for (const a of fromTemplate(def.id, lang).items) {
          if (a.type !== "arrow" || !a.text) continue;
          // The label box is drawn over the line; enough of the line and
          // the arrowhead stay outside it to read the direction.
          const L = connectorLabel(a),
            points = connectorPath(a);
          const inside = (p, pad = 0) =>
            p.x >= L.x - pad &&
            p.x <= L.x + L.w + pad &&
            p.y >= L.y - pad &&
            p.y <= L.y + L.h + pad;
          let visible = 0;
          for (let s = 1; s < points.length; s++) {
            const p = points[s - 1],
              q = points[s],
              length = Math.hypot(q.x - p.x, q.y - p.y),
              steps = Math.max(1, Math.ceil(length));
            for (let k = 0; k < steps; k++) {
              const f = (k + 0.5) / steps,
                x = p.x + (q.x - p.x) * f,
                y = p.y + (q.y - p.y) * f;
              if (!inside({ x, y })) visible += length / steps;
            }
          }
          const where = `${def.id} ${lang} ${a.text}`;
          assert.ok(visible >= 30, where);
          assert.ok(!inside(points.at(-1), 12), where);
        }
  } finally {
    if (previous === undefined) delete globalThis.document;
  }
});

test("Gantt arrows keep to their own paths and pass no other bar", async () => {
  const { connectorPath } = await import("../src/connectors.js");
  const items = fromTemplate("gantt", "en").items;
  const bars = items.filter((i) => i.type === "rect" && i.task);
  const arrows = items.filter((i) => i.type === "arrow" && i.startId);
  const verticals = [];
  for (const a of arrows) {
    const path = connectorPath(a);
    for (let n = 1; n < path.length; n++) {
      const [p, q] = [path[n - 1], path[n]];
      // Sampled points along each segment stay out of bars they do not join.
      for (let f = 0.05; f < 1; f += 0.05) {
        const x = p.x + (q.x - p.x) * f,
          y = p.y + (q.y - p.y) * f;
        for (const b of bars)
          if (b.id !== a.startId && b.id !== a.endId)
            assert.ok(
              !(x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h),
              `An arrow crosses ${b.text}`,
            );
      }
      if (p.x === q.x && p.y !== q.y)
        verticals.push({
          x: p.x,
          lo: Math.min(p.y, q.y),
          hi: Math.max(p.y, q.y),
        });
    }
  }
  for (const [n, v] of verticals.entries())
    for (const w of verticals.slice(n + 1))
      assert.ok(
        Math.abs(v.x - w.x) > 4 || v.hi <= w.lo || w.hi <= v.lo,
        `Two arrows share the line at x=${v.x}`,
      );
});

test("template arrows and lines pass no text label in either language", async () => {
  const { connectorPath } = await import("../src/connectors.js");
  const { autoHeightLayout, textStyle } = await import("../src/text.js");
  const ctx = createCanvas(10, 10).getContext("2d");
  const crossed = [];
  for (const def of TEMPLATE_CATALOG)
    for (const lang of ["en", "fr"]) {
      const items = fromTemplate(def.id, lang).items;
      // Each line of a label, where its letters are drawn. Turned labels,
      // such as an axis name, run along their line.
      const lines = items
        .filter((i) => i.type === "text" && i.text && !i.rotation)
        .flatMap((i) => {
          const layout = autoHeightLayout(i, ctx),
            style = textStyle(i),
            size = style.size * 1.35;
          ctx.font = style.font;
          return layout.lines.map((line, n) => {
            const w = ctx.measureText(line).width,
              x =
                style.align === "center"
                  ? i.x + (i.w - w) / 2
                  : style.align === "right"
                    ? i.x + i.w - style.padding - w
                    : i.x + style.padding;
            return { i, x, y: i.y + style.padding + n * size, w, h: size };
          });
        });
      for (const a of items.filter((i) => i.type === "arrow")) {
        const path = connectorPath(a);
        for (let n = 1; n < path.length; n++) {
          const [p, q] = [path[n - 1], path[n]],
            steps = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 4);
          for (let k = 0; k <= steps; k++) {
            const x = p.x + ((q.x - p.x) * k) / steps,
              y = p.y + ((q.y - p.y) * k) / steps;
            for (const b of lines)
              if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h)
                crossed.push(`${def.id} ${lang}: ${b.i.text}`);
          }
        }
      }
    }
  assert.deepEqual([...new Set(crossed)], []);
});

test("tab bar labels sit under their own tabs in both languages", () => {
  for (const lang of ["en", "fr"])
    for (const items of [
      componentItems("wf-tab-bar", lang),
      fromTemplate("wireframe", lang).items,
    ])
      for (const bar of items.filter((i) => i.shape === "wf-tabbar")) {
        // The bar draws four tabs, evenly spaced; each has one label below.
        const labels = items.filter(
          (i) =>
            i.type === "text" &&
            i.x >= bar.x &&
            i.x + i.w <= bar.x + bar.w &&
            i.y >= bar.y + bar.h / 2 &&
            i.y < bar.y + bar.h,
        );
        assert.equal(labels.length, 4, lang);
        labels.forEach((label, n) =>
          assert.equal(
            label.x + label.w / 2,
            bar.x + (bar.w * (n + 0.5)) / 4,
            `${lang}: ${label.text}`,
          ),
        );
        assert.equal(bar.text, "", lang);
      }
});

test("template and component table cells keep every word whole", async () => {
  const { wrapText } = await import("../src/text.js");
  const { tableLayout } = await import("../src/table-layout.js");
  const { fontStack, fontFamily } = await import("../src/fonts.js");
  const ctx = createCanvas(10, 10).getContext("2d");
  const broken = [];
  for (const lang of ["en", "fr"])
    for (const [name, items] of [
      ...TEMPLATE_CATALOG.map((d) => [d.id, fromTemplate(d.id, lang).items]),
      ...COMPONENTS.map((c) => [c.id, componentItems(c.id, lang)]),
    ])
      for (const i of items.filter((i) => i.type === "table")) {
        // Cells wrap as the board draws them.
        const layout = tableLayout(i);
        ctx.font = `400 ${i.fontSize || 15}px ${fontStack(fontFamily(i))}`;
        i.cells.forEach((row) =>
          row.forEach((text, c) => {
            const words = new Set(text.split(/\s+/));
            for (const line of wrapText(ctx, text, layout.columns[c] - 18))
              for (const piece of line.split(/\s+/))
                if (piece && !words.has(piece))
                  broken.push(`${name} ${lang}: ${text}`);
          }),
        );
      }
  assert.deepEqual([...new Set(broken)], []);
});

test("icon and sticker descriptions keep the language actually used by the library formatter", () => {
  for (const entry of [
    ICONS.find((i) => i.id === "user-plus"),
    STICKERS.find((i) => i.id === "sticker-plus-one"),
  ]) {
    for (const [requested, expected, index] of [
      [undefined, "en", 0],
      ["en", "en", 0],
      ["fr", "fr", 1],
      ["fr-CA", "en", 0],
      [[], "en", 0],
    ]) {
      const i = iconItem(entry, 0, 0, { lang: requested, createCanvas });
      assert.equal(i.lang, expected);
      assert.equal(i.text, entry.name[index]);
      assert.equal(i.alt, entry.name[index]);
      validateBoard({ ...board(), items: [i] });
      const dom = new JSDOM(
        `<body lang="${expected === "en" ? "fr" : "en"}">${objectNameHTML(i)}</body>`,
      );
      try {
        assert.equal(
          dom.window.document.querySelector(`[lang="${expected}"]`).textContent,
          i.alt,
        );
        const restored = JSON.parse(JSON.stringify(i));
        assert.equal(restored.lang, expected);
        assert.equal(objectNameHTML(restored), objectNameHTML(i));
      } finally {
        dom.window.close();
      }
    }
  }
});

test("labels in template and component circles and short boxes are centred", () => {
  const builds = [
    ...TEMPLATE_CATALOG.map((d) => [d.id, fromTemplate(d.id, "en").items]),
    ...COMPONENTS.map((c) => [c.id, componentItems(c.id, "en")]),
  ];
  for (const [id, items] of builds)
    for (const i of items)
      if (i.type === "ellipse" && i.text)
        assert.equal(i.textAlign, "center", `${id}: ${i.text}`);
  const anchors = fromTemplate("retro-sailboat", "en").items.find(
    (i) => i.text === "Anchors",
  );
  assert.equal(anchors.textValign, "middle");
});

test("no template line passes through another connector's label", async () => {
  const { connectorPath, connectorLabel } =
    await import("../src/connectors.js");
  // Labels are measured with the bundled fonts, as the board draws them.
  const stub = !globalThis.document;
  if (stub) globalThis.document = { createElement: () => createCanvas(10, 10) };
  const crossed = [];
  // Whether a segment passes through a box, shrunk a little at its edges.
  const hits = (p, q, b) => {
    const box = { x: b.x + 4, y: b.y + 4, w: b.w - 8, h: b.h - 8 };
    for (let n = 0; n <= 40; n++) {
      const x = p.x + ((q.x - p.x) * n) / 40,
        y = p.y + ((q.y - p.y) * n) / 40;
      if (x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h)
        return true;
    }
    return false;
  };
  for (const def of TEMPLATE_CATALOG)
    for (const lang of ["en", "fr"]) {
      const arrows = fromTemplate(def.id, lang).items.filter(
        (i) => i.type === "arrow",
      );
      const labels = arrows
        .filter((i) => i.text)
        .map((i) => [i, connectorLabel(i)])
        .filter(([, box]) => box);
      for (const line of arrows) {
        const path = connectorPath(line);
        for (const [owner, box] of labels) {
          if (owner === line) continue;
          for (let n = 1; n < path.length; n++)
            if (hits(path[n - 1], path[n], box)) {
              crossed.push(`${def.id} ${lang}: ${owner.text}`);
              break;
            }
        }
      }
    }
  if (stub) delete globalThis.document;
  assert.deepEqual(crossed, []);
});

test("French guillemets and colons stay with their words", () => {
  const texts = [
    ...TEMPLATE_CATALOG.flatMap((d) => boardText(fromTemplate(d.id, "fr"))),
    ...COMPONENTS.flatMap((c) =>
      componentItems(c.id, "fr").flatMap((i) => [
        i.text || "",
        ...(i.cells?.flat() || []),
      ]),
    ),
  ];
  const loose = texts.filter((s) => /« | »| :/.test(s));
  assert.deepEqual(loose, []);
  assert.ok(texts.some((s) => s.includes("« ")));
  assert.ok(texts.some((s) => s.includes(" :")));
});

test("the French 4Ls retrospective names its columns in plain French", () => {
  const frames = fromTemplate("retro-4ls", "fr")
    .items.filter((i) => i.type === "frame")
    .map((f) => f.text);
  for (const name of ["Aimé", "Appris", "Manqué", "Souhaité"])
    assert.ok(
      frames.some((f) => f.includes(name)),
      `${name}: ${frames.join(" | ")}`,
    );
  assert.ok(!frames.some((f) => f.includes("Aspiré")));
});

test("sprint planning capacity adds up and reflects planned absences", () => {
  const table = fromTemplate("sprint-planning", "en").items.find(
    (i) => i.type === "table" && i.cells[0][0] === "Person",
  );
  const rows = table.cells.slice(1, -1),
    total = table.cells.at(-1);
  const sum = (col) => rows.reduce((n, r) => n + Number(r[col]), 0);
  assert.equal(String(sum(2)), total[2]);
  assert.equal(String(sum(3)), total[3]);
  // The notes say Léa is off for a day of the ten-day sprint.
  assert.equal(rows.find((r) => r[0] === "Léa")[2], "9");
});

test("French components write clock times the French way", () => {
  for (const id of ["agenda-card", "wf-comments"]) {
    const text = componentItems(id, "fr")
      .flatMap((i) => [i.text || "", ...(i.cells?.flat() || [])])
      .join(" | ");
    assert.doesNotMatch(text, /\d:\d\d/, id);
    assert.match(text, /\d+ h \d\d|\d+ h\b/, id);
    assert.match(
      componentItems(id, "en")
        .flatMap((i) => [i.text || "", ...(i.cells?.flat() || [])])
        .join(" "),
      /\d+:\d\d/,
      id,
    );
  }
});

test("service design and delivery kits offer reusable models in both languages", () => {
  const kit = COMPONENTS.filter((c) => c.group === "delivery").map((c) => c.id);
  for (const id of [
    "persona-card",
    "journey-stage",
    "user-story-card",
    "definition-of-done",
    "double-diamond",
    "hypothesis-card",
    "working-agreement",
  ])
    assert.ok(kit.includes(id), id);
  const found = (query) => searchComponents(query).map((c) => c.id);
  assert.ok(found("double diamant").includes("double-diamond"));
  assert.ok(found("personas").includes("persona-card"));
  assert.ok(found("définition de terminé").includes("definition-of-done"));
  assert.ok(found("user stories").includes("user-story-card"));
  assert.deepEqual(
    searchComponents("", "delivery").map((c) => c.id),
    kit,
  );
});
