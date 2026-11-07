import { describe, expect, it } from "vitest";
import { resolveDiagramColor } from "../lib/pptx/src/api/fn/diagram-color.ts";
import { sampleDiagramColors } from "../lib/pptx/src/internal/diagram/color-list.ts";
import {
  resolveDrawingColor,
  resolveDrawingOpacity,
} from "../lib/pptx/src/api/fn/shape-color.ts";
import {
  NS,
  parseXml,
  serializeFragment,
} from "../lib/pptx/src/internal/xml/index.ts";

const color = (xml) =>
  parseXml(`<a:solidFill xmlns:a="${NS.dml}">${xml}</a:solidFill>`).root
    .children[0];
const rgb = (hex, transforms = "") =>
  color(`<a:srgbClr val="${hex}">${transforms}</a:srgbClr>`);
const sample = (from, to, amount = 0.5, hueDirection = "cw") => ({
  from,
  to,
  amount,
  hueDirection,
});
const resolve = (s, theme = null, map) =>
  resolveDrawingColor(resolveDiagramColor(s, theme, map), theme, map);

describe("SmartArt palette color interpolation", () => {
  // Independently measured full-coverage pixels from native reference PNGs.
  // In particular, blue/red and magenta/yellow reject shortest-arc wrapping.
  it.each([
    [
      "FF0000",
      "00FF00",
      ["FF0000", "FF6600", "FFCC00", "CCFF00", "66FF00", "00FF00"],
    ],
    [
      "00FF00",
      "FF0000",
      ["00FF00", "66FF00", "CCFF00", "FFCC00", "FF6600", "FF0000"],
    ],
    [
      "FF00FF",
      "FFFF00",
      ["FF00FF", "3300FF", "0099FF", "00FF99", "33FF00", "FFFF00"],
    ],
    [
      "0000FF",
      "FF0000",
      ["0000FF", "00CCFF", "00FF66", "66FF00", "FFCC00", "FF0000"],
    ],
    [
      "FF0000",
      "00FFFF",
      ["FF0000", "FF9900", "CCFF00", "33FF00", "00FF66", "00FFFF"],
    ],
    [
      "0000FF",
      "808080",
      ["0000FF", "1ABDE6", "33CC70", "76B34D", "998F66", "808080"],
    ],
    [
      "000000",
      "FFFFFF",
      ["000000", "333333", "666666", "999999", "CCCCCC", "FFFFFF"],
    ],
    [
      "112244",
      "CCDDAA",
      ["112244", "206272", "319F81", "4AC26A", "8CCF7B", "CCDDAA"],
    ],
    [
      "808081",
      "0000FF",
      ["808081", "67679A", "4D4DB3", "3333CC", "1A1AE6", "0000FF"],
    ],
  ])(
    "interpolates %s to %s in numeric HSL for both hue directions",
    (a, b, expected) => {
      for (const direction of ["cw", "ccw"])
        expect(
          Array.from({ length: 6 }, (_, i) =>
            resolve(sample(rgb(a), rgb(b), i / 5, direction)),
          ),
        ).toEqual(expected.map((v) => `#${v}`));
    },
  );

  it.each([
    [
      "808080",
      "FF0000",
      ["808080", "996601", "B24D00", "CC3400", "E51A00", "FE0100"],
    ],
    [
      "808080",
      "00FF00",
      ["808080", "996601", "B24D00", "CC3400", "E51A00", "FE0100"],
    ],
    [
      "808080",
      "0000FF",
      ["808080", "996601", "B24D00", "CC3400", "E51A00", "FE0100"],
    ],
    [
      "808080",
      "00FFFF",
      ["808080", "996601", "B24D00", "CC3400", "E51A00", "FE0100"],
    ],
    [
      "808080",
      "112244",
      ["808080", "765D2B", "5A3700", "472200", "341300", "210800"],
    ],
    [
      "404040",
      "0000FF",
      ["404040", "664400", "8C3C00", "B32D00", "D91800", "FF0000"],
    ],
    [
      "C0C0C0",
      "0000FF",
      ["C0C0C0", "C5A86F", "C18E27", "996702", "8B5100", "7E4000"],
    ],
  ])(
    "executes native ordered offsets for achromatic %s to %s including the final endpoint",
    (a, b, expected) => {
      const list = parseXml(
        `<d:txFillClrLst xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}"><a:srgbClr val="${a}"/><a:srgbClr val="${b}"/></d:txFillClrLst>`,
      ).root;
      const before = serializeFragment(list);
      expect(
        Array.from({ length: 6 }, (_, i) =>
          resolve(sampleDiagramColors(list, i, 6)),
        ),
      ).toEqual(expected.map((v) => `#${v}`));
      expect(serializeFragment(list)).toBe(before);
    },
  );

  it("keeps HSL endpoint precision while deriving native palette offsets", () => {
    const from = color('<a:hslClr hue="0" sat="0" lum="50000"/>'),
      to = rgb("0000FF");
    expect(resolve(sample(from, to, 0.2))).toBe("#996600");
    expect(resolve(sample(from, to, 0.6))).toBe("#CC3300");
    expect(resolve(sample(from, to, 1))).toBe("#FF0000");
  });

  it("samples every interval of a multicolor cycle without RGB interpolation", () => {
    const list = parseXml(
      `<d:fillClrLst xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}" meth="cycle"><a:srgbClr val="FF0000"/><a:srgbClr val="00FF00"/><a:srgbClr val="0000FF"/></d:fillClrLst>`,
    ).root;
    expect(
      Array.from({ length: 6 }, (_, i) =>
        resolve(sampleDiagramColors(list, i, 6)),
      ),
    ).toEqual([
      "#FF0000",
      "#AAFF00",
      "#00FFAA",
      "#0000FF",
      "#00FFAA",
      "#AAFF00",
    ]);
  });

  it("resolves theme mapping and color transforms before interpolation without mutating source XML", () => {
    const from = color(
      '<a:schemeClr val="accent1"><a:hueOff val="7200000"/></a:schemeClr>',
    );
    const to = color('<a:schemeClr val="accent3"/>');
    const before = [from, to].map(serializeFragment);
    const theme = {
      accent1: "#0000FF",
      accent2: "#FF0000",
      accent3: "#0000FF",
    };
    expect(resolve(sample(from, to), theme, { accent1: "accent2" })).toBe(
      "#00FFFF",
    );
    expect([from, to].map(serializeFragment)).toEqual(before);
  });

  it("uses the shared DrawingML resolver for HSL, linear RGB, presets and system colors", () => {
    const red = [
      '<a:hslClr hue="0" sat="100000" lum="50000"/>',
      '<a:scrgbClr r="100000" g="0" b="0"/>',
      '<a:prstClr val="red"/>',
      '<a:sysClr val="windowText" lastClr="FF0000"/>',
    ];
    for (const xml of red)
      expect(resolve(sample(color(xml), rgb("00FF00"), 0.4))).toBe("#FFCC00");
  });

  it("interpolates alpha after applying each endpoint's alpha transformations", () => {
    const from = rgb(
      "FF0000",
      '<a:alpha val="50000"/><a:alphaMod val="50000"/>',
    );
    const to = rgb("00FF00", '<a:alpha val="50000"/><a:alphaOff val="25000"/>');
    const opacity = Array.from({ length: 6 }, (_, i) =>
      resolveDrawingOpacity(resolveDiagramColor(sample(from, to, i / 5), null)),
    );
    expect(opacity).toEqual([0.25, 0.35, 0.45, 0.55, 0.65, 0.75]);
    expect(resolve(sample(from, to, 0.2))).toBe("#FF6600");
  });

  it("keeps interval starts and singleton/repeat entries as original theme XML", () => {
    const from = color(
      '<a:schemeClr val="accent1"><a:alpha val="33000"/></a:schemeClr>',
    );
    const to = color('<a:schemeClr val="accent2"/>');
    expect(resolveDiagramColor(sample(from, to, 0), null)).toBe(from);
    expect(resolveDiagramColor(sample(from, from), null)).toBe(from);
  });

  it("does not manufacture a color from unresolved or malformed endpoints", () => {
    for (const from of [
      color('<a:schemeClr val="accent1"/>'),
      rgb("bad-color"),
    ])
      expect(resolveDiagramColor(sample(from, rgb("00FF00")), null)).toBeNull();
    for (const amount of [-1, 2, NaN, Infinity])
      expect(
        resolveDiagramColor(sample(rgb("FF0000"), rgb("00FF00"), amount), null),
      ).toBeNull();
  });
});
