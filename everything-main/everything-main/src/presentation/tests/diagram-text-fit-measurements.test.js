import { describe, expect, it } from "vitest";
import native from "./data/diagram-text-fit-measurements-native.json";
import { layoutCore } from "../lib/pptx-preview/src/text-layout.ts";

const measure = (text, spec) => {
  const result = native.measurements[JSON.stringify([text, spec])];
  if (!result)
    throw new Error(
      `Unrecorded glyph measurement: ${text} ${JSON.stringify(spec)}`,
    );
  return result;
};

describe("shared text measurements against native TX fit outcomes", () => {
  it.each(native.cases)("distinguishes fit requirements for $name", (row) => {
    const input = { ...native.base, ...row.input };
    const snapshot = JSON.stringify(input);
    const result = layoutCore(input, measure);
    // This caller selects the measured requirement. A font rule needs natural
    // height even for one explicit line; a no-rule layout can accept authored
    // lines that exceed the box, but cannot accept excessive automatic wraps.
    // This is a measurement check at the given font, not a font-search test.
    const heightFits = result.requiredH <= input.boxHpx;
    const fits =
      result.unbreakableOverflowW === 0 &&
      (heightFits || (!row.strictHeight && result.automaticWraps === 0));
    expect(fits).toBe(row.expectedFit);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
