import { expect, it } from "vitest";
import native from "./data/text-shaped-ranges-native.json";
import { layoutCore } from "../lib/pptx-preview/src/text-layout.ts";

for (const row of native.cases) {
  it(`wraps shaped text as the native reference does: ${row.name}`, () => {
    const before = structuredClone(row.input);
    const measure = (text, spec) => {
      const key = JSON.stringify([
        text,
        spec.family,
        spec.sizePx,
        spec.bold,
        spec.italic,
        spec.letterSpacingPx,
        spec.kerning ?? null,
      ]);
      const result = row.measurements[key];
      if (!result) throw Error(`Unrecorded glyph measurement ${key}`);
      return result;
    };
    const run = () =>
      layoutCore(row.input, measure).placements.map(({ line }) =>
        line.tokens.map((token) => token.text).join(""),
      );
    expect(run()).toEqual(row.lines);
    expect(run()).toEqual(row.lines);
    expect(row.input).toEqual(before);
  });
}
