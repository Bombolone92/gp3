import { afterEach, describe, expect, it, vi } from "vitest";
import {
  layoutCore,
  layoutTextSvg,
} from "../lib/pptx-preview/src/text-layout.ts";

afterEach(() => vi.unstubAllGlobals());

const piece = (text, scale = 1) => ({
  text,
  family: "Independent face",
  sizePx: 20 * scale,
  bold: false,
  italic: false,
  letterSpacingPx: 0,
  fillHex: "#000000",
  underline: "none",
  strike: false,
  superSub: 0,
  href: null,
  isBreak: false,
});
const body = (pieces, width, wrap = true) => ({
  boxXpx: 0,
  boxYpx: 0,
  boxWpx: width,
  boxHpx: 2000,
  anchor: "top",
  wrap,
  paragraphs: [
    {
      align: "left",
      marLpx: 0,
      marRpx: 0,
      firstIndentPx: 0,
      spcBefPx: 0,
      spcAftPx: 0,
      lineSpacing: null,
      lineSpacingReduction: 0,
      bullet: null,
      pieces,
      fallbackSizePx: 20,
    },
  ],
});
// Every code point has a positive advance, including marks and joiners.
// Correct boundaries must come from Unicode text, not inferred zero widths.
const measure = (text, spec) => ({
  widthPx: ([...text].length * spec.sizePx) / 2,
});
const lines = (input, measurer = measure) =>
  layoutCore(input, measurer).placements.map(({ line }) =>
    line.tokens.map((t) => t.text).join(""),
  );
const clusters = [
  "e\u0301",
  "a\u0308\u0301",
  "か\u3099",
  "👩🏽‍💻",
  "👨‍👩‍👧‍👦",
  "🇨🇦",
  "1️⃣",
  "각",
  "क्‍ष",
  "\u0600a",
  "✈️",
  "A",
  "一",
  "𠀀",
  "一\ufe00",
  "\ud800",
];

describe("grapheme boundaries in emergency wrapping", () => {
  it.each(clusters)(
    "keeps %s intact independently of measured advances",
    (cluster) => {
      for (const scale of [0.5, 1, 2.75])
        for (const width of [1, 8, 17])
          expect(
            lines(body([piece(cluster.repeat(2), scale)], width * scale)),
          ).toEqual([cluster, cluster]);
    },
  );
  it.each(clusters.filter((c) => [...c].length > 1))(
    "retains all formatted pieces inside %s on the same line",
    (cluster) => {
      const parts = [...cluster.repeat(2)].map((ch, i) => ({
        ...piece(ch),
        bold: i % 2 === 0,
        fillHex: i % 2 ? "#112233" : "#445566",
      }));
      const result = layoutCore(body(parts, 19), measure);
      expect(
        result.placements.map(({ line }) =>
          line.tokens.map((t) => t.text).join(""),
        ),
      ).toEqual([cluster, cluster]);
      expect(
        result.placements.flatMap(({ line }) =>
          line.tokens.map((t) => t.piece),
        ),
      ).toEqual(parts);
      expect(layoutTextSvg(body(parts, 19), measure)).toContain(
        'fill="#112233"',
      );
    },
  );
  it("keeps Unicode layout usable when Intl.Segmenter is unavailable", () => {
    vi.stubGlobal(
      "Intl",
      new Proxy(Intl, {
        get: (target, key) =>
          key === "Segmenter" ? undefined : Reflect.get(target, key),
      }),
    );
    for (const cluster of ["e\u0301", "👩🏽‍💻", "🇨🇦", "각", "क्‍ष"])
      expect(lines(body([piece(cluster.repeat(2))], 17))).toEqual([
        cluster,
        cluster,
      ]);
  });
  it("moves the complete oversized word before splitting it into graphemes", () => {
    const cluster = "e\u0301";
    expect(lines(body([piece("x " + cluster.repeat(2))], 29))).toEqual([
      "x",
      cluster,
      cluster,
    ]);
  });
  it("keeps fitting graphemes together across formatting fragments", () => {
    const parts = [
      piece("x e"),
      { ...piece("\u0301"), italic: true },
      piece("z"),
    ];
    expect(lines(body(parts, 39))).toEqual(["x", "e\u0301z"]);
    expect(lines(body(parts, 9))).toEqual(["x", "e\u0301", "z"]);
  });
  it("keeps an unbased sequence of combining marks as one grapheme", () => {
    // Repeating Extend characters does not start another grapheme (UAX #29 GB9).
    const text = "\u0301\u0308\u0301\u0308";
    expect(lines(body([piece(text)], 1))).toEqual([text]);
    const parts = [...text].map((ch) => ({ ...piece(ch), italic: true }));
    expect(lines(body(parts, 1))).toEqual([text]);
  });
  it("honors authored breaks even inside a possible cluster", () => {
    expect(
      lines(
        body([piece("e"), { ...piece(""), isBreak: true }, piece("\u0301")], 9),
      ),
    ).toEqual(["e", "\u0301"]);
  });
  it("keeps unwrapped content and fitting word measurements unchanged", () => {
    const text = clusters.join(" ");
    expect(lines(body([piece(text)], 1, false))).toEqual([text]);
    const combined = "e\u0301".repeat(2);
    const result = layoutCore(body([piece(combined)], 200), measure);
    expect(result.placements[0].line.tokens).toHaveLength(1);
    expect(result.placements[0].line.tokens[0].width).toBe(40);
  });
  it("retains East Asian punctuation attachment with combining marks", () => {
    expect(lines(body([piece("一。\u0301二")], 30))).toEqual([
      "一。\u0301",
      "二",
    ]);
  });
  it("scans large formatted text without measuring growing prefixes", () => {
    const cluster = "e\u0301",
      parts = Array.from({ length: 5000 }, (_, i) => ({
        ...piece(cluster),
        fillHex: i % 2 ? "#112233" : "#445566",
      }));
    let characters = 0;
    const result = layoutCore(body(parts, 19), (text, spec) => {
      characters += text.length;
      return measure(text, spec);
    });
    expect(result.placements).toHaveLength(5000);
    expect(characters).toBeLessThan(3 * cluster.length * parts.length);
    expect(
      result.placements.map(({ line }) =>
        line.tokens.map((t) => t.text).join(""),
      ),
    ).toEqual(Array(5000).fill(cluster));
  });
});
