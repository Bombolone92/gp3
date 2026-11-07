import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck } from "../src/model.js";
import { parseXml } from "../lib/pptx/src/internal/xml/index.ts";
import { inheritGradientFill } from "../lib/pptx/src/api/fn/shape-fill-inheritance.ts";

const stops = (colors = ["FF0000", "0000FF"]) =>
  `<a:gsLst>${colors.map((color, i) => `<a:gs pos="${i * 100000}"><a:srgbClr val="${color}"/></a:gs>`).join("")}</a:gsLst>`;
const gradient = ({ angle, scaled, hasStops = true, path = false } = {}) =>
  `<a:gradFill>${hasStops ? stops() : ""}${path ? '<a:path path="circle"/>' : angle !== undefined || scaled !== undefined ? `<a:lin${angle !== undefined ? ` ang="${angle * 60000}"` : ""}${scaled !== undefined ? ` scaled="${Number(scaled)}"` : ""}/>` : ""}</a:gradFill>`;
const fill = (kind) =>
  kind === "solid"
    ? '<a:solidFill><a:srgbClr val="008000"/></a:solidFill>'
    : kind === "none"
      ? "<a:noFill/>"
      : kind === "missing"
        ? ""
        : gradient({ angle: 180, scaled: false });
const style = (index) =>
  index === null
    ? ""
    : `<p:style><a:lnRef idx="0"><a:srgbClr val="000000"/></a:lnRef><a:fillRef idx="${index}"><a:srgbClr val="FFFFFF"/></a:fillRef><a:effectRef idx="0"><a:srgbClr val="000000"/></a:effectRef><a:fontRef idx="minor"><a:srgbClr val="000000"/></a:fontRef></p:style>`;
async function fixture({
  index = 2,
  layout,
  own,
  angle,
  scaled,
  hasStops,
  path,
  editFiles,
} = {}) {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0],
    sh = P.addSlideShape(s, {
      x: 0,
      y: 0,
      w: P.inches(5),
      h: P.inches(3),
      preset: "rect",
    });
  P.setShapeGradientFill(sh, {
    stops: [
      { offset: 0, color: "#FF0000" },
      { offset: 1, color: "#0000FF" },
    ],
  });
  const files = unzipSync(await P.savePresentation(p)),
    names = [
      P.getSlidePartName(s),
      P.getSlideLayoutPartName(P.getSlideLayout(s)),
      P.getSlideMasterPartName(s),
    ].map((n) => n.slice(1));
  let xml = strFromU8(files[names[0]]),
    shape = xml.match(/<p:sp\b[\s\S]*?<\/p:sp>/)[0];
  shape = shape
    .replace(
      /<a:gradFill\b[\s\S]*?<\/a:gradFill>/,
      own ? fill(own) : gradient({ angle, scaled, hasStops, path }),
    )
    .replace(/<p:style\b[\s\S]*?<\/p:style>/, "")
    .replace("</p:spPr>", `</p:spPr>${style(index)}`);
  if (layout !== undefined)
    shape = shape.replace(
      "<p:nvPr/>",
      '<p:nvPr><p:ph type="body" idx="4"/></p:nvPr>',
    );
  files[names[0]] = strToU8(xml.replace(/<p:sp\b[\s\S]*?<\/p:sp>/, shape));
  for (let i = 1; i <= 2; i++) {
    const chosen =
      i === 1 ? fill(layout) : gradient({ angle: 270, scaled: false });
    let slot = shape
      .replace(/<p:style\b[\s\S]*?<\/p:style>/, "")
      .replace(/(<p:spPr\b[^>]*>)[\s\S]*?<\/p:spPr>/, `$1${chosen}</p:spPr>`);
    files[names[i]] = strToU8(
      strFromU8(files[names[i]])
        .replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, "")
        .replace(
          "</p:spTree>",
          `${layout !== undefined ? slot : ""}</p:spTree>`,
        ),
    );
  }
  const theme = Object.keys(files).find((n) =>
    /^ppt\/theme\/theme\d+\.xml$/.test(n),
  );
  files[theme] = strToU8(
    strFromU8(files[theme]).replace(
      /<a:fillStyleLst>[\s\S]*?<\/a:fillStyleLst>/,
      `<a:fillStyleLst>${fill("solid")}<a:gradFill>${stops(["00FF00", "0000FF"])}<a:lin ang="5400000" scaled="1"/></a:gradFill>${fill("solid")}</a:fillStyleLst>`,
    ),
  );
  editFiles?.(files);
  const loaded = await parseDeck(zipSync(files));
  return {
    p: loaded,
    s: P.getSlides(loaded)[0],
    shape: P.getSlideShapes(P.getSlides(loaded)[0])[0],
  };
}
// Independently checked in the reference with conflicting own/style/layout/
// master gradients. In particular, a non-gradient layout blocks the master,
// while a non-gradient own style does not block a same-kind layout fallback.
const cases = [
  [{}, 90, true],
  [{ angle: 0, hasStops: false }, 0, true],
  [{ angle: 30 }, 30, true],
  [{ scaled: false }, 90, false],
  [{ layout: "gradient" }, 90, true],
  [{ index: null, layout: "gradient" }, 180, false],
  [{ index: null, layout: "solid" }, 0, false],
  [{ index: null, layout: "none" }, 0, false],
  [{ layout: "gradient", own: "missing" }, 90, true],
  [{ layout: "gradient", own: "none" }, null],
  [{ layout: "gradient", own: "solid" }, null],
  [{ layout: "gradient", angle: 0 }, 0, true],
  [{ layout: "gradient", path: true }, 0, false],
  [{ index: 0, layout: "gradient" }, 180, false],
  [{ index: 1, layout: "gradient", angle: 30 }, 30, false],
  [{ index: null }, 0, false],
  [{ index: null, layout: "missing" }, 270, false],
];
describe("partial gradient inheritance", () => {
  it.each(cases)(
    "matches native layer merging for %j",
    async (options, angle, scaled) => {
      const { p, shape } = await fixture(options),
        before = unzipSync(await P.savePresentation(p));
      const g = P.getShapeGradientFillEffective(p, shape);
      if (angle === null) expect(g).toBeNull();
      else {
        expect(g.angleDeg).toBe(angle);
        expect(!!g.scaled).toBe(!!scaled);
        expect(g.stops.map((s) => s.color)).toEqual(
          options.hasStops === false || options.own === "missing"
            ? ["#00FF00", "#0000FF"]
            : ["#FF0000", "#0000FF"],
        );
        expect(g.path).toBe(options.path ? "circle" : undefined);
      }
      expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    },
  );
  it("keeps literal reads distinct and observes an explicit replacement", async () => {
    const { p, shape } = await fixture();
    expect(P.getShapeGradientFill(shape).angleDeg).toBe(0);
    expect(P.getShapeGradientFillEffective(p, shape).angleDeg).toBe(90);
    P.setShapeGradientFill(shape, {
      angleDeg: 23,
      scaled: false,
      stops: [
        { offset: 0, color: "#112233" },
        { offset: 1, color: "#AABBCC" },
      ],
    });
    expect(P.getShapeGradientFillEffective(p, shape)).toMatchObject({
      angleDeg: 23,
      stops: [
        { offset: 0, color: "#112233" },
        { offset: 1, color: "#AABBCC" },
      ],
    });
  });
  it("inherits stop lists atomically, including an authored empty list", () => {
    const parse = (s) =>
      parseXml(
        `<a:gradFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${s}</a:gradFill>`,
      ).root;
    const own = parse('<a:gsLst/><a:lin scaled="0"/>'),
      fallback = parse(`${stops()}<a:lin ang="5400000" scaled="1"/>`),
      before = structuredClone([own, fallback]);
    const result = inheritGradientFill(own, fallback);
    expect(result.children[0]).toBe(own.children[0]);
    expect(result.children[0].children).toHaveLength(0);
    expect(
      result.children[1].attrs.map((a) => [a.name.localName, a.value]),
    ).toEqual([
      ["scaled", "0"],
      ["ang", "5400000"],
    ]);
    expect([own, fallback]).toEqual(before);
  });
  it("does not mix linear and path shading or merge rectangle schema defaults", () => {
    const parse = (s) =>
      parseXml(
        `<a:gradFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${s}</a:gradFill>`,
      ).root;
    const own = parse(
        '<a:path path="circle"><a:fillToRect l="10000"/></a:path><a:tileRect l="20000"/>',
      ),
      fallback = parse(
        '<a:path path="rect"><a:fillToRect t="30000"/></a:path><a:tileRect t="40000"/>',
      );
    expect(inheritGradientFill(own, fallback)).toBe(own);
    const linear = parse('<a:lin ang="12345"/>');
    expect(
      inheritGradientFill(linear, fallback).children.map(
        (c) => c.name.localName,
      ),
    ).toEqual(["lin", "tileRect"]);
  });
});

const replacePartText = (p, name, edit) => {
  const part = P._internalPackageOf(p).getPart(name);
  part.data = strToU8(edit(strFromU8(part.data)));
};
const themeName = (p) =>
  P._internalPackageOf(p).parts.find((part) =>
    /\/theme\d+\.xml$/.test(part.name),
  ).name;

describe("gradient style references", () => {
  it.each(["", "garbage", -1, 1.5, 0, 1000, 9000])(
    "ignores invalid or non-gradient style index %s without losing own stops",
    async (index) => {
      const { p, shape } = await fixture({ index });
      expect(P.getShapeGradientFillEffective(p, shape)).toEqual({
        angleDeg: 0,
        stops: [
          { offset: 0, color: "#FF0000" },
          { offset: 1, color: "#0000FF" },
        ],
      });
    },
  );
  it("uses the background style list for indices beginning at 1001", async () => {
    const { p, shape } = await fixture({
      index: 1001,
      editFiles(files) {
        const name = Object.keys(files).find((n) => /\/theme\d+\.xml$/.test(n));
        files[name] = strToU8(
          strFromU8(files[name]).replace(
            /<a:bgFillStyleLst>[\s\S]*?<\/a:bgFillStyleLst>/,
            `<a:bgFillStyleLst>${gradient({ angle: 137, scaled: true })}</a:bgFillStyleLst>`,
          ),
        );
      },
    });
    expect(P.getShapeGradientFillEffective(p, shape)).toMatchObject({
      angleDeg: 137,
      scaled: true,
    });
  });
  it("substitutes the fill reference color before applying theme stop transforms", async () => {
    const { p, shape } = await fixture({
      hasStops: false,
      angle: 0,
      editFiles(files) {
        for (const name of Object.keys(files)) {
          let xml = strFromU8(files[name]);
          if (/\/slide1\.xml$/.test(name))
            xml = xml.replace(
              '<a:fillRef idx="2"><a:srgbClr val="FFFFFF"/>',
              '<a:fillRef idx="2"><a:prstClr val="blue"/>',
            );
          if (/\/theme\d+\.xml$/.test(name))
            xml = xml.replace(
              '<a:srgbClr val="00FF00"/>',
              '<a:schemeClr val="phClr"><a:inv/></a:schemeClr>',
            );
          files[name] = strToU8(xml);
        }
      },
    });
    expect(
      P.getShapeGradientFillEffective(p, shape).stops.map((s) => s.color),
    ).toEqual(["#FFFF00", "#0000FF"]);
  });
  it("observes linked theme, theme bytes, relationship changes and independent decks", async () => {
    const { p, s, shape } = await fixture(),
      other = await fixture();
    const read = () => P.getShapeGradientFillEffective(p, shape).angleDeg;
    expect(read()).toBe(90);
    const pkg = P._internalPackageOf(p),
      original = pkg.getPart(themeName(p));
    const second = {
      ...original,
      name: "/ppt/theme/theme2.xml",
      data: strToU8(
        strFromU8(original.data).replace('ang="5400000"', 'ang="1800000"'),
      ),
    };
    pkg.parts.push(second);
    const master = P.getSlideMasterPartName(s),
      rels = pkg.getRels(master);
    const rel = rels.items.find((r) => r.type.endsWith("/theme"));
    rel.target = "../theme/theme2.xml";
    pkg.setRels(master, rels);
    expect(read()).toBe(30);
    replacePartText(p, second.name, (x) =>
      x.replace('ang="1800000"', 'ang="4200000"'),
    );
    expect(read()).toBe(70);
    expect(P.getShapeGradientFillEffective(other.p, other.shape).angleDeg).toBe(
      90,
    );
    rel.target = "../theme/theme1.xml";
    pkg.setRels(master, rels);
    expect(read()).toBe(90);
    // External links are never followed. A malformed parent cycle terminates
    // and uses the package's existing fallback-theme policy.
    rel.targetMode = "External";
    rels.items.push({
      id: "cycle",
      type: rel.type.replace(/theme$/, "slideMaster"),
      target: "slideMaster1.xml",
      targetMode: "Internal",
    });
    pkg.setRels(master, rels);
    expect(read()).toBe(90);
  });
  it("retains partial XML while copying in both directions and after an edit/save/reload", async () => {
    const source = await fixture(),
      target = await fixture();
    replacePartText(target.p, themeName(target.p), (x) =>
      x.replace('ang="5400000"', 'ang="10200000"'),
    );
    const copied = P.copyShape(source.s, source.shape);
    expect(P.getShapeGradientFillEffective(source.p, copied).angleDeg).toBe(90);
    const imported = P.importSlide(
      target.p,
      source.s,
      P.getSlideLayout(target.s),
    );
    const returned = P.importSlide(
      source.p,
      imported,
      P.getSlideLayout(source.s),
    );
    for (const [p, s, angle] of [
      [target.p, imported, 170],
      [source.p, returned, 90],
    ]) {
      const shape = P.getSlideShapes(s)[0];
      P.setShapeRotation(shape, 19);
      expect(P.getShapeGradientFill(shape).angleDeg).toBe(0);
      expect(P.getShapeGradientFillEffective(p, shape).angleDeg).toBe(angle);
      const bytes = await P.savePresentation(p),
        reopened = await parseDeck(bytes),
        slide = P.getSlides(reopened).at(-1);
      expect(
        P.getShapeGradientFillEffective(reopened, P.getSlideShapes(slide)[0])
          .angleDeg,
      ).toBe(angle);
      expect(P.getShapeRotation(P.getSlideShapes(slide)[0])).toBe(19);
      const xml = strFromU8(unzipSync(bytes)[P.getSlidePartName(s).slice(1)]);
      expect(
        xml.match(/<a:gradFill[^>]*>[\s\S]*?<\/a:gradFill>/g),
      ).toHaveLength(2);
      expect(
        xml
          .match(/<a:gradFill[^>]*>[\s\S]*?<\/a:gradFill>/g)
          .every((g) => !g.includes("<a:lin")),
      ).toBe(true);
    }
  });
});
