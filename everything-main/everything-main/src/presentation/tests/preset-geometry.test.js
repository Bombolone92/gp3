import { describe, expect, it } from "vitest";
import { NS, parseXml } from "../lib/pptx/src/internal/xml/index.ts";
import { parsePresetGeometry } from "../lib/pptx/src/internal/drawingml/preset-geometry.ts";
import { PRESET_DEFINITIONS } from "../lib/pptx/src/internal/drawingml/preset-definitions.ts";
import { P, createDeck, parseDeck, textEditorRectangle } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { resolveTextRectangle } from "../lib/pptx-preview/src/render-slide.ts";
import { createGeometryDeck, presetGeometry } from "./geometry-fixture.js";
import { presetGeometryFixture } from "./preset-geometry-fixture.js";
import { strFromU8, unzipSync } from "fflate";
import native from "./data/preset-geometry-native.json";
import { resolveGeometryArc } from "../lib/pptx/src/internal/drawingml/geometry-arc.ts";

const av = (s) => parseXml(`<a:avLst xmlns:a="${NS.dml}">${s}</a:avLst>`).root;
const resolve = (name, w, h, s = "") => parsePresetGeometry(name, w, h, av(s));
const svg = (p) => renderSlideToSvg(p, P.getSlides(p)[0]);
const authored = (bytes, p) =>
  strFromU8(
    unzipSync(bytes)[P.getSlidePartName(P.getSlides(p).at(-1)).slice(1)],
  ).match(/<a:prstGeom\b[\s\S]*?<\/a:prstGeom>/g);

describe("canonical DrawingML presets", () => {
  it.each(native.shapes)(
    "matches measured native reference stroke coordinates: $preset",
    ({ preset, commands }) => {
      const geometry = resolve(preset, native.width, native.height);
      let i = 0;
      for (const path of geometry.paths.filter((p) => p.stroke)) {
        const sx = path.w === null ? 1 : native.width / path.w;
        const sy = path.h === null ? 1 : native.height / path.h;
        let pen = { x: 0, y: 0 },
          start = pen;
        const difference = (expected, actual) =>
          Math.max(...expected.map((v, j) => Math.abs(v - actual[j])));
        for (const command of path.commands) {
          if (command.kind === "close") {
            expect(commands[i++][0]).toBe("h");
            pen = start;
            continue;
          }
          let end, kind, controls;
          if (command.kind === "arcTo") {
            end =
              resolveGeometryArc(
                pen.x,
                pen.y,
                command.wR,
                command.hR,
                command.stAng,
                command.swAng,
              ).at(-1)?.end ?? pen;
            kind = "c";
          } else if (command.kind === "moveTo" || command.kind === "lnTo") {
            end = command.pt;
            kind = command.kind === "moveTo" ? "m" : "l";
          } else {
            end = command.pts.at(-1);
            kind = "c";
            controls =
              command.kind === "cubicBezTo"
                ? command.pts
                : [
                    {
                      x: pen.x + (2 / 3) * (command.pts[0].x - pen.x),
                      y: pen.y + (2 / 3) * (command.pts[0].y - pen.y),
                    },
                    {
                      x: end.x + (2 / 3) * (command.pts[0].x - end.x),
                      y: end.y + (2 / 3) * (command.pts[0].y - end.y),
                    },
                    end,
                  ];
          }
          const expected = [end.x * sx, end.y * sy];
          if (command.kind === "arcTo")
            while (
              commands[i]?.[0] === "c" &&
              difference(expected, commands[i][1].slice(-2)) > 4
            )
              i++;
          expect(commands[i]?.[0]).toBe(kind);
          expect(
            difference(expected, commands[i][1].slice(-2)),
          ).toBeLessThanOrEqual(4);
          if (controls)
            expect(
              difference(
                controls.flatMap((pt) => [pt.x * sx, pt.y * sy]),
                commands[i][1],
              ),
            ).toBeLessThanOrEqual(4);
          i++;
          pen = end;
          if (command.kind === "moveTo") start = pen;
        }
      }
      expect(i).toBe(commands.length);
    },
  );
  it.each(Object.keys(PRESET_DEFINITIONS))(
    "evaluates %s at varied and degenerate extents",
    (name) => {
      for (const [w, h] of [
        [914400, 914400],
        [4389120, 457200],
        [457200, 4389120],
        [9531, 19123],
        [0, 914400],
        [914400, 0],
        [0, 0],
        [1e10, 1e6],
      ]) {
        const geom = resolve(name, w, h);
        expect(geom).not.toBeNull();
        expect(geom.paths.length).toBeGreaterThan(0);
        const finite = (v) => {
          if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
          else if (v && typeof v === "object") Object.values(v).forEach(finite);
        };
        finite(geom);
        expect(geom.textRect).not.toBeNull();
      }
      const p = createDeck("blank"),
        slide = P.getSlides(p)[0];
      const sh = P.addSlideShape(slide, {
        x: P.inches(0.5),
        y: P.inches(0.25),
        w: P.inches(4.8),
        h: P.inches(0.5),
        preset: name,
      });
      for (const [w, h] of [
        [P.inches(4.8), P.inches(0.5)],
        [P.inches(0.5), P.inches(4.8)],
      ]) {
        P.setShapeSize(sh, w, h);
        const output = svg(p);
        expect(output).not.toMatch(/data-pptx-preset|NaN|Infinity/);
        expect(parseXml(output).root.name.localName).toBe("svg");
      }
    },
  );
  it("resolves default adjustments before authored formulas and dependent guides", () => {
    const g = resolve(
      "rightArrow",
      8000000,
      2000000,
      '<a:gd name="adj1" fmla="val 25000"/><a:gd name="adj2" fmla="*/ 50000 3 2"/>',
    );
    expect(
      g.paths[0].commands.filter((c) => c.kind === "lnTo").map((c) => c.pt),
    ).toContainEqual({ x: 6500000, y: 750000 });
    expect(g.textRect).toEqual({ l: 0, t: 750000, r: 7625000, b: 1250000 });
    expect(
      resolve(
        "rightArrow",
        8000000,
        2000000,
        '<a:gd name="adj2" fmla="val 9999999"/>',
      ),
    ).toEqual(
      resolve(
        "rightArrow",
        8000000,
        2000000,
        '<a:gd name="adj2" fmla="val 400000"/>',
      ),
    );
  });
  it("resolves the right triangle's wd12 and shape-coordinate text rectangle", () => {
    expect(resolve("rtTriangle", 1200000, 1200000).textRect).toEqual({
      l: 100000,
      t: 700000,
      r: 700000,
      b: 1100000,
    });
  });
  it("reports malformed adjustments and unknown names without a substituted known geometry", () => {
    expect(
      resolve("rightArrow", 800, 200, '<a:gd name="adj1" fmla="val missing"/>'),
    ).toBeNull();
    for (const name of ["unknownPreset", "constructor", "__proto__"])
      expect(resolve(name, 800, 200)).toBeNull();
    const p = createDeck("blank"),
      s = P.getSlides(p)[0];
    P.addSlideShape(s, {
      x: 0,
      y: 0,
      w: P.inches(2),
      h: P.inches(1),
      preset: "unknownPreset",
    });
    expect(svg(p)).toContain('data-pptx-preset="unknownPreset"');
  });
  it("retains the renderer's legacy oval and card names using standard geometry", () => {
    expect(resolve("oval", 2400000, 1800000)).toEqual(
      resolve("ellipse", 2400000, 1800000),
    );
    expect(resolve("flowChartCard", 2400000, 1800000)).toEqual(
      resolve("flowChartPunchedCard", 2400000, 1800000),
    );
  });
  it("keeps evaluations independent when dimensions, adjustments or returned values change", () => {
    const first = resolve("diamond", 1200, 900);
    first.paths[0].commands[0].pt.x = -1;
    expect(resolve("diamond", 1200, 900).paths[0].commands[0].pt.x).toBe(0);
    expect(resolve("diamond", 2400, 1800).textRect).toEqual({
      l: 600,
      t: 450,
      r: 1800,
      b: 1350,
    });
  });
  it("uses evaluated paths rather than a primitive when an authored guide shadows a built-in", async () => {
    const p = await parseDeck(
      await createGeometryDeck({
        level: "local",
        geometry: presetGeometry("rect", '<a:gd name="r" fmla="val 960000"/>'),
      }),
    );
    const output = svg(p);
    expect(output).toContain("<clipPath");
    expect(output).toContain("L196.79,96.00");
    expect(output).not.toContain('data-pptx-preset="rect"');
  });
  it.each(["local", "layout", "master"])(
    "uses inherited %s geometry at instance and layout candidate extents",
    async (level) => {
      const p = await parseDeck(
        await createGeometryDeck({
          geometry: presetGeometry("diamond"),
          level,
          shapeKind: "shape",
        }),
      );
      const sh = P.getSlideShapes(P.getSlides(p)[0])[0],
        b = P.getShapeBoundsResolved(p, sh);
      expect(P.getShapeGeometryEffective(p, sh)).toEqual({
        kind: "preset",
        preset: "diamond",
        adjustments: {},
      });
      const g = P.getShapeGeometryResolved(p, sh);
      expect(g.geometry.textRect).toEqual({
        l: b.w / 4,
        t: b.h / 4,
        r: (3 * b.w) / 4,
        b: (3 * b.h) / 4,
      });
      expect(
        P.getShapeGeometryResolved(p, sh, { w: 1200, h: 900 }).geometry
          .textRect,
      ).toEqual({ l: 300, t: 225, r: 900, b: 675 });
      expect(svg(p)).not.toContain('data-pptx-preset="diamond"');
    },
  );
  it("shares adjustment-dependent text bounds with the inline editor", async () => {
    const p = await parseDeck(await presetGeometryFixture()),
      shapes = P.getSlideShapes(P.getSlides(p)[0]);
    for (const sh of shapes) {
      const b = P.getShapeBoundsResolved(p, sh),
        rect = resolveTextRectangle(p, sh, b);
      expect(rect.hasGeometryRect).toBe(true);
      expect(textEditorRectangle(p, sh)).toMatchObject(rect.inner);
    }
  });
  it("retains raw preset formulas through edits, export and transfer in both directions", async () => {
    const bytes = await presetGeometryFixture(),
      p = await parseDeck(bytes),
      slide = P.getSlides(p)[0],
      source = authored(bytes, p);
    const before = P.getSlideShapes(slide).map((sh) =>
      P.getShapeGeometryResolved(p, sh),
    );
    expect(before[0].geometry).toEqual(
      resolve(
        "rightArrow",
        P.inches(3.6),
        P.inches(2.5),
        '<a:gd name="adj1" fmla="val 25000"/><a:gd name="adj2" fmla="*/ 50000 3 2"/>',
      ),
    );
    P.setShapeText(P.getSlideShapes(slide)[0], "Edited canonical preset");
    const saved = await P.savePresentation(p),
      reread = await parseDeck(saved);
    expect(authored(saved, reread)).toEqual(source);
    const target = createDeck("blank"),
      targetSlide = P.getSlides(target)[0];
    const imported = P.importSlide(
      target,
      slide,
      P.getSlideLayouts(target)[0],
      { preservePaintFormatting: true, preserveTextFormatting: true },
    );
    const copied = P.getSlideShapes(imported);
    expect(copied.map((sh) => P.getShapeGeometryResolved(target, sh))).toEqual(
      before,
    );
    const returned = createDeck("blank");
    P.importSlide(returned, imported, P.getSlideLayouts(returned)[0], {
      preservePaintFormatting: true,
      preserveTextFormatting: true,
    });
    const returnBytes = await P.savePresentation(returned);
    expect(authored(returnBytes, returned)).toEqual(source);
    expect(P.validatePresentation(returned)).toEqual([]);
  });
  it("preserves per-face shading while keeping alpha and outlines independent", async () => {
    const p = await parseDeck(await presetGeometryFixture()),
      output = svg(p);
    for (const [slope, intercept] of [
      [0.6, 0],
      [0.8, 0],
      [0.6, 0.4],
      [0.8, 0.2],
    ])
      expect(output).toContain(`slope="${slope}" intercept="${intercept}"`);
    expect(output).toContain('color-interpolation-filters="sRGB"');
    expect(output).not.toContain("feFuncA");
    for (const path of output.matchAll(/<path[^>]+filter="[^"]+"[^>]*>/g))
      expect(path[0]).toContain('stroke="none"');
  });
  it("projects a gradient across all faces in one shape coordinate system", () => {
    const p = createDeck("blank"),
      s = P.getSlides(p)[0],
      sh = P.addSlideShape(s, {
        x: P.inches(2),
        y: P.inches(1),
        w: P.inches(4),
        h: P.inches(2),
        preset: "cube",
      });
    P.setShapeGradientFill(sh, {
      stops: [
        { offset: 0, color: "#4080C0" },
        { offset: 0.5, color: "#904080" },
        { offset: 1, color: "#F0A060" },
      ],
      angleDeg: 0,
    });
    expect(svg(p)).toContain(
      'gradientUnits="userSpaceOnUse" gradientTransform="translate(192.00 96.00) scale(384.00 192.00)"',
    );
  });
  it.each(
    ["horz", "sphere"].flatMap((pattern) =>
      [
        ["lighten", "#8cb3d9", "#d9b38c"],
        ["darken", "#264d73", "#734d26"],
        ["lightenLess", "#6699cd", "#cd9966"],
        ["darkenLess", "#33669a", "#9a6633"],
      ].map(([mode, foreground, background]) => ({
        pattern,
        mode,
        foreground,
        background,
      })),
    ),
  )(
    "shades $pattern source colors for $mode without a raster filter",
    async ({ pattern, mode, foreground, background }) => {
      const p = await parseDeck(
        await createGeometryDeck({
          level: "local",
          shapeKind: "shape",
          geometry: `<a:custGeom><a:avLst/><a:gdLst/><a:pathLst><a:path fill="${mode}"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="w" y="0"/></a:lnTo><a:lnTo><a:pt x="w" y="h"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>`,
        }),
      );
      P.setShapePatternFill(P.getSlideShapes(P.getSlides(p)[0])[0], {
        preset: pattern,
        foreground: "#4080C0",
        background: "#C08040",
      });
      const output = svg(p);
      expect(output).not.toContain("feComponentTransfer");
      const shaded = [...output.matchAll(/<pattern\b[\s\S]*?<\/pattern>/g)].at(
        -1,
      )[0];
      expect(shaded).toContain(`fill="${background}"`);
      expect(shaded).toContain(`fill="${foreground}"`);
      // Sphere shading belongs to its binary cell geometry. It must not
      // introduce a translucent circle in an otherwise opaque native brush.
      if (pattern === "sphere")
        expect(shaded).not.toContain('fill-opacity="0.7"');
    },
  );
  it("uses one cropped image source with separately clipped shaded faces", async () => {
    const p = await parseDeck(
        await createGeometryDeck({
          geometry: presetGeometry("cube"),
          level: "local",
        }),
      ),
      output = svg(p);
    expect(output.match(/<image\b/g)).toHaveLength(1);
    expect(output.match(/<use\b/g)).toHaveLength(3);
    expect(output).toContain('slope="0.8" intercept="0"');
    expect(output).toContain('slope="0.8" intercept="0.2"');
  });
  it("sizes filtered and layered gradient paint tiles from the common shape extents", () => {
    const p = createDeck("blank"),
      s = P.getSlides(p)[0];
    const sh = P.addSlideShape(s, {
      x: P.inches(2),
      y: P.inches(1),
      w: P.inches(4),
      h: P.inches(2),
      preset: "cube",
    });
    for (const stops of [
      [
        { offset: 0, color: "#4080C0", opacity: 0.5 },
        { offset: 1, color: "#F0A060", opacity: 0.5 },
      ],
      [
        { offset: 0, color: "#4080C0", opacity: 1 },
        { offset: 0.3, color: "#80C040", opacity: 0.3 },
        { offset: 0.7, color: "#C04080", opacity: 0.7 },
        { offset: 1, color: "#F0A060", opacity: 0.2 },
      ],
    ]) {
      P.setShapeGradientFill(sh, { stops, angleDeg: 0 });
      const output = svg(p);
      expect(output).toContain(
        'patternUnits="userSpaceOnUse" patternContentUnits="userSpaceOnUse" width="384.00" height="192.00" patternTransform="translate(192.00 96.00)"',
      );
      expect(output).toContain(
        'gradientUnits="userSpaceOnUse" gradientTransform="scale(384.00 192.00)"',
      );
      expect(output).toContain('<rect width="384.00" height="192.00"');
      expect(output).not.toContain('viewBox="0 0 1 1"');
    }
  });
});
