import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck, preview } from "../src/model.js";

const gradient = (
  colors,
  positions = colors.map((_, i) => (i * 100000) / (colors.length - 1)),
) =>
  `<a:gradFill><a:gsLst>${colors.map((c, i) => `<a:gs pos="${positions[i]}">${c}</a:gs>`).join("")}</a:gsLst><a:lin ang="1800000" scaled="1"/></a:gradFill>`;
const rgb = (hex, ops = "") => `<a:srgbClr val="${hex}">${ops}</a:srgbClr>`;
const scheme = (ops = "") => `<a:schemeClr val="accent1">${ops}</a:schemeClr>`;
const colors = [
  rgb("000000", '<a:tint val="75000"/>'),
  rgb("FF0000", '<a:tint val="50000"/><a:satMod val="300000"/>'),
  scheme('<a:shade val="50000"/>'),
];
// Independent native solid-color controls verify the transform pipeline.
const expected = ["#898989", "#FF7878", "#0000BC"];
const fills = (source) =>
  [...source.matchAll(/<stop\b[^>]*stop-color="([^"]+)"/g)].map((m) => m[1]);
const svg = (p, s = P.getSlides(p)[0]) =>
  decodeURIComponent(preview(p, s).split(",").slice(1).join(","));

async function fixture({
  stops = colors,
  positions,
  background,
  inherited,
  decoration = false,
} = {}) {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  const sh = P.addSlideShape(s, {
    x: P.inches(1),
    y: P.inches(1),
    w: P.inches(4),
    h: P.inches(2),
    preset: "rect",
  });
  P.setShapeGradientFill(sh, {
    stops: [
      { offset: 0, color: "#000000" },
      { offset: 1, color: "#FFFFFF" },
    ],
  });
  const files = unzipSync(await P.savePresentation(p));
  const names = [
    P.getSlidePartName(s),
    P.getSlideLayoutPartName(P.getSlideLayout(s)),
    P.getSlideMasterPartName(s),
  ].map((n) => n.slice(1));
  const grad = gradient(stops, positions);
  let slide = strFromU8(files[names[0]]).replace(
    /<a:gradFill\b[^>]*>[\s\S]*?<\/a:gradFill>/,
    grad,
  );
  // Distinct source colors make a missed or twice-applied map visible.
  const themeName = Object.keys(files).find((n) =>
    /^ppt\/theme\/theme\d+\.xml$/.test(n),
  );
  files[themeName] = strToU8(
    strFromU8(files[themeName])
      .replace(
        /<a:accent1>[\s\S]*?<\/a:accent1>/,
        `<a:accent1>${rgb("FF0000")}</a:accent1>`,
      )
      .replace(
        /<a:accent2>[\s\S]*?<\/a:accent2>/,
        `<a:accent2>${rgb("0000FF")}</a:accent2>`,
      ),
  );
  const map =
    '<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent2" accent2="accent1" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr>';
  slide = slide
    .replace(/<p:clrMapOvr\b[\s\S]*?<\/p:clrMapOvr>/, "")
    .replace("</p:sld>", map + "</p:sld>");
  if (inherited) {
    let shape = slide.match(/<p:sp\b[\s\S]*?<\/p:sp>/)[0];
    if (!decoration)
      shape = shape.replace(
        /<p:nvPr\s*\/>/,
        '<p:nvPr><p:ph type="body" idx="3"/></p:nvPr>',
      );
    const bare = shape.replace(grad, "");
    slide = slide.replace(/<p:sp\b[\s\S]*?<\/p:sp>/, decoration ? "" : bare);
    for (let i = 1; i <= 2; i++) {
      files[names[i]] = strToU8(
        strFromU8(files[names[i]])
          .replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, "")
          .replace(
            "</p:spTree>",
            (i === inherited ? shape : decoration ? "" : bare) + "</p:spTree>",
          ),
      );
    }
  }
  files[names[0]] = strToU8(slide);
  if (background !== undefined) {
    files[names[0]] = strToU8(
      strFromU8(files[names[0]]).replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, ""),
    );
    for (const [i, n] of names.entries())
      files[n] = strToU8(
        strFromU8(files[n])
          .replace(/<p:bg\b[\s\S]*?<\/p:bg>/g, "")
          .replace(
            /(<p:cSld\b[^>]*>)/,
            `$1${i === background ? `<p:bg><p:bgPr>${grad}</p:bgPr></p:bg>` : ""}`,
          ),
      );
  }
  const loaded = await parseDeck(zipSync(files));
  return { p: loaded, s: P.getSlides(loaded)[0], names, grad };
}

describe("gradient stop color resolution", () => {
  it("resolves ordered transforms and host color maps without changing raw reads or source XML", async () => {
    const { p, s } = await fixture();
    const before = unzipSync(await P.savePresentation(p));
    const shape = P.getSlideShapes(s)[0];
    expect(P.getShapeGradientFill(shape).stops.map((s) => s.color)).toEqual([
      "#000000",
      "#FF0000",
      "scheme:accent1",
    ]);
    expect(
      P.getShapeGradientFillEffective(p, shape).stops.map((s) => s.color),
    ).toEqual(expected);
    expect(fills(svg(p))).toEqual(expected);
    expect(unzipSync(await P.savePresentation(p))).toEqual(before);
  });
  it.each([1, 2])(
    "resolves inherited stops from template level %s in the consuming slide",
    async (inherited) => {
      const { p, s } = await fixture({ inherited });
      const shape = P.getSlideShapes(s)[0];
      expect(P.getShapeGradientFill(shape)).toBeNull();
      expect(
        P.getShapeGradientFillEffective(p, shape).stops.map((s) => s.color),
      ).toEqual(expected);
      expect(fills(svg(p))).toEqual(expected);
    },
  );
  it.each([1, 2])(
    "uses the host color map for level %s decorations",
    async (inherited) => {
      const { p } = await fixture({ inherited, decoration: true });
      expect(fills(svg(p))).toEqual(expected);
    },
  );
  it.each([0, 1, 2])(
    "resolves background stops at level %s",
    async (background) => {
      const { p, s } = await fixture({ background });
      const layout = P.getSlideLayout(s);
      const read = (context) =>
        background === 0
          ? P.getSlideBackgroundGradientFill(s, context)
          : background === 1
            ? P.getSlideLayoutBackgroundGradientFill(layout, context)
            : P.getSlideMasterBackgroundGradientFill(p, layout, context);
      expect(read().stops.map((s) => s.color)).toEqual([
        "#000000",
        "#FF0000",
        "scheme:accent1",
      ]);
      expect(
        read({
          theme: P.getPresentationTheme(p),
          clrMap: { accent1: "accent2" },
        }).stops.map((s) => s.color),
      ).toEqual(expected);
      expect(fills(svg(p))).toEqual(expected);
    },
  );
  it("reads non-sRGB colors and percentage positions without inventing malformed stops", async () => {
    const { p, s } = await fixture({
      stops: [
        '<a:scrgbClr r="50000" g="0" b="0"/>',
        '<a:hslClr hue="7200000" sat="100%" lum="50%"/>',
        '<a:sysClr val="windowText" lastClr="0000FF"><a:shade val="50000"/></a:sysClr>',
        rgb("FFFFFF"),
        rgb("FFFFFF"),
        rgb("FFFFFF"),
        rgb("FFFFFF"),
      ],
      positions: ["0%", "25%", "100%", "garbage", "50oops", "", "Infinity"],
    });
    expect(
      P.getShapeGradientFillEffective(p, P.getSlideShapes(s)[0]).stops,
    ).toEqual([
      { offset: 0, color: "#BC0000" },
      { offset: 0.25, color: "#00FF00" },
      { offset: 1, color: "#0000BC" },
    ]);
    expect(fills(svg(p))).toEqual(["#BC0000", "#00FF00", "#0000BC"]);
  });
  it("preserves unresolved scheme tokens when a theme is unavailable", async () => {
    const { p, s } = await fixture({ background: 0 });
    expect(
      P.getSlideBackgroundGradientFill(s, { theme: null }).stops.map(
        (s) => s.color,
      ),
    ).toEqual(["#898989", "#FF7878", "scheme:accent1"]);
  });
  it("retains native transforms through edit, copy in both directions, export and reload", async () => {
    const { p, s, grad } = await fixture();
    P.copyShape(s, P.getSlideShapes(s)[0]);
    const target = createDeck("blank");
    const dest = P.importSlide(
      target,
      s,
      P.getSlideLayout(P.getSlides(target)[0]),
    );
    // Ordinary shape imports intentionally adopt the destination theme/map.
    const themeColor = P.getPresentationTheme(target).accent1;
    const theme = P.getPresentationTheme(target);
    expect(themeColor).toBeTruthy();
    P.setShapeRotation(P.getSlideShapes(dest)[0], 21);
    const returned = P.importSlide(p, dest, P.getSlideLayout(s));
    for (const [deck, slide] of [
      [target, dest],
      [p, returned],
    ]) {
      const bytes = await P.savePresentation(deck);
      const xml = strFromU8(
        unzipSync(bytes)[P.getSlidePartName(slide).slice(1)],
      );
      expect(xml.split(grad).length - 1).toBe(2);
      const reopened = await parseDeck(bytes);
      const copied = P.getSlides(reopened).at(-1);
      expect(P.getShapeRotation(P.getSlideShapes(copied)[0])).toBe(21);
      expect(fills(svg(reopened, copied)).slice(0, 2)).toEqual(
        expected.slice(0, 2),
      );
      expect(fills(svg(reopened, copied))).toEqual(fills(svg(deck, slide)));
    }
    expect(theme).toEqual(P.getPresentationTheme(target));
  });
});
